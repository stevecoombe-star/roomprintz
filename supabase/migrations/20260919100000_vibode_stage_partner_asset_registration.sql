-- PI-5G5B1: Partner runtime Asset registration authority.
--
-- Validated G5A intake → explicit Register Asset → deterministic Asset ID
-- → private final object provenance → unavailable technical Asset →
-- Partner↔Asset eligibility → intake.asset_id link.
--
-- Privacy: do not add storage_object_path / sha256 / source onto public
-- vibode_stage_assets (anon/authenticated SELECT using true). Technical
-- storage authority lives in private vibode_stage_asset_storage.
-- Partner mapping is service-role only.
--
-- G5B1 does not mark Assets ready, does not create runtime overlay, does
-- not mint browser upload tokens for assets/{assetId}/model.glb, and does
-- not mutate Products, Variants, Scenes, or frozen v1–v4 publish RPCs.

begin;

alter table public.vibode_stage_partner_asset_intakes
  add column asset_id text null references public.vibode_stage_assets (asset_id)
    on delete restrict;

create unique index vibode_stage_partner_asset_intakes_asset_id_uidx
  on public.vibode_stage_partner_asset_intakes (asset_id)
  where asset_id is not null;

create table public.vibode_stage_asset_storage (
  asset_id text primary key references public.vibode_stage_assets (asset_id)
    on delete restrict,
  storage_bucket text not null,
  storage_object_path text not null,
  sha256 text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint vibode_stage_asset_storage_bucket_len
    check (char_length(storage_bucket) between 1 and 128),
  constraint vibode_stage_asset_storage_path_len
    check (char_length(storage_object_path) between 1 and 1024),
  constraint vibode_stage_asset_storage_path_safe
    check (
      position('..' in storage_object_path) = 0
      and storage_object_path not like '/%'
    ),
  constraint vibode_stage_asset_storage_sha256_hex
    check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint vibode_stage_asset_storage_source_closed
    check (source in ('certified_static', 'partner_intake'))
);

create unique index vibode_stage_asset_storage_object_path_uidx
  on public.vibode_stage_asset_storage (storage_bucket, storage_object_path);

create table public.vibode_stage_partner_assets (
  partner_id text not null references public.vibode_stage_partners (partner_id)
    on delete restrict,
  asset_id text not null references public.vibode_stage_assets (asset_id)
    on delete restrict,
  intake_id uuid null references public.vibode_stage_partner_asset_intakes (intake_id)
    on delete restrict,
  created_at timestamptz not null default now(),
  primary key (partner_id, asset_id)
);

create unique index vibode_stage_partner_assets_intake_id_uidx
  on public.vibode_stage_partner_assets (intake_id)
  where intake_id is not null;

create index vibode_stage_partner_assets_asset_id_idx
  on public.vibode_stage_partner_assets (asset_id);

create index vibode_stage_partner_assets_partner_id_idx
  on public.vibode_stage_partner_assets (partner_id);

alter table public.vibode_stage_asset_storage enable row level security;
alter table public.vibode_stage_partner_assets enable row level security;

revoke all on table public.vibode_stage_asset_storage
  from public, anon, authenticated;
revoke all on table public.vibode_stage_partner_assets
  from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_stage_asset_storage
  to service_role;
grant select, insert, update, delete on table public.vibode_stage_partner_assets
  to service_role;

-- Legacy Partner Asset eligibility from existing Partner Product/Variant
-- references. Distinct (partner_id, current_asset_id). Curated-only Products
-- are excluded by source/partner_id. Does not mutate Products or Variants.
insert into public.vibode_stage_partner_assets (
  partner_id,
  asset_id,
  intake_id
)
select distinct
  products.partner_id,
  variants.current_asset_id,
  null::uuid
from public.vibode_stage_products as products
join public.vibode_stage_variants as variants
  on variants.product_id = products.product_id
where products.source = 'partner_catalog'
  and products.partner_id is not null
  and variants.current_asset_id is not null
on conflict (partner_id, asset_id) do nothing;

create or replace function public.vibode_stage_protect_partner_intake_asset_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.vibode_stage_asset_storage as storage
    where storage.asset_id = OLD.asset_id
      and storage.source = 'partner_intake'
  ) then
    if NEW.asset_id is distinct from OLD.asset_id
      or NEW.glb_url is distinct from OLD.glb_url
      or NEW.authored_width_m is distinct from OLD.authored_width_m
      or NEW.authored_height_m is distinct from OLD.authored_height_m
      or NEW.authored_depth_m is distinct from OLD.authored_depth_m
    then
      raise exception 'VIBODE_STAGE_ASSET:IMMUTABLE_PARTNER_INTAKE_ASSET';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger vibode_stage_protect_partner_intake_assets
before update on public.vibode_stage_assets
for each row execute function public.vibode_stage_protect_partner_intake_asset_row();

create or replace function public.vibode_stage_protect_asset_storage_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.asset_id is distinct from OLD.asset_id
    or NEW.storage_bucket is distinct from OLD.storage_bucket
    or NEW.storage_object_path is distinct from OLD.storage_object_path
    or NEW.sha256 is distinct from OLD.sha256
    or NEW.source is distinct from OLD.source
    or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'VIBODE_STAGE_ASSET:STORAGE_IMMUTABLE';
  end if;
  return NEW;
end;
$$;

create trigger vibode_stage_protect_asset_storage
before update on public.vibode_stage_asset_storage
for each row execute function public.vibode_stage_protect_asset_storage_row();

create or replace function public.vibode_stage_protect_intake_asset_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if OLD.asset_id is not null and NEW.asset_id is distinct from OLD.asset_id then
    raise exception 'VIBODE_STAGE_ASSET:INTAKE_ASSET_ID_IMMUTABLE';
  end if;
  return NEW;
end;
$$;

create trigger vibode_stage_protect_intake_asset_id
before update on public.vibode_stage_partner_asset_intakes
for each row execute function public.vibode_stage_protect_intake_asset_id();

create or replace function public.vibode_stage_register_partner_asset(p_register jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id text;
  v_intake_id uuid;
  v_asset_id text;
  v_glb_url text;
  v_width numeric;
  v_height numeric;
  v_depth numeric;
  v_status text;
  v_bucket text;
  v_object_path text;
  v_sha256 text;
  v_source text;
  v_placement numeric;
  v_intake public.vibode_stage_partner_asset_intakes%rowtype;
  v_expected_asset_id text;
  v_expected_glb text;
  v_expected_path text;
  v_asset public.vibode_stage_assets%rowtype;
  v_storage public.vibode_stage_asset_storage%rowtype;
  v_mapping public.vibode_stage_partner_assets%rowtype;
  v_now timestamptz;
begin
  if p_register is null or jsonb_typeof(p_register) <> 'object' then
    raise exception 'VIBODE_STAGE_ASSET:INVALID_REQUEST';
  end if;

  v_partner_id := nullif(btrim(p_register->>'partnerId'), '');
  begin
    v_intake_id := nullif(btrim(p_register->>'intakeId'), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'VIBODE_STAGE_ASSET:INTAKE_NOT_FOUND';
  end;
  v_asset_id := nullif(btrim(p_register->>'assetId'), '');
  v_glb_url := nullif(btrim(p_register->>'glbUrl'), '');
  v_status := nullif(btrim(p_register->>'status'), '');
  v_bucket := nullif(btrim(p_register->>'storageBucket'), '');
  v_object_path := nullif(btrim(p_register->>'storageObjectPath'), '');
  v_sha256 := nullif(btrim(p_register->>'sha256'), '');
  v_source := nullif(btrim(p_register->>'source'), '');

  begin
    v_width := (p_register->>'authoredWidthM')::numeric;
    v_height := (p_register->>'authoredHeightM')::numeric;
    v_depth := (p_register->>'authoredDepthM')::numeric;
    v_placement := (p_register->>'placementScale')::numeric;
  exception
    when invalid_text_representation then
      raise exception 'VIBODE_STAGE_ASSET:INVALID_REQUEST';
  end;

  if v_partner_id is null or v_intake_id is null or v_asset_id is null
    or v_glb_url is null or v_width is null or v_height is null or v_depth is null
    or v_status is null or v_bucket is null or v_object_path is null
    or v_sha256 is null or v_source is null or v_placement is null
  then
    raise exception 'VIBODE_STAGE_ASSET:INVALID_REQUEST';
  end if;

  v_expected_asset_id := 'vibode-stage/partner-intake/' || v_intake_id::text;
  v_expected_glb := '/api/vibode/assets/' || v_expected_asset_id || '/glb';
  v_expected_path := 'assets/' || v_expected_asset_id || '/model.glb';

  if v_asset_id is distinct from v_expected_asset_id
    or v_glb_url is distinct from v_expected_glb
    or v_object_path is distinct from v_expected_path
    or v_bucket is distinct from 'vibode-stage-assets'
    or v_source is distinct from 'partner_intake'
    or v_status is distinct from 'unavailable'
    or abs(v_placement - 1) > 0.000000001
    or v_sha256 !~ '^[a-f0-9]{64}$'
    or v_asset_id like 'intake:%'
    or position('..' in v_object_path) > 0
  then
    raise exception 'VIBODE_STAGE_ASSET:INVALID_REQUEST';
  end if;

  select *
    into v_intake
  from public.vibode_stage_partner_asset_intakes
  where intake_id = v_intake_id
  for update;

  if not found then
    raise exception 'VIBODE_STAGE_ASSET:INTAKE_NOT_FOUND';
  end if;

  if v_intake.partner_id is distinct from v_partner_id then
    raise exception 'VIBODE_STAGE_ASSET:FORBIDDEN';
  end if;

  if v_intake.asset_id is not null then
    if v_intake.asset_id is distinct from v_expected_asset_id then
      raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
    end if;

    select * into v_asset
    from public.vibode_stage_assets
    where asset_id = v_expected_asset_id;

    select * into v_storage
    from public.vibode_stage_asset_storage
    where asset_id = v_expected_asset_id;

    if v_asset.asset_id is null or v_storage.asset_id is null then
      raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
    end if;
    if v_asset.glb_url is distinct from v_expected_glb
      or v_asset.authored_width_m is distinct from v_width
      or v_asset.authored_height_m is distinct from v_height
      or v_asset.authored_depth_m is distinct from v_depth
      or v_storage.storage_bucket is distinct from v_bucket
      or v_storage.storage_object_path is distinct from v_object_path
      or v_storage.sha256 is distinct from v_sha256
      or v_storage.source is distinct from 'partner_intake'
    then
      raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
    end if;

    select * into v_mapping
    from public.vibode_stage_partner_assets
    where partner_id = v_partner_id
      and asset_id = v_expected_asset_id;

    if found then
      if v_mapping.intake_id is not null
        and v_mapping.intake_id is distinct from v_intake_id
      then
        raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
      end if;
      if v_mapping.intake_id is null then
        update public.vibode_stage_partner_assets
        set intake_id = v_intake_id
        where partner_id = v_partner_id
          and asset_id = v_expected_asset_id
          and intake_id is null;
      end if;
    else
      insert into public.vibode_stage_partner_assets (
        partner_id,
        asset_id,
        intake_id
      ) values (
        v_partner_id,
        v_expected_asset_id,
        v_intake_id
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'assetId', v_asset.asset_id,
      'status', 'unavailable',
      'originalFileName', v_intake.original_filename,
      'measuredWidthM', v_asset.authored_width_m,
      'measuredHeightM', v_asset.authored_height_m,
      'measuredDepthM', v_asset.authored_depth_m,
      'sha256', v_storage.sha256,
      'registeredAt', v_asset.created_at
    );
  end if;

  if v_intake.status is distinct from 'validated' then
    raise exception 'VIBODE_STAGE_ASSET:INTAKE_NOT_VALIDATED';
  end if;
  if v_intake.sha256 is null then
    raise exception 'VIBODE_STAGE_ASSET:INTAKE_MISSING_SHA';
  end if;
  if v_intake.sha256 is distinct from v_sha256 then
    raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
  end if;
  if v_intake.measured_width_m is null
    or v_intake.measured_height_m is null
    or v_intake.measured_depth_m is null
    or v_intake.measured_width_m <= 0
    or v_intake.measured_height_m <= 0
    or v_intake.measured_depth_m <= 0
  then
    raise exception 'VIBODE_STAGE_ASSET:INTAKE_MISSING_MEASURED_DIMENSIONS';
  end if;
  if v_intake.placement_scale is null or abs(v_intake.placement_scale - 1) > 0.000000001 then
    raise exception 'VIBODE_STAGE_ASSET:INVALID_PLACEMENT_SCALE';
  end if;
  if abs(v_intake.measured_width_m - v_width) > 0.000000001
    or abs(v_intake.measured_height_m - v_height) > 0.000000001
    or abs(v_intake.measured_depth_m - v_depth) > 0.000000001
  then
    raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
  end if;
  if v_intake.dimension_source = 'product' then
    if v_intake.authored_width_m is null
      or v_intake.authored_height_m is null
      or v_intake.authored_depth_m is null
    then
      raise exception 'VIBODE_STAGE_ASSET:INTAKE_NOT_VALIDATED';
    end if;
  elsif v_intake.dimension_source = 'glb' then
    if v_intake.authored_width_m is not null
      or v_intake.authored_height_m is not null
      or v_intake.authored_depth_m is not null
    then
      raise exception 'VIBODE_STAGE_ASSET:INTAKE_NOT_VALIDATED';
    end if;
  else
    raise exception 'VIBODE_STAGE_ASSET:INTAKE_NOT_VALIDATED';
  end if;

  select * into v_asset
  from public.vibode_stage_assets
  where asset_id = v_expected_asset_id;

  if found then
    select * into v_storage
    from public.vibode_stage_asset_storage
    where asset_id = v_expected_asset_id;
    if v_storage.asset_id is null
      or v_asset.status is distinct from 'unavailable'
      or v_asset.glb_url is distinct from v_expected_glb
      or v_asset.authored_width_m is distinct from v_width
      or v_asset.authored_height_m is distinct from v_height
      or v_asset.authored_depth_m is distinct from v_depth
      or v_storage.sha256 is distinct from v_sha256
      or v_storage.storage_object_path is distinct from v_object_path
      or v_storage.source is distinct from 'partner_intake'
    then
      raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
    end if;
  else
    insert into public.vibode_stage_assets (
      asset_id,
      glb_url,
      authored_width_m,
      authored_height_m,
      authored_depth_m,
      status
    ) values (
      v_expected_asset_id,
      v_expected_glb,
      v_width,
      v_height,
      v_depth,
      'unavailable'
    )
    returning * into v_asset;

    insert into public.vibode_stage_asset_storage (
      asset_id,
      storage_bucket,
      storage_object_path,
      sha256,
      source
    ) values (
      v_expected_asset_id,
      v_bucket,
      v_object_path,
      v_sha256,
      'partner_intake'
    )
    returning * into v_storage;
  end if;

  select * into v_mapping
  from public.vibode_stage_partner_assets
  where partner_id = v_partner_id
    and asset_id = v_expected_asset_id;

  if found then
    if v_mapping.intake_id is not null
      and v_mapping.intake_id is distinct from v_intake_id
    then
      raise exception 'VIBODE_STAGE_ASSET:ASSET_INCOMPATIBLE';
    end if;
    if v_mapping.intake_id is null then
      update public.vibode_stage_partner_assets
      set intake_id = v_intake_id
      where partner_id = v_partner_id
        and asset_id = v_expected_asset_id
        and intake_id is null;
    end if;
  else
    insert into public.vibode_stage_partner_assets (
      partner_id,
      asset_id,
      intake_id
    ) values (
      v_partner_id,
      v_expected_asset_id,
      v_intake_id
    );
  end if;

  v_now := now();
  update public.vibode_stage_partner_asset_intakes
  set asset_id = v_expected_asset_id,
      updated_at = v_now
  where intake_id = v_intake_id
    and partner_id = v_partner_id
    and asset_id is null;
  if not found then
    raise exception 'VIBODE_STAGE_ASSET:REGISTRATION_CONFLICT';
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'assetId', v_asset.asset_id,
    'status', 'unavailable',
    'originalFileName', v_intake.original_filename,
    'measuredWidthM', v_asset.authored_width_m,
    'measuredHeightM', v_asset.authored_height_m,
    'measuredDepthM', v_asset.authored_depth_m,
    'sha256', v_storage.sha256,
    'registeredAt', v_asset.created_at
  );
end;
$$;

revoke all on function public.vibode_stage_register_partner_asset(jsonb)
  from public, anon, authenticated;
grant execute on function public.vibode_stage_register_partner_asset(jsonb)
  to service_role;

revoke all on function public.vibode_stage_protect_partner_intake_asset_row()
  from public, anon, authenticated;
revoke all on function public.vibode_stage_protect_asset_storage_row()
  from public, anon, authenticated;
revoke all on function public.vibode_stage_protect_intake_asset_id()
  from public, anon, authenticated;

commit;
