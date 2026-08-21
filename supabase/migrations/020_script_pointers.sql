-- Phase 6: live assistant pointers + idempotent seed keys.
--
-- Relay (env VAPI_RELAY_ASSISTANT_ID) stays OUTSIDE the scripts system.
-- It is not a tenant-scoped qualification persona. Jarvis relay
-- (`startRelayCall` in src/lib/vapi/client.js) bakes firstMessage from the
-- task at dial time; there is no goal / find_out / config_json, and the id
-- lives in env, not on tenants.vapi_assistant_id*. Seeding it as a script
-- would invite publish to PATCH a message-relay assistant with a cold-list
-- prompt. Do not migrate it. Do not drop the env var.
--
-- tenants.vapi_assistant_id / _meta / _jarvis become is_migrated scripts
-- (one per tenant per non-null column). Those assistants are dashboard-
-- defined. Their stored config_json is COLD_LIST_CONFIG so the row is
-- valid — not a live byte-copy of the Vapi prompt. Publish, restore, and
-- PATCH are blocked in the API so a composed prompt cannot overwrite
-- production Allan. Keep the tenant columns readable; stop writing them.
--
-- Catalog rows (SEED_SCRIPTS) are is_seeded, not is_migrated. First
-- publish POSTs a new Vapi assistant. They never point at the live ids.
--
-- Cap: POST /api/scripts counts only is_seeded = false. Platform catalog
-- and migrated pointers do not consume the 5 user-script slots, so this
-- migration cannot 409 the cap or silently exceed it.

alter table scripts
  add column if not exists is_migrated boolean not null default false,
  add column if not exists seed_key text;

create unique index if not exists scripts_tenant_seed_key_unique
  on scripts (tenant_id, seed_key)
  where seed_key is not null;
