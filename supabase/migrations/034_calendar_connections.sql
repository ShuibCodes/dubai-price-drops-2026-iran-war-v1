-- Per-agent Google Calendar connections + booked viewings.
-- Tokens live here only (encrypted), never on tenants or agents.
-- Isolation is getSession() / call metadata + an explicit tenant_id filter.
-- RLS is defence in depth; the app uses the service-role client.

create table if not exists calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  provider text not null default 'google',
  google_account_email text,
  calendar_id text not null default 'primary',
  calendar_summary text,
  calendar_timezone text,
  token_ciphertext text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'active',
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint calendar_connections_provider_check check (provider = 'google'),
  constraint calendar_connections_status_check
    check (status in ('active', 'revoked', 'error')),
  unique (tenant_id, agent_id, provider)
);

create index if not exists calendar_connections_tenant_agent_idx
  on calendar_connections (tenant_id, agent_id);

create index if not exists calendar_connections_tenant_status_idx
  on calendar_connections (tenant_id, status);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete restrict,
  calendar_connection_id uuid references calendar_connections(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  jarvis_lead_id uuid references jarvis_leads(id) on delete set null,
  call_id uuid references calls(id) on delete set null,
  vapi_call_id text,
  summary text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  provider_event_id text,
  status text not null default 'booked',
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint appointments_status_check
    check (status in ('booked', 'cancelled', 'failed')),
  constraint appointments_window_check check (end_at > start_at)
);

create index if not exists appointments_tenant_start_idx
  on appointments (tenant_id, start_at desc);

create index if not exists appointments_tenant_agent_idx
  on appointments (tenant_id, agent_id);

create index if not exists appointments_vapi_call_id_idx
  on appointments (vapi_call_id)
  where vapi_call_id is not null;

alter table calendar_connections enable row level security;
alter table appointments enable row level security;

revoke all on table calendar_connections from anon, authenticated;
revoke all on table appointments from anon, authenticated;
