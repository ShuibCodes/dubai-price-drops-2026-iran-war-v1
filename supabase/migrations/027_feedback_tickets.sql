-- Feedback tickets: tenant-scoped client tickets + staff thread.
-- App queries use the service-role client; RLS is defence in depth.

create table if not exists feedback_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_by_agent_id uuid references agents(id) on delete set null,
  type text not null,
  title text not null,
  description text not null default '',
  status text not null default 'new',
  priority text not null default 'normal',
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_tickets_type_check
    check (type in ('bug', 'feature', 'improvement', 'other')),
  constraint feedback_tickets_status_check
    check (status in ('new', 'in_review', 'in_progress', 'resolved', 'closed')),
  constraint feedback_tickets_priority_check
    check (priority in ('low', 'normal', 'high'))
);

create index if not exists feedback_tickets_tenant_updated_idx
  on feedback_tickets (tenant_id, updated_at desc);
create index if not exists feedback_tickets_status_idx
  on feedback_tickets (status);
create index if not exists feedback_tickets_type_idx
  on feedback_tickets (type);

create table if not exists feedback_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ticket_id uuid not null references feedback_tickets(id) on delete cascade,
  author_kind text not null,
  author_agent_id uuid references agents(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint feedback_comments_author_kind_check
    check (author_kind in ('client', 'staff')),
  constraint feedback_comments_body_check check (char_length(body) > 0)
);

create index if not exists feedback_comments_ticket_created_idx
  on feedback_comments (ticket_id, created_at);

create table if not exists feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ticket_id uuid not null references feedback_tickets(id) on delete cascade,
  comment_id uuid references feedback_comments(id) on delete set null,
  filename text not null,
  storage_path text not null,
  bytes int,
  content_type text,
  uploaded_by_agent_id uuid references agents(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_attachments_ticket_idx
  on feedback_attachments (ticket_id, created_at);
create index if not exists feedback_attachments_tenant_idx
  on feedback_attachments (tenant_id);

alter table feedback_tickets enable row level security;
alter table feedback_comments enable row level security;
alter table feedback_attachments enable row level security;

revoke all on table feedback_tickets from anon, authenticated;
revoke all on table feedback_comments from anon, authenticated;
revoke all on table feedback_attachments from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('feedback-attachments', 'feedback-attachments', false, 5242880)
on conflict (id) do nothing;
