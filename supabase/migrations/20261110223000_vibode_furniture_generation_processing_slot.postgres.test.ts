/**
 * MESHY-1D.2D processing-slot separation on disposable Postgres 16.
 * Migrations run from the certified baseline through allowance settlement,
 * and only then is the processing-slot migration applied. This test does
 * not call Meshy. Concurrent cases use two real Postgres sessions.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d2d-pg";
const DATABASE = "furniture1d2d";
const MIGRATION = "supabase/migrations/20261110223000_vibode_furniture_generation_processing_slot.sql";
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
];
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const LEGACY = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SHA = "ab".repeat(32);
const OUTPUT_SHA = "cd".repeat(32);
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
const READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OWNER_AGAIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OTHER_READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const OTHER_BUDGET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const THIRD_BUDGET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const RACE_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const RACE_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
const BESIDE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const STALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
const LEGACY_SAVED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const LEGACY_FAILED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const LEGACY_READY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const LEGACY_REVIEW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4";
const LEGACY_CONFLICT_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
const LEGACY_CONFLICT_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6";
const REVIEW_TASK = "task-review-0001";
const OTHER_TASK = "task-other-0099";
const STALE_TASK = "task-stale-0001";
const READY_TASK = "task-ready-0001";

test("processing slot frees ready and needs_review without freeing their money", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY|msy_/);
  assert.doesNotMatch(migration, /mark_vibode_furniture_generation_needs_review|vibode_furniture_generation_settle_allowance/);
  assert.match(migration, /leaves the tester allowance reserved/);
  assert.match(migration, /VIBODE_FURNITURE_GENERATION:USER_OCCUPANCY/);

  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }

  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values
        ('${USER}'), ('${OTHER}'), ('${THIRD}'), ('${LEGACY}'), ('${ADMIN}');
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

    await psql("drop index public.vibode_furniture_generation_jobs_one_active_uidx");
    await insertJob(LEGACY_CONFLICT_A, LEGACY, "legacy-conflict-a", "needs_review", "reserved", null);
    await insertJob(LEGACY_CONFLICT_B, LEGACY, "legacy-conflict-b", "needs_review", "reserved", null);
    const rejected = await callResult(migration);
    assert.notEqual(rejected.code, 0);
    assert.match(`${rejected.stderr}\n${rejected.stdout}`, /USER_OCCUPANCY/);
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_jobs
      where user_id = '${LEGACY}'
    `), "2");
    await psql(`
      delete from public.vibode_furniture_generation_jobs
      where user_id = '${LEGACY}'
    `);
    await psql(`
      create unique index vibode_furniture_generation_jobs_one_active_uidx
        on public.vibode_furniture_generation_jobs ((1))
        where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'ready', 'needs_review')
    `);

    const controlsBefore = await controlFingerprint();
    const indexBefore = await indexDef("vibode_furniture_generation_jobs_one_active_uidx");
    assert.match(indexBefore, /ready/);
    assert.match(indexBefore, /needs_review/);

    await psql(migration);

    assert.equal(await controlFingerprint(), controlsBefore);
    const processingIndex = await indexDef("vibode_furniture_generation_jobs_one_active_uidx");
    const userIndex = await indexDef("vibode_furniture_generation_jobs_one_user_open_uidx");
    assert.match(processingIndex, /reserved/);
    assert.match(processingIndex, /submitting/);
    assert.match(processingIndex, /ambiguous/);
    assert.match(processingIndex, /running/);
    assert.match(processingIndex, /ingesting/);
    assert.doesNotMatch(processingIndex, /ready/);
    assert.doesNotMatch(processingIndex, /needs_review/);
    assert.match(userIndex, /needs_review/);
    assert.doesNotMatch(userIndex, /'ready'/);
    assert.match(await functionSource("mark_vibode_furniture_generation_needs_review"), /60 seconds/);
    assert.match(await functionSource("mark_vibode_furniture_generation_needs_review"), /60 minutes/);
    assert.match(await functionSource("bind_vibode_furniture_generation_task"), /pg_advisory_xact_lock/);
    assert.equal(await psql(`
      select has_function_privilege('anon', 'public.bind_vibode_furniture_generation_task(uuid,uuid,uuid,text,text)', 'execute')::text
        || has_function_privilege('authenticated', 'public.bind_vibode_furniture_generation_task(uuid,uuid,uuid,text,text)', 'execute')::text
        || has_function_privilege('service_role', 'public.bind_vibode_furniture_generation_task(uuid,uuid,uuid,text,text)', 'execute')::text
        || has_function_privilege('service_role', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
    `), "falsefalsetruetrue");
    assert.equal(await psql(`
      select c.relrowsecurity::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'vibode_furniture_generation_jobs'
    `), "true");

    await insertJob(LEGACY_SAVED, LEGACY, "legacy-saved-key", "saved", "reconciled", 30, `vibode-furniture/personal/${LEGACY_SAVED}`);
    await insertJob(LEGACY_FAILED, LEGACY, "legacy-failed-key", "failed", "released", 0, null);

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true, paid_submissions_authorized = 1
      where control_id = 'global'
    `);
    for (const userId of [USER, OTHER, THIRD]) {
      await psql(`
        insert into public.vibode_furniture_generation_allowances (
          user_id, classification, enabled, authorized_generations,
          reserved_generations, consumed_generations, updated_by
        ) values ('${userId}', 'individual_beta', true, 5, 0, 0, '${ADMIN}')
      `);
    }

    await finishReady(READY, "ready-owner-key", READY_TASK);
    assert.equal(await jobState(READY), "ready|reconciled|consumed|0");
    assert.equal(await balance(USER), "0|1");
    assert.equal(await processingCount(), "0");
    assert.equal(await eventCount(READY, "consume"), "1");

    const otherReady = await call(reserveSql(OTHER, OTHER_READY, "other-after-ready"));
    assert.equal(otherReady.created, true);
    assert.equal(await processingCount(), "1");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${OTHER}', '${OTHER_READY}')
    `)).status, "failed");
    assert.equal(await balance(OTHER), "0|0");
    assert.equal(await processingCount(), "0");

    const ownerAgain = await call(reserveSql(USER, OWNER_AGAIN, "owner-after-ready"));
    assert.equal(ownerAgain.created, true);
    assert.equal(await balance(USER), "1|1");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${OWNER_AGAIN}')
    `)).status, "failed");
    assert.equal(await balance(USER), "0|1");
    assert.equal(await credits(), "0|0|1");
    await zeroPaidUsed();

    const reviewNonce = await submit(USER, REVIEW, "review-key");
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_ambiguous('${USER}', '${REVIEW}', '${reviewNonce}', 'create_timeout')
    `)).status, "ambiguous");
    let follow = await claimFollow(USER, REVIEW);
    let earlyAbsent = await markReview(USER, REVIEW, follow, "list_absent");
    assert.equal(earlyAbsent.code, "needs_reconciliation");
    assert.equal(await statusOf(REVIEW), "ambiguous");
    follow = await claimFollow(USER, REVIEW);
    let earlyIncomplete = await markReview(USER, REVIEW, follow, "list_incomplete");
    assert.equal(earlyIncomplete.code, "needs_reconciliation");
    await backdate(REVIEW, "61 seconds");
    follow = await claimFollow(USER, REVIEW);
    const stillHour = await markReview(USER, REVIEW, follow, "list_incomplete");
    assert.equal(stillHour.code, "needs_reconciliation");
    assert.equal(await statusOf(REVIEW), "ambiguous");
    await backdate(REVIEW, "61 minutes");
    follow = await claimFollow(USER, REVIEW);
    const reviewed = await markReview(USER, REVIEW, follow, "list_incomplete");
    assert.equal(reviewed.status, "needs_review");
    assert.equal(await jobState(REVIEW), "needs_review|reserved|reserved|null");
    assert.equal(await processingCount(), "0");
    assert.equal(await balance(USER), "1|1");
    assert.equal(await credits(), "30|0|1");
    assert.equal(await eventCount(REVIEW, "reserve"), "1");
    assert.equal(await eventCount(REVIEW, "release"), "0");
    assert.equal(await eventCount(REVIEW, "consume"), "0");
    assert.equal(await contactState(REVIEW), "1|true|null");

    const ownerBlocked = await call(reserveSql(USER, OWNER_AGAIN, "owner-while-review"));
    assert.equal(ownerBlocked.ok, false);
    assert.equal(ownerBlocked.code, "concurrency_limited");
    assert.equal(await balance(USER), "1|1");
    assert.equal(await credits(), "30|0|1");
    assert.equal(await processingCount(), "0");

    const deniedAtForty = await call(reserveSql(OTHER, OTHER_BUDGET, "other-at-forty"));
    assert.equal(deniedAtForty.code, "quota_exhausted");
    assert.equal(await balance(OTHER), "0|0");
    assert.equal(await credits(), "30|0|1");
    assert.equal(await processingCount(), "0");

    await psql(`
      alter table public.vibode_furniture_generation_controls
        drop constraint vibode_furniture_generation_controls_ceiling;
      alter table public.vibode_furniture_generation_controls
        disable trigger vibode_furniture_generation_protect_controls;
      update public.vibode_furniture_generation_controls
      set credit_ceiling = 60
      where control_id = 'global';
    `);
    const admitted = await call(reserveSql(OTHER, OTHER_BUDGET, "other-with-room"));
    assert.equal(admitted.created, true);
    assert.equal(await credits(), "60|0|1");
    assert.equal(await processingCount(), "1");
    assert.equal(await balance(OTHER), "1|0");

    const deniedResubmit = await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${REVIEW}', false)
    `);
    assert.equal(deniedResubmit.code, "not_claimable");
    assert.equal(await statusOf(REVIEW), "needs_review");
    const claimedReview = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(claimedReview.outcome, "claimed");
    assert.equal(claimedReview.purpose, "reconcile");
    assert.equal(claimedReview.job_id, REVIEW);
    assert.equal(await paidUsed(), "1");
    const blockedBind = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${REVIEW}', '${String(claimedReview.claim_nonce)}', '${REVIEW_TASK}', 'PENDING'
      )
    `);
    assert.equal(blockedBind.code, "concurrency_limited");
    assert.equal(await statusOf(REVIEW), "needs_review");
    assert.equal(await taskOf(REVIEW), REVIEW_TASK);
    assert.equal(await jobState(REVIEW), "needs_review|reserved|reserved|null");
    assert.equal(await balance(USER), "1|1");
    assert.equal(await credits(), "60|0|1");
    assert.equal(await eventCount(REVIEW, "release"), "0");
    follow = await claimFollow(USER, REVIEW);
    const rebound = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${REVIEW}', '${follow}', '${OTHER_TASK}', 'PENDING'
      )
    `);
    assert.equal(rebound.code, "task_immutable");
    assert.equal(await taskOf(REVIEW), REVIEW_TASK);
    assert.equal(await statusOf(REVIEW), "needs_review");

    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'needs_review', error_class = 'needs_review'
      where job_id = '${OTHER_BUDGET}'
    `);
    assert.equal(await processingCount(), "0");
    assert.equal(await jobState(OTHER_BUDGET), "needs_review|reserved|reserved|null");
    assert.equal(await balance(OTHER), "1|0");
    assert.equal(await credits(), "60|0|1");
    const thirdDenied = await call(reserveSql(THIRD, THIRD_BUDGET, "third-over-sixty"));
    assert.equal(thirdDenied.code, "quota_exhausted");
    assert.equal(await balance(THIRD), "0|0");
    assert.equal(await processingCount(), "0");
    assert.equal(await jobState(REVIEW), "needs_review|reserved|reserved|null");
    assert.equal(await taskOf(REVIEW), REVIEW_TASK);
    const resumed = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${REVIEW}', '${follow}', '${REVIEW_TASK}', 'IN_PROGRESS'
      )
    `);
    assert.equal(resumed.status, "running");
    assert.equal(await taskOf(REVIEW), REVIEW_TASK);
    assert.equal(await jobState(REVIEW), "running|reserved|reserved|null");
    assert.equal(await balance(USER), "1|1");
    assert.equal(await balance(OTHER), "1|0");
    assert.equal(await credits(), "60|0|1");
    assert.equal(await eventCount(REVIEW, "reserve"), "1");
    assert.equal(await eventCount(REVIEW, "release"), "0");
    assert.equal(await contactState(REVIEW), "1|true|null");

    follow = await claimFollow(USER, REVIEW);
    const failed = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${REVIEW}', '${follow}', 'FAILED', 100, 30, 'FAILED'
      )
    `);
    assert.equal(failed.status, "failed");
    assert.equal(await jobState(REVIEW), "failed|reconciled|released|30");
    assert.equal(await balance(USER), "0|1");
    assert.equal(await eventCount(REVIEW, "release"), "1");
    assert.equal(await eventCount(REVIEW, "consume"), "0");
    assert.equal(await credits(), "30|30|1");
    assert.equal(await balance(OTHER), "1|0");
    const secondSettle = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${REVIEW}', '${follow}', 'FAILED', 100, 30, 'FAILED'
      )
    `);
    assert.equal(secondSettle.code, "lease_held");
    assert.equal(await eventCount(REVIEW, "release"), "1");
    assert.equal(await credits(), "30|30|1");
    const otherFollow = await claimFollow(OTHER, OTHER_BUDGET);
    const otherBound = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${OTHER}', '${OTHER_BUDGET}', '${otherFollow}', 'task-budget-0001', 'PENDING'
      )
    `);
    assert.equal(otherBound.status, "running");
    const otherPoll = await claimFollow(OTHER, OTHER_BUDGET);
    const otherFailed = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${OTHER}', '${OTHER_BUDGET}', '${otherPoll}', 'FAILED', 100, 0, 'FAILED'
      )
    `);
    assert.equal(otherFailed.status, "failed");
    assert.equal(await jobState(OTHER_BUDGET), "failed|released|released|0");
    assert.equal(await balance(OTHER), "0|0");
    assert.equal(await eventCount(OTHER_BUDGET, "release"), "1");
    assert.equal(await eventCount(REVIEW, "release"), "1");
    assert.equal(await credits(), "0|30|1");
    assert.equal(await paidUsed(), "1");
    await zeroPaidUsed();
    await zeroConsumed();

    const reservedRace = await call(reserveSql(USER, STALE, "stale-lease-key"));
    assert.equal(reservedRace.created, true);
    const [firstClaim, secondClaim] = await Promise.all([
      call("select public.claim_next_vibode_furniture_generation(true)"),
      call("select public.claim_next_vibode_furniture_generation(true)"),
    ]);
    const claimOutcomes = [firstClaim.outcome, secondClaim.outcome].sort();
    assert.deepEqual(claimOutcomes, ["claimed", "idle"]);
    const winner = firstClaim.outcome === "claimed" ? firstClaim : secondClaim;
    assert.equal(winner.purpose, "submit");
    assert.equal(winner.job_id, STALE);
    assert.equal(await paidUsed(), "1");
    assert.equal(await contactState(STALE), "1|true|present");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second'
      where job_id = '${STALE}'
    `);
    const recovered = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(recovered.purpose, "reconcile");
    assert.equal(recovered.status, "ambiguous");
    assert.equal(await paidUsed(), "1");
    assert.equal(await contactState(STALE), "1|true|present");
    const submitAgain = await call(`select public.claim_vibode_furniture_generation('${USER}', '${STALE}', 'submit')`);
    assert.equal(submitAgain.code, "lease_held");
    assert.equal(await paidUsed(), "1");
    assert.equal(await statusOf(STALE), "ambiguous");
    const staleBound = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${STALE}', '${String(recovered.claim_nonce)}', '${STALE_TASK}', 'PENDING'
      )
    `);
    assert.equal(staleBound.status, "running");
    follow = await claimFollow(USER, STALE);
    const staleFailed = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${STALE}', '${follow}', 'FAILED', 100, 0, 'FAILED'
      )
    `);
    assert.equal(staleFailed.status, "failed");
    assert.equal(await eventCount(STALE, "release"), "1");
    assert.equal(await balance(USER), "0|1");
    assert.equal(await paidUsed(), "1");
    await zeroPaidUsed();

    const [raceUser, raceOther] = await Promise.all([
      call(reserveSql(USER, RACE_USER, "race-user-key")),
      call(reserveSql(OTHER, RACE_OTHER, "race-other-key")),
    ]);
    const created = [raceUser, raceOther].filter((result) => result.created === true);
    const denied = [raceUser, raceOther].filter((result) => result.created !== true);
    assert.equal(created.length, 1);
    assert.equal(denied.length, 1);
    assert.equal(denied[0]?.code, "concurrency_limited");
    assert.equal(await processingCount(), "1");
    const winnerId = String(created[0]?.job_id);
    const winnerUser = winnerId === RACE_USER ? USER : OTHER;
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${winnerUser}', '${winnerId}')
    `)).status, "failed");
    assert.equal(await processingCount(), "0");
    assert.equal(await credits(), "0|0|0");

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, quota_state,
        reserved_credits, consumed_credits,
        output_bucket, output_object_path, output_sha256, output_byte_size, output_expires_at
      ) values (
        '${LEGACY_READY}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'legacy-ready-key', '${SHA}',
        '{}'::jsonb, array['front']::text[], 'vibode-${LEGACY_READY}', 'ready', 'reconciled',
        30, 0,
        'vibode-furniture-assets',
        'users/${LEGACY}/generations/${LEGACY_READY}/candidate.glb',
        '${OUTPUT_SHA}', 1000, now() + interval '7 days'
      )
    `);
    await insertJob(LEGACY_REVIEW, LEGACY, "legacy-review-key", "needs_review", "reserved", null);
    assert.equal(await processingCount(), "0");
    const besideLegacy = await call(reserveSql(USER, BESIDE, "beside-legacy-key"));
    assert.equal(besideLegacy.created, true);
    const duplicateReview = await callResult(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, quota_state, reserved_credits
      ) values (
        '${LEGACY_CONFLICT_A}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'legacy-review-two', '${SHA}',
        '{}'::jsonb, array['front']::text[], 'vibode-${LEGACY_CONFLICT_A}', 'needs_review', 'reserved', 30
      )
    `);
    assert.notEqual(duplicateReview.code, 0);
    assert.match(`${duplicateReview.stderr}\n${duplicateReview.stdout}`, /one_user_open_uidx/);
    assert.equal(await jobState(LEGACY_SAVED), "saved|reconciled|null|30");
    assert.equal(await jobState(LEGACY_FAILED), "failed|released|null|0");
    assert.equal(await jobState(LEGACY_READY), "ready|reconciled|null|0");
    assert.equal(await jobState(LEGACY_REVIEW), "needs_review|reserved|null|null");
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_before_provider('${USER}', '${BESIDE}')
    `)).status, "failed");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credit_ceiling = 40,
        live_enabled = false,
        paid_submissions_authorized = 0,
        paid_submissions_used = 0,
        credits_reserved = 0,
        credits_consumed = 0
      where control_id = 'global';
      alter table public.vibode_furniture_generation_controls
        add constraint vibode_furniture_generation_controls_ceiling
        check (credit_ceiling >= 0 and credit_ceiling <= 40);
      alter table public.vibode_furniture_generation_controls
        enable trigger vibode_furniture_generation_protect_controls;
    `);
    assert.equal(await psql(`
      select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
        || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
        || '|' || credits_reserved::text || '|' || credits_consumed::text
      from public.vibode_furniture_generation_controls
      where control_id = 'global'
    `), "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select tgenabled::text from pg_trigger
      where tgname = 'vibode_furniture_generation_protect_controls' and not tgisinternal
    `), "O");
    assert.equal(await processingCount(), "0");
  } finally {
    await removeContainer();
  }
});

function reserveSql(userId: string, jobId: string, key: string): string {
  return `
    select public.reserve_vibode_furniture_generation(
      '${userId}', '${jobId}', '${key}', '${SHA}',
      'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front']::text[], 30
    )
  `;
}

async function finishReady(jobId: string, key: string, task: string): Promise<void> {
  const nonce = await submit(USER, jobId, key);
  const bound = await call(`
    select public.bind_vibode_furniture_generation_task('${USER}', '${jobId}', '${nonce}', '${task}', 'PENDING')
  `);
  assert.equal(bound.status, "running");
  const follow = await claimFollow(USER, jobId);
  const observed = await call(`
    select public.apply_vibode_furniture_generation_observation(
      '${USER}', '${jobId}', '${follow}', 'SUCCEEDED', 100, 0, null
    )
  `);
  assert.equal(observed.status, "ingesting");
  const recorded = await call(`
    select public.record_vibode_furniture_generation_output(
      '${USER}', '${jobId}', '${follow}', 1000, '${OUTPUT_SHA}'
    )
  `);
  assert.equal(recorded.status, "ready");
}

async function submit(userId: string, jobId: string, key: string): Promise<string> {
  const created = await call(reserveSql(userId, jobId, key));
  assert.equal(created.created, true);
  const claimed = await call(`select public.claim_vibode_furniture_generation('${userId}', '${jobId}', 'submit')`);
  assert.equal(claimed.purpose, "submit");
  return String(claimed.claim_nonce);
}

async function claimFollow(userId: string, jobId: string): Promise<string> {
  const claimed = await call(`select public.claim_vibode_furniture_generation('${userId}', '${jobId}', 'follow')`);
  assert.equal(claimed.ok, true);
  return String(claimed.claim_nonce);
}

async function markReview(userId: string, jobId: string, nonce: string, reason: string): Promise<Record<string, unknown>> {
  return call(`
    select public.mark_vibode_furniture_generation_needs_review(
      '${userId}', '${jobId}', '${nonce}', '${reason}'
    )
  `);
}

async function backdate(jobId: string, interval: string): Promise<void> {
  await psql(`
    update public.vibode_furniture_generation_jobs
    set provider_contacted_at = now() - interval '${interval}'
    where job_id = '${jobId}'
  `);
}

async function insertJob(
  jobId: string,
  userId: string,
  key: string,
  status: string,
  quota: string,
  consumed: number | null,
  saved: string | null = null,
): Promise<void> {
  const consumedSql = consumed == null ? "null" : String(consumed);
  const savedSql = saved == null ? "null" : `'${saved}'`;
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, quota_state,
      reserved_credits, consumed_credits, saved_asset_id
    ) values (
      '${jobId}', '${userId}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', '${status}', '${quota}',
      30, ${consumedSql}, ${savedSql}
    )
  `);
}

async function call(sql: string): Promise<Record<string, unknown>> {
  const text = await psql(`${sql}::text`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function jobState(jobId: string): Promise<string> {
  return psql(`
    select status || '|' || quota_state || '|' || coalesce(allowance_state, 'null')
      || '|' || coalesce(consumed_credits::text, 'null')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function statusOf(jobId: string): Promise<string> {
  return psql(`select status from public.vibode_furniture_generation_jobs where job_id = '${jobId}'`);
}

async function taskOf(jobId: string): Promise<string> {
  return psql(`
    select coalesce(provider_task_id, 'null')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function contactState(jobId: string): Promise<string> {
  return psql(`
    select attempt_count::text || '|' || (provider_contacted_at is not null)::text
      || '|' || case when claim_nonce is null then 'null' else 'present' end
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function balance(userId: string): Promise<string> {
  return psql(`
    select reserved_generations::text || '|' || consumed_generations::text
    from public.vibode_furniture_generation_allowances
    where user_id = '${userId}'
  `);
}

async function eventCount(jobId: string, action: string): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_allowance_events
    where job_id = '${jobId}' and action = '${action}'
  `);
}

async function eventsFor(userId: string): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_allowance_events
    where user_id = '${userId}'
  `);
}

async function credits(): Promise<string> {
  return psql(`
    select credits_reserved::text || '|' || credits_consumed::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function paidUsed(): Promise<string> {
  return psql(`
    select paid_submissions_used::text from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function processingCount(): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  `);
}

async function zeroPaidUsed(): Promise<void> {
  await psql(`
    update public.vibode_furniture_generation_controls
    set paid_submissions_used = 0
    where control_id = 'global'
  `);
}

async function zeroConsumed(): Promise<void> {
  await psql(`
    update public.vibode_furniture_generation_controls
    set credits_consumed = 0
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
  return psql(`
    select indexdef from pg_indexes
    where schemaname = 'public' and indexname = '${name}'
  `);
}

async function functionSource(name: string): Promise<string> {
  return psql(`select pg_get_functiondef('public.${name}'::regproc)`);
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 500)}`);
  return result.stdout.trim();
}

function callResult(sql: string): Promise<CommandResult> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
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
