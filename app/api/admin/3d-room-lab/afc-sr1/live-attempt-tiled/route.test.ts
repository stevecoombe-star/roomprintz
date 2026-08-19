import assert from "node:assert/strict";
import test from "node:test";

import {
  createAfcSr1LiveAttemptTiledGetHandler,
} from "./route";

const attemptId = "afc-tiled-attempt-1";
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("attempt TILED diagnostic requires admin authentication", async () => {
  const handler = createAfcSr1LiveAttemptTiledGetHandler({
    authenticateAdmin: async () => null,
    getEvidence: () => {
      throw new Error("must not read evidence");
    },
  });
  const response = await handler(
    new Request(`http://localhost?attemptId=${attemptId}`)
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("attempt TILED diagnostic serves exact retained bytes for its attempt", async () => {
  const handler = createAfcSr1LiveAttemptTiledGetHandler({
    authenticateAdmin: async () => ({ id: "admin" } as never),
    getEvidence: (requestedAttemptId) => requestedAttemptId === attemptId
      ? {
          tiledPerspective: {
            tiledBytes: bytes,
            tiledBasis: {
              sha256: "c".repeat(64),
              byteCount: bytes.byteLength,
              decodedWidth: 2,
              decodedHeight: 2,
              mimeType: "image/png",
              orientation: 1,
            },
          },
        }
      : null,
  });
  const response = await handler(
    new Request(`http://localhost?attemptId=${attemptId}`)
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("attempt TILED diagnostic rejects invalid, stale, and unretained attempts", async () => {
  const handler = createAfcSr1LiveAttemptTiledGetHandler({
    authenticateAdmin: async () => ({ id: "admin" } as never),
    getEvidence: () => null,
  });
  for (const url of [
    "http://localhost",
    "http://localhost?attemptId=../arbitrary-path",
    `http://localhost?attemptId=${attemptId}`,
  ]) {
    const response = await handler(new Request(url));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
