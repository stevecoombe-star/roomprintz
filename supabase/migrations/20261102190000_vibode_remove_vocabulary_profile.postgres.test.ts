/**
 * REMOVE vocabulary profile columns.
 *
 * Applies only this migration to a disposable local Postgres 16 container.
 * Docker is required. The test does not skip and does not connect to hosted
 * Supabase.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "remove-vocab-pg";
const MIGRATION = "supabase/migrations/20261102190000_vibode_remove_vocabulary_profile.sql";
const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PLAIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const GEN1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const GEN2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const SHA = "ab".repeat(32);
const SHA2 = "cd".repeat(32);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("vocabulary profile constraint and trigger hold on the existing room schema", { timeout: 180_000 }, async () => {
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
      insert into auth.users (id) values ('${USER}');
      create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.role() returns text
      language sql stable as $$
        select coalesce(
          nullif(current_setting('request.jwt.claim.role', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
        )
      $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      grant execute on function auth.role() to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;
      create table public.vibode_rooms (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade,
        title text not null default 'Untitled Room',
        status text not null default 'draft',
        source_type text not null default 'upload',
        metadata jsonb not null default '{}'::jsonb,
        sort_key timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        base_image_url text null,
        base_storage_path text null,
        base_version_id uuid null,
        folder_id uuid null,
        current_afc_generation_id uuid null,
        room_scale_multiplier double precision not null default 1.0,
        constraint vibode_rooms_room_scale_multiplier_range
          check (room_scale_multiplier >= 0.25 and room_scale_multiplier <= 2.00)
      );
      create or replace function public.protect_current_afc_generation_id()
      returns trigger language plpgsql set search_path = public as $$
      begin
        if tg_op = 'UPDATE'
          and new.current_afc_generation_id is distinct from old.current_afc_generation_id
          and auth.role() = 'authenticated'
        then
          raise exception 'current_afc_generation_id is server-managed';
        end if;
        return new;
      end;
      $$;
      create trigger protect_current_afc_generation_id
      before update on public.vibode_rooms
      for each row execute function public.protect_current_afc_generation_id();
      create trigger set_timestamp_vibode_rooms
      before update on public.vibode_rooms
      for each row execute function public.set_timestamp();
      alter table public.vibode_rooms enable row level security;
      create policy vibode_rooms_owner_all on public.vibode_rooms
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
      insert into public.vibode_rooms (id, user_id, title, metadata, current_afc_generation_id)
      values (
        '${ROOM}',
        '${USER}',
        'Existing room',
        '{"activeSetVersionId":"keep-me"}'::jsonb,
        '${GEN1}'
      );
    `);

    const policyBefore = await psql(`
      select polname || ':' || polcmd::text
      from pg_policy where polrelid = 'public.vibode_rooms'::regclass
    `);
    const pointerBefore = await psql(`
      select md5(pg_get_functiondef('public.protect_current_afc_generation_id()'::regprocedure))
    `);
    const tablesBefore = await psql(`
      select string_agg(relname, ',' order by relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);

    await psql(source(MIGRATION));

    assert.equal(await psql(`
      select remove_vocabulary_profile is null
        and remove_vocabulary_original_sha256 is null
        and metadata = '{"activeSetVersionId":"keep-me"}'::jsonb
        and title = 'Existing room'
        and room_scale_multiplier = 1
      from public.vibode_rooms where id = '${ROOM}'
    `), "t");
    assert.equal(await psql(`
      select polname || ':' || polcmd::text
      from pg_policy where polrelid = 'public.vibode_rooms'::regclass
    `), policyBefore);
    assert.equal(await psql(`
      select md5(pg_get_functiondef('public.protect_current_afc_generation_id()'::regprocedure))
    `), pointerBefore);
    assert.equal(await psql(`
      select string_agg(relname, ',' order by relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `), tablesBefore);
    assert.equal(await psql(`
      select string_agg(tgname, ',' order by tgname)
      from pg_trigger
      where tgrelid = 'public.vibode_rooms'::regclass and not tgisinternal
    `), "protect_current_afc_generation_id,protect_remove_vocabulary_profile,set_timestamp_vibode_rooms");
    assert.equal(await psql(`
      select to_regclass('public.vibode_remove_segmentation_calls') is null
        and to_regclass('public.reserve_vibode_remove_segmentation') is null
        and to_regclass('public.vibode_cleanup_generations') is null
    `), "t");

    await rejectPair("profile only", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom'
      where id = '${ROOM}'
    `);
    await rejectPair("sha only", `
      update public.vibode_rooms
      set remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}'
    `);
    await rejectPair("default only", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default'
      where id = '${ROOM}'
    `);
    await rejectPair("kitchen", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'kitchen',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}'
    `);
    await rejectPair("living", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'living',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}'
    `);
    await rejectPair("uppercase sha", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default',
          remove_vocabulary_original_sha256 = '${SHA.toUpperCase()}'
      where id = '${ROOM}'
    `);
    await rejectPair("short sha", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom',
          remove_vocabulary_original_sha256 = 'abc'
      where id = '${ROOM}'
    `);
    await rejectPair("empty sha", `
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom',
          remove_vocabulary_original_sha256 = ''
      where id = '${ROOM}'
    `);
    assert.equal(await pairState(), `<null>|<null>|Existing room|${GEN1}`);

    await psql(`
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}'
    `);
    assert.equal(await pairState(), `bedroom|${SHA}|Existing room|${GEN1}`);
    await rejectPair("clear sha", `
      update public.vibode_rooms
      set remove_vocabulary_original_sha256 = null
      where id = '${ROOM}'
    `);
    await rejectPair("clear profile", `
      update public.vibode_rooms
      set remove_vocabulary_profile = null
      where id = '${ROOM}'
    `);
    assert.equal(await pairState(), `bedroom|${SHA}|Existing room|${GEN1}`);

    await psql("grant select, update, insert on public.vibode_rooms to anon, authenticated, service_role");
    assert.match(await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}';
    `), /remove vocabulary profile is server-managed/);
    assert.match(await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      insert into public.vibode_rooms (
        id, user_id, remove_vocabulary_profile, remove_vocabulary_original_sha256
      ) values (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${USER}', 'default', '${SHA}'
      );
    `), /remove vocabulary profile is server-managed/);
    assert.match(await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'service_role', false);
      set role authenticated;
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default',
          remove_vocabulary_original_sha256 = '${SHA2}'
      where id = '${ROOM}';
    `), /remove vocabulary profile is server-managed/);
    assert.match(await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'service_role', false);
      set role anon;
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default',
          remove_vocabulary_original_sha256 = '${SHA2}'
      where id = '${ROOM}';
    `), /remove vocabulary profile is server-managed/);
    assert.equal(await pairState(), `bedroom|${SHA}|Existing room|${GEN1}`);

    await psql(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      update public.vibode_rooms
      set title = 'Renamed by owner',
          metadata = metadata || '{"note":"owner"}'::jsonb
      where id = '${ROOM}';
    `);
    assert.equal(await pairState(), `bedroom|${SHA}|Renamed by owner|${GEN1}`);
    assert.equal(await psql(`
      select metadata = '{"activeSetVersionId":"keep-me","note":"owner"}'::jsonb
      from public.vibode_rooms where id = '${ROOM}'
    `), "t");
    assert.match(await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      update public.vibode_rooms
      set title = 'Should roll back',
          remove_vocabulary_profile = 'default'
      where id = '${ROOM}';
    `), /remove vocabulary profile is server-managed/);
    assert.equal(await pairState(), `bedroom|${SHA}|Renamed by owner|${GEN1}`);
    await psql(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      insert into public.vibode_rooms (id, user_id, title)
      values ('${PLAIN}', '${USER}', 'Plain insert');
    `);
    assert.equal(await psql(`
      select remove_vocabulary_profile is null and remove_vocabulary_original_sha256 is null
      from public.vibode_rooms where id = '${PLAIN}'
    `), "t");

    assert.equal(lastLine(await psql(`
      select set_config('request.jwt.claim.role', 'service_role', false);
      set role service_role;
      with updated as (
        update public.vibode_rooms
        set remove_vocabulary_profile = 'default',
            remove_vocabulary_original_sha256 = '${SHA2}'
        where id = '${ROOM}'
          and user_id = '${USER}'
          and current_afc_generation_id = '${GEN2}'
        returning 1
      )
      select count(*)::text from updated;
    `)), "0");
    assert.equal(await pairState(), `bedroom|${SHA}|Renamed by owner|${GEN1}`);
    assert.equal(lastLine(await psql(`
      select set_config('request.jwt.claim.role', 'service_role', false);
      set role service_role;
      with updated as (
        update public.vibode_rooms
        set remove_vocabulary_profile = 'default',
            remove_vocabulary_original_sha256 = '${SHA2}'
        where id = '${ROOM}'
          and user_id = '${USER}'
          and current_afc_generation_id = '${GEN1}'
        returning 1
      )
      select count(*)::text from updated;
    `)), "1");
    assert.equal(await pairState(), `default|${SHA2}|Renamed by owner|${GEN1}`);

    await psql(`
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role service_role;
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}';
    `);
    assert.equal(await pairState(), `bedroom|${SHA}|Renamed by owner|${GEN1}`);
    await psql(`
      select set_config('request.jwt.claim.role', 'authenticated', false);
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default',
          remove_vocabulary_original_sha256 = '${SHA2}'
      where id = '${ROOM}';
    `);
    assert.equal(await pairState(), `default|${SHA2}|Renamed by owner|${GEN1}`);

    await psql("alter role authenticated login; grant service_role to authenticated;");
    assert.match(await psqlErrorAs("authenticated", `
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'service_role', false);
      set role service_role;
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}';
    `), /remove vocabulary profile is server-managed/);
    assert.equal(await pairState(), `default|${SHA2}|Renamed by owner|${GEN1}`);

    assert.match(await psqlError(`
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      update public.vibode_rooms
      set current_afc_generation_id = '${GEN2}'
      where id = '${ROOM}';
    `), /current_afc_generation_id is server-managed/);
    assert.equal(await pairState(), `default|${SHA2}|Renamed by owner|${GEN1}`);
    assert.equal(await psql(`
      select room_scale_multiplier = 1 from public.vibode_rooms where id = '${ROOM}'
    `), "t");
  } finally {
    await removeContainer();
  }
});

function lastLine(value: string): string {
  const lines = value.split(/\n/).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

async function pairState(): Promise<string> {
  return psql(`
    select coalesce(remove_vocabulary_profile, '<null>')
      || '|' || coalesce(remove_vocabulary_original_sha256, '<null>')
      || '|' || title
      || '|' || current_afc_generation_id::text
    from public.vibode_rooms where id = '${ROOM}'
  `);
}

async function rejectPair(label: string, sql: string): Promise<void> {
  const error = await psqlError(sql);
  assert.match(error, /vibode_rooms_remove_vocabulary_profile_pair/, label);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "removevocab", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  return runPsql("postgres", sql);
}

async function psqlErrorAs(user: string, sql: string): Promise<string> {
  return runPsql(user, sql);
}

async function runPsql(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", "removevocab", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=removevocab",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "removevocab", "-t", "-A", "-c", "select 1",
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
