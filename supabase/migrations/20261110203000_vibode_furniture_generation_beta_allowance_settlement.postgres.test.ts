/**
 * MESHY-1D.2C allowance settlement on disposable Postgres 16.
 * Migrations run from the certified baseline through reservation, and only
 * then is settlement applied. This test does not call Meshy.
 *
 * Historical generation tests stop at their own migration files. This test
 * is the proof of the combined chain.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d2c-pg";
const DATABASE = "furniture1d2c";
const MIGRATION = "supabase/migrations/20261110203000_vibode_furniture_generation_beta_allowance_settlement.sql";
const BASELINE = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
  "supabase/migrations/20261109210000_vibode_furniture_generation_beta_allowances.sql",
  "supabase/migrations/20261109220000_vibode_furniture_generation_beta_allowance_reserve.sql",
];
const USER = "11111111-1111-4111-8111-111111111111";
const LEGACY = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const SHA = "ab".repeat(32);
const OUTPUT_SHA = "cd".repeat(32);
const ASSET_SHA = "ef".repeat(32);
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

const PRE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DISC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const STALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const STALE_LEGACY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const CREATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const RATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const FAIL0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const FAIL_POS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
const FAIL_NULL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
const CANCELED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const MISSING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad";
const INVALID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae";
const OVERSIZE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf";
const SAVED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const DISCARD_READY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const EXPIRE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const SWEEP_READY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const RACE_OLD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const RACE_NEW = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const CONSUME_RACE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const CONSUME_NEW = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const DOUBLE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const AUDIT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const LEGACY_SAVED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const LEGACY_FAILED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const LEGACY_LIVE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const LEGACY_RUN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4";
const ASSET = "ffffffff-ffff-4fff-8fff-fffffffffff1";

test("beta allowance settlement follows the job outcome on the full migration chain", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions/i);
  assert.match(migration, /Beta generation consumed/);
  assert.match(migration, /Beta generation released/);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY|msy_/);
  assert.doesNotMatch(migration, /vibode_furniture_generation_jobs_one_active_uidx/);

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
      insert into auth.users (id) values ('${USER}'), ('${LEGACY}'), ('${ADMIN}');
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
    await insertLegacy(LEGACY_SAVED, "legacy-saved-key", "saved", "reconciled", 30, assetId(LEGACY_SAVED));
    await insertLegacy(LEGACY_FAILED, "legacy-failed-key", "failed", "released", 0, null);
    const controlsBefore = await controlFingerprint();
    const indexBefore = await activeIndex();

    await psql(migration);

    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await activeIndex(), indexBefore);
    assert.match(indexBefore, /needs_review/);
    assert.equal(await psql(`
      select has_function_privilege('service_role', 'public.vibode_furniture_generation_settle_allowance(uuid,uuid,text,text)', 'execute')::text
        || ':' || has_function_privilege('service_role', 'public.fail_vibode_furniture_generation_before_provider(uuid,uuid)', 'execute')::text
    `), "false:true");
    assert.equal(await jobState(LEGACY_SAVED), "saved|reconciled|null|30");
    assert.equal(await jobState(LEGACY_FAILED), "failed|released|null|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true, paid_submissions_authorized = 1
      where control_id = 'global'
    `);
    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations,
        reserved_generations, consumed_generations, updated_by
      ) values ('${USER}', 'individual_beta', true, 20, 0, 0, '${ADMIN}')
    `);

    await admit(PRE, "pre-provider-key");
    assert.equal((await call(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${PRE}')`)).status, "failed");
    assert.equal(await jobState(PRE), "failed|released|released|0");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(PRE, "release"), "1");
    assert.equal(await eventCount(PRE, "consume"), "0");
    assert.equal(await credits(), "0|0|0");
    assert.equal((await call(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${PRE}')`)).code, "not_claimable");
    assert.equal(await eventCount(PRE, "release"), "1");
    assert.equal(await balance(), "0|0");

    await admit(DISC, "discard-unsubmitted-key");
    assert.equal((await call(`select public.discard_vibode_furniture_generation_candidate('${USER}', '${DISC}')`)).status, "cancelled");
    assert.equal(await jobState(DISC), "cancelled|released|released|0");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(DISC, "release"), "1");
    assert.equal(await credits(), "0|0|0");

    await psql(`
      update public.vibode_furniture_generation_allowances
      set reserved_generations = reserved_generations + 1
      where user_id = '${USER}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 30
      where control_id = 'global';
    `);
    await insertAgedReservation(STALE, USER, "stale-beta-key", "reserved");
    assert.equal(await psql("select public.sweep_vibode_furniture_generation_holds()->>'ok'"), "true");
    assert.equal(await jobState(STALE), "cancelled|released|released|0");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(STALE, "release"), "1");
    assert.equal(await credits(), "0|0|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 30
      where control_id = 'global'
    `);
    await insertAgedReservation(STALE_LEGACY, LEGACY, "stale-legacy-key", null);
    assert.equal(await psql("select public.sweep_vibode_furniture_generation_holds()->>'ok'"), "true");
    assert.equal(await jobState(STALE_LEGACY), "cancelled|released|null|0");
    assert.equal(await eventCount(STALE_LEGACY, "release"), "0");
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal(await credits(), "0|0|0");

    const createdNonce = await submit(CREATE, "create-rejected-key");
    assert.equal(await paidUsed(), "1");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_create(
        '${USER}', '${CREATE}', '${createdNonce}', 'provider_rejected', 'rejected'
      )
    `)).status, "failed");
    assert.equal(await jobState(CREATE), "failed|released|released|0");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(CREATE, "release"), "1");
    assert.equal(await paidUsed(), "1");
    assert.equal(await credits(), "0|0|1");
    await zeroPaidUsed();

    const rateNonce = await submit(RATE, "rate-limit-key");
    assert.equal((await call(`
      select public.settle_vibode_furniture_generation_rate_limit('${USER}', '${RATE}', '${rateNonce}')
    `)).error_class, "rate_limited");
    assert.equal(await jobState(RATE), "failed|released|released|0");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(RATE, "release"), "1");
    assert.equal(await paidUsed(), "1");
    assert.equal(await credits(), "0|0|1");
    await zeroPaidUsed();

    await observeFailure(FAIL0, "fail-zero-key", "task-fail-zero", "FAILED", 0);
    assert.equal(await jobState(FAIL0), "failed|released|released|0");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(FAIL0, "release"), "1");
    assert.equal(await credits(), "0|0|1");
    await zeroPaidUsed();

    await observeFailure(CANCELED, "canceled-zero-key", "task-canceled-0", "CANCELED", 0);
    assert.equal(await jobState(CANCELED), "failed|released|released|0");
    assert.equal(await eventCount(CANCELED, "release"), "1");
    assert.equal(await credits(), "0|0|1");
    await zeroPaidUsed();

    await observeFailure(FAIL_POS, "fail-positive-key", "task-fail-pos", "FAILED", 30);
    assert.equal(await jobState(FAIL_POS), "failed|reconciled|released|30");
    assert.equal(await balance(), "0|0");
    assert.equal(await eventCount(FAIL_POS, "release"), "1");
    assert.equal(await credits(), "0|30|1");
    await zeroPaidUsed();
    await zeroConsumed();

    await observeFailure(FAIL_NULL, "fail-missing-key", "task-fail-null", "FAILED", null);
    assert.equal(await jobState(FAIL_NULL), "failed|released|reserved|0");
    assert.equal(await balance(), "1|0");
    assert.equal(await eventCount(FAIL_NULL, "release"), "0");
    assert.equal(await eventCount(FAIL_NULL, "consume"), "0");
    assert.equal(await credits(), "0|0|1");
    await zeroPaidUsed();

    const reviewNonce = await submit(REVIEW, "review-hold-key");
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_ambiguous('${USER}', '${REVIEW}', '${reviewNonce}', 'create_timeout')
    `)).status, "ambiguous");
    assert.equal(await jobState(REVIEW), "ambiguous|reserved|reserved|null");
    assert.equal(await eventCount(REVIEW, "release"), "0");
    assert.equal(await credits(), "30|0|1");
    const reviewFollow = await call(`select public.claim_vibode_furniture_generation('${USER}', '${REVIEW}', 'follow')`);
    assert.equal(reviewFollow.ok, true);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '2 minutes'
      where job_id = '${REVIEW}'
    `);
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_needs_review(
        '${USER}', '${REVIEW}', '${String(reviewFollow.claim_nonce)}', 'list_absent'
      )
    `)).status, "needs_review");
    assert.equal(await jobState(REVIEW), "needs_review|reserved|reserved|null");
    assert.equal(await eventCount(REVIEW, "release"), "0");
    assert.equal(await credits(), "30|0|1");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${REVIEW}', true)
    `)).status, "reserved");
    assert.equal(await jobState(REVIEW), "reserved|reserved|reserved|null");
    assert.equal(await balance(), "2|0");
    assert.equal(await eventCount(REVIEW, "reserve"), "1");
    assert.equal(await eventCount(REVIEW, "release"), "0");
    await parkUnsettled(REVIEW);

    const missingNonce = await toRunning(MISSING, "missing-credit-key", "task-missing-cr");
    const missing = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${MISSING}', '${missingNonce}', 'SUCCEEDED', 100, null, null
      )
    `);
    assert.equal(missing.status, "running");
    assert.equal(missing.error_class, "credit_unreported");
    assert.equal(await jobState(MISSING), "running|reserved|reserved|null");
    assert.equal(await eventCount(MISSING, "release"), "0");
    assert.equal(await eventCount(MISSING, "consume"), "0");
    assert.equal(await credits(), "30|0|1");
    await parkUnsettled(MISSING);

    const invalidNonce = await toSucceeded(INVALID, "invalid-glb-key", "task-invalid-gl", 30);
    assert.equal(await credits(), "0|30|1");
    assert.equal(await jobState(INVALID), "ingesting|reconciled|reserved|30");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_output(
        '${USER}', '${INVALID}', '${invalidNonce}', 'invalid_output'
      )
    `)).error_class, "invalid_output");
    assert.equal(await jobState(INVALID), "failed|reconciled|released|30");
    assert.equal(await eventCount(INVALID, "release"), "1");
    assert.equal(await eventCount(INVALID, "consume"), "0");
    assert.equal(await credits(), "0|30|1");
    await zeroPaidUsed();
    await zeroConsumed();

    const oversizeNonce = await toSucceeded(OVERSIZE, "oversize-glb-key", "task-oversize-g", 30);
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_output(
        '${USER}', '${OVERSIZE}', '${oversizeNonce}', 'oversized_output'
      )
    `)).error_class, "oversized_output");
    assert.equal(await jobState(OVERSIZE), "failed|reconciled|released|30");
    assert.equal(await eventCount(OVERSIZE, "release"), "1");
    assert.equal(await credits(), "0|30|1");
    await zeroPaidUsed();
    await zeroConsumed();

    const savedNonce = await toSucceeded(SAVED, "ready-save-key", "task-ready-save", 30);
    const beforeConsume = await balance();
    assert.equal((await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${SAVED}', '${savedNonce}', 1000, '${OUTPUT_SHA}'
      )
    `)).status, "ready");
    assert.equal(await jobState(SAVED), "ready|reconciled|consumed|30");
    assert.equal(await eventCount(SAVED, "consume"), "1");
    assert.equal(await eventCount(SAVED, "release"), "0");
    assert.equal(await balance(), shift(beforeConsume, -1, 1));
    assert.equal((await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${SAVED}', '${savedNonce}', 1000, '${OUTPUT_SHA}'
      )
    `)).code, "lease_held");
    assert.equal(await eventCount(SAVED, "consume"), "1");
    await saveCandidate(SAVED);
    assert.equal(await jobState(SAVED), "saved|reconciled|consumed|30");
    assert.equal(await eventCount(SAVED, "consume"), "1");
    await psql(`
      update public.vibode_furniture_assets
      set library_visibility = 'archived'
      where asset_id = '${assetId(ASSET)}'
    `);
    assert.equal(await eventCount(SAVED, "consume"), "1");
    assert.equal(await balance(), shift(beforeConsume, -1, 1));
    assert.equal((await call(`select public.discard_vibode_furniture_generation_candidate('${USER}', '${SAVED}')`)).code, "not_claimable");
    await zeroPaidUsed();
    await zeroConsumed();

    const discardNonce = await toSucceeded(DISCARD_READY, "ready-discard-key", "task-ready-disc", 30);
    const beforeDiscard = await balance();
    await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${DISCARD_READY}', '${discardNonce}', 1000, '${OUTPUT_SHA}'
      )
    `);
    assert.equal((await call(`
      select public.discard_vibode_furniture_generation_candidate('${USER}', '${DISCARD_READY}')
    `)).status, "discarded");
    assert.equal(await jobState(DISCARD_READY), "discarded|reconciled|consumed|30");
    assert.equal(await eventCount(DISCARD_READY, "consume"), "1");
    assert.equal(await eventCount(DISCARD_READY, "release"), "0");
    assert.equal(await balance(), shift(beforeDiscard, -1, 1));
    await zeroPaidUsed();
    await zeroConsumed();

    const expireNonce = await toSucceeded(EXPIRE, "ready-expire-key", "task-ready-exp1", 30);
    const beforeExpire = await balance();
    await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${EXPIRE}', '${expireNonce}', 1000, '${OUTPUT_SHA}'
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_expires_at = now() - interval '1 minute'
      where job_id = '${EXPIRE}'
    `);
    assert.equal((await call(`select public.expire_vibode_furniture_generation_candidate('${USER}', '${EXPIRE}')`)).status, "expired");
    assert.equal(await jobState(EXPIRE), "expired|reconciled|consumed|30");
    assert.equal(await eventCount(EXPIRE, "release"), "0");
    assert.equal(await balance(), shift(beforeExpire, -1, 1));
    await zeroPaidUsed();
    await zeroConsumed();

    const sweepNonce = await toSucceeded(SWEEP_READY, "ready-sweep-key", "task-ready-exp2", 30);
    const beforeSweep = await balance();
    await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${SWEEP_READY}', '${sweepNonce}', 1000, '${OUTPUT_SHA}'
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_expires_at = now() - interval '1 minute'
      where job_id = '${SWEEP_READY}'
    `);
    assert.equal(await psql("select public.sweep_vibode_furniture_generation_holds()->>'ok'"), "true");
    assert.equal(await jobState(SWEEP_READY), "expired|reconciled|consumed|30");
    assert.equal(await eventCount(SWEEP_READY, "release"), "0");
    assert.equal(await balance(), shift(beforeSweep, -1, 1));
    await zeroPaidUsed();
    await zeroConsumed();

    await admit(DOUBLE, "double-release-key");
    const doubled = await Promise.all([
      callResult(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${DOUBLE}')::text`),
      callResult(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${DOUBLE}')::text`),
    ]);
    assert.deepEqual(doubled.map((item) => item.code).sort(), [0, 0]);
    const doubleBodies = doubled.map((item) => JSON.parse(item.stdout) as { ok: boolean; status?: string; code?: string });
    assert.equal(doubleBodies.filter((item) => item.ok === true && item.status === "failed").length, 1);
    assert.equal(doubleBodies.filter((item) => item.ok === false && item.code === "not_claimable").length, 1);
    assert.equal(await eventCount(DOUBLE, "release"), "1");
    assert.equal(await jobState(DOUBLE), "failed|released|released|0");
    assert.equal(await credits(), "0|0|0");

    const reservedBeforeRace = await balance();
    await admit(RACE_OLD, "race-release-old");
    const race = await Promise.all([
      callResult(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${RACE_OLD}')::text`),
      callResult(reserveSql(USER, RACE_NEW, "race-release-new")),
    ]);
    for (const item of race) {
      assert.equal(item.code, 0, `${item.stderr}\n${item.stdout}`);
    }
    const raceBodies = race.map((item) => JSON.parse(item.stdout) as { ok: boolean; created?: boolean; status?: string; code?: string });
    const released = raceBodies.some((item) => item.ok === true && item.status === "failed");
    const admitted = raceBodies.some((item) => item.ok === true && item.created === true);
    const blocked = raceBodies.some((item) => item.ok === false && item.code === "concurrency_limited");
    assert.equal(released, true);
    assert.equal(admitted || blocked, true);
    assert.equal(await eventCount(RACE_OLD, "release"), "1");
    assert.equal(await jobState(RACE_OLD), "failed|released|released|0");
    if (admitted) {
      assert.equal(await jobState(RACE_NEW), "reserved|reserved|reserved|null");
      assert.equal(await eventCount(RACE_NEW, "reserve"), "1");
      assert.equal(await balance(), shift(reservedBeforeRace, 1, 0));
      assert.equal(await credits(), "30|0|0");
      assert.equal((await call(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${RACE_NEW}')`)).status, "failed");
    } else {
      assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${RACE_NEW}'`), "0");
      assert.equal(await balance(), reservedBeforeRace);
    }
    assert.equal(await credits(), "0|0|0");
    assert.equal(await countReservedJobs(USER), (await balance()).split("|")[0]);

    const consumeNonce = await toSucceeded(CONSUME_RACE, "consume-race-key", "task-consume-rc", 30);
    const beforeConsumeRace = await balance();
    const consumeRace = await Promise.all([
      callResult(`
        select public.record_vibode_furniture_generation_output(
          '${USER}', '${CONSUME_RACE}', '${consumeNonce}', 1000, '${OUTPUT_SHA}'
        )::text
      `),
      callResult(reserveSql(USER, CONSUME_NEW, "consume-race-new")),
    ]);
    for (const item of consumeRace) {
      assert.equal(item.code, 0, `${item.stderr}\n${item.stdout}`);
    }
    const consumeBodies = consumeRace.map((item) => JSON.parse(item.stdout) as { ok: boolean; status?: string; code?: string; created?: boolean });
    assert.equal(consumeBodies.some((item) => item.status === "ready"), true);
    assert.equal(consumeBodies.some((item) => item.created === true), false);
    assert.equal(await jobState(CONSUME_RACE), "ready|reconciled|consumed|30");
    assert.equal(await eventCount(CONSUME_RACE, "consume"), "1");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${CONSUME_NEW}'`), "0");
    assert.equal(await balance(), shift(beforeConsumeRace, -1, 1));
    assert.equal(await credits(), "0|30|1");
    assert.equal((await call(`select public.discard_vibode_furniture_generation_candidate('${USER}', '${CONSUME_RACE}')`)).status, "discarded");
    assert.equal(await eventCount(CONSUME_RACE, "consume"), "1");
    await zeroPaidUsed();
    await zeroConsumed();

    await psql(`
      create or replace function public.test_1d2c_fail_settlement_event()
      returns trigger language plpgsql as $fn$
      begin
        if new.action in ('release', 'consume') then
          raise exception 'TEST_SETTLEMENT_EVENT_INSERT_FAILED';
        end if;
        return new;
      end;
      $fn$;
      create trigger test_1d2c_fail_settlement_event
      before insert on public.vibode_furniture_generation_allowance_events
      for each row execute function public.test_1d2c_fail_settlement_event();
    `);
    await admit(AUDIT, "audit-rollback-key");
    const held = await balance();
    const rolled = await callResult(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${AUDIT}')::text`);
    assert.notEqual(rolled.code, 0);
    assert.match(rolled.stderr, /TEST_SETTLEMENT_EVENT_INSERT_FAILED/);
    assert.equal(await jobState(AUDIT), "reserved|reserved|reserved|null");
    assert.equal(await balance(), held);
    assert.equal(await eventCount(AUDIT, "release"), "0");
    assert.equal(await credits(), "30|0|0");
    await psql(`
      drop trigger test_1d2c_fail_settlement_event on public.vibode_furniture_generation_allowance_events;
      drop function public.test_1d2c_fail_settlement_event();
    `);
    assert.equal((await call(`select public.fail_vibode_furniture_generation_before_provider('${USER}', '${AUDIT}')`)).status, "failed");
    assert.equal(await eventCount(AUDIT, "release"), "1");
    assert.equal(await credits(), "0|0|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 30
      where control_id = 'global'
    `);
    await insertRunnableLegacy();
    assert.equal((await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${LEGACY}', '${LEGACY_RUN}', '${"12121212-1212-4121-8121-121212121212"}', 'FAILED', 100, 0, 'FAILED'
      )
    `)).status, "failed");
    assert.equal(await jobState(LEGACY_RUN), "failed|released|null|0");
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal(await credits(), "0|0|0");
    assert.equal(await jobState(LEGACY_SAVED), "saved|reconciled|null|30");
    assert.equal(await jobState(LEGACY_FAILED), "failed|released|null|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 30
      where control_id = 'global'
    `);
    await insertPlainReserved(LEGACY_LIVE, LEGACY, "legacy-live-key");
    assert.equal((await call(`select public.fail_vibode_furniture_generation_before_provider('${LEGACY}', '${LEGACY_LIVE}')`)).status, "failed");
    assert.equal(await jobState(LEGACY_LIVE), "failed|released|null|0");
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal(await credits(), "0|0|0");

    assert.equal(await activeJobs(), "0");
    assert.equal(await psql(`
      select max_concurrent::text || '|' || credit_ceiling::text
        || '|' || paid_submissions_authorized::text || '|' || live_enabled::text
        || '|' || credits_consumed::text
      from public.vibode_furniture_generation_controls
      where control_id = 'global'
    `), "1|40|1|true|0");
    assert.equal(await activeIndex(), indexBefore);
    assert.equal(await countReservedJobs(USER), (await balance()).split("|")[0]);
  } finally {
    await removeContainer();
  }
});

function assetId(uuid: string): string {
  return `vibode-furniture/personal/${uuid}`;
}

function shift(balanceText: string, reservedDelta: number, consumedDelta: number): string {
  const [reserved, consumed] = balanceText.split("|").map((value) => Number(value));
  return `${reserved + reservedDelta}|${consumed + consumedDelta}`;
}

async function admit(jobId: string, key: string, user = USER): Promise<void> {
  assert.equal(await activeJobs(), "0");
  assert.equal((await credits()).startsWith("0|0|"), true);
  const created = await call(reserveSql(user, jobId, key));
  assert.equal(created.created, true);
  assert.equal(created.job_id, jobId);
}

async function submit(jobId: string, key: string): Promise<string> {
  await admit(jobId, key);
  assert.equal(await paidUsed(), "0");
  const claimed = await call(`select public.claim_vibode_furniture_generation('${USER}', '${jobId}', 'submit')`);
  assert.equal(claimed.ok, true);
  return String(claimed.claim_nonce);
}

async function toRunning(jobId: string, key: string, task: string): Promise<string> {
  const nonce = await submit(jobId, key);
  const bound = await call(`
    select public.bind_vibode_furniture_generation_task('${USER}', '${jobId}', '${nonce}', '${task}', 'PENDING')
  `);
  assert.equal(bound.ok, true);
  const follow = await call(`select public.claim_vibode_furniture_generation('${USER}', '${jobId}', 'follow')`);
  assert.equal(follow.ok, true);
  return String(follow.claim_nonce);
}

async function toSucceeded(jobId: string, key: string, task: string, consumed: number): Promise<string> {
  const nonce = await toRunning(jobId, key, task);
  const observed = await call(`
    select public.apply_vibode_furniture_generation_observation(
      '${USER}', '${jobId}', '${nonce}', 'SUCCEEDED', 100, ${consumed}, null
    )
  `);
  assert.equal(observed.status, "ingesting");
  return nonce;
}

async function observeFailure(
  jobId: string,
  key: string,
  task: string,
  status: "FAILED" | "CANCELED",
  consumed: number | null,
): Promise<void> {
  const nonce = await toRunning(jobId, key, task);
  const observed = await call(`
    select public.apply_vibode_furniture_generation_observation(
      '${USER}', '${jobId}', '${nonce}', '${status}', 100, ${consumed === null ? "null" : String(consumed)}, '${status}'
    )
  `);
  assert.equal(observed.status, "failed");
}

async function saveCandidate(jobId: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_assets (
      asset_id, user_id, display_name, origin,
      authored_width_m, authored_height_m, authored_depth_m,
      sha256, byte_size, storage_bucket, storage_object_path
    ) values (
      '${assetId(ASSET)}', '${USER}', 'Beta chair', 'uploaded',
      1, 1, 1,
      '${ASSET_SHA}', 1200, 'vibode-furniture-assets',
      'users/${USER}/assets/${ASSET}/model.glb'
    )
  `);
  const linked = await call(`
    select public.link_vibode_furniture_generation_saved_asset(
      '${USER}', '${jobId}', '${assetId(ASSET)}', '${OUTPUT_SHA}', 1000, '${ASSET_SHA}', 1200
    )
  `);
  assert.equal(linked.status, "saved");
  const again = await call(`
    select public.link_vibode_furniture_generation_saved_asset(
      '${USER}', '${jobId}', '${assetId(ASSET)}', '${OUTPUT_SHA}', 1000, '${ASSET_SHA}', 1200
    )
  `);
  assert.equal(again.idempotent, true);
}

async function parkUnsettled(jobId: string): Promise<void> {
  await psql(`
    update public.vibode_furniture_generation_jobs
    set status = 'failed'
    where job_id = '${jobId}';
    update public.vibode_furniture_generation_controls
    set credits_reserved = 0, paid_submissions_used = 0
    where control_id = 'global';
  `);
}

async function insertAgedReservation(jobId: string, userId: string, key: string, allowance: "reserved" | null): Promise<void> {
  const allowanceSql = allowance == null ? "null" : `'${allowance}'`;
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, quota_state, allowance_state,
      reserved_credits, created_at
    ) values (
      '${jobId}', '${userId}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', 'reserved', 'reserved', ${allowanceSql},
      30, now() - interval '25 hours'
    )
  `);
}

async function insertPlainReserved(jobId: string, userId: string, key: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, quota_state,
      reserved_credits
    ) values (
      '${jobId}', '${userId}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', 'reserved', 'reserved',
      30
    )
  `);
}

async function insertRunnableLegacy(): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, provider_task_id, provider_contacted_at,
      status, quota_state, reserved_credits, claim_nonce, claim_expires_at
    ) values (
      '${LEGACY_RUN}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'legacy-running-key', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${LEGACY_RUN}', 'task-legacy-run', now(),
      'running', 'reserved', 30, '12121212-1212-4121-8121-121212121212', now() + interval '5 minutes'
    )
  `);
}

async function insertLegacy(
  jobId: string,
  key: string,
  status: string,
  quota: string,
  consumed: number,
  saved: string | null,
): Promise<void> {
  const savedSql = saved == null ? "null" : `'${saved}'`;
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, quota_state,
      reserved_credits, consumed_credits, saved_asset_id
    ) values (
      '${jobId}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', '${status}', '${quota}',
      30, ${consumed}, ${savedSql}
    )
  `);
}

function reserveSql(userId: string, jobId: string, key: string): string {
  return `
    select public.reserve_vibode_furniture_generation(
      '${userId}', '${jobId}', '${key}', '${SHA}',
      'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front']::text[], 30
    )
  `;
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

async function balance(userId = USER): Promise<string> {
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

async function countReservedJobs(userId: string): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs
    where user_id = '${userId}' and allowance_state = 'reserved'
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

async function activeJobs(): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'ready', 'needs_review')
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
      || '|' || updated_at::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function activeIndex(): Promise<string> {
  return psql(`
    select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'vibode_furniture_generation_jobs_one_active_uidx'
  `);
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 400)}`);
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
