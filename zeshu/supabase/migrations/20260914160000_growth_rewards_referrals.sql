-- Internal Zeshu Cash ledger, delivered-order rewards, milestones and referrals.

create table if not exists public.customer_reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in (
    'ORDER_REWARD', 'MONTHLY_3RD_ORDER_BONUS', 'MONTHLY_5TH_ORDER_BONUS',
    'REFERRAL_REFERRER_BONUS', 'REFERRAL_NEW_CUSTOMER_BONUS'
  )),
  amount numeric(10,2) not null check (amount > 0),
  reference_key text not null unique,
  description text null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code = upper(code) and char_length(code) between 6 and 32),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  referral_code text not null references public.customer_referral_codes(code),
  created_at timestamptz not null default now(),
  qualified_at timestamptz null,
  rewarded_at timestamptz null,
  check (referrer_user_id <> referred_user_id)
);

create index if not exists customer_reward_ledger_user_created_idx
  on public.customer_reward_ledger(user_id, created_at desc);
create index if not exists customer_reward_ledger_order_idx
  on public.customer_reward_ledger(order_id);
create index if not exists customer_referrals_referrer_idx
  on public.customer_referrals(referrer_user_id, created_at desc);

alter table public.customer_reward_ledger enable row level security;
alter table public.customer_referral_codes enable row level security;
alter table public.customer_referrals enable row level security;

drop policy if exists "customers read own reward ledger" on public.customer_reward_ledger;
create policy "customers read own reward ledger"
  on public.customer_reward_ledger for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "customers read own referral code" on public.customer_referral_codes;
create policy "customers read own referral code"
  on public.customer_referral_codes for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "customers read own referrals" on public.customer_referrals;
create policy "customers read own referrals"
  on public.customer_referrals for select to authenticated
  using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

create or replace function public.get_my_reward_balance()
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.customer_reward_ledger
  where user_id = auth.uid();
$$;

create or replace function public.get_my_reward_history(p_limit integer default 50)
returns table(event_type text, amount numeric, description text, order_id uuid, created_at timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select l.event_type, l.amount, l.description, l.order_id, l.created_at
  from public.customer_reward_ledger l
  where l.user_id = auth.uid()
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.get_or_create_my_referral_code()
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  select code into v_code from public.customer_referral_codes where user_id = v_user_id;
  if v_code is not null then return v_code; end if;
  loop
    v_code := 'ZESHU' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.customer_referral_codes(user_id, code)
      values (v_user_id, v_code);
      return v_code;
    exception when unique_violation then
      select code into v_code
      from public.customer_referral_codes
      where user_id = v_user_id;
      if v_code is not null then return v_code; end if;
    end;
  end loop;
end;
$$;

create or replace function public.apply_referral_code(p_code text)
returns public.customer_referrals
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_referrer uuid;
  v_result public.customer_referrals;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.customer_referrals where referred_user_id = v_user_id) then raise exception 'referral already applied'; end if;
  if exists (select 1 from public.orders where user_id = v_user_id and status = 'DELIVERED') then raise exception 'referral is no longer eligible'; end if;
  select user_id into v_referrer from public.customer_referral_codes where code = upper(btrim(p_code));
  if v_referrer is null then raise exception 'referral code not found'; end if;
  if v_referrer = v_user_id then raise exception 'self referral is not allowed'; end if;
  insert into public.customer_referrals(referrer_user_id, referred_user_id, referral_code)
    values (v_referrer, v_user_id, upper(btrim(p_code))) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.credit_delivered_order_rewards()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_reward numeric(10,2) := 0;
  v_month_start timestamptz := date_trunc('month', coalesce(new.created_at, now()));
  v_month_end timestamptz := v_month_start + interval '1 month';
  v_delivered_count integer;
  v_merchandise_subtotal numeric(12,2) := 0;
  v_referral public.customer_referrals;
begin
  if new.status <> 'DELIVERED' or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then return new; end if;

  -- Serialize reward counting for one customer. This namespace is distinct
  -- from inventory (9173) and saved-address (44117) locks.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 61129));

  -- The order item snapshot is server-generated during reservation finalization.
  -- Use merchandise prices only; fees, tips, donations and pass charges are not
  -- eligible for reward tiers.
  select coalesce(sum(
    coalesce((entry -> 'item' ->> 'price')::numeric, 0)
    * coalesce((entry ->> 'qty')::numeric, 0)
  ), 0)
  into v_merchandise_subtotal
  from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) as item(entry);

  v_reward := case
    when v_merchandise_subtotal >= 500 then 5
    when v_merchandise_subtotal >= 299 then 3
    when v_merchandise_subtotal >= 199 then 2
    when v_merchandise_subtotal >= 99 then 1
    else 0
  end;
  if v_reward > 0 then
    insert into public.customer_reward_ledger(user_id, order_id, event_type, amount, reference_key, description)
      values (new.user_id, new.id, 'ORDER_REWARD', v_reward, 'order_reward:' || new.id, 'Delivered order reward')
      on conflict (reference_key) do nothing;
  end if;

  select count(*) into v_delivered_count from public.orders
  where user_id = new.user_id and status = 'DELIVERED' and created_at >= v_month_start and created_at < v_month_end;
  if v_delivered_count = 3 then
    insert into public.customer_reward_ledger(user_id, event_type, amount, reference_key, description)
      values (new.user_id, 'MONTHLY_3RD_ORDER_BONUS', 5, 'monthly_3:' || new.user_id || ':' || to_char(v_month_start, 'YYYY-MM'), '3rd delivered order bonus')
      on conflict (reference_key) do nothing;
  elsif v_delivered_count = 5 then
    insert into public.customer_reward_ledger(user_id, event_type, amount, reference_key, description)
      values (new.user_id, 'MONTHLY_5TH_ORDER_BONUS', 10, 'monthly_5:' || new.user_id || ':' || to_char(v_month_start, 'YYYY-MM'), '5th delivered order bonus')
      on conflict (reference_key) do nothing;
  end if;

  select * into v_referral from public.customer_referrals where referred_user_id = new.user_id and qualified_at is null for update;
  if found and v_delivered_count = 1 then
    update public.customer_referrals set qualified_at = now() where id = v_referral.id;
    insert into public.customer_reward_ledger(user_id, event_type, amount, reference_key, description)
      values (v_referral.referrer_user_id, 'REFERRAL_REFERRER_BONUS', 20, 'referral_referrer:' || v_referral.id, 'Referral first delivered order reward') on conflict (reference_key) do nothing;
    insert into public.customer_reward_ledger(user_id, event_type, amount, reference_key, description)
      values (v_referral.referred_user_id, 'REFERRAL_NEW_CUSTOMER_BONUS', 10, 'referral_referred:' || v_referral.id, 'Welcome referral reward') on conflict (reference_key) do nothing;
    update public.customer_referrals set rewarded_at = now() where id = v_referral.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_delivered_reward_trigger on public.orders;
create trigger orders_delivered_reward_trigger
after insert or update of status on public.orders
for each row execute function public.credit_delivered_order_rewards();

revoke all on function public.get_my_reward_balance() from public;
revoke all on function public.get_my_reward_balance() from anon;
revoke all on function public.get_my_reward_balance() from authenticated;
revoke all on function public.get_my_reward_history(integer) from public;
revoke all on function public.get_my_reward_history(integer) from anon;
revoke all on function public.get_my_reward_history(integer) from authenticated;
revoke all on function public.get_or_create_my_referral_code() from public;
revoke all on function public.get_or_create_my_referral_code() from anon;
revoke all on function public.get_or_create_my_referral_code() from authenticated;
revoke all on function public.apply_referral_code(text) from public;
revoke all on function public.apply_referral_code(text) from anon;
revoke all on function public.apply_referral_code(text) from authenticated;
revoke all on function public.credit_delivered_order_rewards() from public;
revoke all on function public.credit_delivered_order_rewards() from anon;
revoke all on function public.credit_delivered_order_rewards() from authenticated;
grant execute on function public.get_my_reward_balance() to authenticated;
grant execute on function public.get_my_reward_history(integer) to authenticated;
grant execute on function public.get_or_create_my_referral_code() to authenticated;
grant execute on function public.apply_referral_code(text) to authenticated;
