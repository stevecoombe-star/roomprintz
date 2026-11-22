-- Editable My Furniture dimensions.
--
-- Authored width, height, and depth remain the immutable measurement of
-- the stored GLB. Display dimensions are the customer's default size for
-- a future placement. Existing rows keep null display dimensions, so they
-- continue to use the authored size. This file does not update a saved
-- room, a GLB, a credit balance, or a generation control.

begin;

alter table public.vibode_furniture_assets
  add column display_width_m numeric null,
  add column display_height_m numeric null,
  add column display_depth_m numeric null,
  add column dimension_sizing_mode text not null default 'uniform';

alter table public.vibode_furniture_assets
  add constraint vibode_furniture_assets_display_dimensions
  check (
    dimension_sizing_mode in ('uniform', 'exact')
    and (
      (
        display_width_m is null
        and display_height_m is null
        and display_depth_m is null
      )
      or (
        display_width_m is not null
        and display_height_m is not null
        and display_depth_m is not null
        and display_width_m >= 0.05 and display_width_m <= 8
        and display_height_m >= 0.05 and display_height_m <= 8
        and display_depth_m >= 0.05 and display_depth_m <= 8
      )
    )
  );

create or replace function public.vibode_furniture_assets_protect_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.asset_id is distinct from OLD.asset_id
    or NEW.user_id is distinct from OLD.user_id
    or NEW.origin is distinct from OLD.origin
    or NEW.authored_width_m is distinct from OLD.authored_width_m
    or NEW.authored_height_m is distinct from OLD.authored_height_m
    or NEW.authored_depth_m is distinct from OLD.authored_depth_m
    or NEW.sha256 is distinct from OLD.sha256
    or NEW.byte_size is distinct from OLD.byte_size
    or NEW.storage_bucket is distinct from OLD.storage_bucket
    or NEW.storage_object_path is distinct from OLD.storage_object_path
    or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'VIBODE_FURNITURE_ASSET:IMMUTABLE';
  end if;
  return NEW;
end;
$$;

comment on column public.vibode_furniture_assets.display_width_m is
  'Customer default width in metres. Null uses authored_width_m.';
comment on column public.vibode_furniture_assets.display_height_m is
  'Customer default height in metres. Null uses authored_height_m.';
comment on column public.vibode_furniture_assets.display_depth_m is
  'Customer default depth in metres. Null uses authored_depth_m.';
comment on column public.vibode_furniture_assets.dimension_sizing_mode is
  'uniform keeps current proportions. exact allows each side to differ.';

commit;
