create table if not exists public.vibode_gemini_usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  attempt_id text not null unique,
  retry_of_attempt_id text null,
  is_retry boolean not null default false,
  request_id text null,
  operation_id text null,
  provider_request_id text null,
  user_id uuid null references auth.users(id) on delete set null,
  room_id uuid null references public.vibode_rooms(id) on delete set null,
  version_id uuid null references public.vibode_room_assets(id) on delete set null,
  asset_id uuid null references public.vibode_room_assets(id) on delete set null,
  provider text not null default 'google_gemini',
  model text not null,
  workflow_type text not null,
  action_type text not null,
  route text not null,
  service text not null default 'roomprintz-ui',
  source_trigger text null,
  status text not null check (status in ('success', 'failure')),
  error_code text null,
  latency_ms integer null check (latency_ms is null or latency_ms >= 0),
  input_tokens integer null check (input_tokens is null or input_tokens >= 0),
  output_tokens integer null check (output_tokens is null or output_tokens >= 0),
  image_count integer null check (image_count is null or image_count >= 0),
  reference_image_count integer null check (reference_image_count is null or reference_image_count >= 0),
  estimated_cost_usd numeric(12, 6) null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists vibode_gemini_usage_events_created_at_idx
  on public.vibode_gemini_usage_events (created_at desc);

create index if not exists vibode_gemini_usage_events_model_idx
  on public.vibode_gemini_usage_events (model, created_at desc);

create index if not exists vibode_gemini_usage_events_user_idx
  on public.vibode_gemini_usage_events (user_id, created_at desc);

create index if not exists vibode_gemini_usage_events_workflow_action_idx
  on public.vibode_gemini_usage_events (workflow_type, action_type, created_at desc);

create index if not exists vibode_gemini_usage_events_status_idx
  on public.vibode_gemini_usage_events (status, created_at desc);

alter table public.vibode_gemini_usage_events enable row level security;

create policy "vibode_gemini_usage_events_owner_read"
on public.vibode_gemini_usage_events
for select
using (auth.uid() = user_id);

create or replace function public.prevent_vibode_gemini_usage_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vibode_gemini_usage_events is append-only';
end;
$$;

drop trigger if exists vibode_gemini_usage_events_no_update
on public.vibode_gemini_usage_events;

create trigger vibode_gemini_usage_events_no_update
before update on public.vibode_gemini_usage_events
for each row execute function public.prevent_vibode_gemini_usage_events_mutation();

drop trigger if exists vibode_gemini_usage_events_no_delete
on public.vibode_gemini_usage_events;

create trigger vibode_gemini_usage_events_no_delete
before delete on public.vibode_gemini_usage_events
for each row execute function public.prevent_vibode_gemini_usage_events_mutation();
