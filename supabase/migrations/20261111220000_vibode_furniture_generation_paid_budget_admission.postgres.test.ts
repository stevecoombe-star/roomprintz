/**
 * MESHY-1D.4B paid-budget admission on disposable Postgres 16.
 * The chain includes every furniture generation migration through owner allowance,
 * then this admission fix. Provider calls are scripted, and fetch throws.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { executeFurnitureGenerationClaim } from "@/lib/vibode-furniture/generation/pipeline";
import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import type { MeshyTransport, MeshyTransportCall, MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import { createMemoryBucketStore } from "@/lib/vibode-furniture/generation/objects";
import { generationInputPath } from "@/lib/vibode-furniture/generation/output";
import { GENERATION_INPUT_BUCKET } from "@/lib/vibode-furniture/generation/policy";
import { createSqlGenerationCommands, type GenerationRpcName } from "@/lib/vibode-furniture/generation/sql-commands";

const CONTAINER = "vibode-furniture-1d4b-pg";
const DATABASE = "furniture1d4b";
const MIGRATION = "supabase/migrations/20261111220000_vibode_furniture_generation_paid_budget_admission.sql";
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
];
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SHA = "ab".repeat(32);
const OTHER_SHA = "cd".repeat(32);
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
const ADMITTED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const LEGACY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const POSTED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const AMBIGUOUS = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const POSTED_TASK = "018a210d-8ba4-705c-b111-1f1776f7f5a1";

test("paid budget admission refuses a new hold and releases one uncontacted attempt", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /paid_submissions_used >= v_controls\.paid_submissions_authorized/);
  assert.match(migration, /submission_budget_exhausted/);
  assert.match(migration, /vibode_furniture_generation_settle_allowance/);
  assert.match(migration, /paid_submissions_used = paid_submissions_used \+ 1/);
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized/i);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.doesNotMatch(migration, /read_vibode_furniture_generation_owner_allowance|admin_approve_vibode_furniture_generation_tester/);
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  await removeContainer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("real_network_blocked");
  };
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER}'), ('${OTHER}'), ('${ADMIN}');
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
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select count(*)::text from pg_proc
      where proname in (
        'reserve_vibode_furniture_generation',
        'claim_vibode_furniture_generation',
        'commit_vibode_furniture_generation_submission'
      )
    `), "3");
    assert.equal(await psql(`
      select string_agg(proname || ':' || prosecdef::text || ':' || proconfig::text, ',' order by proname)
      from pg_proc
      where proname in (
        'reserve_vibode_furniture_generation',
        'claim_vibode_furniture_generation',
        'commit_vibode_furniture_generation_submission'
      )
    `), [
      'claim_vibode_furniture_generation:true:{"search_path=pg_catalog, public, pg_temp"}',
      'commit_vibode_furniture_generation_submission:true:{"search_path=pg_catalog, public, pg_temp"}',
      'reserve_vibode_furniture_generation:true:{"search_path=pg_catalog, public, pg_temp"}',
    ].join(","));
    assert.equal(await psql(`
      select position('submission_not_authorized' in prosrc)::text
      from pg_proc where proname = 'claim_vibode_furniture_generation'
    `), "0");
    assert.equal(await psql(`
      select has_function_privilege('service_role', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
        || has_function_privilege('anon', 'public.reserve_vibode_furniture_generation(uuid,uuid,text,text,text,text,jsonb,text[],integer)', 'execute')::text
        || has_function_privilege('authenticated', 'public.commit_vibode_furniture_generation_submission(uuid,uuid,uuid)', 'execute')::text
        || has_function_privilege('service_role', 'public.commit_vibode_furniture_generation_submission(uuid,uuid,uuid)', 'execute')::text
        || has_function_privilege('anon', 'public.claim_vibode_furniture_generation(uuid,uuid,text)', 'execute')::text
        || has_function_privilege('service_role', 'public.claim_vibode_furniture_generation(uuid,uuid,text)', 'execute')::text
    `), "truefalsefalsetruefalsetrue");
    for (const userId of [USER, OTHER]) {
      await psql(`
        insert into public.vibode_furniture_generation_allowances (
          user_id, classification, enabled, authorized_generations,
          reserved_generations, consumed_generations, updated_by
        ) values ('${userId}', 'individual_beta', true, 5, 0, 0, '${ADMIN}')
      `);
    }
    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true
      where control_id = 'global'
    `);
    const ownerBefore = await call(`select public.read_vibode_furniture_generation_owner_allowance('${USER}')`);
    assert.equal(ownerBefore.ok, true);
    assert.equal(ownerBefore.approved, true);
    assert.equal(ownerBefore.remaining, 5);
    const overviewBefore = await call("select public.read_vibode_furniture_generation_admin_overview()");
    assert.equal(overviewBefore.ok, true);
    assert.equal(overviewBefore.live_enabled, true);
    assert.equal(overviewBefore.paid_submissions_authorized, 0);
    assert.equal(overviewBefore.paid_submissions_used, 0);
    assert.equal(overviewBefore.credit_ceiling, 40);
    assert.equal(overviewBefore.max_concurrent, 1);
    assert.equal(overviewBefore.remaining_generations, 10);

    const empty = await reserveRaw(USER, ADMITTED, "admitted-key");
    assert.equal(empty.code, "submission_not_authorized");
    assert.equal(await footprint(), "0|0|0|0|0|0|0|0|0");
    await psql(`
      update public.vibode_furniture_generation_controls
      set paid_submissions_authorized = 1, paid_submissions_used = 1
      where control_id = 'global'
    `);
    const spent = await reserveRaw(USER, ADMITTED, "admitted-key");
    assert.equal(spent.code, "submission_not_authorized");
    assert.equal(await footprint(), "0|0|0|1|1|0|0|0|0");
    assert.equal(await call(`select public.read_vibode_furniture_generation_owner_allowance('${USER}')`).then((row) => row.remaining), 5);

    await psql("update public.vibode_furniture_generation_controls set paid_submissions_used = 0 where control_id = 'global'");
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer();
    const photoSha = createHash("sha256").update(photo).digest("hex");
    const objects = createMemoryBucketStore();
    await reserve(ADMITTED, "admitted-key");
    assert.equal(await footprint(), "1|30|0|1|0|1|0|1|1");
    assert.equal(await jobFacts(ADMITTED), "reserved|0|null|0|reserved");
    const replay = await reserveRaw(USER, "cccccccc-cccc-4ccc-8ccc-cccccccccc99", "admitted-key");
    assert.equal(replay.ok, true);
    assert.equal(replay.created, false);
    assert.equal(replay.job_id, ADMITTED);
    assert.equal(await footprint(), "1|30|0|1|0|1|0|1|1");
    await psql("update public.vibode_furniture_generation_controls set paid_submissions_used = 1 where control_id = 'global'");
    const replayExhausted = await reserveRaw(USER, "cccccccc-cccc-4ccc-8ccc-cccccccccc98", "admitted-key");
    assert.equal(replayExhausted.ok, true);
    assert.equal(replayExhausted.created, false);
    assert.equal(replayExhausted.job_id, ADMITTED);
    const conflict = await call(`
      select public.reserve_vibode_furniture_generation(
        '${USER}', '${ADMITTED}', 'admitted-key', '${OTHER_SHA}', 'image-to-3d', 'meshy-7.1',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 30
      )
    `);
    assert.equal(conflict.code, "idempotency_conflict");
    assert.equal(await footprint(), "1|30|0|1|1|1|0|1|1");
    assert.equal(await paid(), "1");

    await attach(ADMITTED, photo, photoSha);
    await objects.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, ADMITTED, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const releasePosts = { count: 0 };
    const released = await Promise.all([
      pass(objects, transport(releasePosts, null), Date.now()),
      pass(objects, transport(releasePosts, null), Date.now()),
    ]);
    assert.equal(releasePosts.count, 0);
    assert.equal(released.some((row) => row.action === "submission_not_authorized"), true);
    assert.equal(released.every((row) => row.action === "submission_not_authorized" || row.action === "idle" || row.action === "waiting"), true);
    assert.equal(await jobFacts(ADMITTED), "failed|0|null|0|released");
    assert.equal(await actions(ADMITTED), "reserve,release");
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await processingCount(), "0");
    assert.equal(await accountsMatch(), "ok");
    const repeated = await pass(objects, transport(releasePosts, null), Date.now());
    assert.equal(repeated.action, "idle");
    assert.equal(releasePosts.count, 0);
    assert.equal(await actions(ADMITTED), "reserve,release");
    assert.equal(await paid(), "1");
    const deniedAfter = await reserveRaw(OTHER, "cccccccc-cccc-4ccc-8ccc-ccccccccccc7", "other-denied-key");
    assert.equal(deniedAfter.code, "submission_not_authorized");
    assert.equal(await allowance(OTHER), "0|0");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = 30
      where control_id = 'global'
    `);
    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, quota_state, allowance_state, reserved_credits
      ) values (
        '${LEGACY}', '${USER}', 'meshy', 'meshy-7.1', 'image-to-3d', 'legacy-uncontacted', '${SHA}',
        $json$${SETTINGS}$json$::jsonb, array['front']::text[], 'vibode-${LEGACY}',
        'reserved', 'reserved', null, 30
      )
    `);
    const legacyClaim = await call(`select public.claim_vibode_furniture_generation('${USER}', '${LEGACY}', 'submit')`);
    assert.equal(legacyClaim.ok, true);
    assert.equal(legacyClaim.purpose, "prepare");
    const legacyCommits = await Promise.all([
      commit(LEGACY, String(legacyClaim.claim_nonce)),
      commit(LEGACY, String(legacyClaim.claim_nonce)),
    ]);
    assert.equal(legacyCommits.filter((row) => row.code === "submission_not_authorized" && row.status === "failed").length, 1);
    assert.equal(legacyCommits.filter((row) => row.code === "lease_held").length, 1);
    assert.equal(await jobFacts(LEGACY), "failed|0|null|0|released");
    assert.equal(await actions(LEGACY), "");
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "0|0");
    assert.equal(await accountsMatch(), "ok");
    const legacyAgain = await commit(LEGACY, String(legacyClaim.claim_nonce));
    assert.equal(legacyAgain.code, "lease_held");
    assert.equal(await actions(LEGACY), "");

    await psql("update public.vibode_furniture_generation_controls set paid_submissions_used = 0 where control_id = 'global'");
    await reserve(POSTED, "posted-key");
    await attach(POSTED, photo, photoSha);
    await objects.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, POSTED, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const postedCount = { count: 0 };
    const posted = await pass(objects, transport(postedCount, POSTED_TASK), Date.now());
    assert.equal(posted.action, "submitted", JSON.stringify(posted));
    assert.equal(postedCount.count, 1);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await psql(`select provider_task_id from public.vibode_furniture_generation_jobs where job_id = '${POSTED}'`), POSTED_TASK);
    const second = await pass(objects, transport(postedCount, POSTED_TASK), Date.now());
    assert.equal(postedCount.count, 1);
    assert.notEqual(second.action, "submission_not_authorized");
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.notEqual(await psql(`select coalesce(error_class, 'null') from public.vibode_furniture_generation_jobs where job_id = '${POSTED}'`), "submission_budget_exhausted");
    const postedLease = await follow(POSTED);
    const failedPosted = await observe(POSTED, postedLease, "FAILED", "0");
    assert.equal(failedPosted.status, "failed", JSON.stringify(failedPosted));
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    assert.equal(await processingCount(), "0");

    await psql("update public.vibode_furniture_generation_controls set paid_submissions_used = 0 where control_id = 'global'");
    await reserve(AMBIGUOUS, "ambiguous-key");
    await attach(AMBIGUOUS, photo, photoSha);
    await objects.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, AMBIGUOUS, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const crashedPosts = { count: 0 };
    const crashed = await pass(objects, transport(crashedPosts, null, "timeout"), Date.now());
    assert.equal(crashed.action, "ambiguous", JSON.stringify(crashed));
    assert.equal(crashedPosts.count, 1);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal(await actions(AMBIGUOUS), "reserve");
    const ambiguousClaim = await claimNext();
    assert.equal(ambiguousClaim.purpose, "reconcile");
    const ambiguousCommit = await commit(AMBIGUOUS, String(ambiguousClaim.claim_nonce));
    assert.equal(ambiguousCommit.code, "not_claimable");
    assert.equal(await psql(`
      select status || '|' || coalesce(error_class, 'null')
      from public.vibode_furniture_generation_jobs where job_id = '${AMBIGUOUS}'
    `), "ambiguous|ambiguous_timeout");
    assert.equal(await credits(), "30|0");
    assert.equal(await actions(AMBIGUOUS), "reserve");
    assert.equal(await paid(), "1");
    await expire(AMBIGUOUS);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '2 minutes'
      where job_id = '${AMBIGUOUS}'
    `);
    const reviewClaim = await claimNext();
    assert.equal(reviewClaim.purpose, "reconcile");
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_needs_review(
        '${USER}', '${AMBIGUOUS}', '${reviewClaim.claim_nonce}', 'list_absent'
      )
    `)).status, "needs_review");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${AMBIGUOUS}', false)
    `)).code, "not_claimable");
    assert.equal(await events(AMBIGUOUS), "");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${AMBIGUOUS}', true)
    `)).status, "reserved");
    const reviewPosts = { count: 0 };
    const blocked = await pass(objects, transport(reviewPosts, null), Date.now());
    assert.equal(blocked.action, "submission_not_authorized", JSON.stringify(blocked));
    assert.equal(reviewPosts.count, 0);
    assert.equal(crashedPosts.count, 1);
    assert.equal(await reviewFacts(AMBIGUOUS), "needs_review|submission_budget_exhausted|1|set|0|closed");
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal(await actions(AMBIGUOUS), "reserve");
    assert.equal(await events(AMBIGUOUS), "authorize:operator_recovery,revoke:submission_budget_exhausted");
    assert.equal(await processingCount(), "0");
    const repeatedReview = await pass(objects, transport(reviewPosts, null), Date.now());
    assert.equal(repeatedReview.action, "needs_review");
    assert.equal(reviewPosts.count, 0);
    assert.equal(await events(AMBIGUOUS), "authorize:operator_recovery,revoke:submission_budget_exhausted");
    assert.equal(await accountsMatch(), "ok");
    const ownerAfter = await call(`select public.read_vibode_furniture_generation_owner_allowance('${USER}')`);
    assert.equal(ownerAfter.approved, true);
    assert.equal(ownerAfter.reserved, 1);
    assert.equal(ownerAfter.remaining, 4);
    const overviewAfter = await call("select public.read_vibode_furniture_generation_admin_overview()");
    assert.equal(overviewAfter.paid_submissions_authorized, 1);
    assert.equal(overviewAfter.paid_submissions_used, 1);
    assert.equal(overviewAfter.credit_ceiling, 40);
    assert.equal(overviewAfter.max_concurrent, 1);
    assert.equal(overviewAfter.credits_reserved, 30);
    assert.equal(await psql(`
      select credit_ceiling::text || '|' || max_concurrent::text
      from public.vibode_furniture_generation_controls where control_id = 'global'
    `), "40|1");
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function reserve(jobId: string, key: string): Promise<void> {
  const reserved = await reserveRaw(USER, jobId, key);
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  assert.equal(reserved.created, true);
}

async function reserveRaw(userId: string, jobId: string, key: string): Promise<JsonRow> {
  return call(`
    select public.reserve_vibode_furniture_generation(
      '${userId}', '${jobId}', '${key}', '${SHA}', 'image-to-3d', 'meshy-7.1',
      $json$${SETTINGS}$json$::jsonb, array['front']::text[], 30
    )
  `);
}

async function attach(jobId: string, bytes: Buffer, sha: string): Promise<void> {
  const attached = await call(`
    select public.attach_vibode_furniture_generation_input(
      '${USER}', '${jobId}', 'front', 'image/png', ${bytes.byteLength}, 64, 64, '${sha}'
    )
  `);
  assert.equal(attached.ok, true, JSON.stringify(attached));
}

async function claimNext(): Promise<JsonRow> {
  return call("select public.claim_next_vibode_furniture_generation(true)");
}

async function commit(jobId: string, nonce: string): Promise<JsonRow> {
  return call(`
    select public.commit_vibode_furniture_generation_submission('${USER}', '${jobId}', '${nonce}')
  `);
}

async function follow(jobId: string): Promise<string> {
  const claimed = await call(`select public.claim_vibode_furniture_generation('${USER}', '${jobId}', 'follow')`);
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  return String(claimed.claim_nonce);
}

async function observe(jobId: string, nonce: string, status: string, credits: string): Promise<JsonRow> {
  return call(`
    select public.apply_vibode_furniture_generation_observation(
      '${USER}', '${jobId}', '${nonce}', '${status}', 100, ${credits}, '${status}'
    )
  `);
}

async function expire(jobId: string): Promise<void> {
  await psql(`
    update public.vibode_furniture_generation_jobs
    set claim_expires_at = now() - interval '1 second'
    where job_id = '${jobId}'
  `);
}

async function pass(
  objects: ReturnType<typeof createMemoryBucketStore>,
  provider: MeshyTransport,
  nowMs: number,
) {
  return executeFurnitureGenerationClaim({
    commands: createSqlGenerationCommands(rpc),
    objects,
    adapter: createMeshyAdapter(provider),
    download: async () => ({ kind: "network" }),
    validate: async () => ({ ok: false, errorClass: "invalid_output" }),
    nowMs,
    submitAllowed: true,
  });
}

function transport(posts: { count: number }, task: string | null, post: "accept" | "timeout" = "accept"): MeshyTransport {
  return {
    async request(call: MeshyTransportCall): Promise<MeshyTransportResult> {
      if (call.method === "POST") {
        posts.count += 1;
        if (post === "timeout") return { kind: "timeout" };
        if (!task) throw new Error("unexpected_post");
        return { kind: "response", status: 202, headers: {}, body: { result: task }, unparsed: false };
      }
      return { kind: "response", status: 200, headers: {}, body: [], unparsed: false };
    },
  };
}

async function jobFacts(jobId: string): Promise<string> {
  return psql(`
    select status || '|' || attempt_count::text
      || '|' || case when provider_contacted_at is null then 'null' else 'set' end
      || '|' || case when provider_task_id is null then '0' else '1' end
      || '|' || quota_state
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function reviewFacts(jobId: string): Promise<string> {
  return psql(`
    select status || '|' || coalesce(error_class, 'null') || '|' || attempt_count::text
      || '|' || case when provider_contacted_at is null then 'null' else 'set' end
      || '|' || case when provider_task_id is null then '0' else '1' end
      || '|' || case when resubmit_authorized_at is null then 'closed' else 'open' end
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
    select coalesce(string_agg(action, ',' order by created_at, action), '')
    from public.vibode_furniture_generation_allowance_events where job_id = '${jobId}'
  `);
}

async function events(jobId: string): Promise<string> {
  return psql(`
    select coalesce(string_agg(action || ':' || reason, ',' order by created_at, action), '')
    from public.vibode_furniture_generation_resubmit_events where job_id = '${jobId}'
  `);
}

async function processingCount(): Promise<string> {
  return psql(`
    select count(*)::text from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  `);
}

async function footprint(): Promise<string> {
  return psql(`
    select
      (select count(*)::text from public.vibode_furniture_generation_jobs)
      || '|' || credits_reserved::text
      || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text
      || '|' || paid_submissions_used::text
      || '|' || (select reserved_generations::text from public.vibode_furniture_generation_allowances where user_id = '${USER}')
      || '|' || (select consumed_generations::text from public.vibode_furniture_generation_allowances where user_id = '${USER}')
      || '|' || (select count(*)::text from public.vibode_furniture_generation_allowance_events)
      || '|' || (select count(*)::text from public.vibode_furniture_generation_jobs)
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
}

async function accountsMatch(): Promise<string> {
  return psql(`
    select case
      when credits_reserved = coalesce((
        select sum(reserved_credits)
        from public.vibode_furniture_generation_jobs
        where quota_state = 'reserved'
      ), 0)
      and paid_submissions_used <= paid_submissions_authorized
      and credits_reserved >= 0
      and credits_consumed >= 0
      then 'ok' else 'drift' end
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
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

type JsonRow = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  status?: string;
  purpose?: string;
  claim_nonce?: string;
  created?: boolean;
  job_id?: string;
  approved?: boolean;
  remaining?: number;
  reserved?: number;
  live_enabled?: boolean;
  paid_submissions_authorized?: number;
  paid_submissions_used?: number;
  credit_ceiling?: number;
  max_concurrent?: number;
  remaining_generations?: number;
  credits_reserved?: number;
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
