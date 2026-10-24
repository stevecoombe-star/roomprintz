/**
 * SEC-20C reservation checks.
 *
 * The source test always runs and does not open a database.
 * The integration test applies the migration to a disposable local Postgres 16
 * container when Docker is available. It does not connect to hosted Supabase.
 * Hosted verification remains pending until a separately authorized apply.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "sec20c-room-image-read-pg";
const MIGRATION = "supabase/migrations/20261023170000_reserve_vibode_room_image_read.sql";
const SIGNATURE = "public.reserve_vibode_room_image_read(uuid,uuid,uuid,text,text)";
const COMPLETE_SIGNATURE = "public.complete_vibode_room_image_read(uuid,uuid,text)";
const UNKNOWN_ATTEMPT = "99999999-9999-4999-8999-999999999999";
const TERMINAL_ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "44444444-4444-4444-8444-444444444444";
const ROOM_A = "22222222-2222-4222-8222-222222222222";
const ROOM_B = "55555555-5555-4555-8555-555555555555";
const ASSET_A = "33333333-3333-4333-8333-333333333333";
const ASSET_B = "66666666-6666-4666-8666-666666666666";
const ASSET_C = "88888888-8888-4888-8888-888888888888";

type Json = { ok?: boolean; code?: string; attemptId?: string | null; outcome?: string };

test("reservation SQL states the caps, locks, ownership check, and service-role grant", () => {
  const sql = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(sql, /create or replace function public\.reserve_vibode_room_image_read/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = pg_catalog, public/);
  assert.match(sql, /pg_advisory_xact_lock\(8142, 20261023\)/);
  assert.match(sql, /hashtextextended/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_user_count >= 24/);
  assert.match(sql, /v_global_count >= 200/);
  assert.match(sql, /interval '5 minutes'/);
  assert.match(sql, /at time zone 'utc'/);
  assert.match(sql, /status = 'timed_out'/);
  assert.match(sql, /from public\.vibode_rooms/);
  assert.match(sql, /from public\.vibode_room_assets/);
  assert.match(sql, /user_id = p_user_id/);
  assert.match(sql, /room_id = p_room_id/);
  assert.match(sql, /p_operation is distinct from 'room_image_read'/);
  assert.match(sql, /'reserved'/);
  assert.match(sql, /'busy'/);
  assert.match(sql, /'user_quota'/);
  assert.match(sql, /'global_quota'/);
  assert.match(sql, /'forbidden'/);
  assert.match(sql, /when unique_violation/);
  assert.match(sql, /revoke all on function public\.reserve_vibode_room_image_read\(uuid, uuid, uuid, text, text\)/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reserve_vibode_room_image_read\(uuid, uuid, uuid, text, text\)/);
  assert.match(sql, /to service_role/);
  const completeSql = sql.slice(sql.indexOf("create or replace function public.complete_vibode_room_image_read"));
  assert.equal(completeSql.length > 0, true);
  const completeLock = completeSql.indexOf("pg_advisory_xact_lock(8142, 20261023)");
  const completeRead = completeSql.indexOf("from public.vibode_room_image_read_attempts");
  const completePerKey = completeSql.indexOf("hashtextextended");
  const completeUpdate = completeSql.indexOf("set status = p_outcome");
  assert.equal(completeLock > 0 && completeLock < completeRead && completeRead < completePerKey && completePerKey < completeUpdate, true);
  assert.match(completeSql, /p_outcome is distinct from 'succeeded'/);
  assert.match(completeSql, /already_terminal/);
  assert.match(completeSql, /revoke all on function public\.complete_vibode_room_image_read\(uuid, uuid, text\)/);
  assert.match(completeSql, /grant execute on function public\.complete_vibode_room_image_read\(uuid, uuid, text\)[\s\S]*to service_role/);
  assert.doesNotMatch(completeSql, /grant execute on function public\.complete_vibode_room_image_read[\s\S]*to anon/);
  assert.doesNotMatch(completeSql, /grant execute on function public\.complete_vibode_room_image_read[\s\S]*to authenticated/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/);
});

test("local postgres verifies reservation concurrency, quota, ttl, utc, ownership, and grants", { timeout: 180_000 }, async (t) => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    t.skip("local Docker is unavailable; hosted reservation verification remains pending");
    return;
  }
  await removeContainer();
  try {
    await startPostgres();
    await bootstrap();
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.match(await psql("select current_setting('server_version')"), /^16\./);

    const proc = await psql(
      "select proname || '|' || prosecdef::text || '|' || coalesce(proconfig::text, '') || '|' || r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.proname in ('reserve_vibode_room_image_read', 'complete_vibode_room_image_read') order by proname",
    );
    for (const line of proc.split("\n").map((item) => item.trim()).filter(Boolean)) {
      assert.match(line, /\|true\|/);
      assert.match(line, /search_path=pg_catalog, public/);
      assert.equal(line.endsWith("|postgres"), true, line);
    }
    assert.match(proc, /complete_vibode_room_image_read/);
    assert.match(proc, /reserve_vibode_room_image_read/);

    const acl = await psql("select proname || '|' || coalesce(proacl::text, '') from pg_proc where proname in ('reserve_vibode_room_image_read', 'complete_vibode_room_image_read') order by proname");
    for (const line of acl.split("\n").map((item) => item.trim()).filter(Boolean)) {
      assert.equal(/(?:\{|,)=X\//.test(line), false, line);
      assert.match(line, /service_role=X\//, line);
    }
    assert.equal(await psql(`select has_function_privilege('anon', '${SIGNATURE}', 'execute')`), "f");
    assert.equal(await psql(`select has_function_privilege('authenticated', '${SIGNATURE}', 'execute')`), "f");
    assert.equal(await psql(`select has_function_privilege('service_role', '${SIGNATURE}', 'execute')`), "t");
    assert.equal(await psql(`select has_function_privilege('anon', '${COMPLETE_SIGNATURE}', 'execute')`), "f");
    assert.equal(await psql(`select has_function_privilege('authenticated', '${COMPLETE_SIGNATURE}', 'execute')`), "f");
    assert.equal(await psql(`select has_function_privilege('service_role', '${COMPLETE_SIGNATURE}', 'execute')`), "t");
    assert.match(await psqlError(`set role anon; select ${SIGNATURE.split("(")[0]}('${USER_A}', '${ROOM_A}', '${ASSET_A}', 'labels_only', 'room_image_read');`), /permission denied/i);
    assert.match(await psqlError(`set role authenticated; select public.complete_vibode_room_image_read('${USER_A}', '${UNKNOWN_ATTEMPT}', 'succeeded');`), /permission denied/i);
    assert.match(await psqlError(`set role service_role; select public.complete_vibode_room_image_read('${USER_A}', '${UNKNOWN_ATTEMPT}', 'succeeded');`), /"code"\s*:\s*"forbidden"/);
    assert.match(await psqlError("set role authenticated; select count(*) from public.vibode_room_image_read_attempts;"), /permission denied/i);
    assert.match(await psqlError("set role service_role; select count(*) from public.vibode_room_image_read_attempts;"), /permission denied/i);
    assert.equal(await psql("select relrowsecurity from pg_class where relname = 'vibode_room_image_read_attempts'"), "t");

    const denied = await reserve(USER_A, ROOM_B, ASSET_B, "labels_only");
    assert.equal(denied.code, "forbidden");
    const wrongRoom = await reserve(USER_A, ROOM_A, ASSET_B, "geometry");
    assert.equal(wrongRoom.code, "forbidden");
    const invalid = await reserve(USER_A, ROOM_A, ASSET_A, "escalate");
    assert.equal(invalid.code, "invalid");
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts"), 0);

    const first = await reserve(USER_A, ROOM_A, ASSET_A, "labels_only");
    assert.equal(first.ok, true);
    assert.equal(first.code, "reserved");
    assert.match(first.attemptId ?? "", /^[0-9a-f-]{36}$/);
    const overlap = await reserve(USER_A, ROOM_A, ASSET_A, "labels_only");
    assert.equal(overlap.code, "busy");
    const otherMode = await reserve(USER_A, ROOM_A, ASSET_A, "geometry");
    assert.equal(otherMode.code, "reserved");
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts where status = 'in_flight'"), 2);
    const ttl = await psql(
      "select extract(epoch from (expires_at - created_at))::int from public.vibode_room_image_read_attempts order by created_at limit 1",
    );
    assert.equal(Math.abs(Number(ttl) - 300) <= 2, true);

    await psql("delete from public.vibode_room_image_read_attempts");
    await psql(`
      insert into public.vibode_room_image_read_attempts
        (user_id, room_id, asset_id, mode, operation, status, created_at, expires_at)
      values
        ('${USER_A}', '${ROOM_A}', '${ASSET_A}', 'labels_only', 'room_image_read', 'in_flight', now() - interval '10 minutes', now() - interval '1 minute');
    `);
    const afterTtl = await reserve(USER_A, ROOM_A, ASSET_A, "labels_only");
    assert.equal(afterTtl.code, "reserved");
    assert.equal(await psql("select status from public.vibode_room_image_read_attempts order by created_at limit 1"), "timed_out");
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts"), 2);

    await psql("delete from public.vibode_room_image_read_attempts");
    await psql(`
      insert into public.vibode_room_image_read_attempts
        (user_id, room_id, asset_id, mode, operation, status, created_at, expires_at)
      select '${USER_A}', '${ROOM_A}', '${ASSET_A}', 'labels_only', 'room_image_read', 'failed',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 second',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '2 seconds'
      from generate_series(1, 23);
    `);
    assert.equal((await reserve(USER_A, ROOM_A, ASSET_C, "labels_only")).code, "reserved");
    assert.equal((await reserve(USER_A, ROOM_A, ASSET_A, "geometry")).code, "user_quota");

    await psql("delete from public.vibode_room_image_read_attempts");
    await psql(`
      insert into public.vibode_room_image_read_attempts
        (user_id, room_id, asset_id, mode, operation, status, created_at, expires_at)
      select '${USER_A}', '${ROOM_A}', '${ASSET_A}', 'geometry', 'room_image_read', 'timed_out',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 second',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '2 seconds'
      from generate_series(1, 24);
    `);
    assert.equal((await reserveInZone("America/Los_Angeles", USER_A, ROOM_A, ASSET_C, "geometry")).code, "user_quota");
    await psql("delete from public.vibode_room_image_read_attempts");
    await psql(`
      insert into public.vibode_room_image_read_attempts
        (user_id, room_id, asset_id, mode, operation, status, created_at, expires_at)
      select '${USER_A}', '${ROOM_A}', '${ASSET_A}', 'geometry', 'room_image_read', 'timed_out',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') - interval '1 second',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 minute'
      from generate_series(1, 24);
    `);
    assert.equal((await reserveInZone("America/Los_Angeles", USER_A, ROOM_A, ASSET_C, "labels_only")).code, "reserved");

    await psql("delete from public.vibode_room_image_read_attempts");
    await psql(`
      insert into public.vibode_room_image_read_attempts
        (user_id, room_id, asset_id, mode, operation, status, created_at, expires_at)
      select '${USER_B}', '${ROOM_B}', '${ASSET_B}', 'labels_only', 'room_image_read', 'timed_out',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 second',
             (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '2 seconds'
      from generate_series(1, 199);
    `);
    const [globalA, globalB] = await Promise.all([
      reserve(USER_A, ROOM_A, ASSET_A, "labels_only"),
      reserve(USER_A, ROOM_A, ASSET_C, "geometry"),
    ]);
    const globalCodes = [globalA.code, globalB.code].sort();
    assert.deepEqual(globalCodes, ["global_quota", "reserved"]);
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts"), 200);

    await psql("delete from public.vibode_room_image_read_attempts");
    const [raceA, raceB] = await Promise.all([
      reserve(USER_A, ROOM_A, ASSET_A, "labels_only"),
      reserve(USER_A, ROOM_A, ASSET_A, "labels_only"),
    ]);
    assert.deepEqual([raceA.code, raceB.code].sort(), ["busy", "reserved"]);
    assert.equal(
      await count("select count(*) from public.vibode_room_image_read_attempts where status = 'in_flight'"),
      1,
    );

    const leased = await psql("select id from public.vibode_room_image_read_attempts where status = 'in_flight'");
    const released = await complete(USER_A, leased, "succeeded");
    assert.equal(released.code, "completed");
    assert.equal(released.outcome, "succeeded");
    const reopened = await complete(USER_A, leased, "failed");
    assert.equal(reopened.code, "already_terminal");
    assert.equal(reopened.outcome, "succeeded");
    assert.equal(await psql(`select status from public.vibode_room_image_read_attempts where id = '${leased}'`), "succeeded");
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts"), 1);
    const afterRelease = await reserve(USER_A, ROOM_A, ASSET_A, "labels_only");
    assert.equal(afterRelease.code, "reserved");
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts"), 2);
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts where status = 'in_flight'"), 1);

    const crossUser = await complete(USER_B, afterRelease.attemptId ?? "", "failed");
    assert.equal(crossUser.code, "forbidden");
    assert.equal(await psql(`select status from public.vibode_room_image_read_attempts where id = '${afterRelease.attemptId}'`), "in_flight");
    const unknown = await complete(USER_A, UNKNOWN_ATTEMPT, "succeeded");
    assert.equal(unknown.code, "forbidden");
    const invalidOutcome = await complete(USER_A, afterRelease.attemptId ?? "", "refunded");
    assert.equal(invalidOutcome.code, "invalid");
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts"), 2);

    await psql(`
      insert into public.vibode_room_image_read_attempts
        (id, user_id, room_id, asset_id, mode, operation, status, created_at, expires_at, completed_at)
      values
        ('${TERMINAL_ATTEMPT}', '${USER_A}', '${ROOM_A}', '${ASSET_C}', 'geometry', 'room_image_read', 'timed_out',
         now() - interval '10 minutes', now() - interval '1 minute', now() - interval '1 minute');
    `);
    const terminalStamp = await psql(`select completed_at::text from public.vibode_room_image_read_attempts where id = '${TERMINAL_ATTEMPT}'`);
    const terminal = await complete(USER_A, TERMINAL_ATTEMPT, "succeeded");
    assert.equal(terminal.code, "already_terminal");
    assert.equal(terminal.outcome, "timed_out");
    assert.equal(await psql(`select status from public.vibode_room_image_read_attempts where id = '${TERMINAL_ATTEMPT}'`), "timed_out");
    assert.equal(await psql(`select completed_at::text from public.vibode_room_image_read_attempts where id = '${TERMINAL_ATTEMPT}'`), terminalStamp);

    const closed = await complete(USER_A, afterRelease.attemptId ?? "", "failed");
    assert.equal(closed.code, "completed");
    const [againA, againB] = await Promise.all([
      complete(USER_A, afterRelease.attemptId ?? "", "succeeded"),
      reserve(USER_A, ROOM_A, ASSET_A, "labels_only"),
    ]);
    assert.equal(againA.code, "already_terminal");
    assert.equal(againB.code, "reserved");
    assert.equal(await psql(`select status from public.vibode_room_image_read_attempts where id = '${afterRelease.attemptId}'`), "failed");

    await psql("delete from public.vibode_room_image_read_attempts");
    const burst = await Promise.all([
      reserve(USER_A, ROOM_A, ASSET_A, "geometry"),
      reserve(USER_A, ROOM_A, ASSET_A, "geometry"),
      reserve(USER_A, ROOM_A, ASSET_C, "labels_only"),
      reserve(USER_A, ROOM_A, ASSET_C, "labels_only"),
    ]);
    assert.equal(burst.filter((item) => item.code === "reserved").length, 2);
    assert.equal(burst.filter((item) => item.code === "busy").length, 2);
    const finishing = await Promise.all(burst.filter((item) => item.code === "reserved").map((item) => (
      complete(USER_A, item.attemptId ?? "", "succeeded")
    )));
    assert.deepEqual(finishing.map((item) => item.code).sort(), ["completed", "completed"]);
    const relock = await Promise.all([
      reserve(USER_A, ROOM_A, ASSET_A, "geometry"),
      complete(USER_A, burst.find((item) => item.code === "reserved")?.attemptId ?? "", "failed"),
    ]);
    assert.deepEqual(relock.map((item) => item.code).sort(), ["already_terminal", "reserved"]);
    assert.equal(await count("select count(*) from public.vibode_room_image_read_attempts where status = 'in_flight'"), 1);
  } finally {
    await removeContainer();
  }
});

async function complete(userId: string, attemptId: string, outcome: string): Promise<Json> {
  return parseJson(await psql(`
    select public.complete_vibode_room_image_read('${userId}', '${attemptId}', '${outcome}');
  `), "completion");
}

async function reserve(userId: string, roomId: string, assetId: string, mode: string): Promise<Json> {
  return reserveInZone("UTC", userId, roomId, assetId, mode);
}

async function reserveInZone(
  zone: string,
  userId: string,
  roomId: string,
  assetId: string,
  mode: string,
): Promise<Json> {
  return parseJson(await psql(`
    set time zone '${zone}';
    select public.reserve_vibode_room_image_read('${userId}', '${roomId}', '${assetId}', '${mode}', 'room_image_read');
  `), "reservation");
}

function parseJson(text: string, label: string): Json {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("{"));
  if (!line) throw new Error(`no ${label} json\n${text}`);
  return JSON.parse(line) as Json;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(sql));
}

async function bootstrap(): Promise<void> {
  await psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create table public.vibode_rooms (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade
    );
    create table public.vibode_room_assets (
      id uuid primary key,
      room_id uuid not null references public.vibode_rooms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      asset_type text not null default 'base',
      image_url text not null default ''
    );
    insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
    insert into public.vibode_rooms (id, user_id) values ('${ROOM_A}', '${USER_A}'), ('${ROOM_B}', '${USER_B}');
    insert into public.vibode_room_assets (id, room_id, user_id) values
      ('${ASSET_A}', '${ROOM_A}', '${USER_A}'),
      ('${ASSET_B}', '${ROOM_B}', '${USER_B}'),
      ('${ASSET_C}', '${ROOM_A}', '${USER_A}');
  `);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "sec20c", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "sec20c", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=sec20c",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "sec20c", "-t", "-A", "-c", "select 1",
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
