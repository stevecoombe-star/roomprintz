/**
 * Disposable Postgres proof for calibrated-save linkage.
 * Docker is required. This test does not connect to hosted Supabase,
 * does not run supabase db push, and does not call Meshy.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1c3b-pg";
const DATABASE = "furniture1c3b";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const JOB_READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const JOB_RACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const JOB_RETRY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const ASSET_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RACE_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RACE_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RETRY_UUID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SOURCE_SHA = "ab".repeat(32);
const ASSET_SHA = "cd".repeat(32);
const OTHER_SHA = "ef".repeat(32);
const RACE_SHA_A = "11".repeat(32);
const RACE_SHA_B = "22".repeat(32);
const RETRY_SHA = "33".repeat(32);
const MIGRATIONS = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
];

test("calibrated save linkage holds on disposable postgres", { timeout: 180_000 }, async () => {
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
      insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
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
    for (const migration of MIGRATIONS) {
      await psql(readFileSync(path.join(process.cwd(), migration), "utf8"));
    }
    // PostgreSQL 16 has no MAINTAIN privilege. The deployed privileges
    // migration uses that PostgreSQL 17 keyword, so this proof applies the
    // same delete/truncate revoke without it. The new save migration is unchanged.
    await psql(`
      revoke delete, truncate, references, trigger
      on table public.vibode_furniture_assets, public.vibode_furniture_asset_uploads
      from service_role;
    `);
    await psql(readFileSync(path.join(process.cwd(), MIGRATIONS[MIGRATIONS.length - 1]!), "utf8"));
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);

    const signature = "public.link_vibode_furniture_generation_saved_asset(uuid,uuid,text,text,bigint,text,bigint)";
    const readSignature = "public.read_vibode_furniture_generation_save_source(uuid,uuid)";
    assert.equal(await psql(`
      select has_function_privilege('service_role', '${signature}', 'execute')::text
        || ':' || has_function_privilege('authenticated', '${signature}', 'execute')::text
        || ':' || has_function_privilege('anon', '${signature}', 'execute')::text
        || ':' || has_function_privilege('public', '${signature}', 'execute')::text
        || ':' || has_function_privilege('authenticated', '${readSignature}', 'execute')::text
        || ':' || has_table_privilege('service_role', 'public.vibode_furniture_generation_jobs', 'update')::text
        || ':' || has_table_privilege('service_role', 'public.vibode_furniture_generation_jobs', 'select')::text
    `), "true:false:false:false:false:false:false");
    const definition = await psql(`
      select r.rolname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public' and p.proname = 'link_vibode_furniture_generation_saved_asset'
    `);
    assert.match(definition, /^postgres:true:search_path=pg_catalog, public, pg_temp$/);

    await insertJob(JOB_READY, "idem-1c3b-ready", "now() - interval '1 minute'");
    await insertAsset(ASSET_UUID, ASSET_SHA, USER_A);
    const expired = await link(USER_A, JOB_READY, ASSET_UUID, ASSET_SHA);
    assert.equal(expired.ok, false);
    assert.equal(expired.code, "expired");
    assert.equal(await jobStatus(JOB_READY), `ready::${SOURCE_SHA}::100`);

    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_expires_at = now() + interval '7 days'
      where job_id = '${JOB_READY}'
    `);
    const mismatch = await link(USER_A, JOB_READY, ASSET_UUID, ASSET_SHA, "ff".repeat(32));
    assert.equal(mismatch.code, "source_mismatch");
    const missingAsset = await link(USER_A, JOB_READY, OTHER_UUID, OTHER_SHA);
    assert.equal(missingAsset.code, "asset_missing");
    const foreign = await link(USER_B, JOB_READY, ASSET_UUID, ASSET_SHA);
    assert.equal(foreign.code, "not_found");
    assert.equal(await jobStatus(JOB_READY), `ready::${SOURCE_SHA}::100`);
    assert.equal(await psql("select count(*)::text from storage.objects"), "0");

    const saved = await link(USER_A, JOB_READY, ASSET_UUID, ASSET_SHA);
    assert.equal(saved.ok, true);
    assert.equal(saved.idempotent, false);
    assert.equal(await jobStatus(JOB_READY), `saved::${SOURCE_SHA}::100`);
    assert.equal(await savedAsset(JOB_READY), assetId(ASSET_UUID));
    const again = await link(USER_A, JOB_READY, ASSET_UUID, ASSET_SHA);
    assert.equal(again.ok, true);
    assert.equal(again.idempotent, true);
    await insertAsset(OTHER_UUID, OTHER_SHA, USER_A);
    const conflict = await link(USER_A, JOB_READY, OTHER_UUID, OTHER_SHA);
    assert.equal(conflict.code, "already_saved");
    assert.equal(await savedAsset(JOB_READY), assetId(ASSET_UUID));
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_assets"), "2");
    assert.equal(await psql("select count(*)::text from storage.objects"), "0");

    const source = await readSource(USER_A, JOB_READY);
    assert.equal(source.ok, true);
    assert.equal(source.status, "saved");
    assert.equal(source.output_sha256, SOURCE_SHA);
    assert.equal(JSON.stringify(source).includes("preview"), false);
    assert.equal(JSON.stringify(source).includes("signed"), false);
    assert.equal((await readSource(USER_B, JOB_READY)).code, "not_found");

    await insertJob(JOB_RACE, "idem-1c3b-race", "now() + interval '7 days'");
    await insertAsset(RACE_A, RACE_SHA_A, USER_A);
    await insertAsset(RACE_B, RACE_SHA_B, USER_A);
    const raced = await Promise.all([
      link(USER_A, JOB_RACE, RACE_A, RACE_SHA_A),
      link(USER_A, JOB_RACE, RACE_B, RACE_SHA_B),
    ]);
    const winner = raced.find((item) => item.ok === true);
    const loser = raced.find((item) => item.ok === false);
    assert.ok(winner);
    assert.equal(loser?.code, "already_saved");
    const raceAsset = await savedAsset(JOB_RACE);
    assert.ok(raceAsset === assetId(RACE_A) || raceAsset === assetId(RACE_B));
    assert.equal(await jobStatus(JOB_RACE), `saved::${SOURCE_SHA}::100`);

    await insertJob(JOB_RETRY, "idem-1c3b-retry", "now() + interval '7 days'");
    await insertAsset(RETRY_UUID, RETRY_SHA, USER_A);
    const retried = await Promise.all([
      link(USER_A, JOB_RETRY, RETRY_UUID, RETRY_SHA),
      link(USER_A, JOB_RETRY, RETRY_UUID, RETRY_SHA),
    ]);
    assert.equal(retried.every((item) => item.ok === true), true);
    assert.deepEqual(retried.map((item) => item.idempotent).sort(), [false, true]);
    assert.equal(await savedAsset(JOB_RETRY), assetId(RETRY_UUID));
    assert.equal(await jobStatus(JOB_RETRY), `saved::${SOURCE_SHA}::100`);
  } finally {
    await removeContainer();
  }
});

function assetId(uuid: string): string {
  return `vibode-furniture/personal/${uuid}`;
}

async function insertJob(jobId: string, key: string, expires: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, provider_status, status, progress,
      attempt_count, quota_state, reserved_credits, consumed_credits,
      output_bucket, output_object_path, output_sha256, output_byte_size, output_expires_at
    ) values (
      '${jobId}', '${USER_A}', 'meshy-7.1', 'image-to-3d', '${key}', '${"12".repeat(32)}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', 'SUCCEEDED', 'ready', 100,
      1, 'reconciled', 30, 30,
      'vibode-furniture-assets',
      'users/${USER_A}/generations/${jobId}/candidate.glb',
      '${SOURCE_SHA}', 100, ${expires}
    )
  `);
}

async function insertAsset(uuid: string, sha: string, userId: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_assets (
      asset_id, user_id, display_name, category, origin,
      authored_width_m, authored_height_m, authored_depth_m,
      sha256, byte_size, storage_bucket, storage_object_path
    ) values (
      '${assetId(uuid)}', '${userId}', 'Armchair', 'Seating', 'uploaded',
      0.803, 0.850, 0.664,
      '${sha}', 80, 'vibode-furniture-assets',
      'users/${userId}/assets/${uuid}/model.glb'
    )
  `);
}

async function link(
  userId: string,
  jobId: string,
  uuid: string,
  assetSha: string,
  sourceSha = SOURCE_SHA,
): Promise<{ ok?: boolean; code?: string; idempotent?: boolean }> {
  return JSON.parse(await psqlAs("service_role", `
    select public.link_vibode_furniture_generation_saved_asset(
      '${userId}'::uuid,
      '${jobId}'::uuid,
      '${assetId(uuid)}',
      '${sourceSha}',
      100,
      '${assetSha}',
      80
    )::text
  `)) as { ok?: boolean; code?: string; idempotent?: boolean };
}

async function readSource(userId: string, jobId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await psqlAs("service_role", `
    select public.read_vibode_furniture_generation_save_source(
      '${userId}'::uuid,
      '${jobId}'::uuid
    )::text
  `)) as Record<string, unknown>;
}

async function jobStatus(jobId: string): Promise<string> {
  return psql(`
    select status || '::' || output_sha256 || '::' || output_byte_size::text
    from public.vibode_furniture_generation_jobs
    where job_id = '${jobId}'
  `);
}

async function savedAsset(jobId: string): Promise<string> {
  return psql(`
    select saved_asset_id
    from public.vibode_furniture_generation_jobs
    where job_id = '${jobId}'
  `);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlAs(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql as ${user} failed\n${result.stderr}\n${result.stdout}`);
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
      const probe = await docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1"]);
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
