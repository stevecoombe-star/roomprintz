-- PI-5G5A follow-up: persist explicit Partner intake dimension authority.
--
-- Historical 20260918100000_vibode_stage_partner_asset_intakes.sql remains
-- authored_width/height/depth NOT NULL at creation.
-- Historical 20260918110000_vibode_stage_partner_asset_intake_50mib.sql remains
-- the 50 MiB ceiling. Do not rewrite those files.
--
-- dimension_source is explicit authority, not inferred from numbers:
--   product = Partner-entered metres compared to measured GLB
--   glb     = testing shortcut; measured GLB becomes effective dimensions
-- Existing rows default to product.

begin;

alter table public.vibode_stage_partner_asset_intakes
  add column dimension_source text not null default 'product';

alter table public.vibode_stage_partner_asset_intakes
  drop constraint vibode_stage_partner_asset_intakes_authored_width_positive;

alter table public.vibode_stage_partner_asset_intakes
  drop constraint vibode_stage_partner_asset_intakes_authored_height_positive;

alter table public.vibode_stage_partner_asset_intakes
  drop constraint vibode_stage_partner_asset_intakes_authored_depth_positive;

alter table public.vibode_stage_partner_asset_intakes
  alter column authored_width_m drop not null;

alter table public.vibode_stage_partner_asset_intakes
  alter column authored_height_m drop not null;

alter table public.vibode_stage_partner_asset_intakes
  alter column authored_depth_m drop not null;

alter table public.vibode_stage_partner_asset_intakes
  add constraint vibode_stage_partner_asset_intakes_dimension_source_closed
    check (dimension_source in ('product', 'glb'));

alter table public.vibode_stage_partner_asset_intakes
  add constraint vibode_stage_partner_asset_intakes_authored_width_positive
    check (authored_width_m is null or authored_width_m > 0);

alter table public.vibode_stage_partner_asset_intakes
  add constraint vibode_stage_partner_asset_intakes_authored_height_positive
    check (authored_height_m is null or authored_height_m > 0);

alter table public.vibode_stage_partner_asset_intakes
  add constraint vibode_stage_partner_asset_intakes_authored_depth_positive
    check (authored_depth_m is null or authored_depth_m > 0);

alter table public.vibode_stage_partner_asset_intakes
  add constraint vibode_stage_partner_asset_intakes_dimension_source_authored
    check (
      (
        dimension_source = 'product'
        and authored_width_m is not null
        and authored_height_m is not null
        and authored_depth_m is not null
      )
      or
      (
        dimension_source = 'glb'
        and authored_width_m is null
        and authored_height_m is null
        and authored_depth_m is null
      )
    );

commit;
