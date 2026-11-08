-- Migration 038: iMessage / Sendblue support for agent identity and preferences.
--
-- Enables agents to chat with Jarvis over iMessage as well as WhatsApp.
-- Agents can configure their iMessage address (phone number or Apple ID email).
-- Incoming webhooks from Sendblue resolve identity using imessage_address,
-- falling back to wa_id and email.

alter table agents
  add column if not exists imessage_address text,
  add column if not exists preferred_channel text not null default 'whatsapp'
    constraint agents_preferred_channel_check
    check (preferred_channel in ('whatsapp', 'imessage'));

create unique index if not exists agents_imessage_address_lower_unique
  on agents (lower(imessage_address))
  where imessage_address is not null;

comment on column agents.imessage_address is
  'Optional iMessage phone number (E.164) or Apple ID email for Jarvis access.';

comment on column agents.preferred_channel is
  'Preferred communication channel for Jarvis notifications and briefings: whatsapp or imessage.';

