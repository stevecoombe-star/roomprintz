import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  buildAfcV2ProductionRoomAuthority,
  isAfcV2ProductionRoomAuthority,
  productionAuthorityKeys,
} from "./production-authority-contract";
import { collectProductionPayloadPrivacyViolations } from "./privacy";
import { parseProductionAfcIntent, parseRoomId } from "./production-http";
import { deriveProductionAutoMetric } from "./production-auto-metric";

const ROOT = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("production authority schema version is frozen", () => {
  assert.equal(
    AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
    "afc-v2-production-room-authority/v1",
  );
  assert.ok(productionAuthorityKeys().includes("frozenCamera"));
  assert.ok(productionAuthorityKeys().includes("metric"));
  assert.ok(!productionAuthorityKeys().includes("freezeReceipt"));
  assert.ok(!productionAuthorityKeys().includes("imageUrl"));
});

test("HTTP helpers accept owner room ids and certified intents only", () => {
  assert.equal(parseRoomId("11111111-1111-4111-8111-111111111111"), "11111111-1111-4111-8111-111111111111");
  assert.equal(parseRoomId("not-a-uuid"), null);
  assert.equal(parseProductionAfcIntent(undefined), undefined);
  assert.equal(parseProductionAfcIntent("reread_perspective"), "reread_perspective");
  assert.equal(parseProductionAfcIntent("admin"), "invalid");
});

test("Lab v2 UI and orchestration stay out of the production adapter", () => {
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const analyzeRoute = source("app/api/vibode/afc/analyze/route.ts");
  const restoreRoute = source("app/api/vibode/afc/restore/route.ts");
  const joined = `${adapter}\n${analyzeRoute}\n${restoreRoute}`;

  assert.match(adapter, /from "\.\.\/\.\.\/app\/admin\/3d-room-lab-v2\/afc-v2-analysis\.server"|from "@\/app\/admin\/3d-room-lab-v2\/afc-v2-analysis\.server"/);
  assert.match(adapter, /executeAfcV2Analysis/);
  assert.match(adapter, /forceTiledRegeneration/);
  assert.match(adapter, /decodedWidth/);
  assert.match(adapter, /resolveEmpty/);
  assert.match(adapter, /generateTiled/);
  assert.doesNotMatch(joined, /RoomLabV2|CalibratedRoomViewer/);
  assert.doesNotMatch(joined, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(joined, /\/api\/admin\/3d-room-lab/);
  assert.doesNotMatch(joined, /vibode_generation_runs|stage_output/);
  assert.match(analyzeRoute, /authorizeProductionAfcUser/);
  assert.match(restoreRoute, /restoreProductionAfcRoom/);
  assert.doesNotMatch(restoreRoute, /executeAfcV2Analysis/);
});

test("restore route cannot invoke providers or the certified analyzer", () => {
  const restoreRoute = source("app/api/vibode/afc/restore/route.ts");
  const restoreFn = source("lib/afc-v2-production/production-adapter.server.ts");
  const restoreImpl = restoreFn.slice(
    restoreFn.indexOf("export async function restoreProductionAfcRoom"),
    restoreFn.indexOf("export async function runProductionAfcAnalysis"),
  );
  assert.doesNotMatch(restoreImpl, /executeAfcV2Analysis|observeRoom|generateTiled|readTiledPerspective/);
  assert.doesNotMatch(restoreRoute, /executeAfcV2Analysis|observeRoom|generateTiled/);
});

test("privacy scanner rejects privileged Lab/admin payload keys", () => {
  const violations = collectProductionPayloadPrivacyViolations({
    imageUrl: "https://example.test/empty.png",
    freezeReceipt: {},
    executionCounts: { emptyGeneration: 1 },
  });
  assert.ok(violations.length > 0);
});

test("production auto-metric helper uses certified policy without userWorldScale", () => {
  const auto = source("lib/afc-v2-production/production-auto-metric.ts");
  assert.match(auto, /deriveAutoMetricScale/);
  assert.match(auto, /selectAppliedAutoMetricScale/);
  assert.match(auto, /defaultTrustSelectedBackSpanAsFullWidth/);
  assert.doesNotMatch(auto, /setUserWorldScale|computeMetricScale/);
  assert.match(auto, /are not production controls/);
  assert.equal(typeof deriveProductionAutoMetric, "function");
  assert.equal(typeof buildAfcV2ProductionRoomAuthority, "function");
  assert.equal(typeof isAfcV2ProductionRoomAuthority, "function");
});

const MIGRATION = source(
  "supabase/migrations/20260908213000_vibode_afc_v2_production_generations.sql",
);

test("AFC storage is a dedicated private bucket with no authenticated access", () => {
  assert.match(MIGRATION, /insert into storage\.buckets/);
  assert.match(MIGRATION, /'vibode-afc-v2'/);
  assert.match(MIGRATION, /false/);
  assert.match(MIGRATION, /as restrictive/);
  assert.match(MIGRATION, /to anon/);
  assert.match(MIGRATION, /to authenticated/);
  assert.match(MIGRATION, /bucket_id <> 'vibode-afc-v2'/);
  assert.match(MIGRATION, /grant select, insert, update, delete on table public\.vibode_afc_generations[\s\S]*to service_role/);
  assert.doesNotMatch(
    MIGRATION,
    /create policy[\s\S]*to authenticated[\s\S]*bucket_id = 'vibode-afc-v2'/,
  );
  assert.doesNotMatch(MIGRATION, /to authenticated[\s\S]*using \(true\)/);
});

test("generation immutability allows DELETE so room cascade can succeed", () => {
  assert.match(
    MIGRATION,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    MIGRATION,
    /current_afc_generation_id[\s\S]*on delete set null/,
  );
  assert.match(
    MIGRATION,
    /create trigger vibode_afc_generations_protect_authority\s+before update on public\.vibode_afc_generations/,
  );
  assert.doesNotMatch(
    MIGRATION,
    /before update or delete on public\.vibode_afc_generations/,
  );
  assert.doesNotMatch(MIGRATION, /AFC generation rows are immutable/);
  assert.doesNotMatch(
    MIGRATION,
    /grant (all|delete) on table public\.vibode_afc_generations[\s\S]*to authenticated/,
  );
});

test("activation RPC advances lineage only and is service-role only", () => {
  assert.match(MIGRATION, /security definer/);
  assert.match(MIGRATION, /set search_path = public/);
  assert.match(MIGRATION, /lineage_seq/);
  assert.match(MIGRATION, /v_seq > v_current_seq/);
  assert.match(MIGRATION, /return v_current;/);
  assert.match(
    MIGRATION,
    /revoke all on function public\.activate_vibode_afc_generation\(uuid, uuid, uuid\)\s+from public, anon, authenticated/,
  );
  assert.match(
    MIGRATION,
    /grant execute on function public\.activate_vibode_afc_generation\(uuid, uuid, uuid\)\s+to service_role/,
  );
  assert.match(
    MIGRATION,
    /grant usage, select on sequence public\.vibode_afc_generations_lineage_seq/,
  );
  assert.match(
    MIGRATION,
    /revoke all on sequence public\.vibode_afc_generations_lineage_seq\s+from public, anon, authenticated/,
  );
});

test("live analyze route binds ORIGINAL ownership then signs a URL", () => {
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const analyzeRoute = source("app/api/vibode/afc/analyze/route.ts");
  const persistence = source("lib/afc-v2-production/production-persistence.server.ts");
  assert.doesNotMatch(adapter, /vibode\.invalid/);
  assert.doesNotMatch(analyzeRoute, /vibode\.invalid/);
  assert.match(analyzeRoute, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(analyzeRoute, /sourceImageUrl: original\.sourceImageUrl/);
  assert.doesNotMatch(analyzeRoute, /loadRoomOriginalBytes/);
  assert.match(persistence, /createSignedUrl/);
  assert.match(persistence, /prepareOwnedOriginalForAnalysis/);
  assert.match(adapter, /isProductionOriginalSourceUrl/);
  assert.match(adapter, /publishDurableEmpty/);
  assert.match(adapter, /durableArtifactBytesMatch/);
  const store = source("lib/afc-v2-production/production-store.ts");
  assert.match(store, /AFC_V2_PRODUCTION_STORAGE_BUCKET = "vibode-afc-v2"/);
  assert.match(store, /AFC_V2_ORIGINAL_STORAGE_BUCKET = "vibode-base-images"/);
});

test("privacy scanner rejects AFC bucket paths, placeholders, and signed URLs", () => {
  const violations = collectProductionPayloadPrivacyViolations({
    bucket: "vibode-afc-v2",
    sourceImageUrl: "https://vibode.invalid/rooms/x/original",
    emptyUrl: "https://proj.supabase.co/storage/v1/object/sign/vibode-afc-v2/users/a/empty.png?token=secret",
  });
  assert.ok(violations.length > 0);
  assert.ok(violations.some((item) => item.includes("vibode.invalid") || item.includes("sourceImageUrl")));
});

