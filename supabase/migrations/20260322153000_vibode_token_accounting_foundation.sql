create table public.user_token_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_tokens integer not null default 0,
  lifetime_granted_tokens integer not null default 0,
  lifetime_spent_tokens integer not null default 0,
  monthly_granted_tokens integer not null default 0,
  monthly_spent_tokens integer not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid references public.vibode_rooms(id) on delete set null,
  generation_run_id uuid references public.vibode_generation_runs(id) on delete set null,
  event_type text not null,
  action_type text not null,
  stage_number integer,
  model_version text,
  tokens_delta integer not null,
  balance_after integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.token_price_config (
  key text primary key,
  token_cost integer not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index token_ledger_user_id_created_at_desc_idx
  on public.token_ledger(user_id, created_at desc);
create index token_ledger_room_id_created_at_desc_idx
  on public.token_ledger(room_id, created_at desc);
create index token_ledger_generation_run_id_idx
  on public.token_ledger(generation_run_id);
create index token_ledger_event_type_idx
  on public.token_ledger(event_type);
create index token_ledger_action_type_idx
  on public.token_ledger(action_type);

insert into public.token_price_config (key, token_cost, is_active)
values
  ('STAGE_1', 2, true),
  ('STAGE_2', 2, true),
  ('STAGE_3', 4, true),
  ('STAGE_4', 4, true),
  ('STAGE_5', 5, true),
  ('EDIT_REMOVE', 1, true),
  ('EDIT_SWAP', 2, true),
  ('EDIT_MOVE', 1, true),
  ('EDIT_ROTATE', 1, true)
on conflict (key) do update
set
  token_cost = excluded.token_cost,
  is_active = excluded.is_active,
  updated_at = now();

alter table public.user_token_wallets enable row level security;
alter table public.token_ledger enable row level security;
alter table public.token_price_config enable row level security;

create policy "user_token_wallets_owner_all"
on public.user_token_wallets
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "token_ledger_owner_all"
on public.token_ledger
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "token_price_config_read_all"
on public.token_price_config
for select
using (auth.uid() is not null);

create trigger set_timestamp_user_token_wallets
before update on public.user_token_wallets
for each row execute function public.set_timestamp();

create trigger set_timestamp_token_price_config
before update on public.token_price_config
for each row execute function public.set_timestamp();
