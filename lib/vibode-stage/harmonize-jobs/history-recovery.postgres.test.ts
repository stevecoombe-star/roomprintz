/**
 * Applies the Harmonize recovery migration to disposable Postgres 16.
 * No hosted database, published port, or provider call.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "harmonize-pg-3b2a2-disposable";
const SHA = "ab".repeat(32);
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const USER_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const USER_D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const ROOM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ROOM_ACT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const ROOM_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const ROOM_D = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const ASSET_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ASSET_ACT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const ASSET_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const ASSET_D = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SCENE_MATCH = [{ objectId: "obj-1", assetId: "asset-1", transform: { uniformScale: 1, position: { x: 1, y: 0, z: 2 } } }];
const SCENE_OTHER = [{ objectId: "obj-1", assetId: "asset-1", transform: { uniformScale: 1, position: { x: 9, y: 0, z: 2 } } }];

type Json = Record<string, unknown>;

test("postgres 16 schedules durable history and thumbnail recovery", { timeout: 360_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await bootstrap();
    await apply("20261012090000_vibode_harmonize_generations.sql");
    await apply("20261013010000_vibode_harmonize_exact_claim.sql");
    await seed();
    const legacyId = await succeedLegacy();

    await apply("20261013140000_vibode_harmonize_history_publication.sql");
    await apply("20261013150000_vibode_harmonize_enqueue_publication.sql");
    await apply("20261015190000_vibode_harmonize_global_ceilings.sql");
    await apply("20261015200000_vibode_harmonize_history_recovery.sql");
    assert.match(await psql("select current_setting('server_version')"), /^16\./);
    assert.equal(await psql("select public.vibode_harmonize_global_provider_limit()"), "10");
    assert.equal(await psql("select public.vibode_harmonize_recovery_backoff(4) = interval '15 minutes'"), "t");
    assert.equal(await psql(
      "select position('recovery_nonce' in pg_get_functiondef('public.publish_vibode_harmonize_history(uuid,text,text,text)'::regprocedure))",
    ), "0");
    assert.notEqual(await psql(
      "select position('global_busy' in pg_get_functiondef('public.claim_next_vibode_harmonize_generation()'::regprocedure))",
    ), "0");

    assert.equal((await job(legacyId)).history_state, "unavailable");
    await parkProviderContacts();
    const beforeLegacy = await identity(legacyId);

    await assertGrants();
    const idle = await claimRecovery();
    assert.equal(idle, null, "legacy unavailable job was claimed");
    assert.equal(await identity(legacyId), beforeLegacy);

    const crash = await succeed(USER_B, ROOM_B, ASSET_B, key(2), SCENE_OTHER, 1);
    const [first, second] = await Promise.all([claimRecovery(), claimRecovery()]);
    const winners = [first, second].filter((item) => item != null);
    assert.equal(winners.length, 1, JSON.stringify([first, second]));
    assert.equal(winners[0]?.jobId, crash);
    assert.equal(winners[0]?.kind, "history");
    assert.equal((await job(crash)).history_attempt_count, 0);
    assert.equal((await job(crash)).status, "succeeded");
    const crashNonce = String(winners[0]?.recoveryNonce);
    await expireRecovery(crash);
    const reaped = await claimRecovery();
    assert.equal(reaped, null, "an abandoned claim was retried before its backoff");
    const abandoned = await job(crash);
    assert.equal(abandoned.history_state, "pending");
    assert.equal(abandoned.history_attempt_count, 1);
    assert.equal(abandoned.history_blocked_at, null);
    assert.equal(abandoned.recovery_nonce, null);
    assert.ok(await delaySeconds(crash, "history") >= 4 && await delaySeconds(crash, "history") <= 6);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${crash}'`), 0);
    const stale = await failRecovery(crash, crashNonce, "output_unreadable");
    assert.equal(stale.code, "stale_recovery", JSON.stringify(stale));
    assert.equal((await job(crash)).history_attempt_count, 1);
    const staleComplete = await completeRecovery(crash, crashNonce);
    assert.equal(staleComplete.code, "stale_recovery", JSON.stringify(staleComplete));
    assert.equal((await job(crash)).history_attempt_count, 1);
    assert.equal((await job(crash)).history_state, "pending");
    assert.equal((await job(crash)).recovery_nonce, null);
    assert.equal(await claimRecovery(), null);
    await elapse(crash, "history");
    const terminalAbandoned = await take(crash, "history");
    const blockedAbandoned = await failRecovery(crash, terminalAbandoned, "output_mismatch");
    assert.equal(blockedAbandoned.blocked, true, JSON.stringify(blockedAbandoned));
    assert.equal((await job(crash)).history_block_code, "output_mismatch");
    assert.equal(await claimRecovery(), null);

    const transient = await succeed(USER_B, ROOM_B, ASSET_B, key(3), SCENE_OTHER, 1);
    const waits = [5, 15, 45, 180];
    for (let attempt = 0; attempt < waits.length; attempt += 1) {
      const nonce = await take(transient, "history");
      const failed = await failRecovery(transient, nonce, "output_unreadable");
      assert.equal(failed.blocked, false, JSON.stringify(failed));
      assert.equal((await job(transient)).history_attempt_count, attempt + 1);
      const delay = await delaySeconds(transient, "history");
      assert.ok(delay >= waits[attempt] - 2 && delay <= waits[attempt] + 2, `wait ${attempt} was ${delay}`);
      await elapse(transient, "history");
    }
    const fifthNonce = await take(transient, "history");
    const fifth = await failRecovery(transient, fifthNonce, "publication_failed");
    assert.equal(fifth.blocked, true, JSON.stringify(fifth));
    assert.equal((await job(transient)).history_attempt_count, 5);
    assert.equal((await job(transient)).history_block_code, "publication_failed");
    assert.equal((await job(transient)).history_state, "pending");
    assert.equal(await claimRecovery(), null);

    const mismatch = await succeed(USER_B, ROOM_B, ASSET_B, key(4), SCENE_OTHER, 1);
    const mismatchNonce = await take(mismatch, "history");
    const mismatchFail = await failRecovery(mismatch, mismatchNonce, "output_mismatch");
    assert.equal(mismatchFail.blocked, true, JSON.stringify(mismatchFail));
    assert.equal((await job(mismatch)).history_attempt_count, 1);
    assert.equal((await job(mismatch)).history_not_before, null);
    assert.equal(await claimRecovery(), null);

    const other = await succeed(USER_B, ROOM_B, ASSET_B, key(5), SCENE_OTHER, 1);
    const otherNonce = await take(other, "history");
    await failRecovery(other, otherNonce, "source_mismatch");
    assert.equal((await job(other)).history_block_code, "source_mismatch");
    const mismatchIdentity = await identity(mismatch);
    const unblocked = await call(`select public.unblock_vibode_harmonize_history_recovery('${mismatch}')`);
    assert.equal(unblocked.code, "unblocked", JSON.stringify(unblocked));
    assert.equal((await job(other)).history_blocked_at == null, false);
    assert.equal((await job(mismatch)).history_state, "pending");
    assert.equal((await job(mismatch)).history_attempt_count, 0);
    assert.equal(await identity(mismatch), mismatchIdentity);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${mismatch}'`), 0);
    const onlyMismatch = await claimRecovery();
    assert.equal(onlyMismatch?.jobId, mismatch);
    assert.equal(onlyMismatch?.kind, "history");
    await failRecovery(mismatch, String(onlyMismatch?.recoveryNonce), "asset_conflict");
    assert.equal((await job(other)).history_block_code, "source_mismatch");
    assert.equal(await claimRecovery(), null);

    const publishedBlocked = await callPublish(mismatch, ROOM_B);
    assert.equal(publishedBlocked.code, "published", JSON.stringify(publishedBlocked));
    assert.equal(publishedBlocked.activated, false);
    assert.equal((await job(mismatch)).history_state, "published");
    assert.equal((await job(mismatch)).history_blocked_at == null, false);
    const thumb = await claimRecovery();
    assert.equal(thumb?.jobId, mismatch);
    assert.equal(thumb?.kind, "thumbnail");
    const assetId = String(publishedBlocked.assetId);
    assert.equal(await activeFlag(assetId), false);
    assert.equal(await roomActive(ROOM_B), ASSET_B);
    await setThumbnail(assetId, ROOM_B);
    const thumbDone = await completeRecovery(mismatch, String(thumb?.recoveryNonce));
    assert.equal(thumbDone.code, "completed", JSON.stringify(thumbDone));
    assert.equal(await activeFlag(assetId), false);
    assert.equal(await roomActive(ROOM_B), ASSET_B);
    const again = await callPublish(mismatch, ROOM_B);
    assert.equal(again.code, "already_published", JSON.stringify(again));
    assert.equal(again.activated, false);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${mismatch}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${mismatch}'`), 1);
    assert.equal(await claimRecovery(), null);

    const copied = await succeed(USER_B, ROOM_B, ASSET_B, key(6), SCENE_OTHER, 1);
    const copyNonce = await take(copied, "history");
    const copyIdentity = await identity(copied);
    const copyPublished = await callPublish(copied, ROOM_B);
    assert.equal(copyPublished.activated, false, JSON.stringify(copyPublished));
    assert.equal((await job(copied)).recovery_nonce, copyNonce);
    assert.equal((await job(copied)).history_attempt_count, 0);
    await expireRecovery(copied);
    const afterCopy = await claimRecovery();
    assert.equal(afterCopy?.jobId, copied);
    assert.equal(afterCopy?.kind, "thumbnail");
    assert.equal((await job(copied)).history_attempt_count, 0);
    assert.equal(await identity(copied), copyIdentity);
    const copyAsset = String(copyPublished.assetId);
    assert.equal(await activeFlag(copyAsset), false);
    await setThumbnail(copyAsset, ROOM_B);
    assert.equal((await completeRecovery(copied, String(afterCopy?.recoveryNonce))).code, "completed");
    assert.equal(await activeFlag(copyAsset), false);
    assert.equal(await roomActive(ROOM_B), ASSET_B);
    assert.equal(await claimRecovery(), null);

    const activatedJob = await succeed(USER_B, ROOM_ACT, ASSET_ACT, key(7), SCENE_MATCH, 1);
    const activatedNonce = await take(activatedJob, "history");
    const activated = await callPublish(activatedJob, ROOM_ACT);
    assert.equal(activated.activated, true, JSON.stringify(activated));
    assert.equal((await completeRecovery(activatedJob, activatedNonce)).code, "completed");
    const activatedAsset = String(activated.assetId);
    assert.equal(await activeFlag(activatedAsset), true);
    assert.equal(await roomActive(ROOM_ACT), activatedAsset);
    const activatedThumb = await claimRecovery();
    assert.equal(activatedThumb?.kind, "thumbnail");
    assert.equal(activatedThumb?.jobId, activatedJob);
    await setThumbnail(activatedAsset, ROOM_ACT);
    assert.equal((await completeRecovery(activatedJob, String(activatedThumb?.recoveryNonce))).code, "completed");
    assert.equal(await activeFlag(activatedAsset), true);
    assert.equal(await roomActive(ROOM_ACT), activatedAsset);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 2);

    await psql(`update public.vibode_room_assets set thumbnail_storage_path = null where id = '${copyAsset}'`);
    const copiedThumbNonce = await take(copied, "thumbnail");
    await failRecovery(copied, copiedThumbNonce, "output_mismatch");
    assert.equal(await claimRecovery(), null);
    await psql(`update public.vibode_room_assets set thumbnail_storage_path = null where id = '${assetId}'`);
    const mismatchThumbNonce = await take(mismatch, "thumbnail");
    await failRecovery(mismatch, mismatchThumbNonce, "history_conflict");
    assert.equal((await job(copied)).thumbnail_block_code, "output_mismatch");
    assert.equal((await job(mismatch)).thumbnail_block_code, "history_conflict");
    assert.equal(await activeFlag(copyAsset), false);
    const copiedIdentity = await identity(copied);
    const thumbUnblock = await call(`select public.unblock_vibode_harmonize_thumbnail_recovery('${copied}')`);
    assert.equal(thumbUnblock.code, "unblocked", JSON.stringify(thumbUnblock));
    assert.equal((await job(mismatch)).thumbnail_block_code, "history_conflict");
    assert.equal(await identity(copied), copiedIdentity);
    assert.equal(await activeFlag(copyAsset), false);
    const reopened = await claimRecovery();
    assert.equal(reopened?.jobId, copied);
    assert.equal(reopened?.kind, "thumbnail");
    await setThumbnail(copyAsset, ROOM_B);
    assert.equal((await completeRecovery(copied, String(reopened?.recoveryNonce))).code, "completed");
    assert.equal(await activeFlag(copyAsset), false);
    assert.equal(await claimRecovery(), null);

    const incomplete = await succeed(USER_B, ROOM_B, ASSET_B, key(8), SCENE_OTHER, 1);
    await psql(`
      alter table public.vibode_harmonize_generations disable trigger vibode_harmonize_generations_guard;
      update public.vibode_harmonize_generations set backdrop_kind = null where id = '${incomplete}';
      alter table public.vibode_harmonize_generations enable trigger vibode_harmonize_generations_guard;
    `);
    assert.equal(await claimRecovery(), null);
    const retired = await callPublish(incomplete, ROOM_B);
    assert.equal(retired.code, "not_publishable", JSON.stringify(retired));
    assert.equal((await job(incomplete)).history_state, "unavailable");
    assert.equal(await claimRecovery(), null);
    assert.equal((await job(legacyId)).history_state, "unavailable");

    const fenced = await succeed(USER_B, ROOM_B, ASSET_B, key(9), SCENE_OTHER, 1);
    const running = await enqueue(USER_D, ROOM_D, ASSET_D, key(10), SCENE_OTHER, 1);
    assert.equal(running.ok, true, JSON.stringify(running));
    const runningClaim = await call("select public.claim_next_vibode_harmonize_generation()");
    const runningJob = runningClaim.job as Json;
    assert.equal(runningJob.jobId, running.jobId);
    const runningId = String(runningJob.jobId);
    const runningNonce = String(runningJob.claimNonce);
    const queued = await enqueue(USER_C, ROOM_C, ASSET_C, key(11), SCENE_OTHER, 1);
    assert.equal(queued.ok, true, JSON.stringify(queued));
    const busy = await call("select public.claim_next_vibode_harmonize_generation()");
    assert.equal(busy.code, "global_busy", JSON.stringify(busy));
    assert.equal(busy.job, null);
    assert.equal((await job(String(queued.jobId))).status, "queued");
    assert.equal((await job(String(queued.jobId))).attempt_count, 0);
    const staleContact = await call(`select public.contact_vibode_harmonize_generation('${runningId}', '${"0".repeat(8)}-0000-4000-8000-000000000000')`);
    assert.equal(staleContact.code, "stale_claim", JSON.stringify(staleContact));
    assert.equal((await job(runningId)).status, "running");
    assert.equal((await job(runningId)).provider_started_at, null);
    const recoveredWhileRunning = await claimRecovery();
    assert.equal(recoveredWhileRunning?.jobId, fenced);
    assert.equal(recoveredWhileRunning?.kind, "history");
    assert.equal((await job(runningId)).claim_nonce, runningNonce);
    assert.equal((await job(runningId)).status, "running");
    const contacted = await call(`select public.contact_vibode_harmonize_generation('${runningId}', '${runningNonce}')`);
    assert.equal(contacted.ok, true, JSON.stringify(contacted));
    const exactBusy = await call(`select public.claim_next_vibode_harmonize_generation('${queued.jobId}'::uuid)`);
    assert.equal(exactBusy.code, "global_busy", JSON.stringify(exactBusy));
    assert.equal((await job(String(queued.jobId))).status, "queued");

    const immutable = await psqlError(
      `update public.vibode_harmonize_generations set output_sha256 = '${"cd".repeat(32)}' where id = '${fenced}'`,
    );
    assert.match(immutable, /harmonize output is immutable/);
    const contactImmutable = await psqlError(
      `update public.vibode_harmonize_generations set provider_started_at = now() where id = '${fenced}'`,
    );
    assert.match(contactImmutable, /harmonize provider contact is immutable/);
    const retireBlocked = await psqlError(
      `update public.vibode_harmonize_generations set history_state = 'unavailable' where id = '${transient}'`,
    );
    assert.match(retireBlocked, /harmonize generation is terminal/);
    await psql(`update public.vibode_harmonize_generations set history_attempt_count = 4 where id = '${transient}'`);
    assert.equal((await job(transient)).history_attempt_count, 4);
    assert.equal((await job(transient)).history_block_code, "publication_failed");
    assert.equal((await job(legacyId)).history_state, "unavailable");
  } finally {
    await removeContainer();
  }
});

async function succeedLegacy(): Promise<string> {
  const created = await enqueueLegacy(USER_A, ROOM_A, ASSET_A, key(1));
  assert.equal(created.ok, true, JSON.stringify(created));
  const claimed = await call("select public.claim_next_vibode_harmonize_generation()");
  const row = claimed.job as Json;
  const jobId = String(row.jobId);
  const nonce = String(row.claimNonce);
  const contacted = await call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
  assert.equal(contacted.ok, true, JSON.stringify(contacted));
  const completed = await call(
    `select public.complete_vibode_harmonize_generation('${jobId}', '${nonce}', '${SHA}', '${outputPath(ROOM_A, jobId, nonce)}', 'gemini-3-pro-image', 'completed', 200, 10, 1200, 896)`,
  );
  assert.equal(completed.code, "completed", JSON.stringify(completed));
  return jobId;
}

async function succeed(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  scene: unknown,
  scale: number,
): Promise<string> {
  const created = await enqueue(userId, roomId, assetId, idempotencyKey, scene, scale);
  assert.equal(created.ok, true, JSON.stringify(created));
  const claimed = await call("select public.claim_next_vibode_harmonize_generation()");
  const row = claimed.job as Json;
  assert.equal(row?.jobId, created.jobId, JSON.stringify(claimed));
  const jobId = String(row.jobId);
  const nonce = String(row.claimNonce);
  const contacted = await call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
  assert.equal(contacted.ok, true, JSON.stringify(contacted));
  const completed = await call(
    `select public.complete_vibode_harmonize_generation('${jobId}', '${nonce}', '${SHA}', '${outputPath(roomId, jobId, nonce)}', 'gemini-3-pro-image', 'completed', 200, 10, 1200, 896)`,
  );
  assert.equal(completed.code, "completed", JSON.stringify(completed));
  return jobId;
}

async function take(jobId: string, kind: string): Promise<string> {
  const task = await claimRecovery();
  assert.equal(task?.jobId, jobId, JSON.stringify(task));
  assert.equal(task?.kind, kind, JSON.stringify(task));
  return String(task?.recoveryNonce);
}

async function claimRecovery(): Promise<Json | null> {
  const result = await call("select public.claim_next_vibode_harmonize_history_recovery()");
  if (result.task == null) return null;
  return result.task as Json;
}

async function failRecovery(jobId: string, nonce: string, code: string): Promise<Json> {
  return call(`select public.fail_vibode_harmonize_history_recovery('${jobId}', '${nonce}', '${code}')`);
}

async function completeRecovery(jobId: string, nonce: string): Promise<Json> {
  return call(`select public.complete_vibode_harmonize_history_recovery('${jobId}', '${nonce}')`);
}

async function callPublish(jobId: string, roomId: string): Promise<Json> {
  return call(`
    select set_config('harmonize.test_allow_scene_write', 'off', false);
    select public.publish_vibode_harmonize_history(
      '${jobId}', '${SHA}', 'vibode-generations', '${historyPath(roomId, jobId)}'
    );
  `);
}

async function assertGrants(): Promise<void> {
  for (const signature of [
    "public.claim_next_vibode_harmonize_history_recovery()",
    "public.complete_vibode_harmonize_history_recovery(uuid, text)",
    "public.fail_vibode_harmonize_history_recovery(uuid, text, text)",
    "public.unblock_vibode_harmonize_history_recovery(uuid)",
    "public.unblock_vibode_harmonize_thumbnail_recovery(uuid)",
  ]) {
    assert.equal(await psql(`select has_function_privilege('anon', '${signature}', 'execute')`), "f", signature);
    assert.equal(await psql(`select has_function_privilege('authenticated', '${signature}', 'execute')`), "f", signature);
    assert.equal(await psql(`select has_function_privilege('service_role', '${signature}', 'execute')`), "t", signature);
  }
  const denied = await psqlError("set role anon; select public.claim_next_vibode_harmonize_history_recovery();");
  assert.match(denied, /permission denied/i);
  const allowed = await call("set role service_role; select public.claim_next_vibode_harmonize_history_recovery();");
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.equal(allowed.task, null);
}

async function enqueueLegacy(userId: string, roomId: string, assetId: string, idempotencyKey: string): Promise<Json> {
  const payload = {
    roomId,
    sourceVersionId: assetId,
    idempotencyKey,
    requestSha256: SHA,
    sceneSnapshotSha256: SHA,
    backgroundSha256: SHA,
    compositeSha256: SHA,
    promptSha256: SHA,
    promptVersion: "harmonize-universal-prompt/2.0",
    assemblyVersion: "harmonize-prompt-assembly/1",
    afcGenerationId: GENERATION,
    compositePath: `rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png`,
    compositeByteLength: 1000,
    compositeWidth: 1200,
    compositeHeight: 896,
    snapshot: { prompt: "server assembled prompt" },
  };
  return call(`select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`);
}

async function enqueue(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  scene: unknown,
  scale: number,
): Promise<Json> {
  const payload = {
    roomId,
    sourceVersionId: assetId,
    idempotencyKey,
    requestSha256: SHA,
    sceneSnapshotSha256: SHA,
    backgroundSha256: SHA,
    compositeSha256: SHA,
    promptSha256: SHA,
    promptVersion: "harmonize-universal-prompt/2.0",
    assemblyVersion: "harmonize-prompt-assembly/1",
    afcGenerationId: GENERATION,
    compositePath: `rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png`,
    compositeByteLength: 1000,
    compositeWidth: 1200,
    compositeHeight: 896,
    backdropKind: "room_asset",
    sceneObjects: scene,
    snapshot: { prompt: "server assembled prompt", roomScaleMultiplier: scale },
  };
  return call(`select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`);
}

async function job(jobId: string): Promise<Json> {
  const text = await psql(`
    select json_build_object(
      'status', status,
      'history_state', history_state,
      'attempt_count', attempt_count,
      'history_attempt_count', history_attempt_count,
      'history_blocked_at', history_blocked_at,
      'history_block_code', history_block_code,
      'history_not_before', history_not_before,
      'thumbnail_attempt_count', thumbnail_attempt_count,
      'thumbnail_blocked_at', thumbnail_blocked_at,
      'thumbnail_block_code', thumbnail_block_code,
      'recovery_nonce', recovery_nonce,
      'recovery_kind', recovery_kind,
      'provider_started_at', provider_started_at,
      'claim_nonce', claim_nonce
    )::text
    from public.vibode_harmonize_generations where id = '${jobId}'
  `);
  return JSON.parse(text) as Json;
}

async function identity(jobId: string): Promise<string> {
  return psql(`
    select json_build_object(
      'status', status,
      'attempt_count', attempt_count,
      'provider_started_at', provider_started_at,
      'provider_attempt_id', provider_attempt_id,
      'output_sha256', output_sha256,
      'claim_nonce', claim_nonce,
      'snapshot', snapshot
    )::text
    from public.vibode_harmonize_generations where id = '${jobId}'
  `);
}

async function delaySeconds(jobId: string, kind: "history" | "thumbnail"): Promise<number> {
  const column = kind === "history" ? "history_not_before" : "thumbnail_not_before";
  return Number(await psql(
    `select extract(epoch from (${column} - now())) from public.vibode_harmonize_generations where id = '${jobId}'`,
  ));
}

async function elapse(jobId: string, kind: "history" | "thumbnail"): Promise<void> {
  const column = kind === "history" ? "history_not_before" : "thumbnail_not_before";
  await psql(`update public.vibode_harmonize_generations set ${column} = now() - interval '1 second' where id = '${jobId}'`);
}

async function expireRecovery(jobId: string): Promise<void> {
  await psql(`update public.vibode_harmonize_generations set recovery_expires_at = now() - interval '1 second' where id = '${jobId}'`);
}

async function setThumbnail(assetId: string, roomId: string): Promise<void> {
  await psql(`
    update public.vibode_room_assets
      set thumbnail_storage_bucket = 'vibode-generations',
          thumbnail_storage_path = 'rooms/${roomId}/thumb/${assetId}.webp'
    where id = '${assetId}'
  `);
}

async function activeFlag(assetId: string): Promise<boolean> {
  return (await psql(`select is_active from public.vibode_room_assets where id = '${assetId}'`)) === "t";
}

async function roomActive(roomId: string): Promise<string> {
  return psql(`select active_asset_id from public.vibode_rooms where id = '${roomId}'`);
}

async function parkProviderContacts(): Promise<void> {
  await psql(`
    alter table public.vibode_harmonize_generations disable trigger vibode_harmonize_generations_guard;
    update public.vibode_harmonize_generations
      set provider_started_at = now() - interval '2 days'
    where provider_started_at is not null;
    alter table public.vibode_harmonize_generations enable trigger vibode_harmonize_generations_guard;
  `);
}

function outputPath(roomId: string, jobId: string, nonce: string): string {
  return `rooms/${roomId}/jobs/${jobId}/output-${nonce}.jpg`;
}

function historyPath(roomId: string, jobId: string): string {
  return `rooms/${roomId}/harmonize/${jobId}.jpg`;
}

function key(index: number): string {
  return `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(sql));
}

async function seed(): Promise<void> {
  await psql(`
    insert into auth.users (id) values ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${USER_D}');
    insert into public.vibode_rooms (
      id, user_id, active_asset_id, current_afc_generation_id, room_scale_multiplier, current_stage, sort_key
    ) values
      ('${ROOM_A}', '${USER_A}', '${ASSET_A}', '${GENERATION}', 1.0, 3, now()),
      ('${ROOM_B}', '${USER_B}', '${ASSET_B}', '${GENERATION}', 1.0, 3, now()),
      ('${ROOM_ACT}', '${USER_B}', '${ASSET_ACT}', '${GENERATION}', 1.0, 3, now()),
      ('${ROOM_C}', '${USER_C}', '${ASSET_C}', '${GENERATION}', 1.0, 3, now()),
      ('${ROOM_D}', '${USER_D}', '${ASSET_D}', '${GENERATION}', 1.0, 3, now());
    insert into public.vibode_room_assets (
      id, room_id, user_id, asset_type, image_url, is_active, stage_number
    ) values
      ('${ASSET_A}', '${ROOM_A}', '${USER_A}', 'base', '', true, 3),
      ('${ASSET_B}', '${ROOM_B}', '${USER_B}', 'base', '', true, 3),
      ('${ASSET_ACT}', '${ROOM_ACT}', '${USER_B}', 'base', '', true, 3),
      ('${ASSET_C}', '${ROOM_C}', '${USER_C}', 'base', '', true, 3),
      ('${ASSET_D}', '${ROOM_D}', '${USER_D}', 'base', '', true, 3);
    insert into public.vibode_3d_scenes (
      room_id, version_id, user_id, afc_generation_id, objects_json
    ) values
      ('${ROOM_B}', '${ASSET_B}', '${USER_B}', '${GENERATION}', ${quote(JSON.stringify(SCENE_MATCH))}::jsonb),
      ('${ROOM_ACT}', '${ASSET_ACT}', '${USER_B}', '${GENERATION}', ${quote(JSON.stringify(SCENE_MATCH))}::jsonb);
  `);
}

async function bootstrap(): Promise<void> {
  await psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.vibode_rooms (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      active_asset_id uuid null,
      current_afc_generation_id uuid null,
      room_scale_multiplier double precision not null default 1.0,
      current_stage smallint not null default 3,
      sort_key timestamptz not null default now()
    );
    create table public.vibode_room_assets (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      asset_type text not null default 'base',
      stage_number smallint null,
      storage_bucket text null,
      storage_path text null,
      thumbnail_storage_bucket text null,
      thumbnail_storage_path text null,
      image_url text not null default '',
      width integer null,
      height integer null,
      model_version text null,
      is_active boolean not null default false,
      metadata jsonb not null default '{}'::jsonb
    );
    create unique index vibode_room_assets_id_room_id_uidx
      on public.vibode_room_assets (id, room_id);
    create table public.vibode_generation_runs (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      run_type text not null,
      stage_number smallint null,
      source_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
      output_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
      model_version text null,
      aspect_ratio text null,
      status text not null default 'completed',
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb not null default '{}'::jsonb,
      completed_at timestamptz null
    );
    create table public.vibode_3d_scenes (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      version_id uuid not null,
      user_id uuid not null references auth.users(id) on delete cascade,
      afc_generation_id uuid not null,
      objects_json jsonb not null,
      constraint vibode_3d_scenes_version_room_fkey
        foreign key (version_id, room_id)
        references public.vibode_room_assets (id, room_id)
        on delete cascade
    );
    create or replace function public.forbid_harmonize_scene_write()
    returns trigger language plpgsql as $$
    begin
      if current_setting('harmonize.test_allow_scene_write', true) is distinct from 'off' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end if;
      raise exception 'scene write during publication';
    end $$;
    create trigger forbid_harmonize_scene_write
    before insert or update or delete on public.vibode_3d_scenes
    for each row execute function public.forbid_harmonize_scene_write();
    create schema if not exists storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text
    );
    alter table storage.objects enable row level security;
  `);
}

async function apply(name: string): Promise<void> {
  await psql(readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8"));
}

async function call(sql: string): Promise<Json> {
  const text = firstJson(await psql(sql));
  const parsed = JSON.parse(text) as Json | number;
  if (typeof parsed === "number") return { ok: true, value: parsed };
  return parsed;
}

function firstJson(text: string): string {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("{") || item.startsWith("["));
  if (!line) throw new Error(`no json in psql output:\n${text}`);
  return line;
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=harmonize",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-t", "-A", "-c", "select 1",
      ]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  const logs = await docker(["logs", CONTAINER]);
  throw new Error(`disposable postgres 16 did not become ready\n${logs.stdout}\n${logs.stderr}`);
}

async function removeContainer(): Promise<void> {
  await docker(["rm", "-f", CONTAINER]);
}

function docker(args: string[], input?: string): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
