-- AgentZero WhatsApp Cloud API coexistence schema

create extension if not exists "pgcrypto";

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text,
  waba_id text unique,
  phone_number_id text,
  business_token text,
  created_at timestamptz default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  wa_id text not null,
  name text,
  role text default 'agent',
  created_at timestamptz default now(),
  unique (tenant_id, wa_id)
);

create unique index if not exists agents_wa_id_unique on agents (wa_id);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  wa_id text not null,
  push_name text,
  first_seen timestamptz,
  last_message_at timestamptz,
  unique (tenant_id, wa_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  wa_message_id text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text,
  msg_type text,
  media_id text,
  timestamp timestamptz,
  raw jsonb,
  created_at timestamptz default now()
);

create index if not exists messages_tenant_timestamp_idx
  on messages (tenant_id, timestamp desc);

create index if not exists leads_tenant_last_message_idx
  on leads (tenant_id, last_message_at desc);
