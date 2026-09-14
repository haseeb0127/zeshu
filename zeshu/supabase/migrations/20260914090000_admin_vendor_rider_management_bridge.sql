-- Additive admin-management bridge.
-- The existing "riders update own availability" policy deliberately remains during
-- this compatibility phase. Rider clients must switch to rider_set_availability()
-- and be runtime-tested before that direct UPDATE policy is removed.

alter table public.vendors
  add column if not exists admin_suspended boolean not null default false;

alter table public.riders
  add column if not exists admin_suspended boolean not null default false;

create or replace function public.admin_create_vendor(
  p_owner_id uuid,
  p_business_name text,
  p_address text,
  p_is_open boolean,
  p_category text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_rating numeric default null
)
returns public.vendors
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vendor public.vendors%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin access required';
  end if;

  if p_owner_id is null
     or p_is_open is null
     or p_business_name is null
     or length(btrim(p_business_name)) = 0
     or p_address is null
     or length(btrim(p_address)) = 0
     or (p_latitude is not null and (p_latitude < -90 or p_latitude > 90))
     or (p_longitude is not null and (p_longitude < -180 or p_longitude > 180))
     or (p_rating is not null and (p_rating < 0 or p_rating > 5)) then
    raise exception 'invalid vendor details';
  end if;

  if not exists (select 1 from auth.users where id = p_owner_id) then
    raise exception 'vendor owner user not found';
  end if;

  if exists (select 1 from public.vendors where owner_id = p_owner_id) then
    raise exception 'vendor already exists for owner';
  end if;

  insert into public.vendors (
    owner_id,
    business_name,
    category,
    address,
    latitude,
    longitude,
    is_open,
    rating,
    admin_suspended
  ) values (
    p_owner_id,
    btrim(p_business_name),
    nullif(btrim(p_category), ''),
    btrim(p_address),
    p_latitude,
    p_longitude,
    p_is_open,
    p_rating,
    false
  )
  returning * into v_vendor;

  return v_vendor;
exception
  when unique_violation then
    raise exception 'vendor already exists for owner';
end;
$$;

create or replace function public.admin_set_vendor_suspension(
  p_vendor_id uuid,
  p_suspended boolean
)
returns public.vendors
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vendor public.vendors%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin access required';
  end if;

  if p_vendor_id is null or p_suspended is null then
    raise exception 'invalid vendor suspension request';
  end if;

  select * into v_vendor
  from public.vendors
  where id = p_vendor_id
  for update;

  if not found then
    raise exception 'vendor not found';
  end if;

  update public.vendors
  set admin_suspended = p_suspended,
      is_open = case when p_suspended then false else is_open end
  where id = v_vendor.id
  returning * into v_vendor;

  return v_vendor;
end;
$$;

create or replace function public.set_vendor_store_status(
  p_is_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vendor public.vendors%rowtype;
begin
  if auth.uid() is null then
    raise exception 'vendor authentication required';
  end if;

  if p_is_open is null then
    raise exception 'invalid store status';
  end if;

  select * into v_vendor
  from public.vendors
  where owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'vendor profile not found';
  end if;

  if p_is_open and v_vendor.admin_suspended then
    raise exception 'vendor is administratively suspended';
  end if;

  update public.vendors
  set is_open = p_is_open
  where id = v_vendor.id;

  return true;
end;
$$;

create or replace function public.admin_create_rider(
  p_user_id uuid,
  p_full_name text,
  p_phone_number text,
  p_vehicle_number text default null,
  p_is_active boolean default true
)
returns public.riders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rider public.riders%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin access required';
  end if;

  if p_user_id is null
     or p_is_active is null
     or p_full_name is null
     or length(btrim(p_full_name)) = 0
     or p_phone_number is null
     or length(btrim(p_phone_number)) = 0 then
    raise exception 'invalid rider details';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'rider user not found';
  end if;

  if exists (select 1 from public.riders where user_id = p_user_id) then
    raise exception 'rider already exists for user';
  end if;

  insert into public.riders (
    user_id,
    full_name,
    phone_number,
    vehicle_number,
    is_active,
    admin_suspended
  ) values (
    p_user_id,
    btrim(p_full_name),
    btrim(p_phone_number),
    nullif(btrim(p_vehicle_number), ''),
    p_is_active,
    false
  )
  returning * into v_rider;

  return v_rider;
exception
  when unique_violation then
    raise exception 'rider already exists for user';
end;
$$;

create or replace function public.admin_set_rider_suspension(
  p_rider_id uuid,
  p_suspended boolean
)
returns public.riders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rider public.riders%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin access required';
  end if;

  if p_rider_id is null or p_suspended is null then
    raise exception 'invalid rider suspension request';
  end if;

  select * into v_rider
  from public.riders
  where id = p_rider_id
  for update;

  if not found then
    raise exception 'rider not found';
  end if;

  if p_suspended and exists (
    select 1
    from public.orders
    where (rider_id = v_rider.id or assigned_rider_id = v_rider.user_id)
      and status in ('READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY')
  ) then
    raise exception 'rider has an active assigned order';
  end if;

  update public.riders
  set admin_suspended = p_suspended,
      is_active = case when p_suspended then false else is_active end
  where id = v_rider.id
  returning * into v_rider;

  return v_rider;
end;
$$;

create or replace function public.rider_set_availability(
  p_is_active boolean
)
returns public.riders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rider public.riders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'rider authentication required';
  end if;

  if p_is_active is null then
    raise exception 'invalid rider availability';
  end if;

  select * into v_rider
  from public.riders
  where user_id = auth.uid()
  for update;

  if not found then
    raise exception 'rider profile not found';
  end if;

  if p_is_active and v_rider.admin_suspended then
    raise exception 'rider is administratively suspended';
  end if;

  update public.riders
  set is_active = p_is_active
  where id = v_rider.id
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke all on function public.admin_create_vendor(uuid, text, text, boolean, text, numeric, numeric, numeric) from public;
revoke all on function public.admin_set_vendor_suspension(uuid, boolean) from public;
revoke all on function public.set_vendor_store_status(boolean) from public;
revoke all on function public.admin_create_rider(uuid, text, text, text, boolean) from public;
revoke all on function public.admin_set_rider_suspension(uuid, boolean) from public;
revoke all on function public.rider_set_availability(boolean) from public;

grant execute on function public.admin_create_vendor(uuid, text, text, boolean, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.admin_set_vendor_suspension(uuid, boolean) to authenticated;
grant execute on function public.set_vendor_store_status(boolean) to authenticated;
grant execute on function public.admin_create_rider(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.admin_set_rider_suspension(uuid, boolean) to authenticated;
grant execute on function public.rider_set_availability(boolean) to authenticated;
