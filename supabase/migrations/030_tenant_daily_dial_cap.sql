-- Per-workspace daily dial plan. Null keeps the product default (200).
-- A set value is the ceiling for that tenant's runs, cold batches, and the
-- call-queue worker. It cannot exceed the product default.

alter table tenants
  add column if not exists daily_dial_cap integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_daily_dial_cap_check'
  ) then
    alter table tenants
      add constraint tenants_daily_dial_cap_check
      check (daily_dial_cap is null or daily_dial_cap between 1 and 200);
  end if;
end $$;

comment on column tenants.daily_dial_cap is
  'Batch numbers allowed per Asia/Dubai day. Null uses the product default of 200.';

-- Shadam Azeez's workspace: 80 numbers a day.
update tenants t
set daily_dial_cap = 80
from agents a
where a.tenant_id = t.id
  and lower(a.email) = 'shadam.azeez@gmail.com'
  and t.daily_dial_cap is distinct from 80;
