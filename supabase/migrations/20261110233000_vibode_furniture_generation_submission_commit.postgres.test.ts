/**
 * MESHY-1D.2E paid-submission preflight on disposable Postgres 16.
 * The full migration chain runs through Slice 5. The provider is a scripted
 * transport, and global fetch throws so no Meshy request can leave the test.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { executeFurnitureGenerationClaim } from "@/lib/vibode-furniture/generation/pipeline";
import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import type { MeshyTransport, MeshyTransportCall, MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import { createMemoryBucketStore } from "@/lib/vibode-furniture/generation/objects";
import { generationInputPath } from "@/lib/vibode-furniture/generation/output";
import { GENERATION_INPUT_BUCKET } from "@/lib/vibode-furniture/generation/policy";
import { createSqlGenerationCommands, type GenerationRpcName } from "@/lib/vibode-furniture/generation/sql-commands";

const CONTAINER = "vibode-furniture-1d2e-pg";
const DATABASE = "furniture1d2e";
const MIGRATION = "supabase/migrations/20261110233000_vibode_furniture_generation_submission_commit.sql";
const BASELINE = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
  "supabase/migrations/20261109210000_vibode_furniture_generation_beta_allowances.sql",
  "supabase/migrations/20261109220000_vibode_furniture_generation_beta_allowance_reserve.sql",
  "supabase/migrations/20261110203000_vibode_furniture_generation_beta_allowance_settlement.sql",
  "supabase/migrations/20261110223000_vibode_furniture_generation_processing_slot.sql",
];
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const LEGACY = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SHA = "ab".repeat(32);
const SETTINGS = JSON.stringify({
  geometryResolution: "standard",
  shouldTexture: true,
  textureModel: "default",
  textureResolution: "2k",
  enablePbr: false,
  texturePrompt: "",
  imageEnhancement: true,
  shouldRemesh: false,
  topology: "triangle",
  targetPolycount: 30000,
});
const GRACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const CHECKSUM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const TRANSIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const BLOCKED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const CRASH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const REJECTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";
const LIMITED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07";
const EXHAUSTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08";
const RACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09";
const RECLAIM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0a";
const BOUND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b";
const READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0c";
const AFTER_READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0d";
const LEGACY_FAIL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0e";
const LEGACY_COMMIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0f";
const POSTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
const BAD_PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const TASK = "018a210d-8ba4-705c-b111-1f1776f7f580";
const POST_TASK = "018a210d-8ba4-705c-b111-1f1776f7f581";

test("local input failures do not spend a paid attempt, and an uncertain submit is not posted twice", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized/i);
  assert.match(migration, /paid_submissions_used = paid_submissions_used \+ 1/);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY|msy_/);
  assert.match(migration, /does not treat a missing provider charge as zero/);
  assert.match(migration, /purpose', 'prepare'/);

  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("real_network_blocked");
  }) as typeof fetch;

  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER}'), ('${OTHER}'), ('${LEGACY}'), ('${ADMIN}');
      grant usage on schema public to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;
      create schema if not exists storage;
      create table storage.buckets (
        id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text, name text
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of BASELINE) {
      await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    }
    const controlsBefore = await controlFingerprint();
    const processingBefore = await indexDef("vibode_furniture_generation_jobs_one_active_uidx");
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await indexDef("vibode_furniture_generation_jobs_one_active_uidx"), processingBefore);
    assert.doesNotMatch(processingBefore, /'ready'/);
    assert.match(await functionSource("claim_vibode_furniture_generation"), /purpose', 'prepare'/);
    assert.doesNotMatch(await functionSource("claim_vibode_furniture_generation"), /paid_submissions_used = paid_submissions_used \+ 1/);
    assert.match(await functionSource("commit_vibode_furniture_generation_submission"), /paid_submissions_used = paid_submissions_used \+ 1/);
    assert.match(await functionSource("mark_vibode_furniture_generation_needs_review"), /60 seconds/);
    assert.match(await functionSource("mark_vibode_furniture_generation_needs_review"), /60 minutes/);
    assert.equal(await psql(`
      select has_function_privilege('anon', 'public.commit_vibode_furniture_generation_submission(uuid,uuid,uuid)', 'execute')::text
        || has_function_privilege('service_role', 'public.commit_vibode_furniture_generation_submission(uuid,uuid,uuid)', 'execute')::text
        || has_function_privilege('anon', 'public.fail_vibode_furniture_generation_prepared_input(uuid,uuid,uuid)', 'execute')::text
        || has_function_privilege('service_role', 'public.fail_vibode_furniture_generation_prepared_input(uuid,uuid,uuid)', 'execute')::text
        || has_function_privilege('service_role', 'public.vibode_furniture_generation_fail_unsent(uuid,uuid)', 'execute')::text
    `), "falsetruefalsetruefalse");
    assert.equal(await psql(`
      select t.tgenabled::text
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = 'vibode_furniture_generation_controls'
        and t.tgname = 'vibode_furniture_generation_protect_controls'
    `), "O");

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true, paid_submissions_authorized = 1
      where control_id = 'global'
    `);
    for (const userId of [USER, OTHER]) {
      await psql(`
        insert into public.vibode_furniture_generation_allowances (
          user_id, classification, enabled, authorized_generations,
          reserved_generations, consumed_generations, updated_by
        ) values ('${userId}', 'individual_beta', true, 5, 0, 0, '${ADMIN}')
      `);
    }
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer();
    const photoSha = createHash("sha256").update(photo).digest("hex");

    await reserve(GRACE, "grace-key");
    const duringGrace = await pass(store(), scripted(), Date.now());
    assert.equal(duringGrace.action, "waiting");
    assert.equal(await jobFacts(GRACE), "reserved|0|null|0");
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    const afterGrace = await pass(store(), scripted(), Date.now() + 180_000);
    assert.equal(afterGrace.action, "failed");
    assert.equal(await jobFacts(GRACE), "failed|0|null|0");
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await actions(GRACE), "reserve,release");

    await reserve(CHECKSUM, "checksum-key");
    await attach(CHECKSUM, photo, "cd".repeat(32));
    const checksumStore = store();
    await checksumStore.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, CHECKSUM, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const invalid = await pass(checksumStore, scripted(), Date.now());
    assert.equal(invalid.action, "failed");
    assert.equal(await jobFacts(CHECKSUM), "failed|0|null|0");
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await actions(CHECKSUM), "reserve,release");

    await reserve(TRANSIENT, "transient-key");
    await attach(TRANSIENT, photo, photoSha);
    const outage = store();
    const throwing = {
      ...outage,
      get: async () => {
        throw new Error("storage_unavailable");
      },
    };
    const retryable = await pass(throwing, scripted(), Date.now());
    assert.equal(retryable.action, "waiting");
    assert.equal(await jobFacts(TRANSIENT), "reserved|0|null|0");
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    const released = await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${TRANSIENT}')
    `);
    assert.equal(released.ok, true);
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");

    await reserve(BLOCKED, "blocked-key");
    const beside = await call(`
      select public.reserve_vibode_furniture_generation(
        '${OTHER}', '${AFTER_READY}', 'beside-key', '${SHA}', 'image-to-3d', 'meshy-7.1',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 30
      )
    `);
    assert.equal(beside.ok, false);
    assert.equal(beside.code, "concurrency_limited");
    const held = await claimNext();
    assert.equal(held.outcome, "claimed");
    assert.equal(held.purpose, "prepare");
    const leasedFail = await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${BLOCKED}')
    `);
    assert.equal(leasedFail.code, "lease_held");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${BLOCKED}'
    `);
    const dropped = await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${BLOCKED}')
    `);
    assert.equal(dropped.ok, true);
    assert.equal(await paid(), "0");

    await reserve(CRASH, "crash-key");
    const prepared = await claimNext();
    assert.equal(prepared.purpose, "prepare");
    assert.equal(prepared.status, "reserved");
    assert.equal(await jobFacts(CRASH), "reserved|0|null|0");
    assert.equal(await paid(), "0");
    const committed = await call(`
      select public.commit_vibode_furniture_generation_submission(
        '${USER}', '${CRASH}', '${prepared.claim_nonce}'
      )
    `);
    assert.equal(committed.ok, true);
    assert.equal(committed.status, "submitting");
    assert.notEqual(committed.claim_nonce, prepared.claim_nonce);
    assert.equal(await paid(), "1");
    assert.equal(await jobFacts(CRASH), "submitting|1|set|0");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    const stale = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${CRASH}', '${prepared.claim_nonce}', '${TASK}', 'PENDING'
      )
    `);
    assert.equal(stale.code, "lease_held");
    assert.equal(await psql(`
      select provider_task_id is null from public.vibode_furniture_generation_jobs where job_id = '${CRASH}'
    `), "t");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${CRASH}'
    `);
    const posts = { count: 0 };
    const recovered = await pass(store(), countingTransport(posts, []), Date.now());
    assert.equal(recovered.action, "waiting");
    assert.equal(posts.count, 0);
    assert.equal(await jobFacts(CRASH), "ambiguous|1|set|0");
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '61 minutes'
      where job_id = '${CRASH}'
    `);
    const reviewClaim = await call(`select public.claim_vibode_furniture_generation('${USER}', '${CRASH}', 'follow')`);
    assert.equal(reviewClaim.purpose, "reconcile");
    const reviewed = await call(`
      select public.mark_vibode_furniture_generation_needs_review(
        '${USER}', '${CRASH}', '${reviewClaim.claim_nonce}', 'list_absent'
      )
    `);
    assert.equal(reviewed.status, "needs_review");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal(await paid(), "1");
    assert.equal(await processingCount(), "0");
    await settleReviewedFailure(CRASH, String(reviewClaim.claim_nonce));
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    await zeroPaidUsed();

    await reserve(REJECTED, "rejected-key");
    const rejectClaim = await claimNext();
    const rejectCommit = await commit(REJECTED, String(rejectClaim.claim_nonce));
    const rejected = await call(`
      select public.fail_vibode_furniture_generation_create(
        '${USER}', '${REJECTED}', '${rejectCommit.claim_nonce}', 'provider_rejected', 'provider_rejected'
      )
    `);
    assert.equal(rejected.ok, true);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await actions(REJECTED), "reserve,release");
    await zeroPaidUsed();

    await reserve(LIMITED, "limited-key");
    const limitClaim = await claimNext();
    const limitCommit = await commit(LIMITED, String(limitClaim.claim_nonce));
    const limited = await call(`
      select public.settle_vibode_furniture_generation_rate_limit(
        '${USER}', '${LIMITED}', '${limitCommit.claim_nonce}'
      )
    `);
    assert.equal(limited.ok, true);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    await zeroPaidUsed();

    await reserve(EXHAUSTED, "exhausted-key");
    await psql(`
      update public.vibode_furniture_generation_controls
      set paid_submissions_used = 1
      where control_id = 'global'
    `);
    const exhausted = await claimNext();
    assert.equal(exhausted.ok, false);
    assert.equal(exhausted.code, "submission_not_authorized");
    assert.equal(await jobFacts(EXHAUSTED), "reserved|0|null|0");
    assert.equal(await paid(), "1");
    await zeroPaidUsed();
    const cleared = await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${EXHAUSTED}')
    `);
    assert.equal(cleared.ok, true);
    assert.equal(await paid(), "0");

    await reserve(RACE, "race-key");
    const raced = await Promise.all([claimNext(), claimNext()]);
    const winners = raced.filter((row) => row.outcome === "claimed");
    const idle = raced.filter((row) => row.outcome === "idle");
    assert.equal(winners.length, 1);
    assert.equal(idle.length, 1);
    assert.equal(winners[0]?.purpose, "prepare");
    assert.equal(await paid(), "0");
    const raceNonce = String(winners[0]?.claim_nonce);
    const raceCommits = await Promise.all([commit(RACE, raceNonce), commit(RACE, raceNonce)]);
    const committedRace = raceCommits.filter((row) => row.ok === true);
    const lostRace = raceCommits.filter((row) => row.code === "lease_held");
    assert.equal(committedRace.length, 1);
    assert.equal(lostRace.length, 1);
    assert.equal(await paid(), "1");
    assert.equal(await jobFacts(RACE), "submitting|1|set|0");
    const raceFailed = await call(`
      select public.fail_vibode_furniture_generation_create(
        '${USER}', '${RACE}', '${committedRace[0]?.claim_nonce}', 'provider_rejected', 'provider_rejected'
      )
    `);
    assert.equal(raceFailed.ok, true);
    await zeroPaidUsed();

    await reserve(RECLAIM, "reclaim-key");
    const firstLease = await claimNext();
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${RECLAIM}'
    `);
    const reclaimed = await claimNext();
    assert.equal(reclaimed.purpose, "prepare");
    assert.notEqual(reclaimed.claim_nonce, firstLease.claim_nonce);
    assert.equal(await paid(), "0");
    assert.equal(await jobFacts(RECLAIM), "reserved|0|null|0");
    const staleCommit = await commit(RECLAIM, String(firstLease.claim_nonce));
    assert.equal(staleCommit.code, "lease_held");
    assert.equal(await paid(), "0");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${RECLAIM}'
    `);
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${RECLAIM}')
    `)).ok, true);

    await reserve(BOUND, "bound-key");
    const boundClaim = await claimNext();
    const boundCommit = await commit(BOUND, String(boundClaim.claim_nonce));
    const bound = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${BOUND}', '${boundCommit.claim_nonce}', '${TASK}', 'PENDING'
      )
    `);
    assert.equal(bound.ok, true);
    const again = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${BOUND}', '${boundCommit.claim_nonce}', '${TASK}', 'PENDING'
      )
    `);
    assert.equal(again.ok, false);
    assert.equal(await psql(`
      select provider_task_id from public.vibode_furniture_generation_jobs where job_id = '${BOUND}'
    `), TASK);
    const follow = await call(`select public.claim_vibode_furniture_generation('${USER}', '${BOUND}', 'follow')`);
    const observed = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${BOUND}', '${follow.claim_nonce}', 'FAILED', 100, 0, 'FAILED'
      )
    `);
    assert.equal(observed.status, "failed");
    assert.equal(await paid(), "1");
    await zeroPaidUsed();

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256, settings,
        image_slots, provider_task_name, status, quota_state, reserved_credits, allowance_state,
        output_bucket, output_object_path, output_sha256, output_byte_size
      ) values (
        '${READY}', '${OTHER}', 'meshy-7.1', 'image-to-3d', 'ready-key', '${SHA}',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 'vibode-${READY}',
        'ready', 'reconciled', 30, 'consumed', 'vibode-furniture-assets',
        'users/${OTHER}/generations/${READY}/candidate.glb', '${SHA}', 128
      )
    `);
    assert.equal(await processingCount(), "0");
    await reserve(AFTER_READY, "after-ready-key", OTHER);
    assert.equal(await psql(`
      select status from public.vibode_furniture_generation_jobs where job_id = '${READY}'
    `), "ready");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${OTHER}', '${AFTER_READY}')
    `)).ok, true);
    assert.equal(await processingCount(), "0");

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256, settings,
        image_slots, provider_task_name, status, quota_state, reserved_credits, allowance_state
      ) values (
        '${LEGACY_FAIL}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'legacy-fail-key', '${SHA}',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 'vibode-${LEGACY_FAIL}',
        'reserved', 'reserved', 20, null
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 20
      where control_id = 'global'
    `);
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${LEGACY}', '${LEGACY_FAIL}')
    `)).ok, true);
    assert.equal(await actions(LEGACY_FAIL), "");
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "0|0");

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256, settings,
        image_slots, provider_task_name, status, quota_state, reserved_credits, allowance_state
      ) values (
        '${LEGACY_COMMIT}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'legacy-commit-key', '${SHA}',
        '{"shouldTexture":false}'::jsonb, array['front']::text[], 'vibode-${LEGACY_COMMIT}',
        'reserved', 'reserved', 20, null
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 20
      where control_id = 'global'
    `);
    const legacyClaim = await claimNext();
    assert.equal(legacyClaim.purpose, "prepare");
    const legacyCommit = await commit(LEGACY_COMMIT, String(legacyClaim.claim_nonce), LEGACY);
    assert.equal(legacyCommit.ok, true);
    assert.equal(await paid(), "1");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_create(
        '${LEGACY}', '${LEGACY_COMMIT}', '${legacyCommit.claim_nonce}', 'provider_rejected', 'provider_rejected'
      )
    `)).ok, true);
    assert.equal(await actions(LEGACY_COMMIT), "");
    await zeroPaidUsed();

    await reserve(POSTED, "posted-key");
    await attach(POSTED, photo, photoSha);
    const postedObjects = store();
    await postedObjects.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, POSTED, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const postedTransport = countingTransport(posts, [{ result: POST_TASK }]);
    posts.count = 0;
    const posted = await pass(postedObjects, postedTransport, Date.now());
    assert.equal(posted.action, "submitted");
    assert.equal(posts.count, 1);
    assert.equal(await paid(), "1");
    assert.equal(await jobFacts(POSTED), "running|1|set|1");
    const poll = await claimNext();
    assert.equal(poll.purpose, "poll");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${POSTED}'
    `);
    const second = await pass(postedObjects, countingTransport(posts, []), Date.now());
    assert.notEqual(second.action, "submitted");
    assert.equal(posts.count, 1);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${POSTED}'
    `);
    const pollFollow = await call(`select public.claim_vibode_furniture_generation('${USER}', '${POSTED}', 'follow')`);
    assert.equal((await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${POSTED}', '${pollFollow.claim_nonce}', 'FAILED', 100, 0, 'FAILED'
      )
    `)).status, "failed");
    await zeroPaidUsed();

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256, settings,
        image_slots, provider_task_name, status, quota_state, reserved_credits, allowance_state
      ) values (
        '${BAD_PROFILE}', '${USER}', 'meshy-7.1', 'image-to-3d', 'bad-profile-key', '${SHA}',
        '{"shouldTexture":false}'::jsonb, array['front']::text[], 'vibode-${BAD_PROFILE}',
        'reserved', 'reserved', 30, 'reserved'
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_allowances
      set reserved_generations = reserved_generations + 1
      where user_id = '${USER}'
    `);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 30
      where control_id = 'global'
    `);
    const badClaim = await claimNext();
    const badCommit = await commit(BAD_PROFILE, String(badClaim.claim_nonce));
    assert.equal(badCommit.code, "unsupported_settings");
    assert.equal(await paid(), "0");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_prepared_input(
        '${USER}', '${BAD_PROFILE}', '${badClaim.claim_nonce}'
      )
    `)).ok, true);
    assert.equal(await paid(), "0");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false,
        paid_submissions_authorized = 0,
        paid_submissions_used = 0,
        credits_reserved = 0,
        credits_consumed = 0
      where control_id = 'global'
    `);
    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await indexDef("vibode_furniture_generation_jobs_one_active_uidx"), processingBefore);
    assert.equal(await psql(`
      select credit_ceiling::text || '|' || max_concurrent::text
      from public.vibode_furniture_generation_controls
      where control_id = 'global'
    `), "40|1");
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function reserve(jobId: string, key: string, user = USER): Promise<void> {
  const reserved = await call(`
    select public.reserve_vibode_furniture_generation(
      '${user}', '${jobId}', '${key}', '${SHA}', 'image-to-3d', 'meshy-7.1',
      $json$${SETTINGS}$json$::jsonb, array['front']::text[], 30
    )
  `);
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
}

async function attach(jobId: string, bytes: Buffer, sha: string): Promise<void> {
  const attached = await call(`
    select public.attach_vibode_furniture_generation_input(
      '${USER}', '${jobId}', 'front', 'image/png', ${bytes.byteLength}, 64, 64, '${sha}'
    )
  `);
  assert.equal(attached.ok, true, JSON.stringify(attached));
}

async function claimNext(): Promise<JsonRow> {
  return call("select public.claim_next_vibode_furniture_generation(true)");
}

async function commit(jobId: string, nonce: string, user = USER): Promise<JsonRow> {
  return call(`
    select public.commit_vibode_furniture_generation_submission('${user}', '${jobId}', '${nonce}')
  `);
}

async function settleReviewedFailure(jobId: string, previousNonce: string): Promise<void> {
  const follow = await call(`select public.claim_vibode_furniture_generation('${USER}', '${jobId}', 'follow')`);
  assert.equal(follow.ok, true, JSON.stringify(follow));
  const bound = await call(`
    select public.bind_vibode_furniture_generation_task(
      '${USER}', '${jobId}', '${follow.claim_nonce}', 'task-review-0001', 'FAILED'
    )
  `);
  assert.equal(bound.ok, true, JSON.stringify(bound));
  assert.notEqual(previousNonce, "");
  const running = await call(`select public.claim_vibode_furniture_generation('${USER}', '${jobId}', 'follow')`);
  const observed = await call(`
    select public.apply_vibode_furniture_generation_observation(
      '${USER}', '${jobId}', '${running.claim_nonce}', 'FAILED', 100, 0, 'FAILED'
    )
  `);
  assert.equal(observed.status, "failed");
}

async function pass(
  objects: ReturnType<typeof createMemoryBucketStore>,
  transport: MeshyTransport,
  nowMs: number,
) {
  return executeFurnitureGenerationClaim({
    commands: createSqlGenerationCommands(rpc),
    objects,
    adapter: createMeshyAdapter(transport),
    download: async () => ({ kind: "network" }),
    validate: async () => ({ ok: false, errorClass: "invalid_output" }),
    nowMs,
    submitAllowed: true,
  });
}

function store() {
  return createMemoryBucketStore();
}

function scripted(): MeshyTransport {
  return {
    async request() {
      throw new Error("provider_was_contacted");
    },
  };
}

function countingTransport(
  posts: { count: number },
  postBodies: readonly unknown[],
): MeshyTransport {
  return {
    async request(call: MeshyTransportCall): Promise<MeshyTransportResult> {
      if (call.method === "POST") {
        const body = postBodies[posts.count];
        posts.count += 1;
        if (body == null) throw new Error("unexpected_post");
        return { kind: "response", status: 202, headers: {}, body, unparsed: false };
      }
      return { kind: "response", status: 200, headers: {}, body: [], unparsed: false };
    },
  };
}

async function jobFacts(jobId: string): Promise<string> {
  return psql(`
    select status || '|' || attempt_count::text || '|'
      || case when provider_contacted_at is null then 'null' else 'set' end || '|'
      || case when provider_task_id is null then '0' else '1' end
    from public.vibode_furniture_generation_jobs
    where job_id = '${jobId}'
  `);
}

async function paid(): Promise<string> {
  return psql("select paid_submissions_used::text from public.vibode_furniture_generation_controls where control_id = 'global'");
}

async function credits(): Promise<string> {
  return psql(`
    select credits_reserved::text || '|' || credits_consumed::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function allowance(userId: string): Promise<string> {
  return psql(`
    select reserved_generations::text || '|' || consumed_generations::text
    from public.vibode_furniture_generation_allowances
    where user_id = '${userId}'
  `);
}

async function actions(jobId: string): Promise<string> {
  return psql(`
    select coalesce(string_agg(action, ',' order by created_at), '')
    from public.vibode_furniture_generation_allowance_events
    where job_id = '${jobId}'
  `);
}

async function processingCount(): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  `);
}

async function zeroPaidUsed(): Promise<void> {
  const used = await paid();
  assert.equal(used, "1");
  await psql(`
    update public.vibode_furniture_generation_controls
    set paid_submissions_used = 0
    where control_id = 'global'
  `);
}

async function controlFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function indexDef(name: string): Promise<string> {
  return psql(`select indexdef from pg_indexes where schemaname = 'public' and indexname = '${name}'`);
}

async function functionSource(name: string): Promise<string> {
  return psql(`select pg_get_functiondef('public.${name}'::regproc)`);
}

type JsonRow = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  purpose?: string;
  status?: string;
  outcome?: string;
  claim_nonce?: string;
};

async function call(sql: string): Promise<JsonRow> {
  return JSON.parse(await psql(sql)) as JsonRow;
}

async function rpc(fn: GenerationRpcName, values: readonly unknown[]): Promise<unknown> {
  const args = values.map(sqlLiteral).join(", ");
  return JSON.parse(await psql(`select public.${fn}(${args})::text`));
}

function sqlLiteral(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (Array.isArray(value)) return `array[${value.map((item) => sqlLiteral(item)).join(",")}]::text[]`;
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 400)}`);
  return result.stdout.trim();
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", `POSTGRES_DB=${DATABASE}`,
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1",
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

type CommandResult = Readonly<{ code: number; stdout: string; stderr: string }>;

function docker(args: string[], input?: string): Promise<CommandResult> {
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
