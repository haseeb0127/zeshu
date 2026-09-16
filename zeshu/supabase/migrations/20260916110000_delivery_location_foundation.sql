-- Delivery-location foundation. Review and deploy after the business-readiness
-- migration; this file is intentionally not executed by the application task.

alter table public.customer_addresses
  add column if not exists location_accuracy_meters numeric,
  add column if not exists location_source text;

alter table public.customer_addresses
  add constraint customer_addresses_location_accuracy_check
  check (location_accuracy_meters is null or location_accuracy_meters >= 0),
  add constraint customer_addresses_location_source_check
  check (location_source is null or location_source in ('DEVICE', 'MANUAL_PIN', 'LEGACY')),
  add constraint customer_addresses_coordinate_pair_check
  check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null)) not valid,
  add constraint customer_addresses_accuracy_coordinates_check
  check (location_accuracy_meters is null or (latitude is not null and longitude is not null)) not valid,
  add constraint customer_addresses_location_source_consistency_check
  check (location_source is null or location_source = 'LEGACY' or (latitude is not null and longitude is not null)) not valid;

alter table public.orders
  add column if not exists delivery_latitude numeric,
  add column if not exists delivery_longitude numeric,
  add column if not exists delivery_location_accuracy_meters numeric,
  add column if not exists delivery_location_source text;

alter table public.orders
  add constraint orders_delivery_latitude_check
  check (delivery_latitude is null or delivery_latitude between -90 and 90),
  add constraint orders_delivery_longitude_check
  check (delivery_longitude is null or delivery_longitude between -180 and 180),
  add constraint orders_delivery_accuracy_check
  check (delivery_location_accuracy_meters is null or delivery_location_accuracy_meters >= 0),
  add constraint orders_delivery_source_check
  check (delivery_location_source is null or delivery_location_source in ('DEVICE', 'MANUAL_PIN', 'LEGACY')),
  add constraint orders_delivery_coordinate_pair_check
  check ((delivery_latitude is null and delivery_longitude is null) or (delivery_latitude is not null and delivery_longitude is not null)) not valid,
  add constraint orders_delivery_accuracy_coordinates_check
  check (delivery_location_accuracy_meters is null or (delivery_latitude is not null and delivery_longitude is not null)) not valid,
  add constraint orders_delivery_source_consistency_check
  check (delivery_location_source is null or delivery_location_source = 'LEGACY' or (delivery_latitude is not null and delivery_longitude is not null)) not valid;

alter table public.riders
  add column if not exists current_location_accuracy_meters numeric,
  add column if not exists location_updated_at timestamptz;

alter table public.riders
  add constraint riders_location_accuracy_check
  check (current_location_accuracy_meters is null or current_location_accuracy_meters >= 0),
  add constraint riders_latitude_check
  check (current_latitude is null or current_latitude between -90 and 90) not valid,
  add constraint riders_longitude_check
  check (current_longitude is null or current_longitude between -180 and 180) not valid,
  add constraint riders_coordinate_pair_check
  check ((current_latitude is null and current_longitude is null) or (current_latitude is not null and current_longitude is not null)) not valid;

create or replace function public.customer_upsert_address_with_location(
  p_address_id uuid default null,
  p_label text default null,
  p_recipient_name text default null,
  p_phone text default null,
  p_address_line text default null,
  p_landmark text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_is_default boolean default false,
  p_location_accuracy_meters numeric default null,
  p_location_source text default null
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_address public.customer_addresses;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if (p_latitude is null) <> (p_longitude is null) then raise exception 'latitude and longitude must be provided together'; end if;
  if p_location_accuracy_meters is not null and (p_latitude is null or p_longitude is null) then raise exception 'location accuracy requires coordinates'; end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then raise exception 'invalid latitude'; end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then raise exception 'invalid longitude'; end if;
  if p_location_accuracy_meters is not null and p_location_accuracy_meters < 0 then raise exception 'invalid location accuracy'; end if;
  if p_location_source is not null and p_location_source not in ('DEVICE', 'MANUAL_PIN', 'LEGACY') then raise exception 'invalid location source'; end if;
  if p_location_source in ('DEVICE', 'MANUAL_PIN') and (p_latitude is null or p_longitude is null) then raise exception 'location source requires coordinates'; end if;
  v_address := public.customer_upsert_address(p_address_id, p_label, p_recipient_name, p_phone, p_address_line, p_landmark, p_city, p_state, p_postal_code, p_latitude, p_longitude, p_is_default);
  update public.customer_addresses
  set location_accuracy_meters = p_location_accuracy_meters,
      location_source = coalesce(p_location_source, case when p_latitude is not null and p_longitude is not null then 'MANUAL_PIN' else 'LEGACY' end),
      updated_at = now()
  where id = v_address.id and user_id = auth.uid()
  returning * into v_address;
  return v_address;
end;
$$;

revoke all on function public.customer_upsert_address(
  uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean
) from public;
revoke all on function public.customer_upsert_address(
  uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean
) from anon;
grant execute on function public.customer_upsert_address(
  uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean
) to authenticated;

revoke all on function public.customer_upsert_address_with_location(
  uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean, numeric, text
) from public;
revoke all on function public.customer_upsert_address_with_location(
  uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean, numeric, text
) from anon;
grant execute on function public.customer_upsert_address_with_location(
  uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean, numeric, text
) to authenticated;

create table if not exists public.inventory_reservation_location_snapshots (
  reservation_id uuid primary key references public.inventory_reservations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  accuracy_meters numeric null check (accuracy_meters is null or accuracy_meters >= 0),
  source text not null check (source in ('DEVICE', 'MANUAL_PIN', 'LEGACY')),
  created_at timestamptz not null default now()
);

alter table public.inventory_reservation_location_snapshots enable row level security;
revoke all on public.inventory_reservation_location_snapshots from public, anon, authenticated;
grant all on public.inventory_reservation_location_snapshots to service_role;
