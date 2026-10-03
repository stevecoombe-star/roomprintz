-- Per-room STAGE calibration. This does not alter AFC generation evidence
-- or authority.metric.metricScale. Existing rooms stay at 1.00 via the default.

begin;

alter table public.vibode_rooms
  add column if not exists room_scale_multiplier double precision not null default 1.0;

alter table public.vibode_rooms
  drop constraint if exists vibode_rooms_room_scale_multiplier_range;

alter table public.vibode_rooms
  add constraint vibode_rooms_room_scale_multiplier_range
  check (
    room_scale_multiplier >= 0.75
    and room_scale_multiplier <= 1.25
  );

commit;
