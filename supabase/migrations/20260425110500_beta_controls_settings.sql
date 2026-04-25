create table if not exists public.beta_settings (
  id text primary key default 'global',
  beta_access_code text not null,
  default_topup_limit integer not null default 1,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'beta_settings_default_topup_limit_nonnegative'
      and conrelid = 'public.beta_settings'::regclass
  ) then
    alter table public.beta_settings
      add constraint beta_settings_default_topup_limit_nonnegative
      check (default_topup_limit >= 0);
  end if;
end
$$;

insert into public.beta_settings (id, beta_access_code, default_topup_limit)
values ('global', 'VIBODE-BETA', 1)
on conflict (id) do nothing;

create table if not exists public.beta_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  beta_topup_limit integer null,
  updated_at timestamptz not null default now(),
  constraint beta_user_settings_beta_topup_limit_nonnegative
    check (beta_topup_limit is null or beta_topup_limit >= 0)
);
