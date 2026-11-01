/**
 * REMOVE developer SAM quota exemption.
 *
 * The source contract always runs and does not open a database.
 * The integration test applies the candidate to a disposable local Postgres
 * container when Docker is available. It does not connect to hosted Supabase.
 * Hosted application stays blocked until a privileged pg_get_functiondef read.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "remove-dev-quota-pg";
const PRIOR = "supabase/migrations/20261021180000_vibode_remove_segmentation_limits.sql";
const CANDIDATE = "supabase/migrations/20261101010000_vibode_remove_segmentation_dev_allowlist.sql";
const SIGNATURE = "public.reserve_vibode_remove_segmentation(uuid,uuid,uuid,text)";
const USER_ORD = "11111111-1111-4111-8111-111111111111";
const USER_DEV = "22222222-2222-4222-8222-222222222222";
const USER_OTHER = "33333333-3333-4333-8333-333333333333";
const USER_TEMP = "44444444-4444-4444-8444-444444444444";
const ROOM_ORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ROOM_DEV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ROOM_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const ROOM_TEMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const GEN_ORD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const GEN_DEV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const GEN_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const GEN_TEMP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const SHA = "ab".repeat(32);

const CODES = ["global_limit", "invalid", "not_found", "reserved", "user_limit"];

type Reservation = { ok?: boolean; code?: string };

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("the candidate migration is blocked and keeps public ceilings intact", () => {
  const prior = source(PRIOR);
  const sql = source(CANDIDATE);
  assert.doesNotMatch(prior, /dev_allowlist|dev_daily_limit|BLOCKED FROM APPLICATION/);
  assert.match(prior, /vibode_remove_segmentation_user_daily_limit\(\)[\s\S]*select 24;/);
  assert.match(prior, /vibode_remove_segmentation_global_daily_limit\(\)[\s\S]*select 200;/);
  assert.doesNotMatch(prior, /not exists \(\s*select 1\s*from public\.vibode_remove_segmentation_dev_allowlist/);

  const guardAt = sql.indexOf("BLOCKED FROM APPLICATION");
  const settingAt = sql.indexOf("vibode.apply_remove_segmentation_dev_exemption");
  const tableAt = sql.indexOf("create table public.vibode_remove_segmentation_dev_allowlist");
  assert.ok(guardAt >= 0 && settingAt > guardAt && tableAt > settingAt);
  assert.match(sql, /pg_get_functiondef of public\.reserve_vibode_remove_segmentation\(uuid,uuid,uuid,text\)/);
  assert.match(sql, /20261021180000_vibode_remove_segmentation_limits\.sql/);
  assert.doesNotMatch(sql, /insert into public\.vibode_remove_segmentation_dev_allowlist/i);
  assert.doesNotMatch(sql, /alter database|alter role|copy public\.vibode_remove_segmentation_dev_allowlist/i);
  assert.doesNotMatch(sql, /grant\s[\s\S]*on table public\.vibode_remove_segmentation_dev_allowlist/i);
  assert.match(
    sql,
    /revoke all on table public\.vibode_remove_segmentation_dev_allowlist\s+from public, anon, authenticated, service_role/,
  );
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /create policy|force row level security/i);
  assert.match(sql, /references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /vibode_remove_segmentation_dev_daily_limit\(\)[\s\S]*select 200;/);
  assert.doesNotMatch(sql, /create or replace function public\.vibode_remove_segmentation_user_daily_limit/);
  assert.doesNotMatch(sql, /create or replace function public\.vibode_remove_segmentation_global_daily_limit/);
  assert.doesNotMatch(sql, /vibode_cleanup|generativelanguage|gemini|roboflow|nanobanana/i);

  const fn = sql.slice(sql.indexOf("create or replace function public.reserve_vibode_remove_segmentation"));
  assert.match(
    fn,
    /create or replace function public\.reserve_vibode_remove_segmentation\(\s*p_user_id uuid,\s*p_room_id uuid,\s*p_generation_id uuid,\s*p_original_sha256 text\s*\) returns jsonb/,
  );
  assert.doesNotMatch(fn, /p_exempt|current_setting|VIBODE_|process\.env/);
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = pg_catalog, public, pg_temp/);
  const shaAt = fn.indexOf("p_original_sha256 !~ '^[0-9a-f]{64}$'");
  const roomAt = fn.indexOf("from public.vibode_rooms");
  const generationAt = fn.indexOf("from public.vibode_afc_generations");
  const lockAt = fn.indexOf("perform pg_advisory_xact_lock(hashtext('vibode-remove-segmentation')::bigint);");
  const purgeAt = fn.indexOf("delete from public.vibode_remove_segmentation_calls\n  where created_at < v_day;");
  const devAt = fn.indexOf("from public.vibode_remove_segmentation_dev_allowlist");
  const devLimitAt = fn.indexOf("public.vibode_remove_segmentation_dev_daily_limit()");
  const userLimitAt = fn.indexOf("public.vibode_remove_segmentation_user_daily_limit()");
  const globalLimitAt = fn.indexOf("public.vibode_remove_segmentation_global_daily_limit()");
  const insertAt = fn.indexOf("insert into public.vibode_remove_segmentation_calls");
  assert.ok(shaAt >= 0 && shaAt < roomAt && roomAt < generationAt && generationAt < lockAt);
  assert.ok(lockAt < purgeAt && purgeAt < devAt && devAt < devLimitAt && devLimitAt < userLimitAt);
  assert.ok(userLimitAt < globalLimitAt && globalLimitAt < insertAt);
  assert.match(
    fn,
    /if v_dev then[\s\S]*dev_daily_limit\(\)[\s\S]*'user_limit'[\s\S]*else[\s\S]*user_daily_limit\(\)[\s\S]*not exists \([\s\S]*vibode_remove_segmentation_dev_allowlist[\s\S]*global_daily_limit\(\)/,
  );
  assert.match(fn, /revoke all on function public\.reserve_vibode_remove_segmentation\(uuid, uuid, uuid, text\)\s+from public, anon, authenticated/);
  assert.match(fn, /grant execute on function public\.vibode_remove_segmentation_dev_daily_limit\(\) to service_role/);
  assert.match(fn, /grant execute on function public\.reserve_vibode_remove_segmentation\(uuid, uuid, uuid, text\) to service_role/);
  const codes = [...fn.matchAll(/'code', '([a-z_]+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual([...new Set(codes)], CODES);

  const quota = source("lib/vibode-stage/remove-segmentation-quota.server.ts");
  const handler = source("lib/vibode-stage/remove-segmentation-admin.ts");
  const route = source("app/api/vibode/admin/remove-objects/route.ts");
  assert.doesNotMatch(`${quota}\n${handler}\n${route}`, /dev_allowlist|dev_daily|p_exempt|apply_remove_segmentation_dev_exemption/);
  assert.match(quota, /client\.rpc\("reserve_vibode_remove_segmentation"/);
  assert.match(quota, /p_user_id: input\.userId/);
  assert.match(handler, /reserved\.code === "user_limit" \|\| reserved\.code === "global_limit"/);
  assert.match(route, /readRemoveActor/);
  assert.doesNotMatch(route, /isAdminEmail|VIBODE_ADMIN_EMAIL/);
});

test("local postgres enforces separate public and developer ceilings", { timeout: 180_000 }, async (t) => {
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
    await psql(source(PRIOR));

    const blocked = await psqlError(source(CANDIDATE));
    assert.match(blocked, /BLOCKED FROM APPLICATION/);
    assert.match(blocked, /pg_get_functiondef/);
    assert.equal(await psql("select to_regclass('public.vibode_remove_segmentation_dev_allowlist')"), "");
    assert.doesNotMatch(await definition(), /dev_allowlist|dev_daily_limit/);

    const preview = await psqlError(`
      select set_config('vibode.apply_remove_segmentation_dev_exemption', 'preview', false);
      ${source(CANDIDATE)}
    `);
    assert.match(preview, /BLOCKED FROM APPLICATION/);
    assert.equal(await psql("select to_regclass('public.vibode_remove_segmentation_dev_allowlist')"), "");

    await psql(`
      select set_config('vibode.apply_remove_segmentation_dev_exemption', 'verified-function-def', false);
      ${source(CANDIDATE)}
    `);

    assert.equal(await psql("select count(*) from public.vibode_remove_segmentation_dev_allowlist"), "0");
    assert.equal(await psql("select public.vibode_remove_segmentation_user_daily_limit()"), "24");
    assert.equal(await psql("select public.vibode_remove_segmentation_global_daily_limit()"), "200");
    assert.equal(await psql("select public.vibode_remove_segmentation_dev_daily_limit()"), "200");
    assert.equal(await psql("select relrowsecurity from pg_class where relname = 'vibode_remove_segmentation_dev_allowlist'"), "t");
    assert.equal(await psql("select relforcerowsecurity from pg_class where relname = 'vibode_remove_segmentation_dev_allowlist'"), "f");
    assert.equal(await psql("select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relname = 'vibode_remove_segmentation_dev_allowlist'"), "0");
    assert.match(
      await psql("select prosecdef::text || '|' || coalesce(proconfig::text, '') from pg_proc where proname = 'reserve_vibode_remove_segmentation'"),
      /^true\|\{"?search_path=pg_catalog, public, pg_temp"?\}$/,
    );
    for (const signature of [
      SIGNATURE,
      "public.vibode_remove_segmentation_user_daily_limit()",
      "public.vibode_remove_segmentation_global_daily_limit()",
      "public.vibode_remove_segmentation_dev_daily_limit()",
    ]) {
      assert.equal(await psql(`select has_function_privilege('anon', '${signature}', 'execute')`), "f", signature);
      assert.equal(await psql(`select has_function_privilege('authenticated', '${signature}', 'execute')`), "f", signature);
      assert.equal(await psql(`select has_function_privilege('service_role', '${signature}', 'execute')`), "t", signature);
    }
    for (const table of ["vibode_remove_segmentation_calls", "vibode_remove_segmentation_dev_allowlist"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(await psql(`select has_table_privilege('${role}', 'public.${table}', 'select')`), "f", `${role} ${table}`);
        assert.equal(await psql(`select has_table_privilege('${role}', 'public.${table}', 'insert')`), "f", `${role} ${table}`);
      }
    }
    assert.match(await psqlError("set role service_role; select count(*) from public.vibode_remove_segmentation_calls;"), /permission denied/i);
    assert.match(await psqlError(`set role service_role; insert into public.vibode_remove_segmentation_dev_allowlist (user_id) values ('${USER_DEV}');`), /permission denied/i);
    assert.match(await psqlError("set role anon; select public.vibode_remove_segmentation_dev_daily_limit();"), /permission denied/i);
    assert.match(await definition(), /dev_allowlist/);

    const invalid = await reserve(USER_DEV, ROOM_DEV, GEN_DEV, SHA.toUpperCase());
    assert.equal(invalid.code, "invalid");
    const foreignRoom = await reserve(USER_DEV, ROOM_ORD, GEN_ORD);
    assert.equal(foreignRoom.code, "not_found");
    const foreignGeneration = await reserve(USER_ORD, ROOM_ORD, GEN_DEV);
    assert.equal(foreignGeneration.code, "not_found");
    assert.equal(await ledgerCount(), 0);

    await seed(USER_ORD, ROOM_ORD, GEN_ORD, 23);
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "reserved");
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "user_limit");
    assert.equal(await ledgerCount(), 24);

    await resetCalls();
    await seed(USER_OTHER, ROOM_OTHER, GEN_OTHER, 199);
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "reserved");
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "global_limit");
    assert.equal(await publicCount(), 200);
    assert.equal(await ledgerCount(), 200);

    await resetCalls();
    await seed(USER_DEV, ROOM_DEV, GEN_DEV, 24);
    assert.equal((await reserve(USER_DEV, ROOM_DEV, GEN_DEV)).code, "user_limit");
    await psql(`insert into public.vibode_remove_segmentation_dev_allowlist (user_id) values ('${USER_DEV}')`);
    assert.equal((await reserve(USER_DEV, ROOM_DEV, GEN_DEV)).code, "reserved");
    assert.equal(await ledgerCount(), 25);
    assert.equal(await publicCount(), 0);

    await resetCalls();
    await seed(USER_DEV, ROOM_DEV, GEN_DEV, 199);
    assert.equal((await reserve(USER_DEV, ROOM_DEV, GEN_DEV)).code, "reserved");
    assert.equal((await reserve(USER_DEV, ROOM_DEV, GEN_DEV)).code, "user_limit");
    assert.equal(await userCount(USER_DEV), 200);
    assert.equal(await publicCount(), 0);
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "reserved");
    assert.equal(await publicCount(), 1);
    assert.equal(await ledgerCount(), 201);

    await seed(USER_OTHER, ROOM_OTHER, GEN_OTHER, 199);
    assert.equal(await publicCount(), 200);
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "global_limit");
    assert.equal((await reserve(USER_DEV, ROOM_DEV, GEN_DEV)).code, "user_limit");
    assert.equal(await ledgerCount(), 400);
    await psql(`
      delete from public.vibode_remove_segmentation_calls
      where id in (
        select id from public.vibode_remove_segmentation_calls
        where user_id = '${USER_DEV}'
        limit 150
      );
    `);
    assert.equal(await userCount(USER_DEV), 50);
    assert.equal(await publicCount(), 200);
    const devDespitePublicCap = await reserve(USER_DEV, ROOM_DEV, GEN_DEV);
    assert.equal(devDespitePublicCap.code, "reserved");
    assert.equal(await publicCount(), 200);
    assert.equal(await userCount(USER_DEV), 51);

    await psql(`delete from public.vibode_remove_segmentation_dev_allowlist where user_id = '${USER_DEV}'`);
    assert.equal(await publicCount(), 251);
    assert.equal((await reserve(USER_DEV, ROOM_DEV, GEN_DEV)).code, "user_limit");
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "global_limit");
    assert.equal(await ledgerCount(), 251);

    await psql(`insert into public.vibode_remove_segmentation_dev_allowlist (user_id) values ('${USER_DEV}')`);
    await resetCalls();
    await seedYesterday(USER_ORD, ROOM_ORD, GEN_ORD, 24);
    await seedYesterday(USER_DEV, ROOM_DEV, GEN_DEV, 200);
    assert.equal((await reserveInZone("America/Los_Angeles", USER_ORD, ROOM_ORD, GEN_ORD)).code, "reserved");
    assert.equal((await reserveInZone("America/Los_Angeles", USER_DEV, ROOM_DEV, GEN_DEV)).code, "reserved");
    assert.equal(await ledgerCount(), 2);

    await resetCalls();
    await seed(USER_ORD, ROOM_ORD, GEN_ORD, 22);
    const userRace = await Promise.all([
      reserveRaw(USER_ORD, ROOM_ORD, GEN_ORD),
      reserveRaw(USER_ORD, ROOM_ORD, GEN_ORD),
      reserveRaw(USER_ORD, ROOM_ORD, GEN_ORD),
    ]);
    assert.equal(userRace.filter((item) => item.code === "reserved").length, 2);
    assert.equal(userRace.filter((item) => item.code === "user_limit").length, 1);
    assert.equal(await userCount(USER_ORD), 24);

    await resetCalls();
    await seed(USER_OTHER, ROOM_OTHER, GEN_OTHER, 198);
    const globalRace = await Promise.all([
      reserveRaw(USER_ORD, ROOM_ORD, GEN_ORD),
      reserveRaw(USER_ORD, ROOM_ORD, GEN_ORD),
      reserveRaw(USER_ORD, ROOM_ORD, GEN_ORD),
    ]);
    assert.equal(globalRace.filter((item) => item.code === "reserved").length, 2);
    assert.equal(globalRace.filter((item) => item.code === "global_limit").length, 1);
    assert.equal(await publicCount(), 200);

    await resetCalls();
    await seed(USER_DEV, ROOM_DEV, GEN_DEV, 198);
    const devRace = await Promise.all([
      reserveRaw(USER_DEV, ROOM_DEV, GEN_DEV),
      reserveRaw(USER_DEV, ROOM_DEV, GEN_DEV),
      reserveRaw(USER_DEV, ROOM_DEV, GEN_DEV),
    ]);
    assert.equal(devRace.filter((item) => item.code === "reserved").length, 2);
    assert.equal(devRace.filter((item) => item.code === "user_limit").length, 1);
    assert.equal(await userCount(USER_DEV), 200);
    assert.equal(await publicCount(), 0);
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "reserved");

    await psql("select set_config('vibode.apply_remove_segmentation_dev_exemption', 'verified-function-def', false)");
    await resetCalls();
    await seed(USER_ORD, ROOM_ORD, GEN_ORD, 24);
    assert.equal((await reserve(USER_ORD, ROOM_ORD, GEN_ORD)).code, "user_limit");
    await seed(USER_DEV, ROOM_DEV, GEN_DEV, 200);
    assert.equal((await reserveAs("service_role", USER_DEV, ROOM_DEV, GEN_DEV)).code, "user_limit");

    const beforeCascade = await psql("select count(*) from public.vibode_remove_segmentation_dev_allowlist");
    await psql(`
      insert into auth.users (id) values ('${USER_TEMP}');
      insert into public.vibode_rooms (id, user_id) values ('${ROOM_TEMP}', '${USER_TEMP}');
      insert into public.vibode_afc_generations (id, room_id, user_id) values ('${GEN_TEMP}', '${ROOM_TEMP}', '${USER_TEMP}');
      insert into public.vibode_remove_segmentation_dev_allowlist (user_id) values ('${USER_TEMP}');
      insert into public.vibode_remove_segmentation_calls (user_id, room_id, generation_id, original_sha256)
      values ('${USER_TEMP}', '${ROOM_TEMP}', '${GEN_TEMP}', '${SHA}');
    `);
    await psql(`
      delete from public.vibode_rooms where user_id = '${USER_TEMP}';
      delete from auth.users where id = '${USER_TEMP}';
    `);
    assert.equal(await psql("select count(*) from public.vibode_remove_segmentation_dev_allowlist"), beforeCascade);
    assert.equal(await psql(`select count(*) from public.vibode_remove_segmentation_calls where user_id = '${USER_TEMP}'`), "0");
    assert.match(await psqlError(`set role authenticated; select public.reserve_vibode_remove_segmentation('${USER_ORD}', '${ROOM_ORD}', '${GEN_ORD}', '${SHA}');`), /permission denied/i);
  } finally {
    await removeContainer();
  }
});

async function definition(): Promise<string> {
  return psql(`select pg_get_functiondef('${SIGNATURE}'::regprocedure)`);
}

async function reserve(
  userId: string,
  roomId: string,
  generationId: string,
  sha = SHA,
): Promise<Reservation> {
  const before = await ledgerCount();
  const body = await reserveRaw(userId, roomId, generationId, sha);
  assert.equal(await ledgerCount(), before + (body.code === "reserved" ? 1 : 0));
  return body;
}

async function reserveRaw(
  userId: string,
  roomId: string,
  generationId: string,
  sha = SHA,
): Promise<Reservation> {
  return reserveInZone("UTC", userId, roomId, generationId, sha);
}

async function reserveInZone(
  zone: string,
  userId: string,
  roomId: string,
  generationId: string,
  sha = SHA,
): Promise<Reservation> {
  const body = parseJson(await psql(`
    set time zone '${zone}';
    select public.reserve_vibode_remove_segmentation('${userId}', '${roomId}', '${generationId}', '${sha}');
  `));
  assert.deepEqual(Object.keys(body).sort(), ["code", "ok"]);
  assert.equal(CODES.includes(body.code ?? ""), true, body.code);
  assert.equal(body.ok, body.code === "reserved");
  assert.equal(JSON.stringify(body).includes(userId), false);
  return body;
}

async function reserveAs(role: string, userId: string, roomId: string, generationId: string): Promise<Reservation> {
  const body = parseJson(await psql(`
    set role ${role};
    select public.reserve_vibode_remove_segmentation('${userId}', '${roomId}', '${generationId}', '${SHA}');
  `));
  assert.deepEqual(Object.keys(body).sort(), ["code", "ok"]);
  return body;
}

async function seed(userId: string, roomId: string, generationId: string, rows: number): Promise<void> {
  await psql(`
    insert into public.vibode_remove_segmentation_calls
      (user_id, room_id, generation_id, original_sha256, created_at)
    select '${userId}', '${roomId}', '${generationId}', '${SHA}',
           (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc') + interval '1 second'
    from generate_series(1, ${rows});
  `);
}

async function seedYesterday(userId: string, roomId: string, generationId: string, rows: number): Promise<void> {
  await psql(`
    insert into public.vibode_remove_segmentation_calls
      (user_id, room_id, generation_id, original_sha256, created_at)
    select '${userId}', '${roomId}', '${generationId}', '${SHA}',
           (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc') - interval '1 second'
    from generate_series(1, ${rows});
  `);
}

async function resetCalls(): Promise<void> {
  await psql("delete from public.vibode_remove_segmentation_calls");
}

async function ledgerCount(): Promise<number> {
  return count("select count(*) from public.vibode_remove_segmentation_calls");
}

async function userCount(userId: string): Promise<number> {
  return count(`select count(*) from public.vibode_remove_segmentation_calls where user_id = '${userId}'`);
}

async function publicCount(): Promise<number> {
  return count(`
    select count(*)
    from public.vibode_remove_segmentation_calls as ledger
    where not exists (
      select 1
      from public.vibode_remove_segmentation_dev_allowlist as allowlist
      where allowlist.user_id = ledger.user_id
    )
  `);
}

function parseJson(text: string): Reservation {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("{"));
  if (!line) throw new Error(`no reservation json\n${text}`);
  return JSON.parse(line) as Reservation;
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
    create table public.vibode_afc_generations (
      id uuid primary key,
      room_id uuid not null,
      user_id uuid not null
    );
    insert into auth.users (id) values ('${USER_ORD}'), ('${USER_DEV}'), ('${USER_OTHER}');
    insert into public.vibode_rooms (id, user_id) values
      ('${ROOM_ORD}', '${USER_ORD}'),
      ('${ROOM_DEV}', '${USER_DEV}'),
      ('${ROOM_OTHER}', '${USER_OTHER}');
    insert into public.vibode_afc_generations (id, room_id, user_id) values
      ('${GEN_ORD}', '${ROOM_ORD}', '${USER_ORD}'),
      ('${GEN_DEV}', '${ROOM_DEV}', '${USER_DEV}'),
      ('${GEN_OTHER}', '${ROOM_OTHER}', '${USER_OTHER}');
  `);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "removedev", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "removedev", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=removedev",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "removedev", "-t", "-A", "-c", "select 1",
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
