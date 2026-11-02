-- Explicit REMOVE vocabulary profile bound to an ORIGINAL SHA-256.
-- Existing rooms stay unset. Authenticated clients cannot write these
-- columns. The service role writes them after owner and ORIGINAL checks.
-- Review this file before applying it to hosted Supabase. Do not apply it
-- from application startup.

begin;

alter table public.vibode_rooms
  add column if not exists remove_vocabulary_profile text;

alter table public.vibode_rooms
  add column if not exists remove_vocabulary_original_sha256 text;

alter table public.vibode_rooms
  drop constraint if exists vibode_rooms_remove_vocabulary_profile_pair;

alter table public.vibode_rooms
  add constraint vibode_rooms_remove_vocabulary_profile_pair
  check (
    (
      remove_vocabulary_profile is null
      and remove_vocabulary_original_sha256 is null
    )
    or (
      remove_vocabulary_profile in ('default', 'bedroom')
      and remove_vocabulary_original_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

create or replace function public.protect_remove_vocabulary_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'authenticated'
    and (
      (
        tg_op = 'INSERT'
        and (
          new.remove_vocabulary_profile is not null
          or new.remove_vocabulary_original_sha256 is not null
        )
      )
      or (
        tg_op = 'UPDATE'
        and (
          new.remove_vocabulary_profile is distinct from old.remove_vocabulary_profile
          or new.remove_vocabulary_original_sha256 is distinct from old.remove_vocabulary_original_sha256
        )
      )
    )
  then
    raise exception 'remove vocabulary profile is server-managed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_remove_vocabulary_profile
  on public.vibode_rooms;

create trigger protect_remove_vocabulary_profile
before insert or update on public.vibode_rooms
for each row execute function public.protect_remove_vocabulary_profile();

comment on column public.vibode_rooms.remove_vocabulary_profile is
  'Explicit REMOVE vocabulary. Null, or default, or bedroom. Server-managed.';

comment on column public.vibode_rooms.remove_vocabulary_original_sha256 is
  'ORIGINAL SHA-256 bound to remove_vocabulary_profile. Server-managed.';

commit;
