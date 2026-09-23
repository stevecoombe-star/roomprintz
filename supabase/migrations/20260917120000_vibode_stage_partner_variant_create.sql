-- PI-5G4a: STAGE Partner Portal Variant-create publish executor (planVersion 2).
--
-- Adds a create-capable RPC beside frozen G3
-- public.vibode_stage_apply_partner_patch(jsonb) (planVersion 1).
-- Does not rewrite the v1 function. Does not execute rendered SQL text.
-- Does not mutate Assets or Scenes. Does not change a Product default Variant.
-- Schema + function only. Do not seed publish rows.

begin;

create or replace function public.vibode_stage_apply_partner_patch_v2(p_apply jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id text;
  v_user_id uuid;
  v_draft_id uuid;
  v_draft_revision bigint;
  v_source text;
  v_mode text;
  v_document jsonb;
  v_plan jsonb;
  v_base_hash text;
  v_pre_hash text;
  v_existing_publish_id uuid;
  v_existing_status text;
  v_draft_partner text;
  v_draft_status text;
  v_draft_revision_found bigint;
  v_publish_id uuid;
  v_updated integer;
  v_deleted integer;
  v_item jsonb;
  v_change jsonb;
  v_product_id text;
  v_variant_id text;
  v_collection_id text;
  v_column text;
  v_sku text;
  v_sort_order integer;
  v_set_name boolean;
  v_set_image boolean;
  v_set_url boolean;
  v_set_price boolean;
  v_set_finish boolean;
  v_set_sku boolean;
  v_prev_name text;
  v_next_name text;
  v_prev_image text;
  v_next_image text;
  v_prev_url text;
  v_next_url text;
  v_prev_price numeric;
  v_next_price numeric;
  v_prev_finish text;
  v_next_finish text;
  v_prev_sku text;
  v_next_sku text;
  v_has_product boolean;
  v_has_variant boolean;
  v_has_create boolean;
  v_has_collection boolean;
  v_has_add boolean;
  v_has_remove boolean;
  v_asset_id text;
  v_price_currency text;
  v_finish text;
begin
  if p_apply is null or jsonb_typeof(p_apply) <> 'object' then
    raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
  end if;
  if jsonb_typeof(p_apply->'planVersion') <> 'number' or (p_apply->>'planVersion')::integer <> 2 then
    raise exception 'VIBODE_STAGE_PUBLISH:PLAN_VERSION_UNSUPPORTED';
  end if;

  v_partner_id := nullif(btrim(p_apply->>'partnerId'), '');
  v_draft_id := nullif(p_apply->>'draftId', '')::uuid;
  v_draft_revision := nullif(p_apply->>'draftRevision', '')::bigint;
  v_source := p_apply->>'source';
  v_mode := p_apply->>'mode';
  v_document := p_apply->'document';
  v_base_hash := p_apply->>'baseCatalogHash';
  v_pre_hash := p_apply->>'prePublishCatalogHash';

  if p_apply->>'userId' is null or btrim(p_apply->>'userId') = '' then
    v_user_id := null;
  else
    v_user_id := (p_apply->>'userId')::uuid;
  end if;

  if v_partner_id is null or v_draft_id is null or v_draft_revision is null or v_draft_revision < 1 then
    raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
  end if;
  if v_source is distinct from 'portal' or v_mode is distinct from 'patch' then
    raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
  end if;
  if v_document is null or jsonb_typeof(v_document) <> 'object' then
    raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
  end if;
  if jsonb_typeof(coalesce(p_apply->'productUpdates', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_apply->'variantUpdates', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_apply->'variantCreates', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_apply->'collectionUpdates', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_apply->'membershipAdds', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_apply->'membershipRemoves', 'null'::jsonb)) <> 'array' then
    raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
  end if;
  if (p_apply ? 'productCreates' and (
        jsonb_typeof(p_apply->'productCreates') <> 'array'
        or jsonb_array_length(p_apply->'productCreates') > 0
      ))
     or (p_apply ? 'collectionCreates' and (
        jsonb_typeof(p_apply->'collectionCreates') <> 'array'
        or jsonb_array_length(p_apply->'collectionCreates') > 0
      )) then
    raise exception 'VIBODE_STAGE_PUBLISH:UNSUPPORTED_PUBLISH_OPERATION';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_partner_id, 0));

  select publish_id, status
    into v_existing_publish_id, v_existing_status
  from public.vibode_stage_partner_publishes
  where draft_id = v_draft_id
    and draft_revision = v_draft_revision
    and status in ('accepted', 'noop')
  limit 1;

  if v_existing_publish_id is not null then
    return jsonb_build_object(
      'ok', true,
      'status', v_existing_status,
      'publishId', v_existing_publish_id,
      'idempotent', true
    );
  end if;

  select partner_id, status, revision
    into v_draft_partner, v_draft_status, v_draft_revision_found
  from public.vibode_stage_partner_drafts
  where draft_id = v_draft_id
    and partner_id = v_partner_id
  for update;

  if not found then
    raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_NOT_FOUND';
  end if;
  if v_draft_partner is distinct from v_partner_id then
    raise exception 'VIBODE_STAGE_PUBLISH:PARTNER_MISMATCH';
  end if;
  if v_draft_status = 'abandoned' then
    raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_ABANDONED';
  end if;
  if v_draft_status = 'published' then
    raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_PUBLISHED';
  end if;
  if v_draft_status is distinct from 'open' then
    raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_NOT_OPEN';
  end if;
  if v_draft_revision_found is distinct from v_draft_revision then
    raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_REVISION_MISMATCH';
  end if;

  v_plan := jsonb_build_object(
    'planVersion', p_apply->'planVersion',
    'partnerId', p_apply->'partnerId',
    'variantCreates', p_apply->'variantCreates',
    'productUpdates', p_apply->'productUpdates',
    'variantUpdates', p_apply->'variantUpdates',
    'collectionUpdates', p_apply->'collectionUpdates',
    'membershipAdds', p_apply->'membershipAdds',
    'membershipRemoves', p_apply->'membershipRemoves'
  );

  v_has_product := jsonb_array_length(p_apply->'productUpdates') > 0;
  v_has_variant := jsonb_array_length(p_apply->'variantUpdates') > 0;
  v_has_create := jsonb_array_length(p_apply->'variantCreates') > 0;
  v_has_collection := jsonb_array_length(p_apply->'collectionUpdates') > 0;
  v_has_add := jsonb_array_length(p_apply->'membershipAdds') > 0;
  v_has_remove := jsonb_array_length(p_apply->'membershipRemoves') > 0;

  if not v_has_product and not v_has_variant and not v_has_create and not v_has_collection and not v_has_add and not v_has_remove then
    insert into public.vibode_stage_partner_publishes (
      partner_id,
      user_id,
      draft_id,
      draft_revision,
      source,
      mode,
      document,
      plan,
      status,
      base_catalog_hash,
      pre_publish_catalog_hash
    ) values (
      v_partner_id,
      v_user_id,
      v_draft_id,
      v_draft_revision,
      'portal',
      'patch',
      v_document,
      v_plan,
      'noop',
      v_base_hash,
      v_pre_hash
    )
    returning publish_id into v_publish_id;

    update public.vibode_stage_partner_drafts
    set status = 'published'
    where draft_id = v_draft_id
      and partner_id = v_partner_id
      and status = 'open'
      and revision = v_draft_revision;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_NOT_OPEN';
    end if;

    return jsonb_build_object(
      'ok', true,
      'status', 'noop',
      'publishId', v_publish_id,
      'idempotent', false
    );
  end if;

  for v_item in
    select value from jsonb_array_elements(p_apply->'variantUpdates') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_variant_id := nullif(btrim(v_item->>'variantId'), '');
    if v_variant_id is null or jsonb_typeof(v_item->'changes') <> 'array' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    for v_change in
      select value from jsonb_array_elements(v_item->'changes') as value
    loop
      if jsonb_typeof(v_change) <> 'object' then
        raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
      end if;
      if v_change->>'column' is distinct from 'sku' then
        continue;
      end if;
      if jsonb_typeof(v_change->'next') = 'null' or v_change->'next' is null then
        continue;
      end if;
      if jsonb_typeof(v_change->'next') <> 'string' then
        raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
      end if;
      v_sku := v_change->>'next';
      if exists (
        select 1
        from public.vibode_stage_variants variants
        join public.vibode_stage_products products
          on products.product_id = variants.product_id
        where variants.sku = v_sku
          and products.partner_id = v_partner_id
          and variants.variant_id is distinct from v_variant_id
      ) then
        raise exception 'VIBODE_STAGE_PUBLISH:DUPLICATE_SKU';
      end if;
    end loop;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'variantCreates') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    if (v_item ? 'status') or (v_item ? 'partnerId') or (v_item ? 'source') then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_variant_id := nullif(btrim(v_item->>'variantId'), '');
    v_sku := case
      when jsonb_typeof(v_item->'sku') = 'null' or v_item->'sku' is null then null
      when jsonb_typeof(v_item->'sku') = 'string' then nullif(v_item->>'sku', '')
      else null
    end;
    if v_item ? 'sku' and jsonb_typeof(v_item->'sku') is distinct from 'null' and jsonb_typeof(v_item->'sku') is distinct from 'string' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    if v_variant_id is null then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    if v_sku is null then
      continue;
    end if;
    if exists (
      select 1
      from public.vibode_stage_variants variants
      join public.vibode_stage_products products
        on products.product_id = variants.product_id
      where variants.sku = v_sku
        and products.partner_id = v_partner_id
        and variants.variant_id is distinct from v_variant_id
    ) then
      raise exception 'VIBODE_STAGE_PUBLISH:DUPLICATE_SKU';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'variantCreates') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_variant_id := nullif(btrim(v_item->>'variantId'), '');
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    v_asset_id := nullif(btrim(v_item->>'currentAssetId'), '');
    if v_variant_id is null or v_product_id is null or v_asset_id is null then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    if exists (
      select 1
      from public.vibode_stage_variants variants
      where variants.variant_id = v_variant_id
    ) then
      raise exception 'VIBODE_STAGE_PUBLISH:DUPLICATE_VARIANT_ID';
    end if;
    if not exists (
      select 1
      from public.vibode_stage_products products
      where products.product_id = v_product_id
        and products.partner_id = v_partner_id
        and products.source = 'partner_catalog'
    ) then
      raise exception 'VIBODE_STAGE_PUBLISH:PARENT_PRODUCT_MISMATCH';
    end if;
    if not exists (
      select 1
      from public.vibode_stage_assets assets
      where assets.asset_id = v_asset_id
        and assets.status = 'ready'
    ) then
      raise exception 'VIBODE_STAGE_PUBLISH:ASSET_NOT_READY';
    end if;
    if not exists (
      select 1
      from public.vibode_stage_variants variants
      join public.vibode_stage_products products
        on products.product_id = variants.product_id
      where products.partner_id = v_partner_id
        and variants.current_asset_id = v_asset_id
    ) then
      raise exception 'VIBODE_STAGE_PUBLISH:PARTNER_ASSET_UNASSOCIATED';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'productUpdates') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    if v_product_id is null or jsonb_typeof(v_item->'changes') <> 'array' or jsonb_array_length(v_item->'changes') < 1 then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;

    v_set_name := false;
    v_set_image := false;
    v_set_url := false;
    v_set_price := false;
    v_prev_name := null;
    v_next_name := null;
    v_prev_image := null;
    v_next_image := null;
    v_prev_url := null;
    v_next_url := null;
    v_prev_price := null;
    v_next_price := null;

    for v_change in
      select value from jsonb_array_elements(v_item->'changes') as value
    loop
      if jsonb_typeof(v_change) <> 'object' then
        raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
      end if;
      v_column := v_change->>'column';
      if v_column = 'name' then
        if jsonb_typeof(v_change->'next') is distinct from 'string' then
          raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
        end if;
        v_set_name := true;
        v_prev_name := case when jsonb_typeof(v_change->'previous') = 'null' or v_change->'previous' is null then null else v_change->>'previous' end;
        v_next_name := v_change->>'next';
      elsif v_column = 'image_url' then
        v_set_image := true;
        v_prev_image := case when jsonb_typeof(v_change->'previous') = 'null' or v_change->'previous' is null then null else v_change->>'previous' end;
        v_next_image := case when jsonb_typeof(v_change->'next') = 'null' or v_change->'next' is null then null else v_change->>'next' end;
      elsif v_column = 'product_url' then
        v_set_url := true;
        v_prev_url := case when jsonb_typeof(v_change->'previous') = 'null' or v_change->'previous' is null then null else v_change->>'previous' end;
        v_next_url := case when jsonb_typeof(v_change->'next') = 'null' or v_change->'next' is null then null else v_change->>'next' end;
      elsif v_column = 'price_amount' then
        v_set_price := true;
        v_prev_price := case when jsonb_typeof(v_change->'previous') = 'number' then (v_change->>'previous')::numeric else null end;
        v_next_price := case when jsonb_typeof(v_change->'next') = 'number' then (v_change->>'next')::numeric else null end;
      else
        raise exception 'VIBODE_STAGE_PUBLISH:UNSUPPORTED_COLUMN';
      end if;
    end loop;

    update public.vibode_stage_products
    set
      name = case when v_set_name then v_next_name else name end,
      image_url = case when v_set_image then v_next_image else image_url end,
      product_url = case when v_set_url then v_next_url else product_url end,
      price_amount = case when v_set_price then v_next_price else price_amount end
    where product_id = v_product_id
      and partner_id = v_partner_id
      and source = 'partner_catalog'
      and (not v_set_name or name is not distinct from v_prev_name)
      and (not v_set_image or image_url is not distinct from v_prev_image)
      and (not v_set_url or product_url is not distinct from v_prev_url)
      and (not v_set_price or price_amount is not distinct from v_prev_price);
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'VIBODE_STAGE_PUBLISH:STALE_SYNC';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'variantUpdates') as value
  loop
    v_variant_id := nullif(btrim(v_item->>'variantId'), '');
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    if v_variant_id is null or v_product_id is null or jsonb_typeof(v_item->'changes') <> 'array' or jsonb_array_length(v_item->'changes') < 1 then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;

    v_set_finish := false;
    v_set_sku := false;
    v_set_price := false;
    v_set_url := false;
    v_prev_finish := null;
    v_next_finish := null;
    v_prev_sku := null;
    v_next_sku := null;
    v_prev_price := null;
    v_next_price := null;
    v_prev_url := null;
    v_next_url := null;

    for v_change in
      select value from jsonb_array_elements(v_item->'changes') as value
    loop
      if jsonb_typeof(v_change) <> 'object' then
        raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
      end if;
      v_column := v_change->>'column';
      if v_column = 'finish_label' then
        v_set_finish := true;
        v_prev_finish := case when jsonb_typeof(v_change->'previous') = 'null' or v_change->'previous' is null then null else v_change->>'previous' end;
        v_next_finish := case when jsonb_typeof(v_change->'next') = 'null' or v_change->'next' is null then null else v_change->>'next' end;
      elsif v_column = 'sku' then
        v_set_sku := true;
        v_prev_sku := case when jsonb_typeof(v_change->'previous') = 'null' or v_change->'previous' is null then null else v_change->>'previous' end;
        v_next_sku := case when jsonb_typeof(v_change->'next') = 'null' or v_change->'next' is null then null else v_change->>'next' end;
      elsif v_column = 'price_amount' then
        v_set_price := true;
        v_prev_price := case when jsonb_typeof(v_change->'previous') = 'number' then (v_change->>'previous')::numeric else null end;
        v_next_price := case when jsonb_typeof(v_change->'next') = 'number' then (v_change->>'next')::numeric else null end;
      elsif v_column = 'product_url' then
        v_set_url := true;
        v_prev_url := case when jsonb_typeof(v_change->'previous') = 'null' or v_change->'previous' is null then null else v_change->>'previous' end;
        v_next_url := case when jsonb_typeof(v_change->'next') = 'null' or v_change->'next' is null then null else v_change->>'next' end;
      else
        raise exception 'VIBODE_STAGE_PUBLISH:UNSUPPORTED_COLUMN';
      end if;
    end loop;

    update public.vibode_stage_variants
    set
      finish_label = case when v_set_finish then v_next_finish else finish_label end,
      sku = case when v_set_sku then v_next_sku else sku end,
      price_amount = case when v_set_price then v_next_price else price_amount end,
      product_url = case when v_set_url then v_next_url else product_url end
    where variant_id = v_variant_id
      and product_id = v_product_id
      and (not v_set_finish or finish_label is not distinct from v_prev_finish)
      and (not v_set_sku or sku is not distinct from v_prev_sku)
      and (not v_set_price or price_amount is not distinct from v_prev_price)
      and (not v_set_url or product_url is not distinct from v_prev_url)
      and exists (
        select 1
        from public.vibode_stage_products products
        where products.product_id = v_product_id
          and products.partner_id = v_partner_id
          and products.source = 'partner_catalog'
      );
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'VIBODE_STAGE_PUBLISH:STALE_SYNC';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'collectionUpdates') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_collection_id := nullif(btrim(v_item->>'collectionId'), '');
    v_next_name := nullif(btrim(v_item->>'name'), '');
    v_prev_name := case when jsonb_typeof(v_item->'previousName') = 'null' or v_item->'previousName' is null then null else v_item->>'previousName' end;
    if v_collection_id is null or v_next_name is null then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;

    update public.vibode_stage_collections
    set name = v_next_name
    where collection_id = v_collection_id
      and partner_id = v_partner_id
      and owner = 'partner'
      and name is not distinct from v_prev_name;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'VIBODE_STAGE_PUBLISH:STALE_SYNC';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'membershipAdds') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    v_collection_id := nullif(btrim(v_item->>'collectionId'), '');
    v_sort_order := coalesce(nullif(v_item->>'sortOrder', '')::integer, 0);
    if v_product_id is null or v_collection_id is null then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    if not exists (
      select 1
      from public.vibode_stage_products products
      join public.vibode_stage_collections collections
        on collections.collection_id = v_collection_id
       and collections.partner_id = products.partner_id
       and collections.owner = 'partner'
      where products.product_id = v_product_id
        and products.partner_id = v_partner_id
        and products.source = 'partner_catalog'
    ) then
      raise exception 'VIBODE_STAGE_PUBLISH:COLLECTION_OWNER_MISMATCH';
    end if;

    insert into public.vibode_stage_product_collections (
      product_id,
      collection_id,
      sort_order
    ) values (
      v_product_id,
      v_collection_id,
      v_sort_order
    );
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'membershipRemoves') as value
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    v_collection_id := nullif(btrim(v_item->>'collectionId'), '');
    if v_product_id is null or v_collection_id is null then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    delete from public.vibode_stage_product_collections
    where product_id = v_product_id
      and collection_id = v_collection_id;
    get diagnostics v_deleted = row_count;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_apply->'variantCreates') as value
  loop
    v_variant_id := nullif(btrim(v_item->>'variantId'), '');
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    v_asset_id := nullif(btrim(v_item->>'currentAssetId'), '');
    v_price_currency := nullif(btrim(v_item->>'priceCurrency'), '');
    if v_variant_id is null or v_product_id is null or v_asset_id is null or v_price_currency is null then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    if jsonb_typeof(v_item->'priceAmount') is distinct from 'number' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_next_price := (v_item->>'priceAmount')::numeric;
    v_finish := case
      when jsonb_typeof(v_item->'finishLabel') = 'null' or v_item->'finishLabel' is null then null
      when jsonb_typeof(v_item->'finishLabel') = 'string' then v_item->>'finishLabel'
      else null
    end;
    if v_item ? 'finishLabel' and jsonb_typeof(v_item->'finishLabel') is distinct from 'null' and jsonb_typeof(v_item->'finishLabel') is distinct from 'string' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_sku := case
      when jsonb_typeof(v_item->'sku') = 'null' or v_item->'sku' is null then null
      when jsonb_typeof(v_item->'sku') = 'string' then nullif(v_item->>'sku', '')
      else null
    end;
    if v_item ? 'sku' and jsonb_typeof(v_item->'sku') is distinct from 'null' and jsonb_typeof(v_item->'sku') is distinct from 'string' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;
    v_next_url := case
      when jsonb_typeof(v_item->'productUrl') = 'null' or v_item->'productUrl' is null then null
      when jsonb_typeof(v_item->'productUrl') = 'string' then v_item->>'productUrl'
      else null
    end;
    if v_item ? 'productUrl' and jsonb_typeof(v_item->'productUrl') is distinct from 'null' and jsonb_typeof(v_item->'productUrl') is distinct from 'string' then
      raise exception 'VIBODE_STAGE_PUBLISH:INVALID_APPLY_PAYLOAD';
    end if;

    insert into public.vibode_stage_variants (
      variant_id,
      product_id,
      current_asset_id,
      finish_label,
      sku,
      price_amount,
      price_currency,
      product_url
    ) values (
      v_variant_id,
      v_product_id,
      v_asset_id,
      v_finish,
      v_sku,
      v_next_price,
      v_price_currency,
      v_next_url
    );
  end loop;

  insert into public.vibode_stage_partner_publishes (
    partner_id,
    user_id,
    draft_id,
    draft_revision,
    source,
    mode,
    document,
    plan,
    status,
    base_catalog_hash,
    pre_publish_catalog_hash
  ) values (
    v_partner_id,
    v_user_id,
    v_draft_id,
    v_draft_revision,
    'portal',
    'patch',
    v_document,
    v_plan,
    'accepted',
    v_base_hash,
    v_pre_hash
  )
  returning publish_id into v_publish_id;

  update public.vibode_stage_partner_drafts
  set status = 'published'
  where draft_id = v_draft_id
    and partner_id = v_partner_id
    and status = 'open'
    and revision = v_draft_revision;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VIBODE_STAGE_PUBLISH:DRAFT_NOT_OPEN';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'accepted',
    'publishId', v_publish_id,
    'idempotent', false
  );
end;
$$;

revoke all on function public.vibode_stage_apply_partner_patch_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.vibode_stage_apply_partner_patch_v2(jsonb)
  to service_role;

commit;
