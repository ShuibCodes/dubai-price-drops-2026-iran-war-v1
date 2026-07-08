-- Whautomate coexistence adapter

alter table tenants
  add column if not exists whautomate_channel_id text;
