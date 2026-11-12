/**
 * MESHY-1D.4C owner recent-generation read on disposable Postgres 16.
 * The chain includes every furniture generation migration through paid-budget
 * admission, then this read. The read does not reserve, submit, or change
 * controls. Provider calls are not made, and fetch throws.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createSqlGenerationCommands } from "@/lib/vibode-furniture/generation/sql-commands";

const CONTAINER = "vibode-furniture-1d4c-pg";
const DATABASE = "furniture1d4c";
const MIGRATION = "supabase/migrations/20261112160000_vibode_furniture_generation_owner_recent.sql";
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
];
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const USER_D = "44444444-4444-4444-8444-444444444444";
const USER_E = "55555555-5555-4555-8555-555555555555";
const ADMIN = "66666666-6666-4666-8666-666666666666";
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
const RUN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const READY_NEW = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const READY_OLD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const EXPIRED_READY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const SAVED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";
const DISCARDED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc6";
const FAILED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc7";
const EXPIRED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc8";
const OTHER_READY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc9";
const REVIEW = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const DISABLED_READY = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";

test("owner recent generations stay readable without a new reservation", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /limit 20/);
  assert.match(migration, /status = 'ready'/);
  assert.match(migration, /output_expires_at > now\(\)/);
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized|set\s+paid_submissions_used/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.doesNotMatch(migration, /create or replace function public\.reserve_vibode_furniture_generation/);
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  await removeContainer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("real_network_blocked");
  };
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values
        ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${USER_D}'), ('${USER_E}'), ('${ADMIN}');
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
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select prosecdef::text || ':' || provolatile::text || ':' || proconfig::text
      from pg_proc
      where proname = 'read_vibode_furniture_generation_owner_recent'
    `), 'true:s:{"search_path=pg_catalog, public, pg_temp"}');
    assert.equal(await psql(`
      select has_function_privilege('service_role', 'public.read_vibode_furniture_generation_owner_recent(uuid)', 'execute')::text
        || has_function_privilege('anon', 'public.read_vibode_furniture_generation_owner_recent(uuid)', 'execute')::text
        || has_function_privilege('authenticated', 'public.read_vibode_furniture_generation_owner_recent(uuid)', 'execute')::text
    `), "truefalsefalse");
    assert.equal(await psql(`
      select position('submission_not_authorized' in prosrc)::text
      from pg_proc where proname = 'reserve_vibode_furniture_generation'
    `) !== "0", true);
    await psql(`
      do $$
      begin
        execute 'set local role anon';
        perform public.read_vibode_furniture_generation_owner_recent('${USER_A}');
        raise exception 'anon_was_allowed';
      exception
        when insufficient_privilege then
          null;
      end $$;
    `);
    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations,
        reserved_generations, consumed_generations, updated_by
      ) values
        ('${USER_A}', 'individual_beta', true, 1, 0, 1, '${ADMIN}'),
        ('${USER_B}', 'individual_beta', true, 2, 0, 0, '${ADMIN}'),
        ('${USER_C}', 'individual_beta', true, 1, 0, 1, '${ADMIN}'),
        ('${USER_D}', 'individual_beta', false, 1, 0, 1, '${ADMIN}')
    `);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = 30,
          credits_consumed = 10,
          paid_submissions_authorized = 1,
          paid_submissions_used = 1
      where control_id = 'global'
    `);
    await insertJobs();
    const watched = "false|1|40|30|10|1|1";
    assert.equal(await controlFingerprint(), watched);
    const allowanceBefore = await allowanceFacts();
    const eventsBefore = await psql("select count(*)::text from public.vibode_furniture_generation_allowance_events");
    const updatedBefore = await psql(`select updated_at::text from public.vibode_furniture_generation_jobs where job_id = '${RUN}'`);
    const listed = await recentAs(USER_A);
    assert.equal(listed.ok, true);
    assert.equal(listed.limit, 20);
    const jobs = listed.jobs as RecentRow[];
    assert.deepEqual(jobs.map((job) => job.job_id), [RUN, READY_NEW, READY_OLD]);
    assert.equal(jobs[0]?.status, "running");
    assert.equal(jobs[0]?.error_class, null);
    assert.equal(jobs[0]?.preview_available, false);
    assert.equal(jobs[1]?.status, "ready");
    assert.equal(jobs[1]?.preview_available, true);
    assert.equal(typeof jobs[1]?.output_expires_at, "string");
    assert.equal(jobs[2]?.preview_available, true);
    const encoded = JSON.stringify(listed);
    assert.equal(encoded.includes("credit"), false);
    assert.equal(encoded.includes("task-secret-1"), false);
    assert.equal(encoded.includes("users/hidden"), false);
    assert.equal(encoded.includes("candidate.glb"), false);
    assert.equal(encoded.includes("idempotency"), false);
    assert.equal(encoded.includes("meshy"), false);
    const keys = await psql(`
      select string_agg(distinct key, ',' order by key)
      from jsonb_array_elements(public.read_vibode_furniture_generation_owner_recent('${USER_A}') -> 'jobs') job,
           lateral jsonb_object_keys(job) key
    `);
    assert.equal(keys, "created_at,error_class,job_id,output_expires_at,preview_available,progress,status,updated_at");
    const review = await recentAs(USER_C);
    assert.equal((review.jobs as RecentRow[])[0]?.status, "needs_review");
    assert.equal((review.jobs as RecentRow[])[0]?.error_class, "needs_review");
    assert.equal(JSON.stringify(review).includes("credit"), false);
    const disabled = await recentAs(USER_D);
    assert.equal((disabled.jobs as RecentRow[])[0]?.job_id, DISABLED_READY);
    assert.equal((disabled.jobs as RecentRow[])[0]?.preview_available, true);
    const stranger = await recentAs(USER_B);
    const strangerIds = (stranger.jobs as RecentRow[]).map((job) => job.job_id);
    assert.equal(strangerIds.includes(OTHER_READY), true);
    assert.equal(strangerIds.includes(RUN) || strangerIds.includes(READY_NEW), false);
    const missing = await recentAsNull();
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "not_found");
    const limited = await recentAs(USER_E);
    const limitedIds = (limited.jobs as RecentRow[]).map((job) => job.job_id);
    assert.equal(limitedIds.length, 20);
    assert.equal(limitedIds[0], "eeeeeeee-eeee-4eee-8eee-000000000021");
    assert.equal(limitedIds.includes("eeeeeeee-eeee-4eee-8eee-000000000001"), false);
    assert.equal(await controlFingerprint(), watched);
    assert.equal(await allowanceFacts(), allowanceBefore);
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_allowance_events"), eventsBefore);
    assert.equal(await psql(`select updated_at::text from public.vibode_furniture_generation_jobs where job_id = '${RUN}'`), updatedBefore);
    const commands = createSqlGenerationCommands(async (fn, values) => {
      return JSON.parse(await psql(`select public.${fn}(${values.map(sqlLiteral).join(", ")})::text`));
    });
    const mapped = await commands.listOwnerRecent(USER_A);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.deepEqual(mapped.jobs.map((job) => job.jobId), [RUN, READY_NEW, READY_OLD]);
    assert.equal(mapped.jobs[1]?.previewAvailable, true);
    assert.equal(mapped.jobs[0]?.errorClass, null);
    assert.equal(JSON.stringify(mapped).includes("candidate.glb"), false);
    assert.equal(await controlFingerprint(), watched);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function insertJobs(): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, provider_task_id, status, progress,
      quota_state, reserved_credits, output_bucket, output_object_path, output_expires_at,
      error_class, error_code, saved_asset_id, created_at, updated_at
    )
    select
      job_id,
      user_id,
      'meshy',
      'meshy-7.1',
      'image-to-3d',
      'k-' || replace(job_id::text, '-', ''),
      '${SHA}',
      $json$${SETTINGS}$json$::jsonb,
      array['front']::text[],
      'vibode-' || job_id::text,
      task_id,
      status,
      progress,
      quota_state,
      30,
      case when status in ('ready', 'saved', 'discarded', 'expired') then 'vibode-furniture-assets' else null end,
      case when status in ('ready', 'saved', 'discarded', 'expired')
        then 'users/' || user_id::text || '/generations/' || job_id::text || '/candidate.glb'
        else null end,
      expires_at,
      error_class,
      error_code,
      saved_asset_id,
      created_at,
      created_at
    from (values
      ('${RUN}'::uuid, '${USER_A}'::uuid, 'running', 40, 'reserved', 'users/hidden/secret', null::text, null::text, null::timestamptz, timestamptz '2026-11-12 18:00:00+00', 'task-secret-1'),
      ('${READY_NEW}'::uuid, '${USER_A}'::uuid, 'ready', 100, 'released', null::text, null::text, null::text, timestamptz '2026-12-01 00:00:00+00', timestamptz '2026-11-12 17:00:00+00', null::text),
      ('${READY_OLD}'::uuid, '${USER_A}'::uuid, 'ready', 100, 'released', null::text, null::text, null::text, timestamptz '2026-12-01 00:00:00+00', timestamptz '2026-11-10 17:00:00+00', null::text),
      ('${EXPIRED_READY}'::uuid, '${USER_A}'::uuid, 'ready', 100, 'released', null::text, null::text, null::text, timestamptz '2026-11-01 00:00:00+00', timestamptz '2026-11-09 17:00:00+00', null::text),
      ('${SAVED}'::uuid, '${USER_A}'::uuid, 'saved', 100, 'released', null::text, null::text, 'vibode-furniture/personal/${SAVED}', timestamptz '2026-12-01 00:00:00+00', timestamptz '2026-11-12 19:00:00+00', null::text),
      ('${DISCARDED}'::uuid, '${USER_A}'::uuid, 'discarded', 100, 'released', 'discarded', 'discarded', null::text, timestamptz '2026-12-01 00:00:00+00', timestamptz '2026-11-08 17:00:00+00', null::text),
      ('${FAILED}'::uuid, '${USER_A}'::uuid, 'failed', 0, 'released', 'provider_failed', 'provider_failed', null::text, null::timestamptz, timestamptz '2026-11-12 16:00:00+00', null::text),
      ('${EXPIRED}'::uuid, '${USER_A}'::uuid, 'expired', 100, 'released', 'expired', 'expired', null::text, timestamptz '2026-11-01 00:00:00+00', timestamptz '2026-11-07 17:00:00+00', null::text),
      ('${OTHER_READY}'::uuid, '${USER_B}'::uuid, 'ready', 100, 'released', null::text, null::text, null::text, timestamptz '2026-12-01 00:00:00+00', timestamptz '2026-11-12 17:30:00+00', null::text),
      ('${REVIEW}'::uuid, '${USER_C}'::uuid, 'needs_review', 0, 'released', 'credit_unreported', 'credit_unreported', null::text, null::timestamptz, timestamptz '2026-11-12 12:00:00+00', null::text),
      ('${DISABLED_READY}'::uuid, '${USER_D}'::uuid, 'ready', 100, 'released', null::text, null::text, null::text, timestamptz '2026-12-01 00:00:00+00', timestamptz '2026-11-12 12:30:00+00', null::text)
    ) as spec(job_id, user_id, status, progress, quota_state, error_class, error_code, saved_asset_id, expires_at, created_at, task_id)
  `);
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, progress, quota_state, reserved_credits,
      output_bucket, output_object_path, output_expires_at, created_at, updated_at
    )
    select
      job_id,
      '${USER_E}',
      'meshy',
      'meshy-7.1',
      'image-to-3d',
      'limit-key-' || lpad(i::text, 2, '0'),
      '${SHA}',
      $json$${SETTINGS}$json$::jsonb,
      array['front']::text[],
      'vibode-' || job_id::text,
      'ready',
      100,
      'released',
      30,
      'vibode-furniture-assets',
      'users/${USER_E}/generations/' || job_id::text || '/candidate.glb',
      now() + interval '2 days',
      timestamptz '2026-11-01 00:00:00+00' + make_interval(hours => i),
      timestamptz '2026-11-01 00:00:00+00' + make_interval(hours => i)
    from (
      select i, ('eeeeeeee-eeee-4eee-8eee-' || lpad(i::text, 12, '0'))::uuid as job_id
      from generate_series(1, 21) as i
    ) rows
  `);
}

async function recentAs(userId: string): Promise<JsonRow> {
  return JSON.parse(await psql(`
    set role service_role;
    select public.read_vibode_furniture_generation_owner_recent('${userId}');
  `)) as JsonRow;
}

async function recentAsNull(): Promise<JsonRow> {
  return JSON.parse(await psql(`
    set role service_role;
    select public.read_vibode_furniture_generation_owner_recent(null);
  `)) as JsonRow;
}

async function controlFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls where control_id = 'global'
  `);
}

async function allowanceFacts(): Promise<string> {
  return psql(`
    select string_agg(
      user_id::text || ':' || enabled::text || ':' || authorized_generations::text
        || ':' || reserved_generations::text || ':' || consumed_generations::text,
      ',' order by user_id
    )
    from public.vibode_furniture_generation_allowances
  `);
}

type RecentRow = Readonly<{
  job_id: string;
  status: string;
  error_class: string | null;
  preview_available: boolean;
  output_expires_at: string | null;
}>;

type JsonRow = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  limit?: number;
  jobs?: RecentRow[];
};

function sqlLiteral(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
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
