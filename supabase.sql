create table if not exists public.workflow_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workflow_state enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.workflow_state to service_role;

-- No public policies are created. Only the server-side service-role key can access this table.
