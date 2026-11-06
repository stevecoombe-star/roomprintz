/**
 * Personal furniture tables and private bucket policies.
 *
 * Applies only this migration to a disposable local Postgres 16 container.
 * Docker is required. The test does not connect to hosted Supabase.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1a-pg";
const DATABASE = "furniture1a";
const MIGRATION = "supabase/migrations/20261105180000_vibode_furniture_assets.sql";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ASSET_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_ID = `vibode-furniture/personal/${ASSET_UUID}`;
const PATH_A = `users/${USER_A}/assets/${ASSET_UUID}/model.glb`;
const SHA = "ab".repeat(32);

function migrationSql(): string {
  return readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
}

test("personal furniture grants, immutability, and storage denial hold on disposable postgres", { timeout: 180_000 }, async () => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }
  const migration = migrationSql();
  assert.match(migration, /revoke all on table public\.vibode_furniture_assets from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.vibode_furniture_assets to service_role/);
  assert.doesNotMatch(migration, /grant select, insert, update, delete on table public\.vibode_furniture_assets/);
  assert.doesNotMatch(migration, /vibode_furniture_assets_no_delete/);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /vibode-furniture-assets/);
  assert.doesNotMatch(migration, /create table public\.vibode_stage_assets|alter table public\.vibode_stage_assets|insert into public\.vibode_stage_assets/);

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
      select id || ':' || "public"::text || ':' || file_size_limit::text
      from storage.buckets where id = 'vibode-furniture-assets'
    `), "vibode-furniture-assets:false:26214400");
    assert.equal(await psql(`
      select count(*) from pg_policy
      where polrelid in (
        'public.vibode_furniture_assets'::regclass,
        'public.vibode_furniture_asset_uploads'::regclass
      )
    `), "0");
    assert.equal(await psql(`
      select count(*) from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('vibode_furniture_assets', 'vibode_furniture_asset_uploads')
        and grantee in ('anon', 'authenticated', 'public')
    `), "0");
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["vibode_furniture_assets", "vibode_furniture_asset_uploads"]) {
        assert.match(await psqlErrorAs(role, `select user_id from public.${table}`), /permission denied/i);
        assert.match(await psqlErrorAs(role, `insert into public.${table} default values`), /permission denied/i);
        assert.match(await psqlErrorAs(role, `update public.${table} set user_id = user_id`), /permission denied/i);
        assert.match(await psqlErrorAs(role, `delete from public.${table}`), /permission denied/i);
      }
    }
    assert.match(await psqlErrorAs("authenticated", `
      select storage_object_path from public.vibode_furniture_assets
    `), /permission denied/i);
    await psqlAs("service_role", `
      insert into public.vibode_furniture_assets (
        asset_id, user_id, display_name, category, origin,
        authored_width_m, authored_height_m, authored_depth_m,
        sha256, byte_size, storage_bucket, storage_object_path, library_visibility
      ) values (
        '${ASSET_ID}', '${USER_A}', 'Chair', null, 'uploaded',
        1, 0.8, 0.6,
        '${SHA}', 128, 'vibode-furniture-assets', '${PATH_A}', 'active'
      )
    `);
    assert.match(await psqlErrorAs("service_role", `
      update public.vibode_furniture_assets set sha256 = '${"cd".repeat(32)}' where asset_id = '${ASSET_ID}'
    `), /VIBODE_FURNITURE_ASSET:IMMUTABLE/);
    assert.match(await psqlErrorAs("service_role", `
      delete from public.vibode_furniture_assets where asset_id = '${ASSET_ID}'
    `), /permission denied/i);
    assert.match(await psqlErrorAs("authenticated", `
      delete from public.vibode_furniture_assets where asset_id = '${ASSET_ID}'
    `), /permission denied/i);
    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_furniture_assets (
        asset_id, user_id, display_name, origin,
        authored_width_m, authored_height_m, authored_depth_m,
        sha256, byte_size, storage_bucket, storage_object_path
      ) values (
        'vibode-furniture/personal/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '${USER_A}', 'Wrong path', 'uploaded',
        1, 1, 1, '${"ef".repeat(32)}', 64,
        'vibode-furniture-assets', 'users/${USER_B}/assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/model.glb'
      )
    `), /vibode_furniture_assets_path/);
    await psqlAs("service_role", `
      update public.vibode_furniture_assets
      set library_visibility = 'archived', display_name = 'Archived chair'
      where asset_id = '${ASSET_ID}' and user_id = '${USER_A}'
    `);
    assert.equal(await psqlAs("service_role", `
      select library_visibility || ':' || display_name || ':' || sha256
      from public.vibode_furniture_assets where asset_id = '${ASSET_ID}'
    `), `archived:Archived chair:${SHA}`);
    const assetB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const uploadA = "33333333-3333-4333-8333-333333333333";
    await psqlAs("service_role", `
      insert into public.vibode_furniture_assets (
        asset_id, user_id, display_name, origin,
        authored_width_m, authored_height_m, authored_depth_m,
        sha256, byte_size, storage_bucket, storage_object_path
      ) values (
        'vibode-furniture/personal/${assetB}', '${USER_B}', 'Other chair', 'uploaded',
        1, 1, 1, '${"cd".repeat(32)}', 64,
        'vibode-furniture-assets', 'users/${USER_B}/assets/${assetB}/model.glb'
      );
      insert into public.vibode_furniture_asset_uploads (
        upload_id, user_id, asset_id, storage_bucket,
        pending_object_path, permanent_object_path, status, expires_at
      ) values (
        '${uploadA}', '${USER_A}', '${ASSET_ID}', 'vibode-furniture-assets',
        'users/${USER_A}/uploads/${uploadA}/model.glb',
        '${PATH_A}', 'pending', now() + interval '1 hour'
      );
    `);
    await psql(`
      insert into storage.objects (bucket_id, name)
      values ('vibode-furniture-assets', '${PATH_A}');
      delete from auth.users where id = '${USER_A}';
    `);
    assert.equal(await psql(`select count(*) from auth.users where id = '${USER_A}'`), "0");
    assert.equal(await psql(`select count(*) from auth.users where id = '${USER_B}'`), "1");
    assert.equal(await psql(`
      select count(*) from public.vibode_furniture_assets where user_id = '${USER_A}'
    `), "0");
    assert.equal(await psql(`
      select count(*) from public.vibode_furniture_asset_uploads where user_id = '${USER_A}'
    `), "0");
    assert.equal(await psql(`
      select asset_id from public.vibode_furniture_assets where user_id = '${USER_B}'
    `), `vibode-furniture/personal/${assetB}`);
    assert.equal(await psql(`
      select count(*) from storage.objects
      where bucket_id = 'vibode-furniture-assets' and name = '${PATH_A}'
    `), "1");

    await psql(`
      insert into storage.objects (bucket_id, name) values
        ('vibode-furniture-assets', '${PATH_A}'),
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
      select count(*) from storage.objects where bucket_id = 'vibode-furniture-assets'
    `), "0");
    assert.equal(await psqlAs("authenticated", `
      select count(*) from storage.objects where bucket_id = 'public-bucket'
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
