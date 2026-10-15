/**
 * Executes the unapplied Harmonize migration against a disposable Postgres 16
 * container. This does not connect to the project Supabase database.
 *
 * Supabase Auth JWTs, the Storage HTTP API, and service-role RLS bypass are
 * platform behavior. The harness stubs the tables and roles the migration
 * references, then states where that stub is not the hosted product.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "harmonize-pg-3a-disposable";
const SHA = "ab".repeat(32);
const OTHER_SHA = "cd".repeat(32);

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const USER_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const ROOM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ROOM_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const ASSET_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ASSET_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

type Json = Record<string, unknown>;

test("postgres 16 executes the harmonize migration and job functions", { timeout: 300_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await applyMigration();
    const version = await psql("select current_setting('server_version')");
    assert.match(version, /^16\./);

    await seedOwner(USER_A, ROOM_A, ASSET_A);
    await seedOwner(USER_B, ROOM_B, ASSET_B);
    await seedOwner(USER_C, ROOM_C, ASSET_C);

    const created = await enqueue(USER_A, ROOM_A, ASSET_A, key(1));
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.status, "queued");
    const jobId = String(created.jobId);
    const row = await job(jobId);
    assert.equal(row.status, "queued");
    assert.equal(row.provider_started_at, null);

    const replay = await enqueue(USER_A, ROOM_A, ASSET_A, key(1));
    assert.equal(replay.created, false);
    assert.equal(replay.jobId, jobId);
    const conflict = await enqueue(USER_A, ROOM_A, ASSET_A, key(1), { requestSha256: OTHER_SHA });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, "idempotency_conflict");

    const second = await enqueue(USER_A, ROOM_A, ASSET_A, key(2));
    assert.equal(second.code, "active_job");

    const claimed = await claimJob();
    assert.equal(claimed.jobId, jobId);
    assert.equal((await job(jobId)).status, "running");
    assert.equal((await job(jobId)).provider_started_at, null);
    assert.equal((await job(jobId)).attempt_count, 1);

    const otherClaim = await claim();
    assert.equal(otherClaim, null);

    await expire(jobId);
    const reclaimed = await claimJob();
    assert.equal(reclaimed.jobId, jobId);
    assert.equal((await job(jobId)).attempt_count, 2);
    assert.equal((await job(jobId)).provider_started_at, null);
    const nonce = String(reclaimed.claimNonce);

    const interrupted = await fail(jobId, nonce, "worker_interrupted", true);
    assert.equal(interrupted.code, "requeued");
    assert.equal((await job(jobId)).status, "queued");
    assert.equal((await job(jobId)).provider_started_at, null);
    assert.equal(await claim(), null);
    await psql(`update public.vibode_harmonize_generations set not_before = now() where id = '${jobId}'`);
    const afterBackoff = await claimJob();
    assert.equal(afterBackoff.jobId, jobId);
    const liveNonce = String(afterBackoff.claimNonce);

    const contacted = await contact(jobId, liveNonce);
    assert.equal(contacted.ok, true);
    const started = (await job(jobId)).provider_started_at;
    assert.ok(started);
    const again = await contact(jobId, liveNonce);
    assert.equal(again.code, "already_contacted");
    assert.equal((await job(jobId)).provider_started_at, started);

    const heartbeat = await call(`select public.heartbeat_vibode_harmonize_generation('${jobId}', '${liveNonce}')`);
    assert.equal(heartbeat.ok, true);
    const wrongBeat = await call(`select public.heartbeat_vibode_harmonize_generation('${jobId}', '00000000-0000-4000-8000-000000000000')`);
    assert.equal(wrongBeat.code, "stale_claim");

    const badSha = await complete(jobId, liveNonce, "not-a-sha", outputPath(ROOM_A, jobId, liveNonce), 2400, 1792);
    assert.equal(badSha.code, "unexpected_output");
    assert.equal((await job(jobId)).status, "running");
    const badPath = await complete(jobId, liveNonce, SHA, "rooms/wrong.jpg", 2400, 1792);
    assert.equal(badPath.code, "stale_claim");
    assert.equal((await job(jobId)).status, "running");
    const wrongNonce = await complete(jobId, "00000000-0000-4000-8000-000000000000", SHA, outputPath(ROOM_A, jobId, liveNonce), 2400, 1792);
    assert.equal(wrongNonce.code, "stale_claim");

    const finished = await complete(jobId, liveNonce, SHA, outputPath(ROOM_A, jobId, liveNonce), 1600, 1200);
    assert.equal(finished.code, "completed");
    const done = await job(jobId);
    assert.equal(done.status, "succeeded");
    assert.equal(done.output_width, 1600);
    assert.equal(done.output_height, 1200);
    assert.equal(done.output_sha256, SHA);
    const duplicate = await complete(jobId, liveNonce, OTHER_SHA, outputPath(ROOM_A, jobId, liveNonce), 1600, 1200);
    assert.equal(duplicate.code, "already_complete");
    assert.equal((await job(jobId)).output_sha256, SHA);
    const staleDone = await complete(jobId, "00000000-0000-4000-8000-000000000099", SHA, outputPath(ROOM_A, jobId, "00000000-0000-4000-8000-000000000099"), 1600, 1200);
    assert.equal(staleDone.code, "stale_claim");

    const immutable = await psqlError(`update public.vibode_harmonize_generations set failure_message = 'changed' where id = '${jobId}'`);
    assert.match(immutable, /harmonize generation is terminal/);

    const crossRoom = await enqueue(USER_A, ROOM_B, ASSET_B, key(20));
    assert.equal(crossRoom.code, "not_found");
    const crossAsset = await enqueue(USER_A, ROOM_A, ASSET_B, key(21));
    assert.equal(crossAsset.code, "source_version_not_found");

    const wide = await enqueue(USER_B, ROOM_B, ASSET_B, key(30), { width: 1264, height: 848 });
    assert.equal(wide.created, true);
    const wideClaim = await claimJob();
    assert.equal(wideClaim.jobId, wide.jobId);
    const earlyComplete = await complete(String(wide.jobId), String(wideClaim.claimNonce), SHA, outputPath(ROOM_B, String(wide.jobId), String(wideClaim.claimNonce)), 1264, 848);
    assert.equal(earlyComplete.code, "not_contacted");
    assert.equal((await job(String(wide.jobId))).provider_started_at, null);

    await expire(String(wide.jobId));
    const wideAgain = await claimJob();
    const wideContact = await contact(String(wide.jobId), String(wideAgain.claimNonce));
    assert.equal(wideContact.ok, true);
    await expire(String(wide.jobId));
    const reaped = await claim();
    assert.equal(reaped, null);
    const uncertain = await job(String(wide.jobId));
    assert.equal(uncertain.status, "failed");
    assert.equal(uncertain.failure_code, "provider_uncertain");
    assert.ok(uncertain.provider_started_at);
    // The global ceiling is also 10. This earlier contact stays provider_uncertain,
    // but it must not consume the UTC day used by the per-user quota section.
    await parkProviderContact(String(wide.jobId));
    const paidRetry = await enqueue(USER_B, ROOM_B, ASSET_B, key(31));
    assert.equal(paidRetry.created, true);
    assert.equal((await job(String(wide.jobId))).status, "failed");
    const retryClaim = await claimJob();
    assert.equal(retryClaim.jobId, paidRetry.jobId);
    assert.notEqual(retryClaim.jobId, wide.jobId);

    await release(String(paidRetry.jobId), String(retryClaim.claimNonce));
    const queuedB = await enqueue(USER_B, ROOM_B, ASSET_B, key(32));
    const queuedC = await enqueue(USER_C, ROOM_C, ASSET_C, key(33));
    assert.equal(queuedB.created, true);
    assert.equal(queuedC.created, true);
    const pair = await Promise.all([claim(), claim()]);
    const taken = pair.filter((item) => item != null);
    assert.equal(taken.length, 1);
    const waitingId = [queuedB.jobId, queuedC.jobId].find((id) => id !== taken[0]?.jobId);
    assert.ok(waitingId);
    const waiting = await job(String(waitingId));
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.attempt_count, 0);
    await release(String(taken[0]?.jobId), String(taken[0]?.claimNonce));
    const remainder = await claimJob();
    assert.equal(remainder.jobId, waitingId);
    await release(String(remainder.jobId), String(remainder.claimNonce));

    for (let index = 0; index < 9; index += 1) {
      const enqueued = await enqueue(USER_A, ROOM_A, ASSET_A, key(100 + index));
      assert.equal(enqueued.created, true, `daily setup ${index}`);
      const taken = await claimJob();
      const touched = await contact(String(enqueued.jobId), String(taken.claimNonce));
      assert.equal(touched.ok, true);
      const rejected = await fail(String(enqueued.jobId), String(taken.claimNonce), "provider_rejected", false);
      assert.equal(rejected.code, "failed");
    }
    const capped = await enqueue(USER_A, ROOM_A, ASSET_A, key(200));
    assert.equal(capped.code, "daily_limit");
    const racedCap = await Promise.all([
      enqueue(USER_A, ROOM_A, ASSET_A, key(201)),
      enqueue(USER_A, ROOM_A, ASSET_A, key(202)),
    ]);
    assert.deepEqual(racedCap.map((item) => item.code).sort(), ["daily_limit", "daily_limit"]);

    const racedActive = await Promise.all([
      enqueue(USER_B, ROOM_B, ASSET_B, key(210)),
      enqueue(USER_B, ROOM_B, ASSET_B, key(211)),
    ]);
    const outcomes = racedActive.map((item) => item.created === true ? "created" : item.code).sort();
    assert.deepEqual(outcomes, ["active_job", "created"]);
    const activeCount = Number(await psql(
      `select count(*) from public.vibode_harmonize_generations where user_id = '${USER_B}' and status in ('queued', 'running')`,
    ));
    assert.equal(activeCount, 1);

    await raceContactAgainstExpiry();
    await exactJobClaim();
    await permissionsAndStorage();
  } finally {
    await removeContainer();
  }
});

async function raceContactAgainstExpiry(): Promise<void> {
  await parkAllProviderContacts();
  await psql(`
    update public.vibode_harmonize_generations
      set status = 'failed',
          failure_code = 'worker_interrupted',
          failure_message = 'cleared before the race',
          completed_at = now(),
          claim_nonce = null,
          claim_expires_at = null
    where user_id = '${USER_B}' and status in ('queued', 'running')
  `);
  const enqueued = await enqueue(USER_C, ROOM_C, ASSET_C, key(300));
  const taken = await claimJob();
  assert.equal(taken.jobId, enqueued.jobId);
  const jobId = String(enqueued.jobId);
  const nonce = String(taken.claimNonce);
  const holder = psql(`
    select pg_advisory_lock(0, 424242);
    begin;
    select id from public.vibode_harmonize_generations where id = '${jobId}' for update;
    select pg_sleep(3);
    select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}');
    commit;
    select pg_advisory_unlock(0, 424242);
  `);
  await waitForAdvisory(424242);
  await delay(200);
  const expirer = psql(
    `update public.vibode_harmonize_generations set claim_expires_at = now() - interval '1 second' where id = '${jobId}'; select public.claim_next_vibode_harmonize_generation();`,
  );
  await Promise.all([holder, expirer]);
  const row = await job(jobId);
  assert.equal(row.status, "failed");
  assert.equal(row.failure_code, "provider_uncertain");
  assert.ok(row.provider_started_at);
  assert.equal(await claim(), null);

  const fresh = await enqueue(USER_C, ROOM_C, ASSET_C, key(301));
  const freshClaim = await claimJob();
  const freshId = String(fresh.jobId);
  const freshNonce = String(freshClaim.claimNonce);
  const locker = psql(`
    select pg_advisory_lock(0, 424243);
    begin;
    select id from public.vibode_harmonize_generations where id = '${freshId}' for update;
    select pg_sleep(3);
    update public.vibode_harmonize_generations set claim_expires_at = now() - interval '1 second' where id = '${freshId}';
    commit;
    select pg_advisory_unlock(0, 424243);
  `);
  await waitForAdvisory(424243);
  await delay(200);
  const contactor = call(`select public.contact_vibode_harmonize_generation('${freshId}', '${freshNonce}')`);
  const [, contactResult] = await Promise.all([locker, contactor]);
  assert.equal(contactResult.code, "stale_claim");
  assert.equal((await job(freshId)).provider_started_at, null);
  const recovered = await claimJob();
  assert.equal(recovered.jobId, freshId);
  assert.equal((await job(freshId)).provider_started_at, null);
  await release(freshId, String(recovered.claimNonce));
}

async function exactJobClaim(): Promise<void> {
  await psql(`
    update public.vibode_harmonize_generations
      set status = 'failed',
          failure_code = 'worker_interrupted',
          failure_message = 'cleared before exact claim',
          completed_at = now(),
          claim_nonce = null,
          claim_expires_at = null
    where user_id in ('${USER_B}', '${USER_C}') and status in ('queued', 'running')
  `);
  const target = await enqueue(USER_B, ROOM_B, ASSET_B, key(400));
  const other = await enqueue(USER_C, ROOM_C, ASSET_C, key(401));
  assert.equal(target.created, true);
  assert.equal(other.created, true);
  const targetId = String(target.jobId);
  const otherId = String(other.jobId);

  const claimed = await claimExactWhileRowIsLocked(targetId, otherId);
  assert.equal((await job(targetId)).provider_started_at, null);
  assert.equal(await claimExact(targetId), null);
  assert.equal((await job(targetId)).attempt_count, 1);
  assert.equal((await job(otherId)).status, "queued");

  const nullClaim = await call("select public.claim_next_vibode_harmonize_generation(null::uuid)");
  assert.equal(nullClaim.job, null);
  assert.equal(await claimExact("00000000-0000-4000-8000-0000000000aa"), null);
  assert.equal((await job(targetId)).status, "running");
  assert.equal((await job(otherId)).status, "queued");

  const contacted = await contact(targetId, String(claimed.claimNonce));
  assert.equal(contacted.ok, true);
  assert.equal(await claimExact(targetId), null);
  assert.equal((await job(targetId)).status, "running");
  assert.ok((await job(targetId)).provider_started_at);
  assert.equal((await job(otherId)).status, "queued");
  await expire(targetId);
  assert.equal(await claimExact(targetId), null);
  const uncertain = await job(targetId);
  assert.equal(uncertain.status, "failed");
  assert.equal(uncertain.failure_code, "provider_uncertain");
  assert.equal((await job(otherId)).status, "queued");

  await psql(`update public.vibode_harmonize_generations set not_before = now() + interval '1 hour' where id = '${otherId}'`);
  assert.equal(await claimExact(otherId), null);
  assert.equal((await job(otherId)).status, "queued");

  const exhausted = await enqueue(USER_B, ROOM_B, ASSET_B, key(402));
  const exhaustedId = String(exhausted.jobId);
  const exhaustedClaim = await claimExact(exhaustedId);
  assert.equal(exhaustedClaim?.jobId, exhaustedId);
  await psql(`
    update public.vibode_harmonize_generations
      set attempt_count = 3,
          claim_expires_at = now() - interval '1 second'
    where id = '${exhaustedId}'
  `);
  assert.equal(await claimExact(exhaustedId), null);
  const exhaustedRow = await job(exhaustedId);
  assert.equal(exhaustedRow.status, "failed");
  assert.equal(exhaustedRow.failure_code, "attempts_exhausted");
  assert.equal(exhaustedRow.provider_started_at, null);
  assert.equal((await job(otherId)).status, "queued");

  await psql(`update public.vibode_harmonize_generations set not_before = now() where id = '${otherId}'`);
  const released = await claimExact(otherId);
  await release(otherId, String(released?.claimNonce));
}

async function claimExactWhileRowIsLocked(targetId: string, otherId: string): Promise<Json> {
  const holder = psql(`
    begin;
    select id from public.vibode_harmonize_generations where id = '${targetId}' for update;
    select pg_advisory_lock(0, 424250);
    select pg_sleep(3);
    commit;
    select pg_advisory_unlock(0, 424250);
  `);
  await waitForAdvisory(424250);
  const blocked = await claimExact(targetId);
  assert.equal(blocked, null);
  assert.equal((await job(targetId)).status, "queued");
  assert.equal((await job(otherId)).status, "queued");
  const running = Number(await psql(
    `select count(*) from public.vibode_harmonize_generations where status = 'running' and id in ('${targetId}', '${otherId}')`,
  ));
  assert.equal(running, 0);
  await holder;
  const claimed = await claimExact(targetId);
  if (!claimed) throw new Error("expected the locked row to be claimable after release");
  assert.equal(claimed.jobId, targetId);
  assert.equal((await job(targetId)).status, "running");
  assert.equal((await job(targetId)).attempt_count, 1);
  assert.equal((await job(otherId)).status, "queued");
  return claimed;
}

async function permissionsAndStorage(): Promise<void> {
  await restoreUserAContacts();
  const deniedTable = await psqlError("set role anon; select * from public.vibode_harmonize_generations");
  assert.match(deniedTable, /permission denied/);
  const deniedFunction = await psqlError(
    `set role authenticated; select public.enqueue_vibode_harmonize_generation('${USER_A}', '{}'::jsonb)`,
  );
  assert.match(deniedFunction, /permission denied/);
  const deniedExact = await psqlError(
    "set role authenticated; select public.claim_next_vibode_harmonize_generation('00000000-0000-4000-8000-000000000001'::uuid)",
  );
  assert.match(deniedExact, /permission denied/);
  const exactGrant = await psql(`
    select has_function_privilege('anon', 'public.claim_next_vibode_harmonize_generation(uuid)', 'execute')::text
      || ',' || has_function_privilege('authenticated', 'public.claim_next_vibode_harmonize_generation(uuid)', 'execute')::text
      || ',' || has_function_privilege('service_role', 'public.claim_next_vibode_harmonize_generation(uuid)', 'execute')::text
  `);
  assert.equal(exactGrant, "false,false,true");

  const visibleToServiceRole = lastNumber(await psql(
    "set role service_role; select count(*) from public.vibode_harmonize_generations",
  ));
  assert.equal(visibleToServiceRole, 0);
  const rpcAsServiceRole = lastNumber(await psql(
    `set role service_role; select public.vibode_harmonize_provider_started_count('${USER_A}')`,
  ));
  assert.equal(rpcAsServiceRole, 10);

  await psql("alter role service_role bypassrls");
  const bypassed = lastNumber(await psql(
    "set role service_role; select count(*) from public.vibode_harmonize_generations",
  ));
  assert.ok(bypassed > 0);
  await psql("alter role service_role nobypassrls");

  const bucket = await psql(
    `select "public"::text || '|' || file_size_limit::text || '|' || allowed_mime_types::text from storage.buckets where id = 'vibode-harmonize'`,
  );
  assert.equal(bucket, "false|12582912|{image/png,image/jpeg,text/plain}");
  const policies = await psql(
    "select string_agg(polname || ':' || polpermissive::text, ',' order by polname) from pg_policy where polrelid = 'storage.objects'::regclass",
  );
  assert.match(policies, /vibode_harmonize_deny_anon:false/);
  assert.match(policies, /vibode_harmonize_deny_authenticated:false/);

  await psql(`
    insert into storage.buckets (id, name, public) values ('other-bucket', 'other-bucket', false) on conflict (id) do nothing;
    grant usage on schema storage to anon, authenticated;
    grant select, insert on storage.objects to anon, authenticated;
    drop policy if exists harmonize_test_allow_authenticated on storage.objects;
    create policy harmonize_test_allow_authenticated on storage.objects for all to authenticated using (true) with check (true);
  `);
  const allowed = await psql(
    "set role authenticated; insert into storage.objects (bucket_id, name) values ('other-bucket', 'ok.jpg') returning bucket_id",
  );
  assert.match(allowed, /other-bucket/);
  const blocked = await psqlError(
    "set role authenticated; insert into storage.objects (bucket_id, name) values ('vibode-harmonize', 'secret.jpg')",
  );
  assert.match(blocked, /row-level security policy/);
  const anonBlocked = await psqlError(
    "set role anon; insert into storage.objects (bucket_id, name) values ('vibode-harmonize', 'secret.jpg')",
  );
  assert.match(anonBlocked, /row-level security policy|permission denied/);
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=harmonize",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) {
    throw new Error(started.stderr || started.stdout);
  }
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

async function applyMigration(): Promise<void> {
  const bootstrap = `
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
  `;
  await psql(bootstrap);
  const migration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261012090000_vibode_harmonize_generations.sql"),
    "utf8",
  );
  await psql(migration);
  const exact = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql"),
    "utf8",
  );
  await psql(exact);
  const ceilings = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261015190000_vibode_harmonize_global_ceilings.sql"),
    "utf8",
  );
  await psql(ceilings);
}

async function seedOwner(userId: string, roomId: string, assetId: string): Promise<void> {
  await psql(`
    insert into auth.users (id) values ('${userId}');
    insert into public.vibode_rooms (id, user_id) values ('${roomId}', '${userId}');
    insert into public.vibode_room_assets (id, room_id, user_id) values ('${assetId}', '${roomId}', '${userId}');
  `);
}

async function enqueue(
  userId: string,
  roomId: string,
  assetId: string,
  idempotencyKey: string,
  overrides: Readonly<{ requestSha256?: string; width?: number; height?: number }> = {},
): Promise<Json> {
  const width = overrides.width ?? 1200;
  const height = overrides.height ?? 896;
  const payload = {
    roomId,
    sourceVersionId: assetId,
    idempotencyKey,
    requestSha256: overrides.requestSha256 ?? SHA,
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
  };
  return call(
    `select public.enqueue_vibode_harmonize_generation('${userId}'::uuid, ${quote(JSON.stringify(payload))}::jsonb)`,
  );
}

async function claimJob(): Promise<Json> {
  const result = await claim();
  if (!result) throw new Error("expected a claimed harmonize job");
  return result;
}

async function claim(): Promise<Json | null> {
  const result = await call("select public.claim_next_vibode_harmonize_generation()");
  const value = result.job;
  if (value == null) return null;
  return value as Json;
}

async function claimExact(jobId: string): Promise<Json | null> {
  const result = await call(`select public.claim_next_vibode_harmonize_generation('${jobId}'::uuid)`);
  const value = result.job;
  if (value == null) return null;
  return value as Json;
}

async function contact(jobId: string, nonce: string): Promise<Json> {
  return call(`select public.contact_vibode_harmonize_generation('${jobId}', '${nonce}')`);
}

async function fail(jobId: string, nonce: string, code: string, retryable: boolean): Promise<Json> {
  return call(
    `select public.fail_vibode_harmonize_generation('${jobId}', '${nonce}', '${code}', 'worker stopped', ${retryable}, null, null, null)`,
  );
}

async function complete(
  jobId: string,
  nonce: string,
  sha: string,
  output: string,
  width: number,
  height: number,
): Promise<Json> {
  return call(
    `select public.complete_vibode_harmonize_generation('${jobId}', '${nonce}', '${sha}', '${output}', 'gemini-3-pro-image', 'completed', 200, 10, ${width}, ${height})`,
  );
}

async function expire(jobId: string): Promise<void> {
  await psql(`update public.vibode_harmonize_generations set claim_expires_at = now() - interval '1 second' where id = '${jobId}'`);
}

async function parkProviderContact(jobId: string): Promise<void> {
  await psql(`
    alter table public.vibode_harmonize_generations disable trigger vibode_harmonize_generations_guard;
    update public.vibode_harmonize_generations
      set provider_started_at = now() - interval '2 days'
    where id = '${jobId}';
    alter table public.vibode_harmonize_generations enable trigger vibode_harmonize_generations_guard;
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

async function restoreUserAContacts(): Promise<void> {
  await psql(`
    alter table public.vibode_harmonize_generations disable trigger vibode_harmonize_generations_guard;
    update public.vibode_harmonize_generations
      set provider_started_at = now()
    where user_id = '${USER_A}' and provider_started_at is not null;
    update public.vibode_harmonize_generations
      set provider_started_at = now() - interval '2 days'
    where user_id <> '${USER_A}' and provider_started_at is not null;
    alter table public.vibode_harmonize_generations enable trigger vibode_harmonize_generations_guard;
  `);
}

async function release(jobId: string, nonce: string): Promise<void> {
  const result = await fail(jobId, nonce, "worker_interrupted", false);
  assert.equal(result.code, "failed");
}

async function job(jobId: string): Promise<Json> {
  const text = await psql(
    `select json_build_object('status', status, 'provider_started_at', provider_started_at, 'attempt_count', attempt_count, 'failure_code', failure_code, 'output_width', output_width, 'output_height', output_height, 'output_sha256', output_sha256) from public.vibode_harmonize_generations where id = '${jobId}'`,
  );
  return JSON.parse(text) as Json;
}

function outputPath(roomId: string, jobId: string, nonce: string): string {
  return `rooms/${roomId}/jobs/${jobId}/output-${nonce}.jpg`;
}

function key(index: number): string {
  return `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`;
}

async function call(sql: string): Promise<Json> {
  const text = firstJson(await psql(sql));
  const parsed = JSON.parse(text) as Json | number;
  if (typeof parsed === "number") return { ok: true, value: parsed } as Json;
  return parsed;
}

function firstJson(text: string): string {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("{") || /^-?\d+$/.test(item));
  if (!line) throw new Error(`no json in psql output:\n${text}`);
  return line;
}

async function waitForAdvisory(key: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const locks = Number(await psql(
      `select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = ${key} and granted`,
    ));
    if (locks > 0) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for advisory lock ${key}`);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code === 0) throw new Error(`expected psql to fail for:\n${sql}\n${result.stdout}`);
  return `${result.stderr}\n${result.stdout}`;
}

function lastNumber(text: string): number {
  const line = text.split("\n").map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  const value = Number(line);
  if (!Number.isFinite(value)) throw new Error(`expected a count, got:\n${text}`);
  return value;
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
