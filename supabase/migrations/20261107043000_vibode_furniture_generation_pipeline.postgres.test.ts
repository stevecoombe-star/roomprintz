/**
 * Disposable Postgres dry run of the generation pipeline.
 * Docker is required. The provider transport is scripted. This test does
 * not connect to hosted Supabase and does not call Meshy.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { encodeUntexturedFurnitureProbeGlb } from "@/lib/afc-v2-runtime/textured-furniture-probe-glb";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import type { GenerationHttpDeps } from "@/lib/vibode-furniture/generation/http";
import {
  getFurnitureGeneration,
  postFurnitureGeneration,
  postFurnitureGenerationDiscard,
  postFurnitureGenerationPreview,
  postFurnitureGenerationRecovery,
} from "@/lib/vibode-furniture/generation/http";
import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import type { MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import { createMemoryBucketStore, generationObjectAllowed } from "@/lib/vibode-furniture/generation/objects";
import {
  cleanupTemporaryGenerationObjects,
  executeFurnitureGenerationClaim,
} from "@/lib/vibode-furniture/generation/pipeline";
import {
  createSqlGenerationCommands,
  type GenerationRpcName,
} from "@/lib/vibode-furniture/generation/sql-commands";
import { PERSONAL_FURNITURE_BUCKET } from "@/lib/vibode-furniture/asset-id";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

const CONTAINER = "vibode-furniture-1c2a-pg";
const DATABASE = "furniture1c2a";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "018a210d-8ba4-705c-b111-1f1776f7f578";
const GLB_URL = `https://assets.meshy.ai/tasks/${TASK_ID}/model.glb?Expires=9999999999`;

test("the generation pipeline reserves, previews, and recovers on disposable postgres", { timeout: 180_000 }, async () => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live_fetch_refused");
  };
  await removeContainer();
  try {
    await startPostgres();
    const foundation = readFileSync(path.join(process.cwd(), "supabase/migrations/20261106234500_vibode_furniture_generation.sql"), "utf8");
    const pipeline = readFileSync(path.join(process.cwd(), "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql"), "utf8");
    assert.doesNotMatch(pipeline, /insert into public\.vibode_furniture_assets/);
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
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
    await psql(foundation);
    await psql(pipeline);
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.equal(await psql(`
      select has_function_privilege('authenticated', 'public.claim_next_vibode_furniture_generation(boolean)', 'execute')::text
        || ':' || has_function_privilege('authenticated', 'public.admin_authorize_vibode_furniture_generation_resubmit(uuid,boolean)', 'execute')::text
        || ':' || has_function_privilege('service_role', 'public.admin_authorize_vibode_furniture_generation_resubmit(uuid,boolean)', 'execute')::text
    `), "false:false:true");
    assert.equal(await psql(`select to_regclass('public.vibode_furniture_assets') is null`), "t");

    const commands = createSqlGenerationCommands(rpc);
    const objects = createMemoryBucketStore();
    let nextId = 0;
    const deps: GenerationHttpDeps = {
      authorize: async () => ({ ok: true, userId: USER_A, email: "admin@example.com" }),
      commands,
      objects,
      env: { VIBODE_MESHY_GENERATION_ENABLED: "true" },
      isAdmin: (email) => email === "admin@example.com",
      nowMs: () => Date.now(),
      newJobId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${(nextId++).toString(16).padStart(12, "0")}`,
    };
    const signedOut: GenerationHttpDeps = {
      ...deps,
      authorize: async () => ({ ok: false, response: { status: 401, body: { ok: false, error: "Unauthorized." } } }),
    };
    const otherUser: GenerationHttpDeps = {
      ...deps,
      authorize: async () => ({ ok: true, userId: USER_B, email: "person@example.com" }),
    };
    const bytes = new Uint8Array(await sharp({
      create: { width: 48, height: 48, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer());
    const settings = { ...defaultFurnitureGeneratorSettings(), shouldTexture: false };
    const create = (key: string) => postFurnitureGeneration(new Request("https://vibode.local/generation", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: key,
        settings,
        images: [{ slot: "front", base64: Buffer.from(bytes).toString("base64") }],
      }),
    }), deps);

    const denied = await create("idem-key-0001");
    assert.equal(denied.status, 403);
    assert.equal(await psql(`select count(*) from public.vibode_furniture_generation_jobs`), "0");
    await psql(`update public.vibode_furniture_generation_controls set live_enabled = true where control_id = 'global'`);
    const unauthorized = await postFurnitureGeneration(new Request("https://vibode.local/generation", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "idem-key-0001",
        settings,
        images: [{ slot: "front", base64: Buffer.from(bytes).toString("base64") }],
      }),
    }), signedOut);
    assert.equal(unauthorized.status, 401);
    assert.equal(await psql(`select count(*) from public.vibode_furniture_generation_jobs`), "0");
    const tiny = new Uint8Array(await sharp({
      create: { width: 8, height: 48, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).png().toBuffer());
    const invalid = await postFurnitureGeneration(new Request("https://vibode.local/generation", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "idem-key-0009",
        settings,
        images: [{ slot: "front", base64: Buffer.from(tiny).toString("base64") }],
      }),
    }), deps);
    assert.equal(invalid.status, 400);

    const crash = await create("idem-key-0001");
    assert.equal(crash.status, 200);
    const crashId = (crash.body as { job: { jobId: string } }).job.jobId;
    const claimed = await commands.claimNext(true, Date.now());
    assert.equal(claimed.ok && claimed.outcome, "claimed");
    const quiet = scripted([]);
    const idle = await pass(deps, quiet);
    assert.equal(idle.action, "idle");
    assert.equal(quiet.posts(), 0);
    await psql(`update public.vibode_furniture_generation_jobs set claim_expires_at = now() - interval '1 second' where job_id = '${crashId}'`);
    const reconcile = scripted([list([])]);
    const waiting = await pass(deps, reconcile);
    assert.notEqual(waiting.action, "submitted");
    assert.equal(reconcile.posts(), 0);
    assert.equal(await psql(`select status from public.vibode_furniture_generation_jobs where job_id = '${crashId}'`), "ambiguous");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'failed', quota_state = 'released', consumed_credits = 0,
        claim_nonce = null, claim_expires_at = null, error_class = 'provider_failed'
      where job_id = '${crashId}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0, credits_consumed = 0
      where control_id = 'global';
    `);

    const created = await create("idem-key-0002");
    assert.equal(created.status, 200);
    const jobId = (created.body as { job: { jobId: string } }).job.jobId;
    const replay = await create("idem-key-0002");
    assert.equal((replay.body as { created: boolean }).created, false);
    const success = scripted([response(202, { result: TASK_ID }), succeeded(20)]);
    assert.equal((await pass(deps, success)).action, "submitted");
    assert.equal((await pass(deps, success)).action, "ready");
    assert.equal(success.posts(), 1);
    const preview = await postFurnitureGenerationPreview(new Request("https://vibode.local/preview", { method: "POST" }), deps, jobId);
    assert.equal(preview.status, 200);
    const hidden = await getFurnitureGeneration(new Request("https://vibode.local/status"), otherUser, jobId);
    assert.equal(hidden.status, 404);
    const hiddenPreview = await postFurnitureGenerationPreview(
      new Request("https://vibode.local/preview", { method: "POST" }),
      otherUser,
      jobId,
    );
    assert.equal(hiddenPreview.status, 404);
    const busy = await create("idem-key-0003");
    assert.equal(busy.status, 409);
    await psql(`
      update public.vibode_furniture_generation_inputs
      set expires_at = now() - interval '1 minute'
      where job_id = '${jobId}'
    `);
    const inputCleanup = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: Date.now() });
    assert.equal(inputCleanup.removed, 1);
    assert.equal(await psql(`select status from public.vibode_furniture_generation_jobs where job_id = '${jobId}'`), "ready");
    const discarded = await postFurnitureGenerationDiscard(
      new Request("https://vibode.local/discard", {
        method: "POST",
        body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
      }),
      deps,
      jobId,
    );
    assert.equal(discarded.status, 200);
    assert.equal((discarded.body as { providerCreditsRefunded: boolean }).providerCreditsRefunded, false);
    const candidateCleanup = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: Date.now() });
    assert.equal(candidateCleanup.removed, 1);
    assert.equal(await objects.get({
      bucket: PERSONAL_FURNITURE_BUCKET,
      path: `users/${USER_A}/generations/${jobId}/candidate.glb`,
    }), null);
    assert.equal(generationObjectAllowed(
      PERSONAL_FURNITURE_BUCKET,
      `users/${USER_A}/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/model.glb`,
      USER_A,
    ), false);
    assert.equal(await psql(`select credits_consumed::text from public.vibode_furniture_generation_controls`), "20");

    const failed = await create("idem-key-0004");
    assert.equal(failed.status, 200);
    const failedId = (failed.body as { job: { jobId: string } }).job.jobId;
    const failure = scripted([
      response(202, { result: "018a210d-8ba4-705c-b111-1f1776f7f580" }),
      response(200, {
        id: "018a210d-8ba4-705c-b111-1f1776f7f580",
        status: "FAILED",
        progress: 0,
        consumed_credits: 0,
      }),
    ]);
    assert.equal((await pass(deps, failure)).action, "submitted");
    assert.equal((await pass(deps, failure)).action, "failed");
    assert.equal(await psql(`select status from public.vibode_furniture_generation_jobs where job_id = '${failedId}'`), "failed");

    const ambiguous = await create("idem-key-0005");
    assert.equal(ambiguous.status, 200);
    const ambiguousId = (ambiguous.body as { job: { jobId: string } }).job.jobId;
    const review = scripted([{ kind: "timeout" }, list([]), list([])]);
    assert.equal((await pass(deps, review)).action, "ambiguous");
    assert.equal((await pass(deps, review)).action, "waiting");
    assert.equal(review.posts(), 1);
    const occupied = await create("idem-key-0006");
    assert.equal(occupied.status, 409);
    await psql(`update public.vibode_furniture_generation_jobs set provider_contacted_at = now() - interval '2 minutes' where job_id = '${ambiguousId}'`);
    assert.equal((await pass(deps, review)).action, "needs_review");
    assert.equal(review.posts(), 1);
    const owner = await postFurnitureGenerationRecovery(
      new Request("https://vibode.local/recover", {
        method: "POST",
        body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
      }),
      { ...deps, isAdmin: () => false },
      ambiguousId,
    );
    assert.equal(owner.status, 401);
    const recovered = await postFurnitureGenerationRecovery(
      new Request("https://vibode.local/recover", {
        method: "POST",
        body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
      }),
      deps,
      ambiguousId,
    );
    assert.equal(recovered.status, 200);
    const second = scripted([
      response(202, { result: "018a210d-8ba4-705c-b111-1f1776f7f579" }),
      succeeded(20, "018a210d-8ba4-705c-b111-1f1776f7f579"),
    ]);
    assert.equal((await pass(deps, second)).action, "submitted");
    assert.equal(second.posts(), 1);
    assert.equal((await pass(deps, second)).action, "ready");
    await postFurnitureGenerationDiscard(new Request("https://vibode.local/discard", { method: "POST" }), deps, ambiguousId);
    const exhausted = await create("idem-key-0007");
    assert.equal(exhausted.status, 409);
    assert.equal(await psql(`select credits_consumed::text from public.vibode_furniture_generation_controls`), "40");
  } finally {
    globalThis.fetch = previousFetch;
    await removeContainer();
  }
});

function scripted(results: readonly MeshyTransportResult[]) {
  const calls: { method: string }[] = [];
  return {
    adapter: createMeshyAdapter({
      async request(call) {
        calls.push(call);
        const next = results[calls.length - 1];
        if (!next) throw new Error("unexpected_provider_call");
        return next;
      },
    }),
    posts: () => calls.filter((call) => call.method === "POST").length,
  };
}

function response(status: number, body: unknown): MeshyTransportResult {
  return { kind: "response", status, headers: {}, body, unparsed: false };
}

function list(body: unknown[]): MeshyTransportResult {
  return response(200, body);
}

function succeeded(credits: number, id = TASK_ID): MeshyTransportResult {
  return response(200, {
    id,
    status: "SUCCEEDED",
    progress: 100,
    consumed_credits: credits,
    expires_at: Date.now() + 86_400_000,
    model_urls: { glb: GLB_URL.replace(TASK_ID, id) },
  });
}

async function pass(deps: GenerationHttpDeps, provider: ReturnType<typeof scripted>) {
  const glb = encodeUntexturedFurnitureProbeGlb();
  return executeFurnitureGenerationClaim({
    commands: deps.commands,
    objects: deps.objects,
    adapter: provider.adapter,
    download: async () => ({ kind: "ok", status: 200, body: glb, contentLength: glb.byteLength }),
    validate: validatePersonalFurnitureGlb,
    nowMs: Date.now(),
    submitAllowed: true,
  });
}

async function rpc(fn: GenerationRpcName, values: readonly unknown[]): Promise<unknown> {
  const args = values.map(sqlLiteral).join(", ");
  return JSON.parse(await psqlAs("service_role", `select public.${fn}(${args})::text`));
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
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlAs(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql as ${user} failed\n${result.stderr}\n${result.stdout}`);
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
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1"]);
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
