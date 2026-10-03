-- Widen the per-room STAGE room-scale calibration range to 0.50–1.50.
-- Certified AFC metricScale and existing 1.00 defaults stay unchanged.

begin;

alter table public.vibode_rooms
  drop constraint if exists vibode_rooms_room_scale_multiplier_range;

alter table public.vibode_rooms
  add constraint vibode_rooms_room_scale_multiplier_range
  check (
    room_scale_multiplier >= 0.50
    and room_scale_multiplier <= 1.50
  );

commit;
