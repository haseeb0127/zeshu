-- Internal WhatsApp worker claims. No provider request is made by this migration.
alter table public.support_notification_outbox
  add column claim_token uuid null,
  add column lease_expires_at timestamptz null,
  add column provider_request_started_at timestamptz null;

create index support_notification_outbox_expired_processing_idx
  on public.support_notification_outbox (lease_expires_at)
  where status = 'PROCESSING' and provider = 'META_WHATSAPP';

create function public.claim_support_whatsapp_notifications(
  p_batch_size integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  event_id uuid,
  event_key text,
  recipient_user_id uuid,
  conversation_id uuid,
  source_message_id uuid,
  event_type text,
  provider text,
  attempts integer,
  claim_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_batch_size is null or p_batch_size not between 1 and 25 then
    raise exception 'batch size must be between 1 and 25' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception 'lease seconds must be between 30 and 300' using errcode = '22023';
  end if;

  return query
  with eligible as (
    select o.event_id
    from public.support_notification_outbox o
    where o.provider = 'META_WHATSAPP'
      and o.attempts < 5
      and (
        (o.status = 'PENDING'
          and (o.next_attempt_at is null or o.next_attempt_at <= now()))
        or (o.status = 'FAILED'
          and o.next_attempt_at is not null
          and o.next_attempt_at <= now())
        or (o.status = 'PROCESSING'
          and o.lease_expires_at <= now()
          and o.provider_request_started_at is null)
      )
    order by o.created_at, o.event_id
    limit p_batch_size
    for update of o skip locked
  ), claimed as (
    update public.support_notification_outbox o
    set status = 'PROCESSING',
        attempts = o.attempts + 1,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        provider_request_started_at = null,
        next_attempt_at = null,
        updated_at = now()
    from eligible e
    where o.event_id = e.event_id
    returning o.event_id, o.event_key, o.recipient_user_id,
              o.conversation_id, o.source_message_id, o.event_type,
              o.provider, o.attempts, o.claim_token, o.lease_expires_at,
              o.created_at
  )
  select c.event_id, c.event_key, c.recipient_user_id, c.conversation_id,
         c.source_message_id, c.event_type, c.provider, c.attempts,
         c.claim_token, c.lease_expires_at, c.created_at
  from claimed c
  order by c.created_at, c.event_id;
end;
$$;

create function public.mark_support_whatsapp_request_started(
  p_event_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  update public.support_notification_outbox o
  set provider_request_started_at = now(),
      updated_at = now()
  where o.event_id = p_event_id
    and o.provider = 'META_WHATSAPP'
    and o.status = 'PROCESSING'
    and o.claim_token = p_claim_token
    and o.lease_expires_at > now()
    and o.provider_request_started_at is null;

  return found;
end;
$$;

create function public.complete_support_whatsapp_notification(
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

  if p_outcome = 'SENT' then
    update public.support_notification_outbox o
    set status = 'SENT',
        provider_message_id = p_provider_message_id,
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
  elsif p_outcome = 'FAILED' then
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

create function public.quarantine_expired_support_whatsapp_notifications()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_quarantined integer;
begin
  update public.support_notification_outbox o
  set status = 'FAILED',
      next_attempt_at = null,
      last_error = case
        when o.provider_request_started_at is not null then 'PROVIDER_OUTCOME_UNKNOWN'
        else 'MAX_ATTEMPTS_EXCEEDED'
      end,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where o.status = 'PROCESSING'
    and o.provider = 'META_WHATSAPP'
    and o.lease_expires_at <= now()
    and (
      o.provider_request_started_at is not null
      or (o.provider_request_started_at is null and o.attempts >= 5)
    );

  get diagnostics v_quarantined = row_count;
  return v_quarantined;
end;
$$;

revoke all on function public.claim_support_whatsapp_notifications(integer, integer) from public;
revoke all on function public.claim_support_whatsapp_notifications(integer, integer) from anon;
revoke all on function public.claim_support_whatsapp_notifications(integer, integer) from authenticated;
grant execute on function public.claim_support_whatsapp_notifications(integer, integer) to service_role;

revoke all on function public.mark_support_whatsapp_request_started(uuid, uuid) from public;
revoke all on function public.mark_support_whatsapp_request_started(uuid, uuid) from anon;
revoke all on function public.mark_support_whatsapp_request_started(uuid, uuid) from authenticated;
grant execute on function public.mark_support_whatsapp_request_started(uuid, uuid) to service_role;

revoke all on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) from anon;
revoke all on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) from authenticated;
grant execute on function public.complete_support_whatsapp_notification(uuid, uuid, text, text, text, timestamptz) to service_role;

revoke all on function public.quarantine_expired_support_whatsapp_notifications() from public;
revoke all on function public.quarantine_expired_support_whatsapp_notifications() from anon;
revoke all on function public.quarantine_expired_support_whatsapp_notifications() from authenticated;
grant execute on function public.quarantine_expired_support_whatsapp_notifications() to service_role;
