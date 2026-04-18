create table if not exists public.vibode_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  domain text,
  affiliate_network text,
  default_commission_type text,
  default_commission_value numeric,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vibode_partners
  add column if not exists slug text,
  add column if not exists domain text,
  add column if not exists affiliate_network text,
  add column if not exists default_commission_type text,
  add column if not exists default_commission_value numeric,
  add column if not exists is_active boolean not null default true,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.vibode_user_furniture
  add column if not exists partner_id uuid references public.vibode_partners(id) on delete set null,
  add column if not exists affiliate_url text,
  add column if not exists affiliate_network text,
  add column if not exists affiliate_last_resolved_at timestamptz,
  add column if not exists discount_percent numeric,
  add column if not exists discount_label text,
  add column if not exists discount_code text,
  add column if not exists discount_url text,
  add column if not exists discount_source text,
  add column if not exists discount_is_exclusive boolean not null default false;

alter table public.vibode_furniture_events
  add column if not exists partner_id uuid references public.vibode_partners(id) on delete set null,
  add column if not exists commercial_type text,
  add column if not exists billable_event_type text,
  add column if not exists billable_units numeric,
  add column if not exists billable_amount numeric,
  add column if not exists affiliate_url_used text,
  add column if not exists discount_applied boolean,
  add column if not exists processed_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'vibode_furniture_events'
      and c.conname = 'vibode_furniture_events_event_type_check'
  ) then
    alter table public.vibode_furniture_events
      drop constraint vibode_furniture_events_event_type_check;
  end if;
end
$$;

alter table public.vibode_furniture_events
  add constraint vibode_furniture_events_event_type_check
  check (event_type in ('added', 'swapped', 'outbound_clicked'));

create index if not exists vibode_user_furniture_partner_id_idx
  on public.vibode_user_furniture(partner_id);

create index if not exists vibode_furniture_events_partner_id_idx
  on public.vibode_furniture_events(partner_id);

create index if not exists vibode_furniture_events_commercial_type_idx
  on public.vibode_furniture_events(commercial_type);

create index if not exists vibode_furniture_events_billable_event_type_idx
  on public.vibode_furniture_events(billable_event_type);

create index if not exists vibode_partners_slug_idx
  on public.vibode_partners(slug);

create index if not exists vibode_partners_domain_idx
  on public.vibode_partners(domain);

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and p.pronargs = 0
  ) then
    create function public.set_updated_at()
    returns trigger
    language plpgsql
    as $function$
    begin
      new.updated_at = now();
      return new;
    end;
    $function$;
  end if;
end
$$;

drop trigger if exists set_updated_at_vibode_partners on public.vibode_partners;
create trigger set_updated_at_vibode_partners
before update on public.vibode_partners
for each row execute function public.set_updated_at();

alter table public.vibode_partners enable row level security;

drop policy if exists "vibode_partners_active_select" on public.vibode_partners;
create policy "vibode_partners_active_select"
on public.vibode_partners
for select
to authenticated
using (is_active = true);
