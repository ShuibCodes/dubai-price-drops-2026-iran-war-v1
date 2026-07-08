-- 1416 Real Estate Vapi calling pipeline

alter table tenants
  add column if not exists slug text,
  add column if not exists vapi_assistant_id text,
  add column if not exists vapi_phone_number_id text;

create unique index if not exists tenants_slug_unique on tenants (slug)
  where slug is not null;

alter table leads
  add column if not exists pixxi_lead_id text,
  add column if not exists assigned_agent_name text,
  add column if not exists assigned_agent_phone text,
  add column if not exists source text;

create unique index if not exists leads_tenant_pixxi_lead_id_unique
  on leads (tenant_id, pixxi_lead_id)
  where pixxi_lead_id is not null;

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  vapi_call_id text unique,
  direction text default 'outbound',
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  recording_url text,
  transcript text,
  summary text,
  qualification jsonb,
  results_synced boolean default false,
  results_synced_at timestamptz,
  raw jsonb,
  created_at timestamptz default now()
);

create index if not exists calls_tenant_ended_at_idx
  on calls (tenant_id, ended_at desc);

create table if not exists call_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  scheduled_for timestamptz not null,
  processed boolean default false,
  created_at timestamptz default now()
);

create index if not exists call_queue_processed_scheduled_idx
  on call_queue (processed, scheduled_for);
