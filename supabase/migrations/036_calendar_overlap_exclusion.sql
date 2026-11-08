-- Migration 033: Replace simple unique index with GiST range exclusion constraint.
--
-- Problem: The B2 unique index on (agent_id, start_at) only prevents two
-- bookings with the EXACT same start time. Overlapping-but-offset bookings
-- (e.g. 10:00–10:30 and 10:15–10:45) would both succeed.
--
-- Fix: Use a PostgreSQL exclusion constraint with tstzrange so that any
-- overlapping time range for the same agent is rejected at the DB level.
-- The second concurrent INSERT fails, triggering the existing compensation
-- path (Google event deleted, LLM told "not confirmed").

-- btree_gist is required to combine = (uuid) and && (range) operators
-- in a single exclusion constraint. Safe to call repeatedly.
create extension if not exists btree_gist;

-- Drop the old partial unique index — it is replaced by the exclusion below.
drop index if exists appointments_agent_start_booked_idx;

-- Exclusion constraint: no two 'booked' appointments for the same agent
-- may have overlapping [start_at, end_at) time ranges.
-- Uses '[)' (closed-open) so that a viewing ending at 10:30 does not
-- conflict with one starting at 10:30.
alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    agent_id  with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status = 'booked');

comment on constraint appointments_no_overlap on appointments is
  'Prevents overlapping booked appointments for the same agent. Two concurrent book_appointment calls that overlap in time will have one rejected, triggering the compensation path.';

