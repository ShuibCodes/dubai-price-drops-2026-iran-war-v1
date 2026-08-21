-- Copilot identity on agents. role already exists (001, default 'agent') — do not re-add.
-- wa_id stays the WhatsApp Graph id (digits, no +). Nullable so a Copilot user
-- can exist before a personal WhatsApp number is known. Dial as +{wa_id}.

alter table agents
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists password_hash text,
  add column if not exists last_login_at timestamptz;

alter table agents
  alter column wa_id drop not null;

create unique index if not exists agents_username_lower_unique
  on agents (lower(username))
  where username is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_role_check'
  ) then
    alter table agents
      add constraint agents_role_check
      check (role is null or role in ('agent', 'admin'));
  end if;
end $$;

-- Tenants that already have agents but no admin: promote the oldest row.
-- JSON roster seed (scripts/seed-copilot-agents.mjs) adds an admin for
-- tenants that have no agents row at all (1416, condo-city, ghl-courses).
update agents a
set role = 'admin'
where a.role is distinct from 'admin'
  and not exists (
    select 1 from agents x
    where x.tenant_id = a.tenant_id and x.role = 'admin'
  )
  and a.id = (
    select id from agents b
    where b.tenant_id = a.tenant_id
    order by b.created_at asc, b.id asc
    limit 1
  );
