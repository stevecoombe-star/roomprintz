/**
 * Read-only AI furniture generation admin dashboard.
 * No database, no provider, and no service-role credential.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { generationEnabledFromEnv } from "@/lib/vibode-furniture/generation/policy";

import {
  ADMIN_BAD_REQUEST,
  ADMIN_JOB_MISSING,
  ADMIN_MISCONFIGURED,
  ADMIN_REQUIRED,
  ADMIN_UNAVAILABLE,
  FURNITURE_GENERATION_WORKER_STATUS,
  adminReadGateway,
  furnitureGenerationJobResponse,
  furnitureGenerationJobsResponse,
  furnitureGenerationOverviewResponse,
  furnitureGenerationTestersResponse,
  parseDashboardOverview,
  parseJobDetail,
  parseSqlOverview,
  parseTesterJobs,
  withProductionStatus,
  type AdminReadName,
} from "./admin-dashboard";

const ROOT = process.cwd();
const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ADMIN_ID = "admin-should-not-leak";

const ROUTES = [
  "app/api/admin/furniture-generation/route.ts",
  "app/api/admin/furniture-generation/testers/route.ts",
  "app/api/admin/furniture-generation/testers/[userId]/jobs/route.ts",
  "app/api/admin/furniture-generation/jobs/[jobId]/route.ts",
];

test("cookie admin routes are read-only and do not observe the worker or call Meshy", () => {
  const dashboard = source("lib/vibode-furniture/generation/admin-dashboard.ts");
  const http = source("app/api/admin/furniture-generation/http.ts");
  const page = source("app/admin/furniture-generation/FurnitureGenerationDashboard.tsx");
  const view = source("app/admin/furniture-generation/FurnitureGenerationDashboardView.tsx");
  const home = source("app/admin/AdminControls.tsx");
  assert.match(home, /href="\/admin\/furniture-generation"/);
  assert.match(home, /AI Furniture Generation/);
  assert.match(home, /Beta Access & Usage Management/);
  assert.match(source("app/api/admin/furniture-generation/route.ts"), /generationEnabledFromEnv\(process\.env\)/);
  assert.doesNotMatch(dashboard, /generationEnabledFromEnv|VIBODE_FURNITURE_GENERATION_WORKER|https:\/\/api\.meshy|process\.env\.MESHY_API_KEY/);
  assert.doesNotMatch(`${dashboard}\n${http}\n${page}\n${view}`, /reserve_vibode|admin_authorize_vibode|grant_vibode|commit_vibode|claim_vibode|resolve_vibode/);
  assert.doesNotMatch(`${page}\n${view}`, /getServiceRoleSupabaseClient|MESHY_API_KEY|api\.meshy\.ai|method:\s*"POST"/);
  assert.match(page, /method:\s*"GET"/);
  assert.match(source("lib/adminServer.ts"), /if \(!isAdminEmail\(data\.user\.email\)\) return null/);
  for (const route of ROUTES) {
    const body = source(route);
    const handlerStart = body.indexOf("export async function GET");
    const nextHandler = body.indexOf("export async function ", handlerStart + 1);
    const handler = body.slice(handlerStart, nextHandler === -1 ? undefined : nextHandler);
    assert.match(body, /export async function GET/);
    if (route.endsWith("testers/route.ts")) {
      assert.match(body, /export async function POST/);
      assert.doesNotMatch(body, /export async function (PUT|PATCH|DELETE)/);
      const post = body.slice(body.indexOf("export async function POST"));
      assert.ok(post.indexOf("getAuthenticatedAdminUser") < post.indexOf("furnitureGenerationWriteClient"));
      assert.doesNotMatch(post, /authorization|bearer|getFurnitureGenerationOperator|adminId/i);
    } else {
      assert.doesNotMatch(body, /export async function (POST|PUT|PATCH|DELETE)/);
    }
    assert.match(handler, /getAuthenticatedAdminUser/);
    assert.ok(handler.indexOf("getAuthenticatedAdminUser") < handler.indexOf("furnitureGenerationServiceClient"));
    assert.doesNotMatch(handler, /authorization|bearer|getFurnitureGenerationOperator|adminId/i);
  }
  const testerUpdate = source("app/api/admin/furniture-generation/testers/[userId]/route.ts");
  assert.match(testerUpdate, /export async function PATCH/);
  assert.doesNotMatch(testerUpdate, /export async function (GET|POST|PUT|DELETE)/);
  assert.ok(testerUpdate.indexOf("getAuthenticatedAdminUser") < testerUpdate.indexOf("furnitureGenerationWriteClient"));
  assert.doesNotMatch(testerUpdate, /authorization|bearer|getFurnitureGenerationOperator|adminId|live_enabled|credit_ceiling|paid_submissions/i);
  assert.equal(generationEnabledFromEnv({}), false);
  assert.equal(generationEnabledFromEnv({ VIBODE_MESHY_GENERATION_ENABLED: "TRUE" }), false);
  assert.equal(generationEnabledFromEnv({
    VIBODE_MESHY_GENERATION_ENABLED: "true",
    VIBODE_FURNITURE_GENERATION_WORKER_ENABLED: "true",
  }), true);
});

test("unauthenticated and non-admin requests stop before the database", async () => {
  for (const admin of [null, undefined, "signed-in-user"]) {
    const harness = fakeClient();
    const response = await furnitureGenerationOverviewResponse({
      ...harness.deps,
      getAdmin: async () => admin,
      generationAdmissionEnabled: true,
    });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: ADMIN_REQUIRED });
    assert.equal(harness.serviceReads(), 0);
    assert.deepEqual(harness.calls, []);
  }
});

test("an authorized read keeps credits, generations, admission, and worker state apart", async () => {
  const harness = fakeClient({
    data: overviewSql({
      live_enabled: true,
      generation_admission_enabled: false,
      worker_configuration: "Railway worker enabled",
      consumed_generations: 6,
      credits_consumed: 20,
    }),
  });
  const response = await furnitureGenerationOverviewResponse({
    ...harness.deps,
    generationAdmissionEnabled: false,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(harness.calls, [{ fn: "read_vibode_furniture_generation_admin_overview", args: undefined }]);
  assert.equal(response.body.liveEnabled, true);
  assert.equal(response.body.generationAdmissionEnabled, false);
  assert.equal(response.body.consumedGenerations, 6);
  assert.equal(response.body.creditsConsumed, 20);
  assert.equal(response.body.workerConfiguration, FURNITURE_GENERATION_WORKER_STATUS);
  assert.equal(JSON.stringify(response.body).includes(ADMIN_ID), false);
  assert.equal(JSON.stringify(response.body).includes("Railway"), false);
  const admitted = withProductionStatus(parseSqlOverview(overviewSql({ live_enabled: false }))!, true);
  assert.equal(admitted.liveEnabled, false);
  assert.equal(admitted.generationAdmissionEnabled, true);
  assert.equal(admitted.workerConfiguration, FURNITURE_GENERATION_WORKER_STATUS);
});

test("database failures and private paths are not returned to the browser", async () => {
  const leaked = fakeClient({ error: "users/hidden/candidate.glb MESHY_API_KEY" });
  const failed = await furnitureGenerationOverviewResponse({
    ...leaked.deps,
    generationAdmissionEnabled: false,
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: ADMIN_UNAVAILABLE });
  assert.equal(JSON.stringify(failed.body).includes("users/hidden"), false);

  const missing = fakeClient({ service: false });
  const unavailable = await furnitureGenerationTestersResponse(missing.deps, new URLSearchParams());
  assert.equal(unavailable.status, 500);
  assert.deepEqual(unavailable.body, { error: ADMIN_MISCONFIGURED });
  assert.equal(missing.serviceReads(), 1);

  const poisoned = parseSqlOverview(overviewSql({
    historical_jobs: [jobSql({
      output_object_path: "users/hidden/candidate.glb",
      error_class: "users/hidden/candidate.glb",
      profile: {
        ...jobSql().profile,
        texturePrompt: "HIDDEN_TEXTURE_PROMPT",
        storage_object_path: "users/hidden/candidate.glb",
      },
    })],
    historical_jobs_without_allowance: 1,
  }));
  assert.ok(poisoned);
  assert.equal(poisoned.historicalJobs[0]?.allowanceState, null);
  assert.equal(poisoned.historicalJobs[0]?.errorClass, null);
  assert.equal(JSON.stringify(poisoned).includes("HIDDEN_TEXTURE_PROMPT"), false);
  assert.equal(JSON.stringify(poisoned).includes("candidate.glb"), false);
  const detail = parseJobDetail({
    ok: true,
    job: jobSql({ allowance_state: null }),
    allowance_events: [],
    resubmit_events: [
      event("operator_recovery"),
      event("submission_budget_exhausted"),
      event("submission_committed"),
    ],
    credit_resolution: {
      job_id: JOB,
      provider_status: "FAILED",
      consumed_credits: 12,
      reason: "operator recorded provider invoice",
      evidence_ref: "users/hidden/evidence.bin",
      created_at: "2026-11-05T00:00:00.000Z",
    },
  });
  assert.ok(detail);
  assert.deepEqual(detail.resubmitEvents.map((item) => item.reason), [
    "operator_recovery",
    "submission_budget_exhausted",
    "submission_committed",
  ]);
  assert.equal(JSON.stringify(detail).includes("evidence.bin"), false);
});

test("invalid pages and unknown accounts do not reach the database", async () => {
  const harness = fakeClient();
  const badPage = await furnitureGenerationTestersResponse(harness.deps, new URLSearchParams("limit=0"));
  assert.equal(badPage.status, 400);
  assert.deepEqual(badPage.body, { error: ADMIN_BAD_REQUEST });
  const badAccount = await furnitureGenerationJobsResponse(harness.deps, "not-a-user", new URLSearchParams());
  assert.equal(badAccount.status, 400);
  const badJob = await furnitureGenerationJobResponse(harness.deps, "not-a-job");
  assert.equal(badJob.status, 400);
  assert.equal(harness.serviceReads(), 0);

  const wide = fakeClient();
  const page = await furnitureGenerationTestersResponse(wide.deps, new URLSearchParams("limit=1000&offset=0&q=%25"));
  assert.equal(page.status, 200);
  assert.equal(wide.calls[0]?.args?.p_limit, 50);
  assert.equal(wide.calls[0]?.args?.p_query, "%");
  assert.equal(wide.calls[0]?.args?.admin_id, undefined);

  const missing = fakeClient({ data: { ok: false, code: "not_found" } });
  const response = await furnitureGenerationJobResponse(missing.deps, JOB);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: ADMIN_JOB_MISSING });
});

test("mismatched counters and a write function are refused", async () => {
  const mismatched = fakeClient({
    data: overviewSql({ remaining_generations: 99, consumed_generations: 6, credits_consumed: 6 }),
  });
  const response = await furnitureGenerationOverviewResponse({
    ...mismatched.deps,
    generationAdmissionEnabled: false,
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.consumedGenerations, undefined);

  let calls = 0;
  const gateway = adminReadGateway({
    rpc: async () => {
      calls += 1;
      return { data: { ok: true }, error: null };
    },
  });
  const refused = await gateway!.rpc("reserve_vibode_furniture_generation" as AdminReadName, {});
  const refusedApproval = await gateway!.rpc("admin_approve_vibode_furniture_generation_tester" as AdminReadName, {});
  assert.equal(calls, 0);
  assert.equal(refused.error?.message, "rpc_failed");
  assert.equal(refusedApproval.error?.message, "rpc_failed");
  const jobs = parseTesterJobs({
    ok: true,
    user_id: USER,
    email: null,
    approved: false,
    total: 1,
    limit: 25,
    offset: 0,
    jobs: [jobSql({ allowance_state: null, user_id: USER })],
    allowance_events: [],
    resubmit_events: [],
    credit_resolutions: [],
  });
  assert.equal(jobs?.approved, false);
  assert.equal(jobs?.jobs[0]?.allowanceState, null);
  const parsed = parseDashboardOverview({
    ...overviewSql(),
    generationAdmissionEnabled: true,
    workerConfiguration: "Worker configuration: enabled",
  });
  assert.equal(parsed, null);
});

function fakeClient(options?: { data?: unknown; error?: string; service?: boolean }) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  let serviceReads = 0;
  const deps = {
    getAdmin: async () => ({ id: ADMIN_ID }),
    getServiceClient: () => {
      serviceReads += 1;
      if (options?.service === false) return null;
      return {
        rpc: async (fn: AdminReadName, args?: Record<string, unknown>) => {
          calls.push({ fn, args });
          if (options?.error) return { data: null, error: { message: options.error } };
          return { data: options?.data ?? testerSql(), error: null };
        },
      };
    },
  };
  return { deps, calls, serviceReads: () => serviceReads };
}

function overviewSql(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    approved_accounts: 2,
    enabled_accounts: 1,
    authorized_generations: 15,
    reserved_generations: 1,
    consumed_generations: 6,
    remaining_generations: 8,
    paid_submissions_authorized: 1,
    paid_submissions_used: 1,
    confirmed_provider_tasks: 4,
    usable_candidates: 0,
    permanently_saved_models: 1,
    provider_failures: 1,
    credits_reserved: 30,
    credits_consumed: 20,
    credit_ceiling: 40,
    remaining_credit_budget: -10,
    unresolved_provider_credit_exposure: 30,
    live_enabled: false,
    max_concurrent: 1,
    deleted_account_audit_events: 0,
    deleted_account_audits: [],
    historical_jobs_without_allowance: 0,
    historical_jobs: [],
    ...overrides,
  };
}

function testerSql() {
  return { ok: true, total: 0, limit: 50, offset: 0, testers: [] };
}

function jobSql(overrides?: Record<string, unknown>) {
  return {
    job_id: JOB,
    user_id: USER,
    created_at: "2026-11-05T00:00:00.000Z",
    status: "saved",
    operation: "image-to-3d",
    ai_model: "meshy-7.1",
    image_slots: ["front"],
    allowance_state: null,
    reserved_credits: 30,
    consumed_credits: 30,
    quota_state: "reconciled",
    error_class: null,
    provider_status: "SUCCEEDED",
    provider_task_confirmed: true,
    provider_credit_review: "reported",
    saved_asset_status: "permanently_saved",
    unresolved: false,
    profile: {
      operation: "image-to-3d",
      ai_model: "meshy-7.1",
      geometry_resolution: "standard",
      should_texture: true,
      texture_model: "meshy-7",
      texture_resolution: "2k",
      enable_pbr: false,
      image_enhancement: true,
      should_remesh: false,
      topology: "triangle",
      target_polycount: 30000,
    },
    ...overrides,
  };
}

function event(reason: string) {
  return {
    event_id: reason === "operator_recovery"
      ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
      : reason === "submission_budget_exhausted"
        ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
        : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    action: reason === "operator_recovery" ? "authorize" : reason === "submission_budget_exhausted" ? "revoke" : "consume",
    reason,
    job_id: JOB,
    created_at: "2026-11-05T00:00:00.000Z",
  };
}

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
