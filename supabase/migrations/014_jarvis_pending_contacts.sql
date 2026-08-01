-- Pending contact saves (WhatsApp confirm → upsert jarvis_leads)
create table if not exists jarvis_pending_contacts (
  sender_phone text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone_e164 text not null,
  wa_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists jarvis_pending_contacts_expires_idx
  on jarvis_pending_contacts (expires_at);

-- Relay confirm can also create the contact first when dialing a new number
alter table jarvis_pending_relays
  add column if not exists create_contact boolean not null default false;
