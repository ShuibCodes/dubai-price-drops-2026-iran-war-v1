-- Personal Jarvis outbound assistant (separate from Pixxi / Meta cold-call assistants)
alter table tenants
  add column if not exists vapi_assistant_id_jarvis text;
