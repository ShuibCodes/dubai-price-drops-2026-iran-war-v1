-- Whautomate auto-reply engine

alter table tenants
  add column if not exists autoreply_enabled boolean default false,
  add column if not exists reply_prompt text;

alter table leads
  add column if not exists whautomate_contact_id text,
  add column if not exists bot_paused_until timestamptz;

alter table messages
  add column if not exists sent_by_bot boolean default false;
