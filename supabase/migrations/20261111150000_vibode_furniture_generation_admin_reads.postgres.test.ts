/**
 * MESHY-1D.3A read-only admin dashboard on disposable Postgres 16.
 * Reads use fixture rows. No provider call and no hosted database.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-furniture-1d3a-pg";
const DATABASE = "furniture1d3a";
const MIGRATION = "supabase/migrations/20261111150000_vibode_furniture_generation_admin_reads.sql";
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
];

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const GONE = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SAVED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const UNRESOLVED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const PAG1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const PAG2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const PAG3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const LEGACY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const GONE_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
const ASSET = "99999999-9999-4999-8999-999999999999";
const SHA = "ab".repeat(32);
const TASKS = {
  saved: "018a210d-8ba4-705c-b111-1f1776f7f5d1",
  ready: "018a210d-8ba4-705c-b111-1f1776f7f5d2",
  pag3: "018a210d-8ba4-705c-b111-1f1776f7f5d3",
  legacy: "018a210d-8ba4-705c-b111-1f1776f7f5d4",
  unresolved: "018a210d-8ba4-705c-b111-1f1776f7f5d5",
  gone: "018a210d-8ba4-705c-b111-1f1776f7f5d6",
  resolution: "018a210d-8ba4-705c-b111-1f1776f7f5d7",
};

const OVERVIEW_KEYS = [
  "approved_accounts",
  "confirmed_provider_tasks",
  "consumed_generations",
  "credit_ceiling",
  "credits_consumed",
  "credits_reserved",
  "deleted_account_audit_events",
  "deleted_account_audits",
  "enabled_accounts",
  "historical_jobs",
  "historical_jobs_without_allowance",
  "live_enabled",
  "max_concurrent",
  "ok",
  "paid_submissions_authorized",
  "paid_submissions_used",
  "permanently_saved_models",
  "provider_failures",
  "remaining_credit_budget",
  "remaining_generations",
  "reserved_generations",
  "authorized_generations",
  "unresolved_provider_credit_exposure",
  "usable_candidates",
].sort();

const JOB_KEYS = [
  "ai_model",
  "allowance_state",
  "consumed_credits",
  "created_at",
  "error_class",
  "image_slots",
  "job_id",
  "operation",
  "profile",
  "provider_credit_review",
  "provider_status",
  "provider_task_confirmed",
  "quota_state",
  "reserved_credits",
  "saved_asset_status",
  "status",
  "unresolved",
  "user_id",
].sort();

const PROFILE_KEYS = [
  "ai_model",
  "enable_pbr",
  "geometry_resolution",
  "image_enhancement",
  "operation",
  "should_remesh",
  "should_texture",
  "target_polycount",
  "texture_model",
  "texture_resolution",
  "topology",
].sort();

test("admin reads report usage without mutating controls or leaking provider data", { timeout: 240_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /grant execute on function public.read_vibode_furniture_generation_admin_overview\(\) to service_role/);
  assert.doesNotMatch(migration, /to anon|to authenticated|to public/);
  assert.doesNotMatch(migration, /\b(insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY|set\s+live_enabled|set\s+credit_ceiling|set\s+paid_submissions/i);
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
        ('${USER_B}', 'partner@example.com'),
        ('${USER_C}', 'legacy@example.com'),
        ('${GONE}', 'gone@example.com'),
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
    for (const file of BASELINE) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    const beforeMigration = await fingerprint();
    await psql(`
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, public;
    `);
    await psql(migration);
    assert.equal(await fingerprint(), beforeMigration);
    assert.equal(await psql(`
      select count(*) filter (where prosecdef)::text || ':' ||
        count(*) filter (where exists (
          select 1 from unnest(proconfig) as cfg
          where cfg like 'search_path=%pg_catalog%'
            and cfg like '%public%'
            and cfg like '%pg_temp%'
        ))::text || ':' || count(*)::text
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and (
          proname like 'read_vibode_furniture_generation_admin_%'
          or proname like 'vibode_furniture_generation_admin_%'
        )
    `), "10:10:10");
    const definitions = await psql(`
      select coalesce(string_agg(pg_get_functiondef(p.oid), E'\\n'), '')
      from pg_proc as p
      where p.pronamespace = 'public'::regnamespace
        and (
          p.proname like 'read_vibode_furniture_generation_admin_%'
          or p.proname like 'vibode_furniture_generation_admin_%'
        )
    `);
    assert.doesNotMatch(definitions, /\b(insert|update|delete|truncate)\b/i);

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false,
        credits_reserved = 30,
        credits_consumed = 20,
        paid_submissions_authorized = 1,
        paid_submissions_used = 1
      where control_id = 'global';
      insert into public.vibode_furniture_generation_allowances (
        user_id, classification, enabled, authorized_generations,
        reserved_generations, consumed_generations, updated_by, updated_at
      ) values
        ('${USER_A}', 'individual_beta', true, 5, 1, 2, '${ADMIN}', '2026-11-05T00:00:00Z'),
        ('${USER_B}', 'furniture_partner', false, 10, 0, 4, '${ADMIN}', '2026-11-03T00:00:00Z'),
        ('${GONE}', 'individual_beta', true, 1, 0, 0, '${ADMIN}', '2026-11-06T00:00:00Z');
    `);
    await psql([
      jobSql({
        jobId: SAVED, userId: USER_A, key: "saved-job-key", status: "saved", createdAt: "2026-11-05T00:00:00Z",
        allowance: null, quota: "reconciled", consumed: 30, providerStatus: "SUCCEEDED", taskId: TASKS.saved,
        contacted: true, errorClass: null, errorCode: "users/hidden/candidate.glb", savedAsset: true, output: true,
      }),
      jobSql({
        jobId: READY, userId: USER_A, key: "ready-job-key", status: "ready", createdAt: "2026-11-06T00:00:00Z",
        allowance: null, quota: "reconciled", consumed: 30, providerStatus: "SUCCEEDED", taskId: TASKS.ready,
        contacted: true, errorClass: null, errorCode: "MESHY_API_KEY", savedAsset: false, output: true,
      }),
      jobSql({
        jobId: PAG1, userId: USER_A, key: "page-job-one", status: "failed", createdAt: "2026-11-01T00:00:00Z",
        allowance: "released", quota: "released", consumed: null, providerStatus: null, taskId: null,
        contacted: false, errorClass: "invalid_output", errorCode: null, savedAsset: false, output: false,
      }),
      jobSql({
        jobId: PAG2, userId: USER_A, key: "page-job-two", status: "failed", createdAt: "2026-11-02T00:00:00Z",
        allowance: "released", quota: "released", consumed: 0, providerStatus: null, taskId: null,
        contacted: false, errorClass: "invalid_output", errorCode: null, savedAsset: false, output: false,
      }),
      jobSql({
        jobId: PAG3, userId: USER_A, key: "page-job-three", status: "failed", createdAt: "2026-11-03T00:00:00Z",
        allowance: "released", quota: "reconciled", consumed: 15, providerStatus: "SUCCEEDED", taskId: TASKS.pag3,
        contacted: true, errorClass: null, errorCode: null, savedAsset: false, output: false,
      }),
      jobSql({
        jobId: LEGACY, userId: USER_C, key: "legacy-job-key", status: "failed", createdAt: "2026-11-04T00:00:00Z",
        allowance: null, quota: "reconciled", consumed: 20, providerStatus: "FAILED", taskId: TASKS.legacy,
        contacted: true, errorClass: "provider_failed", errorCode: "users/hidden/candidate.glb", savedAsset: false, output: false,
      }),
    ].join("\n"));

    const phaseOne = await overview();
    assert.equal(phaseOne.approved_accounts, 3);
    assert.equal(phaseOne.enabled_accounts, 2);
    assert.equal(phaseOne.usable_candidates, 1);
    assert.equal(phaseOne.permanently_saved_models, 1);
    assert.equal(phaseOne.unresolved_provider_credit_exposure, 0);
    assert.equal(phaseOne.credits_reserved, 30);
    assert.equal(phaseOne.historical_jobs_without_allowance, 3);
    assert.equal(phaseOne.live_enabled, false);
    const phaseOneJobs = new Map(records(phaseOne.historical_jobs).map((job) => [job.job_id, job]));
    assert.equal(phaseOneJobs.get(READY)?.saved_asset_status, "candidate_ready");
    assert.equal(phaseOneJobs.get(SAVED)?.saved_asset_status, "permanently_saved");
    assert.equal(phaseOneJobs.get(SAVED)?.allowance_state, null);
    assert.equal(nested(phaseOneJobs.get(SAVED), "profile").texture_model, "meshy-7");
    assert.equal(phaseOneJobs.get(SAVED)?.ai_model, "meshy-7.1");
    assertNoSecrets(JSON.stringify(phaseOne));

    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'discarded', allowance_state = 'released'
      where job_id = '${READY}';
    `);
    await psql(jobSql({
      jobId: UNRESOLVED, userId: USER_A, key: "unresolved-job", status: "needs_review", createdAt: "2026-11-07T00:00:00Z",
      allowance: "reserved", quota: "reserved", consumed: null, providerStatus: "SUCCEEDED", taskId: TASKS.unresolved,
      contacted: true, errorClass: "credit_unreported", errorCode: "users/hidden/candidate.glb", savedAsset: false, output: false,
    }));
    await psql(jobSql({
      jobId: GONE_JOB, userId: GONE, key: "gone-job-key", status: "failed", createdAt: "2026-11-02T00:00:00Z",
      allowance: null, quota: "released", consumed: 12, providerStatus: "FAILED", taskId: TASKS.gone,
      contacted: true, errorClass: "provider_failed", errorCode: null, savedAsset: false, output: false,
    }));
    await psql(`
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, actor_user_id, action, delta_authorized, delta_reserved, delta_consumed, job_id, reason, created_at
      ) values
        ('${USER_A}', 'administrator', '${ADMIN}', 'grant', 5, 0, 0, null, 'Initial beta allowance', '2026-11-01T00:00:00Z'),
        ('${USER_A}', 'system', null, 'reserve', 0, 1, 0, '${UNRESOLVED}', 'reserved the beta generation', '2026-11-07T00:00:01Z'),
        ('${GONE}', 'administrator', '${ADMIN}', 'grant', 1, 0, 0, null, 'Initial beta allowance', '2026-11-01T00:00:00Z'),
        ('${GONE}', 'system', null, 'release', 0, 0, 0, '${GONE_JOB}', 'released the beta generation', '2026-11-02T00:00:01Z');
      insert into public.vibode_furniture_generation_resubmit_events (
        job_id, user_id, action, reason, created_at
      ) values
        ('${UNRESOLVED}', '${USER_A}', 'authorize', 'operator_recovery', '2026-11-07T00:00:01Z'),
        ('${UNRESOLVED}', '${USER_A}', 'revoke', 'submission_budget_exhausted', '2026-11-07T00:00:02Z'),
        ('${UNRESOLVED}', '${USER_A}', 'consume', 'submission_committed', '2026-11-07T00:00:03Z'),
        ('${GONE_JOB}', '${GONE}', 'authorize', 'operator_recovery', '2026-11-02T00:00:02Z');
      insert into public.vibode_furniture_generation_credit_resolutions (
        job_id, user_id, actor_user_id, provider_task_id, provider_status, consumed_credits, reason, evidence_ref, created_at
      ) values
        ('${PAG3}', '${USER_A}', '${ADMIN}', '${TASKS.pag3}', 'SUCCEEDED', 15, 'operator recorded provider invoice', 'users/hidden/evidence.bin', '2026-11-03T00:00:02Z'),
        ('${GONE_JOB}', '${GONE}', '${ADMIN}', '${TASKS.resolution}', 'FAILED', 12, 'operator recorded provider invoice', 'users/hidden/evidence.bin', '2026-11-02T00:00:03Z');
      delete from auth.users where id = '${GONE}';
    `);

    const settled = await fingerprint();
    const ledger = await ledgerCounts();
    const body = await overview();
    assert.deepEqual(Object.keys(body).sort(), OVERVIEW_KEYS);
    assert.equal(body.ok, true);
    assert.equal(body.approved_accounts, 2);
    assert.equal(body.enabled_accounts, 1);
    assert.equal(body.authorized_generations, 15);
    assert.equal(body.reserved_generations, 1);
    assert.equal(body.consumed_generations, 6);
    assert.equal(body.remaining_generations, 8);
    assert.equal(body.paid_submissions_authorized, 1);
    assert.equal(body.paid_submissions_used, 1);
    assert.equal(body.confirmed_provider_tasks, 5);
    assert.equal(body.usable_candidates, 0);
    assert.equal(body.permanently_saved_models, 1);
    assert.equal(body.provider_failures, 1);
    assert.equal(body.credits_reserved, 30);
    assert.equal(body.credits_consumed, 20);
    assert.equal(body.credit_ceiling, 40);
    assert.equal(body.remaining_credit_budget, -10);
    assert.equal(body.unresolved_provider_credit_exposure, 30);
    assert.equal(body.live_enabled, false);
    assert.equal(body.max_concurrent, 1);
    assert.equal(body.historical_jobs_without_allowance, 2);
    assert.equal(body.deleted_account_audit_events, 4);
    assert.equal(records(body.deleted_account_audits).length, 1);
    assert.equal(records(body.deleted_account_audits)[0]?.user_id, GONE);
    assert.equal(records(body.deleted_account_audits)[0]?.allowance_events, 2);
    assert.equal(records(body.deleted_account_audits)[0]?.resubmit_events, 1);
    assert.equal(records(body.deleted_account_audits)[0]?.credit_resolutions, 1);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where status = 'failed'`), "4");
    assert.equal(await psql(`select coalesce(sum(consumed_credits), 0)::text from public.vibode_furniture_generation_jobs`), "95");
    assert.equal(await psql(`select coalesce(sum(reserved_credits), 0)::text from public.vibode_furniture_generation_jobs`), "210");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowances`), "2");
    assert.notEqual(body.credits_consumed, body.consumed_generations);
    assert.notEqual(body.confirmed_provider_tasks, body.paid_submissions_used);
    assert.notEqual(body.usable_candidates, body.permanently_saved_models);
    const historical = records(body.historical_jobs);
    assert.deepEqual(historical.map((job) => job.job_id), [SAVED, LEGACY]);
    assert.equal(historical[0]?.allowance_state, null);
    assert.equal(nested(historical[0], "profile").geometry_resolution, "standard");
    assert.deepEqual(Object.keys(historical[0] ?? {}).sort(), JOB_KEYS);
    assert.deepEqual(Object.keys(nested(historical[0], "profile")).sort(), PROFILE_KEYS);
    assert.equal(JSON.stringify(body).includes("Worker"), false);
    assert.equal(JSON.stringify(body).includes("Railway"), false);

    const testers = await readJson(`select public.read_vibode_furniture_generation_admin_testers('', 25, 0)`);
    assert.equal(testers.total, 2);
    assert.deepEqual(records(testers.testers).map((tester) => tester.user_id), [USER_A, USER_B]);
    assert.equal(records(testers.testers)[0]?.email, "ada@example.com");
    assert.equal(records(testers.testers)[0]?.classification, "individual_beta");
    assert.equal(records(testers.testers)[0]?.enabled, true);
    assert.equal(records(testers.testers)[0]?.remaining_generations, 2);
    assert.equal(records(testers.testers)[1]?.email, "partner@example.com");
    assert.equal(records(testers.testers)[1]?.classification, "furniture_partner");
    assert.equal(records(testers.testers)[1]?.enabled, false);
    assert.equal(records(testers.testers)[1]?.remaining_generations, 6);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers('ada@', 25, 0)`)).total, 1);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers('legacy@', 25, 0)`)).total, 0);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers('partner', 25, 0)`)).total, 1);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers('${USER_A}', 25, 0)`)).total, 1);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers($q$'%' or 1=1 --$q$, 25, 0)`)).total, 0);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers('%', 25, 0)`)).total, 0);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_testers(repeat('a', 201), 25, 0)`)).code, "invalid");
    const wide = await readJson(`select public.read_vibode_furniture_generation_admin_testers('', 1000, 1)`);
    assert.equal(wide.limit, 50);
    assert.equal(wide.offset, 1);
    assert.equal(wide.total, 2);
    assert.equal(records(wide.testers)[0]?.user_id, USER_B);
    assert.equal(JSON.stringify(testers).includes(USER_C), false);
    assert.equal(JSON.stringify(testers).includes(GONE), false);

    const firstPage = await jobs(USER_A, 2, 0);
    const secondPage = await jobs(USER_A, 2, 2);
    const thirdPage = await jobs(USER_A, 2, 4);
    const emptyPage = await jobs(USER_A, 2, 6);
    const clamped = await jobs(USER_A, 1000, 0);
    assert.deepEqual(ids(firstPage), [UNRESOLVED, READY]);
    assert.deepEqual(ids(secondPage), [SAVED, PAG3]);
    assert.deepEqual(ids(thirdPage), [PAG2, PAG1]);
    assert.deepEqual(ids(emptyPage), []);
    assert.equal(firstPage.total, 6);
    assert.equal(emptyPage.total, 6);
    assert.equal(clamped.limit, 50);
    assert.equal(records(firstPage.jobs)[0]?.provider_credit_review, "unreported");
    assert.equal(records(firstPage.jobs)[0]?.unresolved, true);
    assert.equal(records(firstPage.jobs)[0]?.allowance_state, "reserved");
    assert.equal(records(firstPage.jobs)[1]?.provider_credit_review, "reported");
    assert.equal(records(firstPage.jobs)[1]?.saved_asset_status, "not_saved");
    assert.equal(records(secondPage.jobs)[0]?.saved_asset_status, "permanently_saved");
    assert.equal(records(secondPage.jobs)[1]?.provider_credit_review, "operator_resolved");
    assert.equal(records(thirdPage.jobs)[0]?.provider_credit_review, "reported");
    assert.equal(records(thirdPage.jobs)[0]?.consumed_credits, 0);
    assert.equal(records(thirdPage.jobs)[1]?.provider_credit_review, "not_contacted");
    assert.deepEqual(records(firstPage.resubmit_events).map((event) => `${event.action}:${event.reason}`), [
      "consume:submission_committed",
      "revoke:submission_budget_exhausted",
      "authorize:operator_recovery",
    ]);

    const legacy = await jobs(USER_C, 20, 0);
    assert.equal(legacy.approved, false);
    assert.equal(legacy.email, "legacy@example.com");
    assert.equal(legacy.total, 1);
    assert.equal(records(legacy.jobs)[0]?.allowance_state, null);
    assert.equal(records(legacy.jobs)[0]?.error_class, "provider_failed");
    const removed = await jobs(GONE, 20, 0);
    assert.equal(removed.approved, false);
    assert.equal(removed.email, null);
    assert.equal(removed.total, 0);
    assert.deepEqual(removed.jobs, []);
    assert.equal(records(removed.allowance_events).length, 2);
    assert.equal(records(removed.resubmit_events).length, 1);
    assert.equal(records(removed.credit_resolutions).length, 1);
    assert.equal(records(removed.credit_resolutions)[0]?.evidence_ref, undefined);
    assert.equal(records(removed.credit_resolutions)[0]?.provider_task_id, undefined);

    const unresolved = await job(UNRESOLVED);
    const unresolvedJob = nested(unresolved, "job");
    assert.equal(unresolvedJob.status, "needs_review");
    assert.equal(unresolvedJob.provider_credit_review, "unreported");
    assert.equal(unresolved.credit_resolution, null);
    assert.deepEqual(records(unresolved.resubmit_events).map((event) => event.reason), [
      "submission_committed",
      "submission_budget_exhausted",
      "operator_recovery",
    ]);
    const resolved = await job(PAG3);
    const resolution = nested(resolved, "credit_resolution");
    assert.equal(resolution.provider_status, "SUCCEEDED");
    assert.equal(resolution.consumed_credits, 15);
    assert.equal(resolution.reason, "operator recorded provider invoice");
    assert.equal(resolution.evidence_ref, undefined);
    assert.equal(nested(resolved, "job").provider_credit_review, "operator_resolved");
    const retained = await job(GONE_JOB);
    assert.equal(retained.ok, true);
    assert.equal(retained.job, null);
    assert.equal(records(retained.allowance_events).length, 1);
    assert.equal(records(retained.resubmit_events)[0]?.reason, "operator_recovery");
    assert.equal(nested(retained, "credit_resolution").consumed_credits, 12);
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_job('${"99999999-9999-4999-8999-999999999991"}')`)).code, "not_found");
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_job(null)`)).code, "invalid");
    assert.equal((await readJson(`select public.read_vibode_furniture_generation_admin_jobs(null, 10, 0)`)).code, "invalid");

    const payloads = [body, testers, firstPage, secondPage, thirdPage, legacy, removed, unresolved, resolved, retained];
    for (const payload of payloads) assertNoSecrets(JSON.stringify(payload));
    assert.match(JSON.stringify(firstPage), /meshy-7\.1/);
    assert.match(JSON.stringify(body), /"texture_model":"meshy-7"/);

    assert.equal(await fingerprint(), settled);
    assert.equal(await ledgerCounts(), ledger);
    assert.equal(body.live_enabled, false);
    assert.equal(fetches.count, 0);

    const privileges = await psql(`
      select proname || ':' ||
        has_function_privilege('anon', oid, 'execute')::text || ':' ||
        has_function_privilege('authenticated', oid, 'execute')::text || ':' ||
        has_function_privilege('public', oid, 'execute')::text || ':' ||
        has_function_privilege('service_role', oid, 'execute')::text
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and (
          proname like 'read_vibode_furniture_generation_admin_%'
          or proname like 'vibode_furniture_generation_admin_%'
        )
      order by proname
    `);
    for (const line of privileges.split("\n")) {
      const [name, anon, authenticated, pub, service] = line.split(":");
      assert.equal(anon, "false", name);
      assert.equal(authenticated, "false", name);
      assert.equal(pub, "false", name);
      assert.equal(service, name?.startsWith("read_") ? "true" : "false", name);
    }
    assert.equal(await psql(`
      select bool_or(has_table_privilege(role_name, table_name, privilege_name))::text
      from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
      cross join (values
        ('public.vibode_furniture_generation_jobs'),
        ('public.vibode_furniture_generation_controls'),
        ('public.vibode_furniture_generation_allowances'),
        ('public.vibode_furniture_generation_allowance_events'),
        ('public.vibode_furniture_generation_inputs'),
        ('public.vibode_furniture_generation_credit_resolutions'),
        ('public.vibode_furniture_generation_resubmit_events')
      ) as tables(table_name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege_name)
    `), "false");
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.match(await psqlErrorAs("anon", "select * from public.vibode_furniture_generation_jobs"), /permission denied/i);
    assert.match(await psqlErrorAs("authenticated", "select * from public.vibode_furniture_generation_allowances"), /permission denied/i);
    assert.match(await psqlErrorAs("service_role", "select * from public.vibode_furniture_generation_controls"), /permission denied/i);
    assert.match(await psqlErrorAs("service_role", "insert into public.vibode_furniture_generation_jobs (job_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9')"), /permission denied/i);
    assert.match(await psqlErrorAs("anon", "select public.read_vibode_furniture_generation_admin_overview()"), /permission denied/i);
    assert.match(await psqlErrorAs("authenticated", `select public.read_vibode_furniture_generation_admin_jobs('${USER_A}', 10, 0)`), /permission denied/i);
    assert.match(await psqlErrorAs("service_role", "select public.vibode_furniture_generation_admin_text('hello', 10)"), /permission denied/i);
    assert.equal(await psqlAs("service_role", "select public.read_vibode_furniture_generation_admin_overview()->>'approved_accounts'"), "2");
    assert.equal(await fingerprint(), settled);
    assert.equal(fetches.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

function jobSql(job: {
  jobId: string;
  userId: string;
  key: string;
  status: string;
  createdAt: string;
  allowance: string | null;
  quota: string;
  consumed: number | null;
  providerStatus: string | null;
  taskId: string | null;
  contacted: boolean;
  errorClass: string | null;
  errorCode: string | null;
  savedAsset: boolean;
  output: boolean;
}): string {
  const settings = JSON.stringify({
    geometryResolution: "standard",
    shouldTexture: true,
    textureModel: "meshy-7",
    textureResolution: "2k",
    enablePbr: false,
    texturePrompt: "HIDDEN_TEXTURE_PROMPT",
    imageEnhancement: true,
    shouldRemesh: false,
    topology: "triangle",
    targetPolycount: 30000,
    storage_object_path: "users/hidden/candidate.glb",
  });
  const outputPath = job.output ? `users/${job.userId}/generations/${job.jobId}/candidate.glb` : null;
  return `
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, provider_task_id, provider_status,
      provider_contacted_at, status, quota_state, reserved_credits, consumed_credits,
      output_bucket, output_object_path, error_class, error_code, saved_asset_id,
      allowance_state, created_at
    ) values (
      ${sql(job.jobId)}, ${sql(job.userId)}, 'meshy-7.1', 'image-to-3d', ${sql(job.key)}, ${sql(SHA)},
      ${sql(settings)}::jsonb, array['front']::text[], ${sql(`vibode-${job.jobId}`)},
      ${sql(job.taskId)}, ${sql(job.providerStatus)},
      ${job.contacted ? `${sql(job.createdAt)}::timestamptz` : "null"},
      ${sql(job.status)}, ${sql(job.quota)}, 30, ${job.consumed == null ? "null" : String(job.consumed)},
      ${job.output ? "'vibode-furniture-assets'" : "null"},
      ${sql(outputPath)}, ${sql(job.errorClass)}, ${sql(job.errorCode)},
      ${job.savedAsset ? sql(`vibode-furniture/personal/${ASSET}`) : "null"},
      ${sql(job.allowance)}, ${sql(job.createdAt)}::timestamptz
    );
  `;
}

function assertNoSecrets(payload: string): void {
  const forbidden = [
    "api.meshy",
    "msy_",
    "candidate.glb",
    "HIDDEN_TEXTURE_PROMPT",
    "vibode-furniture/personal",
    "users/hidden",
    "users/",
    "output_object_path",
    "evidence_ref",
    "texturePrompt",
    "MESHY_API_KEY",
    "generations/",
    ...Object.values(TASKS),
  ];
  for (const secret of forbidden) assert.equal(payload.includes(secret), false, secret);
}

async function overview(): Promise<JsonRecord> {
  return readJson("select public.read_vibode_furniture_generation_admin_overview()");
}

async function jobs(userId: string, limit: number, offset: number): Promise<JsonRecord> {
  return readJson(`select public.read_vibode_furniture_generation_admin_jobs('${userId}', ${limit}, ${offset})`);
}

async function job(jobId: string): Promise<JsonRecord> {
  return readJson(`select public.read_vibode_furniture_generation_admin_job('${jobId}')`);
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

async function ledgerCounts(): Promise<string> {
  return psql(`
    select (select count(*) from public.vibode_furniture_generation_jobs)::text || '|' ||
      (select count(*) from public.vibode_furniture_generation_allowances)::text || '|' ||
      (select count(*) from public.vibode_furniture_generation_allowance_events)::text || '|' ||
      (select count(*) from public.vibode_furniture_generation_resubmit_events)::text || '|' ||
      (select count(*) from public.vibode_furniture_generation_credit_resolutions)::text || '|' ||
      (select count(*) from public.vibode_furniture_generation_controls)::text
  `);
}

async function readJson(sql: string): Promise<JsonRecord> {
  return JSON.parse(await psql(sql)) as JsonRecord;
}

function nested(record: JsonRecord | undefined, key: string): JsonRecord {
  const value = record?.[key];
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value as JsonRecord[];
}

function ids(page: JsonRecord): string[] {
  return records(page.jobs).map((job) => String(job.job_id));
}

function sql(value: string | null): string {
  if (value == null) return "null";
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
