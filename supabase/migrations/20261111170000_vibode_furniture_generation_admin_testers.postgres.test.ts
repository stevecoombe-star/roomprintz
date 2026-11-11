/**
 * MESHY-1D.3B beta tester management on disposable Postgres 16.
 * Mutations use fixture accounts. No provider call and no hosted database.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d3b-pg";
const DATABASE = "furniture1d3b";
const MIGRATION = "supabase/migrations/20261111170000_vibode_furniture_generation_admin_testers.sql";
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
];

const ADMIN = "55555555-5555-4555-8555-555555555555";
const ADA = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const MULTI = "33333333-3333-4333-8333-333333333333";
const LOCKED = "66666666-6666-4666-8666-666666666666";
const DISABLED = "77777777-7777-4777-8777-777777777777";
const EXHAUSTED = "88888888-8888-4888-8888-888888888888";
const DUP_A = "99999999-9999-4999-8999-999999999991";
const DUP_B = "99999999-9999-4999-8999-999999999992";
const STRANGER = "99999999-9999-4999-8999-999999999993";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHA = "ab".repeat(32);

test("administrators approve testers without changing global spending controls", { timeout: 240_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /grant execute on function public.admin_approve_vibode_furniture_generation_tester\(uuid, text, text, integer, boolean, text\) to service_role/);
  assert.match(migration, /grant execute on function public.admin_update_vibode_furniture_generation_tester\(uuid, uuid, text, integer, boolean, timestamptz, text\) to service_role/);
  assert.doesNotMatch(migration, /api\.meshy|MESHY_API_KEY|live_enabled|credit_ceiling|paid_submissions|vibode_furniture_generation_controls/i);
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
        ('${ADMIN}', 'operator@example.com'),
        ('${ADA}', 'ada@example.com'),
        ('${PARTNER}', 'Partner@Example.com'),
        ('${MULTI}', 'multi@example.com'),
        ('${LOCKED}', 'locked@example.com'),
        ('${DISABLED}', 'disabled@example.com'),
        ('${EXHAUSTED}', 'exhausted@example.com'),
        ('${DUP_A}', 'dup@example.com'),
        ('${DUP_B}', 'DUP@example.com');
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
    const beforeMigration = await fingerprint();
    await psql(`
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, public;
    `);
    await psql(migration);
    assert.equal(await fingerprint(), beforeMigration);

    const definitions = await psql(`
      select pg_get_functiondef('public.admin_approve_vibode_furniture_generation_tester(uuid,text,text,integer,boolean,text)'::regprocedure)
        || pg_get_functiondef('public.admin_update_vibode_furniture_generation_tester(uuid,uuid,text,integer,boolean,timestamptz,text)'::regprocedure)
    `);
    assert.match(definitions, /pg_advisory_xact_lock\(hashtext\('vibode-furniture-generation'\)::bigint\)/);
    assert.doesNotMatch(definitions, /vibode_furniture_generation_controls|live_enabled|credit_ceiling|paid_submissions|api\.meshy/i);
    assert.equal(await psql(`
      select string_agg(proname || ':' || prosecdef::text, ',' order by proname)
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in (
          'admin_approve_vibode_furniture_generation_tester',
          'admin_update_vibode_furniture_generation_tester',
          'vibode_furniture_generation_admin_match_account',
          'vibode_furniture_generation_admin_append_event'
        )
    `), [
      "admin_approve_vibode_furniture_generation_tester:true",
      "admin_update_vibode_furniture_generation_tester:true",
      "vibode_furniture_generation_admin_append_event:true",
      "vibode_furniture_generation_admin_match_account:true",
    ].join(","));

    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.equal(await privilege("anon", "admin_approve_vibode_furniture_generation_tester(uuid,text,text,integer,boolean,text)"), "false");
    assert.equal(await privilege("authenticated", "admin_update_vibode_furniture_generation_tester(uuid,uuid,text,integer,boolean,timestamptz,text)"), "false");
    assert.equal(await privilege("public", "admin_approve_vibode_furniture_generation_tester(uuid,text,text,integer,boolean,text)"), "false");
    assert.equal(await privilege("service_role", "admin_approve_vibode_furniture_generation_tester(uuid,text,text,integer,boolean,text)"), "true");
    assert.equal(await privilege("service_role", "admin_update_vibode_furniture_generation_tester(uuid,uuid,text,integer,boolean,timestamptz,text)"), "true");
    assert.equal(await privilege("service_role", "vibode_furniture_generation_admin_match_account(text)"), "false");
    assert.equal(await privilege("service_role", "vibode_furniture_generation_admin_append_event(uuid,uuid,text,integer,text,text,text,boolean,boolean)"), "false");
    assert.equal(await privilege("service_role", "vibode_furniture_generation_admin_tester_record(uuid)"), "false");
    assert.equal(await psql(`
      select has_table_privilege('service_role', 'public.vibode_furniture_generation_allowances', 'insert')::text
        || has_table_privilege('service_role', 'public.vibode_furniture_generation_allowances', 'update')::text
        || has_table_privilege('anon', 'public.vibode_furniture_generation_allowance_events', 'delete')::text
    `), "falsefalsefalse");
    const anonDenied = await psqlErrorAs("anon", `select public.admin_approve_vibode_furniture_generation_tester('${ADMIN}', 'ada@example.com', 'individual_beta', 1, true, 'Nope')`);
    assert.match(anonDenied, /permission denied/i);

    assert.equal(await allowanceCount(ADMIN), "0");
    const approved = await approve(" Ada@Example.com ", "individual_beta", 3, true, "Approved for the beta");
    assert.equal(approved.ok, true);
    assert.equal(approved.idempotent, false);
    assert.equal(nested(approved, "tester").email, "ada@example.com");
    assert.equal(nested(approved, "tester").authorized_generations, 3);
    assert.equal(nested(approved, "tester").reserved_generations, 0);
    assert.equal(nested(approved, "tester").consumed_generations, 0);
    assert.equal(nested(approved, "tester").remaining_generations, 3);
    assert.equal(await allowanceCount(ADMIN), "0");
    const grant = await events(ADA);
    assert.equal(grant.length, 1);
    assert.equal(grant[0]?.action, "grant");
    assert.equal(grant[0]?.actor_user_id, ADMIN);
    assert.equal(grant[0]?.delta_authorized, 3);
    assert.equal(grant[0]?.classification_before, null);
    assert.equal(grant[0]?.classification_after, "individual_beta");
    assert.equal(grant[0]?.enabled_after, true);

    const replay = await approve("ada@example.com", "individual_beta", 3, true, "A repeated approval");
    assert.equal(replay.idempotent, true);
    assert.equal((await events(ADA)).length, 1);
    const conflictingApproval = await approve("ada@example.com", "furniture_partner", 4, true, "Different terms");
    assert.equal(conflictingApproval.ok, false);
    assert.equal(conflictingApproval.code, "already_approved");
    assert.equal((await events(ADA)).length, 1);

    assert.equal((await approve("missing@example.com", "individual_beta", 1, true, "Missing account")).code, "not_found");
    assert.equal((await approve("dup@example.com", "individual_beta", 1, true, "Duplicate email")).code, "ambiguous_account");
    assert.equal(await allowanceCount(DUP_A), "0");
    assert.equal((await approve("ada@example.com", "shared_pool", 1, true, "Bad class")).code, "invalid_classification");
    assert.equal((await approve("multi@example.com", "individual_beta", -1, true, "Negative")).code, "invalid_allowance");
    assert.equal((await approve("multi@example.com", "individual_beta", 51, true, "Too many")).code, "invalid_allowance");
    const fractional = await psqlError(`select public.admin_approve_vibode_furniture_generation_tester('${ADMIN}', 'multi@example.com', 'individual_beta', 1.5, true, 'Fraction')`);
    assert.match(fractional, /function|integer|does not exist/i);
    assert.equal(await allowanceCount(MULTI), "0");
    assert.equal((await approve("ada@example.com", "individual_beta", 1, true, "Wrong actor", STRANGER)).code, "invalid_input");

    const partner = await approve("  PARTNER@example.com ", "furniture_partner", 5, true, "Partner preview");
    assert.equal(nested(partner, "tester").classification, "furniture_partner");
    assert.equal(nested(partner, "tester").email, "partner@example.com");
    const increased = await update(PARTNER, "furniture_partner", 8, true, "Restore two generations");
    assert.equal(increased.ok, true);
    assert.equal(nested(increased, "tester").authorized_generations, 8);
    assert.equal(nested(increased, "tester").reserved_generations, 0);
    assert.equal(nested(increased, "tester").consumed_generations, 0);
    assert.equal((await events(PARTNER)).some((event) => event.action === "restore" && event.delta_authorized === 3), true);
    const decreased = await update(PARTNER, "furniture_partner", 4, true, "Lower unused allowance");
    assert.equal(nested(decreased, "tester").authorized_generations, 4);
    assert.equal((await events(PARTNER)).some((event) => event.action === "adjust" && event.delta_authorized === -4), true);

    await psql(`
      update public.vibode_furniture_generation_allowances
      set reserved_generations = 2, consumed_generations = 1, authorized_generations = 4
      where user_id = '${PARTNER}'
    `);
    const beforeObligation = await events(PARTNER);
    const blocked = await update(PARTNER, "furniture_partner", 2, true, "Below the obligation");
    assert.equal(blocked.code, "allowance_obligation");
    assert.equal((await events(PARTNER)).length, beforeObligation.length);
    assert.equal(await allowanceField(PARTNER, "authorized_generations"), "4");
    assert.equal(await allowanceField(PARTNER, "reserved_generations"), "2");
    assert.equal(await allowanceField(PARTNER, "consumed_generations"), "1");
    const atObligation = await update(PARTNER, "furniture_partner", 3, true, "Match reserved plus consumed");
    assert.equal(atObligation.ok, true);
    assert.equal(await allowanceField(PARTNER, "authorized_generations"), "3");
    assert.equal(await allowanceField(PARTNER, "reserved_generations"), "2");
    assert.equal(await allowanceField(PARTNER, "consumed_generations"), "1");

    const classified = await update(PARTNER, "individual_beta", 3, true, "Classification only");
    assert.equal(nested(classified, "tester").authorized_generations, 3);
    assert.equal(nested(classified, "tester").reserved_generations, 2);
    assert.equal(nested(classified, "tester").consumed_generations, 1);
    const classEvent = (await events(PARTNER)).find((event) => event.action === "classify");
    assert.equal(classEvent?.classification_before, "furniture_partner");
    assert.equal(classEvent?.classification_after, "individual_beta");
    assert.equal(classEvent?.delta_authorized, 0);
    assert.equal(classEvent?.enabled_before, true);
    assert.equal(classEvent?.enabled_after, true);
    const beforeRepeat = (await events(PARTNER)).length;
    const repeatedAt = await allowanceField(PARTNER, "updated_at");
    const repeated = await update(PARTNER, "individual_beta", 3, true, "Same total again");
    assert.equal(repeated.unchanged, true);
    assert.equal((await events(PARTNER)).length, beforeRepeat);
    assert.equal(await allowanceField(PARTNER, "updated_at"), repeatedAt);

    const multi = await approve("multi@example.com", "individual_beta", 2, true, "Combined change subject");
    const combinedBefore = await allowanceField(MULTI, "updated_at");
    const combined = await update(MULTI, "furniture_partner", 4, false, "Classify, restore, and disable");
    assert.equal(combined.unchanged, false);
    const combinedEvents = await events(MULTI);
    assert.deepEqual(combinedEvents.map((event) => event.action), ["grant", "classify", "restore", "disable"]);
    assert.equal(combinedEvents[1]?.classification_before, "individual_beta");
    assert.equal(combinedEvents[1]?.classification_after, "furniture_partner");
    assert.equal(combinedEvents[2]?.delta_authorized, 2);
    assert.equal(combinedEvents[3]?.enabled_before, true);
    assert.equal(combinedEvents[3]?.enabled_after, false);
    assert.notEqual(await allowanceField(MULTI, "updated_at"), combinedBefore);
    assert.equal(nested(multi, "tester").user_id, MULTI);

    const stable = await fingerprint();
    const serviceApproved = await psqlAs("service_role", `
      select public.admin_approve_vibode_furniture_generation_tester(
        '${ADMIN}', 'disabled@example.com', 'individual_beta', 2, true, 'Service role approval'
      )::text
    `);
    assert.equal(JSON.parse(serviceApproved).ok, true);
    const disabled = await update(DISABLED, "individual_beta", 2, false, "Stop new reservations");
    assert.equal(nested(disabled, "tester").enabled, false);
    assert.equal(await fingerprint(), stable);

    await psql(`
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations, reserved_generations, consumed_generations
      ) values ('${EXHAUSTED}', 'individual_beta', false, 1, 0, 1)
    `);
    const reenabled = await update(EXHAUSTED, "individual_beta", 1, true, "Enable without restoring generations");
    assert.equal(reenabled.ok, true);
    assert.equal(await allowanceField(EXHAUSTED, "authorized_generations"), "1");
    assert.equal(await allowanceField(EXHAUSTED, "consumed_generations"), "1");
    assert.equal((await events(EXHAUSTED)).every((event) => event.delta_authorized === 0), true);

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true
      where control_id = 'global'
    `);
    const live = await fingerprint();
    const reserved = await reserve(ADA, JOB, "reserve-ada-one");
    assert.equal(reserved.ok, true);
    assert.equal(await allowanceField(ADA, "reserved_generations"), "1");
    assert.equal(await allowanceField(ADA, "consumed_generations"), "0");
    const held = await fingerprint();
    assert.notEqual(held, live);
    const adaUpdated = await allowanceField(ADA, "updated_at");
    const stopped = await update(ADA, "individual_beta", 3, false, "Disable during an open reservation");
    assert.equal(stopped.ok, true);
    assert.equal(await allowanceField(ADA, "reserved_generations"), "1");
    assert.equal(await allowanceField(ADA, "consumed_generations"), "0");
    assert.equal(await allowanceField(ADA, "authorized_generations"), "3");
    assert.equal(await psql(`select status || '|' || allowance_state from public.vibode_furniture_generation_jobs where job_id = '${JOB}'`), "reserved|reserved");
    assert.equal(await fingerprint(), held);
    assert.notEqual(await allowanceField(ADA, "updated_at"), adaUpdated);
    const blockedReserve = await reserve(DISABLED, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "reserve-disabled");
    assert.equal(blockedReserve.code, "allowance_disabled");
    const exhaustedReserve = await reserve(EXHAUSTED, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "reserve-exhausted");
    assert.equal(exhaustedReserve.code, "allowance_exhausted");
    assert.equal(await allowanceField(EXHAUSTED, "authorized_generations"), "1");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where user_id in ('${DISABLED}', '${EXHAUSTED}')`), "0");

    const staleAt = await allowanceField(PARTNER, "updated_at");
    const moved = await update(PARTNER, "individual_beta", 4, true, "Concurrent writer wins");
    assert.equal(moved.ok, true);
    const loser = await readJson(`
      select public.admin_update_vibode_furniture_generation_tester(
        '${ADMIN}', '${PARTNER}', 'individual_beta', 5, true, '${staleAt}'::timestamptz, 'Stale form'
      )
    `);
    assert.equal(loser.code, "conflict");
    assert.equal(await allowanceField(PARTNER, "authorized_generations"), "4");

    const lockedApproved = await approve("locked@example.com", "individual_beta", 2, true, "Lock subject");
    assert.equal(lockedApproved.ok, true);
    const lock = holdGenerationLock();
    await lock.ready;
    const waited = await psqlError(`
      set lock_timeout = '400ms';
      select public.admin_update_vibode_furniture_generation_tester(
        '${ADMIN}', '${LOCKED}', 'individual_beta', 3, true,
        (select updated_at from public.vibode_furniture_generation_allowances where user_id = '${LOCKED}'),
        'Wait for the generation lock'
      );
    `);
    assert.match(waited, /lock timeout|canceling statement/i);
    assert.equal(await allowanceField(LOCKED, "authorized_generations"), "2");
    await lock.done;
    const afterLock = await update(LOCKED, "individual_beta", 3, true, "Saved after the lock");
    assert.equal(afterLock.ok, true);
    assert.equal(await allowanceField(LOCKED, "authorized_generations"), "3");

    await psql(`
      create function public.fail_admin_audit() returns trigger language plpgsql as $$
      begin
        if new.reason = 'rollback-probe' then
          raise exception 'AUDIT_FORCED_FAILURE';
        end if;
        return new;
      end $$;
      create trigger fail_admin_audit
      before insert on public.vibode_furniture_generation_allowance_events
      for each row execute function public.fail_admin_audit();
    `);
    const beforeRollback = await allowanceField(LOCKED, "authorized_generations");
    const rollback = await psqlError(`
      select public.admin_update_vibode_furniture_generation_tester(
        '${ADMIN}', '${LOCKED}', 'individual_beta', 4, true,
        (select updated_at from public.vibode_furniture_generation_allowances where user_id = '${LOCKED}'),
        'rollback-probe'
      )
    `);
    assert.match(rollback, /AUDIT_FORCED_FAILURE/);
    assert.equal(await allowanceField(LOCKED, "authorized_generations"), beforeRollback);
    await psql(`
      drop trigger fail_admin_audit on public.vibode_furniture_generation_allowance_events;
      drop function public.fail_admin_audit();
    `);

    const immutable = await psqlError(`
      update public.vibode_furniture_generation_allowance_events
      set classification_after = 'individual_beta'
      where user_id = '${ADA}' and action = 'grant'
    `);
    assert.match(immutable, /ALLOWANCE_EVENT_IMMUTABLE/);
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowance_events
      where actor_kind = 'administrator' and (delta_reserved <> 0 or delta_consumed <> 0)
    `), "0");
    const readBack = await readJson(`select public.vibode_furniture_generation_admin_allowance_events('${PARTNER}', null)`);
    const classify = records(readBack).find((event) => event.action === "classify");
    assert.equal(classify?.classification_before, "furniture_partner");
    assert.equal(classify?.classification_after, "individual_beta");
    const explicitAdmin = await approve("operator@example.com", "individual_beta", 1, false, "Explicit operator approval");
    assert.equal(explicitAdmin.ok, true);
    assert.equal(await allowanceCount(ADMIN), "1");
    assert.equal(fetches.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function approve(
  email: string,
  classification: string,
  allowance: number,
  enabled: boolean,
  reason: string,
  actor = ADMIN,
): Promise<JsonRecord> {
  return readJson(`
    select public.admin_approve_vibode_furniture_generation_tester(
      '${actor}', ${quote(email)}, ${quote(classification)}, ${allowance}, ${enabled}, ${quote(reason)}
    )
  `);
}

async function update(
  userId: string,
  classification: string,
  allowance: number,
  enabled: boolean,
  reason: string,
): Promise<JsonRecord> {
  return readJson(`
    select public.admin_update_vibode_furniture_generation_tester(
      '${ADMIN}', '${userId}', ${quote(classification)}, ${allowance}, ${enabled},
      (select updated_at from public.vibode_furniture_generation_allowances where user_id = '${userId}'),
      ${quote(reason)}
    )
  `);
}

async function reserve(userId: string, jobId: string, key: string): Promise<JsonRecord> {
  return readJson(`
    select public.reserve_vibode_furniture_generation(
      '${userId}', '${jobId}', ${quote(key)}, ${quote(SHA)}, 'image-to-3d', 'meshy-7.1',
      jsonb_build_object(
        'geometryResolution', 'standard',
        'shouldTexture', true,
        'textureModel', 'default',
        'textureResolution', '2k',
        'enablePbr', false,
        'texturePrompt', '',
        'imageEnhancement', true,
        'shouldRemesh', false,
        'topology', 'triangle',
        'targetPolycount', 30000
      ),
      array['front']::text[],
      30
    )
  `);
}

async function events(userId: string): Promise<JsonRecord[]> {
  const raw = await psql(`
    select coalesce(jsonb_agg(jsonb_build_object(
      'action', action,
      'actor_user_id', actor_user_id,
      'delta_authorized', delta_authorized,
      'delta_reserved', delta_reserved,
      'delta_consumed', delta_consumed,
      'classification_before', classification_before,
      'classification_after', classification_after,
      'enabled_before', enabled_before,
      'enabled_after', enabled_after
    ) order by created_at, event_id), '[]'::jsonb)::text
    from public.vibode_furniture_generation_allowance_events
    where user_id = '${userId}'
  `);
  return records(JSON.parse(raw));
}

async function allowanceCount(userId: string): Promise<string> {
  return psql(`select count(*)::text from public.vibode_furniture_generation_allowances where user_id = '${userId}'`);
}

async function allowanceField(userId: string, field: string): Promise<string> {
  return psql(`select ${field}::text from public.vibode_furniture_generation_allowances where user_id = '${userId}'`);
}

async function privilege(role: string, signature: string): Promise<string> {
  return psql(`select has_function_privilege('${role}', 'public.${signature}', 'execute')::text`);
}

async function fingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
      || '|' || updated_at::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

function holdGenerationLock(): { ready: Promise<void>; done: Promise<void> } {
  const child = spawn("docker", [
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`generation lock was not acquired\n${stdout}\n${stderr}`)), 10_000);
    const poll = setInterval(() => {
      if (stdout.includes("locked")) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 40);
  });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`lock session failed\n${stderr}\n${stdout}`));
    });
  });
  child.stdin.end(`
    select pg_advisory_lock(hashtext('vibode-furniture-generation')::bigint);
    select 'locked';
    select pg_sleep(5);
    select pg_advisory_unlock(hashtext('vibode-furniture-generation')::bigint);
  `);
  return { ready, done };
}

async function readJson(sqlText: string): Promise<JsonRecord> {
  return JSON.parse(await psql(sqlText)) as JsonRecord;
}

function nested(record: JsonRecord, key: string): JsonRecord {
  const value = record[key];
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value as JsonRecord[];
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type JsonRecord = Record<string, unknown>;

async function psql(sqlText: string): Promise<string> {
  const result = await callResult("postgres", sqlText);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sqlText.slice(0, 500)}`);
  return result.stdout.trim();
}

async function psqlAs(user: string, sqlText: string): Promise<string> {
  const result = await callResult(user, sqlText);
  if (result.code !== 0) throw new Error(`psql ${user} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlError(sqlText: string): Promise<string> {
  return psqlErrorAs("postgres", sqlText);
}

async function psqlErrorAs(user: string, sqlText: string): Promise<string> {
  const result = await callResult(user, sqlText);
  return `${result.stderr}\n${result.stdout}`;
}

function callResult(user: string, sqlText: string): Promise<CommandResult> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sqlText);
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
