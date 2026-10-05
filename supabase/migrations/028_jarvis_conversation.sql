-- Private Jarvis ↔ agent WhatsApp transcript.
-- Separate from whatsapp-messages and jarvis_leads (those are the business inbox).
-- Service-role only. RLS is on with no policies; the app filters every read and write
-- by tenant_id, agent_id, and sender_phone.

create table if not exists jarvis_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  sender_phone text not null,
  role text not null,
  body text not null,
  message_sid text,
  turn_id uuid not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint jarvis_conversation_messages_role_check
    check (role in ('user', 'assistant')),
  constraint jarvis_conversation_messages_body_check
    check (char_length(body) > 0 and char_length(body) <= 8000),
  constraint jarvis_conversation_messages_sender_check
    check (sender_phone ~ '^[0-9]{6,20}$')
);

create index if not exists jarvis_conversation_messages_thread_idx
  on jarvis_conversation_messages (tenant_id, agent_id, sender_phone, seq desc);

create unique index if not exists jarvis_conversation_messages_inbound_sid_idx
  on jarvis_conversation_messages (tenant_id, agent_id, sender_phone, message_sid)
  where role = 'user' and message_sid is not null;

create unique index if not exists jarvis_conversation_messages_assistant_turn_idx
  on jarvis_conversation_messages (tenant_id, agent_id, sender_phone, turn_id)
  where role = 'assistant';

-- One lease per conversation. Expired leases can be taken over.
-- The model call does not run inside this function or inside a held transaction.
create table if not exists jarvis_conversation_locks (
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  sender_phone text not null,
  lock_token uuid not null,
  locked_until timestamptz not null,
  primary key (tenant_id, agent_id, sender_phone),
  constraint jarvis_conversation_locks_sender_check
    check (sender_phone ~ '^[0-9]{6,20}$')
);

create or replace function public.acquire_jarvis_conversation_lock(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_sender_phone text,
  p_lock_token uuid,
  p_lease_seconds int
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  acquired uuid;
begin
  if p_tenant_id is null or p_agent_id is null then
    raise exception 'conversation lock scope is required';
  end if;
  if p_sender_phone is null or p_sender_phone !~ '^[0-9]{6,20}$' then
    raise exception 'conversation lock sender is required';
  end if;
  if p_lock_token is null then
    raise exception 'lock token is required';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 180 then
    raise exception 'lease seconds out of range';
  end if;

  insert into jarvis_conversation_locks (
    tenant_id, agent_id, sender_phone, lock_token, locked_until
  )
  values (
    p_tenant_id,
    p_agent_id,
    p_sender_phone,
    p_lock_token,
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (tenant_id, agent_id, sender_phone)
  do update set
    lock_token = excluded.lock_token,
    locked_until = excluded.locked_until
  where jarvis_conversation_locks.locked_until < now()
  returning lock_token into acquired;

  return acquired;
end;
$$;

create or replace function public.extend_jarvis_conversation_lock(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_sender_phone text,
  p_lock_token uuid,
  p_lease_seconds int
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  extended uuid;
begin
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 180 then
    raise exception 'lease seconds out of range';
  end if;

  update jarvis_conversation_locks
  set locked_until = now() + make_interval(secs => p_lease_seconds)
  where tenant_id = p_tenant_id
    and agent_id = p_agent_id
    and sender_phone = p_sender_phone
    and lock_token = p_lock_token
    and locked_until > now()
  returning lock_token into extended;

  return extended;
end;
$$;

create or replace function public.release_jarvis_conversation_lock(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_sender_phone text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from jarvis_conversation_locks
  where tenant_id = p_tenant_id
    and agent_id = p_agent_id
    and sender_phone = p_sender_phone
    and lock_token = p_lock_token;
  return found;
end;
$$;

-- Insert the assistant row only while this token still owns an unexpired lease.
-- The lock row is locked first so a takeover cannot commit between the check and the insert.
create or replace function public.insert_jarvis_assistant_if_owner(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_sender_phone text,
  p_lock_token uuid,
  p_turn_id uuid,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  held uuid;
  created uuid;
begin
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 8000 then
    raise exception 'assistant body is invalid';
  end if;

  select lock_token into held
  from jarvis_conversation_locks
  where tenant_id = p_tenant_id
    and agent_id = p_agent_id
    and sender_phone = p_sender_phone
    and lock_token = p_lock_token
    and locked_until > now()
  for update;

  if held is null then
    return null;
  end if;

  insert into jarvis_conversation_messages (
    tenant_id, agent_id, sender_phone, role, body, message_sid, turn_id
  )
  values (
    p_tenant_id, p_agent_id, p_sender_phone, 'assistant', btrim(p_body), null, p_turn_id
  )
  returning id into created;

  return created;
exception
  when unique_violation then
    select id into created
    from jarvis_conversation_messages
    where tenant_id = p_tenant_id
      and agent_id = p_agent_id
      and sender_phone = p_sender_phone
      and role = 'assistant'
      and turn_id = p_turn_id;
    return created;
end;
$$;

-- Record delivery only after the WhatsApp send has returned.
-- Call this after a successful send. It does not reserve the send.
-- A crash before this update leaves sent_at null, so a later owner can send
-- the saved body. A crash after the provider accepts and before this update
-- can produce one duplicate send.
create or replace function public.mark_jarvis_assistant_sent_if_owner(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_sender_phone text,
  p_lock_token uuid,
  p_message_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  held uuid;
  claimed uuid;
begin
  select lock_token into held
  from jarvis_conversation_locks
  where tenant_id = p_tenant_id
    and agent_id = p_agent_id
    and sender_phone = p_sender_phone
    and lock_token = p_lock_token
    and locked_until > now()
  for update;

  if held is null then
    return false;
  end if;

  update jarvis_conversation_messages
  set sent_at = now()
  where id = p_message_id
    and tenant_id = p_tenant_id
    and agent_id = p_agent_id
    and sender_phone = p_sender_phone
    and role = 'assistant'
    and sent_at is null
  returning id into claimed;

  return claimed is not null;
end;
$$;

alter table jarvis_conversation_messages enable row level security;
alter table jarvis_conversation_locks enable row level security;

revoke all on table jarvis_conversation_messages from anon, authenticated;
revoke all on table jarvis_conversation_locks from anon, authenticated;

revoke all on function public.acquire_jarvis_conversation_lock(uuid, uuid, text, uuid, int)
  from public, anon, authenticated;
revoke all on function public.extend_jarvis_conversation_lock(uuid, uuid, text, uuid, int)
  from public, anon, authenticated;
revoke all on function public.release_jarvis_conversation_lock(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.insert_jarvis_assistant_if_owner(uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_jarvis_assistant_sent_if_owner(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_jarvis_conversation_lock(uuid, uuid, text, uuid, int)
  to service_role;
grant execute on function public.extend_jarvis_conversation_lock(uuid, uuid, text, uuid, int)
  to service_role;
grant execute on function public.release_jarvis_conversation_lock(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.insert_jarvis_assistant_if_owner(uuid, uuid, text, uuid, uuid, text)
  to service_role;
grant execute on function public.mark_jarvis_assistant_sent_if_owner(uuid, uuid, text, uuid, uuid)
  to service_role;
