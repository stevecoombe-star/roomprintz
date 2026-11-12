-- MESHY-1D.3D owner allowance read.
--
-- A signed-in tester can read only the allowance row for the user id the
-- server passes in. The function does not grant, reserve, or change the
-- global generation controls. Missing rows stay unapproved with a zero
-- balance. Browser roles cannot execute it.
--
-- Review before applying. Do not apply to hosted Supabase without approval.

begin;

create or replace function public.read_vibode_furniture_generation_owner_allowance(
  p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_furniture_generation_allowances%rowtype;
  v_remaining integer;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_row
  from public.vibode_furniture_generation_allowances
  where user_id = p_user_id;
  if not found then
    return jsonb_build_object(
      'ok', true,
      'approved', false,
      'enabled', false,
      'authorized', 0,
      'reserved', 0,
      'consumed', 0,
      'remaining', 0
    );
  end if;

  v_remaining := greatest(
    v_row.authorized_generations - v_row.reserved_generations - v_row.consumed_generations,
    0
  );
  return jsonb_build_object(
    'ok', true,
    'approved', true,
    'enabled', v_row.enabled,
    'authorized', v_row.authorized_generations,
    'reserved', v_row.reserved_generations,
    'consumed', v_row.consumed_generations,
    'remaining', v_remaining
  );
end;
$fn$;

comment on function public.read_vibode_furniture_generation_owner_allowance(uuid) is
  'Reads one tester allowance. It does not grant generations or change spending controls.';

revoke all on function public.read_vibode_furniture_generation_owner_allowance(uuid) from public, anon, authenticated;
grant execute on function public.read_vibode_furniture_generation_owner_allowance(uuid) to service_role;

commit;
