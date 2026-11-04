-- BRING-4B: owner-scoped SAM 3 snapshots and Bring Forward selections.
--
-- The shared vibode_rooms.metadata document is not updated here. A snapshot
-- is the validated packed-mask payload, capped at the scan response size.
-- A selection names that snapshot and a revision. Writers compare the
-- revision, so an older save cannot replace a newer one.
--
-- service_role is the only database role that can read or write these tables.
-- Authenticated clients have no privileges and no policies. The application
-- reads and writes through its own routes after an ownership check.
-- There is no Storage bucket and no public URL.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.

begin;

create table public.vibode_bring_forward_snapshots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid not null,
  original_sha256 text not null,
  original_width integer not null,
  original_height integer not null,
  vocabulary_profile text not null,
  concept_set text not null,
  payload text not null,
  payload_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint vibode_bring_forward_snapshots_sha
    check (original_sha256 ~ '^[0-9a-f]{64}$' and payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_bring_forward_snapshots_profile
    check (vocabulary_profile in ('default', 'bedroom')),
  constraint vibode_bring_forward_snapshots_concept
    check (char_length(concept_set) between 1 and 80),
  constraint vibode_bring_forward_snapshots_dimensions
    check (
      original_width > 0
      and original_height > 0
      and original_width::bigint * original_height::bigint <= 16000000
    ),
  constraint vibode_bring_forward_snapshots_payload_bytes
    check (octet_length(payload) between 1 and 8000000)
);

create unique index vibode_bring_forward_snapshots_identity_uidx
  on public.vibode_bring_forward_snapshots (
    room_id,
    generation_id,
    original_sha256,
    original_width,
    original_height,
    vocabulary_profile,
    payload_sha256
  );

create index vibode_bring_forward_snapshots_lookup_idx
  on public.vibode_bring_forward_snapshots (
    user_id,
    room_id,
    generation_id,
    original_sha256,
    vocabulary_profile,
    created_at desc,
    id desc
  );

create table public.vibode_bring_forward_selections (
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  generation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_sha256 text not null,
  original_width integer not null,
  original_height integer not null,
  vocabulary_profile text not null,
  snapshot_id uuid not null references public.vibode_bring_forward_snapshots(id) on delete cascade,
  selected_ids jsonb not null,
  revision bigint not null,
  updated_at timestamptz not null default now(),
  primary key (
    user_id,
    room_id,
    generation_id,
    original_sha256,
    original_width,
    original_height,
    vocabulary_profile
  ),
  constraint vibode_bring_forward_selections_sha
    check (original_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_bring_forward_selections_profile
    check (vocabulary_profile in ('default', 'bedroom')),
  constraint vibode_bring_forward_selections_dimensions
    check (
      original_width > 0
      and original_height > 0
      and original_width::bigint * original_height::bigint <= 16000000
    ),
  constraint vibode_bring_forward_selections_revision
    check (revision > 0),
  constraint vibode_bring_forward_selections_ids
    check (
      jsonb_typeof(selected_ids) = 'array'
      and jsonb_array_length(selected_ids) <= 48
    )
);

alter table public.vibode_bring_forward_snapshots enable row level security;
alter table public.vibode_bring_forward_selections enable row level security;

revoke all on table public.vibode_bring_forward_snapshots from public, anon, authenticated;
revoke all on table public.vibode_bring_forward_selections from public, anon, authenticated;
grant select, insert, update, delete on table public.vibode_bring_forward_snapshots to service_role;
grant select, insert, update, delete on table public.vibode_bring_forward_selections to service_role;

comment on table public.vibode_bring_forward_snapshots is
  'Validated SAM 3 packed-mask snapshots. service_role writes them after ownership checks. Clients have no table privileges.';

comment on table public.vibode_bring_forward_selections is
  'Committed Bring Forward object ids bound to one snapshot. revision advances only when the caller has the current revision.';

commit;
