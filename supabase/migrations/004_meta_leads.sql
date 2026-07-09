-- Meta Instant Form lead routing

alter table tenants
  add column if not exists vapi_assistant_id_meta text;

alter table leads
  add column if not exists owns_property text;
