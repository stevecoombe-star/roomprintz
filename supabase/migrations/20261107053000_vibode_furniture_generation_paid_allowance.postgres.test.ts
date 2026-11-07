/**
 * Disposable Postgres proof of the paid-submission allowance.
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
  getFurnitureGenerationOperator,
  postFurnitureGeneration,
  postFurnitureGenerationAllowance,
  postFurnitureGenerationDiscard,
} from "@/lib/vibode-furniture/generation/http";
import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import type { MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import { createMemoryBucketStore } from "@/lib/vibode-furniture/generation/objects";
import { executeFurnitureGenerationClaim } from "@/lib/vibode-furniture/generation/pipeline";
import {
  createSqlGenerationCommands,
  type GenerationRpcName,
} from "@/lib/vibode-furniture/generation/sql-commands";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

const CONTAINER = "vibode-furniture-1c2b-pg";
const DATABASE = "furniture1c2b";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "018a210d-8ba4-705c-b111-1f1776f7f578";
const GLB_URL = `https://assets.meshy.ai/tasks/${TASK_ID}/model.glb?Expires=9999999999`;

test("one paid submission is durable and a second submission stays closed", { timeout: 180_000 }, async () => {
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
    const allowance = readFileSync(path.join(process.cwd(), "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql"), "utf8");
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
    await psql(allowance);
    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);
    assert.equal(await psql(`
      select has_function_privilege('authenticated', 'public.grant_vibode_furniture_generation_paid_submission(boolean)', 'execute')::text
        || ':' || has_function_privilege('service_role', 'public.grant_vibode_furniture_generation_paid_submission(boolean)', 'execute')::text
        || ':' || has_function_privilege('authenticated', 'public.read_vibode_furniture_generation_operator(uuid)', 'execute')::text
        || ':' || has_table_privilege('service_role', 'public.vibode_furniture_generation_controls', 'update')::text
        || ':' || has_table_privilege('authenticated', 'public.vibode_furniture_generation_jobs', 'select')::text
    `), "false:true:false:false:false");
    assert.equal(await psql(`
      select paid_submissions_authorized::text || ':' || paid_submissions_used::text || ':' || credit_ceiling::text || ':' || max_concurrent::text
      from public.vibode_furniture_generation_controls
      where control_id = 'global'
    `), "0:0:40:1");
    const raised = await psqlResult(`
      update public.vibode_furniture_generation_controls
      set paid_submissions_authorized = 2
      where control_id = 'global'
    `);
    assert.notEqual(raised.code, 0);
    assert.match(`${raised.stderr}`, /paid_authorized_range/);

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
    const owner: GenerationHttpDeps = {
      ...deps,
      authorize: async () => ({ ok: true, userId: USER_A, email: "person@example.com" }),
    };
    const bytes = new Uint8Array(await sharp({
      create: { width: 48, height: 48, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer());
    const settings = { ...defaultFurnitureGeneratorSettings(), shouldTexture: false };
    const create = (target: GenerationHttpDeps, key: string) => postFurnitureGeneration(new Request("https://vibode.local/generation", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: key,
        settings,
        images: [{ slot: "front", base64: Buffer.from(bytes).toString("base64") }],
      }),
    }), target);
    const allowanceRequest = (body: unknown) => new Request("https://vibode.local/allowance", {
      method: "POST",
      body: JSON.stringify(body),
    });

    await psql(`update public.vibode_furniture_generation_controls set live_enabled = true where control_id = 'global'`);
    const created = await create(deps, "idem-key-0001");
    assert.equal(created.status, 200);
    const jobId = (created.body as { job: { jobId: string } }).job.jobId;
    const blocked = scripted([response(202, { result: TASK_ID })]);
    assert.equal((await pass(deps, blocked)).action, "submission_not_authorized");
    assert.equal(blocked.posts(), 0);
    assert.equal(await counters(), "0:0");
    assert.equal(await psql(`select status || ':' || attempt_count::text from public.vibode_furniture_generation_jobs`), "reserved:0");

    assert.equal((await postFurnitureGenerationAllowance(allowanceRequest({ paidSubmissionAuthorized: true }), owner)).status, 401);
    assert.equal((await postFurnitureGenerationAllowance(allowanceRequest({}), deps)).status, 409);
    assert.equal((await postFurnitureGenerationAllowance(allowanceRequest({ duplicateChargeRiskAccepted: true }), deps)).status, 400);
    assert.equal(await counters(), "0:0");
    const granted = await postFurnitureGenerationAllowance(allowanceRequest({ paidSubmissionAuthorized: true }), deps);
    assert.equal(granted.status, 200);
    assert.equal((granted.body as { maxEstimatedCredits: number }).maxEstimatedCredits, 40);
    assert.equal((await postFurnitureGenerationAllowance(allowanceRequest({ paidSubmissionAuthorized: true }), deps)).status, 409);
    assert.equal(await counters(), "1:0");

    const limited = scripted([response(429, { message: "Too Many Requests" })]);
    assert.equal((await pass(deps, limited)).action, "rate_limited");
    assert.equal(limited.posts(), 1);
    assert.equal(await counters(), "1:0");
    assert.equal(await psql(`select status from public.vibode_furniture_generation_jobs`), "reserved");

    const provider = scripted([
      response(202, { result: TASK_ID }),
      response(200, {
        id: TASK_ID,
        status: "SUCCEEDED",
        progress: 100,
        consumed_credits: 20,
        expires_at: Date.now() + 86_400_000,
        model_urls: { glb: GLB_URL },
      }),
    ]);
    assert.equal((await pass(deps, provider)).action, "submitted");
    assert.equal(await counters(), "1:1");
    assert.equal((await pass(deps, provider)).action, "ready");
    assert.equal(provider.posts(), 1);
    assert.equal(await counters(), "1:1");
    assert.equal(await psql(`
      select j.consumed_credits::text || ':' || j.provider_status || ':' || c.credits_consumed::text
      from public.vibode_furniture_generation_jobs j
      cross join public.vibode_furniture_generation_controls c
    `), "20:SUCCEEDED:20");

    const operator = await getFurnitureGenerationOperator(new Request("https://vibode.local/operator"), deps, jobId);
    const operatorText = JSON.stringify(operator.body);
    assert.equal(operator.status, 200);
    assert.equal((operator.body as { job: { providerStatus: string; consumedCredits: number; status: string } }).job.providerStatus, "SUCCEEDED");
    assert.equal((operator.body as { job: { consumedCredits: number } }).job.consumedCredits, 20);
    assert.equal((operator.body as { allowance: { paidSubmissionsUsed: number } }).allowance.paidSubmissionsUsed, 1);
    assert.equal(operatorText.includes(TASK_ID), false);
    assert.equal(operatorText.includes("http"), false);
    assert.equal(operatorText.includes("data:image"), false);
    assert.equal(operatorText.includes(Buffer.from(bytes).toString("base64").slice(0, 24)), false);
    const ownerView = await getFurnitureGeneration(new Request("https://vibode.local/generation"), deps, jobId);
    const ownerText = JSON.stringify(ownerView.body);
    assert.equal(ownerText.includes("SUCCEEDED"), false);
    assert.equal(ownerText.includes(TASK_ID), false);
    assert.equal((await getFurnitureGenerationOperator(new Request("https://vibode.local/operator"), owner, jobId)).status, 401);

    const restarted = createSqlGenerationCommands(rpc);
    const reread = await restarted.readOperator(jobId);
    assert.equal(reread.ok, true);
    if (reread.ok) {
      assert.equal(reread.job.paidSubmissionsAuthorized, 1);
      assert.equal(reread.job.paidSubmissionsUsed, 1);
      assert.equal(reread.job.consumedCredits, 20);
    }
    const discarded = await postFurnitureGenerationDiscard(
      new Request("https://vibode.local/discard", { method: "POST", body: "{}" }),
      deps,
      jobId,
    );
    assert.equal(discarded.status, 200);
    assert.equal(await counters(), "1:1");
    assert.equal(await psql(`
      select j.consumed_credits::text || ':' || c.credits_consumed::text
      from public.vibode_furniture_generation_jobs j
      cross join public.vibode_furniture_generation_controls c
      where j.job_id = '${jobId}'
    `), "20:20");

    const second = await create(deps, "idem-key-0002");
    assert.equal(second.status, 200);
    const denied = scripted([response(202, { result: "018a210d-8ba4-705c-b111-1f1776f7f580" })]);
    assert.equal((await pass(deps, denied)).action, "submission_not_authorized");
    assert.equal(denied.posts(), 0);
    assert.equal(await counters(), "1:1");
    assert.equal(await psql(`
      select count(*) from public.vibode_furniture_generation_jobs where status = 'reserved' and attempt_count = 0
    `), "1");
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

async function counters(): Promise<string> {
  return psql(`
    select paid_submissions_authorized::text || ':' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls
    where control_id = 'global'
  `);
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
  const result = await psqlResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function psqlResult(sql: string): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
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
