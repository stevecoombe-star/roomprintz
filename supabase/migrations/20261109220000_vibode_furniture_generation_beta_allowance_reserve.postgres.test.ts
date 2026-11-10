/**
 * MESHY-1D.2B allowance reservation on disposable Postgres 16.
 * Docker is required. Migrations run from the certified baseline through
 * the allowance schema, and only then is the reservation migration applied.
 * This test does not connect to hosted Supabase and does not call Meshy.
 *
 * Historical generation tests apply their own earlier migration files and
 * therefore still exercise the pre-reservation function. They are not
 * retargeted at this function.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d2b-pg";
const DATABASE = "furniture1d2b";
const MIGRATION = "supabase/migrations/20261109220000_vibode_furniture_generation_beta_allowance_reserve.sql";
const BASELINE = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
  "supabase/migrations/20261109210000_vibode_furniture_generation_beta_allowances.sql",
];
const LEGACY = "11111111-1111-4111-8111-111111111111";
const NONE = "22222222-2222-4222-8222-222222222222";
const OFF = "33333333-3333-4333-8333-333333333333";
const ZERO = "44444444-4444-4444-8444-444444444444";
const FULL = "55555555-5555-4555-8555-555555555555";
const BAD = "66666666-6666-4666-8666-666666666666";
const OK = "77777777-7777-4777-8777-777777777777";
const THIN = "88888888-8888-4888-8888-888888888888";
const RACE_A = "99999999-9999-4999-8999-999999999991";
const RACE_B = "99999999-9999-4999-8999-999999999992";
const ROLL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_SAVED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const JOB_FAILED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const JOB_OK = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const JOB_THIN_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const JOB_THIN_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const JOB_RACE_A = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const JOB_RACE_B = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const JOB_ROLL = "12121212-1212-4121-8121-121212121212";
const SHA = "ab".repeat(32);
const SHA_OTHER = "cd".repeat(32);
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

test("beta reservation holds one allowance and the provider credits atomically", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions|set\s+credits_consumed/i);
  assert.match(migration, /credits_reserved = credits_reserved \+ v_credits/);
  assert.match(migration, /allowance_state/);
  assert.match(migration, /'allowance_required'/);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY|msy_/);
  assert.doesNotMatch(migration, /update public\.vibode_furniture_generation_allowance_events/i);
  assert.doesNotMatch(migration, /delete from public\.vibode_furniture_generation_allowance_events/i);

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
        ('${LEGACY}'), ('${NONE}'), ('${OFF}'), ('${ZERO}'), ('${FULL}'),
        ('${BAD}'), ('${OK}'), ('${THIN}'), ('${RACE_A}'), ('${RACE_B}'),
        ('${ROLL}'), ('${ADMIN}');
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
        id text primary key,
        name text,
        public boolean,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text,
        name text
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of BASELINE) {
      await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    }
    await insertLegacyJob(JOB_SAVED, LEGACY, "legacy-saved-key", "saved", "reconciled", 30, assetId(JOB_SAVED));
    await insertLegacyJob(JOB_FAILED, LEGACY, "legacy-failed-key", "failed", "released", 0, null);
    const controlsBefore = await controlFingerprint();
    const controlShapeBefore = await controlShape();
    const activeIndexBefore = await activeIndex();

    await psql(migration);

    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await controlShape(), controlShapeBefore);
    assert.equal(await activeIndex(), activeIndexBefore);
    assert.match(activeIndexBefore, /ready/);
    assert.match(activeIndexBefore, /needs_review/);
    assert.equal(await psql(`
      select prosecdef::text
      from pg_proc
      where proname = 'reserve_vibode_furniture_generation'
    `), "true");
    assert.equal(await psql(`
      select has_function_privilege('public', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
        || ':' || has_function_privilege('anon', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
        || ':' || has_function_privilege('authenticated', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
        || ':' || has_function_privilege('service_role', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
    `), "false:false:false:true");
    assert.equal(await jobAllowance(JOB_SAVED), `saved:reconciled:30:${assetId(JOB_SAVED)}:legacy-null`);
    assert.equal(await jobAllowance(JOB_FAILED), "failed:released:0::legacy-null");

    const replay = await reserve({ userId: LEGACY, jobId: JOB_SAVED, key: "legacy-saved-key" });
    assert.equal(replay.ok, true);
    assert.equal(replay.created, false);
    assert.equal(replay.job_id, JOB_SAVED);
    assert.equal(await jobAllowance(JOB_SAVED), `saved:reconciled:30:${assetId(JOB_SAVED)}:legacy-null`);
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal(await credits(), "0|0|0|0|40|1|false");
    const conflict = await reserve({ userId: LEGACY, jobId: JOB_SAVED, key: "legacy-saved-key", hash: SHA_OTHER });
    assert.deepEqual(conflict, { ok: false, code: "idempotency_conflict" });
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal(await jobsFor(LEGACY), "2");

    await psql("update public.vibode_furniture_generation_controls set live_enabled = true where control_id = 'global'");
    await grantAllowance(OFF, false, 3);
    await grantAllowance(ZERO, true, 0);
    await grantAllowance(FULL, true, 1);
    await psql(`
      update public.vibode_furniture_generation_allowances
      set consumed_generations = 1
      where user_id = '${FULL}'
    `);
    await grantAllowance(BAD, true, 5);
    await grantAllowance(OK, true, 3);
    await grantAllowance(THIN, true, 1);
    await grantAllowance(RACE_A, true, 2);
    await grantAllowance(RACE_B, true, 2);
    await grantAllowance(ROLL, true, 1);

    assert.deepEqual(
      await reserve({ userId: NONE, jobId: "22222222-2222-4222-8222-222222222221", key: "none-user-key" }),
      { ok: false, code: "allowance_required" },
    );
    assert.deepEqual(
      await reserve({ userId: LEGACY, jobId: "11111111-1111-4111-8111-111111111112", key: "legacy-new-key" }),
      { ok: false, code: "allowance_required" },
    );
    assert.deepEqual(
      await reserve({ userId: OFF, jobId: "33333333-3333-4333-8333-333333333331", key: "disabled-user-key" }),
      { ok: false, code: "allowance_disabled" },
    );
    assert.deepEqual(
      await reserve({ userId: ZERO, jobId: "44444444-4444-4444-8444-444444444441", key: "zero-authorized-key" }),
      { ok: false, code: "allowance_exhausted" },
    );
    assert.deepEqual(
      await reserve({ userId: FULL, jobId: "55555555-5555-4555-8555-555555555551", key: "fully-consumed-key" }),
      { ok: false, code: "allowance_exhausted" },
    );
    assert.equal(await credits(), "0|0|0|0|40|1|true");
    assert.equal(await eventsFor(NONE), "0");
    assert.equal(await eventsFor(OFF), "0");
    assert.equal(await eventsFor(ZERO), "0");
    assert.equal(await eventsFor(FULL), "0");
    assert.equal(await jobsFor(NONE), "0");
    assert.equal(await allowanceOf(OFF), "false|3|0|0|" + ADMIN);
    assert.equal(await allowanceOf(FULL), "true|1|0|1|" + ADMIN);

    const rejected: Array<{ key: string; settings?: string; operation?: string; slots?: string; credits?: number }> = [
      { key: "bad-mesh-only", settings: settings({ shouldTexture: false }) },
      { key: "bad-texture-4k", settings: settings({ textureResolution: "4k" }) },
      { key: "bad-geometry-2k", settings: settings({ geometryResolution: "2k" }) },
      { key: "bad-texture-model", settings: settings({ textureModel: "meshy-7" }) },
      { key: "bad-texture-prompt", settings: settings({ texturePrompt: " " }) },
      { key: "bad-polycount", settings: settings({ targetPolycount: 30001 }) },
      { key: "bad-extra-key", settings: settings({}, { note: true }) },
      { key: "bad-client-credits", credits: 20 },
      { key: "bad-client-credits-high", credits: 40 },
      {
        key: "bad-multi-photo",
        operation: "multi-image-to-3d",
        slots: "array['front','left','back','right']::text[]",
      },
    ];
    for (const [index, attempt] of rejected.entries()) {
      const result = await reserve({
        userId: BAD,
        jobId: `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`,
        key: attempt.key,
        settings: attempt.settings,
        operation: attempt.operation,
        slots: attempt.slots,
        credits: attempt.credits,
      });
      assert.deepEqual(result, { ok: false, code: "unsupported_settings" });
    }
    assert.equal(await allowanceOf(BAD), "true|5|0|0|" + ADMIN);
    assert.equal(await eventsFor(BAD), "0");
    assert.equal(await jobsFor(BAD), "0");
    assert.equal(await credits(), "0|0|0|0|40|1|true");

    const created = await reserve({ userId: OK, jobId: JOB_OK, key: "ok-user-first" });
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.job_id, JOB_OK);
    assert.equal(created.reserved_credits, 30);
    assert.equal(await jobAllowance(JOB_OK), "reserved:reserved:::reserved");
    assert.equal(await allowanceOf(OK), "true|3|1|0|null");
    assert.equal(await credits(), "30|0|0|0|40|1|true");
    assert.equal(await eventRow(JOB_OK), `system|null|reserve|0|1|0|${JOB_OK}|Beta generation reserved`);
    assert.equal(await eventsFor(OK), "1");

    const same = await reserve({ userId: OK, jobId: "77777777-7777-4777-8777-777777777771", key: "ok-user-first" });
    assert.equal(same.ok, true);
    assert.equal(same.created, false);
    assert.equal(same.job_id, JOB_OK);
    assert.equal(await allowanceOf(OK), "true|3|1|0|null");
    assert.equal(await eventsFor(OK), "1");
    assert.equal(await credits(), "30|0|0|0|40|1|true");
    assert.deepEqual(
      await reserve({ userId: OK, jobId: JOB_OK, key: "ok-user-first", hash: SHA_OTHER }),
      { ok: false, code: "idempotency_conflict" },
    );
    assert.equal(await eventsFor(OK), "1");

    await psql(`update public.vibode_furniture_generation_allowances set enabled = false where user_id = '${OK}'`);
    const replayDisabled = await reserve({ userId: OK, jobId: JOB_OK, key: "ok-user-first" });
    assert.equal(replayDisabled.created, false);
    assert.equal(replayDisabled.job_id, JOB_OK);
    assert.deepEqual(
      await reserve({ userId: OK, jobId: "77777777-7777-4777-8777-777777777772", key: "ok-user-while-disabled" }),
      { ok: false, code: "allowance_disabled" },
    );
    assert.equal(await eventsFor(OK), "1");
    assert.equal(await credits(), "30|0|0|0|40|1|true");

    await psql(`
      update public.vibode_furniture_generation_allowances
      set enabled = true, authorized_generations = reserved_generations
      where user_id = '${OK}'
    `);
    const replayExhausted = await reserve({ userId: OK, jobId: JOB_OK, key: "ok-user-first" });
    assert.equal(replayExhausted.created, false);
    assert.equal(replayExhausted.job_id, JOB_OK);
    assert.deepEqual(
      await reserve({ userId: OK, jobId: "77777777-7777-4777-8777-777777777773", key: "ok-user-while-exhausted" }),
      { ok: false, code: "allowance_exhausted" },
    );
    assert.equal(await allowanceOf(OK), "true|1|1|0|null");
    assert.equal(await eventsFor(OK), "1");
    assert.equal(await jobsFor(OK), "1");

    await releaseProviderHoldOnly(OK, JOB_OK);
    assert.equal(await jobAllowance(JOB_OK), "failed:released:0::reserved");
    assert.equal(await allowanceOf(OK), "true|1|1|0|null");
    assert.equal(await eventsFor(OK), "1");
    assert.equal(await credits(), "0|0|0|0|40|1|true");

    const thin = await Promise.all([
      reserveResult({ userId: THIN, jobId: JOB_THIN_A, key: "thin-user-first" }),
      reserveResult({ userId: THIN, jobId: JOB_THIN_B, key: "thin-user-second" }),
    ]);
    assert.deepEqual(thin.map((item) => item.code).sort(), [0, 0]);
    const thinBodies = thin.map((item) => JSON.parse(item.stdout) as { ok: boolean; created?: boolean; code?: string; job_id?: string });
    const thinWins = thinBodies.filter((item) => item.ok === true && item.created === true);
    const thinLosses = thinBodies.filter((item) => item.ok === false);
    assert.equal(thinWins.length, 1);
    assert.equal(thinLosses.length, 1);
    assert.equal(thinLosses[0]?.code, "allowance_exhausted");
    assert.equal(await allowanceOf(THIN), "true|1|1|0|null");
    assert.equal(await eventsFor(THIN), "1");
    assert.equal(await jobsFor(THIN), "1");
    assert.equal(await credits(), "30|0|0|0|40|1|true");
    const thinWinner = thinWins[0]?.job_id;
    assert.equal(thinWinner === JOB_THIN_A || thinWinner === JOB_THIN_B, true);
    await releaseProviderHoldOnly(THIN, String(thinWinner));
    assert.equal(await allowanceOf(THIN), "true|1|1|0|null");
    assert.equal(await credits(), "0|0|0|0|40|1|true");

    const race = await Promise.all([
      reserveResult({ userId: RACE_A, jobId: JOB_RACE_A, key: "race-user-a-key" }),
      reserveResult({ userId: RACE_B, jobId: JOB_RACE_B, key: "race-user-b-key" }),
    ]);
    assert.deepEqual(race.map((item) => item.code).sort(), [0, 0]);
    const raceBodies = race.map((item) => JSON.parse(item.stdout) as { ok: boolean; created?: boolean; code?: string; job_id?: string });
    const raceWins = raceBodies.filter((item) => item.ok === true && item.created === true);
    const raceLosses = raceBodies.filter((item) => item.ok === false);
    assert.equal(raceWins.length, 1);
    assert.equal(raceLosses.length, 1);
    assert.equal(raceLosses[0]?.code, "concurrency_limited");
    assert.equal(await credits(), "30|0|0|0|40|1|true");
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowance_events
      where user_id in ('${RACE_A}', '${RACE_B}')
    `), "1");
    const raceWinner = String(raceWins[0]?.job_id);
    const raceLoser = raceWinner === JOB_RACE_A ? RACE_B : RACE_A;
    const raceWinnerUser = raceWinner === JOB_RACE_A ? RACE_A : RACE_B;
    assert.equal(await allowanceOf(raceWinnerUser), "true|2|1|0|null");
    assert.equal(await allowanceOf(raceLoser), "true|2|0|0|" + ADMIN);
    assert.equal(await jobsFor(raceLoser), "0");
    await releaseProviderHoldOnly(raceWinnerUser, raceWinner);
    assert.equal(await allowanceOf(raceWinnerUser), "true|2|1|0|null");
    assert.equal(await credits(), "0|0|0|0|40|1|true");

    await psql(`
      create or replace function public.test_1d2b_fail_allowance_event()
      returns trigger language plpgsql as $fn$
      begin
        raise exception 'TEST_ALLOWANCE_EVENT_INSERT_FAILED';
      end;
      $fn$;
      create trigger test_1d2b_fail_allowance_event
      before insert on public.vibode_furniture_generation_allowance_events
      for each row execute function public.test_1d2b_fail_allowance_event();
    `);
    const rolledBack = await reserveResult({ userId: ROLL, jobId: JOB_ROLL, key: "rollback-user-key" });
    assert.notEqual(rolledBack.code, 0);
    assert.match(rolledBack.stderr, /TEST_ALLOWANCE_EVENT_INSERT_FAILED/);
    assert.equal(await allowanceOf(ROLL), "true|1|0|0|" + ADMIN);
    assert.equal(await eventsFor(ROLL), "0");
    assert.equal(await jobsFor(ROLL), "0");
    assert.equal(await credits(), "0|0|0|0|40|1|true");
    await psql(`
      drop trigger test_1d2b_fail_allowance_event on public.vibode_furniture_generation_allowance_events;
      drop function public.test_1d2b_fail_allowance_event();
    `);
    const afterRollback = await reserve({ userId: ROLL, jobId: JOB_ROLL, key: "rollback-user-key" });
    assert.equal(afterRollback.created, true);
    assert.equal(await allowanceOf(ROLL), "true|1|1|0|null");
    assert.equal(await eventsFor(ROLL), "1");
    await releaseProviderHoldOnly(ROLL, JOB_ROLL);
    assert.equal(await allowanceOf(ROLL), "true|1|1|0|null");
    assert.equal(await jobAllowance(JOB_ROLL), "failed:released:0::reserved");

    assert.equal(await jobAllowance(JOB_SAVED), `saved:reconciled:30:${assetId(JOB_SAVED)}:legacy-null`);
    assert.equal(await jobAllowance(JOB_FAILED), "failed:released:0::legacy-null");
    assert.equal(await eventsFor(LEGACY), "0");
    assert.equal(await credits(), "0|0|0|0|40|1|true");
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_jobs
      where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'ready', 'needs_review')
    `), "0");
    assert.equal(await controlShape(), controlShapeBefore);
    assert.equal(await activeIndex(), activeIndexBefore);
    assert.equal(await psql(`
      select max_concurrent::text || '|' || credit_ceiling::text
        || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
        || '|' || credits_consumed::text
      from public.vibode_furniture_generation_controls
      where control_id = 'global'
    `), "1|40|0|0|0");
  } finally {
    await removeContainer();
  }
});

function assetId(uuid: string): string {
  return `vibode-furniture/personal/${uuid}`;
}

function settings(overrides: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...JSON.parse(SETTINGS) as Record<string, unknown>, ...overrides, ...extra });
}

async function grantAllowance(userId: string, enabled: boolean, authorized: number): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_allowances (
      user_id, classification, enabled, authorized_generations,
      reserved_generations, consumed_generations, updated_by
    ) values (
      '${userId}', 'individual_beta', ${enabled ? "true" : "false"}, ${authorized}, 0, 0, '${ADMIN}'
    )
  `);
}

async function reserve(input: ReserveInput): Promise<Record<string, unknown>> {
  const result = await reserveResult(input);
  if (result.code !== 0) throw new Error(`reserve failed\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function reserveSql(input: ReserveInput): string {
  return `
    select public.reserve_vibode_furniture_generation(
      '${input.userId}',
      '${input.jobId}',
      '${input.key}',
      '${input.hash ?? SHA}',
      '${input.operation ?? "image-to-3d"}',
      'meshy-7.1',
      '${input.settings ?? SETTINGS}'::jsonb,
      ${input.slots ?? "array['front']::text[]"},
      ${input.credits ?? 30}
    )::text
  `;
}

type ReserveInput = {
  userId: string;
  jobId: string;
  key: string;
  hash?: string;
  settings?: string;
  operation?: string;
  slots?: string;
  credits?: number;
};

async function releaseProviderHoldOnly(userId: string, jobId: string): Promise<void> {
  assert.equal(await psql(`
    select public.fail_vibode_furniture_generation_before_provider('${userId}', '${jobId}')->>'status'
  `), "failed");
}

async function insertLegacyJob(
  jobId: string,
  userId: string,
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
      '${jobId}', '${userId}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', '${status}', '${quota}',
      30, ${consumed}, ${savedSql}
    )
  `);
}

async function jobAllowance(jobId: string): Promise<string> {
  return psql(`
    select status || ':' || quota_state || ':' || coalesce(consumed_credits::text, '')
      || ':' || coalesce(saved_asset_id, '') || ':' || coalesce(allowance_state, 'legacy-null')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function allowanceOf(userId: string): Promise<string> {
  return psql(`
    select enabled::text || '|' || authorized_generations::text || '|' || reserved_generations::text
      || '|' || consumed_generations::text || '|' || coalesce(updated_by::text, 'null')
    from public.vibode_furniture_generation_allowances
    where user_id = '${userId}'
  `);
}

async function eventsFor(userId: string): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_allowance_events
    where user_id = '${userId}'
  `);
}

async function eventRow(jobId: string): Promise<string> {
  return psql(`
    select actor_kind || '|' || coalesce(actor_user_id::text, 'null') || '|' || action
      || '|' || delta_authorized::text || '|' || delta_reserved::text || '|' || delta_consumed::text
      || '|' || job_id::text || '|' || reason
    from public.vibode_furniture_generation_allowance_events
    where job_id = '${jobId}'
  `);
}

async function jobsFor(userId: string): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs where user_id = '${userId}'
  `);
}

async function credits(): Promise<string> {
  return psql(`
    select credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
      || '|' || credit_ceiling::text || '|' || max_concurrent::text || '|' || live_enabled::text
    from public.vibode_furniture_generation_controls
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

async function controlShape(): Promise<string> {
  const triggers = await psql(`
    select coalesce(string_agg(pg_get_triggerdef(t.oid), E'\\n' order by t.tgname), '')
    from pg_trigger t
    where t.tgrelid = 'public.vibode_furniture_generation_controls'::regclass
      and not t.tgisinternal
  `);
  const indexes = await psql(`
    select coalesce(string_agg(indexdef, E'\\n' order by indexname), '')
    from pg_indexes
    where schemaname = 'public'
      and tablename in (
        'vibode_furniture_generation_controls',
        'vibode_furniture_generation_jobs'
      )
  `);
  return `${triggers}\n${indexes}`;
}

async function activeIndex(): Promise<string> {
  return psql(`
    select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'vibode_furniture_generation_jobs_one_active_uidx'
  `);
}

async function psql(sql: string): Promise<string> {
  const result = await reserveResultSql(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function reserveResult(input: ReserveInput): Promise<CommandResult> {
  return reserveResultSql(reserveSql(input));
}

function reserveResultSql(sql: string): Promise<CommandResult> {
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
