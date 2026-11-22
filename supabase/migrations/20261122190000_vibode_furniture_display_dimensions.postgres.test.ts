/**
 * Display dimensions can change. The GLB identity cannot.
 *
 * Applies the personal-furniture migration and this forward migration to a
 * disposable local Postgres 16 container. Docker is required. The test does
 * not connect to hosted Supabase.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-dim-pg";
const DATABASE = "furnituredim";
const USER_A = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PATH_A = `users/${USER_A}/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/model.glb`;
const SHA = "ab".repeat(32);

test("display dimensions are editable and the stored GLB stays immutable", { timeout: 180_000 }, async () => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }
  const migration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261122190000_vibode_furniture_display_dimensions.sql"),
    "utf8",
  );
  assert.doesNotMatch(migration, /update\s+public\.vibode_furniture_assets/i);
  assert.doesNotMatch(migration, /vibode_furniture_generation_controls|paid_submissions_used/);

  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER_A}');
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
    await psql(readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261105180000_vibode_furniture_assets.sql"),
      "utf8",
    ));
    await psql(`
      insert into public.vibode_furniture_assets (
        asset_id, user_id, display_name, origin,
        authored_width_m, authored_height_m, authored_depth_m,
        sha256, byte_size, storage_bucket, storage_object_path
      ) values (
        '${ASSET_ID}', '${USER_A}', 'Table', 'uploaded',
        1, 0.4, 0.6,
        '${SHA}', 128, 'vibode-furniture-assets', '${PATH_A}'
      );
    `);
    await psql(migration);
    assert.equal(await psql(`
      select coalesce(display_width_m::text, 'null')
        || '|' || dimension_sizing_mode
      from public.vibode_furniture_assets
      where asset_id = '${ASSET_ID}'
    `), "null|uniform");
    await psql(`
      update public.vibode_furniture_assets
      set display_width_m = 2,
          display_height_m = 0.8,
          display_depth_m = 1.2,
          dimension_sizing_mode = 'exact'
      where asset_id = '${ASSET_ID}'
    `);
    assert.equal(await psql(`
      select display_width_m::text || '|' || authored_width_m::text
        || '|' || sha256 || '|' || dimension_sizing_mode
      from public.vibode_furniture_assets
      where asset_id = '${ASSET_ID}'
    `), `2|1|${SHA}|exact`);
    assert.match(await psqlError(`
      update public.vibode_furniture_assets
      set authored_width_m = 2
      where asset_id = '${ASSET_ID}'
    `), /VIBODE_FURNITURE_ASSET:IMMUTABLE/);
    assert.match(await psqlError(`
      update public.vibode_furniture_assets
      set display_width_m = null
      where asset_id = '${ASSET_ID}'
    `), /vibode_furniture_assets_display_dimensions/);
    assert.match(await psqlError(`
      update public.vibode_furniture_assets
      set display_width_m = 0.01,
          display_height_m = 0.4,
          display_depth_m = 0.6
      where asset_id = '${ASSET_ID}'
    `), /vibode_furniture_assets_display_dimensions/);
    assert.equal(await psql(`
      select byte_size::text || '|' || storage_object_path
      from public.vibode_furniture_assets
      where asset_id = '${ASSET_ID}'
    `), `128|${PATH_A}`);
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

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
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
