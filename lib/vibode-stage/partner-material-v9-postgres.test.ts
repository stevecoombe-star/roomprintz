import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const container = `vibode-v9-material-${process.pid}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20261010180000_vibode_stage_partner_material_metadata.sql",
);

const fixture = `
begin;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.vibode_stage_partners (
  partner_id text primary key,
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  constraint vibode_stage_partners_partner_id_prefix check (partner_id like 'partner-%')
);

create table public.vibode_stage_assets (
  asset_id text primary key,
  glb_url text not null,
  authored_width_m numeric not null,
  authored_height_m numeric not null,
  authored_depth_m numeric not null,
  status text not null,
  constraint vibode_stage_assets_status_closed check (status in ('ready', 'unavailable'))
);

create table public.vibode_stage_products (
  product_id text primary key,
  name text not null,
  brand text not null,
  retailer text not null,
  image_url text not null,
  product_url text null,
  price_amount numeric null,
  price_currency text not null default 'USD',
  category_id text not null,
  subcategory_id text null,
  source text not null,
  partner_id text null references public.vibode_stage_partners (partner_id),
  default_variant_id text not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  constraint vibode_stage_products_source_closed
    check (source in ('vibode_curated', 'partner_catalog', 'user_pasted')),
  constraint vibode_stage_products_partner_source_pairing
    check (
      (source = 'partner_catalog' and partner_id is not null)
      or (source in ('vibode_curated', 'user_pasted') and partner_id is null)
    )
);

create table public.vibode_stage_variants (
  variant_id text primary key,
  product_id text not null references public.vibode_stage_products (product_id),
  current_asset_id text null references public.vibode_stage_assets (asset_id),
  finish_label text null,
  sku text null,
  price_amount numeric null,
  price_currency text null,
  product_url text null,
  status text not null default 'active',
  sort_order integer,
  model_width_m numeric,
  model_height_m numeric,
  model_depth_m numeric,
  model_sizing_mode text,
  constraint vibode_stage_variants_model_dimensions_complete
    check (
      (
        model_width_m is null and model_height_m is null
        and model_depth_m is null and model_sizing_mode is null
      )
      or (
        model_width_m >= 0.05 and model_width_m <= 8
        and model_height_m >= 0.05 and model_height_m <= 8
        and model_depth_m >= 0.05 and model_depth_m <= 8
        and model_sizing_mode in ('uniform', 'exact')
      )
    )
);

create unique index vibode_stage_variants_product_id_variant_id_uidx
  on public.vibode_stage_variants (product_id, variant_id);

alter table public.vibode_stage_products
  add constraint vibode_stage_products_default_variant_fkey
  foreign key (product_id, default_variant_id)
  references public.vibode_stage_variants (product_id, variant_id)
  deferrable initially deferred;

create or replace function public.vibode_stage_variants_assign_sort_order()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.sort_order is not null then
    return new;
  end if;
  select coalesce(max(variants.sort_order), -1) + 1
    into new.sort_order
  from public.vibode_stage_variants as variants
  where variants.product_id = new.product_id;
  return new;
end;
$fn$;

create trigger vibode_stage_variants_assign_sort_order
before insert on public.vibode_stage_variants
for each row
execute function public.vibode_stage_variants_assign_sort_order();

alter table public.vibode_stage_variants
  alter column sort_order set not null;

alter table public.vibode_stage_variants
  add constraint vibode_stage_variants_product_sort_key
  unique (product_id, sort_order)
  deferrable initially immediate;

create table public.vibode_stage_collections (
  collection_id text primary key,
  name text not null,
  owner text not null,
  partner_name text null,
  partner_id text null references public.vibode_stage_partners (partner_id),
  status text not null default 'active',
  sort_order integer not null default 0,
  constraint vibode_stage_collections_partner_owner_pairing
    check (
      (owner = 'partner' and partner_id is not null)
      or (owner = 'vibode' and partner_id is null)
    )
);

create table public.vibode_stage_product_collections (
  product_id text not null references public.vibode_stage_products (product_id),
  collection_id text not null references public.vibode_stage_collections (collection_id),
  sort_order integer not null default 0,
  primary key (product_id, collection_id)
);

create table public.vibode_stage_partner_assets (
  partner_id text not null references public.vibode_stage_partners (partner_id),
  asset_id text not null references public.vibode_stage_assets (asset_id),
  primary key (partner_id, asset_id)
);

create table public.vibode_stage_partner_drafts (
  draft_id uuid primary key,
  partner_id text not null references public.vibode_stage_partners (partner_id),
  document_kind text not null,
  document jsonb not null,
  status text not null,
  revision bigint not null,
  constraint vibode_stage_partner_drafts_status_closed
    check (status in ('open', 'abandoned', 'published'))
);

create unique index vibode_stage_partner_drafts_one_open_patch_idx
  on public.vibode_stage_partner_drafts (partner_id)
  where status = 'open';

create table public.vibode_stage_partner_publishes (
  publish_id uuid primary key default gen_random_uuid(),
  partner_id text not null references public.vibode_stage_partners (partner_id),
  user_id uuid,
  draft_id uuid not null references public.vibode_stage_partner_drafts (draft_id),
  draft_revision bigint not null,
  source text not null,
  mode text not null,
  document jsonb not null,
  plan jsonb,
  status text not null,
  base_catalog_hash text,
  pre_publish_catalog_hash text,
  constraint vibode_stage_partner_publishes_status_closed
    check (status in ('accepted', 'noop', 'rejected', 'failed'))
);

commit;
`;

const seed = `
insert into public.vibode_stage_partners (partner_id, name, slug)
values
  ('partner-demo', 'Demo Furniture', 'demo'),
  ('partner-other', 'Other House', 'other');

insert into public.vibode_stage_assets (
  asset_id, glb_url, authored_width_m, authored_height_m, authored_depth_m, status
) values (
  'asset-demo', '/models/demo.glb', 1, 1, 1, 'ready'
);

insert into public.vibode_stage_partner_assets (partner_id, asset_id)
values ('partner-demo', 'asset-demo');

begin;
set constraints public.vibode_stage_products_default_variant_fkey deferred;
insert into public.vibode_stage_products (
  product_id, name, brand, retailer, image_url, product_url, price_amount, price_currency,
  category_id, subcategory_id, source, partner_id, default_variant_id, status, sort_order
) values (
  'prod-demo-sofa', 'Sofa', 'Demo Furniture', 'Demo Furniture', '/img/sofa.svg',
  'https://demo.test/sofa', 20, 'USD', 'living-room', 'sofas', 'partner_catalog',
  'partner-demo', 'var-demo-sofa', 'active', 0
);
insert into public.vibode_stage_variants (
  variant_id, product_id, current_asset_id, finish_label, sku, price_amount, price_currency, product_url
) values (
  'var-demo-sofa', 'prod-demo-sofa', 'asset-demo', 'Sand', 'SOFA-1', 20, 'USD', 'https://demo.test/sofa'
);
commit;
`;

type ApplyBody = Record<string, unknown>;

function docker(args: string[], input?: string) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 20_000_000,
  });
}

function psql(sqlText: string) {
  return docker(
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "vibode_v9", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    `set client_min_messages to warning;\n${sqlText}`,
  ).trim();
}

function scalar(query: string) {
  return psql(query);
}

function materials(table: "products" | "variants", idColumn: string, id: string) {
  return scalar(`
    select
      case
        when primary_material is null then '<null>'
        when primary_material = '' then '<empty>'
        else primary_material
      end
      || '|' ||
      case
        when secondary_material is null then '<null>'
        when secondary_material = '' then '<empty>'
        else secondary_material
      end
    from public.vibode_stage_${table}
    where ${idColumn} = '${id}'
  `);
}

function payload(draftId: string, partnerId: string, extra: ApplyBody = {}): ApplyBody {
  return {
    planVersion: 9,
    partnerId,
    draftId,
    draftRevision: 1,
    source: "portal",
    mode: "patch",
    document: { partnerId },
    baseCatalogHash: "base",
    prePublishCatalogHash: "pre",
    productCreates: [],
    variantCreates: [],
    collectionCreates: [],
    productUpdates: [],
    variantUpdates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productStatusTransitions: [],
    variantStatusTransitions: [],
    variantModelDimensions: [],
    materialUpdates: [],
    ...extra,
  };
}

function openDraft(draftId: string, partnerId: string) {
  psql(`
    insert into public.vibode_stage_partner_drafts (
      draft_id, partner_id, document_kind, document, status, revision
    ) values ('${draftId}', '${partnerId}', 'patch', '{}'::jsonb, 'open', 1);
  `);
}

function abandon(draftId: string) {
  psql(`
    update public.vibode_stage_partner_drafts
    set status = 'abandoned'
    where draft_id = '${draftId}';
  `);
}

function apply(body: ApplyBody) {
  const json = JSON.stringify(body);
  assert.equal(json.includes("$v9$"), false);
  return psql(`select public.vibode_stage_apply_partner_patch_v9($v9$${json}$v9$::jsonb);`);
}

function expectFailure(body: ApplyBody, code: string) {
  const json = JSON.stringify(body);
  assert.equal(json.includes("$v9$"), false);
  psql(`
    do $do$
    begin
      perform public.vibode_stage_apply_partner_patch_v9($v9$${json}$v9$::jsonb);
      raise exception 'EXPECTED_FAILURE_MISSING';
    exception
      when others then
        if position('${code}' in sqlerrm) = 0 then
          raise exception 'UNEXPECTED:%', sqlerrm;
        end if;
    end
    $do$;
  `);
}

function productCreate(
  productId: string,
  variantId: string,
  materialsForProduct: { primaryMaterial: string | null; secondaryMaterial: string | null },
) {
  return {
    productId,
    defaultVariantId: variantId,
    partnerId: "partner-demo",
    source: "partner_catalog",
    status: "active",
    brand: "Demo Furniture",
    retailer: "Demo Furniture",
    name: productId,
    imageUrl: `/img/${productId}.svg`,
    productUrl: `https://demo.test/${productId}`,
    priceCurrency: "USD",
    categoryId: "living-room",
    subcategoryId: "chairs",
    priceAmount: 10,
    sortOrder: 0,
    ...materialsForProduct,
  };
}

function variantCreate(
  productId: string,
  variantId: string,
  materialValues: { primaryMaterial: string | null; secondaryMaterial: string | null },
) {
  return {
    variantId,
    productId,
    currentAssetId: "asset-demo",
    finishLabel: "Sand",
    sku: variantId,
    priceAmount: 10,
    priceCurrency: "USD",
    productUrl: `https://demo.test/${productId}`,
    ...materialValues,
  };
}

function collectionCreate(collectionId: string, name: string) {
  return {
    collectionId,
    name,
    owner: "partner",
    status: "active",
    partnerId: "partner-demo",
    partnerName: "Demo Furniture",
    sortOrder: 0,
  };
}

function step(name: string, run: () => void) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${message}`, { cause: error });
  }
}

before(async () => {
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  } catch {
    // No previous throwaway container.
  }
  docker([
    "run",
    "-d",
    "--name",
    container,
    "-e",
    "POSTGRES_PASSWORD=vibode-v9-test",
    "-e",
    "POSTGRES_DB=vibode_v9",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:16-alpine",
  ]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(["exec", container, "pg_isready", "-U", "postgres", "-d", "vibode_v9"]);
      psql(fixture);
      psql(readFileSync(migrationPath, "utf8"));
      psql(seed);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 59 || /ERROR:/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}, { timeout: 180_000 });

after(() => {
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  } catch {
    // The container is throwaway. Cleanup failure should not hide the test result.
  }
});

test("executes vibode_stage_apply_partner_patch_v9 material writes", { timeout: 120_000 }, () => {
  step("function exists only as v9", () => {
    assert.equal(
      scalar(`
        select string_agg(proname, ',' order by proname)
        from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname like 'vibode_stage_apply_partner_patch%'
      `),
      "vibode_stage_apply_partner_patch_v9",
    );
    assert.equal(
      scalar(`select has_function_privilege('service_role', 'public.vibode_stage_apply_partner_patch_v9(jsonb)', 'execute')`),
      "t",
    );
    assert.equal(
      scalar(`select has_function_privilege('anon', 'public.vibode_stage_apply_partner_patch_v9(jsonb)', 'execute')`),
      "f",
    );
  });

  step("collection-only publish", () => {
    const draftId = "11111111-1111-4111-8111-111111111111";
    openDraft(draftId, "partner-demo");
    const result = apply(payload(draftId, "partner-demo", {
      collectionCreates: [collectionCreate("col-demo-living", "Living")],
    }));
    assert.match(result, /"status": "accepted"/);
    assert.equal(scalar(`select name from public.vibode_stage_collections where collection_id = 'col-demo-living'`), "Living");
    assert.equal(scalar(`select status from public.vibode_stage_partner_drafts where draft_id = '${draftId}'`), "published");
    assert.equal(scalar(`select count(*) from public.vibode_stage_products`), "1");
  });

  step("new product persists both materials and blank product text becomes null", () => {
    const draftId = "22222222-2222-4222-8222-222222222222";
    openDraft(draftId, "partner-demo");
    apply(payload(draftId, "partner-demo", {
      productCreates: [
        productCreate("prod-demo-chair", "var-demo-chair", {
          primaryMaterial: "Chenille Helios",
          secondaryMaterial: "Blackened steel",
        }),
        productCreate("prod-demo-blank", "var-demo-blank", {
          primaryMaterial: "   ",
          secondaryMaterial: "",
        }),
      ],
      variantCreates: [
        variantCreate("prod-demo-chair", "var-demo-chair", {
          primaryMaterial: null,
          secondaryMaterial: "",
        }),
        variantCreate("prod-demo-blank", "var-demo-blank", {
          primaryMaterial: null,
          secondaryMaterial: null,
        }),
      ],
    }));
    assert.equal(materials("products", "product_id", "prod-demo-chair"), "Chenille Helios|Blackened steel");
    assert.equal(materials("products", "product_id", "prod-demo-blank"), "<null>|<null>");
    assert.equal(materials("variants", "variant_id", "var-demo-chair"), "<null>|<empty>");
    assert.equal(materials("variants", "variant_id", "var-demo-blank"), "<null>|<null>");
  });

  step("new variant persists custom materials", () => {
    const draftId = "33333333-3333-4333-8333-333333333333";
    openDraft(draftId, "partner-demo");
    apply(payload(draftId, "partner-demo", {
      variantCreates: [
        variantCreate("prod-demo-sofa", "var-demo-sofa-linen", {
          primaryMaterial: "  Linen Sand  ",
          secondaryMaterial: "Walnut legs",
        }),
      ],
    }));
    assert.equal(materials("variants", "variant_id", "var-demo-sofa-linen"), "Linen Sand|Walnut legs");
    assert.equal(materials("products", "product_id", "prod-demo-sofa"), "<null>|<null>");
  });

  step("stale material update leaves the row and draft unchanged", () => {
    const draftId = "44444444-4444-4444-8444-444444444444";
    openDraft(draftId, "partner-demo");
    expectFailure(payload(draftId, "partner-demo", {
      materialUpdates: [{
        entity: "product",
        productId: "prod-demo-sofa",
        variantId: null,
        column: "primary_material",
        previous: "velvet",
        next: "Performance linen",
      }],
    }), "STALE_SYNC");
    assert.equal(materials("products", "product_id", "prod-demo-sofa"), "<null>|<null>");
    assert.equal(scalar(`select status from public.vibode_stage_partner_drafts where draft_id = '${draftId}'`), "open");
    assert.equal(scalar(`select count(*) from public.vibode_stage_partner_publishes where draft_id = '${draftId}'`), "0");
    abandon(draftId);
  });

  step("over-length material update fails without writing", () => {
    const draftId = "55555555-5555-4555-8555-555555555555";
    openDraft(draftId, "partner-demo");
    expectFailure(payload(draftId, "partner-demo", {
      materialUpdates: [{
        entity: "variant",
        productId: "prod-demo-sofa",
        variantId: "var-demo-sofa",
        column: "secondary_material",
        previous: null,
        next: "x".repeat(401),
      }],
    }), "INVALID_APPLY_PAYLOAD");
    assert.equal(materials("variants", "variant_id", "var-demo-sofa"), "<null>|<null>");
    assert.equal(scalar(`select count(*) from public.vibode_stage_partner_publishes where draft_id = '${draftId}'`), "0");
    abandon(draftId);
  });

  step("generic product update cannot bypass material validation", () => {
    const draftId = "66666666-6666-4666-8666-666666666666";
    openDraft(draftId, "partner-demo");
    expectFailure(payload(draftId, "partner-demo", {
      productUpdates: [{
        productId: "prod-demo-sofa",
        changes: [{ column: "primary_material", previous: null, next: "sneaky" }],
      }],
    }), "UNSUPPORTED_COLUMN");
    assert.equal(materials("products", "product_id", "prod-demo-sofa"), "<null>|<null>");
    abandon(draftId);
  });

  step("cross-partner product and variant material writes are rejected", () => {
    const productDraft = "77777777-7777-4777-8777-777777777777";
    openDraft(productDraft, "partner-other");
    expectFailure(payload(productDraft, "partner-other", {
      materialUpdates: [{
        entity: "product",
        productId: "prod-demo-sofa",
        variantId: null,
        column: "primary_material",
        previous: null,
        next: "stolen",
      }],
    }), "STALE_SYNC");
    abandon(productDraft);

    const variantDraft = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    openDraft(variantDraft, "partner-other");
    expectFailure(payload(variantDraft, "partner-other", {
      materialUpdates: [{
        entity: "variant",
        productId: "prod-demo-sofa",
        variantId: "var-demo-sofa",
        column: "secondary_material",
        previous: null,
        next: "stolen",
      }],
    }), "STALE_SYNC");
    abandon(variantDraft);
    assert.equal(materials("products", "product_id", "prod-demo-sofa"), "<null>|<null>");
    assert.equal(materials("variants", "variant_id", "var-demo-sofa"), "<null>|<null>");
  });

  step("material-only product and variant updates persist", () => {
    const draftId = "88888888-8888-4888-8888-888888888888";
    openDraft(draftId, "partner-demo");
    apply(payload(draftId, "partner-demo", {
      materialUpdates: [
        {
          entity: "product",
          productId: "prod-demo-sofa",
          variantId: null,
          column: "primary_material",
          previous: null,
          next: "Performance linen",
        },
        {
          entity: "product",
          productId: "prod-demo-sofa",
          variantId: null,
          column: "secondary_material",
          previous: null,
          next: "   ",
        },
        {
          entity: "variant",
          productId: "prod-demo-sofa",
          variantId: "var-demo-sofa",
          column: "primary_material",
          previous: null,
          next: "",
        },
        {
          entity: "variant",
          productId: "prod-demo-sofa",
          variantId: "var-demo-sofa",
          column: "secondary_material",
          previous: null,
          next: "Powder coat",
        },
      ],
    }));
    assert.equal(materials("products", "product_id", "prod-demo-sofa"), "Performance linen|<null>");
    assert.equal(materials("variants", "variant_id", "var-demo-sofa"), "<empty>|Powder coat");
    assert.equal(scalar(`select status from public.vibode_stage_partner_drafts where draft_id = '${draftId}'`), "published");
  });

  step("mixed collection, product, and variant publish commits together", () => {
    const draftId = "99999999-9999-4999-8999-999999999999";
    openDraft(draftId, "partner-demo");
    apply(payload(draftId, "partner-demo", {
      collectionCreates: [collectionCreate("col-demo-mixed", "Mixed")],
      productCreates: [
        productCreate("prod-demo-table", "var-demo-table", {
          primaryMaterial: "White oak",
          secondaryMaterial: "Matte lacquer",
        }),
      ],
      variantCreates: [
        variantCreate("prod-demo-table", "var-demo-table", {
          primaryMaterial: "Cerused oak",
          secondaryMaterial: "Brass sled",
        }),
      ],
      membershipAdds: [{ productId: "prod-demo-table", collectionId: "col-demo-mixed", sortOrder: 0 }],
    }));
    assert.equal(scalar(`select count(*) from public.vibode_stage_collections where collection_id = 'col-demo-mixed'`), "1");
    assert.equal(materials("products", "product_id", "prod-demo-table"), "White oak|Matte lacquer");
    assert.equal(materials("variants", "variant_id", "var-demo-table"), "Cerused oak|Brass sled");
    assert.equal(
      scalar(`select count(*) from public.vibode_stage_product_collections where product_id = 'prod-demo-table' and collection_id = 'col-demo-mixed'`),
      "1",
    );
  });

  step("a failing material write rolls back the mixed publish", () => {
    const draftId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    openDraft(draftId, "partner-demo");
    expectFailure(payload(draftId, "partner-demo", {
      collectionCreates: [collectionCreate("col-demo-atomic", "Atomic")],
      productCreates: [
        productCreate("prod-demo-atomic", "var-demo-atomic", {
          primaryMaterial: "Should roll back",
          secondaryMaterial: "Should roll back",
        }),
      ],
      variantCreates: [
        variantCreate("prod-demo-atomic", "var-demo-atomic", {
          primaryMaterial: "Should roll back",
          secondaryMaterial: "",
        }),
      ],
      materialUpdates: [{
        entity: "product",
        productId: "prod-missing",
        variantId: null,
        column: "primary_material",
        previous: null,
        next: "Oak",
      }],
    }), "STALE_SYNC");
    assert.equal(scalar(`select count(*) from public.vibode_stage_collections where collection_id = 'col-demo-atomic'`), "0");
    assert.equal(scalar(`select count(*) from public.vibode_stage_products where product_id = 'prod-demo-atomic'`), "0");
    assert.equal(scalar(`select count(*) from public.vibode_stage_variants where variant_id = 'var-demo-atomic'`), "0");
    assert.equal(scalar(`select status from public.vibode_stage_partner_drafts where draft_id = '${draftId}'`), "open");
    assert.equal(scalar(`select count(*) from public.vibode_stage_partner_publishes where draft_id = '${draftId}'`), "0");
    abandon(draftId);
  });
});
