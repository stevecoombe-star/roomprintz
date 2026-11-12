/**
 * MESHY-1D.3D owner allowance read on disposable Postgres 16.
 * The chain includes cleanup, then this read. No provider call and no hosted database.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d3d-pg";
const DATABASE = "furniture1d3d";
const MIGRATION = "supabase/migrations/20261111210000_vibode_furniture_generation_owner_allowance.sql";
const PRIOR = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
  "supabase/migrations/20261109210000_vibode_furniture_generation_beta_allowances.sql",
  "supabase/migrations/20261109220000_vibode_furniture_generation_beta_allowance_reserve.sql",
  "supabase/migrations/20261110203000_vibode_furniture_generation_beta_allowance_settlement.sql",
  "supabase/migrations/20261110223000_vibode_furniture_generation_processing_slot.sql",
  "supabase/migrations/20261110233000_vibode_furniture_generation_submission_commit.sql",
  "supabase/migrations/20261111003000_vibode_furniture_generation_unreported_credits.sql",
  "supabase/migrations/20261111013000_vibode_furniture_generation_resubmit_budget.sql",
  "supabase/migrations/20261111150000_vibode_furniture_generation_admin_reads.sql",
  "supabase/migrations/20261111170000_vibode_furniture_generation_admin_testers.sql",
  "supabase/migrations/20261111190000_vibode_furniture_generation_cleanup.sql",
];

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SHA = "ab".repeat(32);
const SETTINGS = JSON.stringify({
  geometryResolution: "standard",
  shouldTexture: true,
  textureModel: "default",
  textureResolution: "2k",
  enablePbr: false,
  texturePrompt: "",
  imageEnhancement: true,
  shouldRemesh: false,
  topology: "triangle",
  targetPolycount: 30000,
});
const READ = "public.read_vibode_furniture_generation_owner_allowance(uuid)";

test("owner allowance reads stay private and do not change spending controls", { timeout: 240_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /api\.meshy|MESHY_API_KEY|set\s+live_enabled|set\s+credit_ceiling|set\s+paid_submissions|set\s+credits_/i);
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  const fetches = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetches.count += 1;
    throw new Error("real_network_blocked");
  }) as typeof fetch;
  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key, email text);
      insert into auth.users (id, email) values
        ('${USER_A}', 'ada@example.com'),
        ('${USER_B}', 'other@example.com'),
        ('${ADMIN}', 'operator@example.com');
      grant usage on schema public to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of PRIOR) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    const before = await spendingFingerprint();
    await psql("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, public;");
    await psql(migration);
    assert.equal(await spendingFingerprint(), before);
    assert.equal(await privilege("anon", READ), "false");
    assert.equal(await privilege("authenticated", READ), "false");
    assert.equal(await privilege("public", READ), "false");
    assert.equal(await privilege("service_role", READ), "true");
    assert.equal(await psql(`
      select has_table_privilege('authenticated', 'public.vibode_furniture_generation_allowances', 'select')::text
    `), "false");

    const missing = await readJson(`select public.read_vibode_furniture_generation_owner_allowance('${USER_A}')`);
    assert.equal(missing.approved, false);
    assert.equal(missing.remaining, 0);
    const absent = await readJson("select public.read_vibode_furniture_generation_owner_allowance(null)");
    assert.equal(absent.ok, false);
    assert.equal(absent.code, "not_found");

    await grant(USER_A, true, 3);
    await grant(USER_B, true, 4);
    const own = await readJson(`select public.read_vibode_furniture_generation_owner_allowance('${USER_A}')`);
    const other = await readJson(`select public.read_vibode_furniture_generation_owner_allowance('${USER_B}')`);
    assert.equal(own.approved, true);
    assert.equal(own.enabled, true);
    assert.equal(own.authorized, 3);
    assert.equal(own.remaining, 3);
    assert.equal(other.authorized, 4);
    assert.equal(other.remaining, 4);
    assert.notEqual(own.remaining, other.remaining);
    assert.equal(await spendingFingerprint(), before);

    const denied = await reserve(USER_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "owner-live-off");
    assert.equal(denied.code, "disabled");
    assert.equal(await reservedGenerations(USER_A), "0");

    await psql(`
      update public.vibode_furniture_generation_allowances
      set enabled = false
      where user_id = '${USER_A}';
      update public.vibode_furniture_generation_controls
      set live_enabled = true
      where control_id = 'global';
    `);
    const turnedOff = await reserve(USER_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "owner-disabled");
    assert.equal(turnedOff.code, "allowance_disabled");
    await psql(`
      update public.vibode_furniture_generation_allowances
      set enabled = true, consumed_generations = 3
      where user_id = '${USER_A}'
    `);
    const exhausted = await reserve(USER_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "owner-exhausted");
    assert.equal(exhausted.code, "allowance_exhausted");
    await psql(`
      update public.vibode_furniture_generation_allowances
      set consumed_generations = 0
      where user_id = '${USER_A}';
      update public.vibode_furniture_generation_controls
      set credits_consumed = 20
      where control_id = 'global';
    `);
    const overBudget = await reserve(USER_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "owner-over-budget");
    assert.equal(overBudget.code, "quota_exhausted");
    assert.equal(await reservedGenerations(USER_A), "0");
    assert.equal(await psql("select credits_reserved::text from public.vibode_furniture_generation_controls"), "0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 0
      where control_id = 'global'
    `);
    const wrong = await reserve(
      USER_A,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
      "owner-wrong-profile",
      JSON.stringify({ ...JSON.parse(SETTINGS), shouldTexture: false }),
    );
    assert.equal(wrong.code, "unsupported_settings");
    assert.equal(await reservedGenerations(USER_A), "0");

    const created = await reserve(USER_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", "owner-certified");
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.reserved_credits, 30);
    const replay = await reserve(USER_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7", "owner-certified");
    assert.equal(replay.created, false);
    assert.equal(replay.job_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6");
    assert.equal(await reservedGenerations(USER_A), "1");
    const after = await readJson(`select public.read_vibode_furniture_generation_owner_allowance('${USER_A}')`);
    assert.equal(after.remaining, 2);
    assert.equal(await readJson(`select public.read_vibode_furniture_generation_owner_allowance('${USER_B}')`)
      .then((row) => row.remaining), 4);
    assert.equal(await psql(`
      select credit_ceiling::text || '|' || max_concurrent::text
        || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
        || '|' || credits_reserved::text
      from public.vibode_furniture_generation_controls
      where control_id = 'global'
    `), "40|1|0|0|30");
    assert.equal(fetches.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function grant(userId: string, enabled: boolean, authorized: number): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_allowances (
      user_id, classification, enabled, authorized_generations,
      reserved_generations, consumed_generations, updated_by
    ) values (
      '${userId}', 'individual_beta', ${enabled ? "true" : "false"}, ${authorized}, 0, 0, '${ADMIN}'
    )
  `);
}

async function reserve(userId: string, jobId: string, key: string, settings = SETTINGS): Promise<Record<string, unknown>> {
  return readJson(`
    select public.reserve_vibode_furniture_generation(
      '${userId}', '${jobId}', '${key}', '${SHA}',
      'image-to-3d', 'meshy-7.1', '${settings}'::jsonb, array['front']::text[], 30
    )
  `);
}

async function reservedGenerations(userId: string): Promise<string> {
  return psql(`
    select reserved_generations::text
    from public.vibode_furniture_generation_allowances
    where user_id = '${userId}'
  `);
}

async function privilege(role: string, signature: string): Promise<string> {
  return psql(`select has_function_privilege('${role}', '${signature}', 'execute')::text`);
}

async function spendingFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || credit_ceiling::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
      || '|' || credits_reserved::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function readJson(sqlText: string): Promise<Record<string, unknown>> {
  return JSON.parse(await psql(sqlText)) as Record<string, unknown>;
}

async function psql(sqlText: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sqlText);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sqlText.slice(0, 700)}`);
  return result.stdout.trim();
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
    if (`${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete")) {
      const probe = await docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1"]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  throw new Error("disposable postgres 16 did not become ready");
}

async function removeContainer(): Promise<void> {
  await docker(["rm", "-f", CONTAINER]);
}

type CommandResult = Readonly<{ code: number; stdout: string; stderr: string }>;

function docker(args: string[], input?: string): Promise<CommandResult> {
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
