-- Run this migration in the Supabase SQL Editor before deploying the matching app changes.
-- It is additive: it preserves existing rows and keeps assigned_rider_id for compatibility.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.orders add column if not exists rider_id uuid references public.riders(id);
alter table public.orders add column if not exists assigned_rider_id uuid references auth.users(id);
alter table public.orders add column if not exists vendor_id uuid references public.vendors(id);
alter table public.riders add column if not exists is_active boolean not null default false;

-- Backfill the canonical rider relation where older assignments used the auth user id.
update public.orders o
set rider_id = r.id
from public.riders r
where o.rider_id is null and o.assigned_rider_id = r.user_id;

update public.orders
set status = case upper(coalesce(status, 'PENDING'))
  when 'PENDING' then 'PENDING'
  when 'CONFIRMED' then 'CONFIRMED'
  when 'PREPARING' then 'PREPARING'
  when 'READY_FOR_PICKUP' then 'READY_FOR_PICKUP'
  when 'PICKED_UP' then 'PICKED_UP'
  when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY'
  when 'DELIVERED' then 'DELIVERED'
  when 'PICKED_UP' then 'PICKED_UP'
  else 'PENDING'
end;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP',
  'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
));

create index if not exists orders_rider_id_idx on public.orders (rider_id);
create index if not exists orders_vendor_id_idx on public.orders (vendor_id);

alter table public.orders enable row level security;
alter table public.wallets enable row level security;
alter table public.riders enable row level security;
alter table public.admin_roles enable row level security;
alter table public.vendors enable row level security;

drop policy if exists "admins read own role" on public.admin_roles;
create policy "admins read own role" on public.admin_roles for select using (user_id = auth.uid());

drop policy if exists "vendors read own profile" on public.vendors;
create policy "vendors read own profile" on public.vendors for select using (owner_id = auth.uid());
drop policy if exists "vendors read own orders" on public.orders;
create policy "vendors read own orders" on public.orders for select using (vendor_id in (select id from public.vendors where owner_id = auth.uid()));
drop policy if exists "vendors manage own order preparation" on public.orders;
create policy "vendors manage own order preparation" on public.orders for update
  using (vendor_id in (select id from public.vendors where owner_id = auth.uid()))
  with check (vendor_id in (select id from public.vendors where owner_id = auth.uid()) and status in ('CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'));

drop policy if exists "customers read their orders" on public.orders;
create policy "customers read their orders" on public.orders for select
  using (user_id = auth.uid());
drop policy if exists "riders read assigned orders" on public.orders;
create policy "riders read assigned orders" on public.orders for select
  using (rider_id in (select id from public.riders where user_id = auth.uid()));
drop policy if exists "riders deliver assigned orders" on public.orders;
create policy "riders deliver assigned orders" on public.orders for update
  using (rider_id in (select id from public.riders where user_id = auth.uid()))
  with check (rider_id in (select id from public.riders where user_id = auth.uid()) and status = 'DELIVERED');
drop policy if exists "admins manage orders" on public.orders;
create policy "admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "riders read own profile" on public.riders;
create policy "riders read own profile" on public.riders for select using (user_id = auth.uid());
drop policy if exists "riders update own availability" on public.riders;
create policy "riders update own availability" on public.riders for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admins read riders" on public.riders;
create policy "admins read riders" on public.riders for select using (public.is_admin());

drop policy if exists "users read own wallet" on public.wallets;
create policy "users read own wallet" on public.wallets for select using (user_id = auth.uid());
-- No browser wallet write policy: all balance mutations must go through trusted server/database code.

create or replace function public.debit_zeshu_coins(amount_to_debit numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare remaining numeric;
begin
  if amount_to_debit <= 0 then raise exception 'amount must be positive'; end if;
  update public.wallets
  set zeshu_coins = zeshu_coins - amount_to_debit
  where user_id = auth.uid() and zeshu_coins >= amount_to_debit
  returning zeshu_coins into remaining;
  if remaining is null then raise exception 'insufficient coins'; end if;
  return remaining;
end;
$$;
