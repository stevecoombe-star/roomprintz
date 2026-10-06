-- Widen the per-room STAGE room-scale calibration range to 0.25–2.00
-- for beta/demo. Certified AFC metricScale stays unchanged.

begin;

alter table public.vibode_rooms
  drop constraint if exists vibode_rooms_room_scale_multiplier_range;

alter table public.vibode_rooms
  add constraint vibode_rooms_room_scale_multiplier_range
  check (
    room_scale_multiplier >= 0.25
    and room_scale_multiplier <= 2.00
  );

commit;
