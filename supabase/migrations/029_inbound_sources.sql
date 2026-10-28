-- Inbound lead sources (GHL forms etc.) → leads → auto-call via the
-- batch-callbacks Railway worker. Lists stay as leads.source (list_name).
-- New lead columns are null/0 for existing leads, so current tenants are unaffected.

create table if not exists inbound_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  secret text not null,
  list_name text,
  -- Null → tenant default assistant (tenants.vapi_assistant_id).
  assistant_id text,
  -- { "incoming_key": "lead_field" }, lead fields: name, first_name, last_name, phone, email, external_id
  field_map jsonb not null default '{}'::jsonb,
  auto_call boolean not null default false,
  call_delay_seconds int not null default 60,
  -- Interpreted in the LEAD's local time (timezone from phone country code).
  call_window_start time not null default '10:00',
  call_window_end time not null default '19:00',
  max_attempts int not null default 3,
  retry_gap_minutes int not null default 180,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists inbound_sources_tenant_idx on inbound_sources (tenant_id);

alter table inbound_sources enable row level security;
revoke all on table inbound_sources from anon, authenticated;

alter table leads
  add column if not exists inbound_source_id uuid references inbound_sources(id) on delete set null,
  add column if not exists external_id text,
  add column if not exists form_data jsonb,
  add column if not exists call_status text,
  add column if not exists next_call_at timestamptz,
  add column if not exists call_attempts int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_call_status_check'
  ) then
    alter table leads
      add constraint leads_call_status_check
      check (call_status is null or call_status in ('waiting', 'calling', 'done', 'no_answer', 'failed'));
  end if;
end $$;

create index if not exists leads_inbound_due_idx
  on leads (next_call_at)
  where call_status = 'waiting';

create index if not exists leads_inbound_calling_idx
  on leads (next_call_at)
  where call_status = 'calling';
