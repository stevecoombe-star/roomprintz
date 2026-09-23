-- PI-5G5B2: Partner runtime Asset activation authority.
--
-- Mapped Partner → private provenance → signed GET transport proof
-- (application layer) → status unavailable → ready.
-- Ready is global technical runtime state. This RPC updates status only.
-- It does not mutate immutable technical fields, Products, Variants,
-- Scenes, or frozen v1–v4 publish RPCs.

begin;

create or replace function public.vibode_stage_activate_partner_asset(p_activate jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id text;
  v_asset_id text;
  v_asset public.vibode_stage_assets%rowtype;
  v_storage public.vibode_stage_asset_storage%rowtype;
  v_mapping public.vibode_stage_partner_assets%rowtype;
  v_idempotent boolean;
begin
  if p_activate is null or jsonb_typeof(p_activate) <> 'object' then
    raise exception 'VIBODE_STAGE_ASSET:INVALID_REQUEST';
  end if;

  v_partner_id := nullif(btrim(p_activate->>'partnerId'), '');
  v_asset_id := nullif(btrim(p_activate->>'assetId'), '');

  if v_partner_id is null or v_asset_id is null then
    raise exception 'VIBODE_STAGE_ASSET:INVALID_REQUEST';
  end if;

  select *
    into v_asset
  from public.vibode_stage_assets
  where asset_id = v_asset_id
  for update;

  if not found then
    raise exception 'VIBODE_STAGE_ASSET:ASSET_NOT_FOUND';
  end if;

  select *
    into v_mapping
  from public.vibode_stage_partner_assets
  where partner_id = v_partner_id
    and asset_id = v_asset_id;

  if not found then
    raise exception 'VIBODE_STAGE_ASSET:FORBIDDEN';
  end if;

  select *
    into v_storage
  from public.vibode_stage_asset_storage
  where asset_id = v_asset_id;

  if not found then
    raise exception 'VIBODE_STAGE_ASSET:ASSET_NOT_FOUND';
  end if;

  if v_storage.source is distinct from 'partner_intake' then
    raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
  end if;

  if v_asset.status is distinct from 'unavailable'
    and v_asset.status is distinct from 'ready'
  then
    raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
  end if;

  v_idempotent := v_asset.status is not distinct from 'ready';

  if not v_idempotent then
    update public.vibode_stage_assets
    set status = 'ready'
    where asset_id = v_asset_id
      and status = 'unavailable';
    if not found then
      raise exception 'VIBODE_STAGE_ASSET:ACTIVATION_CONFLICT';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', v_idempotent,
    'assetId', v_asset_id,
    'status', 'ready'
  );
end;
$$;

revoke all on function public.vibode_stage_activate_partner_asset(jsonb)
  from public, anon, authenticated;
grant execute on function public.vibode_stage_activate_partner_asset(jsonb)
  to service_role;

commit;
