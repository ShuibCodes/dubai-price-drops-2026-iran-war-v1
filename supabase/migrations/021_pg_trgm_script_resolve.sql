-- Phase 7: pg_trgm for script display_name matching.
-- Phase 1 deferred this (006). Resolve uses similarity(), not ILIKE alone.
-- Migrated Live — * pointers are excluded in script_resolve_candidates;
-- they are dial-attribution rows, not names an agent picks.

create extension if not exists pg_trgm with schema extensions;

create index if not exists scripts_display_name_trgm_idx
  on public.scripts using gin (lower(display_name) gin_trgm_ops);

create or replace function public.script_resolve_candidates(
  p_tenant_id uuid,
  p_phrase text
)
returns table (
  id uuid,
  display_name text,
  status text,
  current_version int,
  published_at timestamptz,
  sim real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    s.id,
    s.display_name,
    s.status,
    s.current_version,
    v.published_at,
    similarity(
      lower(s.display_name),
      lower(btrim(coalesce(p_phrase, '')))
    )::real as sim
  from scripts s
  left join script_versions v
    on v.script_id = s.id
   and v.version_no = s.current_version
   and s.current_version > 0
  where s.tenant_id = p_tenant_id
    and s.status <> 'archived'
    and coalesce(s.is_migrated, false) = false
$$;

revoke all on function public.script_resolve_candidates(uuid, text)
  from public, anon, authenticated;
grant execute on function public.script_resolve_candidates(uuid, text)
  to service_role;
