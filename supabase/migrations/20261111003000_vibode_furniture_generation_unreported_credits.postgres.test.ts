/**
 * MESHY-1D.2F missing provider credits on disposable Postgres 16.
 * The chain includes Slice 6. Provider calls are scripted, and fetch throws.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { executeFurnitureGenerationClaim } from "@/lib/vibode-furniture/generation/pipeline";
import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import type { MeshyTransport, MeshyTransportCall, MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import { createMemoryBucketStore } from "@/lib/vibode-furniture/generation/objects";
import { createSqlGenerationCommands, type GenerationRpcName } from "@/lib/vibode-furniture/generation/sql-commands";

const CONTAINER = "vibode-furniture-1d2f-pg";
const DATABASE = "furniture1d2f";
const MIGRATION = "supabase/migrations/20261111003000_vibode_furniture_generation_unreported_credits.sql";
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
];
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const LEGACY = "44444444-4444-4444-8444-444444444444";
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
const OLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const FAILED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CANCELED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const EXPLICIT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const POSITIVE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const OUTPUT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6";
const INVALID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7";
const LEGACY_JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8";
const RESUBMIT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9";
const CRASH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbba";

test("missing provider credits stay unknown until an authoritative number arrives", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /does not rewrite stored jobs/);
  assert.match(migration, /missing value is/);
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY/);
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
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
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER}'), ('${OTHER}'), ('${LEGACY}'), ('${ADMIN}');
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
    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256, settings,
        image_slots, provider_task_name, provider_task_id, provider_status, status,
        quota_state, reserved_credits, consumed_credits, allowance_state, error_class
      ) values (
        '${OLD}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'old-failed-key', '${SHA}',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 'vibode-${OLD}',
        'task-old-failed', 'FAILED', 'failed', 'released', 30, 0, null, 'provider_failed'
      )
    `);
    const before = await jobFacts(OLD);
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await jobFacts(OLD), before);
    assert.equal(await psql(`
      select has_function_privilege('anon', 'public.resolve_vibode_furniture_generation_provider_credits(uuid,uuid,text,integer,text,text)', 'execute')::text
        || has_function_privilege('authenticated', 'public.resolve_vibode_furniture_generation_provider_credits(uuid,uuid,text,integer,text,text)', 'execute')::text
        || has_function_privilege('service_role', 'public.resolve_vibode_furniture_generation_provider_credits(uuid,uuid,text,integer,text,text)', 'execute')::text
        || has_function_privilege('service_role', 'public.vibode_furniture_generation_record_known_credits(uuid,integer,text,integer,text,boolean)', 'execute')::text
    `), "falsefalsetruefalse");
    const controlsBefore = await controlFingerprint();
    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true, paid_submissions_authorized = 1
      where control_id = 'global'
    `);
    for (const userId of [USER, OTHER]) {
      await psql(`
        insert into public.vibode_furniture_generation_allowances (
          user_id, classification, enabled, authorized_generations,
          reserved_generations, consumed_generations, updated_by
        ) values ('${userId}', 'individual_beta', true, 5, 0, 0, '${ADMIN}')
      `);
    }

    const failedNonce = await toRunning(FAILED, "failed-null-key", "task-failed-null");
    const missingFailed = await observe(FAILED, failedNonce, "FAILED", "null");
    assert.equal(missingFailed.status, "needs_review");
    assert.equal(missingFailed.error_class, "credit_unreported");
    assert.equal(await consumed(FAILED), "null");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal(await actions(FAILED), "reserve");
    assert.equal(await processingCount(), "0");
    assert.equal((await reserveRaw(OTHER, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21", "other-blocked")).code, "quota_exhausted");
    assert.equal((await reserveRaw(USER, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22", "same-blocked")).code, "concurrency_limited");
    const repeat = await observe(FAILED, await follow(FAILED), "FAILED", "null");
    assert.equal(repeat.status, "needs_review");
    assert.equal(await consumed(FAILED), "null");
    assert.equal(await credits(), "30|0");
    assert.equal(await actions(FAILED), "reserve");
    const settled = await observe(FAILED, await follow(FAILED), "FAILED", "12");
    assert.equal(settled.status, "failed");
    assert.equal(await consumed(FAILED), "12");
    assert.equal(await credits(), "0|12");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await actions(FAILED), "reserve,release");
    assert.equal((await observe(FAILED, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99", "FAILED", "30")).code, "lease_held");
    assert.equal(await credits(), "0|12");
    await zeroPaidUsed();
    await zeroConsumed();

    const canceledNonce = await toRunning(CANCELED, "canceled-null-key", "task-canceled-n");
    assert.equal((await observe(CANCELED, canceledNonce, "CANCELED", "null")).status, "needs_review");
    assert.equal(await consumed(CANCELED), "null");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${CANCELED}', true)
    `)).code, "not_claimable");
    assert.equal(await jobFacts(CANCELED), "needs_review|null|reserved|reserved");
    const badTask = await resolve(CANCELED, "task-wrong-0001", 0);
    assert.equal(badTask.code, "not_claimable");
    const badReason = await resolve(CANCELED, "task-canceled-n", 0, "short");
    assert.equal(badReason.code, "not_claimable");
    assert.equal(await credits(), "30|0");
    assert.equal(await resolutionCount(CANCELED), "0");
    const resolved = await resolve(CANCELED, "task-canceled-n", 0);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.idempotent, false);
    assert.equal(await consumed(CANCELED), "0");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await actions(CANCELED), "reserve,release");
    assert.equal(await resolutionCount(CANCELED), "1");
    const repeated = await resolve(CANCELED, "task-canceled-n", 0);
    assert.equal(repeated.idempotent, true);
    assert.equal(await resolutionCount(CANCELED), "1");
    assert.equal(await credits(), "0|0");
    assert.equal((await resolve(CANCELED, "task-canceled-n", 9)).code, "conflict");
    assert.equal(await consumed(CANCELED), "0");
    const frozen = await callResult(`
      update public.vibode_furniture_generation_credit_resolutions
      set consumed_credits = 9 where job_id = '${CANCELED}'
    `);
    assert.match(frozen.stderr, /CREDIT_RESOLUTION_IMMUTABLE/);
    await zeroPaidUsed();

    const explicitNonce = await toRunning(EXPLICIT, "explicit-zero-key", "task-explicit-0");
    const explicit = await observe(EXPLICIT, explicitNonce, "SUCCEEDED", "0");
    assert.equal(explicit.status, "ingesting");
    assert.equal(await consumed(EXPLICIT), "0");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "1|0");
    assert.notEqual(await jobFacts(EXPLICIT), "needs_review|null|reserved|reserved");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_output(
        '${USER}', '${EXPLICIT}', '${explicit.claim_nonce}', 'invalid_output'
      )
    `)).status, "failed");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await consumed(EXPLICIT), "0");
    await zeroPaidUsed();

    const positiveNonce = await toRunning(POSITIVE, "positive-fail-key", "task-positive-f");
    assert.equal((await observe(POSITIVE, positiveNonce, "FAILED", "30")).status, "failed");
    assert.equal(await consumed(POSITIVE), "30");
    assert.equal(await credits(), "0|30");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await actions(POSITIVE), "reserve,release");
    await zeroPaidUsed();
    await zeroConsumed();

    const outputNonce = await toRunning(OUTPUT, "output-ready-key", "task-output-rdy");
    assert.equal((await observe(OUTPUT, outputNonce, "SUCCEEDED", "null")).status, "needs_review");
    assert.equal(await consumed(OUTPUT), "null");
    assert.equal(await allowance(USER), "1|0");
    const known = await observe(OUTPUT, await follow(OUTPUT), "SUCCEEDED", "30");
    assert.equal(known.status, "ingesting");
    assert.equal(await consumed(OUTPUT), "30");
    assert.equal(await credits(), "0|30");
    assert.equal(await allowance(USER), "1|0");
    assert.equal((await call(`
      select public.record_vibode_furniture_generation_output(
        '${USER}', '${OUTPUT}', '${known.claim_nonce}', 1000, '${SHA}'
      )
    `)).status, "ready");
    assert.equal(await allowance(USER), "0|1");
    assert.equal(await actions(OUTPUT), "reserve,consume");
    assert.equal(await processingCount(), "0");
    await zeroPaidUsed();
    await zeroConsumed();

    const invalidNonce = await toRunning(INVALID, "invalid-output-key", "task-invalid-ou");
    const ingested = await observe(INVALID, invalidNonce, "SUCCEEDED", "30");
    assert.equal((await call(`
      select public.fail_vibode_furniture_generation_output(
        '${USER}', '${INVALID}', '${ingested.claim_nonce}', 'invalid_output'
      )
    `)).status, "failed");
    assert.equal(await consumed(INVALID), "30");
    assert.equal(await credits(), "0|30");
    assert.equal(await allowance(USER), "0|1");
    assert.equal(await actions(INVALID), "reserve,release");
    await zeroPaidUsed();
    await zeroConsumed();

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, ai_model, operation, idempotency_key, request_sha256, settings,
        image_slots, provider_task_name, provider_task_id, provider_status, status,
        quota_state, reserved_credits, consumed_credits, allowance_state
      ) values (
        '${LEGACY_JOB}', '${LEGACY}', 'meshy-7.1', 'image-to-3d', 'legacy-open-key', '${SHA}',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 'vibode-${LEGACY_JOB}',
        'task-legacy-open', 'PENDING', 'running', 'reserved', 20, null, null
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved + 20 where control_id = 'global'
    `);
    const legacyClaim = await call(`select public.claim_vibode_furniture_generation('${LEGACY}', '${LEGACY_JOB}', 'follow')`);
    const legacyMissing = await observe(LEGACY_JOB, String(legacyClaim.claim_nonce), "FAILED", "null", LEGACY);
    assert.equal(legacyMissing.status, "needs_review");
    assert.equal(await consumed(LEGACY_JOB), "null");
    assert.equal(await actions(LEGACY_JOB), "");
    assert.equal(await credits(), "20|0");
    const legacyZero = await observe(LEGACY_JOB, await follow(LEGACY_JOB, LEGACY), "FAILED", "0", LEGACY);
    assert.equal(legacyZero.status, "failed");
    assert.equal(await consumed(LEGACY_JOB), "0");
    assert.equal(await actions(LEGACY_JOB), "");
    assert.equal(await credits(), "0|0");
    assert.equal(await paid(), "0");

    await reserve(RESUBMIT, "resubmit-key");
    const prepared = await claimNext();
    const committed = await commit(RESUBMIT, String(prepared.claim_nonce));
    assert.equal(committed.ok, true, JSON.stringify(committed));
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second' where job_id = '${RESUBMIT}'
    `);
    const ambiguous = await claimNext();
    assert.equal(ambiguous.purpose, "reconcile");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '2 minutes' where job_id = '${RESUBMIT}'
    `);
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_needs_review(
        '${USER}', '${RESUBMIT}', '${ambiguous.claim_nonce}', 'list_absent'
      )
    `)).status, "needs_review");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${RESUBMIT}', true)
    `)).status, "reserved");
    assert.equal(await paid(), "1");
    assert.equal(await psql(`
      select attempt_count::text || '|' || case when provider_contacted_at is null then 'null' else 'set' end
      from public.vibode_furniture_generation_jobs where job_id = '${RESUBMIT}'
    `), "1|set");
    const posts = { count: 0 };
    const reviewed = await pass(countingTransport(posts), Date.now() + 180_000);
    assert.equal(reviewed.action, "needs_review", JSON.stringify(reviewed));
    assert.equal(posts.count, 0);
    assert.equal(await paid(), "1");
    assert.equal(await psql(`
      select attempt_count::text || '|' || case when provider_contacted_at is null then 'null' else 'set' end
      from public.vibode_furniture_generation_jobs where job_id = '${RESUBMIT}'
    `), "1|set");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|1");
    assert.equal(await consumed(RESUBMIT), "null");
    const next = await claimNext();
    assert.equal(next.purpose, "reconcile");
    assert.notEqual(next.purpose, "prepare");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second' where job_id = '${RESUBMIT}'
    `);
    const resubmitLease = await follow(RESUBMIT);
    assert.equal((await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${RESUBMIT}', '${resubmitLease}', 'task-resubmit-01', 'FAILED'
      )
    `)).status, "running");
    assert.equal((await observe(RESUBMIT, await follow(RESUBMIT), "FAILED", "0")).status, "failed");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|1");
    assert.equal(posts.count, 0);
    await zeroPaidUsed();

    await reserve(CRASH, "crash-key");
    const crashPrepare = await claimNext();
    const crashCommit = await commit(CRASH, String(crashPrepare.claim_nonce));
    await psql(`
      update public.vibode_furniture_generation_jobs
      set claim_expires_at = now() - interval '1 second' where job_id = '${CRASH}'
    `);
    posts.count = 0;
    const recovered = await pass(countingTransport(posts), Date.now());
    assert.equal(recovered.action, "waiting");
    assert.equal(posts.count, 0);
    assert.equal(await paid(), "1");
    assert.equal((await jobFacts(CRASH)).startsWith("ambiguous|"), true);
    const rebound = await follow(CRASH);
    assert.equal((await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${CRASH}', '${rebound}', 'task-crash-0001', 'FAILED'
      )
    `)).status, "running");
    assert.equal((await observe(CRASH, await follow(CRASH), "FAILED", "0")).status, "failed");
    assert.equal(posts.count, 0);
    assert.equal(await paid(), "1");
    await zeroPaidUsed();

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false, paid_submissions_authorized = 0, paid_submissions_used = 0,
        credits_reserved = 0, credits_consumed = 0
      where control_id = 'global'
    `);
    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await jobFacts(OLD), before);
    assert.equal(await psql(`
      select credit_ceiling::text || '|' || max_concurrent::text
      from public.vibode_furniture_generation_controls where control_id = 'global'
    `), "40|1");
    void crashCommit;
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function toRunning(jobId: string, key: string, task: string): Promise<string> {
  await reserve(jobId, key);
  const prepared = await claimNext();
  assert.equal(prepared.purpose, "prepare", JSON.stringify(prepared));
  const committed = await commit(jobId, String(prepared.claim_nonce));
  assert.equal(committed.ok, true, JSON.stringify(committed));
  const bound = await call(`
    select public.bind_vibode_furniture_generation_task(
      '${USER}', '${jobId}', '${committed.claim_nonce}', '${task}', 'PENDING'
    )
  `);
  assert.equal(bound.ok, true, JSON.stringify(bound));
  return follow(jobId);
}

async function reserve(jobId: string, key: string): Promise<void> {
  const reserved = await reserveRaw(USER, jobId, key);
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
}

async function reserveRaw(userId: string, jobId: string, key: string): Promise<JsonRow> {
  return call(`
    select public.reserve_vibode_furniture_generation(
      '${userId}', '${jobId}', '${key}', '${SHA}', 'image-to-3d', 'meshy-7.1',
      $json$${SETTINGS}$json$::jsonb, array['front']::text[], 30
    )
  `);
}

async function claimNext(): Promise<JsonRow> {
  return call("select public.claim_next_vibode_furniture_generation(true)");
}

async function commit(jobId: string, nonce: string): Promise<JsonRow> {
  return call(`
    select public.commit_vibode_furniture_generation_submission('${USER}', '${jobId}', '${nonce}')
  `);
}

async function follow(jobId: string, user = USER): Promise<string> {
  const claimed = await call(`select public.claim_vibode_furniture_generation('${user}', '${jobId}', 'follow')`);
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  return String(claimed.claim_nonce);
}

async function observe(jobId: string, nonce: string, status: string, credits: string, user = USER): Promise<JsonRow> {
  return call(`
    select public.apply_vibode_furniture_generation_observation(
      '${user}', '${jobId}', '${nonce}', '${status}', 100, ${credits}, '${status}'
    )
  `);
}

async function resolve(jobId: string, task: string, credits: number, reason = "dashboard export"): Promise<JsonRow> {
  return call(`
    select public.resolve_vibode_furniture_generation_provider_credits(
      '${ADMIN}', '${jobId}', '${task}', ${credits}, '${reason}', 'operator-note-01'
    )
  `);
}

async function pass(transport: MeshyTransport, nowMs: number) {
  return executeFurnitureGenerationClaim({
    commands: createSqlGenerationCommands(rpc),
    objects: createMemoryBucketStore(),
    adapter: createMeshyAdapter(transport),
    download: async () => ({ kind: "network" }),
    validate: async () => ({
      accepted: false,
      sha256: "00".repeat(32),
      byteSize: 0,
      widthM: null,
      heightM: null,
      depthM: null,
      errors: [{ code: "invalid_output", message: "invalid_output" }],
    }),
    nowMs,
    submitAllowed: true,
  });
}

function countingTransport(posts: { count: number }): MeshyTransport {
  return {
    async request(call: MeshyTransportCall): Promise<MeshyTransportResult> {
      if (call.method === "POST") {
        posts.count += 1;
        throw new Error("unexpected_post");
      }
      return { kind: "response", status: 200, headers: {}, body: [], unparsed: false };
    },
  };
}

async function jobFacts(jobId: string): Promise<string> {
  return psql(`
    select status || '|' || coalesce(consumed_credits::text, 'null') || '|' || quota_state
      || '|' || coalesce(allowance_state, 'null')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function consumed(jobId: string): Promise<string> {
  return psql(`
    select coalesce(consumed_credits::text, 'null')
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function paid(): Promise<string> {
  return psql("select paid_submissions_used::text from public.vibode_furniture_generation_controls where control_id = 'global'");
}

async function credits(): Promise<string> {
  return psql(`
    select credits_reserved::text || '|' || credits_consumed::text
    from public.vibode_furniture_generation_controls where control_id = 'global'
  `);
}

async function allowance(userId: string): Promise<string> {
  return psql(`
    select reserved_generations::text || '|' || consumed_generations::text
    from public.vibode_furniture_generation_allowances where user_id = '${userId}'
  `);
}

async function actions(jobId: string): Promise<string> {
  return psql(`
    select coalesce(string_agg(action, ',' order by created_at), '')
    from public.vibode_furniture_generation_allowance_events where job_id = '${jobId}'
  `);
}

async function resolutionCount(jobId: string): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_credit_resolutions where job_id = '${jobId}'
  `);
}

async function processingCount(): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  `);
}

async function zeroPaidUsed(): Promise<void> {
  assert.equal(await paid(), "1");
  await psql("update public.vibode_furniture_generation_controls set paid_submissions_used = 0 where control_id = 'global'");
}

async function zeroConsumed(): Promise<void> {
  await psql("update public.vibode_furniture_generation_controls set credits_consumed = 0 where control_id = 'global'");
}

async function controlFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls where control_id = 'global'
  `);
}

type JsonRow = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  status?: string;
  purpose?: string;
  claim_nonce?: string;
  error_class?: string;
  idempotent?: boolean;
};

async function call(sql: string): Promise<JsonRow> {
  return JSON.parse(await psql(sql)) as JsonRow;
}

async function rpc(fn: GenerationRpcName, values: readonly unknown[]): Promise<unknown> {
  return JSON.parse(await psql(`select public.${fn}(${values.map(sqlLiteral).join(", ")})::text`));
}

function sqlLiteral(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (Array.isArray(value)) return `array[${value.map((item) => sqlLiteral(item)).join(",")}]::text[]`;
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 400)}`);
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
