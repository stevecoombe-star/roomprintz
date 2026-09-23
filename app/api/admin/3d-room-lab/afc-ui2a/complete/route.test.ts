import assert from "node:assert/strict";
import test from "node:test";

import { createAfcUi2aCompletePostHandler } from "./route";

function handler(overrides: Record<string, unknown> = {}) {
  return createAfcUi2aCompletePostHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    complete: async () => ({ status: "package_completed" }),
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as never);
}

test("complete route applies containment before body handling", async () => {
  let called = 0;
  const handler = createAfcUi2aCompletePostHandler({
    getAuthenticatedAdminUser: async () => null,
    complete: async () => { called++; return null as never; },
    nodeEnv: () => "development",
    isEnabled: () => true,
  } as never);
  const response = await handler(new Request("http://test/complete", { method: "POST", body: "not json" }));
  assert.equal(response.status, 403);
  assert.equal(called, 0);
});
test("complete route requires bounded JSON and safely serializes results", async () => {
  const handler = createAfcUi2aCompletePostHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    complete: async (body: unknown) => ({
      status: "failure", failureCode: "package_replay_failed", message: "The prepared package did not pass strict replay.", emptyRoomGenerationCall: true,
      received: body,
    } as never),
    nodeEnv: () => "development",
    isEnabled: () => true,
  } as never);
  const nonJson = await handler(new Request("http://test/complete", { method: "POST", body: "{}" }));
  assert.equal(nonJson.status, 415);
  const response = await handler(new Request("http://test/complete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.text()).includes("/Users/"), false);
});
test("complete route preserves gate order and no-store on every JSON response", async () => {
  const cases: Array<[string, Record<string, unknown>, number]> = [
    ["unauthenticated", { getAuthenticatedAdminUser: async () => null }, 403],
    ["production", { nodeEnv: () => "production" }, 404],
    ["disabled", { isEnabled: () => false }, 404],
  ];
  for (const [, overrides, status] of cases) {
    const response = await handler(overrides)(new Request("http://test/complete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
test("complete route maps public result statuses without exposing dependency errors", async () => {
  const cases: Array<[unknown, number]> = [
    [{ status: "package_completed" }, 200],
    [{ status: "empty_generation_required" }, 200],
    [{ status: "failure", failureCode: "capture_not_authorized", emptyRoomGenerationCall: false }, 403],
    [{ status: "failure", failureCode: "empty_generation_disabled", emptyRoomGenerationCall: false }, 403],
    [{ status: "failure", failureCode: "empty_generation_in_progress", emptyRoomGenerationCall: false }, 409],
    [{ status: "failure", failureCode: "manifest_conflict", emptyRoomGenerationCall: false }, 409],
    [{ status: "failure", failureCode: "pair_incompatible", emptyRoomGenerationCall: false }, 422],
    [{ status: "failure", failureCode: "unexpected_failure", emptyRoomGenerationCall: true }, 500],
  ];
  for (const [result, status] of cases) {
    const response = await handler({ complete: async () => result })(new Request("http://test/complete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.text()).includes("stack"), false);
  }
});
