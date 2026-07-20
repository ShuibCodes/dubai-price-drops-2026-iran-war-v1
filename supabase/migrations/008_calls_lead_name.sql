-- Denormalized lead name on calls so the table is readable when browsed
-- directly. Filled by trigger at insert time for every call source
-- (cold batch, copilot, Pixxi/Meta inbound auto-dial).

alter table calls add column if not exists lead_name text;

create or replace function set_call_lead_name()
returns trigger as $$
begin
  if new.lead_id is not null and new.lead_name is null then
    select push_name into new.lead_name from leads where id = new.lead_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists calls_set_lead_name on calls;
create trigger calls_set_lead_name
  before insert on calls
  for each row execute function set_call_lead_name();

-- Backfill existing rows
update calls c
set lead_name = l.push_name
from leads l
where c.lead_id = l.id and c.lead_name is null;
