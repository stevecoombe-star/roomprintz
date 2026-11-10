/**
 * MESHY-1D.2A allowance schema on disposable Postgres 16.
 * Docker is required. The database is created empty, the certified generation
 * migrations are applied, and only then is the allowance migration applied.
 * This test does not connect to hosted Supabase, does not run supabase db push,
 * and does not call Meshy.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d2a-pg";
const DATABASE = "furniture1d2a";
const MIGRATION = "supabase/migrations/20261109210000_vibode_furniture_generation_beta_allowances.sql";
const BASELINE = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
];
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const JOB_SAVED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const JOB_FAILED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const JOB_NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
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

test("beta allowance schema holds on a certified baseline without changing controls", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.doesNotMatch(migration, /vibode_furniture_generation_controls/i);
  assert.doesNotMatch(migration, /live_enabled|credit_ceiling|paid_submissions/i);
  assert.doesNotMatch(migration, /insert into public\.vibode_furniture_generation_allowances/i);
  assert.match(migration, /allowance_state is null or allowance_state in \('reserved', 'consumed', 'released'\)/);
  assert.match(migration, /ALLOWANCE_EVENT_IMMUTABLE/);

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
      insert into auth.users (id) values ('${USER_A}'), ('${USER_B}'), ('${ADMIN}');
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
    for (const file of BASELINE) {
      await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    }
    await insertLegacyJob(JOB_SAVED, "idem-1d2a-saved", "saved", "reconciled", 30, assetId(JOB_SAVED));
    await insertLegacyJob(JOB_FAILED, "idem-1d2a-failed", "failed", "released", 0, null);
    const assetsBefore = await psql("select count(*)::text from public.vibode_furniture_assets");
    const controlsBefore = await controlFingerprint();
    const controlShapeBefore = await controlShape();

    await psql(`
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, public;
    `);
    await psql(migration);

    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await controlShape(), controlShapeBefore);
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_allowances"), "0");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_allowance_events"), "0");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_assets"), assetsBefore);
    assert.equal(await jobAllowance(JOB_SAVED), `saved:reconciled:30:${assetId(JOB_SAVED)}:legacy-null`);
    assert.equal(await jobAllowance(JOB_FAILED), "failed:released:0::legacy-null");
    assert.equal(await psql(`
      select is_nullable || ':' || coalesce(column_default, 'none')
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vibode_furniture_generation_jobs'
        and column_name = 'allowance_state'
    `), "YES:none");
    assert.equal(await psql(`
      select c.relrowsecurity::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'vibode_furniture_generation_allowances'
    `), "true");
    assert.equal(await psql(`
      select c.relrowsecurity::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'vibode_furniture_generation_allowance_events'
    `), "true");
    assert.equal(await psql(`
      select count(*)::text from pg_policies
      where schemaname = 'public' and tablename like 'vibode_furniture_generation_allowance%'
    `), "0");
    assert.equal(await psql(`
      select count(*)::text from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in (
          'vibode_furniture_generation_allowances',
          'vibode_furniture_generation_allowance_events'
        )
        and grantee in ('anon', 'authenticated', 'public', 'service_role')
    `), "0");
    assert.equal(await psql(`
      select has_function_privilege('public', 'public.vibode_furniture_generation_allowance_events_immutable()', 'execute')::text
        || ':' || has_function_privilege('anon', 'public.vibode_furniture_generation_allowance_events_immutable()', 'execute')::text
        || ':' || has_function_privilege('authenticated', 'public.vibode_furniture_generation_allowance_events_immutable()', 'execute')::text
        || ':' || has_function_privilege('service_role', 'public.vibode_furniture_generation_allowance_events_immutable()', 'execute')::text
    `), "false:false:false:false");

    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.match(await psqlErrorAs("authenticated", "select * from public.vibode_furniture_generation_allowances"), /permission denied/i);
    assert.match(await psqlErrorAs("anon", "select * from public.vibode_furniture_generation_allowance_events"), /permission denied/i);
    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations, reserved_generations, consumed_generations
      ) values ('${USER_A}', 'individual_beta', true, 3, 0, 0)
    `), /permission denied/i);
    assert.match(await psqlErrorAs("authenticated", `
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action, delta_authorized, delta_reserved, delta_consumed, reason
      ) values ('${USER_A}', 'administrator', '${ADMIN}', 'grant', 3, 0, 0, 'self grant')
    `), /permission denied/i);

    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations, reserved_generations, consumed_generations, updated_by
      ) values
        ('${USER_A}', 'individual_beta', true, 3, 1, 1, '${ADMIN}'),
        ('${USER_B}', 'furniture_partner', false, 50, 0, 0, '${ADMIN}')
    `);
    assert.match(await psqlError(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations, reserved_generations, consumed_generations
      ) values ('${ADMIN}', 'shared_pool', true, 1, 0, 0)
    `), /vibode_furniture_generation_allowances_classification/);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_allowances
      set authorized_generations = -1 where user_id = '${USER_B}'
    `), /vibode_furniture_generation_allowances_(counts|balance)/);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_allowances
      set reserved_generations = -1 where user_id = '${USER_B}'
    `), /vibode_furniture_generation_allowances_counts/);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_allowances
      set consumed_generations = -1 where user_id = '${USER_B}'
    `), /vibode_furniture_generation_allowances_counts/);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_allowances
      set authorized_generations = 1, reserved_generations = 1, consumed_generations = 1
      where user_id = '${USER_B}'
    `), /vibode_furniture_generation_allowances_balance/);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_allowances
      set authorized_generations = 51 where user_id = '${USER_B}'
    `), /vibode_furniture_generation_allowances_cap/);
    assert.equal(await psql(`
      select classification || ':' || enabled::text || ':' || authorized_generations::text
        || ':' || (authorized_generations - reserved_generations - consumed_generations)::text
      from public.vibode_furniture_generation_allowances
      where user_id = '${USER_A}'
    `), "individual_beta:true:3:1");
    assert.equal(await psql(`
      select classification || ':' || authorized_generations::text
      from public.vibode_furniture_generation_allowances
      where user_id = '${USER_B}'
    `), "furniture_partner:50");

    await psql(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action,
        delta_authorized, delta_reserved, delta_consumed, job_id, reason
      ) values (
        '${USER_A}', 'administrator', '${ADMIN}', 'grant',
        3, 0, 0, null, 'Initial beta allowance'
      )
    `);
    const eventId = await psql(`
      select event_id::text from public.vibode_furniture_generation_allowance_events
      where user_id = '${USER_A}' and action = 'grant'
    `);
    await psql(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action,
        delta_authorized, delta_reserved, delta_consumed, job_id, reason
      ) values (
        '${USER_A}', 'system', null, 'consume',
        0, -1, 1, '${JOB_SAVED}', 'Usable candidate reached ready'
      )
    `);
    assert.match(await psqlError(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action,
        delta_authorized, delta_reserved, delta_consumed, reason
      ) values ('${USER_A}', 'administrator', null, 'grant', 1, 0, 0, 'missing actor')
    `), /vibode_furniture_generation_allowance_events_actor/);
    assert.match(await psqlError(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action,
        delta_authorized, delta_reserved, delta_consumed, job_id, reason
      ) values ('${USER_A}', 'system', '${ADMIN}', 'reserve', 0, 1, 0, '${JOB_NEW}', 'actor on system event')
    `), /vibode_furniture_generation_allowance_events_actor/);
    assert.match(await psqlError(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action,
        delta_authorized, delta_reserved, delta_consumed, reason
      ) values ('${USER_A}', 'system', null, 'reserve', 0, 1, 0, 'system event without a job')
    `), /vibode_furniture_generation_allowance_events_actor/);
    assert.match(await psqlError(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action,
        delta_authorized, delta_reserved, delta_consumed, job_id, reason
      ) values ('${USER_A}', 'system', null, 'consume', 0, 0, -1, '${JOB_SAVED}', 'rewrite used')
    `), /vibode_furniture_generation_allowance_events_deltas/);
    assert.match(await psqlError(`
      update public.vibode_furniture_generation_allowance_events
      set reason = 'changed' where event_id = '${eventId}'
    `), /ALLOWANCE_EVENT_IMMUTABLE/);
    assert.match(await psqlError(`
      delete from public.vibode_furniture_generation_allowance_events where event_id = '${eventId}'
    `), /ALLOWANCE_EVENT_IMMUTABLE/);
    assert.match(await psqlError("truncate public.vibode_furniture_generation_allowance_events"), /ALLOWANCE_EVENT_IMMUTABLE/);
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_generation_allowance_events"), "2");
    assert.equal(await psql(`
      select reason from public.vibode_furniture_generation_allowance_events where event_id = '${eventId}'
    `), "Initial beta allowance");

    assert.match(await psqlError(`
      update public.vibode_furniture_generation_jobs
      set allowance_state = 'spent' where job_id = '${JOB_FAILED}'
    `), /vibode_furniture_generation_jobs_allowance_state/);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set allowance_state = 'reserved' where job_id = '${JOB_FAILED}'
    `);
    assert.equal(await psql(`
      select allowance_state from public.vibode_furniture_generation_jobs where job_id = '${JOB_FAILED}'
    `), "reserved");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set allowance_state = null where job_id = '${JOB_FAILED}'
    `);

    await psql("update public.vibode_furniture_generation_controls set live_enabled = true where control_id = 'global'");
    assert.equal(await psql(`
      select public.reserve_vibode_furniture_generation(
        '${USER_A}', '${JOB_NEW}', 'idem-1d2a-new', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front'], 30
      )->>'status'
    `), "reserved");
    assert.equal(await psql(`
      select coalesce(allowance_state, 'legacy-null')
      from public.vibode_furniture_generation_jobs where job_id = '${JOB_NEW}'
    `), "legacy-null");
    assert.equal(await jobAllowance(JOB_SAVED), `saved:reconciled:30:${assetId(JOB_SAVED)}:legacy-null`);

    await psql(`delete from auth.users where id = '${USER_A}'`);
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowances where user_id = '${USER_A}'
    `), "0");
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_jobs where user_id = '${USER_A}'
    `), "0");
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${USER_A}'
    `), "2");
    assert.equal(await psql("select count(*)::text from public.vibode_furniture_assets"), assetsBefore);
  } finally {
    await removeContainer();
  }
});

function assetId(uuid: string): string {
  return `vibode-furniture/personal/${uuid}`;
}

async function insertLegacyJob(
  jobId: string,
  key: string,
  status: string,
  quota: string,
  consumed: number,
  saved: string | null,
): Promise<void> {
  const savedSql = saved == null ? "null" : `'${saved}'`;
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, quota_state,
      reserved_credits, consumed_credits, saved_asset_id
    ) values (
      '${jobId}', '${USER_A}', 'meshy-7.1', 'image-to-3d', '${key}', '${SHA}',
      '{}'::jsonb, array['front']::text[], 'vibode-${jobId}', '${status}', '${quota}',
      30, ${consumed}, ${savedSql}
    )
  `);
}

async function jobAllowance(jobId: string): Promise<string> {
  return psql(`
    select status || ':' || quota_state || ':' || coalesce(consumed_credits::text, '')
      || ':' || coalesce(saved_asset_id, '') || ':' || coalesce(allowance_state, 'legacy-null')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function controlFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
      || '|' || updated_at::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function controlShape(): Promise<string> {
  const triggers = await psql(`
    select coalesce(string_agg(pg_get_triggerdef(t.oid), E'\\n' order by t.tgname), '')
    from pg_trigger t
    where t.tgrelid = 'public.vibode_furniture_generation_controls'::regclass
      and not t.tgisinternal
  `);
  const indexes = await psql(`
    select coalesce(string_agg(indexdef, E'\\n' order by indexname), '')
    from pg_indexes
    where schemaname = 'public'
      and tablename in (
        'vibode_furniture_generation_controls',
        'vibode_furniture_generation_jobs'
      )
  `);
  return `${triggers}\n${indexes}`;
}

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
