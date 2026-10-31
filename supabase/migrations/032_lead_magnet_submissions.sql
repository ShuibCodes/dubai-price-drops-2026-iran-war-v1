-- Lead magnet popup submissions (One-Pager tool on landing page)

create table if not exists public.lead_magnet_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  source text not null default 'landing_popup_one_pager',
  resend_email_id text,
  resend_template_id text,
  email_status text not null default 'pending',
  email_error text,
  email_sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lead_magnet_submissions enable row level security;

create index if not exists lead_magnet_submissions_email_idx
  on public.lead_magnet_submissions (lower(email));

create index if not exists lead_magnet_submissions_created_at_idx
  on public.lead_magnet_submissions (created_at desc);
