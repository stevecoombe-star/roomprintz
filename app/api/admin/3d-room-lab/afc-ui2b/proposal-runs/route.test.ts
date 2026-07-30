import assert from "node:assert/strict";
import test from "node:test";

import * as routeModule from "./route";
import { createAfcUi2bProposalRunsGetHandler } from "./route";

function handler(overrides: Record<string, unknown> = {}) {
  return createAfcUi2bProposalRunsGetHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    discover: async () => ({ status: "inventory", roomId: "room-a", runs: [], invalidCandidateCount: 0 }),
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as never);
}
test("UI2B inventory GET preserves containment gate order", async () => {
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
      discover: async () => {
        calls.push("discover");
        return { status: "inventory", roomId: "room-a", runs: [], invalidCandidateCount: 0 };
      },
    })(new Request("http://test/runs?roomLabel=room-a"));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(calls, stopAfter === "admin"
      ? ["admin"]
      : stopAfter === "environment" ? ["admin", "environment"] : ["admin", "environment", "feature"]);
  }
});
test("UI2B inventory GET rejects unknown, duplicate, and malformed query parameters", async () => {
  for (const query of [
    "",
    "?roomLabel=room-a&roomLabel=room-b",
    "?roomLabel=room-a&path=/tmp",
    "?roomLabel=Room%20A",
    "?roomLabel=room-a&packageId=",
    `?roomLabel=room-a&packageId=afc-ui2a-package%3Aroom-b%3A${"a".repeat(64)}`,
    `?roomLabel=room-a&packageId=afc-ui2a-package%3Aroom-a%3A${"A".repeat(64)}`,
  ]) {
    const response = await handler()(new Request(`http://test/runs${query}`));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
test("UI2B inventory GET passes only supported optional filters and safe failures", async () => {
  const calls: unknown[] = [];
  const get = handler({ discover: async (input: unknown) => {
    calls.push(input);
    return { status: "inventory", roomId: "room-a", runs: [], invalidCandidateCount: 1 };
  } });
  for (const query of [
    "?roomLabel=room-a&packageId=afc-ui2a-package%3Aroom-a%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "?roomLabel=room-a&studyMode=original_only",
    "?roomLabel=room-a&studyMode=empty_only",
  ]) {
    const response = await get(new Request(`http://test/runs${query}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(calls.length, 3);
  for (const query of ["?roomLabel=room-a&studyMode=parallel_union", "?roomLabel=room-a&studyMode=original_only&studyMode=empty_only", "?roomLabel=&studyMode=original_only"]) {
    const response = await get(new Request(`http://test/runs${query}`));
    assert.equal(response.status, 400);
  }
  const unavailable = await handler({ discover: async () => ({ status: "failure", failureCode: "inventory_unavailable", message: "safe" }) })(
    new Request("http://test/runs?roomLabel=room-a"),
  );
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes("/Users/"), false);
});

test("UI2B inventory GET enforces query size, preserves inventory data, and contains thrown failures", async () => {
  const oversized = await handler()(new Request(`http://test/runs?roomLabel=room-a&unknown=${"x".repeat(4096)}`));
  assert.equal(oversized.status, 413);
  const inventory = {
    status: "inventory" as const,
    roomId: "room-a",
    runs: [{ studyMode: "original_only", proposal: { receiptSha256: "a".repeat(64) } }],
    invalidCandidateCount: 2,
  };
  const populated = await handler({ discover: async () => inventory })(
    new Request("http://test/runs?roomLabel=room-a&studyMode=original_only"),
  );
  assert.equal(populated.status, 200);
  assert.deepEqual(await populated.json(), inventory);
  const thrown = await handler({ discover: async () => { throw new Error("/Users/private secret"); } })(
    new Request("http://test/runs?roomLabel=room-a"),
  );
  assert.equal(thrown.status, 500);
  assert.equal((await thrown.text()).includes("/Users/"), false);
  assert.equal(thrown.headers.get("Cache-Control"), "no-store");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(method in routeModule, false, method);
  }
});
