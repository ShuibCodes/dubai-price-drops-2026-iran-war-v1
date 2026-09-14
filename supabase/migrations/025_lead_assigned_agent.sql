-- Agent ownership on campaign leads and the Jarvis inbox.
-- Null means unassigned: do not infer an owner in this migration.
-- Search and callback lists must treat null as invisible to every agent.

alter table leads
  add column if not exists assigned_agent_id uuid references agents(id) on delete set null;

alter table jarvis_leads
  add column if not exists assigned_agent_id uuid references agents(id) on delete set null;

create index if not exists leads_tenant_assigned_agent_idx
  on leads (tenant_id, assigned_agent_id);

create index if not exists jarvis_leads_tenant_assigned_agent_idx
  on jarvis_leads (tenant_id, assigned_agent_id);
