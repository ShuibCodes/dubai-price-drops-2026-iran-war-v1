-- Track B console: call_batches, lead enrichment, agent profile/brief, KB.
-- call_queue stays the unit of work. This only adds the grouping parent.

alter table agents
  add column if not exists areas text[] not null default '{}',
  add column if not exists ticket_min int,
  add column if not exists ticket_max int,
  add column if not exists languages text[] not null default '{}',
  add column if not exists team text,
  add column if not exists brief_enabled boolean not null default true,
  add column if not exists brief_time time not null default '07:30',
  add column if not exists tz text not null default 'Asia/Dubai',
  add column if not exists last_brief_sent_on date,
  add column if not exists onboarded_at timestamptz;

-- Existing agents are already in; do not force them through /join.
update agents
set onboarded_at = coalesce(onboarded_at, created_at, now())
where onboarded_at is null;

alter table tenants
  add column if not exists display_phone text;

alter table leads
  add column if not exists opted_out boolean not null default false,
  add column if not exists opted_out_at timestamptz,
  add column if not exists intent_score int,
  add column if not exists budget numeric,
  add column if not exists finance_type text,
  add column if not exists timeline text,
  add column if not exists areas text[] not null default '{}',
  add column if not exists bedrooms text;

create index if not exists leads_tenant_opted_out_last_message_idx
  on leads (tenant_id, opted_out, last_message_at desc);

create table if not exists call_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  script_id uuid references scripts(id) on delete set null,
  script_version_id uuid references script_versions(id) on delete set null,
  source_type text not null,
  filter jsonb not null default '{}'::jsonb,
  window_start timestamptz,
  window_end timestamptz,
  status text not null default 'queued',
  est_cost_aed numeric,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint call_batches_status_check
    check (status in ('queued', 'running', 'complete', 'failed', 'cancelled'))
);

create index if not exists call_batches_tenant_created_idx
  on call_batches (tenant_id, created_at desc);

alter table call_queue
  add column if not exists batch_id uuid references call_batches(id) on delete set null;

create index if not exists call_queue_batch_id_idx
  on call_queue (batch_id);

alter table calls
  add column if not exists batch_id uuid references call_batches(id) on delete set null;

create index if not exists calls_batch_id_idx
  on calls (batch_id);

create table if not exists kb_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_agent_id uuid references agents(id) on delete set null,
  scope text not null default 'private',
  filename text not null,
  storage_path text not null,
  bytes int,
  parsed_at timestamptz,
  index_status text not null default 'queued',
  created_at timestamptz not null default now(),
  constraint kb_documents_scope_check check (scope in ('private', 'tenant')),
  constraint kb_documents_index_status_check
    check (index_status in ('queued', 'parsing', 'indexed', 'failed'))
);

create index if not exists kb_documents_tenant_created_idx
  on kb_documents (tenant_id, created_at desc);

create table if not exists kb_doc_hidden (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  doc_id uuid not null references kb_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (agent_id, doc_id)
);

alter table call_batches enable row level security;
alter table kb_documents enable row level security;
alter table kb_doc_hidden enable row level security;

revoke all on table call_batches from anon, authenticated;
revoke all on table kb_documents from anon, authenticated;
revoke all on table kb_doc_hidden from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('kb-documents', 'kb-documents', false, 20971520)
on conflict (id) do nothing;
