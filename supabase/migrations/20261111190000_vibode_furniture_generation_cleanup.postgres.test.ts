/**
 * MESHY-1D.3C temporary cleanup on disposable Postgres 16.
 * No provider call and no hosted database.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d3c-pg";
const DATABASE = "furniture1d3c";
const MIGRATION = "supabase/migrations/20261111190000_vibode_furniture_generation_cleanup.sql";
const PRIOR = [
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
];

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SHA = "ab".repeat(32);
const ASSET = "99999999-9999-4999-8999-999999999999";
const ASSET_ID = `vibode-furniture/personal/${ASSET}`;
const MISSING_ASSET_ID = "vibode-furniture/personal/88888888-8888-4888-8888-888888888888";
const LIBRARY = `users/${USER}/assets/${ASSET}/model.glb`;

test("temporary cleanup selects only safe objects and leaves spending controls alone", { timeout: 240_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /api\.meshy|MESHY_API_KEY|set\s+live_enabled|set\s+credit_ceiling|set\s+paid_submissions/i);
  assert.match(migration, /needs_review/);
  assert.match(migration, /\/assets\//);
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  const fetches = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetches.count += 1;
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
      create table auth.users (id uuid primary key, email text);
      insert into auth.users (id, email) values
        ('${USER}', 'ada@example.com'),
        ('${OTHER}', 'other@example.com'),
        ('${ADMIN}', 'operator@example.com');
      grant usage on schema public to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of PRIOR) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    const before = await spendingFingerprint();
    await psql(`alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, public;`);
    await psql(migration);
    assert.equal(await spendingFingerprint(), before);
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.equal(await privilege("anon", "list_vibode_furniture_generation_temporary_objects(integer)"), "false");
    assert.equal(await privilege("authenticated", "mark_vibode_furniture_generation_temporary_object_purged(text,uuid,text)"), "false");
    assert.equal(await privilege("service_role", "list_vibode_furniture_generation_temporary_objects(integer)"), "true");
    assert.equal(await privilege("service_role", "mark_vibode_furniture_generation_temporary_object_purged(text,uuid,text)"), "true");
    assert.equal(await privilege("service_role", "vibode_furniture_generation_candidate_purgeable(vibode_furniture_generation_jobs)"), "false");

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, quota_state, reserved_credits, created_at
      )
      select
        ('00000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
        '${USER}', 'meshy-7.1', 'image-to-3d', 'cleanup-batch-' || lpad(n::text, 2, '0'), '${SHA}',
        '{}'::jsonb, array['front']::text[],
        'vibode-' || ('00000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0')),
        'failed', 'released', 30, now()
      from generate_series(1, 51) as n;
      insert into public.vibode_furniture_generation_inputs (
        job_id, user_id, slot, ordinal, storage_bucket, storage_object_path,
        sha256, byte_size, mime_type, width_px, height_px, expires_at
      )
      select
        job_id, user_id, 'front', 0, 'vibode-furniture-generation-inputs',
        'users/' || user_id::text || '/inputs/' || job_id::text || '/front.jpg',
        '${SHA}', 32, 'image/jpeg', 32, 32, now() - interval '1 hour'
      from public.vibode_furniture_generation_jobs
      where idempotency_key like 'cleanup-batch-%';
    `);
    const bounded = await readJson("select public.list_vibode_furniture_generation_temporary_objects(100)");
    assert.equal(records(bounded.objects).length, 50);
    assert.equal(bounded.retained_for_review, 0);
    assert.equal(records(bounded.objects).every((item) => String(item.path).startsWith(`users/${USER}/`)), true);
    assert.equal(records(bounded.objects).some((item) => String(item.path).includes("/assets/")), false);
    await psql(`
      delete from public.vibode_furniture_generation_jobs
      where idempotency_key like 'cleanup-batch-%'
    `);

    const reserved = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const review = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const ready = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    const discarded = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
    const saved = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
    const unsaved = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
    await insertJob(reserved, USER, "active-input-key", "reserved", null);
    await insertInput(reserved, USER, "now() - interval '2 hours'");
    await insertJob(review, OTHER, "review-input-key", "needs_review", null);
    await insertInput(review, OTHER, "now() - interval '2 hours'");
    await insertJob(ready, USER, "fresh-ready-key", "ready", candidate(USER, ready));
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_bucket = 'vibode-furniture-assets',
        output_sha256 = '${SHA}',
        output_byte_size = 32,
        output_expires_at = now() + interval '2 days'
      where job_id = '${ready}'
    `);
    await insertInput(ready, USER, "now() + interval '2 hours'");
    const retained = await readJson("select public.list_vibode_furniture_generation_temporary_objects(50)");
    const retainedPaths = records(retained.objects).map((item) => String(item.path));
    assert.equal(retainedPaths.some((item) => item.includes(reserved)), false);
    assert.equal(retainedPaths.some((item) => item.includes(review)), false);
    assert.equal(retainedPaths.some((item) => item.includes(ready)), false);
    assert.equal(retained.retained_for_review, 1);
    assert.equal((await readJson(`
      select public.mark_vibode_furniture_generation_temporary_object_purged('input', '${review}', 'front')
    `)).code, "not_found");
    assert.equal(await psql(`select (purged_at is null)::text from public.vibode_furniture_generation_inputs where job_id = '${reserved}'`), "true");

    await insertJob(discarded, USER, "discarded-candidate-key", "discarded", candidate(USER, discarded), null);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_bucket = 'vibode-furniture-assets', output_sha256 = '${SHA}', output_byte_size = 32
      where job_id = '${discarded}'
    `);
    await insertJob(unsaved, USER, "saved-without-asset-key", "saved", candidate(USER, unsaved), MISSING_ASSET_ID);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_bucket = 'vibode-furniture-assets',
        output_sha256 = '${SHA}',
        output_byte_size = 32
      where job_id = '${unsaved}'
    `);
    const beforeAsset = await readJson("select public.list_vibode_furniture_generation_temporary_objects(50)");
    assert.equal(records(beforeAsset.objects).some((item) => String(item.job_id) === discarded), true);
    assert.equal(records(beforeAsset.objects).some((item) => String(item.job_id) === unsaved), false);
    assert.equal(records(beforeAsset.objects).some((item) => String(item.job_id) === ready), false);

    await psql(`
      insert into public.vibode_furniture_assets (
        asset_id, user_id, display_name, origin,
        authored_width_m, authored_height_m, authored_depth_m,
        sha256, byte_size, storage_bucket, storage_object_path
      ) values (
        '${ASSET_ID}', '${USER}', 'Chair', 'uploaded',
        1, 0.8, 0.6,
        '${SHA}', 32, 'vibode-furniture-assets', '${LIBRARY}'
      )
    `);
    await insertJob(saved, USER, "saved-candidate-key", "saved", candidate(USER, saved), ASSET_ID);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_bucket = 'vibode-furniture-assets',
        output_sha256 = '${SHA}',
        output_byte_size = 32
      where job_id = '${saved}'
    `);
    const durable = await readJson("select public.list_vibode_furniture_generation_temporary_objects(50)");
    const savedObject = records(durable.objects).find((item) => item.job_id === saved);
    assert.equal(savedObject?.path, candidate(USER, saved));
    assert.equal(records(durable.objects).some((item) => String(item.path) === LIBRARY), false);
    const libraryBefore = await psql(`
      select storage_object_path || '|' || sha256 from public.vibode_furniture_assets where asset_id = '${ASSET_ID}'
    `);
    const controlsBeforePurge = await spendingFingerprint();
    const holder = holdJob(saved);
    await holder.ready;
    const waited = await psqlError(`
      set lock_timeout = '400ms';
      select public.mark_vibode_furniture_generation_temporary_object_purged('candidate', '${saved}', null);
    `);
    assert.match(waited, /lock timeout|canceling statement/i);
    assert.equal(await psql(`select output_object_path from public.vibode_furniture_generation_jobs where job_id = '${saved}'`), candidate(USER, saved));
    await holder.done;
    const marked = await readJson(`
      select public.mark_vibode_furniture_generation_temporary_object_purged('candidate', '${saved}', null)
    `);
    assert.equal(marked.ok, true);
    assert.equal(await psql(`select (output_object_path is null)::text from public.vibode_furniture_generation_jobs where job_id = '${saved}'`), "true");
    assert.equal(await psql(`select saved_asset_id from public.vibode_furniture_generation_jobs where job_id = '${saved}'`), ASSET_ID);
    assert.equal(await psql(`
      select storage_object_path || '|' || sha256 from public.vibode_furniture_assets where asset_id = '${ASSET_ID}'
    `), libraryBefore);
    assert.equal(await spendingFingerprint(), controlsBeforePurge);
    const repeated = await readJson(`
      select public.mark_vibode_furniture_generation_temporary_object_purged('candidate', '${saved}', null)
    `);
    assert.equal(repeated.code, "not_claimable");

    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'failed', quota_state = 'released', allowance_state = null
      where job_id = '${reserved}';
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations, reserved_generations, consumed_generations
      ) values ('${USER}', 'individual_beta', true, 5, 1, 0);
      update public.vibode_furniture_generation_controls
      set credits_reserved = 30
      where control_id = 'global';
    `);
    const stale = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, quota_state, allowance_state,
        reserved_credits, created_at
      ) values (
        '${stale}', '${USER}', 'meshy-7.1', 'image-to-3d', 'stale-cleanup-key', '${SHA}',
        '{}'::jsonb, array['front']::text[], 'vibode-${stale}', 'reserved', 'reserved', 'reserved',
        30, now() - interval '25 hours'
      )
    `);
    assert.equal((await readJson("select public.sweep_vibode_furniture_generation_holds()")).ok, true);
    assert.equal(await psql(`
      select status || '|' || quota_state || '|' || allowance_state
      from public.vibode_furniture_generation_jobs where job_id = '${stale}'
    `), "cancelled|released|released");
    assert.equal(await psql(`
      select reserved_generations::text || '|' || consumed_generations::text
      from public.vibode_furniture_generation_allowances where user_id = '${USER}'
    `), "0|0");
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowance_events
      where job_id = '${stale}' and action = 'release'
    `), "1");
    assert.equal(await psql("select credits_reserved::text from public.vibode_furniture_generation_controls"), "0");
    assert.equal((await readJson("select public.sweep_vibode_furniture_generation_holds()")).ok, true);
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowance_events
      where job_id = '${stale}' and action = 'release'
    `), "1");

    await psql(`
      update public.vibode_furniture_generation_allowances
      set reserved_generations = 1
      where user_id = '${USER}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 30
      where control_id = 'global';
    `);
    const ambiguous = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, provider_contacted_at,
        status, quota_state, allowance_state, reserved_credits, created_at
      ) values (
        '${ambiguous}', '${USER}', 'meshy-7.1', 'image-to-3d', 'ambiguous-cleanup-key', '${SHA}',
        '{}'::jsonb, array['front']::text[], 'vibode-${ambiguous}', now() - interval '25 hours',
        'ambiguous', 'reserved', 'reserved', 30, now() - interval '25 hours'
      )
    `);
    const contactedControls = await spendingFingerprint();
    assert.equal((await readJson("select public.sweep_vibode_furniture_generation_holds()")).ok, true);
    assert.equal(await psql(`select status from public.vibode_furniture_generation_jobs where job_id = '${ambiguous}'`), "ambiguous");
    assert.equal(await psql(`
      select reserved_generations::text from public.vibode_furniture_generation_allowances where user_id = '${USER}'
    `), "1");
    assert.equal(await psql("select credits_reserved::text from public.vibode_furniture_generation_controls"), "30");
    assert.equal(await spendingFingerprint(), contactedControls);
    assert.equal(fetches.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function insertJob(
  jobId: string,
  userId: string,
  key: string,
  status: string,
  outputPath: string | null,
  savedAssetId: string | null = null,
): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, quota_state, reserved_credits,
      output_object_path, saved_asset_id
    ) values (
      '${jobId}', '${userId}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', '${status}', 'released', 30,
      ${outputPath ? `'${outputPath}'` : "null"},
      ${savedAssetId ? `'${savedAssetId}'` : "null"}
    )
  `);
}

async function insertInput(jobId: string, userId: string, expires: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_inputs (
      job_id, user_id, slot, ordinal, storage_bucket, storage_object_path,
      sha256, byte_size, mime_type, width_px, height_px, expires_at
    ) values (
      '${jobId}', '${userId}', 'front', 0, 'vibode-furniture-generation-inputs',
      'users/${userId}/inputs/${jobId}/front.jpg',
      '${SHA}', 32, 'image/jpeg', 32, 32, ${expires}
    )
  `);
}

function candidate(userId: string, jobId: string): string {
  return `users/${userId}/generations/${jobId}/candidate.glb`;
}

function holdJob(jobId: string): { ready: Promise<void>; done: Promise<void> } {
  const child = spawn("docker", [
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`job lock was not acquired\n${stdout}\n${stderr}`)), 10_000);
    const poll = setInterval(() => {
      if (stdout.includes("locked")) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 40);
  });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`lock session failed\n${stderr}\n${stdout}`));
    });
  });
  child.stdin.end(`
    begin;
    select job_id from public.vibode_furniture_generation_jobs where job_id = '${jobId}' for update;
    select 'locked';
    select pg_sleep(5);
    rollback;
  `);
  return { ready, done };
}

async function privilege(role: string, signature: string): Promise<string> {
  return psql(`select has_function_privilege('${role}', 'public.${signature}', 'execute')::text`);
}

async function spendingFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || credit_ceiling::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function readJson(sqlText: string): Promise<JsonRecord> {
  return JSON.parse(await psql(sqlText)) as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value as JsonRecord[];
}

type JsonRecord = Record<string, unknown>;

async function psql(sqlText: string): Promise<string> {
  const result = await callResult("postgres", sqlText);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sqlText.slice(0, 700)}`);
  return result.stdout.trim();
}

async function psqlError(sqlText: string): Promise<string> {
  const result = await callResult("postgres", sqlText);
  return `${result.stderr}\n${result.stdout}`;
}

function callResult(user: string, sqlText: string): Promise<CommandResult> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sqlText);
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
