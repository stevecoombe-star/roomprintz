/**
 * Applies the unapplied History publication migration to a disposable
 * Postgres 16 container. This does not connect to hosted Supabase.
 *
 * Auth JWTs and the Storage API are not hosted here. auth.uid() is a stub
 * that reads request.jwt.claim.sub. The test states that limit.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "harmonize-pg-3b1a-disposable";
const SHA = "ab".repeat(32);
const OTHER_SHA = "cd".repeat(32);
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ROOM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ASSET_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SCENE = JSON.stringify([{ objectId: "obj-1", assetId: "asset-1", transform: { uniformScale: 1, position: { x: 1, y: 0, z: 2 } } }]);
const SCENE_REORDERED = JSON.stringify([{ transform: { position: { z: 2, y: 0, x: 1 }, uniformScale: 1 }, assetId: "asset-1", objectId: "obj-1" }]);
const SCENE_MOVED = JSON.stringify([{ objectId: "obj-1", assetId: "asset-1", transform: { position: { x: 9, y: 0, z: 2 }, uniformScale: 1 } }]);

type Json = Record<string, unknown>;

test("history publication sql does not write a 3D scene or an AFC generation", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261013140000_vibode_harmonize_history_publication.sql"),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.publish_vibode_harmonize_history/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = pg_catalog, public, pg_temp/);
  assert.doesNotMatch(sql, /create or replace function public\.enqueue_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /create or replace function public\.complete_vibode_harmonize_generation/);
  assert.match(sql, /revoke all on function public\.publish_vibode_harmonize_history\(uuid, text, text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.publish_vibode_harmonize_history\(uuid, text, text, text\) to service_role/);
  assert.match(sql, /harmonize_ai_disclosure_v1/);
  const unavailableDefault = sql.indexOf("default 'unavailable'");
  const pendingDefault = sql.indexOf("alter column history_state set default 'pending'");
  assert.ok(unavailableDefault > 0 && pendingDefault > unavailableDefault);
  assert.match(sql, /check \(history_state in \('pending', 'published', 'unavailable'\)\)/);
  assert.match(sql, /backdrop_kind is not null/);
  assert.match(sql, /scene_objects is not null/);
  assert.match(sql, /'not_publishable'/);
  assert.doesNotMatch(sql, /provider_started_at\s*=/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.vibode_3d_scenes/i);
  assert.doesNotMatch(sql, /update\s+public\.vibode_3d_scenes/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.vibode_3d_scenes/i);
  assert.doesNotMatch(sql, /vibode_afc_generations/);
  assert.doesNotMatch(sql, /current_afc_generation_id\s*=/);
});

test("postgres 16 publishes one History asset idempotently", { timeout: 300_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await applyMigrations();
    assert.match(await psql("select current_setting('server_version')"), /^16\./);

    await psql(`
      insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
      insert into public.vibode_rooms (
        id, user_id, active_asset_id, current_afc_generation_id, room_scale_multiplier, current_stage, sort_key
      ) values
        ('${ROOM_A}', '${USER_A}', '${ASSET_A}', '${GENERATION}', 1.0, 3, now()),
        ('${ROOM_B}', '${USER_B}', '${ASSET_B}', '${GENERATION}', 1.0, 3, now());
      insert into public.vibode_room_assets (
        id, room_id, user_id, asset_type, image_url, is_active, stage_number
      ) values
        ('${ASSET_A}', '${ROOM_A}', '${USER_A}', 'base', 'https://example.test/original.jpg', true, 3),
        ('${ASSET_B}', '${ROOM_B}', '${USER_B}', 'base', 'https://example.test/other.jpg', true, 3);
      insert into public.vibode_3d_scenes (
        room_id, version_id, user_id, afc_generation_id, objects_json
      ) values (
        '${ROOM_A}', '${ASSET_A}', '${USER_A}', '${GENERATION}', ${quote(SCENE_REORDERED)}::jsonb
      );
    `);

    const legacySucceeded = await claimContact(USER_A, ROOM_A, ASSET_A, key(1));
    const legacyCompleted = await call(
      `select public.complete_vibode_harmonize_generation('${legacySucceeded.jobId}', '${legacySucceeded.nonce}', '${SHA}', '${outputPath(ROOM_A, legacySucceeded.jobId, legacySucceeded.nonce)}', 'gemini-3-pro-image', 'completed', 200, 10, 1600, 1200)`,
    );
    assert.equal(legacyCompleted.code, "completed", JSON.stringify(legacyCompleted));
    const legacyFailed = await claimContact(USER_A, ROOM_A, ASSET_A, key(2));
    const legacyFailure = await call(
      `select public.fail_vibode_harmonize_generation('${legacyFailed.jobId}', '${legacyFailed.nonce}', 'provider_rejected', 'stopped before history', false, null, null, null)`,
    );
    assert.equal(legacyFailure.code, "failed", JSON.stringify(legacyFailure));
    const legacyRunning = await claimContact(USER_B, ROOM_B, ASSET_B, key(1));
    const legacyQueuedCreated = await enqueue(USER_A, ROOM_A, ASSET_A, key(3));
    assert.equal(legacyQueuedCreated.ok, true, JSON.stringify(legacyQueuedCreated));
    const legacyQueuedId = String(legacyQueuedCreated.jobId);
    const legacyIds = [legacySucceeded.jobId, legacyFailed.jobId, legacyRunning.jobId, legacyQueuedId];
    const legacyBefore = new Map(await Promise.all(legacyIds.map(async (jobId) => [jobId, await frozenFields(jobId)] as const)));
    const sceneBefore = await psql(`select objects_json::text from public.vibode_3d_scenes where version_id = '${ASSET_A}'`);
    const roomBefore = JSON.stringify(await roomRow(ROOM_A));

    await applyHistoryMigration();

    for (const jobId of legacyIds) {
      assert.equal((await job(jobId)).history_state, "unavailable");
      assert.equal(await frozenFields(jobId), legacyBefore.get(jobId));
      assert.equal(await onRecoveryCursor(jobId), 0);
    }
    assert.equal(await psql(`select objects_json::text from public.vibode_3d_scenes where version_id = '${ASSET_A}'`), sceneBefore);
    assert.equal(JSON.stringify(await roomRow(ROOM_A)), roomBefore);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 1);
    const legacyPublish = await publish(legacySucceeded.jobId);
    assert.equal(legacyPublish.code, "not_publishable");
    assert.equal(await frozenFields(legacySucceeded.jobId), legacyBefore.get(legacySucceeded.jobId));
    assert.equal(await count("select count(*) from public.vibode_room_assets where asset_type = 'stage_output'"), 0);
    for (const jobId of [legacyQueuedId, legacySucceeded.jobId, legacyRunning.jobId]) {
      const backfill = await psqlError(
        `update public.vibode_harmonize_generations set backdrop_kind = 'room_asset', scene_objects = '[]'::jsonb where id = '${jobId}'`,
      );
      assert.match(backfill, /harmonize backdrop is immutable|harmonize scene snapshot is immutable/);
      assert.equal((await job(jobId)).history_state, "unavailable");
    }
    await psql(`update public.vibode_harmonize_generations set status = 'cancelled' where id = '${legacyQueuedId}' and status = 'queued'`);
    assert.equal((await job(legacyQueuedId)).status, "cancelled");
    assert.equal((await job(legacyQueuedId)).history_state, "unavailable");

    const incomplete = await succeedJob(USER_A, ROOM_A, ASSET_A, key(4), null, { publishWhileQueued: true });
    assert.equal((await job(incomplete.jobId)).history_state, "pending");
    const incompleteBefore = await frozenFields(incomplete.jobId);
    const incompletePublish = await publish(incomplete.jobId);
    assert.equal(incompletePublish.ok, false);
    assert.equal(incompletePublish.code, "not_publishable");
    assert.equal((await job(incomplete.jobId)).history_state, "unavailable");
    assert.equal(await frozenFields(incomplete.jobId), incompleteBefore);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${incomplete.jobId}'`), 0);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${incomplete.jobId}'`), 0);
    assert.equal(await onRecoveryCursor(incomplete.jobId), 0);
    const incompleteAgain = await publish(incomplete.jobId);
    assert.equal(incompleteAgain.code, "not_publishable");
    assert.equal(await count("select count(*) from public.vibode_room_assets where asset_type = 'stage_output'"), 0);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 1);
    assert.equal(JSON.stringify(await roomRow(ROOM_A)), roomBefore);
    const lateBackdrop = await psqlError(
      `update public.vibode_harmonize_generations set backdrop_kind = 'room_asset', scene_objects = '[]'::jsonb where id = '${incomplete.jobId}'`,
    );
    assert.match(lateBackdrop, /harmonize backdrop is immutable|harmonize scene snapshot is immutable/);

    const matched = await succeedJob(USER_A, ROOM_A, ASSET_A, key(5), {
      backdrop: "room_asset",
      scene: SCENE,
    });
    const matchedBefore = await frozenFields(matched.jobId);
    const wrongSha = await publish(matched.jobId, OTHER_SHA);
    assert.equal(wrongSha.code, "output_mismatch");
    const wrongPath = await publish(matched.jobId, SHA, "vibode-generations", "rooms/wrong.jpg");
    assert.equal(wrongPath.code, "invalid_history_path");
    assert.equal((await job(matched.jobId)).history_state, "pending");
    assert.equal(await frozenFields(matched.jobId), matchedBefore);
    assert.equal(await onRecoveryCursor(matched.jobId), 1);
    assert.equal(await count("select count(*) from public.vibode_room_assets where asset_type = 'stage_output'"), 0);
    const blockedRetire = await psqlError(
      `update public.vibode_harmonize_generations set history_state = 'unavailable' where id = '${matched.jobId}'`,
    );
    assert.match(blockedRetire, /harmonize generation is terminal/);
    assert.equal((await job(matched.jobId)).history_state, "pending");

    await psql(`
      begin;
      select public.publish_vibode_harmonize_history(
        '${matched.jobId}', '${SHA}', 'vibode-generations', '${historyPath(ROOM_A, matched.jobId)}'
      );
      rollback;
    `);
    assert.equal((await job(matched.jobId)).history_state, "pending");
    assert.equal(await onRecoveryCursor(matched.jobId), 1);
    assert.equal(await count("select count(*) from public.vibode_room_assets where asset_type = 'stage_output'"), 0);

    const published = await call(`
      select set_config('harmonize.test_allow_scene_write', 'off', false);
      select public.publish_vibode_harmonize_history(
        '${matched.jobId}', '${SHA}', 'vibode-generations', '${historyPath(ROOM_A, matched.jobId)}'
      );
    `);
    assert.equal(published.ok, true);
    assert.equal(published.code, "published");
    assert.equal(published.activated, true);
    const assetId = String(published.assetId);
    const asset = await assetRow(assetId);
    assert.equal(asset.harmonize_job_id, matched.jobId);
    assert.equal(asset.ai_generated, true);
    assert.equal(asset.is_active, true);
    assert.equal(asset.asset_type, "stage_output");
    assert.equal(asset.stage_number, 3);
    assert.equal(asset.width, 1600);
    assert.equal(asset.height, 1200);
    assert.equal(asset.model_version, "gemini-3-pro-image");
    assert.equal(asset.storage_bucket, "vibode-generations");
    assert.equal(asset.storage_path, historyPath(ROOM_A, matched.jobId));
    assert.equal(asset.image_url, "");
    assert.equal(asset.thumbnail_storage_path, null);
    assert.equal(asset.metadata.versionKind, "stage");
    assert.equal(asset.metadata.source_version_id, ASSET_A);
    const run = await runRow(String(published.generationRunId));
    assert.equal(run.source_asset_id, ASSET_A);
    assert.equal(run.output_asset_id, assetId);
    assert.equal(run.run_type, "harmonize");
    assert.equal(run.harmonize_job_id, matched.jobId);
    assert.equal(JSON.stringify(run.request_payload).includes("prompt"), false);
    const room = await roomRow(ROOM_A);
    assert.equal(room.active_asset_id, assetId);
    assert.equal(room.current_afc_generation_id, GENERATION);
    assert.equal(room.room_scale_multiplier, 1);
    assert.equal(await psql("select objects_json::text from public.vibode_3d_scenes where version_id = '" + ASSET_A + "'"), await psql(`select ${quote(SCENE_REORDERED)}::jsonb::text`));
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 1);
    assert.equal((await job(matched.jobId)).history_state, "published");
    assert.equal((await job(matched.jobId)).output_asset_id, assetId);

    const again = await publish(matched.jobId);
    assert.equal(again.code, "already_published");
    assert.equal(again.activated, false);
    assert.equal(again.assetId, assetId);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${matched.jobId}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${matched.jobId}'`), 1);
    assert.equal((await roomRow(ROOM_A)).active_asset_id, assetId);

    await psql(`update public.vibode_rooms set active_asset_id = '${ASSET_A}' where id = '${ROOM_A}'`);
    await psql(`update public.vibode_room_assets set is_active = false where id = '${assetId}'`);
    await psql(`update public.vibode_room_assets set is_active = true where id = '${ASSET_A}'`);
    const retried = await publish(matched.jobId);
    assert.equal(retried.code, "already_published");
    assert.equal(retried.activated, false);
    assert.equal((await roomRow(ROOM_A)).active_asset_id, ASSET_A);
    const jobDenied = await psqlError(
      `set role authenticated; update public.vibode_harmonize_generations set history_state = 'pending' where id = '${matched.jobId}'`,
    );
    assert.match(jobDenied, /permission denied/);

    await psql(`update public.vibode_3d_scenes set objects_json = ${quote(SCENE_MOVED)}::jsonb where version_id = '${ASSET_A}'`);
    const drifted = await succeedJob(USER_A, ROOM_A, ASSET_A, key(6), { backdrop: "afc_original", scene: SCENE });
    const driftedPublish = await publish(drifted.jobId);
    assert.equal(driftedPublish.code, "published");
    assert.equal(driftedPublish.activated, false);
    assert.equal((await roomRow(ROOM_A)).active_asset_id, ASSET_A);
    assert.equal((await assetRow(String(driftedPublish.assetId))).is_active, false);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 1);

    await psql(`update public.vibode_rooms set room_scale_multiplier = 1.5 where id = '${ROOM_A}'`);
    const scaled = await succeedJob(USER_A, ROOM_A, ASSET_A, key(7), { backdrop: "afc_empty", scene: SCENE_MOVED });
    const scaledPublish = await publish(scaled.jobId);
    assert.equal(scaledPublish.code, "published");
    assert.equal(scaledPublish.activated, false);
    assert.equal((await roomRow(ROOM_A)).active_asset_id, ASSET_A);
    await psql(`update public.vibode_rooms set room_scale_multiplier = 1 where id = '${ROOM_A}'`);

    const parallel = await succeedJob(USER_A, ROOM_A, ASSET_A, key(8), { backdrop: "afc_empty", scene: SCENE_MOVED });
    const [first, second] = await Promise.all([publish(parallel.jobId), publish(parallel.jobId)]);
    const codes = [first.code, second.code].sort();
    assert.deepEqual(codes, ["already_published", "published"]);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${parallel.jobId}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${parallel.jobId}'`), 1);
    assert.equal([first.activated, second.activated].filter(Boolean).length, 1);

    const publishedAsset = String(first.code === "published" ? first.assetId : second.assetId);
    await psql(`delete from public.vibode_room_assets where id = '${publishedAsset}'`);
    const afterDelete = await job(parallel.jobId);
    assert.equal(afterDelete.history_state, "published");
    assert.equal(afterDelete.output_asset_id, null);
    const republish = await publish(parallel.jobId);
    assert.equal(republish.code, "already_published");
    assert.equal(republish.assetId, null);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${parallel.jobId}'`), 0);

    const sourced = await succeedJob(USER_A, ROOM_A, ASSET_A, key(9), { backdrop: "room_asset", scene: SCENE_MOVED });
    const changedOutput = await psqlError(
      `update public.vibode_harmonize_generations set output_sha256 = '${OTHER_SHA}', history_state = 'published' where id = '${sourced.jobId}'`,
    );
    assert.match(changedOutput, /harmonize output is immutable/);
    const mismatchId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
    await psql(`
      insert into public.vibode_harmonize_generations (
        id, user_id, room_id, source_version_id, idempotency_key, kind, status,
        request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
        prompt_version, assembly_version, afc_generation_id, snapshot,
        composite_path, composite_byte_length, composite_width, composite_height,
        output_bucket, output_path, output_sha256, output_mime, output_width, output_height,
        provider_started_at, provider_attempt_id, backdrop_kind, scene_objects
      ) values (
        '${mismatchId}', '${USER_A}', '${ROOM_A}', '${ASSET_B}', '${key(10)}', 'initial', 'succeeded',
        '${SHA}', '${SHA}', '${SHA}', '${SHA}', '${SHA}',
        'harmonize-universal-prompt/2.0', 'harmonize-prompt-assembly/1', '${GENERATION}',
        '{"prompt":"server assembled prompt","roomScaleMultiplier":1}'::jsonb,
        'rooms/${ROOM_A}/intakes/${USER_A}/${key(10)}/composite.png', 1000, 1200, 896,
        'vibode-harmonize', 'rooms/${ROOM_A}/jobs/${mismatchId}/output-nonce.jpg', '${SHA}', 'image/jpeg', 1600, 1200,
        now(), gen_random_uuid(), 'room_asset', ${quote(SCENE_MOVED)}::jsonb
      );
    `);
    const mismatch = await publish(mismatchId);
    assert.equal(mismatch.code, "source_mismatch");
    assert.equal((await job(mismatchId)).history_state, "pending");
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${mismatchId}'`), 0);
    await psql(`delete from public.vibode_room_assets where id = '${ASSET_A}'`);
    assert.equal((await job(sourced.jobId)).source_version_id, null);
    const orphan = await publish(sourced.jobId);
    assert.equal(orphan.code, "published");
    assert.equal(orphan.activated, false);
    assert.equal((await runRow(String(orphan.generationRunId))).source_asset_id, null);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 0);

    const denied = await psqlError(
      `set role authenticated; select public.publish_vibode_harmonize_history('${sourced.jobId}', '${SHA}', 'vibode-generations', '${historyPath(ROOM_A, sourced.jobId)}')`,
    );
    assert.match(denied, /permission denied/);

    const ack = lastLine(await psql(`
      select set_config('request.jwt.claim.sub', '${USER_A}', false);
      set role authenticated;
      insert into public.vibode_user_acknowledgements (user_id, acknowledgement_key)
      values (auth.uid(), 'harmonize_ai_disclosure_v1')
      returning acknowledgement_key;
    `));
    assert.equal(ack, "harmonize_ai_disclosure_v1");
    const seen = lastLine(await psql(`
      select set_config('request.jwt.claim.sub', '${USER_A}', false);
      set role authenticated;
      select acknowledgement_key from public.vibode_user_acknowledgements where user_id = auth.uid();
    `));
    assert.equal(seen, "harmonize_ai_disclosure_v1");
    const hidden = lastLine(await psql(`
      select set_config('request.jwt.claim.sub', '${USER_B}', false);
      set role authenticated;
      select count(*) from public.vibode_user_acknowledgements;
    `));
    assert.equal(hidden, "0");
    const duplicateAck = await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER_A}', false);
      set role authenticated;
      insert into public.vibode_user_acknowledgements (user_id, acknowledgement_key)
      values ('${USER_A}', 'harmonize_ai_disclosure_v1');
    `);
    assert.match(duplicateAck, /duplicate key|unique/);
    const otherKey = await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER_A}', false);
      set role authenticated;
      insert into public.vibode_user_acknowledgements (user_id, acknowledgement_key)
      values ('${USER_A}', 'other_key');
    `);
    assert.match(otherKey, /check constraint|vibode_user_acknowledgements_key_closed|row-level security/);
    const updated = await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER_A}', false);
      set role authenticated;
      update public.vibode_user_acknowledgements set acknowledged_at = now() where user_id = '${USER_A}';
    `);
    assert.match(updated, /permission denied/);
    const anon = await psqlError(
      "set role anon; insert into public.vibode_user_acknowledgements (user_id, acknowledgement_key) values ('" + USER_A + "', 'harmonize_ai_disclosure_v1')",
    );
    assert.match(anon, /permission denied/);

    await psql(`delete from public.vibode_rooms where id = '${ROOM_A}'`);
    assert.equal(await count(`select count(*) from public.vibode_harmonize_generations where room_id = '${ROOM_A}'`), 0);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where room_id = '${ROOM_A}'`), 0);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 0);
  } finally {
    await removeContainer();
  }
});

async function applyMigrations(): Promise<void> {
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
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
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
  await psql(readFileSync(path.join(process.cwd(), "supabase/migrations/20261012090000_vibode_harmonize_generations.sql"), "utf8"));
  await psql(readFileSync(path.join(process.cwd(), "supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql"), "utf8"));
  await psql("grant usage on schema public to anon, authenticated");
}

async function applyHistoryMigration(): Promise<void> {
  await psql(readFileSync(path.join(process.cwd(), "supabase/migrations/20261013140000_vibode_harmonize_history_publication.sql"), "utf8"));
}

async function claimContact(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
): Promise<Readonly<{ jobId: string; nonce: string }>> {
  const created = await enqueue(userId, roomId, assetId, idempotencyKey);
  assert.equal(created.ok, true, JSON.stringify(created));
  const jobId = String(created.jobId);
  const claimed = await call("select public.claim_next_vibode_harmonize_generation()");
  const claim = claimed.job as Json;
  assert.equal(claim.jobId, jobId);
  const nonce = String(claim.claimNonce);
  const contacted = await call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
  assert.equal(contacted.ok, true, JSON.stringify(contacted));
  return { jobId, nonce };
}

async function frozenFields(jobId: string): Promise<string> {
  return psql(`
    select json_build_object(
      'status', status,
      'provider_started_at', provider_started_at,
      'provider_attempt_id', provider_attempt_id,
      'output_sha256', output_sha256,
      'output_path', output_path,
      'scene_snapshot_sha256', scene_snapshot_sha256,
      'background_sha256', background_sha256,
      'afc_generation_id', afc_generation_id,
      'snapshot', snapshot,
      'claim_nonce', claim_nonce,
      'failure_code', failure_code,
      'source_version_id', source_version_id
    )::text
    from public.vibode_harmonize_generations
    where id = '${jobId}'
  `);
}

async function onRecoveryCursor(jobId: string): Promise<number> {
  return count(`
    select count(*)
    from public.vibode_harmonize_generations
    where id = '${jobId}'
      and status = 'succeeded'
      and history_state = 'pending'
      and backdrop_kind is not null
      and scene_objects is not null
      and output_sha256 is not null
      and output_path is not null
      and output_bucket is not null
      and output_mime = 'image/jpeg'
      and output_width is not null
      and output_height is not null
  `);
}

async function succeedJob(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  capture: Readonly<{ backdrop: string; scene: string }> | null,
  options: Readonly<{ publishWhileQueued?: boolean }> = {},
): Promise<Readonly<{ jobId: string }>> {
  const created = await enqueue(userId, roomId, assetId, idempotencyKey);
  assert.equal(created.ok, true, JSON.stringify(created));
  const jobId = String(created.jobId);
  assert.equal((await job(jobId)).history_state, "pending");
  if (options.publishWhileQueued) {
    const early = await publish(jobId);
    assert.equal(early.code, "not_succeeded");
    assert.equal(await count("select count(*) from public.vibode_room_assets where asset_type = 'stage_output'"), 0);
  }
  if (capture) {
    await psql(`
      update public.vibode_harmonize_generations
      set backdrop_kind = '${capture.backdrop}',
          scene_objects = ${quote(capture.scene)}::jsonb
      where id = '${jobId}' and status = 'queued'
    `);
  }
  const claimed = await call("select public.claim_next_vibode_harmonize_generation()");
  const claim = claimed.job as Json;
  assert.equal(claim.jobId, jobId);
  const nonce = String(claim.claimNonce);
  const contacted = await call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
  assert.equal(contacted.ok, true, JSON.stringify(contacted));
  const finished = await call(
    `select public.complete_vibode_harmonize_generation('${jobId}', '${nonce}', '${SHA}', '${outputPath(roomId, jobId, nonce)}', 'gemini-3-pro-image', 'completed', 200, 10, 1600, 1200)`,
  );
  assert.equal(finished.code, "completed", JSON.stringify(finished));
  return { jobId };
}

async function enqueue(userId: string, roomId: string, assetId: string, idempotencyKey: string): Promise<Json> {
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
    snapshot: { prompt: "server assembled prompt", roomScaleMultiplier: 1 },
  };
  return call(
    `select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`,
  );
}

async function publish(
  jobId: string,
  sha: string = SHA,
  bucket = "vibode-generations",
  history = historyPath(ROOM_A, jobId),
): Promise<Json> {
  return call(
    `select public.publish_vibode_harmonize_history('${jobId}', '${sha}', '${bucket}', '${history}')`,
  );
}

async function job(jobId: string): Promise<Json> {
  return readJson(
    `select json_build_object('history_state', history_state, 'output_asset_id', output_asset_id, 'source_version_id', source_version_id, 'status', status) from public.vibode_harmonize_generations where id = '${jobId}'`,
  );
}

async function assetRow(assetId: string): Promise<Json & { metadata: Json }> {
  const row = await readJson(`
    select json_build_object(
      'harmonize_job_id', harmonize_job_id,
      'ai_generated', ai_generated,
      'is_active', is_active,
      'asset_type', asset_type,
      'storage_bucket', storage_bucket,
      'storage_path', storage_path,
      'image_url', image_url,
      'thumbnail_storage_path', thumbnail_storage_path,
      'stage_number', stage_number,
      'width', width,
      'height', height,
      'model_version', model_version,
      'metadata', metadata
    ) from public.vibode_room_assets where id = '${assetId}'
  `);
  return row as Json & { metadata: Json };
}

async function runRow(runId: string): Promise<Json> {
  return readJson(`
    select json_build_object(
      'source_asset_id', source_asset_id,
      'output_asset_id', output_asset_id,
      'run_type', run_type,
      'harmonize_job_id', harmonize_job_id,
      'request_payload', request_payload
    ) from public.vibode_generation_runs where id = '${runId}'
  `);
}

async function roomRow(roomId: string): Promise<Json> {
  return readJson(`
    select json_build_object(
      'active_asset_id', active_asset_id,
      'current_afc_generation_id', current_afc_generation_id,
      'room_scale_multiplier', room_scale_multiplier
    ) from public.vibode_rooms where id = '${roomId}'
  `);
}

function historyPath(roomId: string, jobId: string): string {
  return `rooms/${roomId}/harmonize/${jobId}.jpg`;
}

function outputPath(roomId: string, jobId: string, nonce: string): string {
  return `rooms/${roomId}/jobs/${jobId}/output-${nonce}.jpg`;
}

function key(index: number): string {
  return `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(sql));
}

async function readJson(sql: string): Promise<Json> {
  return JSON.parse(await psql(sql)) as Json;
}

async function call(sql: string): Promise<Json> {
  const text = (await psql(sql)).split("\n").map((item) => item.trim()).find((item) => item.startsWith("{"));
  if (!text) throw new Error(`no json from:\n${sql}`);
  return JSON.parse(text) as Json;
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
    if (`${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete")) {
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

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code === 0) throw new Error(`expected psql to fail for:\n${sql}\n${result.stdout}`);
  return `${result.stderr}\n${result.stdout}`;
}

function lastLine(text: string): string {
  const lines = text.split("\n").map((item) => item.trim()).filter(Boolean);
  const data = lines.filter((line) => !/^(INSERT|UPDATE|DELETE|SELECT|SET)( \d+)?( \d+)?$/.test(line));
  return data.at(-1) ?? "";
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
