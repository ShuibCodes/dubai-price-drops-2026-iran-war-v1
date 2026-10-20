-- Requires 029_dubizzle_inbound_email.sql (PR #6) to be applied first.
-- Parse / Gmail-verify / call pipeline columns not included in the webhook migration.

alter table tenants
  add column if not exists dubizzle_enabled boolean not null default false,
  add column if not exists dubizzle_last_lead_at timestamptz,
  add column if not exists require_approval boolean not null default true,
  add column if not exists dubizzle_gmail_verify_code text,
  add column if not exists dubizzle_gmail_verify_at timestamptz;

alter table inbound_leads
  add column if not exists lead_name text,
  add column if not exists lead_phone text,
  add column if not exists listing_title text,
  add column if not exists listing_url text,
  add column if not exists call_id uuid references calls(id) on delete set null;
