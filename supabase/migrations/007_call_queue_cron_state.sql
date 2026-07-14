-- Idempotent state for the Railway call-queue cron worker.

alter table call_queue
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text;

create index if not exists call_queue_due_unclaimed_idx
  on call_queue (scheduled_for)
  where processed = false and processing_started_at is null;
