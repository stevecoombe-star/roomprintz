/**
 * Publication orchestration against disposable Postgres 16.
 * Storage is in memory. The publication RPC and its locks are real.
 * This does not connect to hosted Supabase.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createHarmonizeFakeJpeg } from "@/lib/vibode-stage/harmonize-jobs/fake-jpeg";
import {
  createHarmonizeHistoryObjectStore,
  publishPreparedHarmonizeHistory,
  recoverHarmonizeHistoryPublication,
  type HarmonizeHistoryPublishResult,
  type HarmonizePublicationJob,
} from "@/lib/vibode-stage/harmonize-jobs/history-publication";
import {
  VIBODE_HARMONIZE_BUCKET,
  VIBODE_HISTORY_BUCKET,
  harmonizeHistoryObjectPath,
} from "@/lib/vibode-stage/harmonize-jobs/policy";

const CONTAINER = "harmonize-pg-3b1c-disposable";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ROOM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ASSET_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SCENE = JSON.stringify([{ objectId: "obj-1", assetId: "asset-1", transform: { uniformScale: 1, position: { x: 1, y: 0, z: 2 } } }]);
const SCENE_MOVED = JSON.stringify([{ objectId: "obj-1", assetId: "asset-1", transform: { uniformScale: 1, position: { x: 9, y: 0, z: 2 } } }]);
const createdThumbnails = new Set<string>();

type Json = Record<string, unknown>;

test("postgres 16 publication is idempotent and does not mutate authority", { timeout: 300_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await applyMigrations();
    assert.match(await psql("select current_setting('server_version')"), /^16\./);
    const jpeg = await createHarmonizeFakeJpeg();
    const digest = createHash("sha256").update(jpeg).digest("hex");
    await seed();

    const sibling = await enqueue(USER_B, ROOM_B, ASSET_B, key(1));
    assert.equal(sibling.ok, true, JSON.stringify(sibling));
    const matched = await succeed(USER_A, ROOM_A, ASSET_A, key(2), digest, jpeg);
    const providerBefore = await providerStamp(matched.jobId);
    const afcBefore = await count("select count(*) from public.vibode_afc_generations");
    const sceneBefore = await psql(`select objects_json::text from public.vibode_3d_scenes where version_id = '${ASSET_A}'`);

    const published = await orchestrate(matched.jobId, jpeg);
    assert.equal(published.code, "published");
    assert.equal(published.activated, true);
    assert.equal(published.thumbnail, "created");
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${matched.jobId}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${matched.jobId}'`), 1);
    assert.equal(await psql(`select objects_json::text from public.vibode_3d_scenes where version_id = '${ASSET_A}'`), sceneBefore);
    assert.equal(await count("select count(*) from public.vibode_afc_generations"), afcBefore);
    assert.equal(await providerStamp(matched.jobId), providerBefore);
    assert.equal((await room(ROOM_A)).current_afc_generation_id, GENERATION);

    const again = await orchestrate(matched.jobId, jpeg);
    assert.equal(again.code, "already_published");
    assert.equal(again.activated, false);
    assert.equal(again.thumbnail, "present");
    assert.equal(again.assetId, published.assetId);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${matched.jobId}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${matched.jobId}'`), 1);

    const parallel = await succeed(USER_A, ROOM_A, ASSET_A, key(3), digest, jpeg);
    const [left, right] = await Promise.all([
      orchestrate(parallel.jobId, jpeg),
      orchestrate(parallel.jobId, jpeg),
    ]);
    assert.deepEqual([left.code, right.code].sort(), ["already_published", "published"]);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${parallel.jobId}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${parallel.jobId}'`), 1);

    const crashed = await succeed(USER_A, ROOM_A, ASSET_A, key(4), digest, jpeg);
    const storage = seeded(crashed.outputPath, jpeg);
    let stopped = false;
    const interrupted = await publishPreparedHarmonizeHistory({
      job: await loadJob(crashed.jobId),
      storage,
      publish: async () => {
        if (!stopped) {
          stopped = true;
          throw new Error("stopped before SQL");
        }
        return rpc(crashed.jobId, digest);
      },
      thumbnail: async () => "created",
    });
    assert.equal(interrupted.code, "publication_failed");
    assert.equal((await loadJob(crashed.jobId)).historyState, "pending");
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${crashed.jobId}'`), 0);
    const resumed = await publishPreparedHarmonizeHistory({
      job: await loadJob(crashed.jobId),
      storage,
      publish: () => rpc(crashed.jobId, digest),
      thumbnail: async () => "created",
    });
    assert.equal(resumed.code, "published");
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${crashed.jobId}'`), 1);
    assert.equal(storage.has(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM_A, crashed.jobId)), true);

    const drifted = await succeed(USER_A, ROOM_A, ASSET_A, key(5), digest, jpeg);
    await psql(`update public.vibode_3d_scenes set objects_json = ${quote(SCENE_MOVED)}::jsonb where version_id = '${ASSET_A}'`);
    await psql(`update public.vibode_rooms set room_scale_multiplier = 1.5 where id = '${ROOM_A}'`);
    const roomBeforeDrift = await room(ROOM_A);
    const drift = await orchestrate(drifted.jobId, jpeg);
    assert.equal(drift.code, "published");
    assert.equal(drift.activated, false);
    assert.equal((await room(ROOM_A)).active_asset_id, roomBeforeDrift.active_asset_id);
    assert.equal((await room(ROOM_A)).room_scale_multiplier, 1.5);
    assert.equal((await room(ROOM_A)).current_afc_generation_id, GENERATION);
    assert.equal(await psql(`select objects_json::text from public.vibode_3d_scenes where version_id = '${ASSET_A}'`), await psql(`select ${quote(SCENE_MOVED)}::jsonb::text`));
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), 1);
    assert.equal(await count("select count(*) from public.vibode_afc_generations"), afcBefore);

    const mismatchId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
    await insertSucceeded(mismatchId, USER_A, ROOM_A, ASSET_B, key(6), digest);
    const mismatchStorage = seeded(outputPath(ROOM_A, mismatchId), jpeg);
    let mismatchCalls = 0;
    const mismatch = await recoverHarmonizeHistoryPublication({
      job: await loadJob(mismatchId),
      publish: async (job) => {
        mismatchCalls += 1;
        return publishPreparedHarmonizeHistory({
          job,
          storage: mismatchStorage,
          publish: () => rpc(job.id, digest),
          thumbnail: async () => "created",
        });
      },
      sleep: async () => {
        throw new Error("source_mismatch was retried");
      },
    });
    assert.equal(mismatch.code, "source_mismatch");
    assert.equal(mismatchCalls, 1);
    assert.equal((await loadJob(mismatchId)).historyState, "pending");
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${mismatchId}'`), 0);

    const legacyId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
    await insertSucceeded(legacyId, USER_A, ROOM_A, ASSET_A, key(7), digest, "unavailable");
    let legacyDownloads = 0;
    const legacy = await publishPreparedHarmonizeHistory({
      job: await loadJob(legacyId),
      storage: {
        async download() {
          legacyDownloads += 1;
          return jpeg;
        },
        async putIfAbsent() {
          throw new Error("legacy job was copied");
        },
      },
      publish: () => {
        throw new Error("legacy job was published");
      },
    });
    assert.equal(legacy.code, "not_publishable");
    assert.equal(legacyDownloads, 0);
    assert.equal((await loadJob(legacyId)).historyState, "unavailable");

    const deleted = await succeed(USER_A, ROOM_A, ASSET_A, key(8), digest, jpeg);
    const deletedProvider = await providerStamp(deleted.jobId);
    const scenesBeforeDelete = await count("select count(*) from public.vibode_3d_scenes");
    await psql(`delete from public.vibode_room_assets where id = '${ASSET_A}'`);
    assert.equal((await loadJob(deleted.jobId)).historyState, "pending");
    const orphan = await orchestrate(deleted.jobId, jpeg);
    assert.equal(orphan.code, "published");
    assert.equal(orphan.activated, false);
    assert.equal(await count("select count(*) from public.vibode_3d_scenes"), scenesBeforeDelete - 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${deleted.jobId}'`), 1);
    assert.equal(await count("select count(*) from public.vibode_afc_generations"), afcBefore);
    assert.equal(await providerStamp(deleted.jobId), deletedProvider);

    const siblingRow = await loadJob(String(sibling.jobId));
    assert.equal(siblingRow.status, "queued");
    assert.equal(siblingRow.historyState, "pending");
    assert.equal(siblingRow.outputSha256, null);
  } finally {
    await removeContainer();
  }
});

async function orchestrate(jobId: string, jpeg: Uint8Array) {
  const job = await loadJob(jobId);
  const storage = seeded(job.outputPath ?? "", jpeg);
  return publishPreparedHarmonizeHistory({
    job,
    storage,
    publish: (args) => rpc(args.jobId, args.outputSha256),
    thumbnail: async ({ assetId }) => {
      if (createdThumbnails.has(assetId)) return "present";
      createdThumbnails.add(assetId);
      return "created";
    },
  });
}

function seeded(output: string, jpeg: Uint8Array) {
  const storage = createHarmonizeHistoryObjectStore();
  storage.seed(VIBODE_HARMONIZE_BUCKET, output, jpeg);
  return storage;
}

async function rpc(jobId: string, digest: string): Promise<HarmonizeHistoryPublishResult> {
  const row = await call(`
    select set_config('harmonize.test_allow_scene_write', 'off', false);
    select set_config('harmonize.test_allow_afc_write', 'off', false);
    select public.publish_vibode_harmonize_history(
      '${jobId}', '${digest}', '${VIBODE_HISTORY_BUCKET}', '${harmonizeHistoryObjectPath(ROOM_A, jobId)}'
    );
  `);
  const code = String(row.code ?? "");
  if (row.ok === true && (code === "published" || code === "already_published")) {
    return {
      ok: true,
      code,
      assetId: typeof row.assetId === "string" ? row.assetId : null,
      generationRunId: typeof row.generationRunId === "string" ? row.generationRunId : null,
      activated: row.activated === true,
    };
  }
  return { ok: false, code: code || "unavailable" };
}

async function succeed(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  digest: string,
  jpeg: Uint8Array,
): Promise<Readonly<{ jobId: string; outputPath: string }>> {
  const created = await enqueue(userId, roomId, assetId, idempotencyKey);
  assert.equal(created.ok, true, JSON.stringify(created));
  const jobId = String(created.jobId);
  const claimed = await call(`select public.claim_next_vibode_harmonize_generation('${jobId}'::uuid)`);
  const claim = claimed.job as Json;
  assert.equal(claim.jobId, jobId);
  const nonce = String(claim.claimNonce);
  const contacted = await call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
  assert.equal(contacted.ok, true, JSON.stringify(contacted));
  const output = outputPath(roomId, jobId, nonce);
  const finished = await call(
    `select public.complete_vibode_harmonize_generation('${jobId}', '${nonce}', '${digest}', '${output}', 'gemini-3-pro-image', 'completed', 200, 10, 2400, 1792)`,
  );
  assert.equal(finished.code, "completed", JSON.stringify(finished));
  assert.equal(jpeg.byteLength > 0, true);
  return { jobId, outputPath: output };
}

async function enqueue(userId: string, roomId: string, assetId: string, idempotencyKey: string): Promise<Json> {
  const payload = {
    roomId,
    sourceVersionId: assetId,
    idempotencyKey,
    requestSha256: "ab".repeat(32),
    sceneSnapshotSha256: "ab".repeat(32),
    backgroundSha256: "ab".repeat(32),
    compositeSha256: "ab".repeat(32),
    promptSha256: "ab".repeat(32),
    promptVersion: "harmonize-universal-prompt/2.0",
    assemblyVersion: "harmonize-prompt-assembly/1",
    afcGenerationId: GENERATION,
    backdropKind: "room_asset",
    sceneObjects: JSON.parse(SCENE) as unknown[],
    compositePath: `rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png`,
    compositeByteLength: 1000,
    compositeWidth: 1200,
    compositeHeight: 896,
    snapshot: { prompt: "server assembled prompt", roomScaleMultiplier: 1 },
  };
  return call(`select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`);
}

async function insertSucceeded(
  jobId: string,
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  digest: string,
  historyState = "pending",
): Promise<void> {
  await psql(`
    insert into public.vibode_harmonize_generations (
      id, user_id, room_id, source_version_id, idempotency_key, kind, status, history_state,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot,
      composite_path, composite_byte_length, composite_width, composite_height,
      output_bucket, output_path, output_sha256, output_mime, output_width, output_height,
      provider_started_at, provider_attempt_id, backdrop_kind, scene_objects
    ) values (
      '${jobId}', '${userId}', '${roomId}', '${assetId}', '${idempotencyKey}', 'initial', 'succeeded', '${historyState}',
      '${digest}', '${digest}', '${digest}', '${digest}', '${digest}',
      'harmonize-universal-prompt/2.0', 'harmonize-prompt-assembly/1', '${GENERATION}',
      '{"prompt":"server assembled prompt","roomScaleMultiplier":1}'::jsonb,
      'rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png', 1000, 1200, 896,
      '${VIBODE_HARMONIZE_BUCKET}', '${outputPath(roomId, jobId)}', '${digest}', 'image/jpeg', 2400, 1792,
      now(), gen_random_uuid(), 'room_asset', ${quote(SCENE)}::jsonb
    );
  `);
}

async function loadJob(jobId: string): Promise<HarmonizePublicationJob> {
  const row = await readJson(`
    select json_build_object(
      'id', id,
      'userId', user_id,
      'roomId', room_id,
      'status', status,
      'historyState', history_state,
      'outputBucket', output_bucket,
      'outputPath', output_path,
      'outputSha256', output_sha256,
      'outputMime', output_mime,
      'outputWidth', output_width,
      'outputHeight', output_height,
      'compositeWidth', composite_width,
      'compositeHeight', composite_height,
      'backdropKind', backdrop_kind,
      'sceneObjects', scene_objects,
      'outputAssetId', output_asset_id
    ) from public.vibode_harmonize_generations where id = '${jobId}'
  `);
  return row as unknown as HarmonizePublicationJob;
}

async function providerStamp(jobId: string): Promise<string> {
  return psql(`select provider_started_at::text || '|' || provider_attempt_id::text from public.vibode_harmonize_generations where id = '${jobId}'`);
}

async function room(roomId: string): Promise<Json> {
  return readJson(`
    select json_build_object(
      'active_asset_id', active_asset_id,
      'current_afc_generation_id', current_afc_generation_id,
      'room_scale_multiplier', room_scale_multiplier
    ) from public.vibode_rooms where id = '${roomId}'
  `);
}

async function seed(): Promise<void> {
  await psql(`
    insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
    insert into public.vibode_rooms (
      id, user_id, active_asset_id, current_afc_generation_id, room_scale_multiplier, current_stage, sort_key
    ) values
      ('${ROOM_A}', '${USER_A}', '${ASSET_A}', '${GENERATION}', 1.0, 3, now()),
      ('${ROOM_B}', '${USER_B}', '${ASSET_B}', '${GENERATION}', 1.0, 3, now());
    insert into public.vibode_room_assets (
      id, room_id, user_id, asset_type, image_url, is_active, stage_number
    ) values
      ('${ASSET_A}', '${ROOM_A}', '${USER_A}', 'base', 'https://example.test/original.jpg', true, 3),
      ('${ASSET_B}', '${ROOM_B}', '${USER_B}', 'base', 'https://example.test/other.jpg', true, 3);
    insert into public.vibode_3d_scenes (
      room_id, version_id, user_id, afc_generation_id, objects_json
    ) values (
      '${ROOM_A}', '${ASSET_A}', '${USER_A}', '${GENERATION}', ${quote(SCENE)}::jsonb
    );
    insert into public.vibode_afc_generations (id, room_id, user_id, status)
    values ('${GENERATION}', '${ROOM_A}', '${USER_A}', 'certified');
  `);
}

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
      objects_json jsonb not null,
      constraint vibode_3d_scenes_version_room_fkey
        foreign key (version_id, room_id)
        references public.vibode_room_assets (id, room_id)
        on delete cascade
    );
    create table public.vibode_afc_generations (
      id uuid primary key,
      room_id uuid not null,
      user_id uuid not null,
      status text not null
    );
    create or replace function public.forbid_harmonize_scene_write()
    returns trigger language plpgsql as $$
    begin
      if current_setting('harmonize.test_allow_scene_write', true) is distinct from 'off' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end if;
      raise exception 'scene write during publication';
    end $$;
    create trigger forbid_harmonize_scene_write
    before insert or update or delete on public.vibode_3d_scenes
    for each row execute function public.forbid_harmonize_scene_write();
    create or replace function public.forbid_harmonize_afc_write()
    returns trigger language plpgsql as $$
    begin
      if current_setting('harmonize.test_allow_afc_write', true) is distinct from 'off' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end if;
      raise exception 'afc write during publication';
    end $$;
    create trigger forbid_harmonize_afc_write
    before insert or update or delete on public.vibode_afc_generations
    for each row execute function public.forbid_harmonize_afc_write();
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
  const root = process.cwd();
  await psql(readFileSync(path.join(root, "supabase/migrations/20261012090000_vibode_harmonize_generations.sql"), "utf8"));
  await psql(readFileSync(path.join(root, "supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql"), "utf8"));
  await psql("grant usage on schema public to anon, authenticated");
  await psql(readFileSync(path.join(root, "supabase/migrations/20261013140000_vibode_harmonize_history_publication.sql"), "utf8"));
  await psql(readFileSync(path.join(root, "supabase/migrations/20261013150000_vibode_harmonize_enqueue_publication.sql"), "utf8"));
}

function outputPath(roomId: string, jobId: string, nonce = "nonce"): string {
  return `rooms/${roomId}/jobs/${jobId}/output-${nonce}.jpg`;
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

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql}`);
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
