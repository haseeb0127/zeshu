create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  recipient_name text,
  phone text,
  address_line text not null,
  landmark text,
  city text not null,
  state text not null,
  postal_code text,
  latitude numeric,
  longitude numeric,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_label_check check (char_length(btrim(label)) between 1 and 40),
  constraint customer_addresses_address_line_check check (char_length(btrim(address_line)) between 1 and 240),
  constraint customer_addresses_city_check check (char_length(btrim(city)) between 1 and 80),
  constraint customer_addresses_state_check check (char_length(btrim(state)) between 1 and 80),
  constraint customer_addresses_recipient_name_check check (recipient_name is null or char_length(btrim(recipient_name)) <= 120),
  constraint customer_addresses_phone_check check (phone is null or char_length(btrim(phone)) between 7 and 20),
  constraint customer_addresses_landmark_check check (landmark is null or char_length(btrim(landmark)) <= 160),
  constraint customer_addresses_postal_code_check check (postal_code is null or char_length(btrim(postal_code)) between 3 and 20),
  constraint customer_addresses_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint customer_addresses_longitude_check check (longitude is null or longitude between -180 and 180)
);

create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id, created_at desc);
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses(user_id)
  where is_default = true;

alter table public.customer_addresses enable row level security;
drop policy if exists "customers read own addresses" on public.customer_addresses;
create policy "customers read own addresses"
  on public.customer_addresses for select to authenticated
  using (user_id = auth.uid());

create or replace function public.customer_upsert_address(
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
  p_is_default boolean default false
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_address public.customer_addresses;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 44117));
  if nullif(btrim(coalesce(p_label, '')), '') is null
     or nullif(btrim(coalesce(p_address_line, '')), '') is null
     or nullif(btrim(coalesce(p_city, '')), '') is null
     or nullif(btrim(coalesce(p_state, '')), '') is null then
    raise exception 'required address fields are missing';
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then raise exception 'invalid latitude'; end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then raise exception 'invalid longitude'; end if;

  if p_address_id is not null then
    select * into v_address from public.customer_addresses where id = p_address_id and user_id = v_user_id for update;
    if not found then raise exception 'address not found'; end if;
  end if;

  if p_is_default then
    update public.customer_addresses set is_default = false, updated_at = now()
    where user_id = v_user_id and (p_address_id is null or id <> p_address_id) and is_default = true;
  end if;

  if p_address_id is null then
    insert into public.customer_addresses (
      user_id, label, recipient_name, phone, address_line, landmark, city, state,
      postal_code, latitude, longitude, is_default, updated_at
    ) values (
      v_user_id, btrim(p_label), nullif(btrim(p_recipient_name), ''), nullif(btrim(p_phone), ''),
      btrim(p_address_line), nullif(btrim(p_landmark), ''), btrim(p_city), btrim(p_state),
      nullif(btrim(p_postal_code), ''), p_latitude, p_longitude, p_is_default, now()
    ) returning * into v_address;
  else
    update public.customer_addresses set
      label = btrim(p_label), recipient_name = nullif(btrim(p_recipient_name), ''), phone = nullif(btrim(p_phone), ''),
      address_line = btrim(p_address_line), landmark = nullif(btrim(p_landmark), ''), city = btrim(p_city), state = btrim(p_state),
      postal_code = nullif(btrim(p_postal_code), ''), latitude = p_latitude, longitude = p_longitude,
      is_default = p_is_default, updated_at = now()
    where id = p_address_id and user_id = v_user_id
    returning * into v_address;
  end if;
  return v_address;
end;
$$;

create or replace function public.customer_set_default_address(p_address_id uuid)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_address public.customer_addresses;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 44117));
  select * into v_address
  from public.customer_addresses
  where id = p_address_id and user_id = v_user_id
  for update;
  if not found then raise exception 'address not found'; end if;
  update public.customer_addresses set is_default = false, updated_at = now()
    where user_id = v_user_id and is_default = true and id <> p_address_id;
  update public.customer_addresses set is_default = true, updated_at = now()
    where id = p_address_id and user_id = v_user_id returning * into v_address;
  return v_address;
end;
$$;

create or replace function public.customer_delete_address(p_address_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_deleted boolean; v_rows integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 44117));
  delete from public.customer_addresses where id = p_address_id and user_id = v_user_id;
  get diagnostics v_rows = row_count;
  v_deleted := v_rows > 0;
  return v_deleted;
end;
$$;

revoke all on function public.customer_upsert_address(uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean) from public;
revoke all on function public.customer_set_default_address(uuid) from public;
revoke all on function public.customer_delete_address(uuid) from public;
grant execute on function public.customer_upsert_address(uuid, text, text, text, text, text, text, text, text, numeric, numeric, boolean) to authenticated;
grant execute on function public.customer_set_default_address(uuid) to authenticated;
grant execute on function public.customer_delete_address(uuid) to authenticated;
