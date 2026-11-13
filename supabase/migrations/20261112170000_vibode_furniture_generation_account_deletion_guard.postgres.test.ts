/**
 * MESHY-1D.4D account deletion and legacy resubmit lockdown on disposable
 * Postgres 16. The chain includes every furniture generation migration
 * through the owner recent read, then this guard. Provider calls are not
 * made, and fetch throws.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d4d-pg";
const DATABASE = "furniture1d4d";
const MIGRATION = "supabase/migrations/20261112170000_vibode_furniture_generation_account_deletion_guard.sql";
const BASELINE = [
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
  "supabase/migrations/20261111210000_vibode_furniture_generation_owner_allowance.sql",
  "supabase/migrations/20261111220000_vibode_furniture_generation_paid_budget_admission.sql",
  "supabase/migrations/20261112160000_vibode_furniture_generation_owner_recent.sql",
];
const U_HOLD = "11111111-1111-4111-8111-111111111111";
const U_RECOVER = "22222222-2222-4222-8222-222222222222";
const U_INCON = "33333333-3333-4333-8333-333333333333";
const U_GHOST = "44444444-4444-4444-8444-444444444444";
const U_PLAIN = "55555555-5555-4555-8555-555555555555";
const U_DONE = "66666666-6666-4666-8666-666666666666";
const U_STILL = "77777777-7777-4777-8777-777777777777";
const U_RACE = "88888888-8888-4888-8888-888888888888";
const U_RACE2 = "99999999-9999-4999-8999-999999999999";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const J_HOLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const J_RECOVER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const J_INCON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const J_GHOST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const J_PLAIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const J_DONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6";
const J_STILL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7";
const J_RACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8";
const J_RACE2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9";
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
const LEGACY = "public.authorize_vibode_furniture_generation_resubmit(uuid,uuid,boolean)";
const GUARDED = "public.admin_authorize_vibode_furniture_generation_resubmit(uuid,boolean)";

test("account deletion keeps an unsettled provider hold and the legacy resubmit path stays closed", { timeout: 240_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /VIBODE_FURNITURE_GENERATION:UNSETTLED_HOLD/);
  assert.match(migration, /before delete on public\.vibode_furniture_generation_jobs/);
  assert.match(migration, /before delete on auth\.users/);
  assert.match(migration, /revoke all on function public\.authorize_vibode_furniture_generation_resubmit\(uuid, uuid, boolean\)/);
  assert.doesNotMatch(migration, /drop function public\.authorize_vibode_furniture_generation_resubmit/i);
  assert.doesNotMatch(migration, /pg_advisory|vibode_furniture_generation_controls/);
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized|set\s+paid_submissions_used/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.deepEqual(legacyCallSites(process.cwd()), []);
  const recoverRoute = readFileSync(
    "app/api/vibode/admin/furniture-generations/[jobId]/recover/route.ts",
    "utf8",
  );
  const commands = readFileSync("lib/vibode-furniture/generation/sql-commands.ts", "utf8");
  assert.match(recoverRoute, /postFurnitureGenerationRecovery/);
  assert.match(commands, /admin_authorize_vibode_furniture_generation_resubmit/);
  assert.equal(legacyCallSitesInText(commands), 0);
  assert.equal(legacyCallSitesInText(recoverRoute), 0);

  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  await removeContainer();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("real_network_blocked");
  };
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role deletion_invoker nologin;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values
        ('${U_HOLD}'), ('${U_RECOVER}'), ('${U_INCON}'), ('${U_GHOST}'), ('${U_PLAIN}'),
        ('${U_DONE}'), ('${U_STILL}'), ('${U_RACE}'), ('${U_RACE2}'), ('${ADMIN}');
      grant usage on schema auth to deletion_invoker;
      grant select, delete on table auth.users to deletion_invoker;
      grant usage on schema public to anon, authenticated, service_role, deletion_invoker;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of BASELINE) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select count(*)::text from pg_proc
      where proname = 'authorize_vibode_furniture_generation_resubmit'
    `), "1");
    assert.equal(await psql(`
      select pg_get_function_identity_arguments(oid)
      from pg_proc where proname = 'authorize_vibode_furniture_generation_resubmit'
    `), "p_user_id uuid, p_job_id uuid, p_duplicate_charge_risk_accepted boolean");
    assert.equal(await psql(`
      select (proacl is not null)::text
        || ':' || has_function_privilege('service_role', '${LEGACY}', 'execute')::text
        || ':' || has_function_privilege('anon', '${LEGACY}', 'execute')::text
        || ':' || has_function_privilege('authenticated', '${LEGACY}', 'execute')::text
        || ':' || coalesce((
          select bool_or(grantee = 0 and privilege_type = 'EXECUTE')
          from aclexplode(proacl)
        ), false)::text
      from pg_proc
      where proname = 'authorize_vibode_furniture_generation_resubmit'
    `), "true:false:false:false:false");
    for (const role of ["service_role", "anon", "authenticated"]) {
      await psql(`
        do $$
        begin
          execute 'set local role ${role}';
          perform public.authorize_vibode_furniture_generation_resubmit(
            '${U_HOLD}', '${J_HOLD}', true
          );
          raise exception 'legacy_was_allowed';
        exception
          when insufficient_privilege then
            null;
        end $$;
      `);
    }
    assert.equal(await psql(`
      select has_function_privilege('service_role', '${GUARDED}', 'execute')::text
        || has_function_privilege('anon', '${GUARDED}', 'execute')::text
        || has_function_privilege('authenticated', '${GUARDED}', 'execute')::text
    `), "truefalsefalse");
    assert.equal(await psql(`
      select prosecdef::text || ':' || provolatile::text
        || ':' || (position('search_path=pg_catalog, public, pg_temp' in proconfig::text) > 0)::text
      from pg_proc
      where proname = 'vibode_furniture_generation_account_has_unsettled_hold'
    `), "true:s:true");
    assert.equal(await psql(`
      select count(*)::text
      from pg_proc
      where proname in (
        'vibode_furniture_generation_jobs_block_unsettled_delete',
        'vibode_furniture_generation_block_unsettled_account_delete'
      )
        and prosecdef
        and position('pg_advisory' in prosrc) = 0
        and position('vibode_furniture_generation_controls' in prosrc) = 0
    `), "2");
    assert.equal(await psql(`
      select count(*)::text from pg_trigger
      where tgname in (
        'vibode_furniture_generation_jobs_block_unsettled_delete',
        'vibode_furniture_generation_jobs_block_unsettled_truncate',
        'vibode_furniture_generation_block_unsettled_account_delete'
      ) and not tgisinternal
    `), "3");
    assert.equal(await psql(`
      select position('submission_not_authorized' in prosrc) > 0
      from pg_proc where proname = 'reserve_vibode_furniture_generation'
    `), "t");
    assert.equal(await psql(`
      select position('credit_unreported' in prosrc) > 0
      from pg_proc where proname = 'admin_authorize_vibode_furniture_generation_resubmit'
    `), "t");
    assert.equal(await psql(`
      select to_regprocedure('public.read_vibode_furniture_generation_owner_recent(uuid)') is not null
    `), "t");
    await expectDenied(`
      do $$
      begin
        execute 'set local role anon';
        perform public.vibode_furniture_generation_account_has_unsettled_hold('${U_HOLD}');
        raise exception 'anon_was_allowed';
      exception
        when insufficient_privilege then
          null;
      end $$;
    `);

    await insertJob({
      userId: U_HOLD,
      jobId: J_HOLD,
      status: "reserved",
      quotaState: "reserved",
      key: "hold-key-01",
    });
    await setCredits(30, 0);
    await insertAllowance(U_HOLD, 1, 1, 0);
    await insertReserveEvent(U_HOLD, J_HOLD);
    await expectUnsettled(`truncate table public.vibode_furniture_generation_jobs cascade`);
    await insertInput(U_HOLD, J_HOLD);
    const reservedFacts = await facts(U_HOLD, J_HOLD);
    assert.match(reservedFacts, /^1\|1\|reserved:reserved/);
    await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
    await expectUnsettled(`delete from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`);
    await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
    assert.equal(await facts(U_HOLD, J_HOLD), reservedFacts);
    await psql(`update public.vibode_furniture_generation_jobs set progress = 17 where job_id = '${J_HOLD}'`);
    assert.equal(await psql(`select progress::text from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`), "17");
    await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
    assert.equal(await controlFingerprint(), "false|1|40|30|0|0|0");

    for (const status of ["submitting", "ambiguous", "running", "ingesting"]) {
      await psql(`update public.vibode_furniture_generation_jobs set status = '${status}' where job_id = '${J_HOLD}'`);
      await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
      assert.equal(await psql(`select status from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`), status);
      assert.equal(await psql(`select credits_reserved::text from public.vibode_furniture_generation_controls`), "30");
    }
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'ready',
        output_bucket = 'vibode-furniture-assets',
        output_object_path = 'users/' || user_id::text || '/generations/' || job_id::text || '/candidate.glb',
        output_expires_at = now() + interval '1 day'
      where job_id = '${J_HOLD}'
    `);
    await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'needs_review',
        output_bucket = null,
        output_object_path = null,
        output_expires_at = null,
        error_class = 'credit_unreported',
        error_code = 'credit_unreported',
        provider_status = 'IN_PROGRESS',
        provider_contacted_at = now()
      where job_id = '${J_HOLD}'
    `);
    await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_HOLD}'`), "1");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_inputs where job_id = '${J_HOLD}'`), "1");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${U_HOLD}'`), "1");
    const denied = await serviceJson(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${J_HOLD}', true)
    `);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "not_claimable");
    assert.equal(await psql(`select status || ':' || coalesce(error_class, '') from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`), "needs_review:credit_unreported");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_resubmit_events`), "0");
    await psql(`alter table auth.users disable trigger vibode_furniture_generation_block_unsettled_account_delete`);
    await expectUnsettled(`delete from auth.users where id = '${U_HOLD}'`);
    await psql(`alter table auth.users enable trigger vibode_furniture_generation_block_unsettled_account_delete`);
    assert.equal(await facts(U_HOLD, J_HOLD).then((value) => value.startsWith("1|1|needs_review:reserved:credit_unreported")), true);
    await expectDenied(`
      do $$
      begin
        execute 'set local role service_role';
        delete from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}';
        raise exception 'service_role_delete_was_allowed';
      exception
        when insufficient_privilege then
          null;
      end $$;
    `);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`), "1");

    await insertJob({
      userId: U_RECOVER,
      jobId: J_RECOVER,
      status: "needs_review",
      quotaState: "reserved",
      key: "recover-key-01",
      errorClass: "ambiguous_timeout",
      errorCode: "ambiguous_timeout",
    });
    await setCredits(60, 0);
    await insertAllowance(U_RECOVER, 1, 1, 0);
    const authorized = await serviceJson(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${J_RECOVER}', true)
    `);
    assert.equal(authorized.ok, true);
    assert.equal(authorized.status, "reserved");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_resubmit_events where job_id = '${J_RECOVER}' and action = 'authorize'`), "1");
    await expectUnsettled(`delete from auth.users where id = '${U_RECOVER}'`);
    await expectImmutable(
      `delete from public.vibode_furniture_generation_resubmit_events where job_id = '${J_RECOVER}'`,
      "RESUBMIT_EVENT_IMMUTABLE",
    );
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_resubmit_events where job_id = '${J_RECOVER}'`), "1");
    assert.equal(await psql(`select credits_reserved::text from public.vibode_furniture_generation_controls`), "60");

    await insertJob({
      userId: U_INCON,
      jobId: J_INCON,
      status: "failed",
      quotaState: "reserved",
      key: "inconsistent-key-01",
      errorClass: "provider_failed",
      errorCode: "provider_failed",
    });
    await setCredits(90, 0);
    await expectUnsettled(`delete from auth.users where id = '${U_INCON}'`);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_INCON}'`), "1");
    await insertJob({
      userId: U_GHOST,
      jobId: J_GHOST,
      status: "failed",
      quotaState: "released",
      key: "ghost-key-01",
      consumedSql: "null",
      contacted: true,
      errorClass: "provider_failed",
      errorCode: "provider_failed",
    });
    assert.equal(await blocked(U_GHOST), "true");
    await expectUnsettled(`delete from auth.users where id = '${U_GHOST}'`);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set consumed_credits = 0
      where job_id = '${J_GHOST}'
    `);
    assert.equal(await blocked(U_GHOST), "false");
    await psql(`
      begin;
      set local role deletion_invoker;
      delete from auth.users where id = '${U_GHOST}';
      commit;
    `);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_GHOST}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_GHOST}'`), "0");
    assert.equal(await psql(`select credits_reserved::text || ':' || credits_consumed::text from public.vibode_furniture_generation_controls`), "90:0");

    await insertJob({
      userId: U_PLAIN,
      jobId: J_PLAIN,
      status: "failed",
      quotaState: "released",
      key: "plain-key-01",
      consumedSql: "0",
      errorClass: "provider_failed",
      errorCode: "provider_failed",
    });
    await psql(`delete from public.vibode_furniture_generation_jobs where job_id = '${J_PLAIN}'`);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`), "1");
    await psql(`delete from auth.users where id = '${U_PLAIN}'`);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_PLAIN}'`), "0");
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_HOLD}'`), "1");

    await markSettled(J_RECOVER, 0, "released");
    await psql(`update public.vibode_furniture_generation_allowances set reserved_generations = 0 where user_id = '${U_RECOVER}'`);
    await psql(`delete from auth.users where id = '${U_RECOVER}'`);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_RECOVER}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_resubmit_events where job_id = '${J_RECOVER}' and action = 'authorize'`), "1");
    await expectImmutable(`delete from public.vibode_furniture_generation_resubmit_events`, "RESUBMIT_EVENT_IMMUTABLE");
    await markSettled(J_HOLD, 0, "released");
    await psql(`update public.vibode_furniture_generation_allowances set reserved_generations = 0 where user_id = '${U_HOLD}'`);
    await markSettled(J_INCON, 0, "released");
    await setCredits(0, 0);
    await psql(`delete from auth.users where id = '${U_HOLD}'`);
    await psql(`delete from auth.users where id = '${U_INCON}'`);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id in ('${J_HOLD}', '${J_INCON}')`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_inputs where job_id = '${J_HOLD}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowances where user_id = '${U_HOLD}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${U_HOLD}'`), "1");
    await expectImmutable(`delete from public.vibode_furniture_generation_allowance_events`, "ALLOWANCE_EVENT_IMMUTABLE");
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true,
        paid_submissions_authorized = 1,
        paid_submissions_used = 0
      where control_id = 'global'
    `);
    await insertAllowance(U_RACE, 1, 0, 0);
    await insertAllowance(U_RACE2, 1, 0, 0);
    const holder = callResult(`
      begin;
      set local role service_role;
      do $$
      declare
        v jsonb;
      begin
        v := ${reserveCall(U_RACE, J_RACE, "race-key-01")};
        if coalesce(v->>'ok', '') <> 'true' then
          raise exception 'reserve_failed:%', v;
        end if;
      end $$;
      select pg_sleep(6), 'deletion-hold-marker';
      commit;
    `);
    try {
    await waitForSql("open reservation", `
      select count(*)::text from pg_stat_activity
      where query like '%deletion-hold-marker%'
        and wait_event = 'PgSleep'
        and pid <> pg_backend_pid()
    `, "1");
    } catch (error) {
      const result = await holder;
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nholder ${result.code}\n${result.stderr}\n${result.stdout}`);
    }
    const racingDelete = callResult(`delete from auth.users where id = '${U_RACE}'`);
    await waitForSql("delete waiting on the open reservation", `
      select count(*)::text from pg_stat_activity
      where query like '%${U_RACE}%'
        and query like 'delete from auth.users%'
        and wait_event_type = 'Lock'
        and pid <> pg_backend_pid()
    `, "1");
    const held = await holder;
    const deletedDuringHold = await racingDelete;
    assert.equal(held.code, 0, `${held.stderr}\n${held.stdout}`);
    assert.notEqual(deletedDuringHold.code, 0);
    assert.match(`${deletedDuringHold.stderr}\n${deletedDuringHold.stdout}`, /UNSETTLED_HOLD/);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_RACE}'`), "1");
    assert.equal(await psql(`select status || ':' || quota_state from public.vibode_furniture_generation_jobs where job_id = '${J_RACE}'`), "reserved:reserved");
    assert.equal(await psql(`select credits_reserved::text from public.vibode_furniture_generation_controls`), "30");
    assert.equal(await psql(`select reserved_generations::text from public.vibode_furniture_generation_allowances where user_id = '${U_RACE}'`), "1");
    await markSettled(J_RACE, 0, "released");
    await psql(`
      update public.vibode_furniture_generation_allowances
      set reserved_generations = 0
      where user_id = '${U_RACE}'
    `);
    await setCredits(0, 0);

    const lockHolder = callResult(`
      begin;
      select pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
      select pg_sleep(6), 'race-lock-marker';
      commit;
    `);
    await waitForSql("generation lock held", `
      select count(*)::text from pg_stat_activity
      where query like '%race-lock-marker%'
        and wait_event = 'PgSleep'
        and pid <> pg_backend_pid()
    `, "1");
    const racingReserve = callResult(`
      begin;
      set local role service_role;
      select ${reserveCall(U_RACE2, J_RACE2, "race-key-02")} where 'race-reserve-marker' <> '';
      commit;
    `);
    await waitForSql("reserve waiting on the generation lock", `
      select count(*)::text from pg_stat_activity
      where query like '%race-reserve-marker%'
        and wait_event_type = 'Lock'
        and pid <> pg_backend_pid()
    `, "1");
    await psql(`delete from auth.users where id = '${U_RACE2}'`);
    const lockResult = await lockHolder;
    const reserveResult = await racingReserve;
    assert.equal(lockResult.code, 0, lockResult.stderr);
    assert.equal(reserveResult.code, 0, `${reserveResult.stderr}\n${reserveResult.stdout}`);
    const reserveBody = JSON.parse(reserveResult.stdout.trim()) as { ok?: boolean; code?: string };
    assert.equal(reserveBody.ok, false);
    assert.equal(reserveBody.code, "allowance_required");
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_RACE2}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_RACE2}'`), "0");
    assert.equal(await psql(`select credits_reserved::text || ':' || credits_consumed::text from public.vibode_furniture_generation_controls`), "0:0");
    await psql(`delete from auth.users where id = '${U_RACE}'`);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${U_RACE}' and action = 'reserve'`), "1");
    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false
      where control_id = 'global'
    `);

    await insertJob({
      userId: U_STILL,
      jobId: J_STILL,
      status: "reserved",
      quotaState: "reserved",
      key: "still-key-01",
    });
    await insertJob({
      userId: U_DONE,
      jobId: J_DONE,
      status: "failed",
      quotaState: "reconciled",
      key: "done-key-01",
      consumedSql: "30",
      contacted: true,
      errorClass: "provider_failed",
      errorCode: "provider_failed",
      allowanceState: "consumed",
    });
    await setCredits(30, 30);
    await insertAllowance(U_DONE, 1, 0, 1);
    await insertAllowance(U_STILL, 1, 1, 0);
    await psql(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, action, delta_authorized, delta_reserved, delta_consumed, job_id, reason
      ) values (
        '${U_DONE}', 'system', 'consume', 0, 0, 1, '${J_DONE}', 'Provider charge retained'
      )
    `);
    assert.equal(await blocked(U_DONE), "false");
    assert.equal(await blocked(U_STILL), "true");
    await psql(`delete from auth.users where id = '${U_DONE}'`);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowances where user_id = '${U_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${U_DONE}'`), "1");
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_STILL}'`), "1");
    assert.equal(await psql(`select quota_state from public.vibode_furniture_generation_jobs where job_id = '${J_STILL}'`), "reserved");
    assert.equal(await controlFingerprint(), "false|1|40|30|30|1|0");
    await expectUnsettled(`delete from auth.users where id = '${U_STILL}'`);
    await expectUnsettled(`delete from auth.users where id = '${U_STILL}'`);
    assert.equal(await controlFingerprint(), "false|1|40|30|30|1|0");
    await markSettled(J_STILL, 0, "released");
    await psql(`update public.vibode_furniture_generation_allowances set reserved_generations = 0 where user_id = '${U_STILL}'`);
    await psql(`update public.vibode_furniture_generation_controls set credits_reserved = 0 where control_id = 'global'`);
    await psql(`delete from auth.users where id = '${U_STILL}'`);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_STILL}'`), "0");
    assert.equal(await controlFingerprint(), "false|1|40|0|30|1|0");
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function insertJob(input: {
  userId: string;
  jobId: string;
  status: string;
  quotaState: string;
  key: string;
  consumedSql?: string;
  contacted?: boolean;
  errorClass?: string | null;
  errorCode?: string | null;
  providerStatus?: string | null;
  allowanceState?: string;
}): Promise<void> {
  const consumed = input.consumedSql ?? "null";
  const contacted = input.contacted ? "now()" : "null";
  const errorClass = input.errorClass ? `'${input.errorClass}'` : "null";
  const errorCode = input.errorCode ? `'${input.errorCode}'` : "null";
  const providerStatus = input.providerStatus ? `'${input.providerStatus}'` : "null";
  const allowanceState = input.allowanceState ?? "reserved";
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, provider_status, status, progress,
      quota_state, reserved_credits, consumed_credits, provider_contacted_at,
      error_class, error_code, allowance_state
    ) values (
      '${input.jobId}', '${input.userId}', 'meshy', 'meshy-7.1', 'image-to-3d',
      '${input.key}', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
      'vibode-${input.jobId}', ${providerStatus}, '${input.status}', 0,
      '${input.quotaState}', 30, ${consumed}, ${contacted},
      ${errorClass}, ${errorCode}, '${allowanceState}'
    )
  `);
}

async function insertAllowance(userId: string, authorized: number, reserved: number, consumed: number): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_allowances (
      user_id, classification, enabled, authorized_generations,
      reserved_generations, consumed_generations, updated_by
    ) values (
      '${userId}', 'individual_beta', true, ${authorized}, ${reserved}, ${consumed}, '${ADMIN}'
    )
  `);
}

async function insertReserveEvent(userId: string, jobId: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_allowance_events (
      user_id, actor_kind, action, delta_authorized, delta_reserved, delta_consumed, job_id, reason
    ) values (
      '${userId}', 'system', 'reserve', 0, 1, 0, '${jobId}', 'Beta generation reserved'
    )
  `);
}

async function insertInput(userId: string, jobId: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_inputs (
      job_id, user_id, slot, ordinal, storage_bucket, storage_object_path,
      sha256, byte_size, mime_type, width_px, height_px, expires_at
    ) values (
      '${jobId}', '${userId}', 'front', 0, 'vibode-furniture-generation-inputs',
      'users/${userId}/inputs/${jobId}/front.jpg',
      '${SHA}', 128, 'image/jpeg', 64, 64, now() + interval '1 day'
    )
  `);
}

async function markSettled(jobId: string, consumedCredits: number, quota: "released" | "reconciled"): Promise<void> {
  const allowance = quota === "reconciled" ? "consumed" : "released";
  await psql(`
    update public.vibode_furniture_generation_jobs
    set status = 'failed',
      quota_state = '${quota}',
      consumed_credits = ${consumedCredits},
      allowance_state = '${allowance}',
      error_class = 'provider_failed',
      error_code = 'provider_failed',
      output_bucket = null,
      output_object_path = null,
      output_expires_at = null
    where job_id = '${jobId}'
  `);
}

async function setCredits(reserved: number, consumed: number): Promise<void> {
  await psql(`
    update public.vibode_furniture_generation_controls
    set credits_reserved = ${reserved}, credits_consumed = ${consumed}
    where control_id = 'global'
  `);
}

function reserveCall(userId: string, jobId: string, key: string): string {
  return `public.reserve_vibode_furniture_generation(
    '${userId}'::uuid,
    '${jobId}'::uuid,
    '${key}',
    '${SHA}',
    'image-to-3d',
    'meshy-7.1',
    '${SETTINGS}'::jsonb,
    array['front']::text[],
    30
  )`;
}

async function blocked(userId: string): Promise<string> {
  return psql(`
    set role service_role;
    select public.vibode_furniture_generation_account_has_unsettled_hold('${userId}') ->> 'blocked';
  `);
}

async function serviceJson(statement: string): Promise<{ ok?: boolean; code?: string; status?: string }> {
  return JSON.parse(await psql(`
    set role service_role;
    ${statement}
  `)) as { ok?: boolean; code?: string; status?: string };
}

async function facts(userId: string, jobId: string): Promise<string> {
  return psql(`
    select coalesce((select count(*)::text from auth.users where id = '${userId}'), '0')
      || '|' || coalesce((select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${jobId}'), '0')
      || '|' || coalesce((
        select status || ':' || quota_state || ':' || coalesce(error_class, '-') || ':' || progress::text
        from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
      ), 'missing')
      || '|' || (
        select credits_reserved::text || ':' || credits_consumed::text
        from public.vibode_furniture_generation_controls where control_id = 'global'
      )
      || '|' || coalesce((
        select authorized_generations::text || ':' || reserved_generations::text || ':' || consumed_generations::text
        from public.vibode_furniture_generation_allowances where user_id = '${userId}'
      ), 'none')
      || '|' || coalesce((select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${userId}'), '0')
      || '|' || coalesce((select count(*)::text from public.vibode_furniture_generation_inputs where job_id = '${jobId}'), '0')
  `);
}

async function controlFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls where control_id = 'global'
  `);
}

async function expectUnsettled(sql: string): Promise<void> {
  const result = await callResult(sql);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, /UNSETTLED_HOLD/);
}

async function expectImmutable(sql: string, token: string): Promise<void> {
  const result = await callResult(sql);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, new RegExp(token));
}

async function expectDenied(sql: string): Promise<void> {
  const result = await callResult(sql);
  assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
}

async function waitForSql(label: string, sql: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await psql(sql) === expected) return;
    await delay(100);
  }
  const visible = await psql(`
    select coalesce(string_agg(state || ':' || coalesce(wait_event_type, '-') || ':' || coalesce(wait_event, '-') || ':' || left(query, 80), ' || '), 'none')
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
  `);
  throw new Error(`timed out waiting for ${label}: ${visible}`);
}

function legacyCallSites(root: string): string[] {
  const allowed = new Set([
    "20261106234500_vibode_furniture_generation.sql",
    "20261106234500_vibode_furniture_generation.postgres.test.ts",
    "20261112170000_vibode_furniture_generation_account_deletion_guard.sql",
    "20261112170000_vibode_furniture_generation_account_deletion_guard.postgres.test.ts",
  ]);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|sql)$/.test(entry)) continue;
      if (legacyCallSitesInText(readFileSync(full, "utf8")) > 0 && !allowed.has(entry)) hits.push(full);
    }
  };
  walk(root);
  return hits;
}

function legacyCallSitesInText(text: string): number {
  const needle = "authorize_vibode_furniture_generation_resubmit";
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    if (text.slice(Math.max(0, at - 6), at) !== "admin_") count += 1;
    from = at + needle.length;
  }
  return count;
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 500)}`);
  return result.stdout.trim();
}

function callResult(sql: string): Promise<CommandResult> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", `POSTGRES_DB=${DATABASE}`, "postgres:16-alpine",
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
