import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import { AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL } from "@/app/admin/3d-room-lab-v2/metric-room-prior.server";
import { AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL } from "@/app/admin/3d-room-lab-v2/room-observation.server";

import {
  AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION,
  AFC_V2_ENGINE_FINGERPRINT_KEYS,
  AFC_V2_ENGINE_FINGERPRINT_TILED_KEYS,
  AFC_V2_ENGINE_VERSION_KEYS,
  buildAfcV2EngineFingerprint,
  isAfcV2EngineFingerprintV1,
  productionTiledEngineIdentity,
  resolveAfcV2EngineGitSha,
  resolveAfcV2ObservationModelId,
  withAfcV2EngineFingerprintReaderVersion,
} from "./engine-fingerprint";
import {
  AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  afcV2ProductionEngineVersions,
  buildAfcV2ProductionRoomAuthority,
} from "./production-authority-contract";
import { collectProductionPayloadPrivacyViolations } from "./privacy";
import {
  AfcGenerationImmutabilityError,
  createMemoryAfcProductionStore,
} from "./production-store";

const ROOT = process.cwd();
const AFD1B_MIGRATION =
  "supabase/migrations/20260922120000_vibode_afc_v2_engine_fingerprint.sql";
const AFC_PRODUCTION_MIGRATION =
  "supabase/migrations/20260908213000_vibode_afc_v2_production_generations.sql";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

function functionBody(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$`,
    ),
  );
  assert.ok(match, `expected function public.${name}`);
  return match[1];
}

function walkTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

const MIGRATION = source(AFD1B_MIGRATION);
const PRODUCTION_MIGRATION = source(AFC_PRODUCTION_MIGRATION);
const TRIGGER_BODY = functionBody(
  MIGRATION,
  "vibode_afc_generations_protect_authority",
);

async function createRunningGeneration() {
  const store = createMemoryAfcProductionStore();
  const generation = await store.createGeneration({
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: null,
    runId: crypto.randomUUID(),
    intent: "analyze",
    tiledForceRegeneration: false,
  });
  return { store, generation };
}

test("1) fingerprint schema version is exact v1", () => {
  const fingerprint = buildAfcV2EngineFingerprint();
  assert.equal(
    fingerprint.fingerprintSchemaVersion,
    "afc-v2-engine-fingerprint/v1",
  );
  assert.equal(
    AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION,
    "afc-v2-engine-fingerprint/v1",
  );
  assert.equal(isAfcV2EngineFingerprintV1(fingerprint), true);
  assert.deepEqual(
    Object.keys(fingerprint).sort(),
    [...AFC_V2_ENGINE_FINGERPRINT_KEYS].sort(),
  );
});

test("2) production schema version matches the authority constant", () => {
  const fingerprint = buildAfcV2EngineFingerprint();
  assert.equal(
    fingerprint.productionSchemaVersion,
    AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  );
  assert.equal(
    AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
    "afc-v2-production-room-authority/v1",
  );
});

test("3) six engineVersions keys are present from the shared helper", () => {
  const fingerprint = buildAfcV2EngineFingerprint();
  assert.deepEqual(
    Object.keys(fingerprint.engineVersions).sort(),
    [...AFC_V2_ENGINE_VERSION_KEYS].sort(),
  );
  assert.deepEqual(
    fingerprint.engineVersions,
    afcV2ProductionEngineVersions(),
  );
});

test("4) READY authority and fingerprint share the same version source", () => {
  const authoritySource = source(
    "lib/afc-v2-production/production-authority-contract.ts",
  );
  const fingerprintSource = source("lib/afc-v2-production/engine-fingerprint.ts");
  assert.match(authoritySource, /export function afcV2ProductionEngineVersions/);
  assert.match(authoritySource, /engineVersions: afcV2ProductionEngineVersions\(\)/);
  assert.match(fingerprintSource, /engineVersions: afcV2ProductionEngineVersions\(\)/);
  assert.equal(typeof buildAfcV2ProductionRoomAuthority, "function");
});

test("5) observation model env override is persisted", () => {
  const fingerprint = buildAfcV2EngineFingerprint({
    env: { AFC_V2_ROOM_OBSERVATION_MODEL: "  gemini-override-model  " },
  });
  assert.equal(fingerprint.observationModelId, "gemini-override-model");
  assert.equal(
    resolveAfcV2ObservationModelId({
      AFC_V2_ROOM_OBSERVATION_MODEL: "  gemini-override-model  ",
    }),
    "gemini-override-model",
  );
});

test("6) observation model default is persisted when env is unset", () => {
  assert.equal(AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL, "gemini-3.5-flash");
  assert.equal(
    AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL,
    AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL,
  );
  const fingerprint = buildAfcV2EngineFingerprint({ env: {} });
  assert.equal(
    fingerprint.observationModelId,
    AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL,
  );
  assert.equal(resolveAfcV2ObservationModelId({}), "gemini-3.5-flash");
});

test("7) git SHA is persisted when VERCEL_GIT_COMMIT_SHA is present", () => {
  const fingerprint = buildAfcV2EngineFingerprint({
    env: { VERCEL_GIT_COMMIT_SHA: "  abcdef123456  " },
  });
  assert.equal(fingerprint.gitSha, "abcdef123456");
  assert.equal(
    resolveAfcV2EngineGitSha({ VERCEL_GIT_COMMIT_SHA: "  abcdef123456  " }),
    "abcdef123456",
  );
});

test("8) git SHA is null when unavailable", () => {
  const fingerprint = buildAfcV2EngineFingerprint({ env: {} });
  assert.equal(fingerprint.gitSha, null);
  assert.equal(resolveAfcV2EngineGitSha({ VERCEL_GIT_COMMIT_SHA: "   " }), null);
  assert.equal(resolveAfcV2EngineGitSha({}), null);
});

test("9) tiled generator/profile/preset/model come from production TILED identity", () => {
  const fingerprint = buildAfcV2EngineFingerprint();
  const tiled = productionTiledEngineIdentity();
  assert.equal(fingerprint.tiled.generatorId, AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID);
  assert.equal(fingerprint.tiled.profileId, AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE);
  assert.equal(fingerprint.tiled.researchPreset, AFC_SR1_TILE_GRID_SCAFFOLD_PRESET);
  assert.equal(
    fingerprint.tiled.requestedModelId,
    AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
  );
  assert.deepEqual(
    {
      generatorId: fingerprint.tiled.generatorId,
      profileId: fingerprint.tiled.profileId,
      researchPreset: fingerprint.tiled.researchPreset,
      requestedModelId: fingerprint.tiled.requestedModelId,
    },
    tiled,
  );
  assert.deepEqual(
    Object.keys(fingerprint.tiled).sort(),
    [...AFC_V2_ENGINE_FINGERPRINT_TILED_KEYS].sort(),
  );
});

test("10) readerVersion starts null at creation", () => {
  const fingerprint = buildAfcV2EngineFingerprint();
  assert.equal(fingerprint.tiled.readerVersion, null);
});

test("11-14) newly created running generations persist a baseline fingerprint", async () => {
  const { store, generation } = await createRunningGeneration();
  assert.equal(generation.status, "running");
  assert.ok(generation.engineFingerprint);
  assert.equal(isAfcV2EngineFingerprintV1(generation.engineFingerprint), true);
  assert.equal(generation.engineFingerprint.tiled.readerVersion, null);
  assert.equal(
    generation.engineFingerprint.productionSchemaVersion,
    AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  );
  assert.deepEqual(
    generation.engineFingerprint.engineVersions,
    afcV2ProductionEngineVersions(),
  );
  const updated = await store.updateGeneration(generation.id, {
    frame: { width: 1200, height: 800 },
  });
  assert.equal(updated.status, "running");
  assert.deepEqual(updated.engineFingerprint, generation.engineFingerprint);
  assert.deepEqual(updated.frame, { width: 1200, height: 800 });
});

test("15-16) terminal fill may set readerVersion without rewriting other keys", async () => {
  const { store, generation } = await createRunningGeneration();
  const baseline = generation.engineFingerprint!;
  const filled = withAfcV2EngineFingerprintReaderVersion(
    baseline,
    "afc-sr1-tiled-perspective-reader/s1",
  );
  assert.equal(filled.tiled.readerVersion, "afc-sr1-tiled-perspective-reader/s1");
  assert.deepEqual(filled.engineVersions, baseline.engineVersions);
  assert.equal(filled.observationModelId, baseline.observationModelId);
  assert.equal(filled.gitSha, baseline.gitSha);
  assert.equal(filled.tiled.generatorId, baseline.tiled.generatorId);
  assert.equal(filled.tiled.profileId, baseline.tiled.profileId);
  assert.equal(filled.tiled.researchPreset, baseline.tiled.researchPreset);
  assert.equal(filled.tiled.requestedModelId, baseline.tiled.requestedModelId);
  const alreadyFilled = withAfcV2EngineFingerprintReaderVersion(
    filled,
    "should-not-replace",
  );
  assert.equal(
    alreadyFilled.tiled.readerVersion,
    "afc-sr1-tiled-perspective-reader/s1",
  );
  const ready = await store.updateGeneration(generation.id, {
    status: "ready",
    completedAt: "2026-09-19T12:00:00.000Z",
    engineFingerprint: filled,
  });
  assert.equal(ready.status, "ready");
  assert.equal(
    ready.engineFingerprint?.tiled.readerVersion,
    "afc-sr1-tiled-perspective-reader/s1",
  );
  assert.deepEqual(ready.engineFingerprint?.engineVersions, baseline.engineVersions);
});

test("17) running → ready is allowed", async () => {
  const { store, generation } = await createRunningGeneration();
  const ready = await store.updateGeneration(generation.id, { status: "ready" });
  assert.equal(ready.status, "ready");
});

test("18) running → failed is allowed", async () => {
  const { store, generation } = await createRunningGeneration();
  const failed = await store.updateGeneration(generation.id, {
    status: "failed",
    failureReason: "reader failed",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, "reader failed");
});

test("19-23) terminal status and fingerprint mutations are rejected", async () => {
  const { store, generation } = await createRunningGeneration();
  const ready = await store.updateGeneration(generation.id, {
    status: "ready",
    completedAt: "2026-09-19T12:00:00.000Z",
    engineFingerprint: withAfcV2EngineFingerprintReaderVersion(
      generation.engineFingerprint!,
      "afc-sr1-tiled-perspective-reader/s1",
    ),
  });
  await assert.rejects(
    () => store.updateGeneration(ready.id, { status: "failed" }),
    AfcGenerationImmutabilityError,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, { status: "running" }),
    AfcGenerationImmutabilityError,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      engineFingerprint: {
        ...ready.engineFingerprint!,
        gitSha: "mutated-sha",
        tiled: { ...ready.engineFingerprint!.tiled },
        engineVersions: { ...ready.engineFingerprint!.engineVersions },
      },
    }),
    /immutable/,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      engineFingerprint: {
        ...ready.engineFingerprint!,
        tiled: {
          ...ready.engineFingerprint!.tiled,
          readerVersion: "mutated-reader",
        },
        engineVersions: { ...ready.engineFingerprint!.engineVersions },
      },
    }),
    /immutable/,
  );
  const failedStart = await createRunningGeneration();
  const failed = await failedStart.store.updateGeneration(
    failedStart.generation.id,
    { status: "failed", failureReason: "boom" },
  );
  await assert.rejects(
    () => failedStart.store.updateGeneration(failed.id, { status: "ready" }),
    AfcGenerationImmutabilityError,
  );
  await assert.rejects(
    () => failedStart.store.updateGeneration(failed.id, { status: "running" }),
    AfcGenerationImmutabilityError,
  );
});

test("24-28) terminal historical evidence cannot mutate", async () => {
  const { store, generation } = await createRunningGeneration();
  const ready = await store.updateGeneration(generation.id, {
    status: "ready",
    completedAt: "2026-09-19T12:00:00.000Z",
    diagnosticPayload: { analysisStatus: "applied" },
    failureReason: null,
    providerProvenance: { readerRerun: true },
    emptyStoragePath: "users/u/rooms/r/afc/g/empty.png",
    tiledStoragePath: "users/u/rooms/r/afc/g/tiled.png",
  });
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      diagnosticPayload: { analysisStatus: "tampered" },
    }),
    /immutable/,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, { failureReason: "rewritten" }),
    /immutable/,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      providerProvenance: { readerRerun: false },
    }),
    /immutable/,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      emptyStoragePath: "users/u/rooms/r/afc/g/empty-mutated.png",
    }),
    /immutable/,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      tiledStoragePath: "users/u/rooms/r/afc/g/tiled-mutated.png",
    }),
    /immutable/,
  );
  await assert.rejects(
    () => store.updateGeneration(ready.id, {
      completedAt: "2099-01-01T00:00:00.000Z",
    }),
    /immutable/,
  );
  const unchanged = await store.updateGeneration(ready.id, {
    completedAt: ready.completedAt,
    diagnosticPayload: ready.diagnosticPayload,
  });
  assert.equal(unchanged.completedAt, ready.completedAt);
});

test("29) UPDATE trigger design does not block DELETE/cascade", () => {
  assert.match(
    PRODUCTION_MIGRATION,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    PRODUCTION_MIGRATION,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    MIGRATION,
    /create or replace function public\.vibode_afc_generations_protect_authority/,
  );
  assert.doesNotMatch(MIGRATION, /before update or delete/);
  assert.doesNotMatch(MIGRATION, /before delete on public\.vibode_afc_generations/);
  assert.doesNotMatch(TRIGGER_BODY, /tg_op = 'DELETE'|TG_OP = 'DELETE'/);
  assert.match(
    MIGRATION,
    /DELETE is intentionally not protected so room\/user cascade still works/,
  );
});

test("migration adds nullable engine_fingerprint without historical backfill", () => {
  assert.match(
    MIGRATION,
    /add column if not exists engine_fingerprint jsonb null/,
  );
  assert.doesNotMatch(
    withoutComments(MIGRATION),
    /engine_fingerprint jsonb not null/,
  );
  assert.doesNotMatch(
    withoutComments(MIGRATION),
    /update public\.vibode_afc_generations[\s\S]*engine_fingerprint/,
  );
  assert.match(
    MIGRATION,
    /jsonb_typeof\(engine_fingerprint\) = 'object'/,
  );
});

test("terminal freeze is based on OLD.status and allows running completion writes", () => {
  assert.match(TRIGGER_BODY, /if old\.status in \('ready', 'failed'\)/);
  assert.match(TRIGGER_BODY, /new\.status is distinct from old\.status/);
  assert.match(
    TRIGGER_BODY,
    /new\.engine_fingerprint is distinct from old\.engine_fingerprint/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.production_authority is distinct from old\.production_authority/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.diagnostic_payload is distinct from old\.diagnostic_payload/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.failure_reason is distinct from old\.failure_reason/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.provider_provenance is distinct from old\.provider_provenance/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.completed_at is distinct from old\.completed_at/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.empty_storage_path is distinct from old\.empty_storage_path/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.tiled_storage_path is distinct from old\.tiled_storage_path/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.tiled_cache_key is distinct from old\.tiled_cache_key/,
  );
  assert.match(
    TRIGGER_BODY,
    /new\.tiled_force_regeneration is distinct from old\.tiled_force_regeneration/,
  );
  assert.doesNotMatch(TRIGGER_BODY, /if new\.status in \('ready', 'failed'\)/);
  assert.match(
    TRIGGER_BODY,
    /raise exception 'AFC generation historical evidence is immutable once terminal'/,
  );
});

test("identity freeze keeps parent_generation_id, run_id, lineage, room, and user", () => {
  for (const field of [
    "id",
    "lineage_seq",
    "room_id",
    "user_id",
    "run_id",
    "parent_generation_id",
    "created_at",
  ]) {
    assert.match(
      TRIGGER_BODY,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(
    PRODUCTION_MIGRATION,
    /parent_generation_id uuid null references public\.vibode_afc_generations\(id\) on delete set null/,
  );
  assert.doesNotMatch(withoutComments(MIGRATION), /alter table public\.vibode_rooms/);
  assert.doesNotMatch(withoutComments(MIGRATION), /activate_vibode_afc_generation/);
  assert.doesNotMatch(withoutComments(MIGRATION), /current_afc_generation_id/);
});

test("AFD-1B does not implement capability, sessions, or public fingerprint APIs", () => {
  assert.doesNotMatch(MIGRATION, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
  assert.doesNotMatch(MIGRATION, /vibode_afc_diagnostic_sessions/);
  assert.doesNotMatch(MIGRATION, /\/api\/vibode\/afc\/qa/);
  const productionFiles = walkTs(path.join(ROOT, "lib/afc-v2-production"));
  const apiFiles = walkTs(path.join(ROOT, "app/api/vibode/afc")).filter(
    (file) => !file.includes(`${path.sep}afc${path.sep}qa${path.sep}`),
  );
  const analyzeRoute = path.join(ROOT, "app/api/vibode/afc/analyze/route.ts");
  for (const file of [...productionFiles, ...apiFiles]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
    if (file === analyzeRoute) continue;
    assert.doesNotMatch(text, /afc-v2-diagnostics|vibode_afc_diagnostic_/);
  }
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  const restore = source("app/api/vibode/afc/restore/route.ts");
  const runtime = source("app/api/vibode/afc/runtime/route.ts");
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const publicResponse = adapter.slice(
    adapter.indexOf("function publicResponse"),
    adapter.indexOf("async function resolveOriginalIdentity"),
  );
  assert.doesNotMatch(analyze, /engineFingerprint|engine_fingerprint/);
  assert.doesNotMatch(restore, /engineFingerprint|engine_fingerprint/);
  assert.doesNotMatch(runtime, /engineFingerprint|engine_fingerprint/);
  assert.doesNotMatch(publicResponse, /engineFingerprint|engine_fingerprint/);
  assert.match(publicResponse, /status: input\.status/);
  assert.match(publicResponse, /authority: input\.authority/);
});

test("fingerprint omits privileged provenance and passes the privacy scanner", () => {
  const fingerprint = buildAfcV2EngineFingerprint({
    env: { VERCEL_GIT_COMMIT_SHA: "deadbeef" },
  });
  assert.equal(collectProductionPayloadPrivacyViolations(fingerprint).length, 0);
  const serialized = JSON.stringify(fingerprint);
  assert.doesNotMatch(serialized, /prompt|storagePath|userId|roomId|apiKey|imageUrl/);
  assert.doesNotMatch(serialized, /NODE_ENV|freezeReceipt|executionCounts/);
});

test("store createGeneration uses process env for observation model and git SHA", async () => {
  const previousModel = process.env.AFC_V2_ROOM_OBSERVATION_MODEL;
  const previousSha = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.AFC_V2_ROOM_OBSERVATION_MODEL = "env-observation-model";
  process.env.VERCEL_GIT_COMMIT_SHA = "env-git-sha";
  try {
    const { generation } = await createRunningGeneration();
    assert.equal(generation.engineFingerprint?.observationModelId, "env-observation-model");
    assert.equal(generation.engineFingerprint?.gitSha, "env-git-sha");
  } finally {
    if (previousModel === undefined) delete process.env.AFC_V2_ROOM_OBSERVATION_MODEL;
    else process.env.AFC_V2_ROOM_OBSERVATION_MODEL = previousModel;
    if (previousSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousSha;
  }
});
