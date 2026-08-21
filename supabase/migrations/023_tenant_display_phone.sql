-- Idempotent. 022 already includes this; run if home errors with
-- "column tenants.display_phone does not exist".
alter table tenants add column if not exists display_phone text;
