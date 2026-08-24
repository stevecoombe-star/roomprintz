import assert from "node:assert/strict";
import test from "node:test";

import {
  createAfcSr1LiveAnalyzeCertifiedEmptyPostHandler,
  parseAfcSr1CertifiedEmptyLiveRequest,
} from "./route";

const valid = {
  attemptId: "attempt-certified-1",
  sourceImageUrl: "https://images.unsplash.com/room.jpg",
  sourceImageIdentity: {
    sha256: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
  labLoadGeneration: 2,
  referenceDepthM: 4.5,
  certifiedEmptyPackage: {
    roomId: "room-c",
    packageId: `afc-ui2a-package:room-c:${"b".repeat(64)}`,
    receiptFileName: `afc-ui2a-prepared-input.room-c.${"b".repeat(64)}.receipt.json`,
    receiptSha256: "c".repeat(64),
  },
};

function handler(overrides: Record<string, unknown> = {}) {
  return createAfcSr1LiveAnalyzeCertifiedEmptyPostHandler({
    authenticateAdmin: async () => ({ id: "admin" } as never),
    nodeEnv: () => "development",
    isEnabled: () => true,
    resolveCertifiedEmpty: async () => ({
      package: valid.certifiedEmptyPackage,
      original: {
        sha256: valid.sourceImageIdentity.sha256,
        byteCount: 123,
        decodedWidth: valid.sourceImageIdentity.decodedWidth,
        decodedHeight: valid.sourceImageIdentity.decodedHeight,
        mimeType: "image/png",
        orientation: 1,
      },
      empty: {
        basis: {
          sha256: "d".repeat(64),
          byteCount: 456,
          decodedWidth: 1200,
          decodedHeight: 800,
          mimeType: "image/png",
          orientation: 1,
        },
        bytes: Uint8Array.of(1, 2, 3),
        generated: false,
      },
    }),
    executeAttempt: async () => ({
      status: "failed",
      schemaVersion: "afc-sr1-complete-product-attempt/v2",
      attemptId: valid.attemptId,
      resultId: "result-1",
      labLoadGeneration: valid.labLoadGeneration,
      reason: "empty_generation_failed",
      detail: "closed",
      diagnostics: {},
    } as never),
    ...overrides,
  } as never);
}

test("certified EMPTY route has a closed request parser", () => {
  const parsed = parseAfcSr1CertifiedEmptyLiveRequest(valid);
  assert.ok(parsed);
  assert.equal(parsed?.selector.packageId, valid.certifiedEmptyPackage.packageId);
  assert.equal(parseAfcSr1CertifiedEmptyLiveRequest({ ...valid, extra: true }), null);
  assert.equal(parseAfcSr1CertifiedEmptyLiveRequest({
    ...valid,
    certifiedEmptyPackage: { ...valid.certifiedEmptyPackage, localPath: "/Users/room-c/empty.png" },
  }), null);
});

test("certified EMPTY route preserves admin, production, and feature gates", async () => {
  for (const [overrides, expected] of [
    [{ authenticateAdmin: async () => null }, 403],
    [{ nodeEnv: () => "production" }, 404],
    [{ isEnabled: () => false }, 404],
  ] as const) {
    const response = await handler(overrides)(new Request("http://test", {
      method: "POST",
      body: JSON.stringify(valid),
    }));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("certified EMPTY route injects only a non-generated verified resolver into TILED execution", async () => {
  let resolved = 0;
  let executed = 0;
  const response = await handler({
    resolveCertifiedEmpty: async (args: {
      selector: { roomId: string };
      expectedOriginal: { sha256: string };
    }) => {
      resolved++;
      assert.equal(args.selector.roomId, "room-c");
      assert.equal(args.expectedOriginal.sha256, valid.sourceImageIdentity.sha256);
      return {
        package: valid.certifiedEmptyPackage,
        original: {
          sha256: valid.sourceImageIdentity.sha256,
          byteCount: 123,
          decodedWidth: valid.sourceImageIdentity.decodedWidth,
          decodedHeight: valid.sourceImageIdentity.decodedHeight,
          mimeType: "image/png" as const,
          orientation: 1 as const,
        },
        empty: {
          basis: {
            sha256: "d".repeat(64),
            byteCount: 456,
            decodedWidth: 1200,
            decodedHeight: 800,
            mimeType: "image/png" as const,
            orientation: 1 as const,
          },
          bytes: Uint8Array.of(1, 2, 3),
          generated: false,
        },
      };
    },
    executeAttempt: async (request: typeof valid, dependencies: {
      resolveEmpty: (original: { basis: unknown }) => Promise<{ generated: boolean } | null>;
    }) => {
      executed++;
      const empty = await dependencies.resolveEmpty({
        basis: {
          sha256: valid.sourceImageIdentity.sha256,
          byteCount: 123,
          decodedWidth: 1200,
          decodedHeight: 800,
          mimeType: "image/png",
          orientation: 1,
        },
      });
      assert.equal(empty?.generated, false);
      assert.equal(await dependencies.resolveEmpty({ basis: { sha256: "wrong" } }), null);
      return {
        status: "failed",
        schemaVersion: "afc-sr1-complete-product-attempt/v2",
        attemptId: request.attemptId,
        resultId: "result-1",
        labLoadGeneration: request.labLoadGeneration,
        reason: "empty_generation_failed",
        detail: "closed",
        diagnostics: {},
      } as never;
    },
  })(new Request("http://test", { method: "POST", body: JSON.stringify(valid) }));
  assert.equal(response.status, 200);
  assert.equal(resolved, 1);
  assert.equal(executed, 1);
  assert.equal((await response.text()).includes("/Users/"), false);
});

test("invalid or unverifiable prepared packages fail before TILED execution", async () => {
  let executed = 0;
  const response = await handler({
    resolveCertifiedEmpty: async () => null,
    executeAttempt: async () => {
      executed++;
      throw new Error("must not execute");
    },
  })(new Request("http://test", { method: "POST", body: JSON.stringify(valid) }));
  assert.equal(response.status, 422);
  assert.equal(executed, 0);
  assert.equal((await response.text()).includes("/Users/"), false);
});
