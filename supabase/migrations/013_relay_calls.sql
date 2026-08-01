-- Pending relay confirmations (must survive waitUntil / new instances)
create table if not exists jarvis_pending_relays (
  sender_phone text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references jarvis_leads(id) on delete set null,
  phone_e164 text not null,
  customer_name text not null,
  task text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists jarvis_pending_relays_expires_idx
  on jarvis_pending_relays (expires_at);

-- Dialed relay call log + end-of-call summary push-back
create table if not exists relay_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sender_phone text not null,
  lead_id uuid references jarvis_leads(id) on delete set null,
  phone_e164 text not null,
  customer_name text not null,
  task text not null,
  vapi_call_id text,
  status text not null default 'initiated',
  summary text,
  created_at timestamptz not null default now()
);

create unique index if not exists relay_calls_vapi_call_id_unique
  on relay_calls (vapi_call_id)
  where vapi_call_id is not null;

create index if not exists relay_calls_phone_created_idx
  on relay_calls (phone_e164, created_at desc);

create index if not exists relay_calls_sender_created_idx
  on relay_calls (sender_phone, created_at desc);
