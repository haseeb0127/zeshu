-- Remove the minimum merchandise subtotal for Zeshu Cash redemption.
-- The server remains authoritative for balance, caps, payable minimum, and
-- reservation pricing. This migration only replaces the reservation RPC.

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
  if p_user_id is null
     or p_reservation_id is null
     or p_requested_amount is null
     or p_requested_amount < 0
     or (
       p_requested_amount > 0
       and round(p_requested_amount, 2) < 0.01::numeric
     )
     or not exists (
       select 1
       from public.users u
       where u.id = p_user_id
     ) then
    raise exception 'invalid reward redemption request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text, 61129)
  );

  for v_existing in
    select *
    from public.reward_redemptions r
    where r.user_id = p_user_id
      and r.status = 'RESERVED'
      and r.expires_at <= now()
    order by r.id
    for update
  loop
    select *
    into v_reservation
    from public.inventory_reservations ir
    where ir.id = v_existing.reservation_id
    for update;

    if found and v_reservation.status = 'ACTIVE' then
      update public.inventory_reservations ir
      set expected_total_paid = pre_reward_total_paid,
          pricing_snapshot = jsonb_set(
            jsonb_set(
              pricing_snapshot,
              '{discount_total}',
              coalesce(
                pricing_snapshot -> 'base_discount_total',
                '0'::jsonb
              ),
              true
            ),
            '{zeshu_cash_redemption}',
            '0'::jsonb,
            true
          )
      where ir.id = v_reservation.id;

      update public.reward_redemptions rr
      set status = 'RELEASED',
          released_at = now()
      where rr.id = v_existing.id;
    end if;
  end loop;

  select *
  into v_reservation
  from public.inventory_reservations ir
  where ir.id = p_reservation_id
    for update;

  if not found
     or v_reservation.user_id is distinct from p_user_id
     or v_reservation.status not in ('ACTIVE', 'PAYMENT_PENDING')
     or v_reservation.expires_at <= now() then
    raise exception 'invalid reward redemption reservation';
  end if;

  select *
  into v_existing
  from public.reward_redemptions r
  where r.reservation_id = p_reservation_id
    for update;

  if found
     and v_existing.status = 'RESERVED'
     and v_existing.expires_at > now() then
    if v_reservation.status = 'PAYMENT_PENDING' then
      redemption_id := v_existing.id;
      approved_amount := v_existing.approved_amount;
      expected_total_paid := v_reservation.expected_total_paid;
      return next;
      return;
    end if;

    if p_requested_amount = 0 then
      update public.reward_redemptions rr
      set status = 'RELEASED',
          released_at = now()
      where rr.id = v_existing.id;

      update public.inventory_reservations ir
      set expected_total_paid = pre_reward_total_paid,
          pricing_snapshot = jsonb_set(
            jsonb_set(
              pricing_snapshot,
              '{discount_total}',
              coalesce(
                pricing_snapshot -> 'base_discount_total',
                '0'::jsonb
              ),
              true
            ),
            '{zeshu_cash_redemption}',
            '0'::jsonb,
            true
          )
      where ir.id = v_reservation.id;

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

  select coalesce(sum(l.amount), 0)
  into v_ledger_balance
  from public.customer_reward_ledger l
  where l.user_id = p_user_id;

  select coalesce(sum(r.approved_amount), 0)
  into v_reserved_balance
  from public.reward_redemptions r
  where r.user_id = p_user_id
    and r.status = 'RESERVED'
    and (v_existing.id is null or r.id <> v_existing.id);

  v_available := greatest(
    0::numeric,
    round(v_ledger_balance - v_reserved_balance, 2)
  );
  v_cap := least(
    20::numeric,
    round(v_reservation.merchandise_subtotal * 0.10, 2)
  );
  v_approved := least(
    v_available,
    round(p_requested_amount, 2),
    v_cap
  );
  v_approved := round(greatest(
    0,
    least(
      v_approved,
      round(v_reservation.pre_reward_total_paid - 1, 2)
    )
  ), 2);

  v_base_discount := coalesce(
    nullif(
      v_reservation.pricing_snapshot ->> 'base_discount_total',
      ''
    )::numeric,
    nullif(
      v_reservation.pricing_snapshot ->> 'discount_total',
      ''
    )::numeric,
    0
  );

  if v_approved = 0 then
    if v_existing.id is not null then
      update public.reward_redemptions rr
      set status = 'RELEASED',
          released_at = now()
      where rr.id = v_existing.id;
    end if;

    update public.inventory_reservations ir
    set expected_total_paid = pre_reward_total_paid,
        pricing_snapshot = jsonb_set(
          jsonb_set(
            pricing_snapshot,
            '{discount_total}',
            to_jsonb(v_base_discount),
            true
          ),
          '{zeshu_cash_redemption}',
          '0'::jsonb,
          true
        )
    where ir.id = v_reservation.id;

    redemption_id := null;
    approved_amount := 0;
    expected_total_paid := v_reservation.pre_reward_total_paid;
    return next;
    return;
  end if;

  if v_existing.id is not null then
    update public.reward_redemptions rr
    set requested_amount = p_requested_amount,
        approved_amount = v_approved,
        status = 'RESERVED',
        expires_at = v_reservation.expires_at,
        released_at = null
    where rr.id = v_existing.id;

    v_redemption_id := v_existing.id;
  else
    insert into public.reward_redemptions (
      user_id,
      reservation_id,
      requested_amount,
      approved_amount,
      status,
      expires_at
    )
    values (
      p_user_id,
      p_reservation_id,
      p_requested_amount,
      v_approved,
      'RESERVED',
      v_reservation.expires_at
    )
    returning id into v_redemption_id;
  end if;

  update public.inventory_reservations ir
  set expected_total_paid = pre_reward_total_paid - v_approved,
      pricing_snapshot = jsonb_set(
        jsonb_set(
          pricing_snapshot,
          '{discount_total}',
          to_jsonb(v_base_discount),
          true
        ),
        '{zeshu_cash_redemption}',
        to_jsonb(v_approved),
        true
      )
  where ir.id = v_reservation.id;

  redemption_id := v_redemption_id;
  approved_amount := v_approved;
  expected_total_paid :=
    v_reservation.pre_reward_total_paid - v_approved;

  return next;
end;
$$;

revoke all on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric)
  from public;
revoke all on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric)
  from anon;
revoke all on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric)
  from authenticated;
grant execute on function public.reserve_zeshu_cash_redemption(uuid, uuid, numeric)
  to service_role;
