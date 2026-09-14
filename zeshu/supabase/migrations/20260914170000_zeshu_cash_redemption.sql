-- Zeshu Cash redemption holds and immutable checkout debits.

alter table public.customer_reward_ledger
  drop constraint if exists customer_reward_ledger_event_type_check;

alter table public.customer_reward_ledger
  drop constraint if exists customer_reward_ledger_amount_check;

alter table public.customer_reward_ledger
  add constraint customer_reward_ledger_event_type_check
  check (event_type in (
    'ORDER_REWARD', 'MONTHLY_3RD_ORDER_BONUS', 'MONTHLY_5TH_ORDER_BONUS',
    'REFERRAL_REFERRER_BONUS', 'REFERRAL_NEW_CUSTOMER_BONUS',
    'CHECKOUT_REDEMPTION', 'CHECKOUT_REDEMPTION_REVERSAL'
  ));

alter table public.customer_reward_ledger
  add constraint customer_reward_ledger_amount_check
  check (
    (event_type = 'CHECKOUT_REDEMPTION' and amount < 0)
    or (event_type = 'CHECKOUT_REDEMPTION_REVERSAL' and amount > 0)
    or (event_type not in ('CHECKOUT_REDEMPTION', 'CHECKOUT_REDEMPTION_REVERSAL') and amount > 0)
  );

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id uuid not null unique references public.inventory_reservations(id) on delete cascade,
  order_id uuid null references public.orders(id) on delete set null,
  razorpay_order_id text null,
  requested_amount numeric(10,2) not null check (requested_amount >= 0),
  approved_amount numeric(10,2) not null check (approved_amount >= 0),
  status text not null check (status in ('RESERVED', 'CONSUMED', 'RELEASED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  released_at timestamptz null,
  check (approved_amount <= requested_amount),
  check (status <> 'CONSUMED' or consumed_at is not null),
  check (status <> 'RELEASED' or released_at is not null)
);

create index if not exists reward_redemptions_user_active_idx
  on public.reward_redemptions(user_id, status, expires_at);

create index if not exists reward_redemptions_order_idx
  on public.reward_redemptions(order_id);

-- Preserve the authoritative payable before any Zeshu Cash adjustment.  This
-- value is never changed after reservation creation and is the only amount
-- used for subsequent redemption recalculations.
alter table public.inventory_reservations
  add column if not exists pre_reward_total_paid numeric;

update public.inventory_reservations
set pre_reward_total_paid = expected_total_paid
  + coalesce(nullif(pricing_snapshot ->> 'zeshu_cash_redemption', '')::numeric, 0)
where pre_reward_total_paid is null;

update public.inventory_reservations
set pricing_snapshot = jsonb_set(
  pricing_snapshot,
  '{base_discount_total}',
  coalesce(pricing_snapshot -> 'discount_total', '0'::jsonb),
  true
)
where not (pricing_snapshot ? 'base_discount_total');

alter table public.inventory_reservations
  alter column pre_reward_total_paid set not null;
alter table public.inventory_reservations
  drop constraint if exists inventory_reservations_pre_reward_total_paid_check;
alter table public.inventory_reservations
  add constraint inventory_reservations_pre_reward_total_paid_check
  check (pre_reward_total_paid > 0);

create or replace function public.capture_inventory_reservation_base_pricing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.pre_reward_total_paid is null then
      new.pre_reward_total_paid := new.expected_total_paid;
    end if;
    new.pricing_snapshot := jsonb_set(
      new.pricing_snapshot,
      '{base_discount_total}',
      coalesce(new.pricing_snapshot -> 'discount_total', '0'::jsonb),
      true
    );
  elsif new.pre_reward_total_paid is distinct from old.pre_reward_total_paid then
    raise exception 'pre-redemption payable is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_reservation_base_pricing_trigger
  on public.inventory_reservations;
create trigger inventory_reservation_base_pricing_trigger
before insert or update on public.inventory_reservations
for each row execute function public.capture_inventory_reservation_base_pricing();

revoke all on function public.capture_inventory_reservation_base_pricing() from public;
revoke all on function public.capture_inventory_reservation_base_pricing() from anon;
revoke all on function public.capture_inventory_reservation_base_pricing() from authenticated;

alter table public.reward_redemptions enable row level security;

drop policy if exists "customers read own reward redemptions"
  on public.reward_redemptions;

create policy "customers read own reward redemptions"
  on public.reward_redemptions
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.get_my_reward_balance()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(
    0::numeric,
    coalesce((
      select sum(l.amount)
      from public.customer_reward_ledger l
      where l.user_id = auth.uid()
    ), 0)
    - coalesce((
      select sum(r.approved_amount)
      from public.reward_redemptions r
      where r.user_id = auth.uid()
        and r.status = 'RESERVED'
    ), 0)
  );
$$;

create or replace function public.reserve_zeshu_cash_redemption(
  p_user_id uuid,
  p_reservation_id uuid,
  p_requested_amount numeric
)
returns table(redemption_id uuid, approved_amount numeric, expected_total_paid numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_existing public.reward_redemptions%rowtype;
  v_ledger_balance numeric := 0;
  v_reserved_balance numeric := 0;
  v_available numeric := 0;
  v_cap numeric := 0;
  v_approved numeric := 0;
  v_redemption_id uuid;
  v_base_discount numeric := 0;
begin
  if p_user_id is null or p_reservation_id is null or p_requested_amount is null
     or p_requested_amount < 0 or not exists (
       select 1 from public.users where id = p_user_id
     ) then
    raise exception 'invalid reward redemption request';
  end if;
  if p_requested_amount > 0 and p_requested_amount < 1 then
    raise exception 'minimum redemption is 1';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 61129));

  -- Release only editable (ACTIVE) reservations.  A PAYMENT_PENDING hold is
  -- bound to an existing Razorpay amount and must not be changed underneath it.
  for v_existing in
    select *
    from public.reward_redemptions
    where user_id = p_user_id
      and status = 'RESERVED'
      and expires_at <= now()
    order by id
    for update
  loop
    select * into v_reservation
    from public.inventory_reservations
    where id = v_existing.reservation_id
    for update;

    if found and v_reservation.status = 'ACTIVE' then
      update public.inventory_reservations
      set expected_total_paid = pre_reward_total_paid,
          pricing_snapshot = jsonb_set(
            jsonb_set(
              pricing_snapshot,
              '{discount_total}',
              coalesce(pricing_snapshot -> 'base_discount_total', '0'::jsonb),
              true
            ),
            '{zeshu_cash_redemption}',
            '0'::jsonb,
            true
          )
      where id = v_reservation.id;
      update public.reward_redemptions
      set status = 'RELEASED', released_at = now()
      where id = v_existing.id;
    end if;
  end loop;

  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if not found or v_reservation.user_id is distinct from p_user_id
     or v_reservation.status not in ('ACTIVE', 'PAYMENT_PENDING')
     or v_reservation.expires_at <= now() then
    raise exception 'invalid reward redemption reservation';
  end if;

  select * into v_existing
  from public.reward_redemptions
  where reservation_id = p_reservation_id
  for update;

  if found and v_existing.status = 'RESERVED' and v_existing.expires_at > now() then
    -- Once PAYMENT_PENDING, the Razorpay order amount is immutable.  Resume
    -- the exact existing hold rather than silently changing payable amount.
    if v_reservation.status = 'PAYMENT_PENDING' then
      redemption_id := v_existing.id;
      approved_amount := v_existing.approved_amount;
      expected_total_paid := v_reservation.expected_total_paid;
      return next;
      return;
    end if;

    if p_requested_amount = 0 then
      update public.reward_redemptions
      set status = 'RELEASED', released_at = now()
      where id = v_existing.id;
      update public.inventory_reservations
      set expected_total_paid = pre_reward_total_paid,
          pricing_snapshot = jsonb_set(
            jsonb_set(
              pricing_snapshot,
              '{discount_total}',
              coalesce(pricing_snapshot -> 'base_discount_total', '0'::jsonb),
              true
            ),
            '{zeshu_cash_redemption}', '0'::jsonb, true
          )
      where id = v_reservation.id;
      redemption_id := null;
      approved_amount := 0;
      expected_total_paid := v_reservation.pre_reward_total_paid;
      return next;
      return;
    end if;
  end if;

  if v_reservation.status = 'PAYMENT_PENDING' then
    if p_requested_amount > 0 then
      raise exception 'payment amount is already bound';
    end if;
    redemption_id := null;
    approved_amount := 0;
    expected_total_paid := v_reservation.expected_total_paid;
    return next;
    return;
  end if;

  select coalesce(sum(amount), 0) into v_ledger_balance
  from public.customer_reward_ledger
  where user_id = p_user_id;

  select coalesce(sum(approved_amount), 0) into v_reserved_balance
  from public.reward_redemptions
  where user_id = p_user_id
    and status = 'RESERVED'
    and (v_existing.id is null or id <> v_existing.id);

  v_available := greatest(0, v_ledger_balance - v_reserved_balance);
  v_cap := least(20, floor(v_reservation.merchandise_subtotal * 0.10));
  v_approved := least(v_available, p_requested_amount, v_cap);
  v_approved := greatest(0, least(v_approved, v_reservation.pre_reward_total_paid - 1));

  v_base_discount := coalesce(
    nullif(v_reservation.pricing_snapshot ->> 'base_discount_total', '')::numeric,
    nullif(v_reservation.pricing_snapshot ->> 'discount_total', '')::numeric,
    0
  );

  if v_approved = 0 then
    if v_existing.id is not null then
      update public.reward_redemptions
      set status = 'RELEASED', released_at = now()
      where id = v_existing.id;
    end if;
    update public.inventory_reservations
    set expected_total_paid = pre_reward_total_paid,
        pricing_snapshot = jsonb_set(
          jsonb_set(pricing_snapshot, '{discount_total}', to_jsonb(v_base_discount), true),
          '{zeshu_cash_redemption}', '0'::jsonb, true
        )
    where id = v_reservation.id;
    redemption_id := null;
    approved_amount := 0;
    expected_total_paid := v_reservation.pre_reward_total_paid;
    return next;
    return;
  end if;

  if v_existing.id is not null then
    update public.reward_redemptions
    set requested_amount = p_requested_amount,
        approved_amount = v_approved,
        status = 'RESERVED',
        expires_at = v_reservation.expires_at,
        released_at = null
    where id = v_existing.id;
    v_redemption_id := v_existing.id;
  else
    insert into public.reward_redemptions(
      user_id, reservation_id, requested_amount, approved_amount,
      status, expires_at
    ) values (
      p_user_id, p_reservation_id, p_requested_amount, v_approved,
      'RESERVED', v_reservation.expires_at
    ) returning id into v_redemption_id;
  end if;

  update public.inventory_reservations
  set expected_total_paid = pre_reward_total_paid - v_approved,
      pricing_snapshot = jsonb_set(
        jsonb_set(pricing_snapshot, '{discount_total}', to_jsonb(v_base_discount), true),
        '{zeshu_cash_redemption}', to_jsonb(v_approved), true
      )
  where id = v_reservation.id;

  redemption_id := v_redemption_id;
  approved_amount := v_approved;
  expected_total_paid := v_reservation.pre_reward_total_paid - v_approved;
  return next;
end;
$$;

create or replace function public.consume_zeshu_cash_redemption(
  p_reservation_id uuid,
  p_order_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_redemption public.reward_redemptions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_user_id uuid;
  v_order_user uuid;
begin
  if p_reservation_id is null or p_order_id is null then
    raise exception 'invalid reward redemption request';
  end if;

  select user_id into v_user_id
  from public.reward_redemptions
  where reservation_id = p_reservation_id;

  if v_user_id is null then raise exception 'reward redemption not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 61129));

  select * into v_redemption
  from public.reward_redemptions
  where reservation_id = p_reservation_id
  for update;

  if not found then raise exception 'reward redemption not found'; end if;
  if v_redemption.status = 'CONSUMED' then return v_redemption.approved_amount; end if;
  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if not found or v_redemption.status <> 'RESERVED' then
    raise exception 'reward redemption is no longer available';
  end if;

  select user_id into v_order_user from public.orders where id = p_order_id;
  if v_order_user is distinct from v_redemption.user_id then
    raise exception 'reward redemption order mismatch';
  end if;

  -- A verified payment may finalize at the reservation expiry boundary.  Once
  -- finalization has consumed the reservation, allow this same transaction to
  -- consume the hold even if its wall-clock expiry has just passed.  Editable
  -- or still-payment-pending expired reservations remain rejected.
  if v_redemption.expires_at <= now()
     and v_reservation.status <> 'CONSUMED' then
    raise exception 'reward redemption is no longer available';
  end if;

  if v_redemption.approved_amount > 0 then
    insert into public.customer_reward_ledger(
      user_id, order_id, event_type, amount, reference_key, description
    ) values (
      v_redemption.user_id, p_order_id, 'CHECKOUT_REDEMPTION',
      -v_redemption.approved_amount,
      'checkout_redemption:' || v_redemption.id,
      'Zeshu Cash used at checkout'
    ) on conflict (reference_key) do nothing;
  end if;

  update public.reward_redemptions
  set status = 'CONSUMED', order_id = p_order_id, consumed_at = now()
  where id = v_redemption.id;

  return v_redemption.approved_amount;
end;
$$;

create or replace function public.bind_zeshu_cash_redemption(
  p_redemption_id uuid,
  p_razorpay_order_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_redemption_id is null or nullif(btrim(p_razorpay_order_id), '') is null then
    raise exception 'invalid reward redemption request';
  end if;

  update public.reward_redemptions
  set razorpay_order_id = btrim(p_razorpay_order_id)
  where id = p_redemption_id
    and status = 'RESERVED'
    and (razorpay_order_id is null or razorpay_order_id = btrim(p_razorpay_order_id));

  if not found then raise exception 'reward redemption not found'; end if;
end;
$$;

create or replace function public.release_expired_zeshu_cash_redemptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_redemption public.reward_redemptions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_released integer := 0;
begin
  for v_user_id in
    select distinct user_id
    from public.reward_redemptions
    where status = 'RESERVED' and expires_at <= now()
    order by user_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 61129));

    for v_redemption in
      select *
      from public.reward_redemptions
      where user_id = v_user_id
        and status = 'RESERVED'
        and expires_at <= now()
      order by id
      for update
    loop
      select * into v_reservation
      from public.inventory_reservations
      where id = v_redemption.reservation_id
      for update;

      -- Never mutate pricing after a Razorpay order has been bound.  Such a
      -- hold is reconciled by successful finalization or a separate payment
      -- failure/expiry reconciliation path.
      if found and v_reservation.status = 'ACTIVE' then
        update public.inventory_reservations
        set expected_total_paid = pre_reward_total_paid,
            pricing_snapshot = jsonb_set(
              jsonb_set(
                pricing_snapshot,
                '{discount_total}',
                coalesce(pricing_snapshot -> 'base_discount_total', '0'::jsonb),
                true
              ),
              '{zeshu_cash_redemption}',
              '0'::jsonb,
              true
            )
        where id = v_reservation.id;

        update public.reward_redemptions
        set status = 'RELEASED', released_at = now()
        where id = v_redemption.id;
        v_released := v_released + 1;
      end if;
    end loop;
  end loop;
  return v_released;
end;
$$;

revoke all on function public.get_my_reward_balance() from public;
revoke all on function public.get_my_reward_balance() from anon;
revoke all on function public.get_my_reward_balance() from authenticated;
grant execute on function public.get_my_reward_balance() to authenticated;

revoke all on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric) from public;
revoke all on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric) from anon;
revoke all on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric) from authenticated;
grant execute on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric) to service_role;

revoke all on function public.consume_zeshu_cash_redemption(uuid, uuid) from public;
revoke all on function public.consume_zeshu_cash_redemption(uuid, uuid) from anon;
revoke all on function public.consume_zeshu_cash_redemption(uuid, uuid) from authenticated;
grant execute on function public.consume_zeshu_cash_redemption(uuid, uuid) to service_role;

revoke all on function public.bind_zeshu_cash_redemption(uuid, text) from public;
revoke all on function public.bind_zeshu_cash_redemption(uuid, text) from anon;
revoke all on function public.bind_zeshu_cash_redemption(uuid, text) from authenticated;
grant execute on function public.bind_zeshu_cash_redemption(uuid, text) to service_role;

revoke all on function public.release_expired_zeshu_cash_redemptions() from public;
revoke all on function public.release_expired_zeshu_cash_redemptions() from anon;
revoke all on function public.release_expired_zeshu_cash_redemptions() from authenticated;
grant execute on function public.release_expired_zeshu_cash_redemptions() to service_role;
