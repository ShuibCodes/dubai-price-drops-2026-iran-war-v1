-- One transaction for script publish (version stamp + scripts live pointer).
-- Called from the app after upsertVapiAssistant succeeds. Service-role only.
-- INVOKER: the app already uses the service-role client, which bypasses RLS.

create or replace function public.publish_script_version(
  p_tenant_id uuid,
  p_script_id uuid,
  p_version_id uuid,
  p_agent_id uuid,
  p_vapi_assistant_id text,
  p_version_no int
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  ts timestamptz := now();
begin
  if p_vapi_assistant_id is null or btrim(p_vapi_assistant_id) = '' then
    raise exception 'vapi_assistant_id is required';
  end if;

  update script_versions
  set published_at = ts,
      published_by = p_agent_id
  where id = p_version_id
    and script_id = p_script_id
    and published_at is null
    and version_no = p_version_no;

  if not found then
    raise exception 'version not unpublished';
  end if;

  update scripts
  set vapi_assistant_id = p_vapi_assistant_id,
      status = 'live',
      current_version = p_version_no,
      updated_at = ts
  where id = p_script_id
    and tenant_id = p_tenant_id
    and status <> 'archived';

  if not found then
    raise exception 'script not found';
  end if;

  return ts;
end;
$$;

revoke all on function public.publish_script_version(uuid, uuid, uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.publish_script_version(uuid, uuid, uuid, uuid, text, int)
  to service_role;
