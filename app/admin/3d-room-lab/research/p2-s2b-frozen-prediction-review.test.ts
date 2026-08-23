import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB,
  P2_S2B_CERTIFIED_REGION_MODULE_BLOB,
} from "./p2-s2b-holdout-prediction";
import {
  P2_S2B_FROZEN_REVIEW_RECEIPT_HASHES,
  currentP2S2BFrozenReviewModuleBlobs,
  reconstructP2S2BFrozenReviewMask,
  verifyP2S2BFrozenReviewReceipt,
} from "./p2-s2b-frozen-prediction-review-server";
import {
  P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES,
  P2_S2B_FROZEN_REVIEW_ROOMS,
  p2S2BReviewFragmentCounts,
  p2S2BReviewFragmentPolyline,
  p2S2BReviewFragmentsForState,
  p2S2BReviewNormalizedToSourcePixel,
  p2S2BReviewPointerToSourcePixel,
  p2S2BReviewRatioToSourcePixel,
  type P2S2BFrozenReviewRoomId,
} from "./p2-s2b-frozen-prediction-review";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);
const RECEIPT_ROOT = path.join(
  RESEARCH_ROOT,
  "fixtures",
  "p2-s2b-holdout-predictions"
);
const REVIEW_ROUTE_ROOT = path.join(
  RESEARCH_ROOT,
  "p2-s2b-frozen-prediction-review"
);

async function receiptFiles(roomId: P2S2BFrozenReviewRoomId) {
  const [json, sidecar] = await Promise.all([
    readFile(path.join(RECEIPT_ROOT, `${roomId}.json`), "utf8"),
    readFile(path.join(RECEIPT_ROOT, `${roomId}.json.sha256`), "utf8"),
  ]);
  return { json, sidecar };
}

async function verifiedReceipt(roomId: P2S2BFrozenReviewRoomId) {
  const files = await receiptFiles(roomId);
  const verified = verifyP2S2BFrozenReviewReceipt(
    roomId,
    files.json,
    files.sidecar
  );
  if (!verified.ok) assert.fail(verified.code);
  return verified;
}

async function walk(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  }));
  return nested.flat();
}

test("review strictly verifies the exact frozen B/D receipt seals", async () => {
  for (const roomId of P2_S2B_FROZEN_REVIEW_ROOMS) {
    const verified = await verifiedReceipt(roomId);
    assert.equal(
      verified.receiptSha256,
      P2_S2B_FROZEN_REVIEW_RECEIPT_HASHES[roomId]
    );
    assert.equal(verified.receipt.input.roomId, roomId);
    assert.deepEqual(verified.receipt.input.emptyDimensions, {
      width: 1264,
      height: 848,
    });
  }
});

test("review rejects mutations and requires the strict receipt parser", async () => {
  const { json, sidecar } = await receiptFiles("room-b");
  const value = JSON.parse(json) as Record<string, unknown>;
  const outcome = value.outcome as Record<string, unknown>;
  const region = outcome.region as Record<string, unknown>;
  const seed = region.seed as Record<string, unknown>;
  seed.patchMeanLuma = Number(seed.patchMeanLuma) + 0.001;
  assert.deepEqual(
    verifyP2S2BFrozenReviewReceipt(
      "room-b",
      JSON.stringify(value),
      sidecar
    ),
    { ok: false, code: "receipt_hash_mismatch" }
  );

  const strictProbe = JSON.parse(json) as Record<string, unknown>;
  strictProbe.unexpectedReviewField = true;
  assert.deepEqual(
    verifyP2S2BFrozenReviewReceipt(
      "room-b",
      JSON.stringify(strictProbe),
      sidecar
    ),
    { ok: false, code: "receipt_schema_invalid" }
  );
});

test("viewer maps normalized and pointer coordinates in exact source space", () => {
  const dimensions = { width: 1264, height: 848 };
  assert.deepEqual(
    p2S2BReviewNormalizedToSourcePixel(
      { x: 631 / 1264, y: 423 / 848 },
      dimensions
    ),
    { x: 631, y: 423 }
  );
  assert.equal(p2S2BReviewRatioToSourcePixel(0, 1264), 0);
  assert.equal(p2S2BReviewRatioToSourcePixel(1, 1264), 1263);
  assert.equal(
    p2S2BReviewRatioToSourcePixel(631.5 / 1264, 1264),
    631,
    "floor mapping must not round the source center to the next pixel"
  );
  assert.deepEqual(
    p2S2BReviewPointerToSourcePixel(
      { x: 499.7, y: 250.4 },
      { width: 1000, height: 500 },
      dimensions
    ),
    { x: 631, y: 424 }
  );
});

test("viewer preserves complete open polylines without geometry alteration", async () => {
  for (const roomId of P2_S2B_FROZEN_REVIEW_ROOMS) {
    const verified = await verifiedReceipt(roomId);
    assert.equal(verified.receipt.outcome.status, "ok");
    if (verified.receipt.outcome.status !== "ok") continue;
    for (const fragment of verified.receipt.outcome.fragments) {
      const points = p2S2BReviewFragmentPolyline(
        fragment,
        verified.receipt.input.emptyDimensions
      );
      assert.equal(points.length, fragment.pointsSourceNormalized.length);
      assert.deepEqual(
        points,
        fragment.pointsSourceNormalized.map(point => ({
          x: point.x * 1264,
          y: point.y * 848,
        }))
      );
      assert.notDeepEqual(points[0], points.at(-1));
      assert.equal(
        fragment.geometryKind,
        "finite_open_observed_perimeter_span"
      );
    }
  }
});

test("viewer renders all persisted classes independently without promotion", async () => {
  const allFragments = (await Promise.all(
    P2_S2B_FROZEN_REVIEW_ROOMS.map(async roomId => {
      const verified = await verifiedReceipt(roomId);
      assert.equal(verified.receipt.outcome.status, "ok");
      return verified.receipt.outcome.status === "ok"
        ? verified.receipt.outcome.fragments
        : [];
    })
  )).flat();
  const counts = p2S2BReviewFragmentCounts(allFragments);
  for (const state of P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES) {
    const rendered = p2S2BReviewFragmentsForState(allFragments, state);
    assert.ok(rendered.length > 0, `${state} must have persisted evidence`);
    assert.equal(rendered.length, counts[state]);
    assert.ok(rendered.every(fragment => fragment.boundaryState === state));
    assert.ok(rendered.every(fragment => allFragments.includes(fragment)));
  }
});

test("mask reconstruction requires certified blobs and matches both mask seals", async () => {
  const current = await currentP2S2BFrozenReviewModuleBlobs();
  assert.deepEqual(current, {
    regionModuleBlob: P2_S2B_CERTIFIED_REGION_MODULE_BLOB,
    fragmentModuleBlob: P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB,
  });
  const expectedMasks = {
    "room-b": "108e7c56a26237363e2c1c2a95acc1305f9a50486461a3a02c95e51a20801322",
    "room-d": "d886ba4337443c98af07f73c38c262a34531dab4e948f9e22ef7e5985ccd2278",
  } as const;
  for (const roomId of P2_S2B_FROZEN_REVIEW_ROOMS) {
    const reconstructed = await reconstructP2S2BFrozenReviewMask(
      roomId,
      current
    );
    if (!reconstructed.ok) assert.fail(reconstructed.reason);
    assert.equal(
      reconstructed.componentMaskSha256,
      expectedMasks[roomId]
    );
    assert.ok(reconstructed.pngBytes.byteLength > 0);
    assert.equal("fragments" in reconstructed, false);
  }
});

test("mask reconstruction fails closed on a module mismatch", async () => {
  const reconstructed = await reconstructP2S2BFrozenReviewMask("room-b", {
    regionModuleBlob: "0".repeat(40),
    fragmentModuleBlob: P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB,
  });
  assert.deepEqual(reconstructed, {
    ok: false,
    code: "frozen_mask_reconstruction_unavailable",
    reason: "module_blob_mismatch",
  });
});

test("review remains research-only, read-only, unscored, and blind-viewer isolated", async () => {
  const maskRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "admin",
    "3d-room-lab",
    "p2-s2b-frozen-prediction-review-mask",
    "route.ts"
  );
  const reviewSources = await Promise.all([
    readFile(path.join(RESEARCH_ROOT, "p2-s2b-frozen-prediction-review.ts"), "utf8"),
    readFile(
      path.join(RESEARCH_ROOT, "p2-s2b-frozen-prediction-review-server.ts"),
      "utf8"
    ),
    readFile(path.join(REVIEW_ROUTE_ROOT, "page.tsx"), "utf8"),
    readFile(
      path.join(REVIEW_ROUTE_ROOT, "FrozenPredictionReviewClient.tsx"),
      "utf8"
    ),
    readFile(maskRoutePath, "utf8"),
  ]);
  const combined = reviewSources.join("\n");
  assert.doesNotMatch(
    combined,
    /ThreeRoomLab|worldXZ|physical-room-envelope|TILED|Gemini|compositor/
  );
  assert.doesNotMatch(
    combined,
    /evaluateEmptyRegionBoundaryFragments|precision|recall|hard.fail|oracle comparison/i
  );
  assert.doesNotMatch(combined, /\b(writeFile|unlink|rename)\b/);
  assert.doesNotMatch(combined, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.match(reviewSources[2], /NODE_ENV === "production"\) notFound\(\)/);
  assert.match(reviewSources[4], /getAuthenticatedAdminUser/);
  assert.match(reviewSources[4], /nodeEnv === "production"/);

  const blindViewer = await readFile(
    path.join(
      RESEARCH_ROOT,
      "p2-s2b-holdout-oracle-authoring",
      "HoldoutOracleAuthoringClient.tsx"
    ),
    "utf8"
  );
  assert.doesNotMatch(blindViewer, /p2-s2b-frozen-prediction-review/);

  const allSources = (await Promise.all(
    ["app", "components", "lib"].map(directory =>
      walk(path.join(process.cwd(), directory))
    )
  )).flat();
  const productImporters: string[] = [];
  for (const filePath of allSources) {
    if (
      !/\.(ts|tsx)$/.test(filePath) ||
      filePath.startsWith(`${RESEARCH_ROOT}${path.sep}`) ||
      filePath === maskRoutePath
    ) continue;
    const source = await readFile(filePath, "utf8");
    if (source.includes("p2-s2b-frozen-prediction-review")) {
      productImporters.push(filePath);
    }
  }
  assert.deepEqual(productImporters, []);
});
