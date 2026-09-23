-- AFD-1A: Diagnostic Sessions, session-generation membership, and QA Cases.
--
-- AFC owns machine truth. Diagnostic Sessions own retry episodes.
-- Diagnostic Cases own human QA meaning.
--
-- These tables reference existing AFC generations. They do not store
-- AFC runtime geometry, EMPTY/TILED copies, or production activation
-- state. AFD-1B engine identity is out of scope.
--
-- Access is fail-closed: RLS enabled, no browser policies, no anon/
-- authenticated table grants. Service-role DML only, matching AFC
-- production privacy posture. Future tester writes go through APIs.
--
-- reviewer_user_id uses ON DELETE SET NULL so deleting a reviewer
-- account neither blocks user deletion nor deletes the Case.

begin;

create table public.vibode_afc_diagnostic_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_sha256 text not null,
  -- Snapshot-only ORIGINAL asset id. Not source authority and not an FK.
  base_asset_id uuid null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_afc_diagnostic_sessions_status_closed
    check (status in ('open', 'closed')),
  constraint vibode_afc_diagnostic_sessions_original_sha256_present
    check (char_length(original_sha256) > 0)
);

-- Lookup by source anchor with recency. Timing policy is not SQL.
create index vibode_afc_diagnostic_sessions_user_room_sha_created_desc_idx
  on public.vibode_afc_diagnostic_sessions (
    user_id,
    room_id,
    original_sha256,
    created_at desc
  );

-- At most one open session per user + room + ORIGINAL sha.
create unique index vibode_afc_diagnostic_sessions_one_open_uidx
  on public.vibode_afc_diagnostic_sessions (user_id, room_id, original_sha256)
  where status = 'open';

create trigger set_timestamp_vibode_afc_diagnostic_sessions
before update on public.vibode_afc_diagnostic_sessions
for each row execute function public.set_timestamp();

-- Session identity is immutable after insert. status and updated_at may change.
-- DELETE remains available for room/user cascade.
create or replace function public.vibode_afc_diagnostic_sessions_protect_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.room_id is distinct from old.room_id
    or new.user_id is distinct from old.user_id
    or new.original_sha256 is distinct from old.original_sha256
    or new.base_asset_id is distinct from old.base_asset_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'AFC diagnostic session identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists vibode_afc_diagnostic_sessions_protect_identity
  on public.vibode_afc_diagnostic_sessions;

create trigger vibode_afc_diagnostic_sessions_protect_identity
before update on public.vibode_afc_diagnostic_sessions
for each row execute function public.vibode_afc_diagnostic_sessions_protect_identity();

create table public.vibode_afc_diagnostic_session_generations (
  session_id uuid not null
    references public.vibode_afc_diagnostic_sessions(id) on delete cascade,
  generation_id uuid not null
    references public.vibode_afc_generations(id) on delete cascade,
  attempt_ordinal integer not null,
  intent text not null,
  associated_at timestamptz not null default now(),
  primary key (session_id, generation_id),
  constraint vibode_afc_diagnostic_session_generations_generation_id_key
    unique (generation_id),
  constraint vibode_afc_diagnostic_session_generations_session_ordinal_key
    unique (session_id, attempt_ordinal),
  constraint vibode_afc_diagnostic_session_generations_ordinal_positive
    check (attempt_ordinal > 0),
  constraint vibode_afc_diagnostic_session_generations_intent_closed
    check (intent in ('analyze', 'run_again', 'reread_perspective'))
);

-- Append-only membership. DELETE remains available for FK cascade.
create or replace function public.vibode_afc_diagnostic_session_generations_protect_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'AFC diagnostic session generation membership is immutable';
end;
$$;

drop trigger if exists vibode_afc_diagnostic_session_generations_protect_membership
  on public.vibode_afc_diagnostic_session_generations;

create trigger vibode_afc_diagnostic_session_generations_protect_membership
before update on public.vibode_afc_diagnostic_session_generations
for each row execute function public.vibode_afc_diagnostic_session_generations_protect_membership();

create table public.vibode_afc_diagnostic_cases (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.vibode_afc_diagnostic_sessions(id) on delete cascade,
  room_id uuid not null
    references public.vibode_rooms(id) on delete cascade,
  reporter_user_id uuid not null
    references auth.users(id) on delete cascade,
  reported_generation_id uuid not null
    references public.vibode_afc_generations(id) on delete cascade,
  original_sha256 text not null,
  original_identity jsonb null,
  taxonomy_version text not null,
  issue_codes text[] not null,
  notes text null,
  "trigger" text not null,
  machine_status_snapshot text not null,
  submitted_at timestamptz not null default now(),
  review_status text not null default 'new',
  reviewer_user_id uuid null
    references auth.users(id) on delete set null,
  review_notes text null,
  reviewed_at timestamptz null,
  constraint vibode_afc_diagnostic_cases_original_sha256_present
    check (char_length(original_sha256) > 0),
  constraint vibode_afc_diagnostic_cases_taxonomy_version_present
    check (char_length(taxonomy_version) > 0),
  constraint vibode_afc_diagnostic_cases_issue_codes_nonempty
    check (cardinality(issue_codes) >= 1),
  constraint vibode_afc_diagnostic_cases_issue_codes_no_null
    check (array_position(issue_codes, null) is null),
  constraint vibode_afc_diagnostic_cases_notes_len
    check (notes is null or char_length(notes) <= 2000),
  constraint vibode_afc_diagnostic_cases_trigger_closed
    check ("trigger" in ('repeated_unsuccessful', 'manual_report', 'admin_capture')),
  constraint vibode_afc_diagnostic_cases_machine_status_closed
    check (machine_status_snapshot in ('ready', 'failed', 'running')),
  constraint vibode_afc_diagnostic_cases_review_status_closed
    check (review_status in ('new', 'in_review', 'closed')),
  constraint vibode_afc_diagnostic_cases_review_notes_len
    check (review_notes is null or char_length(review_notes) <= 2000),
  constraint vibode_afc_diagnostic_cases_original_identity_object
    check (
      original_identity is null
      or jsonb_typeof(original_identity) = 'object'
    )
);

create index vibode_afc_diagnostic_cases_session_id_idx
  on public.vibode_afc_diagnostic_cases (session_id);

create index vibode_afc_diagnostic_cases_room_id_idx
  on public.vibode_afc_diagnostic_cases (room_id);

create index vibode_afc_diagnostic_cases_reporter_user_id_idx
  on public.vibode_afc_diagnostic_cases (reporter_user_id);

create index vibode_afc_diagnostic_cases_reported_generation_id_idx
  on public.vibode_afc_diagnostic_cases (reported_generation_id);

-- Tester evidence is immutable after insert. Review metadata may change.
-- DELETE remains available for session/room/user/generation cascade.
create or replace function public.vibode_afc_diagnostic_cases_protect_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.session_id is distinct from old.session_id
    or new.room_id is distinct from old.room_id
    or new.reporter_user_id is distinct from old.reporter_user_id
    or new.reported_generation_id is distinct from old.reported_generation_id
    or new.original_sha256 is distinct from old.original_sha256
    or new.original_identity is distinct from old.original_identity
    or new.taxonomy_version is distinct from old.taxonomy_version
    or new.issue_codes is distinct from old.issue_codes
    or new.notes is distinct from old.notes
    or new."trigger" is distinct from old."trigger"
    or new.machine_status_snapshot is distinct from old.machine_status_snapshot
    or new.submitted_at is distinct from old.submitted_at
  then
    raise exception 'AFC diagnostic case evidence is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists vibode_afc_diagnostic_cases_protect_evidence
  on public.vibode_afc_diagnostic_cases;

create trigger vibode_afc_diagnostic_cases_protect_evidence
before update on public.vibode_afc_diagnostic_cases
for each row execute function public.vibode_afc_diagnostic_cases_protect_evidence();

alter table public.vibode_afc_diagnostic_sessions enable row level security;
alter table public.vibode_afc_diagnostic_session_generations enable row level security;
alter table public.vibode_afc_diagnostic_cases enable row level security;

revoke all on table public.vibode_afc_diagnostic_sessions
  from public, anon, authenticated;
revoke all on table public.vibode_afc_diagnostic_session_generations
  from public, anon, authenticated;
revoke all on table public.vibode_afc_diagnostic_cases
  from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_afc_diagnostic_sessions
  to service_role;
grant select, insert, update, delete on table public.vibode_afc_diagnostic_session_generations
  to service_role;
grant select, insert, update, delete on table public.vibode_afc_diagnostic_cases
  to service_role;

commit;
