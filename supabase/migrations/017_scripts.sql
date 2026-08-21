-- Scripts + versioned configs. Attribution on call_queue/calls.
-- call_queue stays flat (source string). No batch_id here — that parent is Track B2.

create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  display_name text not null,
  vapi_assistant_id text,
  status text not null default 'draft',
  current_version int not null default 0,
  is_seeded boolean not null default false,
  created_by uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scripts_status_check check (status in ('draft', 'live', 'archived'))
);

create unique index if not exists scripts_tenant_display_name_unique
  on scripts (tenant_id, lower(display_name))
  where status <> 'archived';

create index if not exists scripts_tenant_status_idx
  on scripts (tenant_id, status);

create table if not exists script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts(id) on delete cascade,
  version_no int not null,
  config_json jsonb not null,
  composed_prompt text not null,
  preamble_version int not null,
  published_at timestamptz,
  published_by uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (script_id, version_no)
);

alter table call_queue
  add column if not exists script_id uuid references scripts(id),
  add column if not exists script_version_id uuid references script_versions(id);

alter table calls
  add column if not exists script_id uuid references scripts(id),
  add column if not exists script_version_id uuid references script_versions(id);

-- Defence in depth only. The app uses the service-role client, which bypasses
-- RLS. Tenant isolation is getSession() + an explicit tenant_id filter on every
-- query — never these policies. No USING (true). Copilot sessions are HMAC
-- cookies, not auth.uid(). script_versions has no tenant_id; it is scoped
-- through scripts.tenant_id in application code.
alter table scripts enable row level security;
alter table script_versions enable row level security;

revoke all on table scripts from anon, authenticated;
revoke all on table script_versions from anon, authenticated;
