-- Migration 032: B1 + B2 fixes for calendar booking.
--
-- B2: Unique partial index on appointments to prevent concurrent double-booking.
--     Two concurrent book_appointment calls on the same agent both see the slot
--     as free via FreeBusy, but only one insert can succeed. The loser triggers
--     the compensation path (Google event deleted + LLM told "not confirmed").
--
-- B1: calendar_compensation_failures table for orphan Google Calendar events.
--     Written when insertAppointment AND the compensating deleteGoogleCalendarEvent
--     both fail. The event remains on the agent's calendar; this row lets the team
--     find and manually delete it.

-- B2 -----------------------------------------------------------------------
-- One active booking per agent per start_at.
-- Allows multiple cancelled/failed rows at the same slot (for audit purposes).
create unique index if not exists appointments_agent_start_booked_idx
  on appointments (agent_id, start_at)
  where status = 'booked';

-- B1 -----------------------------------------------------------------------
create table if not exists calendar_compensation_failures (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references tenants(id) on delete set null,
  agent_id              uuid references agents(id) on delete set null,
  calendar_connection_id uuid references calendar_connections(id) on delete set null,
  provider_event_id     text,
  calendar_id           text not null default 'primary',
  reason                text,
  created_at            timestamptz not null default now()
);

create index if not exists comp_failures_tenant_created_idx
  on calendar_compensation_failures (tenant_id, created_at desc);

alter table calendar_compensation_failures enable row level security;
revoke all on table calendar_compensation_failures from anon, authenticated;

comment on table calendar_compensation_failures is
  'Orphan Google Calendar events where insertAppointment failed AND the compensating deleteGoogleCalendarEvent also failed. Team must manually delete the Google event identified by provider_event_id.';
