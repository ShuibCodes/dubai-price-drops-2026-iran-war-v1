-- WhatsApp Lead Magnet (Free One-Pager PDF generator on AZ's number)

create table if not exists public.whatsapp_lead_magnet_users (
  wa_id text primary key,
  agent_name text,
  company_name text,
  email text,
  pending_listing_url text,
  pending_client_name text,
  last_client_name text,
  last_pdf_url text,
  last_pdf_storage_path text,
  last_pdf_filename text,
  last_listing_title text,
  awaiting_email boolean not null default false,
  daily_date date not null default (now() at time zone 'Asia/Dubai')::date,
  daily_count integer not null default 0,
  total_count integer not null default 0,
  last_message_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_lead_magnet_users enable row level security;

create index if not exists whatsapp_lead_magnet_users_updated_at_idx
  on public.whatsapp_lead_magnet_users (updated_at desc);

-- Add optional phone / listing / pdf columns to lead_magnet_submissions for unified lead tracking
alter table public.lead_magnet_submissions
  alter column email drop not null;

alter table public.lead_magnet_submissions
  add column if not exists phone text,
  add column if not exists company text,
  add column if not exists client_name text,
  add column if not exists listing_url text,
  add column if not exists pdf_url text;

create index if not exists lead_magnet_submissions_phone_idx
  on public.lead_magnet_submissions (phone);

-- Create public storage bucket for generated one-pager PDFs (Twilio requires a public HTTPS mediaUrl)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-magnet-pdfs',
  'lead-magnet-pdfs',
  true,
  16777216,
  array['application/pdf']
)
on conflict (id) do update
set public = true,
    file_size_limit = 16777216,
    allowed_mime_types = array['application/pdf'];
