/**
 * Persistent beta budget and claim order on disposable Postgres 16.
 * No provider call is made. The certified ledger is not increased by the migration.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1e-pg";
const DATABASE = "furniture1e";
const MIGRATION = "supabase/migrations/20261114200000_vibode_furniture_generation_persistent_beta.sql";
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
  "supabase/migrations/20261110233000_vibode_furniture_generation_submission_commit.sql",
  "supabase/migrations/20261111003000_vibode_furniture_generation_unreported_credits.sql",
  "supabase/migrations/20261111013000_vibode_furniture_generation_resubmit_budget.sql",
  "supabase/migrations/20261111150000_vibode_furniture_generation_admin_reads.sql",
  "supabase/migrations/20261111170000_vibode_furniture_generation_admin_testers.sql",
  "supabase/migrations/20261111190000_vibode_furniture_generation_cleanup.sql",
  "supabase/migrations/20261111210000_vibode_furniture_generation_owner_allowance.sql",
  "supabase/migrations/20261111220000_vibode_furniture_generation_paid_budget_admission.sql",
  "supabase/migrations/20261112160000_vibode_furniture_generation_owner_recent.sql",
  "supabase/migrations/20261112170000_vibode_furniture_generation_account_deletion_guard.sql",
  "supabase/migrations/20261112180000_vibode_account_deletion_admission.sql",
  "supabase/migrations/20261113210000_vibode_furniture_generation_beta_ceiling.sql",
];
const ADMIN = "55555555-5555-4555-8555-555555555555";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const THIRD_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
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

test("the persistent beta keeps the certified ledger until an administrator raises it", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /credit_ceiling <= 1000000000/);
  assert.match(migration, /paid_submissions_authorized <= 1000000000/);
  assert.doesNotMatch(migration, /credit_ceiling <= 600/);
  assert.doesNotMatch(migration, /paid_submissions_authorized <= 20/);
  assert.doesNotMatch(migration, /update public\.vibode_furniture_generation_controls\s+set credits_consumed|set paid_submissions_used/i);
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key, email text);
      insert into auth.users (id, email) values
        ('${ADMIN}', 'owner@example.com'),
        ('${USER}', 'tester@example.com'),
        ('${OTHER}', 'other@example.com'),
        ('${THIRD}', 'third@example.com');
      create or replace function auth.uid() returns uuid
      language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of BASELINE.slice(0, -1)) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 30,
        paid_submissions_authorized = 1,
        paid_submissions_used = 1
      where control_id = 'global'
    `);
    await psql(readFileSync(path.join(process.cwd(), BASELINE[BASELINE.length - 1]!), "utf8"));
    assert.equal(await fingerprint(), "false|1|60|0|30|2|1");
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 60,
        paid_submissions_used = 2
      where control_id = 'global'
    `);
    assert.equal(await fingerprint(), "false|1|60|0|60|2|2");
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await fingerprint(), "false|1|60|0|60|2|2");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_budget_events"), "0");
    assert.match(await psql(`
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'vibode_furniture_generation_controls_ceiling'
    `), /credit_ceiling <= 1000000000/);
    assert.equal(await caughtUpdate("credit_ceiling = 120"), "CONTROLS_LOCKED");
    assert.equal(await caughtUpdate("live_enabled = true"), "CONTROLS_LOCKED");
    assert.equal(await caughtUpdate("paid_submissions_authorized = 4"), "CONTROLS_LOCKED");
    assert.equal(await fingerprint(), "false|1|60|0|60|2|2");
    assert.equal(await psql(`
      select has_function_privilege('service_role', 'public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text, boolean)', 'execute')::text
    `), "false");
    assert.equal(await psql(`
      select has_table_privilege('service_role', 'public.vibode_furniture_generation_controls', 'update')::text
    `), "false");
    const serviceDenied = await callResult(`
      set role service_role;
      select public.admin_adjust_vibode_furniture_generation_budget(120, 4, true, 'Service role cannot spend', true);
    `);
    assert.notEqual(serviceDenied.code, 0);
    assert.match(serviceDenied.stderr, /permission denied/i);
    const stranger = await call(adjustSql(OTHER, 120, 4, true, "Another account cannot spend"));
    assert.equal(stranger.ok, false);
    assert.equal(stranger.code, "budget_unauthorized");
    const closed = await call(adjustSql(ADMIN, 120, 4, true, "Raise the beta budget before the administrator email is configured", ""));
    assert.equal(closed.code, "budget_unauthorized");
    const lowCeiling = await call(adjustSql(ADMIN, 59, 2, false, "Cannot erase the historical charge"));
    assert.equal(lowCeiling.code, "budget_bounds");
    const highCeiling = await call(adjustSql(ADMIN, 1000000001, 2, false, "Cannot pass the infrastructure boundary"));
    assert.equal(highCeiling.code, "budget_bounds");
    const lowAttempts = await call(adjustSql(ADMIN, 60, 1, false, "Cannot erase a used paid attempt"));
    assert.equal(lowAttempts.code, "budget_bounds");
    const highAttempts = await call(adjustSql(ADMIN, 60, 100, false, "Cannot jump paid attempts in one save"));
    assert.equal(highAttempts.code, "budget_step");
    const wideStep = await call(adjustSql(ADMIN, 20000, 2, false, "Cannot jump the credit ceiling in one save"));
    assert.equal(wideStep.code, "budget_step");
    const unconfirmed = await call(adjustSql(ADMIN, 120, 4, true, "A direct call still needs confirmation", "owner@example.com", false));
    assert.equal(unconfirmed.code, "budget_confirm");
    assert.equal(await fingerprint(), "false|1|60|0|60|2|2");
    const same = await call(adjustSql(ADMIN, 60, 2, false, "Record that the certified ledger stays closed"));
    assert.equal(same.ok, true);
    assert.equal(same.unchanged, true);
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_budget_events"), "0");
    const opened = await call(adjustSql(ADMIN, 120, 4, true, "Authorize eight more credits of headroom for two testers"));
    assert.equal(opened.ok, true);
    assert.equal(opened.unchanged, false);
    assert.equal(opened.credits_consumed, 60);
    assert.equal(opened.paid_submissions_used, 2);
    assert.equal(await fingerprint(), "true|1|120|0|60|4|2");
    assert.equal(await psql(`
      select credit_ceiling_before::text || '|' || credit_ceiling_after::text
        || '|' || paid_submissions_authorized_before::text || '|' || paid_submissions_authorized_after::text
        || '|' || credits_consumed::text || '|' || paid_submissions_used::text
      from public.vibode_furniture_generation_budget_events
    `), "60|120|2|4|60|2");
    const spoofed = await call(`
      alter table auth.users add column if not exists raw_user_meta_data jsonb;
      update auth.users
      set raw_user_meta_data = '{"email":"owner@example.com"}'::jsonb
      where id = '${OTHER}';
      do $session$ begin
        perform set_config('vibode.admin_email', 'owner@example.com', false);
        perform set_config('request.jwt.claim.sub', '${OTHER}', false);
        perform set_config('request.jwt.claim.email', 'owner@example.com', false);
      end $session$;
      set role authenticated;
      select public.admin_adjust_vibode_furniture_generation_budget(300, 10, true, 'A forged email claim cannot spend', true);
    `);
    assert.equal(spoofed.code, "budget_unauthorized");
    const intruder = await callResult(`
      begin;
      create role budget_intruder nologin bypassrls;
      grant usage on schema public to budget_intruder;
      grant select, update on table public.vibode_furniture_generation_controls to budget_intruder;
      set role budget_intruder;
      select set_config('vibode.furniture_budget_adjustment', 'on', true);
      update public.vibode_furniture_generation_controls
      set credit_ceiling = 300
      where control_id = 'global';
      rollback;
    `);
    assert.notEqual(intruder.code, 0);
    assert.match(intruder.stderr, /CONTROLS_LOCKED/);
    const emergency = await callResult(`
      begin;
      select set_config('vibode.furniture_budget_adjustment', 'on', true);
      update public.vibode_furniture_generation_controls
      set live_enabled = false
      where control_id = 'global';
      rollback;
    `);
    assert.equal(emergency.code, 0);
    assert.equal(await fingerprint(), "true|1|120|0|60|4|2");
    const cleared = await callResult(`
      begin;
      do $session$ begin
        perform set_config('vibode.admin_email', 'owner@example.com', true);
        perform set_config('request.jwt.claim.sub', '${ADMIN}', true);
      end $session$;
      set role authenticated;
      select public.admin_adjust_vibode_furniture_generation_budget(90, 4, true, 'Lower the ceiling inside a rolled-back transaction', true);
      select current_setting('vibode.furniture_budget_adjustment', true);
      rollback;
    `);
    assert.equal(cleared.code, 0);
    assert.equal(cleared.stdout.trim().split("\n").filter(Boolean).at(-1), "off");
    assert.equal(await fingerprint(), "true|1|120|0|60|4|2");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_budget_events"), "1");
    const history = await call(readSql(ADMIN));
    assert.equal(history.ok, true);
    const events = history.events as Array<Record<string, unknown>>;
    assert.equal(events[0]?.reason, "Authorize eight more credits of headroom for two testers");
    assert.equal(events[0]?.actor_user_id, ADMIN);
    assert.equal(events[0]?.credits_consumed, 60);
    assert.equal(events[0]?.paid_submissions_used, 2);
    const hiddenHistory = await call(readSql(OTHER));
    assert.equal(hiddenHistory.code, "budget_unauthorized");
    assert.equal(await psql(`
      select has_function_privilege('service_role', 'public.admin_read_vibode_furniture_generation_budget_events(integer)', 'execute')::text
    `), "false");
    assert.equal(await psql(`
      select has_function_privilege('anon', 'public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text, boolean)', 'execute')::text
    `), "false");
    const grant = await call("select public.grant_vibode_furniture_generation_paid_submission(true)");
    assert.equal(grant.code, "allowance_closed");

    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations,
        reserved_generations, consumed_generations, updated_by
      ) values
        ('${USER}', 'individual_beta', true, 1, 0, 0, '${ADMIN}'),
        ('${OTHER}', 'furniture_partner', true, 1, 0, 0, '${ADMIN}'),
        ('${THIRD}', 'individual_beta', true, 1, 0, 0, '${ADMIN}')
    `);
    const first = await call(reserveSql(USER, JOB, "first-beta-job"));
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'needs_review', error_class = 'credit_unreported'
      where job_id = '${JOB}'
    `);
    const second = await call(reserveSql(OTHER, OTHER_JOB, "other-beta-job"));
    assert.equal(second.ok, true);
    assert.equal(second.created, true);
    const blocked = await call(reserveSql(THIRD, THIRD_JOB, "third-beta-job"));
    assert.equal(blocked.code, "concurrency_limited");
    const claimed = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(claimed.outcome, "claimed");
    assert.equal(claimed.job_id, OTHER_JOB);
    assert.equal(await psql(`
      select status from public.vibode_furniture_generation_jobs where job_id = '${JOB}'
    `), "needs_review");
    assert.equal(await fingerprint(), "true|1|120|60|60|4|2");
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - 30,
        credits_consumed = credits_consumed + 35
      where control_id = 'global'
    `);
    assert.equal(await fingerprint(), "true|1|120|30|95|4|2");
    const overCeilingShutdown = await call(adjustSql(
      ADMIN,
      120,
      4,
      false,
      "Turn admission off while settlement exceeds the ceiling",
    ));
    assert.equal(overCeilingShutdown.ok, true);
    assert.equal(overCeilingShutdown.unchanged, false);
    assert.equal(overCeilingShutdown.live_enabled, false);
    assert.equal(overCeilingShutdown.credit_ceiling, 120);
    assert.equal(overCeilingShutdown.credits_consumed, 95);
    assert.equal(overCeilingShutdown.paid_submissions_used, 2);
    assert.equal(await fingerprint(), "false|1|120|30|95|4|2");
    assert.equal(await psql(`
      select live_enabled_before::text || '|' || live_enabled_after::text
        || '|' || credit_ceiling_before::text || '|' || credit_ceiling_after::text
        || '|' || credits_consumed::text || '|' || credits_reserved::text
        || '|' || paid_submissions_used::text
      from public.vibode_furniture_generation_budget_events
      order by created_at desc
      limit 1
    `), "true|false|120|120|95|30|2");
    const stillShort = await call(adjustSql(ADMIN, 124, 4, false, "A lower ceiling still has to cover the exposure"));
    assert.equal(stillShort.code, "budget_bounds");
    assert.equal(await fingerprint(), "false|1|120|30|95|4|2");
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = 60,
        credits_consumed = 60
      where control_id = 'global'
    `);
    const stopped = await call(adjustSql(ADMIN, 120, 4, false, "Stop new reservations and uncontacted submissions"));
    assert.equal(stopped.ok, true);
    assert.equal(await fingerprint(), "false|1|120|60|60|4|2");
    const reservedWhileOff = await call(reserveSql(THIRD, THIRD_JOB, "shutdown-beta-job"));
    assert.equal(reservedWhileOff.code, "disabled");
    const reviewWhileOff = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(reviewWhileOff.outcome, "claimed");
    assert.equal(reviewWhileOff.job_id, JOB);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_nonce = null, claim_expires_at = null
      where job_id = '${OTHER_JOB}'
    `);
    const skipped = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(skipped.outcome, "disabled");
    assert.equal(await psql(`
      select status || '|' || coalesce(provider_contacted_at::text, '')
      from public.vibode_furniture_generation_jobs
      where job_id = '${OTHER_JOB}'
    `), "reserved|");
    const reopened = await call(adjustSql(ADMIN, 120, 4, true, "Lease the reserved job before closing admission again"));
    assert.equal(reopened.ok, true);
    const leased = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(leased.job_id, OTHER_JOB);
    assert.equal(typeof leased.claim_nonce, "string");
    const closedAgain = await call(adjustSql(ADMIN, 120, 4, false, "Close admission before the leased job is submitted"));
    assert.equal(closedAgain.ok, true);
    const blockedCommit = await call(`
      select public.commit_vibode_furniture_generation_submission(
        '${OTHER}', '${OTHER_JOB}', '${String(leased.claim_nonce)}'
      )
    `);
    assert.equal(blockedCommit.code, "disabled");
    assert.equal(await psql(`
      select status || '|' || coalesce(provider_contacted_at::text, '') || '|' || paid_submissions_used::text
      from public.vibode_furniture_generation_jobs as job
      cross join public.vibode_furniture_generation_controls
      where job.job_id = '${OTHER_JOB}'
    `), "reserved||2");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'cancelled', claim_nonce = null, claim_expires_at = null
      where job_id = '${OTHER_JOB}';
      update public.vibode_furniture_generation_jobs
      set status = 'running',
        provider_task_id = 'task-12345678',
        claim_nonce = null,
        claim_expires_at = null
      where job_id = '${JOB}'
    `);
    const polled = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(polled.outcome, "claimed");
    assert.equal(polled.job_id, JOB);
    assert.equal(polled.purpose, "poll");
    assert.equal(await fingerprint(), "false|1|120|60|60|4|2");
    const beforeConcurrent = await fingerprint();
    const hold = psql(`
      begin;
      select pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 30
      where control_id = 'global';
      select pg_sleep(6);
      commit;
    `);
    let lockHeld = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const locks = await psql("select count(*)::text from pg_locks where locktype = 'advisory' and granted");
      if (locks !== "0") {
        lockHeld = true;
        break;
      }
      await delay(100);
    }
    assert.equal(lockHeld, true);
    const waiting = await callResult(`
      set lock_timeout = '250ms';
      ${adjustSql(ADMIN, 150, 4, false, "A budget change waits for the reservation lock")}
    `);
    assert.notEqual(waiting.code, 0);
    assert.match(`${waiting.stderr}\n${waiting.stdout}`, /lock timeout/i);
    await hold;
    assert.equal(await fingerprint(), "false|1|120|90|60|4|2");
    const heldCeiling = await call(adjustSql(ADMIN, 120, 4, false, "Keep the ceiling while the reservation exceeds it"));
    assert.equal(heldCeiling.ok, true);
    assert.equal(heldCeiling.unchanged, true);
    assert.equal(await fingerprint(), "false|1|120|90|60|4|2");
    const covered = await call(adjustSql(ADMIN, 149, 4, false, "A changed ceiling must cover the new reservation"));
    assert.equal(covered.code, "budget_bounds");
    const raised = await call(adjustSql(ADMIN, 150, 4, false, "Cover the reservation that landed during the lock"));
    assert.equal(raised.ok, true);
    assert.equal(raised.credits_consumed, 60);
    assert.equal(await fingerprint(), "false|1|150|90|60|4|2");
    assert.notEqual(await fingerprint(), beforeConcurrent);
  } finally {
    await removeContainer();
  }
});

function adjustSql(actor: string, ceiling: number, authorized: number, live: boolean, reason: string, adminEmail = "owner@example.com", confirmed = true): string {
  return `
    do $session$ begin
      perform set_config('vibode.admin_email', '${adminEmail}', false);
      perform set_config('request.jwt.claim.sub', '${actor}', false);
    end $session$;
    set role authenticated;
    select public.admin_adjust_vibode_furniture_generation_budget(${ceiling}, ${authorized}, ${live}, '${reason}', ${confirmed});
  `;
}

function readSql(actor: string): string {
  return `
    do $session$ begin
      perform set_config('vibode.admin_email', 'owner@example.com', false);
      perform set_config('request.jwt.claim.sub', '${actor}', false);
      perform set_config('request.jwt.claim.email', 'owner@example.com', false);
    end $session$;
    set role authenticated;
    select public.admin_read_vibode_furniture_generation_budget_events(20);
  `;
}

function reserveSql(userId: string, jobId: string, key: string): string {
  return `select public.reserve_vibode_furniture_generation(
    '${userId}', '${jobId}', '${key}', '${SHA}', 'image-to-3d', 'meshy-7.1',
    '${SETTINGS}'::jsonb, array['front']::text[], 30
  )`;
}

async function caughtUpdate(assignment: string): Promise<string> {
  return psql(`
    create temp table guard_result (code text);
    do $guard$
    begin
      update public.vibode_furniture_generation_controls
      set ${assignment}
      where control_id = 'global';
      insert into guard_result values ('updated');
    exception
      when others then
        if sqlerrm like '%CONTROLS_LOCKED%' then
          insert into guard_result values ('CONTROLS_LOCKED');
        else
          raise;
        end if;
    end
    $guard$;
    select code from guard_result;
  `);
}

async function fingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

type JsonRow = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  unchanged?: boolean;
  outcome?: string;
  job_id?: string;
  claim_nonce?: string;
  purpose?: string;
  events?: unknown;
  created?: boolean;
  credits_consumed?: number;
  paid_submissions_used?: number;
};

async function call(sql: string): Promise<JsonRow> {
  return JSON.parse(await psql(sql)) as JsonRow;
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
    "run", "-d", "--name", CONTAINER, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", `POSTGRES_DB=${DATABASE}`, "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    if (`${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete")) {
      const probe = await docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1"]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  throw new Error("disposable postgres 16 did not become ready");
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
