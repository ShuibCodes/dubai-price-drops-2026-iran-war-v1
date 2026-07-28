-- Jarvis personal WhatsApp contacts — fully separate from campaign `leads`
-- so 1416 / Condo City dialers can never select them.

create table if not exists jarvis_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  wa_id text not null,
  push_name text,
  first_seen timestamptz,
  last_message_at timestamptz,
  pixxi_lead_id text,
  assigned_agent_name text,
  assigned_agent_phone text,
  source text,
  owns_property text,
  whautomate_contact_id text,
  bot_paused_until timestamptz,
  unique (tenant_id, wa_id)
);

-- Same generated country_code as leads (function already exists from 009).
alter table jarvis_leads
  add column if not exists country_code text
  generated always as (wa_id_country_code(wa_id)) stored;

create index if not exists jarvis_leads_tenant_last_message_idx
  on jarvis_leads (tenant_id, last_message_at desc);

create index if not exists jarvis_leads_tenant_country_idx
  on jarvis_leads (tenant_id, country_code);

create unique index if not exists jarvis_leads_tenant_pixxi_lead_id_unique
  on jarvis_leads (tenant_id, pixxi_lead_id)
  where pixxi_lead_id is not null;

-- Link WhatsApp message history to jarvis_leads without cascade-deleting.
alter table "whatsapp-messages"
  add column if not exists jarvis_lead_id uuid references jarvis_leads(id) on delete set null;

-- Allow messages to leave campaign leads without cascade wipe.
alter table "whatsapp-messages"
  alter column lead_id drop not null;

create index if not exists whatsapp_messages_jarvis_lead_id_idx
  on "whatsapp-messages" (jarvis_lead_id);

-- Jarvis-originated Vapi calls point at jarvis_leads, not campaign leads.
alter table calls
  add column if not exists jarvis_lead_id uuid references jarvis_leads(id) on delete set null;

create index if not exists calls_jarvis_lead_id_idx
  on calls (jarvis_lead_id);

-- Optional: after-hours queue for Jarvis single dials.
alter table call_queue
  add column if not exists jarvis_lead_id uuid references jarvis_leads(id) on delete cascade;

-- Make call_queue.lead_id nullable so Jarvis-only rows can exist.
alter table call_queue
  alter column lead_id drop not null;

-- ---------------------------------------------------------------------------
-- One-time data move: organic WhatsApp contacts (source is null) that have
-- message history → jarvis_leads. Campaign/source leads stay in leads.
-- ---------------------------------------------------------------------------

with candidates as (
  select distinct l.id, l.tenant_id, l.wa_id, l.push_name, l.first_seen, l.last_message_at,
    l.pixxi_lead_id, l.assigned_agent_name, l.assigned_agent_phone, l.source,
    l.owns_property, l.whautomate_contact_id, l.bot_paused_until
  from leads l
  inner join "whatsapp-messages" m on m.lead_id = l.id
  where l.source is null
),
inserted as (
  insert into jarvis_leads (
    id, tenant_id, wa_id, push_name, first_seen, last_message_at,
    pixxi_lead_id, assigned_agent_name, assigned_agent_phone, source,
    owns_property, whautomate_contact_id, bot_paused_until
  )
  select
    id, tenant_id, wa_id, push_name, first_seen, last_message_at,
    pixxi_lead_id, assigned_agent_name, assigned_agent_phone, source,
    owns_property, whautomate_contact_id, bot_paused_until
  from candidates
  on conflict (tenant_id, wa_id) do update
    set push_name = excluded.push_name
  returning id
)
update "whatsapp-messages" m
set jarvis_lead_id = m.lead_id,
    lead_id = null
where m.lead_id in (select id from inserted);

-- Drop the moved contacts from campaign leads (messages already re-pointed).
delete from leads
where source is null
  and id in (
    select distinct jarvis_lead_id
    from "whatsapp-messages"
    where jarvis_lead_id is not null
  );
