import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  acceptCleanupHistory,
  classifyCleanupCandidateAspect,
  CLEANUP_HISTORY_LABEL,
  createCleanupHistoryLedger,
  isCleanupHistoryAsset,
} from "@/lib/vibode-stage/remove-cleanup-history";
import {
  cleanupHistoryFallbackVersions,
  cleanupHistoryRoomToRefresh,
  cleanupHistoryVersionSecondaryLabel,
} from "@/lib/vibode-stage/remove-cleanup-history-ui";
import { acceptSupabaseCleanupHistory } from "@/lib/vibode-stage/remove-cleanup-jobs/accept.server";
import { createMemoryCleanupArtifacts } from "@/lib/vibode-stage/remove-cleanup-jobs/artifacts";
import { handleRemoveCleanupAccept } from "@/lib/vibode-stage/remove-cleanup-jobs/http";
import { createMemoryCleanupControl, type CleanupControl } from "@/lib/vibode-stage/remove-cleanup-jobs/runtime";
import type { CleanupJobRow } from "@/lib/vibode-stage/remove-cleanup-jobs/types";

const JOB = "08e11e8a-c3b5-4845-80ef-4a0a25b48e97";
const ROOM = "077ef88b-c359-4253-bac3-ffc9efbe3a55";
const GENERATION = "44b6bbd2-dcf4-4842-a752-efc52202d0eb";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function succeeded(patch: Partial<CleanupJobRow> = {}): CleanupJobRow {
  const bytes = patch.outputSha256 ? new Uint8Array() : new Uint8Array([1, 2, 3, 4]);
  return {
    id: JOB,
    userId: ADMIN,
    roomId: ROOM,
    afcGenerationId: GENERATION,
    paidRequestFingerprint: "a".repeat(64),
    inputFingerprint: "b".repeat(64),
    status: "succeeded",
    hiddenObjectCount: 1,
    hiddenConcepts: ["table"],
    selection: [],
    originalSha256: "d327869be538fc3f53a1308ad36d698ccf0bacc23026c30cc7e07f205a3d7e7f",
    originalMime: "image/jpeg",
    originalByteCount: 65855,
    originalWidth: 960,
    originalHeight: 640,
    overlaySha256: "c".repeat(64),
    promptSha256: "d".repeat(64),
    promptVersion: "remove-cleanup-prompt/v1",
    maskManifestSha256: "e".repeat(64),
    aspectRatioFamily: "3:2",
    documented1kGridWidth: 1264,
    documented1kGridHeight: 848,
    resolutionClass: "2K",
    outputMime: "image/jpeg",
    provider: "google-gemini-interactions",
    requestedModelId: "gemini-3-pro-image",
    artifactBucket: "vibode-cleanup",
    originalPath: "rooms/x/original.jpg",
    overlayPath: "rooms/x/overlay.png",
    promptPath: "rooms/x/prompt.txt",
    masksPath: "rooms/x/masks.json",
    outputPath: "rooms/x/candidate.jpg",
    outputSha256: sha256Hex(bytes),
    outputWidth: 2528,
    outputHeight: 1696,
    returnedModelId: "gemini-3-pro-image",
    interactionId: null,
    usage: null,
    stageRegistration: "not-assessed",
    providerStartedAtMs: 1,
    providerAttemptId: null,
    claimNonce: null,
    claimExpiresAtMs: null,
    claimedAtMs: null,
    heartbeatAtMs: null,
    attemptCount: 1,
    failureCode: null,
    failureMessage: null,
    providerStatus: "completed",
    providerHttpStatus: 200,
    latencyMs: 1,
    discardedAtMs: null,
    notBeforeMs: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
    completedAtMs: 2,
    retryOfJobId: null,
    retryOrdinal: 0,
    historyAssetId: null,
    acceptedAtMs: null,
    ...patch,
  };
}

function decode(width: number, height: number, orientation = 1) {
  return async () => ({ width, height, orientation });
}

test("the live NBP candidate passes the established 1.5 percent aspect tolerance", () => {
  const admitted = classifyCleanupCandidateAspect({
    originalWidth: 960,
    originalHeight: 640,
    candidateWidth: 2528,
    candidateHeight: 1696,
  });
  assert.equal(admitted.ok, true);
  if (!admitted.ok) return;
  assert.equal(admitted.tier, "aspect_compatible_rescaled");
  const expected = Math.abs((2528 / 1696) - (960 / 640)) / (960 / 640);
  assert.ok(Math.abs(admitted.relativeAspectError - expected) < 1e-12);
  assert.ok(admitted.relativeAspectError < 0.015);
  const portrait = classifyCleanupCandidateAspect({
    originalWidth: 640,
    originalHeight: 960,
    candidateWidth: 1696,
    candidateHeight: 2528,
  });
  assert.equal(portrait.ok && portrait.tier, "aspect_compatible_rescaled");
  const exact = classifyCleanupCandidateAspect({
    originalWidth: 1200,
    originalHeight: 896,
    candidateWidth: 1200,
    candidateHeight: 896,
  });
  assert.equal(exact.ok && exact.tier, "exact_grid_compatible");
  const wide = classifyCleanupCandidateAspect({
    originalWidth: 1376,
    originalHeight: 768,
    candidateWidth: 2752,
    candidateHeight: 1536,
  });
  assert.equal(wide.ok, true);
  const tall = classifyCleanupCandidateAspect({
    originalWidth: 768,
    originalHeight: 1376,
    candidateWidth: 1536,
    candidateHeight: 2752,
  });
  assert.equal(tall.ok, true);
  const square = classifyCleanupCandidateAspect({
    originalWidth: 1024,
    originalHeight: 1024,
    candidateWidth: 2048,
    candidateHeight: 2048,
  });
  assert.equal(square.ok, true);
  const fourThree = classifyCleanupCandidateAspect({
    originalWidth: 1200,
    originalHeight: 896,
    candidateWidth: 2400,
    candidateHeight: 1792,
  });
  assert.equal(fourThree.ok, true);
  const outside = classifyCleanupCandidateAspect({
    originalWidth: 960,
    originalHeight: 640,
    candidateWidth: 2000,
    candidateHeight: 640,
  });
  assert.equal(outside.ok, false);
  const turned = classifyCleanupCandidateAspect({
    originalWidth: 960,
    originalHeight: 640,
    candidateWidth: 2528,
    candidateHeight: 1696,
    candidateOrientation: 6,
  });
  assert.equal(turned.ok, false);
});

test("acceptance copies the candidate once and does not activate the room", async () => {
  const bytes = Uint8Array.from([9, 8, 7, 6, 5]);
  const job = succeeded({ outputSha256: sha256Hex(bytes) });
  const ledger = createCleanupHistoryLedger();
  const accepted = await acceptCleanupHistory({
    job,
    bytes,
    nowMs: 50,
    ledger,
    decode: decode(2528, 1696),
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.created, true);
  assert.equal(accepted.activated, false);
  assert.equal(accepted.asset.isActive, false);
  assert.equal(accepted.asset.label, CLEANUP_HISTORY_LABEL);
  assert.equal(accepted.asset.width, 2528);
  assert.equal(accepted.asset.height, 1696);
  assert.deepEqual(accepted.asset.bytes, bytes);
  assert.equal(accepted.asset.sourceAfcGenerationId, GENERATION);
  assert.equal(ledger.roomUpdates, 0);
  assert.equal(ledger.assets.length, 1);
  const again = await acceptCleanupHistory({
    job,
    bytes,
    nowMs: 60,
    ledger,
    decode: decode(2528, 1696),
  });
  assert.equal(again.ok && again.created, false);
  assert.equal(again.ok && again.asset.id, accepted.asset.id);
  assert.equal(ledger.assets.length, 1);
  assert.equal(job.outputSha256, sha256Hex(bytes));
});

test("concurrent acceptance and a failed insert recover as one asset", async () => {
  const bytes = Uint8Array.from([4, 4, 4, 4]);
  const job = succeeded({ outputSha256: sha256Hex(bytes) });
  const ledger = createCleanupHistoryLedger();
  const input = { job, bytes, nowMs: 10, ledger, decode: decode(2528, 1696) };
  const [first, second] = await Promise.all([
    acceptCleanupHistory(input),
    acceptCleanupHistory(input),
  ]);
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.asset.id, second.asset.id);
  assert.equal(ledger.assets.length, 1);
  assert.equal(ledger.roomUpdates, 0);

  const retryJob = succeeded({ id: "11111111-1111-4111-8111-111111111111", outputSha256: sha256Hex(bytes) });
  const retryLedger = createCleanupHistoryLedger();
  retryLedger.failInserts = 1;
  const failed = await acceptCleanupHistory({
    job: retryJob,
    bytes,
    nowMs: 11,
    ledger: retryLedger,
    decode: decode(2528, 1696),
  });
  assert.deepEqual(failed, { ok: false, code: "unavailable" });
  assert.equal(retryJob.historyAssetId, null);
  assert.equal(retryLedger.assets.length, 0);
  assert.equal(retryLedger.objects.size, 1);
  const recovered = await acceptCleanupHistory({
    job: retryJob,
    bytes,
    nowMs: 12,
    ledger: retryLedger,
    decode: decode(2528, 1696),
  });
  assert.equal(recovered.ok && recovered.created, true);
  assert.equal(retryLedger.assets.length, 1);
  assert.equal(retryLedger.roomUpdates, 0);
});

test("ineligible and corrupt candidates are refused before publication", async () => {
  const bytes = Uint8Array.from([1, 1, 1, 1]);
  const ledger = createCleanupHistoryLedger();
  const missing = await acceptCleanupHistory({
    job: null,
    bytes,
    nowMs: 1,
    ledger,
    decode: decode(2528, 1696),
  });
  assert.deepEqual(missing, { ok: false, code: "not_found" });
  const failed = await acceptCleanupHistory({
    job: succeeded({ status: "failed", outputSha256: sha256Hex(bytes) }),
    bytes,
    nowMs: 1,
    ledger,
    decode: decode(2528, 1696),
  });
  assert.deepEqual(failed, { ok: false, code: "not_succeeded" });
  const discarded = await acceptCleanupHistory({
    job: succeeded({ outputSha256: sha256Hex(bytes), discardedAtMs: 9 }),
    bytes,
    nowMs: 1,
    ledger,
    decode: decode(2528, 1696),
  });
  assert.deepEqual(discarded, { ok: false, code: "discarded" });
  const corrupt = await acceptCleanupHistory({
    job: succeeded({ outputSha256: "f".repeat(64) }),
    bytes,
    nowMs: 1,
    ledger,
    decode: decode(2528, 1696),
  });
  assert.deepEqual(corrupt, { ok: false, code: "candidate_mismatch" });
  const outside = await acceptCleanupHistory({
    job: succeeded({ outputSha256: sha256Hex(bytes), outputWidth: 2000, outputHeight: 640 }),
    bytes,
    nowMs: 1,
    ledger,
    decode: decode(2000, 640),
  });
  assert.deepEqual(outside, { ok: false, code: "aspect_incompatible" });
  assert.equal(ledger.assets.length, 0);
  assert.equal(ledger.objects.size, 0);
  assert.equal(ledger.roomUpdates, 0);
});

test("an owned success publishes once and another admin is rejected", async () => {
  const bytes = Uint8Array.from([3, 3, 3, 3]);
  const job = succeeded({ outputSha256: sha256Hex(bytes) });
  const artifacts = createMemoryCleanupArtifacts();
  assert.equal(await artifacts.put(job.outputPath ?? "", bytes, "image/jpeg"), "ok");
  const control = createMemoryCleanupControl({
    artifacts,
    database: { jobs: [job] },
    decode: async () => ({ width: 2528, height: 1696, orientation: 1 }),
    now: () => 80,
  });
  const deps = {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: {} as never,
    control,
  };
  const foreign = await handleRemoveCleanupAccept({ ...deps, getAdmin: async () => ({ id: OTHER }) }, JOB);
  assert.equal(foreign.status, 404);
  assert.equal(control.ledger.assets.length, 0);
  const failed = await handleRemoveCleanupAccept(deps, "e8853958-13bd-415e-a4f7-da092c2e3a4c");
  assert.equal(failed.status, 404);

  const first = await handleRemoveCleanupAccept(deps, JOB);
  assert.equal(first.status, 200);
  const body = await first.json() as { created: boolean; activated: boolean; assetId: string; label: string; job: { accepted: boolean; historyAssetId: string } };
  assert.equal(body.created, true);
  assert.equal(body.activated, false);
  assert.equal(body.label, CLEANUP_HISTORY_LABEL);
  assert.equal(body.job.accepted, true);
  assert.equal(body.job.historyAssetId, body.assetId);
  assert.deepEqual(control.ledger.assets[0]?.bytes, bytes);

  const second = await handleRemoveCleanupAccept(deps, JOB);
  const again = await second.json() as { created: boolean; assetId: string; activated: boolean };
  assert.equal(second.status, 200);
  assert.equal(again.created, false);
  assert.equal(again.activated, false);
  assert.equal(again.assetId, body.assetId);
  assert.equal(control.ledger.assets.length, 1);
  assert.equal(control.ledger.roomUpdates, 0);
});

test("accept requires a signed-in user and history publication stays inactive", async () => {
  const denied = await handleRemoveCleanupAccept({
    getAdmin: async () => null,
    prepareDeps: {} as never,
    control: { accept: async () => { throw new Error("unreachable"); } } as unknown as CleanupControl,
  }, JOB);
  assert.equal(denied.status, 404);
  let calls = 0;
  const allowed = await handleRemoveCleanupAccept({
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: {} as never,
    control: {
      accept: async () => {
        calls += 1;
        return { ok: false, code: "not_found" };
      },
      readJob: async () => null,
    } as unknown as CleanupControl,
  }, JOB);
  assert.equal(allowed.status, 404);
  assert.equal(calls, 1);
  const sql = source("supabase/migrations/20261021153000_vibode_cleanup_history_acceptance.sql");
  const component = `${source("components/stage/RemoveCleanupGeneration.tsx")}\n${source("components/stage/RemoveCleanupReviewViewer.tsx")}`;
  const timeline = source("components/editor/ImageHistoryTimeline.tsx");
  const acceptServer = source("lib/vibode-stage/remove-cleanup-jobs/accept.server.ts");
  const harmonize = source("lib/vibode-stage/harmonize-jobs/history-publication.server.ts");
  assert.match(sql, /accept_vibode_cleanup_history/);
  assert.match(sql, /vibode_room_assets_cleanup_job_id_uidx/);
  assert.match(sql, /false,\s*\n\s*true,\s*\n\s*v_job\.id/);
  assert.match(sql, /'Clean Up Room'/);
  assert.doesNotMatch(sql, /update public\.vibode_rooms|vibode_3d_scenes|vibode_afc|generativelanguage/);
  assert.match(sql, /grant execute on function public\.accept_vibode_cleanup_history/);
  assert.match(component, /Accept into History/);
  assert.match(component, /disabled=\{accepting\}|acceptLock/);
  assert.doesNotMatch(component, /setActiveVersion|active_asset_id|room_scale_multiplier|publishHarmonize/);
  assert.match(timeline, /cleanupHistoryFallbackVersions/);
  assert.equal(isCleanupHistoryAsset({ metadata: { cleanupJobId: JOB } }), true);
  assert.ok(acceptServer.indexOf("cleanupHistoryPublicationReady") < acceptServer.indexOf("placeHistoryObject"));
  assert.match(acceptServer, /current_afc_generation_id !== job\.afcGenerationId/);
  assert.match(acceptServer, /\.metadata\(\)/);
  assert.doesNotMatch(acceptServer, /\.update\(|toBuffer\(|generativelanguage/);
  assert.doesNotMatch(harmonize, /accept_vibode_cleanup_history|cleanup_job_id/);
});

test("a missing History schema or accept function copies nothing into History storage", async () => {
  const absentSchema = recordingClient({ schema: false, probe: "missing-function" });
  const schemaResult = await acceptSupabaseCleanupHistory(absentSchema.client, succeeded());
  assert.deepEqual(schemaResult, { ok: false, code: "unavailable" });
  assert.deepEqual(absentSchema.events, []);

  const absentFunction = recordingClient({ schema: true, probe: "missing-function" });
  const functionResult = await acceptSupabaseCleanupHistory(absentFunction.client, succeeded());
  assert.deepEqual(functionResult, { ok: false, code: "unavailable" });
  assert.deepEqual(absentFunction.events, ["probe"]);
});

test("partial History publication recovers the same bytes without another generation", async () => {
  const jpeg = new Uint8Array(await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 12, g: 24, b: 36 } },
  }).jpeg().toBuffer());
  const job = succeeded({
    outputSha256: sha256Hex(jpeg),
    outputWidth: 8,
    outputHeight: 8,
    originalWidth: 8,
    originalHeight: 8,
  });
  const recorded = recordingClient({ schema: true, probe: "ready", jpeg, jobId: job.id });
  const first = await acceptSupabaseCleanupHistory(recorded.client, job);
  assert.deepEqual(first, { ok: false, code: "unavailable" });
  assert.equal(recorded.uploads.length, 1);
  assert.equal(sha256Hex(recorded.uploads[0] ?? new Uint8Array()), job.outputSha256);
  const second = await acceptSupabaseCleanupHistory(recorded.client, job);
  assert.equal(second.ok && second.created, true);
  assert.equal(second.ok && second.activated, false);
  assert.equal(second.ok && second.asset.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(second.ok && second.asset.sourceAssetId, null);
  assert.equal(second.ok && second.asset.sourceAfcGenerationId, GENERATION);
  assert.deepEqual(second.ok ? second.asset.bytes : null, jpeg);
  assert.equal(recorded.uploads.length, 1);
  assert.equal(recorded.events[0], "probe");
  assert.ok(recorded.events.indexOf("probe") < recorded.events.indexOf("upload:vibode-generations"));
  assert.equal(recorded.publishArguments.at(-1)?.p_source_asset_id, null);
  const third = await acceptSupabaseCleanupHistory(recorded.client, job);
  assert.equal(third.ok && third.created, false);
  assert.equal(third.ok && third.asset.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(recorded.uploads.length, 1);
});

test("a Clean Up card is shown once, in its lineage group or the fallback strip", () => {
  const cleanup = { id: "asset-1", metadata: { cleanupJobId: JOB } };
  const duplicate = { id: "asset-1", metadata: { cleanupJobId: JOB } };
  const hidden = { id: "asset-2", metadata: { cleanupJobId: JOB } };
  const harmonized = { id: "asset-3", metadata: { harmonizeJobId: JOB } };
  const fallback = cleanupHistoryFallbackVersions([cleanup, duplicate, hidden, harmonized], new Set(["asset-1"]));
  assert.deepEqual(fallback.map((version) => version.id), ["asset-2"]);
});

test("successful acceptance refreshes one room and a failed or activating response does not", () => {
  const refreshed = new Set<string>();
  assert.equal(cleanupHistoryRoomToRefresh({
    responseOk: true,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    refreshedJobIds: refreshed,
  }), ROOM);
  refreshed.add(JOB);
  assert.equal(cleanupHistoryRoomToRefresh({
    responseOk: true,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    refreshedJobIds: refreshed,
  }), null);
  assert.equal(cleanupHistoryRoomToRefresh({
    responseOk: false,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    refreshedJobIds: new Set(),
  }), null);
  assert.equal(cleanupHistoryRoomToRefresh({
    responseOk: true,
    activated: true,
    roomId: ROOM,
    jobId: JOB,
    refreshedJobIds: new Set(),
  }), null);
});

test("Clean Up versions are labeled Clean Up Room and other stage rows keep their label", () => {
  const stageLabel = "Stage 3 · gemini-3-pro-image";
  assert.equal(
    cleanupHistoryVersionSecondaryLabel({ metadata: { cleanupJobId: JOB } }, stageLabel),
    CLEANUP_HISTORY_LABEL,
  );
  assert.equal(
    cleanupHistoryVersionSecondaryLabel({ metadata: { versionKind: "stage" }, model_version: "gemini-3-pro-image" }, stageLabel),
    stageLabel,
  );
  assert.equal(
    cleanupHistoryVersionSecondaryLabel({ asset_type: "base" }, "Original upload"),
    "Original upload",
  );
});

test("acceptance refresh keeps the current image and updates both History surfaces", () => {
  const editor = source("app/editor/page.tsx");
  const generation = source("components/stage/RemoveCleanupGeneration.tsx");
  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");
  const accept = generation.slice(
    generation.indexOf("async function acceptIntoHistory"),
    generation.indexOf("async function discard"),
  );
  const failure = accept.slice(0, accept.indexOf("publishCleanupJob"));
  const recovery = accept.slice(accept.indexOf("catch {"));
  assert.doesNotMatch(failure, /onHistoryAccepted/);
  assert.ok(accept.indexOf("publishCleanupJob") < accept.indexOf("onHistoryAccepted"));
  assert.match(accept, /await onHistoryAccepted\?\.\(roomToRefresh\)/);
  assert.doesNotMatch(recovery, /setJob|setPhase|setError|handleSelectVersion/);
  const callback = editor.slice(
    editor.indexOf("const refreshCleanupHistory"),
    editor.indexOf("const selectedVersionIdRef"),
  );
  assert.match(callback, /await refreshRoomVersions\(roomId\)/);
  assert.match(callback, /setActiveAssetId\(previousActiveId\)/);
  assert.doesNotMatch(callback, /handleSelectVersion|applyVersionToEditorState|setWorkingImageUrl|publishHarmonize|room_scale_multiplier/);
  assert.match(shell, /onCleanupHistoryAccepted=\{onCleanupHistoryAccepted\}/);
  assert.match(session, /onHistoryAccepted=\{session\.onCleanupHistoryAccepted\}/);
  assert.match(editor, /<ImageHistoryTimeline[\s\S]*versions=\{versions\}/);
  assert.match(editor, /\{versions\.length\} version/);
  assert.match(editor, /cleanupHistoryVersionSecondaryLabel/);
  const original = "96063c22-c76a-485d-b77b-6d74a991c4c2";
  const accepted = "9b44883f-f7f8-4a2f-9a5d-2d321045e29e";
  const fallback = cleanupHistoryFallbackVersions(
    [
      { id: original, asset_type: "base" },
      { id: accepted, metadata: { cleanupJobId: JOB, versionKind: "stage" } },
    ],
    new Set([original]),
  );
  assert.deepEqual(fallback.map((version) => version.id), [accepted]);
});

function recordingClient(input: Readonly<{
  schema: boolean;
  probe: "missing-function" | "ready";
  jpeg?: Uint8Array;
  jobId?: string;
}>): {
  client: SupabaseClient;
  events: string[];
  uploads: Uint8Array[];
  publishArguments: Array<Record<string, unknown>>;
} {
  const events: string[] = [];
  const uploads: Uint8Array[] = [];
  const publishArguments: Array<Record<string, unknown>> = [];
  const history = new Map<string, Uint8Array>();
  let realPublishes = 0;
  const missingColumn = { data: null, error: { message: "column does not exist", code: "42703" } };
  const readyColumn = { data: [], error: null };
  const client = {
    from(table: string) {
      const result = !input.schema
        ? missingColumn
        : table === "vibode_rooms"
          ? {
              data: {
                active_asset_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                current_afc_generation_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              },
              error: null,
            }
          : readyColumn;
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        limit() { return Promise.resolve(result); },
        maybeSingle() { return Promise.resolve(result); },
      };
      return builder;
    },
    async rpc(_name: string, args: Record<string, unknown>) {
      if (args.p_job_id !== input.jobId) {
        events.push("probe");
        if (input.probe === "missing-function") return { data: null, error: { message: "function does not exist", code: "PGRST202" } };
        return { data: { ok: false, code: "not_found" }, error: null };
      }
      publishArguments.push(args);
      realPublishes += 1;
      if (realPublishes === 1) return { data: null, error: { message: "temporary" } };
      return {
        data: {
          ok: true,
          code: realPublishes === 2 ? "accepted" : "already_accepted",
          assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          generationRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          activated: false,
        },
        error: null,
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            events.push(`download:${bucket}`);
            const bytes = bucket === "vibode-cleanup" ? input.jpeg : history.get(path);
            if (!bytes) return { data: null, error: { message: "missing" } };
            const copy = bytes.slice();
            return { data: { arrayBuffer: async () => copy.buffer }, error: null };
          },
          async upload(path: string, body: Uint8Array) {
            events.push(`upload:${bucket}`);
            if (history.has(path)) return { error: { message: "The resource already exists" } };
            const copy = new Uint8Array(body);
            history.set(path, copy);
            uploads.push(copy);
            return { error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, events, uploads, publishArguments };
}
