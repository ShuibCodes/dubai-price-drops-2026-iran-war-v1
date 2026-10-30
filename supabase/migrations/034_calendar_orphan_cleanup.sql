-- Migration 034: Automated orphan Google Calendar event cleanup.
--
-- Problem: When both insertAppointment AND the compensating
-- deleteGoogleCalendarEvent fail, an orphan event remains on the
-- agent's Google Calendar. These are logged in calendar_compensation_failures
-- but currently require manual cleanup.
--
-- Fix: Add status tracking + a cleanup-ready view. The actual Google API
-- delete must happen from the application layer (Node.js), because
-- Postgres cannot call external HTTP APIs. This migration adds the DB
-- scaffolding; the companion script handles the Google calls.

-- Add columns to track cleanup state
alter table calendar_compensation_failures
  add column if not exists status text not null default 'pending'
    constraint comp_failures_status_check
    check (status in ('pending', 'retrying', 'resolved', 'abandoned')),
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz,
  add column if not exists resolved_at timestamptz;

-- Index for the cleanup job: find pending/retrying records efficiently
create index if not exists comp_failures_status_idx
  on calendar_compensation_failures (status, created_at)
  where status in ('pending', 'retrying');

-- View for monitoring: how many orphans are outstanding?
create or replace view calendar_orphan_summary as
select
  status,
  count(*) as total,
  min(created_at) as oldest,
  max(created_at) as newest
from calendar_compensation_failures
group by status;

comment on view calendar_orphan_summary is
  'Quick dashboard view: how many orphan Google Calendar events are in each cleanup state.';

