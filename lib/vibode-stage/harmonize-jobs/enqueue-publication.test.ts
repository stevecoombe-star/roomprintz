/**
 * Applies the Harmonize enqueue publication migration to a disposable
 * Postgres 16 container. This does not connect to hosted Supabase.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "harmonize-pg-3b1b-disposable";
const SHA = "ab".repeat(32);
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ROOM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ASSET_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const STORED_SCENE = JSON.stringify([
  {
    objectId: "chair-b",
    assetId: "asset-b",
    transform: { position: { x: 2, y: 0, z: 3 }, rotationDeg: { x: 0, y: 0, z: 0 }, uniformScale: 1 },
  },
  {
    objectId: "chair-a",
    assetId: "asset-a",
    transform: { position: { x: 0.2, y: 0, z: 1 }, rotationDeg: { x: 0, y: 0, z: 0 }, uniformScale: 1 },
  },
]);

type Json = Record<string, unknown>;

test("enqueue publication sql requires the capture fields in the original insert", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261013150000_vibode_harmonize_enqueue_publication.sql"),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.enqueue_vibode_harmonize_generation/);
  assert.match(sql, /vibode_harmonize_publication_enqueue_ready/);
  assert.match(sql, /backdrop_kind, scene_objects/);
  assert.match(sql, /20261013140000_vibode_harmonize_history_publication\.sql/);
  assert.match(sql, /vibode_harmonize_provider_started_count\(p_user_id\) >= 10/);
  assert.match(sql, /idempotency_conflict/);
  assert.doesNotMatch(sql, /create or replace function public\.complete_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /create or replace function public\.claim_next_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /create or replace function public\.contact_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /publish_vibode_harmonize_history/);
  assert.doesNotMatch(sql, /pg_notify|cron\.schedule/);
  assert.doesNotMatch(sql, /provider_started_at\s*=/);
  const insertAt = sql.indexOf("insert into public.vibode_harmonize_generations");
  const backdropAt = sql.indexOf("v_backdrop,");
  assert.ok(insertAt > 0 && backdropAt > insertAt);
});

test("postgres 16 stores backdrop and canonical objects on the queued insert", { timeout: 300_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await applyMigrations();
    assert.match(await psql("select current_setting('server_version')"), /^16\./);
    assert.equal(await psql("select public.vibode_harmonize_publication_enqueue_ready()"), "t");

    await seed(USER_A, ROOM_A, ASSET_A);
    await seed(USER_B, ROOM_B, ASSET_B);
    const before = await count("select count(*) from public.vibode_harmonize_generations");
    const missing = await enqueue(USER_A, ROOM_A, ASSET_A, key(1), 1200, 896, {});
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "invalid_submission");
    const unknown = await enqueue(USER_A, ROOM_A, ASSET_A, key(1), 1200, 896, {
      backdropKind: "client-label",
      sceneObjects: JSON.parse(STORED_SCENE) as unknown[],
    });
    assert.equal(unknown.code, "invalid_submission");
    assert.equal(await count("select count(*) from public.vibode_harmonize_generations"), before);

    const created = await enqueue(USER_A, ROOM_A, ASSET_A, key(1), 1200, 896, {
      backdropKind: "room_asset",
      sceneObjects: JSON.parse(STORED_SCENE) as unknown[],
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.created, true);
    assert.equal(created.backdropKind, "room_asset");
    assert.equal(created.status, "queued");
    const jobId = String(created.jobId);
    const row = await job(jobId);
    assert.equal(row.status, "queued");
    assert.equal(row.history_state, "pending");
    assert.equal(row.backdrop_kind, "room_asset");
    assert.equal(row.provider_started_at, null);
    assert.equal(row.first_object_id, "chair-b");
    assert.equal(row.second_object_id, "chair-a");
    assert.equal(row.scene_match, true);
    assert.equal(await count("select count(*) from public.vibode_harmonize_generations"), before + 1);

    const tenRatio = await enqueue(USER_B, ROOM_B, ASSET_B, key(2), 1264, 848, {
      backdropKind: "afc_empty",
      sceneObjects: [],
    });
    assert.equal(tenRatio.ok, true, JSON.stringify(tenRatio));
    assert.equal(tenRatio.backdropKind, "afc_empty");
    const ten = await job(String(tenRatio.jobId));
    assert.equal(ten.composite_width, 1264);
    assert.equal(ten.composite_height, 848);
    assert.equal(ten.provider_started_at, null);
    assert.equal(ten.status, "queued");

    const replay = await enqueue(USER_A, ROOM_A, ASSET_A, key(1), 1200, 896, {
      backdropKind: "afc_empty",
      sceneObjects: [],
    });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.created, false);
    assert.equal(replay.jobId, jobId);
    const replayed = await job(jobId);
    assert.equal(replayed.backdrop_kind, "room_asset");
    assert.equal(replayed.scene_match, true);
    assert.equal(replayed.history_state, "pending");
    const omitted = await enqueue(USER_A, ROOM_A, ASSET_A, key(1), 1200, 896, {});
    assert.equal(omitted.ok, false);
    assert.equal(omitted.code, "invalid_submission");
    const blocked = await enqueue(USER_A, ROOM_A, ASSET_A, key(3), 1200, 896, {
      backdropKind: "room_asset",
      sceneObjects: JSON.parse(STORED_SCENE) as unknown[],
    });
    assert.equal(blocked.code, "active_job");
    assert.equal(await count("select count(*) from public.vibode_harmonize_generations"), before + 2);

    const queuedEdit = await psqlFailure(
      `update public.vibode_harmonize_generations set backdrop_kind = 'afc_original' where id = '${jobId}'`,
    );
    assert.match(queuedEdit, /harmonize backdrop is immutable/);
    const claimed = await call(`select public.claim_next_vibode_harmonize_generation('${jobId}'::uuid)`);
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    const claim = claimed.job as Json;
    assert.equal(claim.jobId, jobId);
    const running = await job(jobId);
    assert.equal(running.status, "running");
    assert.equal(running.history_state, "pending");
    assert.equal(running.backdrop_kind, "room_asset");
    assert.equal(running.scene_match, true);
    assert.equal(running.provider_started_at, null);
    const runningEdit = await psqlFailure(
      `update public.vibode_harmonize_generations set scene_objects = '[]'::jsonb where id = '${jobId}'`,
    );
    assert.match(runningEdit, /harmonize scene snapshot is immutable/);

    const privileges = await psql(`
      select has_function_privilege('anon', 'public.enqueue_vibode_harmonize_generation(uuid, jsonb)', 'execute')::text
        || ',' || has_function_privilege('authenticated', 'public.enqueue_vibode_harmonize_generation(uuid, jsonb)', 'execute')::text
        || ',' || has_function_privilege('service_role', 'public.enqueue_vibode_harmonize_generation(uuid, jsonb)', 'execute')::text
        || ',' || has_function_privilege('anon', 'public.vibode_harmonize_publication_enqueue_ready()', 'execute')::text
        || ',' || has_function_privilege('authenticated', 'public.vibode_harmonize_publication_enqueue_ready()', 'execute')::text
        || ',' || has_function_privilege('service_role', 'public.vibode_harmonize_publication_enqueue_ready()', 'execute')::text
    `);
    assert.equal(privileges, "false,false,true,false,false,true");
  } finally {
    await removeContainer();
  }
});

async function applyMigrations(): Promise<void> {
  await psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create table public.vibode_rooms (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      active_asset_id uuid null,
      current_afc_generation_id uuid null,
      room_scale_multiplier double precision not null default 1.0,
      current_stage smallint not null default 3,
      sort_key timestamptz not null default now()
    );
    create table public.vibode_room_assets (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      asset_type text not null default 'base',
      stage_number smallint null,
      storage_bucket text null,
      storage_path text null,
      thumbnail_storage_bucket text null,
      thumbnail_storage_path text null,
      image_url text not null default '',
      width integer null,
      height integer null,
      model_version text null,
      is_active boolean not null default false,
      metadata jsonb not null default '{}'::jsonb
    );
    create unique index vibode_room_assets_id_room_id_uidx
      on public.vibode_room_assets (id, room_id);
    create table public.vibode_generation_runs (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      run_type text not null,
      stage_number smallint null,
      source_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
      output_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
      model_version text null,
      aspect_ratio text null,
      status text not null default 'completed',
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb not null default '{}'::jsonb,
      completed_at timestamptz null
    );
    create table public.vibode_3d_scenes (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      version_id uuid not null,
      user_id uuid not null references auth.users(id) on delete cascade,
      afc_generation_id uuid not null,
      objects_json jsonb not null
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
  for (const file of [
    "supabase/migrations/20261012090000_vibode_harmonize_generations.sql",
    "supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql",
    "supabase/migrations/20261013140000_vibode_harmonize_history_publication.sql",
    "supabase/migrations/20261013150000_vibode_harmonize_enqueue_publication.sql",
  ]) {
    await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
  }
}

async function seed(userId: string, roomId: string, assetId: string): Promise<void> {
  await psql(`
    insert into auth.users (id) values ('${userId}');
    insert into public.vibode_rooms (id, user_id, active_asset_id) values ('${roomId}', '${userId}', '${assetId}');
    insert into public.vibode_room_assets (id, room_id, user_id, image_url) values ('${assetId}', '${roomId}', '${userId}', '');
  `);
}

async function enqueue(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  width: number,
  height: number,
  publication: Readonly<{ backdropKind?: string; sceneObjects?: unknown[] }>,
): Promise<Json> {
  const payload: Record<string, unknown> = {
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
    compositeWidth: width,
    compositeHeight: height,
    snapshot: { prompt: "server assembled prompt" },
    ...publication,
  };
  return call(
    `select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`,
  );
}

async function job(jobId: string): Promise<Json> {
  return readJson(`
    select json_build_object(
      'status', status,
      'history_state', history_state,
      'backdrop_kind', backdrop_kind,
      'provider_started_at', provider_started_at,
      'composite_width', composite_width,
      'composite_height', composite_height,
      'first_object_id', scene_objects->0->>'objectId',
      'second_object_id', scene_objects->1->>'objectId',
      'scene_match', scene_objects = ${quote(STORED_SCENE)}::jsonb
    ) from public.vibode_harmonize_generations where id = '${jobId}'
  `);
}

function key(index: number): string {
  return `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(sql));
}

async function readJson(sql: string): Promise<Json> {
  return JSON.parse(await psql(sql)) as Json;
}

async function call(sql: string): Promise<Json> {
  const text = (await psql(sql)).split("\n").map((item) => item.trim()).find((item) => item.startsWith("{"));
  if (!text) throw new Error(`no json from:\n${sql}`);
  return JSON.parse(text) as Json;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
    if (`${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete")) {
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

async function psqlFailure(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  assert.notEqual(result.code, 0);
  return `${result.stderr}\n${result.stdout}`;
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql}`);
  return result.stdout.trim();
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
