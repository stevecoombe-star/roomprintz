import assert from "node:assert/strict";
import test from "node:test";

import { completeAfcUi2aPreparedPackage } from "./afc-ui2a-complete";

const hash = "a".repeat(64);
const selector = {
  preparationId: `afc-ui2a-original:room-a:${hash}`,
  receiptFileName: `afc-ui2a-original-preparation.room-a.${hash}.receipt.json`,
  receiptSha256: "b".repeat(64),
};
const original = {
  roomId: "room-a", preparationId: selector.preparationId, receipt: { preparationId: selector.preparationId },
  original: { fileName: "room-a.original.jpg", sha256: hash, byteCount: 1, mimeType: "image/jpeg", decodedWidth: 1, decodedHeight: 1, orientation: 1 },
  roomDirectory: "/server/only", originalFilePath: "/server/only/original.jpg", sanitizedImageUrl: "https://example.test/image.jpg",
} as const;
const empty = {
  canonicalReceiptFileName: "empty.receipt.json",
  emptyRoomAssist: {
    fileName: "room-a.empty-room.jpg", sha256: "c".repeat(64), byteCount: 1, mimeType: "image/jpeg", decodedWidth: 1, decodedHeight: 1, orientation: 1,
    generatedFromOriginalSha256: hash, generatorId: "generator", requestedModelId: "NBP", resolvedModelId: null, resolvedModelStatus: "not_reported_by_compositor",
  },
} as const;
function request(extra: Record<string, unknown> = {}) {
  return { contractVersion: "afc-ui2a-complete-request/v1", roomLabel: "room-a", originalPreparation: selector, executeCapture: true, ...extra };
}
function resolved(source: "disk_reused" | "cache_hit" | "generated" = "disk_reused", emptyRoomGenerationCall = false, overrides: Record<string, unknown> = {}) {
  return {
    status: "empty_resolved" as const, roomId: "room-a", originalPreparationId: selector.preparationId, resolutionSource: source,
    original: original.original, emptyRoomAssist: empty.emptyRoomAssist, emptyRoomGenerationCall,
    safety: { geminiFloorProposalCall: false, afcR2Run: false, floorStateUnchanged: true, supportStateUnchanged: true, activeCameraUnchanged: true, sceneStateUnchanged: true, productionTokenAccountingUsed: false },
    ...overrides,
  };
}
const materialized = {
  status: "package_materialized" as const, packageId: `afc-ui2a-package:room-a:${"d".repeat(64)}`, roomId: "room-a", originalPreparationId: selector.preparationId,
  original: original.original, emptyRoomAssist: empty.emptyRoomAssist,
  compatibility: { version: "afc-r3c-image-pair-compatibility/v1" as const, tier: "exact_grid_compatible" as const, relativeAspectErrorRaw: 0, relativeAspectError: 0 },
  sharedContextDigest: "e".repeat(64),
  manifest: { fileName: "manifest.json", sha256: "f".repeat(64), contractVersion: "afc-r3c-image-manifest/v1" as const, disposition: "written" as const },
  receipt: { fileName: "receipt.json", sha256: "1".repeat(64), reused: false },
  safety: { authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true, supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false, geminiFloorProposalCall: false, afcR2Run: false, localResearchPackageWritten: true },
} as const;

test("complete gates before resolution when capture acknowledgement is not primitive true", async () => {
  let calls = 0;
  const result = await completeAfcUi2aPreparedPackage(request({ executeCapture: "true" }), { resolveEmpty: async () => { calls++; return null as never; } });
  assert.deepEqual(result, { status: "failure", failureCode: "capture_not_authorized", message: "Confirm prepared-package completion before accessing local evidence.", emptyRoomGenerationCall: false });
  assert.equal(calls, 0);
});
test("complete preserves generation-required without replaying or materializing", async () => {
  let replayed = 0;
  const result = await completeAfcUi2aPreparedPackage(request(), {
    resolveEmpty: async () => ({ status: "empty_generation_required", roomId: "room-a", originalPreparationId: selector.preparationId, requestedModelId: "NBP", expectedCompositorCallCount: 1, emptyRoomGenerationCall: false }),
    replayOriginal: async () => { replayed++; return null as never; },
  });
  assert.equal(result.status, "empty_generation_required");
  assert.equal(replayed, 0);
});
test("complete preserves a live-call disclosure after materialization failure", async () => {
  const result = await completeAfcUi2aPreparedPackage(request({ executeEmptyRoomGeneration: true }), {
    resolveEmpty: async () => ({
      status: "empty_resolved", roomId: "room-a", originalPreparationId: selector.preparationId, resolutionSource: "generated",
      original: original.original, emptyRoomAssist: empty.emptyRoomAssist, emptyRoomGenerationCall: true,
      safety: { geminiFloorProposalCall: false, afcR2Run: false, floorStateUnchanged: true, supportStateUnchanged: true, activeCameraUnchanged: true, sceneStateUnchanged: true, productionTokenAccountingUsed: false },
    }),
    replayOriginal: async () => ({ ok: true, evidence: original } as never),
    discoverDurable: async () => ({ status: "selected", evidence: empty } as never),
    materialize: async () => ({ status: "failure", failureCode: "package_replay_failed", message: "not public" }),
  });
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.failureCode, "package_replay_failed");
  assert.equal(result.emptyRoomGenerationCall, true);
  assert.equal(JSON.stringify(result).includes("/server/only"), false);
  assert.equal(JSON.stringify(result).includes("resolvedModelId"), false);
});

test("complete rejects every non-primitive capture acknowledgement before any dependency", async () => {
  for (const value of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true), Object(true)]) {
    let resolveCalls = 0;
    let replayCalls = 0;
    let discoverCalls = 0;
    let materializeCalls = 0;
    const raw: Record<string, unknown> = request();
    if (value === undefined) delete (raw as { executeCapture?: unknown }).executeCapture;
    else raw.executeCapture = value;
    const result = await completeAfcUi2aPreparedPackage(raw, {
      resolveEmpty: async () => { resolveCalls++; return null as never; },
      replayOriginal: async () => { replayCalls++; return null as never; },
      discoverDurable: async () => { discoverCalls++; return null as never; },
      materialize: async () => { materializeCalls++; return null as never; },
    });
    assert.equal(result.status, "failure", String(value));
    if (result.status === "failure") {
      assert.equal(result.failureCode, "capture_not_authorized", String(value));
      assert.equal(result.emptyRoomGenerationCall, false, String(value));
    }
    assert.deepEqual([resolveCalls, replayCalls, discoverCalls, materializeCalls], [0, 0, 0, 0], String(value));
  }
});

test("only an explicit primitive generation acknowledgement reaches Empty resolution", async () => {
  for (const value of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true), Object(true), true]) {
    let calls = 0;
    let seen: unknown = "unset";
    const raw: Record<string, unknown> = request();
    if (value === undefined) delete (raw as { executeEmptyRoomGeneration?: unknown }).executeEmptyRoomGeneration;
    else raw.executeEmptyRoomGeneration = value;
    const result = await completeAfcUi2aPreparedPackage(raw, {
      resolveEmpty: async (received) => {
        calls++;
        seen = (received as { executeEmptyRoomGeneration?: unknown }).executeEmptyRoomGeneration;
        return { status: "empty_generation_required", roomId: "room-a", originalPreparationId: selector.preparationId, requestedModelId: "NBP", expectedCompositorCallCount: 1, emptyRoomGenerationCall: false };
      },
    });
    assert.equal(result.status, "empty_generation_required");
    assert.equal(calls, 1);
    assert.equal(seen, value === true ? true : undefined, String(value));
  }
});

test("complete success projects package safety separately from attempt-level live-call truth", async () => {
  for (const [source, called] of [["disk_reused", false], ["cache_hit", false], ["generated", true]] as const) {
    const result = await completeAfcUi2aPreparedPackage(request({ executeEmptyRoomGeneration: called || undefined }), {
      resolveEmpty: async () => resolved(source, called) as never,
      replayOriginal: async () => ({ ok: true, evidence: original } as never),
      discoverDurable: async () => ({ status: "selected", evidence: empty } as never),
      materialize: async () => materialized as never,
    });
    assert.equal(result.status, "package_completed");
    if (result.status !== "package_completed") return;
    assert.equal(result.emptyRoomGenerationCall, called);
    assert.equal(result.attemptSafety.emptyRoomGenerationCall, called);
    assert.equal(result.package.safety.emptyRoomGenerationCall, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.package.emptyRoomAssist), true);
    assert.deepEqual(Object.keys(result.package.compatibility).sort(), ["relativeAspectError", "relativeAspectErrorRaw", "tier", "version"]);
    assert.deepEqual(Object.keys(result.package.manifest).sort(), ["contractVersion", "disposition", "fileName", "sha256"]);
    assert.deepEqual(Object.keys(result.package.receipt).sort(), ["fileName", "reused", "sha256"]);
    assert.deepEqual(Object.keys(result.package.safety).sort(), [
      "activeCameraUnchanged", "afcR2Run", "applied", "authoritative", "databaseWrites", "emptyRoomGenerationCall",
      "floorStateUnchanged", "geminiFloorProposalCall", "localResearchPackageWritten", "persistedToScene",
      "productionAssetWrites", "productionTokenAccountingUsed", "supportStateUnchanged",
    ]);
    assert.deepEqual(Object.keys(result.package.emptyRoomAssist).sort(), [
      "byteCount", "decodedHeight", "decodedWidth", "fileName", "generatedFromOriginalSha256",
      "generatorId", "mimeType", "orientation", "requestedModelId", "resolvedModelStatus", "sha256",
    ]);
    for (const forbidden of ["roomDirectory", "originalFilePath", "emptyRoomAssistFilePath", "manifestFilePath", "sanitizedImageUrl", "canonicalReceiptFileName", "resolvedModelId", "requestId", "outputDir"]) {
      assert.equal(JSON.stringify(result).includes(forbidden), false, forbidden);
    }
  }
});

test("complete public projections exclude extra materializer properties", async () => {
  const result = await completeAfcUi2aPreparedPackage(request(), {
    resolveEmpty: async () => resolved() as never,
    replayOriginal: async () => ({ ok: true, evidence: original } as never),
    discoverDurable: async () => ({ status: "selected", evidence: empty } as never),
    materialize: async () => ({
      ...materialized,
      compatibility: { ...materialized.compatibility, upstreamCompatibility: "internal" },
      manifest: { ...materialized.manifest, upstreamManifest: "internal" },
      receipt: { ...materialized.receipt, upstreamReceipt: "internal" },
      safety: { ...materialized.safety, upstreamSafety: "internal" },
    } as never),
  });
  assert.equal(result.status, "package_completed");
  if (result.status !== "package_completed") return;
  assert.equal(JSON.stringify(result).includes("upstream"), false);
});

test("every public resolution-evidence disagreement refuses before materialization", async () => {
  const originalMutations: Array<[string, unknown]> = [
    ["roomId", "room-b"], ["originalPreparationId", `afc-ui2a-original:room-a:${"9".repeat(64)}`],
    ["fileName", "changed.png"], ["sha256", "9".repeat(64)], ["byteCount", 2], ["mimeType", "image/png"], ["decodedWidth", 2], ["decodedHeight", 2], ["orientation", 2],
  ];
  const emptyMutations: Array<[string, unknown]> = [
    ["fileName", "changed.png"], ["sha256", "8".repeat(64)], ["byteCount", 2], ["mimeType", "image/png"], ["decodedWidth", 2], ["decodedHeight", 2], ["orientation", 2],
    ["generatedFromOriginalSha256", "8".repeat(64)], ["generatorId", "changed"], ["requestedModelId", "other"], ["resolvedModelId", "other"], ["resolvedModelStatus", "changed"],
  ];
  for (const [field, value] of originalMutations) {
    let materializeCalls = 0;
    const changed = field === "roomId" || field === "originalPreparationId"
      ? { [field]: value }
      : { original: { ...original.original, [field]: value } };
    const result = await completeAfcUi2aPreparedPackage(request(), {
      resolveEmpty: async () => resolved("generated", true, changed) as never,
      replayOriginal: async () => ({ ok: true, evidence: original } as never),
      discoverDurable: async () => ({ status: "selected", evidence: empty } as never),
      materialize: async () => { materializeCalls++; return materialized as never; },
    });
    assert.equal(result.status, "failure", field);
    assert.equal(materializeCalls, 0, field);
    if (result.status === "failure") assert.equal(result.emptyRoomGenerationCall, true, field);
  }
  for (const [field, value] of emptyMutations) {
    let materializeCalls = 0;
    const result = await completeAfcUi2aPreparedPackage(request(), {
      resolveEmpty: async () => resolved("generated", true, { emptyRoomAssist: { ...empty.emptyRoomAssist, [field]: value } }) as never,
      replayOriginal: async () => ({ ok: true, evidence: original } as never),
      discoverDurable: async () => ({ status: "selected", evidence: empty } as never),
      materialize: async () => { materializeCalls++; return materialized as never; },
    });
    assert.equal(result.status, "failure", field);
    assert.equal(materializeCalls, 0, field);
    if (result.status === "failure") assert.equal(result.emptyRoomGenerationCall, true, field);
  }
});

test("complete maps Empty-resolution refusal outcomes once with truthful live-call state", async () => {
  const cases: Array<[string, string, boolean]> = [
    ["empty_generation_disabled", "empty_generation_disabled", false],
    ["empty_generation_in_progress", "empty_generation_in_progress", false],
    ["empty_generation_failed", "empty_generation_failed", false],
    ["empty_generation_failed", "empty_generation_failed", true],
    ["conflicting_empty_evidence", "conflicting_empty_evidence", false],
    ["durable_empty_invalid", "empty_evidence_invalid", false],
    ["pair_incompatible", "pair_incompatible", false],
  ];
  for (const [sourceCode, publicCode, live] of cases) {
    let resolveCalls = 0;
    let materializeCalls = 0;
    const result = await completeAfcUi2aPreparedPackage(request(), {
      resolveEmpty: async () => {
        resolveCalls++;
        return { status: "failure", failureCode: sourceCode, message: "never public", emptyRoomGenerationCall: live } as never;
      },
      materialize: async () => { materializeCalls++; return materialized as never; },
    });
    assert.equal(resolveCalls, 1, sourceCode);
    assert.equal(materializeCalls, 0, sourceCode);
    assert.equal(result.status, "failure", sourceCode);
    if (result.status === "failure") {
      assert.equal(result.failureCode, publicCode, sourceCode);
      assert.equal(result.emptyRoomGenerationCall, live, sourceCode);
      assert.equal(result.message.includes("never public"), false);
    }
  }
});

test("complete refuses stale server reacquisition outcomes before materialization without retries", async () => {
  const discoveries = [
    { status: "absent" },
    { status: "invalid", failureCode: "durable_empty_invalid" },
    { status: "conflict", failureCode: "conflicting_empty_evidence" },
  ];
  for (const discovery of discoveries) {
    let resolves = 0;
    let materializeCalls = 0;
    const result = await completeAfcUi2aPreparedPackage(request(), {
      resolveEmpty: async () => { resolves++; return resolved("generated", true) as never; },
      replayOriginal: async () => ({ ok: true, evidence: original } as never),
      discoverDurable: async () => discovery as never,
      materialize: async () => { materializeCalls++; return materialized as never; },
    });
    assert.equal(resolves, 1);
    assert.equal(materializeCalls, 0);
    assert.equal(result.status, "failure");
    if (result.status === "failure") assert.equal(result.emptyRoomGenerationCall, true);
  }
});

test("complete maps materializer failures once while preserving attempt-level generation truth", async () => {
  const cases = [
    ["manifest_conflict", "manifest_conflict"], ["manifest_validation_failed", "manifest_validation_failed"],
    ["package_receipt_capture_failed", "package_receipt_capture_failed"], ["package_receipt_validation_failed", "package_receipt_validation_failed"],
    ["package_replay_failed", "package_replay_failed"], ["unexpected_failure", "unexpected_failure"],
  ] as const;
  for (const [sourceCode, publicCode] of cases) {
    let resolves = 0;
    let materializeCalls = 0;
    const result = await completeAfcUi2aPreparedPackage(request(), {
      resolveEmpty: async () => { resolves++; return resolved("generated", true) as never; },
      replayOriginal: async () => ({ ok: true, evidence: original } as never),
      discoverDurable: async () => ({ status: "selected", evidence: empty } as never),
      materialize: async () => { materializeCalls++; return { status: "failure", failureCode: sourceCode, message: "not public" } as never; },
    });
    assert.equal(resolves, 1);
    assert.equal(materializeCalls, 1);
    assert.equal(result.status, "failure");
    if (result.status === "failure") {
      assert.equal(result.failureCode, publicCode);
      assert.equal(result.emptyRoomGenerationCall, true);
      assert.equal(result.message.includes("not public"), false);
    }
  }
});
