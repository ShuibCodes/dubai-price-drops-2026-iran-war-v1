-- Tenant-scoped Copilot actions and outbound calling controls.

alter table tenants
  add column if not exists outbound_paused boolean not null default false;

alter table calls
  add column if not exists source text;

alter table call_queue
  add column if not exists source text,
  add column if not exists requested_by text;

create table if not exists copilot_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  action text not null,
  params jsonb not null default '{}'::jsonb,
  requested_by text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table copilot_actions enable row level security;

create index if not exists copilot_actions_tenant_created_idx
  on copilot_actions (tenant_id, created_at desc);

create index if not exists calls_tenant_source_created_idx
  on calls (tenant_id, source, created_at desc);

create index if not exists calls_tenant_lead_created_idx
  on calls (tenant_id, lead_id, created_at desc);

create index if not exists messages_tenant_lead_timestamp_idx
  on messages (tenant_id, lead_id, timestamp desc);

create index if not exists call_queue_tenant_processed_scheduled_idx
  on call_queue (tenant_id, processed, scheduled_for);

-- Future: pg_trgm GIN indexes can accelerate the ILIKE searches over
-- messages.body and calls.transcript. Do not install pg_trgm in Phase 1.
