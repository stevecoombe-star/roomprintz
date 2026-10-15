/**
 * Applies the Harmonize global-ceiling migration to disposable Postgres 16.
 * No hosted database, published port, or provider call.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "harmonize-pg-3b2a1-disposable";
const SHA = "ab".repeat(32);
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const USER_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const USER_D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const ROOM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ROOM_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const ROOM_D = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const ASSET_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ASSET_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const ASSET_D = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const MIGRATIONS = [
  "20261012090000_vibode_harmonize_generations.sql",
  "20261013010000_vibode_harmonize_exact_claim.sql",
  "20261015190000_vibode_harmonize_global_ceilings.sql",
];

type Json = Record<string, unknown>;

test("global ceiling migration preserves publication and scene authority", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261015190000_vibode_harmonize_global_ceilings.sql"),
    "utf8",
  );
  assert.equal(sql.split("pg_advisory_xact_lock(8142, 20261015)").length - 1, 3);
  assert.match(sql, /vibode_harmonize_global_provider_limit/);
  assert.match(sql, /select 10/);
  assert.doesNotMatch(sql, /create or replace function public\.publish_vibode_harmonize_history/);
  assert.doesNotMatch(sql, /create or replace function public\.vibode_harmonize_generations_guard/);
  assert.doesNotMatch(sql, /create or replace function public\.enqueue_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /alter table public\.vibode_3d|alter table public\.vibode_afc|alter table public\.vibode_room_assets|alter table public\.vibode_generation_runs/);
  assert.match(sql, /revoke all on function public\.claim_next_vibode_harmonize_generation\(\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.claim_next_vibode_harmonize_generation\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.contact_vibode_harmonize_generation\(uuid, text\) from public, anon, authenticated/);
});

test("postgres 16 enforces one running generation and ten global contacts", { timeout: 300_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await applyMigrations();
    assert.match(await psql("select current_setting('server_version')"), /^16\./);
    assert.equal(await psql("select public.vibode_harmonize_global_provider_limit()"), "10");
    assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "0");
    assert.equal(await psql(
      "select indexname from pg_indexes where indexname = 'vibode_harmonize_provider_started_global'",
    ), "vibode_harmonize_provider_started_global");
    await assertGrants();

    await seedOwner(USER_A, ROOM_A, ASSET_A);
    await seedOwner(USER_B, ROOM_B, ASSET_B);
    await seedOwner(USER_C, ROOM_C, ASSET_C);
    await seedOwner(USER_D, ROOM_D, ASSET_D);

    const holder = psql(`
      select pg_advisory_lock(8142, 20261015);
      select pg_sleep(3);
      select pg_advisory_unlock(8142, 20261015);
    `);
    await waitForLock();
    const started = Date.now();
    const blocked = await claimRaw();
    assert.ok(Date.now() - started >= 2_000, "claim did not wait on the shared advisory lock");
    await holder;
    assert.equal(blocked.job, null);
    assert.equal(blocked.code, undefined);

    await assertUtcBoundary();

    const first = await enqueue(USER_B, ROOM_B, ASSET_B, key(1));
    const second = await enqueue(USER_C, ROOM_C, ASSET_C, key(2));
    const raced = await Promise.all([claimRaw(), claimRaw()]);
    const winners = raced.filter((item) => item.job != null);
    assert.equal(winners.length, 1);
    assert.equal(raced.filter((item) => item.code === "global_busy").length, 1);
    assert.equal(await runningCount(), 1);
    const winner = winners[0]?.job as Json;
    const waitingId = [first.jobId, second.jobId].find((id) => id !== winner.jobId);
    assert.ok(waitingId);
    const waiting = await job(String(waitingId));
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.attempt_count, 0);
    assert.equal(waiting.provider_started_at, null);
    assert.equal(await due(String(waitingId)), true);

    const exactWhileRunning = await claimExactRaw(String(waitingId));
    assert.equal(exactWhileRunning.job, null);
    assert.equal(exactWhileRunning.code, "global_busy");
    assert.equal((await job(String(waitingId))).attempt_count, 0);
    assert.equal((await job(String(winner.jobId))).status, "running");

    await psql(`
      update public.vibode_harmonize_generations
        set status = 'queued', not_before = now(), attempt_count = 0,
            claim_nonce = null, claim_expires_at = null, claimed_at = null, heartbeat_at = null
      where id = '${String(winner.jobId)}' and status = 'running'
    `);
    const mixed = await Promise.all([
      claimRaw(),
      claimExactRaw(String(second.jobId)),
    ]);
    assert.equal(mixed.filter((item) => item.job != null).length, 1);
    assert.equal(mixed.filter((item) => item.code === "global_busy").length, 1);
    assert.equal(await runningCount(), 1);
    const attempts = await psql(
      `select coalesce(sum(attempt_count), 0) from public.vibode_harmonize_generations where id in ('${String(first.jobId)}', '${String(second.jobId)}')`,
    );
    assert.equal(attempts, "1");
    await clearActive();

    const queuedA = await enqueue(USER_A, ROOM_A, ASSET_A, key(3));
    const personal = await claimExactRaw(String(queuedA.jobId));
    assert.equal((personal.job as Json).jobId, queuedA.jobId);
    for (let index = 0; index < 9; index += 1) {
      await insertContact(USER_D, ROOM_D, ASSET_D, 200 + index);
    }
    const beforeTenth = await job(String(queuedA.jobId));
    assert.equal(beforeTenth.attempt_count, 1);
    assert.equal(beforeTenth.provider_started_at, null);
    await insertContact(USER_D, ROOM_D, ASSET_D, 209);
    const deferred = await contact(String(queuedA.jobId), String((personal.job as Json).claimNonce));
    assert.equal(deferred.ok, false);
    assert.equal(deferred.code, "global_daily_limit");
    const deferredRow = await job(String(queuedA.jobId));
    assert.equal(deferredRow.status, "queued");
    assert.equal(deferredRow.attempt_count, 0);
    assert.equal(deferredRow.provider_started_at, null);
    assert.equal(deferredRow.failure_code, null);
    assert.equal(await nextUtcDay(String(queuedA.jobId)), true);

    await parkAllProviderContacts();
    await psql(`update public.vibode_harmonize_generations set not_before = now() where id = '${queuedA.jobId}'`);
    const resumed = await claimExactRaw(String(queuedA.jobId));
    assert.equal((resumed.job as Json).jobId, queuedA.jobId);
    assert.equal((await job(String(queuedA.jobId))).attempt_count, 1);
    const stale = await contact(String(queuedA.jobId), "00000000-0000-4000-8000-000000000000");
    assert.equal(stale.code, "stale_claim");
    assert.equal((await job(String(queuedA.jobId))).status, "running");
    assert.equal((await job(String(queuedA.jobId))).provider_started_at, null);
    await expire(String(queuedA.jobId));
    const reclaimed = await claimRaw();
    assert.equal((reclaimed.job as Json).jobId, queuedA.jobId);
    assert.equal((await job(String(queuedA.jobId))).attempt_count, 2);
    assert.equal((await job(String(queuedA.jobId))).provider_started_at, null);
    const contacted = await contact(String(queuedA.jobId), String((reclaimed.job as Json).claimNonce));
    assert.equal(contacted.ok, true);
    await expire(String(queuedA.jobId));
    const reaped = await claimRaw();
    assert.equal(reaped.job, null);
    const uncertain = await job(String(queuedA.jobId));
    assert.equal(uncertain.status, "failed");
    assert.equal(uncertain.failure_code, "provider_uncertain");
    assert.ok(uncertain.provider_started_at);
    assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "1");

    await parkAllProviderContacts();
    await clearActive();
    for (let index = 0; index < 9; index += 1) await insertContact(USER_D, ROOM_D, ASSET_D, 300 + index);
    const left = await enqueue(USER_B, ROOM_B, ASSET_B, key(4));
    const right = await enqueue(USER_C, ROOM_C, ASSET_C, key(5));
    await markRunning(String(left.jobId), "11111111-1111-4111-8111-111111111111");
    await markRunning(String(right.jobId), "22222222-2222-4222-8222-222222222222");
    const race = await Promise.all([
      contact(String(left.jobId), "11111111-1111-4111-8111-111111111111"),
      contact(String(right.jobId), "22222222-2222-4222-8222-222222222222"),
    ]);
    const contactedRace = race.filter((item) => item.ok === true);
    const refusedRace = race.filter((item) => item.code === "global_daily_limit");
    assert.equal(contactedRace.length, 1);
    assert.equal(refusedRace.length, 1);
    assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "10");
    const refusedId = refusedRace[0] === race[0] ? String(left.jobId) : String(right.jobId);
    const refusedRow = await job(refusedId);
    assert.equal(refusedRow.status, "queued");
    assert.equal(refusedRow.attempt_count, 0);
    assert.equal(refusedRow.provider_started_at, null);
    assert.equal(await nextUtcDay(refusedId), true);
    const acceptedId = refusedId === String(left.jobId) ? String(right.jobId) : String(left.jobId);
    assert.ok((await job(acceptedId)).provider_started_at);

    await parkAllProviderContacts();
    await clearActive();
    for (let index = 0; index < 9; index += 1) await insertContact(USER_A, ROOM_A, ASSET_A, 400 + index);
    const overUser = await enqueue(USER_A, ROOM_A, ASSET_A, key(6));
    const other = await enqueue(USER_B, ROOM_B, ASSET_B, key(7));
    await insertContact(USER_A, ROOM_A, ASSET_A, 409);
    const bothFull = await claimRaw();
    assert.equal(bothFull.job, null);
    assert.equal(bothFull.code, "global_daily_limit");
    const overRow = await job(String(overUser.jobId));
    assert.equal(overRow.status, "failed");
    assert.equal(overRow.failure_code, "daily_limit");
    assert.equal(overRow.provider_started_at, null);
    const otherRow = await job(String(other.jobId));
    assert.equal(otherRow.status, "queued");
    assert.equal(otherRow.attempt_count, 0);
    assert.equal(otherRow.provider_started_at, null);
    assert.equal(await nextUtcDay(String(other.jobId)), true);

    await parkAllProviderContacts();
    await psql(`update public.vibode_harmonize_generations set not_before = now() where id = '${other.jobId}'`);
    for (let index = 0; index < 10; index += 1) await insertContact(USER_D, ROOM_D, ASSET_D, 500 + index);
    const exactFull = await claimExactRaw(String(other.jobId));
    assert.equal(exactFull.job, null);
    assert.equal(exactFull.code, "global_daily_limit");
    const exactRow = await job(String(other.jobId));
    assert.equal(exactRow.status, "queued");
    assert.equal(exactRow.attempt_count, 0);
    assert.equal(exactRow.provider_started_at, null);
    assert.equal(await nextUtcDay(String(other.jobId)), true);
    const untouched = await enqueue(USER_C, ROOM_C, ASSET_C, key(8));
    assert.equal(untouched.created, true);
    assert.equal((await job(String(untouched.jobId))).attempt_count, 0);
    assert.equal(await due(String(untouched.jobId)), true);
  } finally {
    await removeContainer();
  }
});

async function assertGrants(): Promise<void> {
  const grants = await psql(`
    select string_agg(signature || '=' || anon_exec || ',' || auth_exec || ',' || service_exec, '|' order by signature)
    from (
      select format('%s/%s', p.proname, pg_get_function_identity_arguments(p.oid)) as signature,
             has_function_privilege('anon', p.oid, 'execute')::text as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute')::text as auth_exec,
             has_function_privilege('service_role', p.oid, 'execute')::text as service_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'vibode_harmonize_global_provider_limit',
          'vibode_harmonize_global_provider_started_count',
          'claim_next_vibode_harmonize_generation',
          'contact_vibode_harmonize_generation'
        )
    ) grants
  `);
  assert.match(grants, /vibode_harmonize_global_provider_limit\/=false,false,true/);
  assert.match(grants, /vibode_harmonize_global_provider_started_count\/=false,false,true/);
  assert.match(grants, /claim_next_vibode_harmonize_generation\/=false,false,true/);
  assert.match(grants, /claim_next_vibode_harmonize_generation\/p_job_id uuid=false,false,true/);
  assert.match(grants, /contact_vibode_harmonize_generation\/p_job_id uuid, p_claim_nonce text=false,false,true/);
}

async function assertUtcBoundary(): Promise<void> {
  const day = "(date_trunc('day', now() at time zone 'utc') at time zone 'utc')";
  await insertContact(USER_D, ROOM_D, ASSET_D, 10, `${day} - interval '1 microsecond'`);
  assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "0");
  await insertContact(USER_D, ROOM_D, ASSET_D, 11, day);
  assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "1");
  await insertContact(USER_D, ROOM_D, ASSET_D, 12, `${day} + interval '1 day' - interval '1 microsecond'`);
  assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "2");
  await insertContact(USER_D, ROOM_D, ASSET_D, 13, `${day} + interval '1 day'`);
  assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "2");
  await psql(`delete from public.vibode_harmonize_generations where user_id = '${USER_D}'`);
  assert.equal(await psql("select public.vibode_harmonize_global_provider_started_count()"), "0");
}

async function insertContact(
  userId: string,
  roomId: string,
  assetId: string,
  index: number,
  startedAtSql = "now()",
): Promise<void> {
  const id = key(index);
  const idempotency = key(1_000 + index);
  await psql(`
    insert into public.vibode_harmonize_generations (
      id, user_id, room_id, source_version_id, idempotency_key, status,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot,
      composite_path, composite_byte_length, composite_width, composite_height,
      provider_started_at, provider_attempt_id, failure_code, failure_message, completed_at
    ) values (
      '${id}', '${userId}', '${roomId}', '${assetId}', '${idempotency}', 'failed',
      '${SHA}', '${SHA}', '${SHA}', '${SHA}', '${SHA}',
      'harmonize-universal-prompt/2.0', 'harmonize-prompt-assembly/1', '${GENERATION}',
      '{"prompt":"fixture"}'::jsonb,
      'rooms/${roomId}/intakes/${userId}/${idempotency}/composite.png',
      1000, 1200, 896,
      ${startedAtSql}, gen_random_uuid(), 'provider_uncertain', 'fixture', now()
    );
  `);
}

async function markRunning(jobId: string, nonce: string): Promise<void> {
  await psql(`
    update public.vibode_harmonize_generations
      set status = 'running',
          attempt_count = 1,
          claim_nonce = '${nonce}',
          claim_expires_at = now() + interval '240 seconds',
          claimed_at = now(),
          heartbeat_at = now()
    where id = '${jobId}'
  `);
}

async function clearActive(): Promise<void> {
  await psql(`
    update public.vibode_harmonize_generations
      set status = 'failed',
          failure_code = coalesce(failure_code, 'worker_interrupted'),
          failure_message = 'cleared',
          completed_at = coalesce(completed_at, now()),
          claim_nonce = null,
          claim_expires_at = null
    where status in ('queued', 'running')
  `);
}

async function parkAllProviderContacts(): Promise<void> {
  await psql(`
    alter table public.vibode_harmonize_generations disable trigger vibode_harmonize_generations_guard;
    update public.vibode_harmonize_generations
      set provider_started_at = now() - interval '2 days'
    where provider_started_at is not null;
    alter table public.vibode_harmonize_generations enable trigger vibode_harmonize_generations_guard;
  `);
}

async function runningCount(): Promise<number> {
  return Number(await psql("select count(*) from public.vibode_harmonize_generations where status = 'running'"));
}

async function due(jobId: string): Promise<boolean> {
  return (await psql(`select (not_before <= now())::text from public.vibode_harmonize_generations where id = '${jobId}'`)) === "true";
}

async function nextUtcDay(jobId: string): Promise<boolean> {
  return (await psql(`
    select (not_before = (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day')::text
    from public.vibode_harmonize_generations where id = '${jobId}'
  `)) === "true";
}

async function applyMigrations(): Promise<void> {
  await psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create table public.vibode_rooms (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade
    );
    create table public.vibode_room_assets (
      id uuid primary key,
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade
    );
    create schema if not exists storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text
    );
    alter table storage.objects enable row level security;
  `);
  for (const file of MIGRATIONS) {
    await psql(readFileSync(path.join(process.cwd(), "supabase/migrations", file), "utf8"));
  }
}

async function seedOwner(userId: string, roomId: string, assetId: string): Promise<void> {
  await psql(`
    insert into auth.users (id) values ('${userId}');
    insert into public.vibode_rooms (id, user_id) values ('${roomId}', '${userId}');
    insert into public.vibode_room_assets (id, room_id, user_id) values ('${assetId}', '${roomId}', '${userId}');
  `);
}

async function enqueue(userId: string, roomId: string, assetId: string, idempotencyKey: string): Promise<Json> {
  const payload = {
    roomId,
    sourceVersionId: assetId,
    idempotencyKey,
    requestSha256: SHA,
    sceneSnapshotSha256: SHA,
    backgroundSha256: SHA,
    compositeSha256: SHA,
    promptSha256: SHA,
    promptVersion: "harmonize-universal-prompt/2.0",
    assemblyVersion: "harmonize-prompt-assembly/1",
    afcGenerationId: GENERATION,
    compositePath: `rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png`,
    compositeByteLength: 1000,
    compositeWidth: 1200,
    compositeHeight: 896,
    snapshot: { prompt: "server assembled prompt" },
  };
  return call(
    `select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`,
  );
}

async function claimRaw(): Promise<Json> {
  return call("select public.claim_next_vibode_harmonize_generation()");
}

async function claimExactRaw(jobId: string): Promise<Json> {
  return call(`select public.claim_next_vibode_harmonize_generation('${jobId}'::uuid)`);
}

async function contact(jobId: string, nonce: string): Promise<Json> {
  return call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
}

async function expire(jobId: string): Promise<void> {
  await psql(`update public.vibode_harmonize_generations set claim_expires_at = now() - interval '1 second' where id = '${jobId}'`);
}

async function job(jobId: string): Promise<Json> {
  const text = await psql(`
    select json_build_object(
      'status', status,
      'provider_started_at', provider_started_at,
      'attempt_count', attempt_count,
      'failure_code', failure_code
    ) from public.vibode_harmonize_generations where id = '${jobId}'
  `);
  return JSON.parse(text) as Json;
}

function key(index: number): string {
  return `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`;
}

async function call(sql: string): Promise<Json> {
  const text = firstJson(await psql(sql));
  const parsed = JSON.parse(text) as Json | number;
  if (typeof parsed === "number") return { ok: true, value: parsed };
  return parsed;
}

function firstJson(text: string): string {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("{") || /^-?\d+$/.test(item));
  if (!line) throw new Error(`no json in psql output:\n${text}`);
  return line;
}

async function waitForLock(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const locks = Number(await psql(
      "select count(*) from pg_locks where locktype = 'advisory' and classid = 8142 and objid = 20261015 and granted",
    ));
    if (locks > 0) return;
    await delay(50);
  }
  throw new Error("timed out waiting for the harmonize claim lock");
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=harmonize",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-t", "-A", "-c", "select 1",
      ]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  const logs = await docker(["logs", CONTAINER]);
  throw new Error(`disposable postgres 16 did not become ready\n${logs.stdout}\n${logs.stderr}`);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
