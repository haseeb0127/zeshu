-- Atomic support state changes. Apply separately after reviewing; this file is
-- intentionally not executed by the application task.

create or replace function public.customer_send_support_message(
  p_conversation_id uuid,
  p_user_id uuid,
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
  if p_conversation_id is null or p_user_id is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if length(v_body) not between 1 and 4000 then
    raise exception 'support message must be between 1 and 4000 characters' using errcode = '22023';
  end if;

  select c.*
    into v_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;

  if not found or v_conversation.user_id <> p_user_id then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if v_conversation.status = 'RESOLVED' then
    raise exception 'conversation is resolved' using errcode = 'P0001';
  end if;

  insert into public.support_messages (conversation_id, sender_user_id, sender_role, body)
  values (p_conversation_id, p_user_id, 'CUSTOMER', v_body)
  returning * into v_message;

  update public.support_conversations c
  set status = 'OPEN', updated_at = now()
  where c.id = p_conversation_id;

  return query
  select v_message.id, v_message.conversation_id, v_message.sender_role,
         v_message.body, v_message.created_at;
end;
$$;

create or replace function public.customer_escalate_support_conversation(
  p_conversation_id uuid,
  p_user_id uuid
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
  if p_conversation_id is null or p_user_id is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  select c.*
    into v_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;

  if not found or v_conversation.user_id <> p_user_id then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if v_conversation.status = 'RESOLVED' then
    raise exception 'conversation is resolved' using errcode = 'P0001';
  end if;

  if v_conversation.status <> 'WAITING' then
    update public.support_conversations c
    set status = 'WAITING', updated_at = now()
    where c.id = p_conversation_id
    returning c.* into v_conversation;
  end if;

  return query
  select v_conversation.id, v_conversation.status, v_conversation.subject,
         v_conversation.order_id, v_conversation.created_at,
         v_conversation.updated_at, v_conversation.resolved_at;
end;
$$;

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
  end if;

  return query
  select v_conversation.id, v_conversation.status, v_conversation.subject,
         v_conversation.order_id, v_conversation.created_at,
         v_conversation.updated_at, v_conversation.resolved_at;
end;
$$;

revoke all on function public.customer_send_support_message(uuid, uuid, text) from public;
revoke all on function public.customer_send_support_message(uuid, uuid, text) from anon;
revoke all on function public.customer_send_support_message(uuid, uuid, text) from authenticated;
grant execute on function public.customer_send_support_message(uuid, uuid, text) to service_role;

revoke all on function public.customer_escalate_support_conversation(uuid, uuid) from public;
revoke all on function public.customer_escalate_support_conversation(uuid, uuid) from anon;
revoke all on function public.customer_escalate_support_conversation(uuid, uuid) from authenticated;
grant execute on function public.customer_escalate_support_conversation(uuid, uuid) to service_role;

revoke all on function public.admin_reply_support_message(uuid, uuid, text) from public;
revoke all on function public.admin_reply_support_message(uuid, uuid, text) from anon;
revoke all on function public.admin_reply_support_message(uuid, uuid, text) from authenticated;
grant execute on function public.admin_reply_support_message(uuid, uuid, text) to service_role;

revoke all on function public.admin_resolve_support_conversation(uuid, uuid) from public;
revoke all on function public.admin_resolve_support_conversation(uuid, uuid) from anon;
revoke all on function public.admin_resolve_support_conversation(uuid, uuid) from authenticated;
grant execute on function public.admin_resolve_support_conversation(uuid, uuid) to service_role;
