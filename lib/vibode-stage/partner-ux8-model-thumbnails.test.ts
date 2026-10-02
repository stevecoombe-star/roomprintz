import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerModelLibrary } from "../../app/partner/assets/PartnerModelLibrary";
import {
  buildPartnerModelLibrary,
  modelThumbnailVisual,
  type PartnerModelLibraryItem,
} from "./partner-model-library";

const ROOT = process.cwd();
const ASSET_ID = "vibode-stage/partner-intake/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THUMB = "https://example.test/storage/v1/object/sign/vibode-thumbnails/models/chair.webp?token=abc";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function item(thumbnailUrl: string | null): PartnerModelLibraryItem {
  const built = buildPartnerModelLibrary({
    assets: [{
      assetId: ASSET_ID,
      status: "ready",
      originalFileName: "chair.glb",
      measuredWidthM: 1,
      measuredHeightM: 1,
      measuredDepthM: 1,
      sha256: "ab".repeat(32),
      registeredAt: "2026-09-15T12:00:00.000Z",
      origin: "partner_intake",
      thumbnailUrl,
    }],
    intakes: [],
    catalog: { ok: true, products: [], variants: [] },
  });
  const row = built.items[0];
  assert.ok(row);
  return row;
}

test("thumbnail metadata is optional and a missing thumbnail stays a valid model", () => {
  const missing = item(null);
  assert.equal(missing.thumbnailUrl, null);
  assert.equal(missing.state, "ready");
  assert.equal(missing.fileName, "chair.glb");
  const present = item(THUMB);
  assert.equal(present.thumbnailUrl, THUMB);
  assert.equal(modelThumbnailVisual(null, false), "placeholder");
  assert.equal(modelThumbnailVisual("javascript:alert(1)", false), "placeholder");
  assert.equal(modelThumbnailVisual(THUMB, false), "image");
  assert.equal(modelThumbnailVisual(THUMB, true), "placeholder");
});

test("the 3D Models row shows a static thumbnail or a placeholder", () => {
  const withThumb = renderToStaticMarkup(createElement(PartnerModelLibrary, {
    items: [item(THUMB)],
    loaded: true,
    loadError: null,
    associationsKnown: true,
    query: "",
    status: "all",
    onQueryChange: () => undefined,
    onStatusChange: () => undefined,
    onClearFilters: () => undefined,
  }));
  assert.match(withThumb, /data-model-thumbnail="image"/);
  assert.match(withThumb, /object-contain/);
  assert.match(withThumb, new RegExp(`src="${THUMB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(withThumb, /chair\.glb/);
  assert.match(withThumb, /View product|Technical details/);
  assert.doesNotMatch(withThumb, /<canvas/);

  const without = renderToStaticMarkup(createElement(PartnerModelLibrary, {
    items: [item(null)],
    loaded: true,
    loadError: null,
    associationsKnown: true,
    query: "",
    status: "all",
    onQueryChange: () => undefined,
    onStatusChange: () => undefined,
    onClearFilters: () => undefined,
  }));
  assert.match(without, /data-model-thumbnail="placeholder"/);
  assert.match(without, /preview/);
  assert.doesNotMatch(without, /<img/);
  assert.match(without, /Technical details/);
});

test("the library does not render GLBs or request thumbnails on each visit", () => {
  const library = source("app/partner/assets/PartnerModelLibrary.tsx");
  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  const page = source("app/partner/assets/page.tsx");
  const hook = source("app/partner/catalog/products/usePartnerInlineGlbUploads.ts");
  const register = source("lib/vibode-stage/partner-asset-register.server.ts");
  assert.match(library, /object-contain/);
  assert.match(library, /shrink-0/);
  assert.match(library, /onError=/);
  assert.match(library, /w-\[4\.5rem\]/);
  assert.doesNotMatch(library + page, /GLTFLoader|WebGLRenderer|playwright|loadFurnitureGlb|generate-client|render-browser/);
  assert.match(client, /fetch\("\/api\/vibode\/partner\/assets", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(client, /vibode-model-thumbnail-render|vibode-thumbnail-jobs|GLTFLoader|WebGLRenderer/);
  const gate = client.indexOf("advancedOpen ?");
  assert.ok(client.indexOf("Generate missing thumbnails") > gate);
  assert.doesNotMatch(register, /scheduleRegisteredModelThumbnail|enqueueModelThumbnail|claim_next_vibode_stage_model_thumbnail/);
  assert.match(register, /attachModelThumbnailUrls/);
  assert.match(hook, /generatePartnerModelThumbnail/);
  assert.doesNotMatch(hook, /GLTFLoader|WebGLRenderer/);
  const generateAt = hook.indexOf("generatePartnerModelThumbnail");
  const readyAt = hook.indexOf('phase: "ready"');
  assert.ok(generateAt > 0 && readyAt > generateAt);
  assert.doesNotMatch(source("worker/src/orchestrate.ts") + source("worker/src/index.ts"), /modelApi|model-thumbnail/);
});

test("thumbnail storage stays private and does not alter the public asset row", () => {
  const sql = source("supabase/migrations/20261001200000_vibode_stage_model_thumbnails.sql");
  const followUp = source("supabase/migrations/20261001210000_vibode_stage_model_thumbnail_direct.sql");
  assert.match(sql, /create table public\.vibode_stage_model_thumbnails/);
  assert.match(sql, /revoke all on table public\.vibode_stage_model_thumbnails/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_stage_model_thumbnails[\s\S]*to service_role/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /alter table public\.vibode_stage_assets/);
  assert.match(followUp, /drop column if exists status/);
  assert.match(followUp, /drop column if exists claim_nonce/);
  assert.match(followUp, /drop function if exists public\.claim_next_vibode_stage_model_thumbnail/);
  assert.match(followUp, /vibode_stage_model_thumbnails_stored_complete/);
  assert.doesNotMatch(source("lib/vibode-model-thumbnail/policy.ts"), /CLAIM_LEASE|attempt_count|claim_nonce/);
  assert.doesNotMatch(source("package.json"), /vibode:backfill-model-thumbnails/);
  const library = source("lib/vibode-stage/partner-model-library.ts");
  assert.doesNotMatch(library, /storage_path|storage_bucket/);
  const persist = source("lib/vibode-model-thumbnail/persist.server.ts");
  const saveRoute = source("app/api/vibode/partner/model-thumbnails/route.ts");
  assert.match(persist, /resolvePartnerPortalContext/);
  assert.match(persist, /STAGE_PARTNER_ASSETS_TABLE/);
  assert.doesNotMatch(saveRoute, /storage_path|storagePath|service_role|SERVICE_ROLE/);
});
