import assert from "node:assert/strict";
import test from "node:test";

import { claimNextVibodeThumbnailJob } from "./jobs.server";

test("a missing render secret does not claim a job", async () => {
  let calls = 0;
  const result = await claimNextVibodeThumbnailJob({
    tokenSecret: () => null,
    rpc: async () => {
      calls += 1;
      throw new Error("claim RPC must not run");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "render_access_denied");
  assert.equal(calls, 0);
});
