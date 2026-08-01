-- Lazy Claude-inferred display names for jarvis_leads (never overwrites push_name).

alter table jarvis_leads
  add column if not exists inferred_name text,
  add column if not exists inferred_name_confidence text,
  add column if not exists inferred_name_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jarvis_leads_inferred_name_confidence_check'
  ) then
    alter table jarvis_leads
      add constraint jarvis_leads_inferred_name_confidence_check
      check (
        inferred_name_confidence is null
        or inferred_name_confidence in ('high', 'medium', 'low')
      );
  end if;
end $$;
