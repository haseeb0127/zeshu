-- Additive correction for the existing live schema.
-- public.vendors is owned by owner_id; do not add a user_id column.
-- public.orders stores its JSON order lines in items; do not add a legacy duplicate field.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

alter table public.vendors enable row level security;
alter table public.orders enable row level security;

drop policy if exists "vendors read own profile" on public.vendors;
create policy "vendors read own profile" on public.vendors
  for select using (owner_id = auth.uid());

drop policy if exists "vendors read own orders" on public.orders;
create policy "vendors read own orders" on public.orders
  for select using (
    vendor_id in (select id from public.vendors where owner_id = auth.uid())
  );

drop policy if exists "vendors manage own order preparation" on public.orders;

create or replace function public.advance_vendor_order_status(
  p_order_id uuid,
  p_next_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  select o.status
  into current_status
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  where o.id = p_order_id
    and v.owner_id = auth.uid()
  for update of o;

  if current_status is null then
    raise exception 'vendor order not found';
  end if;

  if not (
    (current_status = 'PENDING' and p_next_status = 'CONFIRMED')
    or (current_status = 'CONFIRMED' and p_next_status = 'PREPARING')
    or (current_status = 'PREPARING' and p_next_status = 'READY_FOR_PICKUP')
  ) then
    raise exception 'invalid vendor status transition';
  end if;

  update public.orders
  set status = p_next_status
  where id = p_order_id;
end;
$$;

revoke all on function public.advance_vendor_order_status(uuid, text) from public;
grant execute on function public.advance_vendor_order_status(uuid, text) to authenticated;
