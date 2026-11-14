/**
 * MESHY-1D.2G exhausted resubmission on disposable Postgres 16.
 * The chain includes Slice 7. Provider calls are scripted, and fetch throws.
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

const CONTAINER = "vibode-furniture-1d2g-pg";
const DATABASE = "furniture1d2g";
const MIGRATION = "supabase/migrations/20261111013000_vibode_furniture_generation_resubmit_budget.sql";
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
];
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
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
const FIRST = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const BUDGET = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const MISSING = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const INPUT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const FIRST_TASK = "018a210d-8ba4-705c-b111-1f1776f7f590";
const RETRY_TASK = "018a210d-8ba4-705c-b111-1f1776f7f591";

test("an exhausted authorized resubmit leaves the processing slot without a second post", { timeout: 180_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /submission_budget_exhausted/);
  assert.match(migration, /paid_submissions_used = paid_submissions_used \+ 1/);
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
    assert.equal(await psql(`
      select has_table_privilege('service_role', 'public.vibode_furniture_generation_resubmit_events', 'select')::text
        || has_table_privilege('anon', 'public.vibode_furniture_generation_resubmit_events', 'insert')::text
        || (select relrowsecurity::text from pg_class where relname = 'vibode_furniture_generation_resubmit_events')
    `), "falsefalsetrue");
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
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer();
    const photoSha = createHash("sha256").update(photo).digest("hex");
    const objects = createMemoryBucketStore();

    await reserve(FIRST, "first-attempt-key");
    await attach(FIRST, photo, photoSha);
    await objects.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, FIRST, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const firstPosts = { count: 0 };
    const first = await pass(objects, transport(firstPosts, FIRST_TASK), Date.now());
    assert.equal(first.action, "submitted", JSON.stringify(first));
    assert.equal(firstPosts.count, 1);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    const firstLease = await follow(FIRST);
    assert.equal((await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${FIRST}', '${firstLease}', '${FIRST_TASK}', 'FAILED'
      )
    `)).code, "not_claimable");
    assert.equal(await psql(`
      select provider_task_id from public.vibode_furniture_generation_jobs where job_id = '${FIRST}'
    `), FIRST_TASK);
    assert.equal((await observe(FIRST, firstLease, "FAILED", "0")).status, "failed");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    await zeroPaidUsed();

    await reserve(BUDGET, "budget-retry-key");
    await attach(BUDGET, photo, photoSha);
    await objects.put({
      bucket: GENERATION_INPUT_BUCKET,
      path: generationInputPath(USER, BUDGET, "front", "png"),
      bytes: photo,
      contentType: "image/png",
    });
    const prepared = await claimNext();
    assert.equal(prepared.purpose, "prepare");
    const committed = await commit(BUDGET, String(prepared.claim_nonce));
    assert.equal(committed.ok, true, JSON.stringify(committed));
    await expire(BUDGET);
    const ambiguous = await claimNext();
    assert.equal(ambiguous.purpose, "reconcile");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '2 minutes'
      where job_id = '${BUDGET}'
    `);
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_needs_review(
        '${USER}', '${BUDGET}', '${ambiguous.claim_nonce}', 'list_absent'
      )
    `)).status, "needs_review");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${BUDGET}', false)
    `)).code, "not_claimable");
    assert.equal(await events(BUDGET), "");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${BUDGET}', true)
    `)).status, "reserved");
    const contacted = await contactedAt(BUDGET);
    const posts = { count: 0 };
    const blocked = await pass(objects, transport(posts, null), Date.now());
    assert.equal(blocked.action, "submission_not_authorized", JSON.stringify(blocked));
    assert.equal(posts.count, 0);
    assert.equal(await reviewFacts(BUDGET), "needs_review|submission_budget_exhausted|1|set|0|closed");
    assert.equal(await contactedAt(BUDGET), contacted);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal(await actions(BUDGET), "reserve");
    assert.equal(await events(BUDGET), "authorize:operator_recovery,revoke:submission_budget_exhausted");
    assert.equal(await processingCount(), "0");
    assert.equal((await reserveRaw(USER, "cccccccc-cccc-4ccc-8ccc-ccccccccccc5", "same-user-key")).code, "concurrency_limited");
    assert.equal((await reserveRaw(OTHER, "cccccccc-cccc-4ccc-8ccc-ccccccccccc6", "other-user-key")).code, "quota_exhausted");
    assert.equal((await commit(BUDGET, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99")).code, "lease_held");
    assert.equal(await events(BUDGET), "authorize:operator_recovery,revoke:submission_budget_exhausted");
    const repeated = await pass(objects, transport(posts, null), Date.now());
    assert.equal(repeated.action, "needs_review");
    assert.equal(posts.count, 0);
    assert.equal(await reviewFacts(BUDGET), "needs_review|submission_budget_exhausted|1|set|0|closed");

    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${BUDGET}', true)
    `)).status, "reserved");
    const stale = await claimNext();
    assert.equal(stale.purpose, "prepare");
    await expire(BUDGET);
    const current = await claimNext();
    assert.equal(current.purpose, "prepare");
    assert.equal((await commit(BUDGET, String(stale.claim_nonce))).code, "lease_held");
    assert.equal(await psql(`
      select status || '|' || case when resubmit_authorized_at is null then 'closed' else 'open' end
      from public.vibode_furniture_generation_jobs where job_id = '${BUDGET}'
    `), "reserved|open");
    assert.equal((await commit(BUDGET, String(current.claim_nonce))).status, "needs_review");
    assert.equal(await paid(), "1");
    assert.equal(await attempt(BUDGET), "1");

    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${BUDGET}', true)
    `)).status, "reserved");
    const raceLease = await claimNext();
    const raced = await Promise.all([
      commit(BUDGET, String(raceLease.claim_nonce)),
      commit(BUDGET, String(raceLease.claim_nonce)),
    ]);
    assert.equal(raced.filter((row) => row.status === "needs_review").length, 1);
    assert.equal(raced.filter((row) => row.code === "lease_held").length, 1);
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await attempt(BUDGET), "1");
    assert.equal((await events(BUDGET)).split(",").filter((item) => item.startsWith("revoke:")).length, 3);

    await psql(`
      update public.vibode_furniture_generation_controls
      set paid_submissions_used = 0 where control_id = 'global'
    `);
    const raised = await pass(objects, transport(posts, RETRY_TASK), Date.now());
    assert.notEqual(raised.action, "submitted");
    assert.equal(posts.count, 0);
    assert.equal(await paid(), "0");
    assert.equal(await reviewFacts(BUDGET), "needs_review|submission_budget_exhausted|1|set|0|closed");
    const beforeResolve = await events(BUDGET);
    assert.equal((await call(`
      select public.resolve_vibode_furniture_generation_provider_credits(
        '${ADMIN}', '${BUDGET}', 'task-wrong-0001', 0, 'dashboard export', 'operator-note-01'
      )
    `)).code, "not_claimable");
    assert.equal(await events(BUDGET), beforeResolve);
    assert.equal(await reviewFacts(BUDGET), "needs_review|submission_budget_exhausted|1|set|0|closed");

    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${BUDGET}', true)
    `)).status, "reserved");
    const retried = await pass(objects, transport(posts, RETRY_TASK), Date.now());
    assert.equal(retried.action, "submitted", JSON.stringify(retried));
    assert.equal(posts.count, 1);
    assert.equal(await paid(), "1");
    assert.equal(await attempt(BUDGET), "2");
    assert.equal(await psql(`
      select status || '|' || provider_task_id || '|' || case when resubmit_authorized_at is null then 'closed' else 'open' end
      from public.vibode_furniture_generation_jobs where job_id = '${BUDGET}'
    `), `running|${RETRY_TASK}|closed`);
    assert.match(await events(BUDGET), /consume:submission_committed$/);
    assert.equal((await observe(BUDGET, await follow(BUDGET), "FAILED", "0")).status, "failed");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    await zeroPaidUsed();

    const missingNonce = await toRunning(MISSING, "missing-credit-key", "task-missing-01");
    assert.equal((await observe(MISSING, missingNonce, "FAILED", "null")).error_class, "credit_unreported");
    assert.equal(await psql(`
      select coalesce(consumed_credits::text, 'null')
      from public.vibode_furniture_generation_jobs where job_id = '${MISSING}'
    `), "null");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    assert.equal((await observe(MISSING, await follow(MISSING), "FAILED", "0")).status, "failed");
    assert.equal(await credits(), "0|0");
    await zeroPaidUsed();

    await reserve(INPUT, "input-review-key");
    const inputPrepared = await claimNext();
    assert.equal((await commit(INPUT, String(inputPrepared.claim_nonce))).ok, true);
    await expire(INPUT);
    const inputReconcile = await claimNext();
    await psql(`
      update public.vibode_furniture_generation_jobs
      set provider_contacted_at = now() - interval '2 minutes'
      where job_id = '${INPUT}'
    `);
    assert.equal((await call(`
      select public.mark_vibode_furniture_generation_needs_review(
        '${USER}', '${INPUT}', '${inputReconcile.claim_nonce}', 'list_absent'
      )
    `)).status, "needs_review");
    assert.equal((await call(`
      select public.admin_authorize_vibode_furniture_generation_resubmit('${INPUT}', true)
    `)).status, "reserved");
    const inputPosts = { count: 0 };
    const unreadable = await pass(createMemoryBucketStore(), transport(inputPosts, null), Date.now() + 180_000);
    assert.equal(unreadable.action, "needs_review", JSON.stringify(unreadable));
    assert.equal(inputPosts.count, 0);
    assert.equal(await reviewFacts(INPUT), "needs_review|input_storage_failed|1|set|0|closed");
    assert.equal(await paid(), "1");
    assert.equal(await credits(), "30|0");
    assert.equal(await allowance(USER), "1|0");
    const inputLease = await follow(INPUT);
    assert.equal((await call(`
      select public.bind_vibode_furniture_generation_task(
        '${USER}', '${INPUT}', '${inputLease}', 'task-input-0001', 'FAILED'
      )
    `)).status, "running");
    assert.equal((await observe(INPUT, await follow(INPUT), "FAILED", "0")).status, "failed");
    assert.equal(await credits(), "0|0");
    assert.equal(await allowance(USER), "0|0");
    await zeroPaidUsed();

    const frozen = await callResult(`
      update public.vibode_furniture_generation_resubmit_events
      set reason = 'operator_recovery' where job_id = '${BUDGET}'
    `);
    assert.match(frozen.stderr, /RESUBMIT_EVENT_IMMUTABLE/);
    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false, paid_submissions_authorized = 0, paid_submissions_used = 0,
        credits_reserved = 0, credits_consumed = 0
      where control_id = 'global'
    `);
    assert.equal(await controlFingerprint(), controlsBefore);
    assert.equal(await psql(`
      select credit_ceiling::text || '|' || max_concurrent::text
      from public.vibode_furniture_generation_controls where control_id = 'global'
    `), "40|1");
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function toRunning(jobId: string, key: string, task: string): Promise<string> {
  await reserve(jobId, key);
  const prepared = await claimNext();
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

function transport(posts: { count: number }, task: string | null): MeshyTransport {
  return {
    async request(call: MeshyTransportCall): Promise<MeshyTransportResult> {
      if (call.method === "POST") {
        posts.count += 1;
        if (!task) throw new Error("unexpected_post");
        return { kind: "response", status: 202, headers: {}, body: { result: task }, unparsed: false };
      }
      return { kind: "response", status: 200, headers: {}, body: [], unparsed: false };
    },
  };
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

async function contactedAt(jobId: string): Promise<string> {
  return psql(`
    select provider_contacted_at::text
    from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
  `);
}

async function attempt(jobId: string): Promise<string> {
  return psql(`
    select attempt_count::text from public.vibode_furniture_generation_jobs where job_id = '${jobId}'
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

async function zeroPaidUsed(): Promise<void> {
  assert.equal(await paid(), "1");
  await psql("update public.vibode_furniture_generation_controls set paid_submissions_used = 0 where control_id = 'global'");
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
