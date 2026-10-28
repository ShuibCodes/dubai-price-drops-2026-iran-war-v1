-- Dubizzle inbound email (Steps 2–4): per-tenant forwarding address and
-- ingest log. Parse/Gmail-verify/call columns are intentionally omitted.
-- Application access is service-role only (same pattern as feedback tickets).

alter table tenants
  add column if not exists inbound_email text;

create unique index if not exists tenants_inbound_email_unique
  on tenants (inbound_email)
  where inbound_email is not null;

create table if not exists inbound_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  resend_email_id text not null unique,
  from_address text not null,
  subject text,
  raw_text text,
  status text not null default 'received',
  skip_reason text,
  created_at timestamptz not null default now(),
  constraint inbound_leads_status_check
    check (status in (
      'received',
      'parsed',
      'awaiting_approval',
      'called',
      'skipped',
      'failed'
    ))
);

create index if not exists inbound_leads_tenant_created_idx
  on inbound_leads (tenant_id, created_at desc);

create index if not exists inbound_leads_tenant_status_idx
  on inbound_leads (tenant_id, status);

create table if not exists retired_inbound_emails (
  email text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  retired_at timestamptz not null default now()
);

create index if not exists retired_inbound_emails_tenant_retired_idx
  on retired_inbound_emails (tenant_id, retired_at desc);

alter table inbound_leads enable row level security;
alter table retired_inbound_emails enable row level security;

revoke all on table inbound_leads from anon, authenticated;
revoke all on table retired_inbound_emails from anon, authenticated;
