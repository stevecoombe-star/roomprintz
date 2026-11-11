/**
 * Beta tester approval and allowance changes.
 * No database, no provider, and no service-role credential.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ADMIN_BAD_REQUEST,
  ADMIN_MISCONFIGURED,
  ADMIN_REQUIRED,
  ADMIN_UNAVAILABLE,
  adminReadGateway,
  parseTesterJobs,
  type AdminReadName,
} from "./admin-dashboard";
import {
  ADMIN_ACCOUNT_MISSING,
  ADMIN_ALREADY_APPROVED,
  ADMIN_ALLOWANCE,
  ADMIN_CONFLICT,
  ADMIN_CONFIRM,
  ADMIN_OBLIGATION,
  ADMIN_ORIGIN,
  adminMutationOriginAllowed,
  adminWriteGateway,
  furnitureGenerationApproveResponse,
  furnitureGenerationUpdateResponse,
  parseTesterMutation,
  type AdminWriteName,
} from "./admin-tester";

const ACTOR = "55555555-5555-4555-8555-555555555555";
const TARGET = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "http://localhost:3467";

test("approval uses the session actor and rejects missing authority", async () => {
  const harness = fakeClient();
  const denied = await furnitureGenerationApproveResponse(harness.deps(null), request("POST", validApproval({
    actorUserId: TARGET,
  })));
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: ADMIN_REQUIRED });
  assert.equal(harness.calls.length, 0);

  const ordinary = await furnitureGenerationApproveResponse(harness.deps("signed-in-user"), request("POST", validApproval()));
  assert.equal(ordinary.status, 403);
  assert.equal(harness.calls.length, 0);

  const saved = await furnitureGenerationApproveResponse(harness.deps({ id: ACTOR, email: "operator@example.com" }), request("POST", validApproval({
    actorUserId: TARGET,
    userId: TARGET,
  })));
  assert.equal(saved.status, 200);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]?.fn, "admin_approve_vibode_furniture_generation_tester");
  assert.equal(harness.calls[0]?.args.p_actor_user_id, ACTOR);
  assert.equal(harness.calls[0]?.args.p_email, "ada@example.com");
  assert.equal(harness.calls[0]?.args.p_classification, "individual_beta");
  assert.equal(harness.calls[0]?.args.p_authorized_generations, 3);
  assert.equal(harness.calls[0]?.args.p_enabled, true);
  assert.equal("p_user_id" in (harness.calls[0]?.args ?? {}), false);
  assert.equal("actorUserId" in (harness.calls[0]?.args ?? {}), false);
  assert.deepEqual(saved.body.tester, camelTester());
});

test("tester mutations reject bad origin, confirmation, classification, and allowance before SQL", async () => {
  const harness = fakeClient();
  const admin = harness.deps({ id: ACTOR });
  const crossSite = await furnitureGenerationApproveResponse(admin, request("POST", validApproval(), {
    origin: ORIGIN,
    "sec-fetch-site": "cross-site",
  }));
  assert.equal(crossSite.status, 403);
  assert.deepEqual(crossSite.body, { error: ADMIN_ORIGIN });

  const missingOrigin = await furnitureGenerationApproveResponse(admin, request("POST", validApproval(), {}));
  assert.equal(missingOrigin.status, 403);

  const unconfirmed = await furnitureGenerationApproveResponse(admin, request("POST", validApproval({ confirmed: false })));
  assert.equal(unconfirmed.status, 400);
  assert.deepEqual(unconfirmed.body, { error: ADMIN_CONFIRM });

  for (const classification of ["shared_pool", "partner", ""]) {
    const response = await furnitureGenerationApproveResponse(admin, request("POST", validApproval({ classification })));
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Classification must be Individual Beta or Furniture Partner.");
  }
  for (const authorizedGenerations of [-1, 1.5, 51, "5", "5.0", Number.NaN]) {
    const response = await furnitureGenerationApproveResponse(admin, request("POST", validApproval({ authorizedGenerations })));
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: ADMIN_ALLOWANCE });
  }
  const partner = await furnitureGenerationUpdateResponse(
    admin,
    request("PATCH", validUpdate({ classification: "furniture_partner", authorizedGenerations: 0 })),
    TARGET,
  );
  assert.equal(partner.status, 200);
  assert.equal(harness.calls.at(-1)?.args.p_classification, "furniture_partner");
  assert.equal(harness.calls.at(-1)?.args.p_authorized_generations, 0);
  assert.equal(harness.calls.length, 1);
});

test("updates address the route user and map database refusals without SQL text", async () => {
  const missingAdmin = fakeClient();
  const hidden = await furnitureGenerationUpdateResponse(
    missingAdmin.deps(null),
    request("PATCH", validUpdate(), { origin: "https://evil.example" }),
    "not-a-user",
  );
  assert.equal(hidden.status, 403);
  assert.deepEqual(hidden.body, { error: ADMIN_REQUIRED });
  assert.equal(missingAdmin.calls.length, 0);

  const harness = fakeClient();
  const badId = await furnitureGenerationUpdateResponse(harness.deps({ id: ACTOR }), request("PATCH", validUpdate()), "not-a-user");
  assert.equal(badId.status, 400);
  assert.deepEqual(badId.body, { error: ADMIN_BAD_REQUEST });

  harness.next = { ok: false, code: "not_found", detail: "relation auth.users does not exist" };
  const missing = await furnitureGenerationUpdateResponse(harness.deps({ id: ACTOR }), request("PATCH", validUpdate({ userId: "ignored" })), TARGET.toUpperCase());
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: ADMIN_ACCOUNT_MISSING });
  assert.equal(harness.calls[0]?.args.p_user_id, TARGET);
  assert.equal("p_email" in (harness.calls[0]?.args ?? {}), false);

  const mapped: Array<[string, number, string]> = [
    ["already_approved", 409, ADMIN_ALREADY_APPROVED],
    ["allowance_obligation", 409, ADMIN_OBLIGATION],
    ["conflict", 409, ADMIN_CONFLICT],
    ["email_unavailable", 500, ADMIN_UNAVAILABLE],
    ["surprise_sqlstate", 500, ADMIN_UNAVAILABLE],
  ];
  for (const [code, status, error] of mapped) {
    const client = fakeClient();
    client.next = { ok: false, code, message: "duplicate key value violates constraint" };
    const response = await furnitureGenerationApproveResponse(client.deps({ id: ACTOR }), request("POST", validApproval()));
    assert.equal(response.status, status);
    assert.deepEqual(response.body, { error });
    assert.equal(JSON.stringify(response.body).includes("constraint"), false);
  }

  const broken = fakeClient();
  broken.fail = true;
  const unavailable = await furnitureGenerationApproveResponse(broken.deps({ id: ACTOR }), request("POST", validApproval()));
  assert.equal(unavailable.status, 500);
  assert.deepEqual(unavailable.body, { error: ADMIN_UNAVAILABLE });

  const unconfigured = await furnitureGenerationApproveResponse({
    getAdmin: async () => ({ id: ACTOR }),
    getServiceClient: () => null,
  }, request("POST", validApproval()));
  assert.equal(unconfigured.status, 500);
  assert.deepEqual(unconfigured.body, { error: ADMIN_MISCONFIGURED });
});

test("the write gateway allowlists tester changes and same-origin mutations", async () => {
  let calls = 0;
  const gateway = adminWriteGateway({
    rpc: async () => {
      calls += 1;
      return { data: { ok: true }, error: null };
    },
  });
  const refused = await gateway!.rpc("reserve_vibode_furniture_generation" as AdminWriteName, {});
  const read = await gateway!.rpc("read_vibode_furniture_generation_admin_overview" as AdminWriteName, {});
  assert.equal(calls, 0);
  assert.equal(refused.error?.message, "rpc_failed");
  assert.equal(read.error?.message, "rpc_failed");

  const reads = adminReadGateway({
    rpc: async () => {
      calls += 1;
      return { data: { ok: true }, error: null };
    },
  });
  const hiddenWrite = await reads!.rpc("admin_update_vibode_furniture_generation_tester" as AdminReadName, {});
  assert.equal(calls, 0);
  assert.equal(hiddenWrite.error?.message, "rpc_failed");

  assert.equal(adminMutationOriginAllowed(request("POST", {})), true);
  assert.equal(adminMutationOriginAllowed(new Request(`${ORIGIN}/api/admin/furniture-generation/testers`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  })), true);
  assert.equal(adminMutationOriginAllowed(new Request(`${ORIGIN}/api/admin/furniture-generation/testers`, {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
  })), false);
  assert.equal(parseTesterMutation({ tester: camelTester(), idempotent: true, unchanged: false })?.idempotent, true);
  assert.equal(parseTesterMutation({ ok: false, tester: camelTester(), idempotent: false, unchanged: false }), null);

  const jobs = parseTesterJobs({
    ok: true,
    user_id: TARGET,
    email: null,
    approved: true,
    total: 0,
    limit: 20,
    offset: 0,
    jobs: [],
    allowance_events: [{
      event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
      action: "classify",
      reason: "Partner review",
      actor_kind: "administrator",
      actor_user_id: ACTOR,
      delta_authorized: 0,
      delta_reserved: 0,
      delta_consumed: 0,
      job_id: null,
      created_at: "2026-11-11T00:00:00.000Z",
      classification_before: "individual_beta",
      classification_after: "furniture_partner",
      enabled_before: true,
      enabled_after: true,
    }],
    resubmit_events: [],
    credit_resolutions: [],
  });
  assert.equal(jobs?.allowanceEvents[0]?.classificationBefore, "individual_beta");
  assert.equal(jobs?.allowanceEvents[0]?.classificationAfter, "furniture_partner");
  assert.equal(jobs?.allowanceEvents[0]?.enabledBefore, true);
  assert.equal(jobs?.allowanceEvents[0]?.enabledAfter, true);

  const page = source("app/admin/furniture-generation/FurnitureGenerationDashboard.tsx");
  const view = source("app/admin/furniture-generation/FurnitureGenerationDashboardView.tsx");
  const migration = source("supabase/migrations/20261111170000_vibode_furniture_generation_admin_testers.sql");
  assert.match(page, /\/api\/admin\/furniture-generation\/testers/);
  assert.doesNotMatch(`${page}\n${view}`, /method="post"|Enable generation|Generate furniture|api\.meshy/i);
  assert.doesNotMatch(migration, /api\.meshy|MESHY_API_KEY|live_enabled|credit_ceiling|paid_submissions|vibode_furniture_generation_controls/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('vibode-furniture-generation'\)::bigint\)/);
});

function validApproval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: " Ada@Example.com ",
    classification: "individual_beta",
    authorizedGenerations: 3,
    enabled: true,
    reason: "Approved for the beta",
    confirmed: true,
    ...overrides,
  };
}

function validUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    classification: "individual_beta",
    authorizedGenerations: 4,
    enabled: false,
    reason: "Reduce after review",
    confirmed: true,
    expectedUpdatedAt: "2026-11-11T18:00:00.000Z",
    ...overrides,
  };
}

function request(method: string, body: Record<string, unknown>, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}/api/admin/furniture-generation/testers`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function camelTester(): Record<string, unknown> {
  return {
    userId: TARGET,
    email: "ada@example.com",
    classification: "individual_beta",
    enabled: true,
    authorizedGenerations: 3,
    reservedGenerations: 0,
    consumedGenerations: 0,
    remainingGenerations: 3,
    updatedAt: "2026-11-11T18:00:00.000Z",
  };
}

function fakeClient(): {
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
  next: Record<string, unknown> | null;
  fail: boolean;
  deps: (admin: unknown) => {
    getAdmin: () => Promise<unknown>;
    getServiceClient: () => NonNullable<ReturnType<typeof adminWriteGateway>>;
  };
} {
  const state: {
    calls: Array<{ fn: string; args: Record<string, unknown> }>;
    next: Record<string, unknown> | null;
    fail: boolean;
    deps: (admin: unknown) => {
      getAdmin: () => Promise<unknown>;
      getServiceClient: () => NonNullable<ReturnType<typeof adminWriteGateway>>;
    };
  } = {
    calls: [],
    next: null,
    fail: false,
    deps(admin) {
      return {
        getAdmin: async () => admin,
        getServiceClient: () => adminWriteGateway({
          rpc: async (fn, args) => {
            state.calls.push({ fn, args: { ...(args ?? {}) } });
            if (state.fail) return { data: null, error: { message: "syntax error at or near select" } };
            return {
              data: state.next ?? {
                ok: true,
                idempotent: false,
                unchanged: false,
                tester: {
                  user_id: TARGET,
                  email: "ada@example.com",
                  classification: args?.p_classification,
                  enabled: args?.p_enabled,
                  authorized_generations: args?.p_authorized_generations,
                  reserved_generations: 0,
                  consumed_generations: 0,
                  remaining_generations: args?.p_authorized_generations,
                  updated_at: "2026-11-11T18:00:00.000Z",
                },
              },
              error: null,
            };
          },
        })!,
      };
    },
  };
  return state;
}

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}
