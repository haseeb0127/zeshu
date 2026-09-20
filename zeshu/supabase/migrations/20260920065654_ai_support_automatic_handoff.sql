create or replace function public.create_ai_escalated_support_conversation(
  p_user_id uuid,
  p_question text,
  p_ai_answer text,
  p_subject text default 'Zeshu Assistant handoff'
)
returns table(
  conversation_id uuid,
  status text,
  subject text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.support_conversations%rowtype;
  v_question text := btrim(coalesce(p_question, ''));
  v_ai_answer text := btrim(coalesce(p_ai_answer, ''));
  v_subject text := left(coalesce(nullif(btrim(p_subject), ''), 'Zeshu Assistant handoff'), 160);
begin
  if p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'invalid support user';
  end if;

  if char_length(v_question) < 1 or char_length(v_question) > 1200 then
    raise exception 'invalid support question';
  end if;

  if char_length(v_ai_answer) < 1 or char_length(v_ai_answer) > 4000 then
    raise exception 'invalid assistant answer';
  end if;

  insert into public.support_conversations(user_id, subject, status, resolved_at)
  values (p_user_id, v_subject, 'WAITING', null)
  returning * into v_conversation;

  insert into public.support_messages(conversation_id, sender_user_id, sender_role, body)
  values (v_conversation.id, p_user_id, 'CUSTOMER', v_question);

  insert into public.support_messages(conversation_id, sender_user_id, sender_role, body)
  values (v_conversation.id, null, 'AI', v_ai_answer);

  update public.support_conversations
  set updated_at = now()
  where id = v_conversation.id
  returning * into v_conversation;

  return query
  select v_conversation.id, v_conversation.status, v_conversation.subject, v_conversation.created_at, v_conversation.updated_at;
end;
$$;

revoke all on function public.create_ai_escalated_support_conversation(uuid, text, text, text) from public;
revoke all on function public.create_ai_escalated_support_conversation(uuid, text, text, text) from anon;
revoke all on function public.create_ai_escalated_support_conversation(uuid, text, text, text) from authenticated;
grant execute on function public.create_ai_escalated_support_conversation(uuid, text, text, text) to service_role;
