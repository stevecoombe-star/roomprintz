/**
 * Provisional Meshy generation ledger on disposable Postgres 16.
 * Docker is required. This test does not connect to hosted Supabase.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1c1-pg";
const DATABASE = "furniture1c1";
const MIGRATION = "supabase/migrations/20261106234500_vibode_furniture_generation.sql";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHA = "ab".repeat(32);
const TASK_A = "018a210d-8ba4-705c-b111-1f1776f7f578";
const TASK_C = "018a210d-8ba4-705c-b111-1f1776f7f579";
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
const MESH_SETTINGS = JSON.stringify({
  ...JSON.parse(SETTINGS) as Record<string, unknown>,
  shouldTexture: false,
});

test("generation ledger grants, reservation, and retry safety hold on disposable postgres", { timeout: 180_000 }, async () => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /revoke all on table public\.vibode_furniture_generation_jobs from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /insert into public\.vibode_furniture_assets/);
  assert.match(migration, /live_enabled boolean not null default false/);

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
    await psql(migration);
    assert.equal(await psql(`
      select live_enabled::text || ':' || credit_ceiling::text || ':' || max_concurrent::text
      from public.vibode_furniture_generation_controls
    `), "false:40:1");
    assert.equal(await psql(`
      select id || ':' || "public"::text || ':' || file_size_limit::text
      from storage.buckets where id = 'vibode-furniture-generation-inputs'
    `), "vibode-furniture-generation-inputs:false:20971520");
    assert.equal(await psql(`select to_regclass('public.vibode_furniture_assets') is null`), "t");
    assert.equal(await psql(`
      select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'reserve_vibode_furniture_generation',
          'mark_vibode_furniture_generation_needs_review',
          'authorize_vibode_furniture_generation_resubmit',
          'discard_vibode_furniture_generation_candidate',
          'expire_vibode_furniture_generation_candidate'
        )
        and p.prosecdef
        and p.proconfig::text like '%search_path=pg_catalog, public, pg_temp%'
    `), "5");
    assert.equal(await psql(`
      select has_function_privilege('authenticated', 'public.discard_vibode_furniture_generation_candidate(uuid,uuid)', 'execute')::text
        || ':' || has_function_privilege('service_role', 'public.vibode_furniture_generation_release_stale()', 'execute')::text
    `), "false:false");
    assert.equal(await psql(`
      select count(*) from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name like 'vibode_furniture_generation%'
        and grantee in ('anon', 'authenticated', 'public', 'service_role')
    `), "0");
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.match(await psqlErrorAs("authenticated", `select status from public.vibode_furniture_generation_jobs`), /permission denied/i);
    assert.match(await psqlErrorAs("service_role", `insert into public.vibode_furniture_generation_jobs default values`), /permission denied/i);
    assert.match(await psqlErrorAs("authenticated", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_A}', 'idem-key-0001', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )
    `), /permission denied/i);
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_A}', 'idem-key-0001', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )->>'code'
    `), "disabled");

    await psql(`update public.vibode_furniture_generation_controls set live_enabled = true where control_id = 'global'`);
    assert.match(await psqlErrorAs("service_role", `
      update public.vibode_furniture_generation_controls set live_enabled = false
    `), /permission denied/i);
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_A}', 'idem-key-0001', '${SHA}',
        'multi-image-to-3d', 'meshy-7.1',
        '${JSON.stringify({ ...JSON.parse(SETTINGS), geometryResolution: "4k" })}'::jsonb,
        array['front','left'], 35
      )->>'code'
    `), "unsupported_settings");
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_A}', 'idem-key-0001', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )->>'created'
    `), "true");
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_B}', 'idem-key-0001', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )->>'created'
    `), "false");
    assert.equal(await psql(`select count(*) from public.vibode_furniture_generation_jobs`), "1");
    assert.equal(await psql(`select credits_reserved::text from public.vibode_furniture_generation_controls`), "30");
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_B}', '${JOB_B}', 'idem-key-0002', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )->>'code'
    `), "concurrency_limited");
    assert.equal(await psqlAs("service_role", `
      select public.read_vibode_furniture_generation('${USER_B}', '${JOB_A}')->>'code'
    `), "not_found");
    assert.equal(await psqlAs("service_role", `
      select public.read_vibode_furniture_generation('${USER_A}', '${JOB_A}')->>'status'
    `), "reserved");

    const nonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_A}', 'submit')->>'claim_nonce'
    `);
    assert.match(nonce, /^[0-9a-f-]{36}$/);
    assert.equal(await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_A}', 'submit')->>'code'
    `), "lease_held");
    assert.equal(await psqlAs("service_role", `
      select public.mark_vibode_furniture_generation_ambiguous('${USER_A}', '${JOB_A}', '${nonce}', 'create_timeout')->>'status'
    `), "ambiguous");
    const reconcile = JSON.parse(await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_A}', 'submit')::text
    `)) as { purpose?: string; claim_nonce?: string };
    assert.equal(reconcile.purpose, "reconcile");
    assert.equal(await psqlAs("service_role", `
      select public.mark_vibode_furniture_generation_needs_review('${USER_A}', '${JOB_A}', '${reconcile.claim_nonce}', 'list_absent')->>'code'
    `), "needs_reconciliation");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '2 minutes'
      where job_id = '${JOB_A}'
    `);
    const laterNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_A}', 'follow')->>'claim_nonce'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.mark_vibode_furniture_generation_needs_review('${USER_A}', '${JOB_A}', '${laterNonce}', 'list_absent')->>'status'
    `), "needs_review");
    assert.equal(await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_A}', 'submit')->>'code'
    `), "not_claimable");
    assert.equal(await psql(`select attempt_count::text || ':' || status from public.vibode_furniture_generation_jobs where job_id = '${JOB_A}'`), "1:needs_review");
    assert.equal(await psqlAs("service_role", `
      select public.authorize_vibode_furniture_generation_resubmit('${USER_A}', '${JOB_A}', false)->>'code'
    `), "not_claimable");
    assert.equal(await psqlAs("service_role", `
      select public.authorize_vibode_furniture_generation_resubmit('${USER_B}', '${JOB_A}', true)->>'code'
    `), "not_found");
    assert.equal(await psqlAs("service_role", `
      select public.authorize_vibode_furniture_generation_resubmit('${USER_A}', '${JOB_A}', true)->>'duplicate_charge_risk'
    `), "true");
    const retryNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_A}', 'submit')->>'claim_nonce'
    `);
    assert.match(retryNonce, /^[0-9a-f-]{36}$/);
    assert.equal(await psql(`select attempt_count::text || ':' || status from public.vibode_furniture_generation_jobs where job_id = '${JOB_A}'`), "2:submitting");
    assert.equal(await psqlAs("service_role", `
      select public.mark_vibode_furniture_generation_ambiguous('${USER_A}', '${JOB_A}', '${retryNonce}', 'create_timeout')->>'status'
    `), "ambiguous");

    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'failed', quota_state = 'released', consumed_credits = 0, claim_nonce = null, claim_expires_at = null
      where job_id = '${JOB_A}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0, credits_consumed = 30
      where control_id = 'global';
      update public.vibode_furniture_generation_jobs
      set status = 'saved',
        saved_asset_id = 'vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      where job_id = '${JOB_A}';
    `);
    assert.equal(await psqlAs("service_role", `
      select public.discard_vibode_furniture_generation_candidate('${USER_A}', '${JOB_A}')->>'code'
    `), "not_claimable");
    assert.equal(await psql(`
      select saved_asset_id from public.vibode_furniture_generation_jobs where job_id = '${JOB_A}'
    `), "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_B}', 'idem-key-0003', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${MESH_SETTINGS}'::jsonb, array['front'], 20
      )->>'code'
    `), "quota_exhausted");
    await psql(`update public.vibode_furniture_generation_controls set credits_consumed = 0 where control_id = 'global'`);
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_B}', 'idem-key-0003', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )->>'status'
    `), "reserved");
    const submitNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_B}', 'submit')->>'claim_nonce'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.bind_vibode_furniture_generation_task(
        '${USER_A}', '${JOB_B}', '${submitNonce}', '${TASK_A}', 'PENDING'
      )->>'provider_task_id'
    `), TASK_A);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_jobs
      set provider_task_id = 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz'
      where job_id = '${JOB_B}'
    `), /TASK_IMMUTABLE/);
    const pollNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_B}', 'follow')->>'claim_nonce'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.apply_vibode_furniture_generation_observation(
        '${USER_A}', '${JOB_B}', '${pollNonce}', 'SUCCEEDED', 100, 30, null
      )->>'status'
    `), "ingesting");
    assert.equal(await psqlAs("service_role", `
      select public.record_vibode_furniture_generation_output(
        '${USER_A}', '${JOB_B}', '${pollNonce}', 128, '${SHA}'
      )->>'saved_asset_id'
    `), "");
    assert.equal(await psql(`
      select status || ':' || output_object_path || ':' || coalesce(saved_asset_id, '')
      from public.vibode_furniture_generation_jobs where job_id = '${JOB_B}'
    `), `ready:users/${USER_A}/generations/${JOB_B}/candidate.glb:`);
    assert.equal(await psql(`
      select credits_reserved::text || ':' || credits_consumed::text
      from public.vibode_furniture_generation_controls
    `), "0:30");
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_jobs
      set output_byte_size = 26214401
      where job_id = '${JOB_B}'
    `), /vibode_furniture_generation_jobs_output_size/);
    assert.equal(await psqlAs("service_role", `
      select public.discard_vibode_furniture_generation_candidate('${USER_B}', '${JOB_B}')->>'code'
    `), "not_found");
    assert.equal(await psqlAs("service_role", `
      select public.expire_vibode_furniture_generation_candidate('${USER_A}', '${JOB_B}')->>'code'
    `), "not_claimable");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set output_expires_at = now() - interval '1 minute'
      where job_id = '${JOB_B}'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.expire_vibode_furniture_generation_candidate('${USER_A}', '${JOB_B}')->>'provider_credits_refunded'
    `), "false");
    assert.equal(await psql(`
      select status || ':' || credits_consumed::text
      from public.vibode_furniture_generation_jobs j
      cross join public.vibode_furniture_generation_controls c
      where j.job_id = '${JOB_B}'
    `), "expired:30");

    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'failed'
      where job_id = '${JOB_B}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0, credits_consumed = 0
      where control_id = 'global';
    `);
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_C}', 'idem-key-0004', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${MESH_SETTINGS}'::jsonb, array['front'], 20
      )->>'status'
    `), "reserved");
    const rateNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_C}', 'submit')->>'claim_nonce'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.settle_vibode_furniture_generation_rate_limit('${USER_A}', '${JOB_C}', '${rateNonce}')->>'status'
    `), "reserved");
    assert.equal(await psql(`
      select attempt_count::text || ':' || coalesce(provider_contacted_at::text, '')
      from public.vibode_furniture_generation_jobs where job_id = '${JOB_C}'
    `), "0:");
    const dropNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_C}', 'submit')->>'claim_nonce'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.drop_vibode_furniture_generation_claim('${USER_A}', '${JOB_C}', '${dropNonce}')->>'status'
    `), "submitting");
    const outputClaim = JSON.parse(await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_C}', 'follow')::text
    `)) as { purpose?: string; claim_nonce?: string };
    assert.equal(outputClaim.purpose, "reconcile");
    assert.equal(await psqlAs("service_role", `
      select public.bind_vibode_furniture_generation_task(
        '${USER_A}', '${JOB_C}', '${outputClaim.claim_nonce}', '${TASK_C}', 'PENDING'
      )->>'status'
    `), "running");
    const ingestNonce = await psqlAs("service_role", `
      select public.claim_vibode_furniture_generation('${USER_A}', '${JOB_C}', 'follow')->>'claim_nonce'
    `);
    assert.equal(await psqlAs("service_role", `
      select public.apply_vibode_furniture_generation_observation(
        '${USER_A}', '${JOB_C}', '${ingestNonce}', 'SUCCEEDED', 100, 20, null
      )->>'status'
    `), "ingesting");
    assert.equal(await psqlAs("service_role", `
      select public.fail_vibode_furniture_generation_output(
        '${USER_A}', '${JOB_C}', '${ingestNonce}', 'oversized_output'
      )->>'status'
    `), "failed");
    assert.equal(await psql(`
      select status || ':' || coalesce(saved_asset_id, '') || ':' || credits_reserved::text || ':' || credits_consumed::text
      from public.vibode_furniture_generation_jobs j
      cross join public.vibode_furniture_generation_controls c
      where j.job_id = '${JOB_C}'
    `), "failed::0:20");

    await psql(`
      insert into storage.objects (bucket_id, name) values
        ('vibode-furniture-generation-inputs', 'users/${USER_A}/inputs/${JOB_B}/front.jpg'),
        ('public-bucket', 'visible.txt');
      create policy storage_test_allow_authenticated
      on storage.objects
      as permissive
      for select
      to authenticated
      using (true);
      grant select on storage.objects to authenticated;
    `);
    assert.equal(await psqlAs("authenticated", `
      select count(*) from storage.objects where bucket_id = 'vibode-furniture-generation-inputs'
    `), "0");
    assert.equal(await psqlAs("authenticated", `
      select count(*) from storage.objects where bucket_id = 'public-bucket'
    `), "1");

    const userD = "33333333-3333-4333-8333-333333333333";
    const jobD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await psql(`
      insert into auth.users (id) values ('${userD}');
      insert into storage.objects (bucket_id, name)
      values ('vibode-furniture-generation-inputs', 'users/${userD}/inputs/${jobD}/front.jpg');
    `);
    assert.equal(await psqlAs("service_role", `
      select public.reserve_vibode_furniture_generation(
        '${userD}', '${jobD}', 'idem-key-0005', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${MESH_SETTINGS}'::jsonb, array['front'], 20
      )->>'status'
    `), "reserved");
    assert.equal(await psqlAs("service_role", `
      select public.discard_vibode_furniture_generation_candidate('${userD}', '${jobD}')->>'status'
    `), "cancelled");
    assert.equal(await psql(`
      select status || ':' || quota_state from public.vibode_furniture_generation_jobs where job_id = '${jobD}'
    `), "cancelled:released");
    await psql(`delete from auth.users where id = '${userD}'`);
    assert.equal(await psql(`select count(*) from public.vibode_furniture_generation_jobs where user_id = '${userD}'`), "0");
    assert.equal(await psql(`
      select count(*) from storage.objects where name = 'users/${userD}/inputs/${jobD}/front.jpg'
    `), "1");
  } finally {
    await removeContainer();
  }
});

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

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
}

async function psqlErrorAs(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
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
