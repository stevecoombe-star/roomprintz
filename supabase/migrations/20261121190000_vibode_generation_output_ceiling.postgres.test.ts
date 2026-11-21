/**
 * MESHY-2B output ceiling on disposable Postgres 16.
 * No provider call is made and no hosted database is changed.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-meshy-2b-pg";
const DATABASE = "furniture2b";
const MIGRATION = "supabase/migrations/20261121190000_vibode_generation_output_ceiling.sql";
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
  "supabase/migrations/20261114200000_vibode_furniture_generation_persistent_beta.sql",
  "supabase/migrations/20261114220000_vibode_furniture_generation_admin_identity.sql",
];
const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TASK = "01a1ff6b-462e-72f4-9c6e-78b2107ff038";
const SHA = "ab".repeat(32);
const OUTPUT_SHA = "cd".repeat(32);
const CLAIM = "12121212-1212-4121-8121-121212121212";

test("a succeeded oversized model stays reserved and can be stored without another charge", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /104857600/);
  assert.doesNotMatch(migration, /update public\.vibode_furniture_generation_controls/i);
  assert.doesNotMatch(migration, /paid_submissions_used/);
  assert.doesNotMatch(migration, /vibode-photo-preparations|vibode-furniture-generation-inputs/);
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
      insert into auth.users (id, email) values ('${USER}', 'tester@example.com');
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
    const ceilingAt = BASELINE.findIndex((file) => file.endsWith("20261113210000_vibode_furniture_generation_beta_ceiling.sql"));
    for (const file of BASELINE.slice(0, ceilingAt)) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 30,
        paid_submissions_authorized = 1,
        paid_submissions_used = 1
      where control_id = 'global'
    `);
    for (const file of BASELINE.slice(ceilingAt)) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await psql("select file_size_limit::text from storage.buckets where id = 'vibode-furniture-assets'"), "104857600");
    assert.match(await psql(`
      select pg_get_constraintdef(oid) from pg_constraint
      where conname = 'vibode_furniture_generation_jobs_output_size'
    `), /104857600/);

    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations, reserved_generations, consumed_generations
      ) values ('${USER}', 'individual_beta', true, 1, 1, 0);
    `);
    await insertIngesting(JOB, CLAIM);
    const failed = await call(`
      select public.fail_vibode_furniture_generation_output(
        '${USER}', '${JOB}', '${CLAIM}', 'oversized_output'
      )
    `);
    assert.equal(failed.status, "needs_review");
    assert.equal(await jobState(JOB), `needs_review|reconciled|reserved|30|1|${TASK}|oversized_output`);
    assert.equal(await allowanceState(), "1|1|0");
    assert.equal((await call("select public.claim_next_vibode_furniture_generation(true)")).outcome, "idle");

    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'failed', allowance_state = 'released'
      where job_id = '${JOB}';
      update public.vibode_furniture_generation_allowances
      set reserved_generations = 0, authorized_generations = 0
      where user_id = '${USER}';
    `);
    const blocked = await call(`select public.reopen_vibode_furniture_generation_succeeded_output('${JOB}')`);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "allowance_exhausted");
    assert.equal((await jobState(JOB)).startsWith("failed|"), true);

    await psql(`
      update public.vibode_furniture_generation_allowances
      set authorized_generations = 2
      where user_id = '${USER}'
    `);
    const reopened = await call(`select public.reopen_vibode_furniture_generation_succeeded_output('${JOB}')`);
    assert.equal(reopened.status, "ingesting");
    assert.equal(reopened.idempotent, false);
    assert.equal(reopened.provider_task_id, TASK);
    assert.equal(reopened.consumed_credits, 30);
    assert.equal(reopened.attempt_count, 1);
    assert.equal(await allowanceState(), "2|1|0");
    const again = await call(`select public.reopen_vibode_furniture_generation_succeeded_output('${JOB}')`);
    assert.equal(again.idempotent, true);
    assert.equal(await allowanceState(), "2|1|0");

    const claimed = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(claimed.outcome, "claimed");
    assert.equal(claimed.provider_task_id, TASK);
    const tooBig = await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${JOB}', '${claimed.claim_nonce}', 104857601, '${OUTPUT_SHA}'
      )
    `);
    assert.equal(tooBig.ok, false);
    const recorded = await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${JOB}', '${claimed.claim_nonce}', 70297756, '${OUTPUT_SHA}'
      )
    `);
    assert.equal(recorded.status, "ready");
    assert.equal(await jobState(JOB), `ready|reconciled|consumed|30|1|${TASK}|`);
    assert.equal(await allowanceState(), "2|0|1");
    assert.equal(await psql("select credits_consumed::text from public.vibode_furniture_generation_controls where control_id = 'global'"), "30");
    assert.equal(await psql("select paid_submissions_used::text from public.vibode_furniture_generation_controls where control_id = 'global'"), "1");

    const retryJob = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    const retryClaim = "13131313-1313-4131-8131-131313131313";
    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, provider_task_id, provider_status,
        provider_contacted_at, status, quota_state, allowance_state, reserved_credits,
        consumed_credits, attempt_count, claim_nonce, claim_expires_at
      ) values (
        '${retryJob}', '${USER}', 'meshy-7.1', 'image-to-3d', 'retry-key-0001', '${SHA}',
        '{}'::jsonb, array['front']::text[], 'vibode-${retryJob}', 'task-retry-output-0001', 'SUCCEEDED',
        now(), 'ingesting', 'reconciled', 'reserved', 30,
        30, 1, '${retryClaim}', now() + interval '5 minutes'
      )
    `);
    let nonce = retryClaim;
    for (const reason of ["download", "storage", "download"]) {
      const started = await call(`
        select public.begin_vibode_furniture_generation_output_attempt('${USER}', '${retryJob}', '${nonce}')
      `);
      assert.equal(started.proceed, true);
      const deferred = await call(`
        select public.defer_vibode_furniture_generation_output('${USER}', '${retryJob}', '${nonce}', '${reason}')
      `);
      if (reason === "download" && nonce !== retryClaim) {
        assert.equal(deferred.status, "needs_review");
      } else {
        assert.equal(deferred.status, "ingesting");
        const claimed = await call("select public.claim_next_vibode_furniture_generation(true)");
        assert.equal(claimed.outcome, "claimed");
        assert.equal(typeof claimed.claim_nonce, "string");
        nonce = String(claimed.claim_nonce);
      }
    }
    assert.equal(await jobState(retryJob), `needs_review|reconciled|reserved|30|1|task-retry-output-0001|ingest_failed`);
    assert.equal(await psql(`select output_attempt_count::text from public.vibode_furniture_generation_jobs where job_id = '${retryJob}'`), "3");
    assert.equal(await psql(`select error_code from public.vibode_furniture_generation_jobs where job_id = '${retryJob}'`), "download");
    const recent = await psql(`
      select job->>'error_class'
      from jsonb_array_elements(
        (public.read_vibode_furniture_generation_owner_recent('${USER}')->'jobs')
      ) job
      where job->>'job_id' = '${retryJob}'
    `);
    assert.equal(recent, "download_failed");
    assert.equal((await call("select public.claim_next_vibode_furniture_generation(true)")).outcome, "idle");
    const recovered = await call(`select public.reopen_vibode_furniture_generation_succeeded_output('${retryJob}')`);
    assert.equal(recovered.status, "ingesting");
    assert.equal(recovered.idempotent, false);
    assert.equal(recovered.consumed_credits, 30);
    assert.equal(recovered.attempt_count, 1);
    assert.equal(await psql(`select output_attempt_count::text from public.vibode_furniture_generation_jobs where job_id = '${retryJob}'`), "0");
    const repeated = await call(`select public.reopen_vibode_furniture_generation_succeeded_output('${retryJob}')`);
    assert.equal(repeated.idempotent, true);
    assert.equal(await allowanceState(), "2|0|1");
    assert.equal(await psql("select credits_consumed::text || '|' || paid_submissions_used::text from public.vibode_furniture_generation_controls where control_id = 'global'"), "30|1");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'discarded', error_class = 'discarded', claim_nonce = null, claim_expires_at = null
      where job_id = '${retryJob}'
    `);

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, provider_task_id, provider_status,
        provider_contacted_at, status, quota_state, allowance_state, reserved_credits,
        consumed_credits, error_class, attempt_count
      ) values (
        '${REVIEW}', '${USER}', 'meshy-7.1', 'image-to-3d', 'review-key-0001', '${SHA}',
        '{}'::jsonb, array['front']::text[], 'vibode-${REVIEW}', 'task-review-credit-0001', 'SUCCEEDED',
        now(), 'needs_review', 'reserved', 'reserved', 30,
        null, 'credit_unreported', 1
      )
    `);
    const review = await call("select public.claim_next_vibode_furniture_generation(true)");
    assert.equal(review.outcome, "claimed");
    assert.equal(review.provider_task_id, "task-review-credit-0001");
  } finally {
    await removeContainer();
  }
});

async function insertIngesting(jobId: string, claim: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, provider_task_id, provider_status,
      provider_contacted_at, status, quota_state, allowance_state, reserved_credits,
      consumed_credits, attempt_count, claim_nonce, claim_expires_at
    ) values (
      '${jobId}', '${USER}', 'meshy-7.1', 'image-to-3d', 'incident-key-0001', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', '${TASK}', 'SUCCEEDED',
      now(), 'ingesting', 'reconciled', 'reserved', 30,
      30, 1, '${claim}', now() + interval '5 minutes'
    )
  `);
}

async function jobState(jobId: string): Promise<string> {
  return psql(`
    select status || '|' || quota_state || '|' || coalesce(allowance_state, 'null')
      || '|' || coalesce(consumed_credits::text, 'null')
      || '|' || attempt_count::text
      || '|' || coalesce(provider_task_id, '')
      || '|' || coalesce(error_class, '')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function allowanceState(): Promise<string> {
  return psql(`
    select authorized_generations::text || '|' || reserved_generations::text || '|' || consumed_generations::text
    from public.vibode_furniture_generation_allowances where user_id = '${USER}'
  `);
}

type JsonRow = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  status?: string;
  outcome?: string;
  idempotent?: boolean;
  provider_task_id?: string;
  consumed_credits?: number;
  attempt_count?: number;
  claim_nonce?: string;
};

async function call(sql: string): Promise<JsonRow> {
  return JSON.parse(await psql(`${sql}::text`)) as JsonRow;
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 500)}`);
  return result.stdout.trim();
}

function callResult(sql: string): Promise<{ code: number; stdout: string; stderr: string }> {
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

function docker(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
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
