-- Expose the rider GPS timestamp without repurposing rider_location_feed.updated_at.
-- This migration is intentionally unexecuted by the application task.

alter table public.rider_location_feed
  add column if not exists location_updated_at timestamptz;

update public.rider_location_feed as feed
set location_updated_at = rider.location_updated_at
from public.riders as rider
where feed.rider_id = rider.id
  and feed.location_updated_at is distinct from rider.location_updated_at;

create or replace function public.sync_rider_location_feed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.rider_location_feed (
    rider_id,
    full_name,
    is_active,
    current_latitude,
    current_longitude,
    location_updated_at,
    updated_at
  )
  values (
    new.id,
    new.full_name,
    new.is_active,
    new.current_latitude,
    new.current_longitude,
    new.location_updated_at,
    now()
  )
  on conflict (rider_id) do update
  set full_name = excluded.full_name,
      is_active = excluded.is_active,
      current_latitude = excluded.current_latitude,
      current_longitude = excluded.current_longitude,
      location_updated_at = excluded.location_updated_at,
      updated_at = now();

  return new;
end;
$$;

-- Keep the existing trigger's insert/update behavior and add location_updated_at
-- to its UPDATE OF column list without changing RLS, policies, or grants.
do $$
declare
  v_trigger_name text;
begin
  select t.tgname
  into v_trigger_name
  from pg_trigger as t
  where t.tgrelid = 'public.riders'::regclass
    and not t.tgisinternal
    and t.tgfoid = 'public.sync_rider_location_feed()'::regprocedure
  order by t.oid
  limit 1;

  if v_trigger_name is null then
    raise exception 'sync_rider_location_feed trigger not found on public.riders';
  end if;

  execute format('drop trigger %I on public.riders', v_trigger_name);
  execute format(
    'create trigger %I after insert or update of full_name, is_active, current_latitude, current_longitude, location_updated_at on public.riders for each row execute function public.sync_rider_location_feed()',
    v_trigger_name
  );
end;
$$;
