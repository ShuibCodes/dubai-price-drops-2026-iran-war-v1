-- Resolve an existing social identity or atomically provision a new workspace
-- owner. Called only by the server-side service-role client after Supabase has
-- exchanged and verified an OAuth session.

create or replace function public.resolve_or_provision_social_agent(
  p_auth_user_id uuid,
  p_email text,
  p_display_name text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  role text,
  email text,
  auth_user_id uuid,
  tenant_slug text,
  was_created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  safe_name text := nullif(left(btrim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g')), 120), '');
  by_auth agents%rowtype;
  by_email agents%rowtype;
  resolved agents%rowtype;
  workspace tenants%rowtype;
  candidate_slug text;
begin
  if p_auth_user_id is null then
    raise exception 'AZ_INVALID_IDENTITY: auth user id is required';
  end if;
  if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'AZ_INVALID_IDENTITY: verified email is required';
  end if;

  -- Every callback takes these locks in the same order. A repeat callback for
  -- either identifier waits, re-reads, and returns the one completed account.
  perform pg_advisory_xact_lock(hashtextextended('social-email:' || normalized_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('social-auth:' || p_auth_user_id::text, 0));

  begin
    select a.* into strict by_auth
    from agents a
    where a.auth_user_id = p_auth_user_id;
  exception
    when no_data_found then null;
    when too_many_rows then
      raise exception 'AZ_IDENTITY_CONFLICT: auth id resolves to multiple agents';
  end;

  begin
    select a.* into strict by_email
    from agents a
    where lower(a.email) = normalized_email;
  exception
    when no_data_found then null;
    when too_many_rows then
      raise exception 'AZ_IDENTITY_CONFLICT: email resolves to multiple agents';
  end;

  if by_auth.id is not null and by_email.id is not null and by_auth.id <> by_email.id then
    raise exception 'AZ_IDENTITY_CONFLICT: auth id and email resolve to different agents';
  end if;

  if by_auth.id is not null then
    resolved := by_auth;
  elsif by_email.id is not null then
    if by_email.auth_user_id is not null and by_email.auth_user_id <> p_auth_user_id then
      raise exception 'AZ_IDENTITY_CONFLICT: email is already linked to another auth user';
    end if;

    if by_email.auth_user_id is null then
      update agents a
      set auth_user_id = p_auth_user_id
      where a.id = by_email.id
        and a.auth_user_id is null
      returning a.* into resolved;

      if resolved.id is null then
        raise exception 'AZ_IDENTITY_CONFLICT: agent link changed concurrently';
      end if;
    else
      resolved := by_email;
    end if;
  else
    -- Slugs are generated from cryptographic randomness rather than names,
    -- emails, URLs, or client input. Retry the vanishingly unlikely collision.
    loop
      candidate_slug := 'workspace-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      begin
        insert into tenants (name, slug)
        values (coalesce(safe_name || '''s workspace', 'My workspace'), candidate_slug)
        returning * into workspace;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;

    insert into agents (
      tenant_id,
      name,
      email,
      auth_user_id,
      role,
      username,
      password_hash,
      wa_id,
      onboarded_at
    )
    values (
      workspace.id,
      safe_name,
      normalized_email,
      p_auth_user_id,
      'admin',
      null,
      null,
      null,
      null
    )
    returning * into resolved;

    return query
    select resolved.id, resolved.tenant_id, resolved.role, resolved.email,
      resolved.auth_user_id, workspace.slug, true;
    return;
  end if;

  select t.* into workspace
  from tenants t
  where t.id = resolved.tenant_id;

  if workspace.id is null or nullif(btrim(workspace.slug), '') is null then
    raise exception 'AZ_IDENTITY_CONFLICT: agent has no valid tenant';
  end if;

  return query
  select resolved.id, resolved.tenant_id, resolved.role, resolved.email,
    resolved.auth_user_id, workspace.slug, false;
end;
$$;

revoke all on function public.resolve_or_provision_social_agent(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_or_provision_social_agent(uuid, text, text)
  to service_role;
