import assert from "node:assert/strict";
import test from "node:test";

import { createAfcProposalOverlayGetHandler } from "./route";

const validReplay = {
  status: "valid" as const,
  viewModel: { artifactIdentity: { receiptFileName: "afc-r3c-run.safe.receipt.json", receiptSha256: "c".repeat(64) } },
  images: {
    original: { bytes: Buffer.from("original"), mimeType: "image/jpeg", sha256: "a".repeat(64), width: 1, height: 1, role: "original" as const },
    empty: { bytes: Buffer.from("empty"), mimeType: "image/png", sha256: "b".repeat(64), width: 1, height: 1, role: "empty" as const },
  },
} as never;

function handler(overrides: Partial<Parameters<typeof createAfcProposalOverlayGetHandler>[0]> = {}) {
  return createAfcProposalOverlayGetHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    discover: async () => [{ receiptFileName: "afc-r3c-run.safe.receipt.json" }],
    replay: async () => validReplay,
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as Parameters<typeof createAfcProposalOverlayGetHandler>[0]);
}

test("AFC-UI1 route hard-404s in production and when disabled", async () => {
  const production = await handler({ nodeEnv: () => "production" })(new Request("http://test/overlay?operation=receipts"));
  const disabled = await handler({ isEnabled: () => false })(new Request("http://test/overlay?operation=receipts"));
  assert.equal(production.status, 404);
  assert.equal(disabled.status, 404);
});

test("AFC-UI1 route preserves admin rejection", async () => {
  const response = await handler({ getAuthenticatedAdminUser: async () => null })(new Request("http://test/overlay?operation=receipts"));
  assert.equal(response.status, 403);
});

test("AFC-UI1 route discovers, loads, and independently serves verified roles", async () => {
  const get = handler();
  const discovery = await get(new Request("http://test/overlay?operation=receipts"));
  const load = await get(new Request("http://test/overlay?operation=load&receipt=afc-r3c-run.safe.receipt.json"));
  const image = await get(new Request(`http://test/overlay?operation=image&receipt=afc-r3c-run.safe.receipt.json&receiptSha256=${"c".repeat(64)}&role=empty`));
  assert.equal(discovery.status, 200);
  assert.equal(load.status, 200);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-afc-ui1-image-sha256"), "b".repeat(64));
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
});

test("AFC-UI1 image delivery rejects a stale receipt digest", async () => {
  const response = await handler()(new Request(`http://test/overlay?operation=image&receipt=afc-r3c-run.safe.receipt.json&receiptSha256=${"d".repeat(64)}&role=original`));
  assert.equal(response.status, 409);
});

test("AFC-UI1 does not treat arbitrary query parameters as discovery", async () => {
  const response = await handler()(new Request("http://test/overlay?receipt=afc-r3c-run.safe.receipt.json"));
  assert.equal(response.status, 400);
});

test("AFC-UI1 route delegates malformed receipt selection to fail-closed replay", async () => {
  const get = handler({ replay: async () => ({ status: "invalid", reason: "unsafe filename", path: "$.receipt" }) });
  const response = await get(new Request("http://test/overlay?operation=load&receipt=..%2Fescape"));
  assert.equal(response.status, 400);
});
