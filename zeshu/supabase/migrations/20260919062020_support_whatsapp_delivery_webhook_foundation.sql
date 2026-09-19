-- Meta API acceptance remains separate from provider delivery lifecycle state.
alter table public.support_notification_outbox
  add column provider_status text null,
  add column provider_status_at timestamptz null,
  add constraint support_notification_outbox_provider_status_check
    check (
      provider_status is null
      or provider_status in ('SENT', 'DELIVERED', 'READ', 'FAILED')
    ),
  add constraint support_notification_outbox_provider_status_timestamp_check
    check ((provider_status is null) = (provider_status_at is null));

comment on column public.support_notification_outbox.status is
  'Worker lifecycle state. SENT means the Meta API accepted the send request; it does not mean delivered or read.';

comment on column public.support_notification_outbox.provider_status is
  'Separate Meta delivery lifecycle state derived from durable delivery events.';

-- Fail loudly rather than silently accepting unsafe pre-existing provider IDs.
do $$
begin
  if exists (
    select 1
    from public.support_notification_outbox o
    where o.provider = 'META_WHATSAPP'
      and o.provider_message_id is not null
      and btrim(o.provider_message_id) = ''
  ) then
    raise exception 'blank META_WHATSAPP provider message id exists';
  end if;

  if exists (
    select 1
    from public.support_notification_outbox o
    where o.provider = 'META_WHATSAPP'
      and o.provider_message_id is not null
    group by o.provider_message_id
    having count(*) > 1
  ) then
    raise exception 'duplicate META_WHATSAPP provider message id exists';
  end if;
end;
$$;

create unique index support_notification_outbox_meta_provider_message_id_uidx
  on public.support_notification_outbox (provider_message_id)
  where provider = 'META_WHATSAPP'
    and provider_message_id is not null;

-- Durable inbox prevents a webhook arriving before sender binding from being lost.
create table public.support_whatsapp_delivery_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider text not null default 'META_WHATSAPP',
  provider_message_id text not null,
  provider_status text not null,
  provider_timestamp timestamptz not null,
  provider_error_code text null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  constraint support_whatsapp_delivery_events_event_key_check
    check (event_key ~ '^[0-9a-f]{64}$'),
  constraint support_whatsapp_delivery_events_provider_check
    check (provider = 'META_WHATSAPP'),
  constraint support_whatsapp_delivery_events_provider_message_id_check
    check (
      provider_message_id = btrim(provider_message_id)
      and length(provider_message_id) between 1 and 512
    ),
  constraint support_whatsapp_delivery_events_provider_status_check
    check (provider_status in ('SENT', 'DELIVERED', 'READ', 'FAILED')),
  constraint support_whatsapp_delivery_events_provider_timestamp_check
    check (
      provider_timestamp >= timestamptz '2000-01-01 00:00:00+00'
      and provider_timestamp < timestamptz '2100-01-01 00:00:00+00'
    ),
  constraint support_whatsapp_delivery_events_provider_error_code_check
    check (
      provider_error_code is null
      or (
        provider_status = 'FAILED'
        and provider_error_code ~ '^[0-9]{1,20}$'
      )
    )
);

comment on table public.support_whatsapp_delivery_events is
  'Server-only durable Meta delivery event inbox; stores no phone, support body, or raw webhook payload.';

create index support_whatsapp_delivery_events_unprocessed_message_idx
  on public.support_whatsapp_delivery_events (provider_message_id, provider_timestamp, id)
  where processed_at is null;

alter table public.support_whatsapp_delivery_events enable row level security;

revoke all on table public.support_whatsapp_delivery_events from public;
revoke all on table public.support_whatsapp_delivery_events from anon;
revoke all on table public.support_whatsapp_delivery_events from authenticated;
revoke all on table public.support_whatsapp_delivery_events from service_role;
grant select, insert, update on table public.support_whatsapp_delivery_events to service_role;

create function public.reconcile_support_whatsapp_delivery_events(
  p_provider_message_id text
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_provider_message_id text;
  v_outbox_event_id uuid;
  v_provider_status text;
  v_provider_status_at timestamptz;
  v_processed integer;
begin
  v_provider_message_id := btrim(p_provider_message_id);

  if p_provider_message_id is null
     or v_provider_message_id = ''
     or length(v_provider_message_id) > 512 then
    raise exception 'invalid provider message id' using errcode = '22023';
  end if;

  -- Both sender completion and webhook ingestion use this namespaced lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'support_whatsapp_delivery:' || v_provider_message_id,
      0
    )
  );

  select o.event_id
  into v_outbox_event_id
  from public.support_notification_outbox o
  where o.provider = 'META_WHATSAPP'
    and o.provider_message_id = v_provider_message_id
  for update of o;

  if not found then
    return 0;
  end if;

  select e.provider_status, e.provider_timestamp
  into v_provider_status, v_provider_status_at
  from public.support_whatsapp_delivery_events e
  where e.provider = 'META_WHATSAPP'
    and e.provider_message_id = v_provider_message_id
  order by
    case e.provider_status
      when 'READ' then 3
      when 'DELIVERED' then 2
      else 1
    end desc,
    e.provider_timestamp desc,
    case e.provider_status
      when 'FAILED' then 2
      when 'SENT' then 1
      else 0
    end desc,
    e.id desc
  limit 1;

  if found then
    update public.support_notification_outbox o
    set provider_status = v_provider_status,
        provider_status_at = v_provider_status_at,
        updated_at = now()
    where o.event_id = v_outbox_event_id
      and o.provider = 'META_WHATSAPP'
      and (
        o.provider_status is distinct from v_provider_status
        or o.provider_status_at is distinct from v_provider_status_at
      );
  end if;

  update public.support_whatsapp_delivery_events e
  set processed_at = now()
  where e.provider = 'META_WHATSAPP'
    and e.provider_message_id = v_provider_message_id
    and e.processed_at is null;

  get diagnostics v_processed = row_count;
  return v_processed;
end;
$$;

create function public.ingest_support_whatsapp_delivery_event(
  p_provider_message_id text,
  p_provider_status text,
  p_provider_timestamp_epoch bigint,
  p_provider_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_provider_message_id text;
  v_provider_status text;
  v_provider_timestamp timestamptz;
  v_event_key text;
begin
  v_provider_message_id := btrim(p_provider_message_id);
  v_provider_status := upper(btrim(p_provider_status));

  if p_provider_message_id is null
     or v_provider_message_id = ''
     or length(v_provider_message_id) > 512 then
    raise exception 'invalid provider message id' using errcode = '22023';
  end if;

  if p_provider_status is null
     or v_provider_status not in ('SENT', 'DELIVERED', 'READ', 'FAILED') then
    raise exception 'invalid provider status' using errcode = '22023';
  end if;

  if p_provider_timestamp_epoch is null
     or p_provider_timestamp_epoch < 946684800
     or p_provider_timestamp_epoch >= 4102444800 then
    raise exception 'invalid provider timestamp' using errcode = '22023';
  end if;

  if p_provider_error_code is not null
     and (
       v_provider_status <> 'FAILED'
       or length(p_provider_error_code) > 20
       or p_provider_error_code !~ '^[0-9]+$'
     ) then
    raise exception 'invalid provider error code' using errcode = '22023';
  end if;

  v_provider_timestamp := pg_catalog.to_timestamp(p_provider_timestamp_epoch::double precision);
  v_event_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'META_WHATSAPP',
          v_provider_message_id,
          v_provider_status,
          p_provider_timestamp_epoch
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Lock before event insert to close the sender/webhook double-miss race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'support_whatsapp_delivery:' || v_provider_message_id,
      0
    )
  );

  insert into public.support_whatsapp_delivery_events (
    event_key,
    provider,
    provider_message_id,
    provider_status,
    provider_timestamp,
    provider_error_code
  )
  values (
    v_event_key,
    'META_WHATSAPP',
    v_provider_message_id,
    v_provider_status,
    v_provider_timestamp,
    p_provider_error_code
  )
  on conflict (event_key) do nothing;

  perform public.reconcile_support_whatsapp_delivery_events(v_provider_message_id);
  return true;
end;
$$;

create or replace function public.complete_support_whatsapp_notification(
  p_event_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_last_error text default null,
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_attempts integer;
  v_provider_message_id text;
begin
  if p_outcome is null or p_outcome not in ('SENT', 'FAILED', 'CANCELLED') then
    raise exception 'invalid notification outcome' using errcode = '22023';
  end if;
  if p_last_error is not null
     and (length(p_last_error) > 128 or p_last_error !~ '^[A-Z][A-Z0-9_]{0,127}$') then
    raise exception 'last error must be a short safe code' using errcode = '22023';
  end if;
  if p_outcome = 'SENT'
     and nullif(btrim(p_provider_message_id), '') is null then
    raise exception 'provider message id is required' using errcode = '22023';
  end if;
  if p_outcome = 'FAILED' and p_last_error is null then
    raise exception 'failure code is required' using errcode = '22023';
  end if;

  if p_outcome = 'SENT' then
    v_provider_message_id := btrim(p_provider_message_id);

    if length(v_provider_message_id) > 512 then
      raise exception 'invalid provider message id' using errcode = '22023';
    end if;

    -- The provider-ID lock is always acquired before the claimed outbox row lock.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'support_whatsapp_delivery:' || v_provider_message_id,
        0
      )
    );

    select o.attempts into v_attempts
    from public.support_notification_outbox o
    where o.event_id = p_event_id
      and o.provider = 'META_WHATSAPP'
      and o.status = 'PROCESSING'
      and o.claim_token = p_claim_token
    for update;

    if not found then
      return false;
    end if;

    update public.support_notification_outbox o
    set status = 'SENT',
        provider_message_id = v_provider_message_id,
        sent_at = now(),
        last_error = null,
        next_attempt_at = null,
        claim_token = null,
        lease_expires_at = null,
        updated_at = now()
    where o.event_id = p_event_id
      and o.provider = 'META_WHATSAPP'
      and o.status = 'PROCESSING'
      and o.claim_token = p_claim_token;

    if not found then
      return false;
    end if;

    perform public.reconcile_support_whatsapp_delivery_events(v_provider_message_id);
    return true;
  end if;

  select o.attempts into v_attempts
  from public.support_notification_outbox o
  where o.event_id = p_event_id
    and o.provider = 'META_WHATSAPP'
    and o.status = 'PROCESSING'
    and o.claim_token = p_claim_token
  for update;

  if not found then
    return false;
  end if;

  if p_outcome = 'FAILED' then
    if p_next_attempt_at is not null
       and v_attempts < 5
       and p_next_attempt_at <= now() then
      raise exception 'next attempt must be in the future' using errcode = '22023';
    end if;

    update public.support_notification_outbox o
    set status = 'FAILED',
        next_attempt_at = case
          when v_attempts < 5 then p_next_attempt_at
          else null
        end,
        last_error = p_last_error,
        provider_message_id = null,
        claim_token = null,
        lease_expires_at = null,
        updated_at = now()
    where o.event_id = p_event_id
      and o.provider = 'META_WHATSAPP'
      and o.status = 'PROCESSING'
      and o.claim_token = p_claim_token;
  else
    update public.support_notification_outbox o
    set status = 'CANCELLED',
        next_attempt_at = null,
        last_error = p_last_error,
        provider_message_id = null,
        claim_token = null,
        lease_expires_at = null,
        updated_at = now()
    where o.event_id = p_event_id
      and o.provider = 'META_WHATSAPP'
      and o.status = 'PROCESSING'
      and o.claim_token = p_claim_token;
  end if;

  return found;
end;
$$;

revoke all on function public.ingest_support_whatsapp_delivery_event(text, text, bigint, text) from public;
revoke all on function public.ingest_support_whatsapp_delivery_event(text, text, bigint, text) from anon;
revoke all on function public.ingest_support_whatsapp_delivery_event(text, text, bigint, text) from authenticated;
grant execute on function public.ingest_support_whatsapp_delivery_event(text, text, bigint, text) to service_role;

revoke all on function public.reconcile_support_whatsapp_delivery_events(text) from public;
revoke all on function public.reconcile_support_whatsapp_delivery_events(text) from anon;
revoke all on function public.reconcile_support_whatsapp_delivery_events(text) from authenticated;
grant execute on function public.reconcile_support_whatsapp_delivery_events(text) to service_role;

revoke all on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) from anon;
revoke all on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) from authenticated;
grant execute on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) to service_role;
