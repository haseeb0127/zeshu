create table public.support_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whatsapp_transactional_enabled boolean not null default false,
  consented_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_notification_preferences_consent_check
    check (
      whatsapp_transactional_enabled = false
      or (
        consented_at is not null
        and revoked_at is null
      )
    )
);

create table public.support_notification_outbox (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  source_message_id uuid null references public.support_messages(id) on delete cascade,
  event_type text not null,
  provider text not null default 'META_WHATSAPP',
  status text not null default 'PENDING',
  attempts integer not null default 0,
  next_attempt_at timestamptz null,
  last_error text null,
  provider_message_id text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint support_notification_outbox_event_type_check
    check (event_type in ('SUPPORT_REPLY', 'SUPPORT_RESOLVED')),
  constraint support_notification_outbox_provider_check
    check (provider in ('META_WHATSAPP')),
  constraint support_notification_outbox_status_check
    check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  constraint support_notification_outbox_attempts_check
    check (attempts >= 0)
);

create index support_notification_outbox_status_attempts_idx
  on public.support_notification_outbox (status, next_attempt_at, created_at);

create index support_notification_outbox_conversation_idx
  on public.support_notification_outbox (conversation_id);

alter table public.support_notification_preferences enable row level security;
alter table public.support_notification_outbox enable row level security;

revoke all on table public.support_notification_preferences from public;
revoke all on table public.support_notification_preferences from anon;
revoke all on table public.support_notification_preferences from authenticated;

revoke all on table public.support_notification_outbox from public;
revoke all on table public.support_notification_outbox from anon;
revoke all on table public.support_notification_outbox from authenticated;

revoke all on table public.support_notification_preferences from service_role;
grant select, insert, update on table public.support_notification_preferences to service_role;

revoke all on table public.support_notification_outbox from service_role;
grant select, update on table public.support_notification_outbox to service_role;

create or replace function public.admin_reply_support_message(
  p_conversation_id uuid,
  p_admin_user_id uuid,
  p_message text
)
returns table(
  message_id uuid,
  conversation_id uuid,
  sender_role text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation public.support_conversations%rowtype;
  v_message public.support_messages%rowtype;
  v_body text := btrim(coalesce(p_message, ''));
begin
  if p_conversation_id is null or p_admin_user_id is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if length(v_body) not between 1 and 4000 then
    raise exception 'support reply must be between 1 and 4000 characters' using errcode = '22023';
  end if;

  select c.*
    into v_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = p_admin_user_id
      and ar.role = 'admin'
  ) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if v_conversation.status = 'RESOLVED' then
    raise exception 'conversation is resolved' using errcode = 'P0001';
  end if;

  insert into public.support_messages (conversation_id, sender_user_id, sender_role, body)
  values (p_conversation_id, p_admin_user_id, 'ADMIN', v_body)
  returning * into v_message;

  if exists (
    select 1
    from public.support_notification_preferences p
    where p.user_id = v_conversation.user_id
      and p.whatsapp_transactional_enabled = true
      and p.revoked_at is null
  ) then
    insert into public.support_notification_outbox (
      event_key,
      recipient_user_id,
      conversation_id,
      source_message_id,
      event_type,
      provider
    )
    values (
      'support_reply:' || v_message.id::text || ':meta_whatsapp',
      v_conversation.user_id,
      v_conversation.id,
      v_message.id,
      'SUPPORT_REPLY',
      'META_WHATSAPP'
    )
    on conflict (event_key) do nothing;
  end if;

  update public.support_conversations c
  set status = 'OPEN', updated_at = now(), resolved_at = null
  where c.id = p_conversation_id;

  return query
  select v_message.id, v_message.conversation_id, v_message.sender_role,
         v_message.body, v_message.created_at;
end;
$$;

create or replace function public.admin_resolve_support_conversation(
  p_conversation_id uuid,
  p_admin_user_id uuid
)
returns table(
  conversation_id uuid,
  status text,
  subject text,
  order_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation public.support_conversations%rowtype;
begin
  if p_conversation_id is null or p_admin_user_id is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  select c.*
    into v_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = p_admin_user_id
      and ar.role = 'admin'
  ) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  if v_conversation.status <> 'RESOLVED' then
    update public.support_conversations c
    set status = 'RESOLVED', resolved_at = now(), updated_at = now()
    where c.id = p_conversation_id
    returning c.* into v_conversation;

    if exists (
      select 1
      from public.support_notification_preferences p
      where p.user_id = v_conversation.user_id
        and p.whatsapp_transactional_enabled = true
        and p.revoked_at is null
    ) then
      insert into public.support_notification_outbox (
        event_key,
        recipient_user_id,
        conversation_id,
        source_message_id,
        event_type,
        provider
      )
      values (
        'support_resolved:' || v_conversation.id::text || ':meta_whatsapp',
        v_conversation.user_id,
        v_conversation.id,
        null,
        'SUPPORT_RESOLVED',
        'META_WHATSAPP'
      )
      on conflict (event_key) do nothing;
    end if;
  end if;

  return query
  select v_conversation.id, v_conversation.status, v_conversation.subject,
         v_conversation.order_id, v_conversation.created_at,
         v_conversation.updated_at, v_conversation.resolved_at;
end;
$$;

revoke all on function public.admin_reply_support_message(uuid, uuid, text) from public;
revoke all on function public.admin_reply_support_message(uuid, uuid, text) from anon;
revoke all on function public.admin_reply_support_message(uuid, uuid, text) from authenticated;
grant execute on function public.admin_reply_support_message(uuid, uuid, text) to service_role;

revoke all on function public.admin_resolve_support_conversation(uuid, uuid) from public;
revoke all on function public.admin_resolve_support_conversation(uuid, uuid) from anon;
revoke all on function public.admin_resolve_support_conversation(uuid, uuid) from authenticated;
grant execute on function public.admin_resolve_support_conversation(uuid, uuid) to service_role;
