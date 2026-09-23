import assert from "node:assert/strict";
import test from "node:test";

import { createAfcUi2aStatusGetHandler } from "./route";

function handler(overrides: Partial<Parameters<typeof createAfcUi2aStatusGetHandler>[0]> = {}) {
  return createAfcUi2aStatusGetHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    discover: async () => [],
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as Parameters<typeof createAfcUi2aStatusGetHandler>[0]);
}
test("UI2A status route is admin, development, and feature gated", async () => {
  assert.equal((await handler({ getAuthenticatedAdminUser: async () => null })(new Request("http://test"))).status, 403);
  assert.equal((await handler({ nodeEnv: () => "production" })(new Request("http://test"))).status, 404);
  assert.equal((await handler({ isEnabled: () => false })(new Request("http://test"))).status, 404);
});
test("UI2A status route permits only bounded recognized filters", async () => {
  const get = handler();
  assert.equal((await get(new Request("http://test?unexpected=value"))).status, 400);
  const response = await get(new Request(`http://test?expectedFingerprint=${"a".repeat(64)}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", preparations: [] });
});
