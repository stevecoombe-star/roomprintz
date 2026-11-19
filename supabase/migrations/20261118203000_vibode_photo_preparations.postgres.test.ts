/**
 * Scratch-photo ledger on disposable Postgres 16.
 * Docker is required. This test does not connect to hosted Supabase.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-photo-prep-2a2-pg";
const DATABASE = "photoprep2a2";
const MIGRATION = "supabase/migrations/20261118203000_vibode_photo_preparations.sql";
const RETENTION = "supabase/migrations/20261119170000_vibode_photo_preparation_cleanup_retention.sql";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-18T20:00:00Z";

test("photo preparation storage is private, owned, and capacity-limited", { timeout: 180_000 }, async () => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /revoke all on table public\.vibode_photo_preparations from public, anon, authenticated, service_role/);
  assert.match(migration, /pg_advisory_xact_lock/);

  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
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
        name text,
        created_at timestamptz not null default now()
      );
      alter table storage.objects enable row level security;
    `);
    await psql(migration);
    await psql(readFileSync(path.join(process.cwd(), RETENTION), "utf8"));

    const bucket = await psql(`
      select id || ':' || public::text || ':' || file_size_limit::text || ':' || allowed_mime_types::text
      from storage.buckets where id = 'vibode-photo-preparations'
    `);
    assert.equal(
      bucket,
      "vibode-photo-preparations:false:26214400:{image/heic,image/heif,image/heic-sequence,image/heif-sequence}",
    );
    const denied = await psql(`
      select count(*)::text from pg_policies
      where policyname in ('vibode_photo_preparation_deny_anon', 'vibode_photo_preparation_deny_authenticated')
    `);
    assert.equal(denied, "2");

    const anon = await psqlErrorAs("anon", `select public.begin_vibode_photo_preparation('${USER_A}', 'room', 4000001, '${NOW}')`);
    assert.match(anon, /permission denied/i);

    const tooSmall = await json(`select public.begin_vibode_photo_preparation('${USER_A}', 'room', 4000000, '${NOW}')`);
    assert.equal(tooSmall.ok, false);
    assert.equal(tooSmall.code, "too_large");
    const tooBig = await json(`select public.begin_vibode_photo_preparation('${USER_A}', 'room', 26214401, '${NOW}')`);
    assert.equal(tooBig.code, "too_large");

    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const opened = await json(`select public.begin_vibode_photo_preparation('${USER_A}', 'room', ${4000001 + index}, '${NOW}')`);
      assert.equal(opened.ok, true);
      ids.push(String(opened.preparationId));
      assert.match(String(opened.objectPath), new RegExp(`^users/${USER_A}/preparations/${opened.preparationId}/source\\.heic$`));
    }
    const full = await json(`select public.begin_vibode_photo_preparation('${USER_A}', 'furniture', 4000010, '${NOW}')`);
    assert.equal(full.code, "capacity");

    const stranger = await json(`select public.claim_vibode_photo_preparation('${USER_B}', '${ids[0]}', '${NOW}')`);
    assert.equal(stranger.code, "not_found");
    const claimed = await json(`select public.claim_vibode_photo_preparation('${USER_A}', '${ids[0]}', '${NOW}')`);
    assert.equal(claimed.ok, true);
    assert.equal(claimed.purpose, "room");
    const secondClaim = await json(`select public.claim_vibode_photo_preparation('${USER_A}', '${ids[0]}', '${NOW}')`);
    assert.equal(secondClaim.code, "busy");

    const sweptLive = await json(`select public.sweep_vibode_photo_preparations('${NOW}')`);
    assert.equal(sweptLive.ok, true);
    assert.equal(Array.isArray(sweptLive.paths) && sweptLive.paths.includes(claimed.objectPath), false);

    const expired = await json(`select public.sweep_vibode_photo_preparations('2026-11-18T20:11:00Z')`);
    assert.equal(expired.ok, true);
    assert.equal((expired.paths as string[]).length >= 2, true);
    const afterExpiry = await json(`select public.claim_vibode_photo_preparation('${USER_A}', '${ids[1]}', '2026-11-18T20:11:00Z')`);
    assert.equal(afterExpiry.code, "expired");

    const closed = await json(`select public.finish_vibode_photo_preparation('${USER_A}', '${ids[0]}', '${NOW}')`);
    assert.equal(closed.ok, true);
    const abandoned = await json(`select public.close_vibode_photo_preparation('${USER_A}', '${ids[0]}', '2026-11-18T20:30:00Z')`);
    assert.equal(abandoned.ok, true);
    assert.equal(await psql(`select status from public.vibode_photo_preparations where preparation_id = '${ids[0]}'`), "closed");

    const rateUser = "33333333-3333-4333-8333-333333333333";
    for (let index = 0; index < 30; index += 1) {
      const opened = await json(`select public.begin_vibode_photo_preparation('${rateUser}', 'room', 4000100, '${NOW}')`);
      assert.equal(opened.ok, true);
      const dropped = await json(`select public.close_vibode_photo_preparation('${rateUser}', '${opened.preparationId}', '${NOW}')`);
      assert.equal(dropped.ok, true);
    }
    const limited = await json(`select public.begin_vibode_photo_preparation('${rateUser}', 'room', 4000100, '${NOW}')`);
    assert.equal(limited.code, "rate");

    const kept = await json(`select public.begin_vibode_photo_preparation('${USER_B}', 'furniture', 4000200, '${NOW}')`);
    assert.equal(kept.ok, true);
    const removed = await json(`select public.delete_vibode_photo_preparations_for_user('${USER_A}')`);
    assert.equal(removed.ok, true);
    assert.equal(await psql(`select count(*)::text from public.vibode_photo_preparations where user_id = '${USER_A}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_photo_preparations where user_id = '${USER_B}'`), "1");
    const anonDelete = await psqlErrorAs("anon", `select public.delete_vibode_photo_preparations_for_user('${USER_B}')`);
    assert.match(anonDelete, /permission denied/i);
    const anonConfirm = await psqlErrorAs("anon", `select public.confirm_vibode_photo_preparation_cleared('users/${USER_B}/preparations/${kept.preparationId}/source.heic', '${NOW}')`);
    assert.match(anonConfirm, /permission denied/i);

    await psql("delete from public.vibode_photo_preparations");
    await psql("delete from storage.objects");
    const late = await json(`select public.begin_vibode_photo_preparation('${USER_A}', 'room', 4000300, '${NOW}')`);
    assert.equal(late.ok, true);
    const latePath = String(late.objectPath);
    const cancelled = await json(`select public.close_vibode_photo_preparation('${USER_A}', '${late.preparationId}', '${NOW}')`);
    assert.equal(cancelled.ok, true);

    const duringToken = await json(`select public.sweep_vibode_photo_preparations('2026-11-18T22:00:00Z')`);
    assert.equal((duringToken.paths as string[]).includes(latePath), true);
    assert.equal(await psql(`select count(*)::text from public.vibode_photo_preparations where preparation_id = '${late.preparationId}'`), "1");
    const keptThroughExpiry = await json(`select public.confirm_vibode_photo_preparation_cleared('${latePath}', '2026-11-18T22:00:00Z')`);
    assert.equal(keptThroughExpiry.retired, false);
    assert.equal(await psql(`select count(*)::text from public.vibode_photo_preparations where preparation_id = '${late.preparationId}'`), "1");

    const stillInsideMargin = await json(`select public.confirm_vibode_photo_preparation_cleared('${latePath}', '2026-11-18T22:29:59Z')`);
    assert.equal(stillInsideMargin.retired, false);
    const retired = await json(`select public.confirm_vibode_photo_preparation_cleared('${latePath}', '2026-11-18T22:30:00Z')`);
    assert.equal(retired.retired, true);
    assert.equal(await psql(`select count(*)::text from public.vibode_photo_preparations where preparation_id = '${late.preparationId}'`), "0");

    const retry = await json(`select public.begin_vibode_photo_preparation('${USER_A}', 'room', 4000301, '${NOW}')`);
    await json(`select public.close_vibode_photo_preparation('${USER_A}', '${retry.preparationId}', '${NOW}')`);
    await json(`select public.sweep_vibode_photo_preparations('2026-11-18T23:30:00Z')`);
    assert.equal(await psql(`select count(*)::text from public.vibode_photo_preparations where preparation_id = '${retry.preparationId}'`), "1");

    const active = await json(`select public.begin_vibode_photo_preparation('${USER_B}', 'furniture', 4000302, '${NOW}')`);
    const leased = await json(`select public.claim_vibode_photo_preparation('${USER_B}', '${active.preparationId}', '${NOW}')`);
    assert.equal(leased.ok, true);
    const protectedSweep = await json(`select public.sweep_vibode_photo_preparations('2026-11-18T20:00:30Z')`);
    assert.equal((protectedSweep.paths as string[]).includes(String(leased.objectPath)), false);
    const protectedConfirm = await json(`select public.confirm_vibode_photo_preparation_cleared('${leased.objectPath}', '2026-11-18T20:00:30Z')`);
    assert.equal(protectedConfirm.code, "busy");
    assert.equal(await psql(`select status from public.vibode_photo_preparations where preparation_id = '${active.preparationId}'`), "converting");

    const orphanPath = `users/${USER_A}/preparations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source.heic`;
    const youngPath = `users/${USER_A}/preparations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/source.heic`;
    await psql(`
      insert into storage.objects (bucket_id, name, created_at) values
        ('vibode-photo-preparations', '${orphanPath}', '2026-11-18T19:40:00Z'),
        ('vibode-photo-preparations', '${youngPath}', '2026-11-18T19:59:00Z'),
        ('vibode-photo-preparations', '${leased.objectPath}', '2026-11-18T19:00:00Z')
    `);
    const orphans = await json(`select public.list_orphan_vibode_photo_preparations('${NOW}')`);
    assert.deepEqual(orphans.paths, [orphanPath]);
  } finally {
    await removeContainer();
  }
});

async function json(sql: string): Promise<Record<string, unknown>> {
  const text = await psqlAs("service_role", sql);
  return JSON.parse(text) as Record<string, unknown>;
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
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], `set role ${user}; ${sql}`);
  if (result.code !== 0) throw new Error(`psql as ${user} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlErrorAs(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], `set role ${user}; ${sql}`);
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
