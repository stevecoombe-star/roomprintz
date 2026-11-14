/**
 * MESHY-1D.5B.2 controlled beta ceiling on disposable Postgres 16.
 * The chain is the hosted generation ledger. No provider call is made.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d5b2-pg";
const DATABASE = "furniture1d5b2";
const MIGRATION = "supabase/migrations/20261113210000_vibode_furniture_generation_beta_ceiling.sql";
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
];
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const THIRD_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TASK = "018a210d-8ba4-705c-b111-1f1776f7f5b2";
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

test("the beta ceiling admits one 30-credit submission and then refuses another", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /credit_ceiling = 60/);
  assert.match(migration, /paid_submissions_authorized = 2/);
  assert.match(migration, /VIBODE_FURNITURE_GENERATION:BASELINE_MISMATCH/);
  assert.match(migration, /disable trigger vibode_furniture_generation_protect_controls/);
  assert.match(migration, /enable trigger vibode_furniture_generation_protect_controls/);
  assert.doesNotMatch(migration, /create or replace function/i);
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credits_consumed|set\s+credits_reserved|set\s+paid_submissions_used|set\s+max_concurrent/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY/);
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
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER}'), ('${OTHER}'), ('${ADMIN}');
      grant usage on schema public to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of BASELINE) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    assert.equal(await fingerprint(), "false|1|40|0|0|0|0");
    const premature = await callResult(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.notEqual(premature.code, 0);
    assert.match(`${premature.stderr}\n${premature.stdout}`, /BASELINE_MISMATCH/);
    assert.equal(await fingerprint(), "false|1|40|0|0|0|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 30,
        paid_submissions_authorized = 1,
        paid_submissions_used = 1
      where control_id = 'global'
    `);
    assert.equal(await fingerprint(), "false|1|40|0|30|1|1");
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await fingerprint(), "false|1|60|0|30|2|1");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_jobs"), "0");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_allowances"), "0");
    const repeated = await callResult(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.notEqual(repeated.code, 0);
    assert.match(`${repeated.stderr}\n${repeated.stdout}`, /BASELINE_MISMATCH/);
    assert.equal(await fingerprint(), "false|1|60|0|30|2|1");
    assert.equal(await psql(`
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'vibode_furniture_generation_controls_ceiling'
    `), "CHECK ((credit_ceiling = 60))");
    assert.equal(await psql(`
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'vibode_furniture_generation_paid_authorized_range'
    `), "CHECK ((paid_submissions_authorized = 2))");
    assert.equal(await psql(`
      select tgenabled::text
      from pg_trigger
      where tgname = 'vibode_furniture_generation_protect_controls'
        and not tgisinternal
    `), "O");
    assert.equal(await psql(`
      select position('paid_submissions_authorized' in prosrc)::text
      from pg_proc
      where proname = 'vibode_furniture_generation_protect_controls'
    `), "0");
    assert.equal(await psql(`
      select has_table_privilege('service_role', 'public.vibode_furniture_generation_controls', 'update')::text
        || has_table_privilege('anon', 'public.vibode_furniture_generation_controls', 'update')::text
        || has_table_privilege('authenticated', 'public.vibode_furniture_generation_controls', 'update')::text
    `), "falsefalsefalse");
    assert.equal(await caughtUpdate("credit_ceiling = 61"), "CONTROLS_LOCKED");
    assert.equal(await caughtUpdate("credit_ceiling = 40"), "CONTROLS_LOCKED");
    assert.equal(await caughtUpdate("max_concurrent = 2"), "CONTROLS_LOCKED");
    assert.equal(await caughtUpdate("paid_submissions_authorized = 3"), "23514");
    assert.equal(await caughtUpdate("paid_submissions_authorized = 1"), "23514");
    assert.equal(await fingerprint(), "false|1|60|0|30|2|1");
    const grant = await call("select public.grant_vibode_furniture_generation_paid_submission(true)");
    assert.equal(grant.ok, false);
    assert.equal(grant.code, "allowance_closed");
    assert.equal(grant.paid_submissions_authorized, 2);
    assert.equal(grant.paid_submissions_used, 1);
    const disabled = await call(reserveSql(USER, JOB, "first-beta-job"));
    assert.equal(disabled.code, "disabled");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_jobs"), "0");

    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations,
        reserved_generations, consumed_generations, updated_by
      ) values
        ('${USER}', 'individual_beta', true, 1, 0, 0, '${ADMIN}'),
        ('${OTHER}', 'individual_beta', true, 1, 0, 0, '${ADMIN}');
      update public.vibode_furniture_generation_controls
      set live_enabled = true
      where control_id = 'global'
    `);
    const reserved = await call(reserveSql(USER, JOB, "first-beta-job"));
    assert.equal(reserved.ok, true);
    assert.equal(reserved.created, true);
    assert.equal(reserved.reserved_credits, 30);
    assert.equal(await fingerprint(), "true|1|60|30|30|2|1");
    const replay = await call(reserveSql(USER, OTHER_JOB, "first-beta-job"));
    assert.equal(replay.ok, true);
    assert.equal(replay.created, false);
    assert.equal(replay.job_id, JOB);
    assert.equal(await fingerprint(), "true|1|60|30|30|2|1");
    const concurrent = await call(reserveSql(OTHER, OTHER_JOB, "other-beta-job"));
    assert.equal(concurrent.code, "concurrency_limited");
    assert.equal(await fingerprint(), "true|1|60|30|30|2|1");
    const oversized = await call(reserveSql(OTHER, OTHER_JOB, "other-beta-job", 31));
    assert.equal(oversized.code, "unsupported_settings");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'needs_review', error_class = 'needs_review'
      where job_id = '${JOB}'
    `);
    const ceiling = await call(reserveSql(OTHER, OTHER_JOB, "other-beta-job"));
    assert.equal(ceiling.code, "quota_exhausted");
    const sameOwner = await call(reserveSql(USER, THIRD_JOB, "third-beta-job"));
    assert.equal(sameOwner.code, "allowance_exhausted");
    assert.equal(await fingerprint(), "true|1|60|30|30|2|1");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'reserved', error_class = null, error_code = null
      where job_id = '${JOB}'
    `);

    const claimed = await call(`select public.claim_vibode_furniture_generation('${USER}', '${JOB}', 'submit')`);
    assert.equal(claimed.ok, true);
    assert.equal(claimed.purpose, "prepare");
    const committed = await call(`
      select public.commit_vibode_furniture_generation_submission('${USER}', '${JOB}', '${claimed.claim_nonce}')
    `);
    assert.equal(committed.ok, true);
    assert.equal(committed.paid_submissions_used, 2);
    assert.equal(await fingerprint(), "true|1|60|30|30|2|2");
    const bound = await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${JOB}', '${committed.claim_nonce}', '${TASK}', 'PENDING'
      )
    `);
    assert.equal(bound.ok, true);
    const follow = await call(`select public.claim_vibode_furniture_generation('${USER}', '${JOB}', 'follow')`);
    assert.equal(follow.ok, true);
    assert.equal(follow.purpose, "poll");
    const observed = await call(`
      select public.apply_vibode_furniture_generation_observation(
        '${USER}', '${JOB}', '${follow.claim_nonce}', 'SUCCEEDED', 100, 30, null
      )
    `);
    assert.equal(observed.ok, true);
    assert.equal(observed.consumed_credits, 30);
    assert.equal(await fingerprint(), "true|1|60|0|60|2|2");
    const saved = await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${JOB}', '${observed.claim_nonce}', 1024, '${SHA}'
      )
    `);
    assert.equal(saved.ok, true);
    assert.equal(saved.status, "ready");
    assert.equal(await psql(`
      select status || '|' || quota_state || '|' || consumed_credits::text || '|' || allowance_state
      from public.vibode_furniture_generation_jobs
      where job_id = '${JOB}'
    `), "ready|reconciled|30|consumed");
    assert.equal(await psql(`
      select reserved_generations::text || '|' || consumed_generations::text
      from public.vibode_furniture_generation_allowances
      where user_id = '${USER}'
    `), "0|1");
    const third = await call(reserveSql(USER, THIRD_JOB, "third-beta-job"));
    assert.equal(third.code, "submission_not_authorized");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_jobs"), "1");
    const closedGrant = await call("select public.grant_vibode_furniture_generation_paid_submission(true)");
    assert.equal(closedGrant.code, "allowance_closed");
    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false
      where control_id = 'global'
    `);
    const afterShutdown = await call(reserveSql(OTHER, OTHER_JOB, "other-beta-job"));
    assert.equal(afterShutdown.code, "disabled");
    assert.equal(await fingerprint(), "false|1|60|0|60|2|2");
  } finally {
    await removeContainer();
  }
});

function reserveSql(userId: string, jobId: string, key: string, credits = 30): string {
  return `select public.reserve_vibode_furniture_generation(
    '${userId}', '${jobId}', '${key}', '${SHA}', 'image-to-3d', 'meshy-7.1',
    '${SETTINGS}'::jsonb, array['front']::text[], ${credits}
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
      when check_violation then
        insert into guard_result values ('23514');
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
  status?: string;
  purpose?: string;
  claim_nonce?: string;
  created?: boolean;
  job_id?: string;
  reserved_credits?: number;
  paid_submissions_authorized?: number;
  paid_submissions_used?: number;
  consumed_credits?: number;
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
