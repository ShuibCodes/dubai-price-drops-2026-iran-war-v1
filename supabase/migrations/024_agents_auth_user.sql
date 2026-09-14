-- Supabase Auth link on agents. Passwordless providers authenticate an email,
-- so agents.email becomes the login identifier and needs the uniqueness it has
-- never had. password_hash stays until every account has migrated.
--
-- DDL only. Test fixtures are created by scripts/create-test-agent.mjs, never
-- by a migration — migrations run against every environment.

alter table agents
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

-- set null, not cascade: scripts.created_by and call_batches.agent_id point at
-- agents, so removing an auth user must not delete the agent row behind them.
create unique index if not exists agents_auth_user_id_unique
  on agents (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists agents_email_lower_unique
  on agents (lower(email))
  where email is not null;
