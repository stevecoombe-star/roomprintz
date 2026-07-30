import assert from "node:assert/strict";
import test from "node:test";

import * as routeModule from "./route";
import { createAfcUi2bProposalRunPostHandler } from "./route";

function handler(overrides: Record<string, unknown> = {}) {
  return createAfcUi2bProposalRunPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    run: async () => ({ status: "run_validated" }),
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as never);
}
test("UI2B POST preserves admin, development and feature-gate ordering", async () => {
  for (const [stopAfter, expected] of [["admin", 403], ["environment", 404], ["feature", 404]] as const) {
    const calls: string[] = [];
    const response = await handler({
      getAuthenticatedAdminUser: async () => {
        calls.push("admin");
        return stopAfter === "admin" ? null : { id: "admin" };
      },
      nodeEnv: () => {
        calls.push("environment");
        return stopAfter === "environment" ? "production" : "development";
      },
      isEnabled: () => {
        calls.push("feature");
        return stopAfter !== "feature";
      },
      run: async () => { calls.push("run"); return { status: "run_validated" }; },
    })(new Request("http://test/run", { method: "POST", body: "{}" }));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(calls, stopAfter === "admin"
      ? ["admin"]
      : stopAfter === "environment" ? ["admin", "environment"] : ["admin", "environment", "feature"]);
  }
});
test("UI2B POST bounds JSON, maps safe results and never leaks paths", async () => {
  const contentType = await handler()(new Request("http://test/run", { method: "POST", body: "{}" }));
  assert.equal(contentType.status, 415);
  const refused = await handler({ run: async () => ({ status: "failure", failureCode: "provider_call_not_authorized", geminiFloorProposalCall: false, providerCallCount: 0, proposalReceiptWritten: false }) })(
    new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  );
  assert.equal(refused.status, 403);
  assert.equal((await refused.text()).includes("/Users/"), false);
});
test("UI2B POST synthesized failures retain truthful zero artifact flags", async () => {
  const response = await handler()(new Request("http://test/run", { method: "POST", body: "{}" }));
  const body = await response.json() as { providerCallCount?: unknown; proposalReceiptWritten?: unknown; companionReceiptWritten?: unknown };
  assert.equal(body.providerCallCount, 0);
  assert.equal(body.proposalReceiptWritten, false);
  assert.equal(body.companionReceiptWritten, false);
});
test("UI2B POST accepts JSON charset, bounds bodies, and preserves delegated provider truth", async () => {
  const request = {
    contractVersion: "afc-ui2b-proposal-run-request/v1", operation: "validate", roomLabel: "room-a",
    packageSelector: { packageId: `afc-ui2a-package:room-a:${"a".repeat(64)}`, receiptFileName: `afc-ui2a-prepared-input.room-a.${"a".repeat(64)}.receipt.json`, receiptSha256: "b".repeat(64) },
    studyMode: "original_only",
  };
  const success = await handler()(new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(request) }));
  assert.equal(success.status, 200);
  for (const body of ["", "{"]) {
    const response = await handler()(new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json" }, body }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  const oversized = await handler()(new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(16 * 1024 + 1) }));
  assert.equal(oversized.status, 413);
  const delegated = await handler({
    run: async () => ({ status: "failure", failureCode: "provider_non_success", message: "safe", geminiFloorProposalCall: true, providerCallCount: 1, proposalReceiptWritten: false, companionReceiptWritten: false }),
  })(new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  const body = await delegated.json() as { providerCallCount?: unknown; geminiFloorProposalCall?: unknown };
  assert.equal(delegated.status, 502);
  assert.equal(body.providerCallCount, 1);
  assert.equal(body.geminiFloorProposalCall, true);
});

test("UI2B POST enforces media type, declared size, object bodies, and safe thrown dependencies", async () => {
  for (const contentType of ["text/json", "application/json-patch+json", "application/jsonx"]) {
    const response = await handler()(new Request("http://test/run", {
      method: "POST", headers: { "content-type": contentType }, body: "{}",
    }));
    assert.equal(response.status, 415, contentType);
  }
  const declared = await handler()(new Request("http://test/run", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(16 * 1024 + 1) },
    body: "{}",
  }));
  assert.equal(declared.status, 413);
  for (const body of ["null", "[]", "\"text\"", "1"]) {
    const response = await handler()(new Request("http://test/run", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }));
    assert.equal(response.status, 400, body);
  }
  const thrown = await handler({ run: async () => { throw new Error("/Users/private secret"); } })(
    new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  );
  assert.equal(thrown.status, 500);
  const thrownBody = await thrown.json() as Record<string, unknown>;
  assert.deepEqual({
    providerCallCount: thrownBody.providerCallCount,
    geminiFloorProposalCall: thrownBody.geminiFloorProposalCall,
    proposalReceiptWritten: thrownBody.proposalReceiptWritten,
    companionReceiptWritten: thrownBody.companionReceiptWritten,
  }, {
    providerCallCount: 0,
    geminiFloorProposalCall: false,
    proposalReceiptWritten: false,
    companionReceiptWritten: false,
  });
  assert.equal(JSON.stringify(thrownBody).includes("/Users/"), false);
});

test("UI2B POST maps every domain result without changing provider or artifact truth", async () => {
  const statusCases: ReadonlyArray<readonly [string, number]> = [
    ["invalid_input", 400],
    ["capture_not_authorized", 403],
    ["provider_call_not_authorized", 403],
    ["package_not_found", 404],
    ["package_receipt_hash_mismatch", 409],
    ["run_in_progress", 409],
    ...[
      "package_receipt_invalid", "package_replay_failed", "package_room_mismatch", "unsupported_study_mode",
      "runner_binding_invalid", "manifest_validation_failed", "selected_image_invalid", "runner_validation_failed",
      "proposal_contract_invalid", "proposal_replay_failed",
    ].map((code) => [code, 422] as const),
    ["provider_configuration_unavailable", 503],
    ["provider_non_success", 502],
    ["provider_response_invalid", 502],
    ["proposal_capture_failed", 500],
    ["proposal_receipt_validation_failed", 500],
    ["unexpected_failure", 500],
  ];
  for (const [failureCode, expectedStatus] of statusCases) {
    const delegated = {
      status: "failure", failureCode, message: "safe",
      geminiFloorProposalCall: true, providerCallCount: 1,
      proposalReceiptWritten: true, companionReceiptWritten: false,
    };
    const response = await handler({ run: async () => delegated })(
      new Request("http://test/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    );
    assert.equal(response.status, expectedStatus, failureCode);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), delegated);
  }
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    assert.equal(method in routeModule, false, method);
  }
});
