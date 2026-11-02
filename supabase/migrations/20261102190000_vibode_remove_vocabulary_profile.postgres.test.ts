/**
 * REMOVE vocabulary profile columns.
 *
 * The source contract always runs and does not open a database.
 * The integration test applies only this migration to a disposable local
 * Postgres 16 container when Docker is available. It does not connect to
 * hosted Supabase.
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
const SHA = "ab".repeat(32);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("authenticated clients cannot write the vocabulary columns", { timeout: 180_000 }, async (t) => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    t.skip("local Docker is unavailable; hosted verification remains pending");
    return;
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
      create or replace function auth.role() returns text
      language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role')
      $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.role() to anon, authenticated, service_role;
      create table public.vibode_rooms (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade
      );
      insert into auth.users (id) values ('${USER}');
      insert into public.vibode_rooms (id, user_id) values ('${ROOM}', '${USER}');
    `);
    await psql(source(MIGRATION));
    assert.equal(await psql(`
      select remove_vocabulary_profile is null and remove_vocabulary_original_sha256 is null
      from public.vibode_rooms where id = '${ROOM}'
    `), "t");
    assert.match(await psqlError(`
      update public.vibode_rooms
      set remove_vocabulary_profile = 'kitchen',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}';
    `), /vibode_rooms_remove_vocabulary_profile_pair/);
    assert.match(await psqlError(`
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom'
      where id = '${ROOM}';
    `), /vibode_rooms_remove_vocabulary_profile_pair/);

    await psql(`
      update public.vibode_rooms
      set remove_vocabulary_profile = 'bedroom',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}';
    `);
    assert.equal(await psql("select remove_vocabulary_profile from public.vibode_rooms"), "bedroom");

    await psql("grant select, update, insert on public.vibode_rooms to authenticated");
    const rejected = await psqlError(`
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      update public.vibode_rooms
      set remove_vocabulary_profile = 'default',
          remove_vocabulary_original_sha256 = '${SHA}'
      where id = '${ROOM}';
    `);
    assert.match(rejected, /remove vocabulary profile is server-managed/);
    assert.equal(await psql("select remove_vocabulary_profile from public.vibode_rooms"), "bedroom");

    const inserted = await psqlError(`
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
      insert into public.vibode_rooms (id, user_id, remove_vocabulary_profile, remove_vocabulary_original_sha256)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${USER}', 'default', '${SHA}');
    `);
    assert.match(inserted, /remove vocabulary profile is server-managed/);
  } finally {
    await removeContainer();
  }
});

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "removevocab", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "removevocab", "-v", "ON_ERROR_STOP=1", "-t", "-A",
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
