-- Per-tenant spoken persona. Composer reads tenants.persona_name instead of
-- hardcoding "Allan". Default keeps today's 1416 behaviour.

alter table tenants
  add column if not exists persona_name text not null default 'Allan';

update tenants
set persona_name = 'Allan'
where persona_name is distinct from 'Allan';
