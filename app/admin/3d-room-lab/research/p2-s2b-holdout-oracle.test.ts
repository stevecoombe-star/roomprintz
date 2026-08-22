import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2B_HOLDOUT_ORACLE_CORRIDOR_SOURCE_PX,
  buildP2S2BHoldoutOracleFixture,
  getP2S2BHoldoutOracleIdentity,
  sourcePixelToP2S2BHoldoutOracleNormalized,
  validateP2S2BHoldoutOracleDraft,
  type P2S2BHoldoutOracleDraftAnnotation,
  type P2S2BHoldoutOracleRoomId,
} from "./p2-s2b-holdout-oracle-authoring";
import { loadP2S2BHoldoutOracleEmptyImage } from "./p2-s2b-holdout-oracle-image";
import {
  parseEmptyPhysicalBoundaryFixture,
  verifyEmptyPhysicalBoundaryFixtureIdentity,
} from "./empty-physical-boundary-read";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);
const ORACLE_ROOT = path.join(
  RESEARCH_ROOT,
  "fixtures",
  "p2-s2b-holdout-oracle"
);
const ROOMS = ["room-b", "room-d"] as const;
const CERTIFIED_PREDICTION_HASHES = {
  "room-b": "fbf7f3fafdb1a0eff9ccb0677755c7ceef2d1e08a4016ee6752aa7365bbad15e",
  "room-d": "fd7673799be656c8cbd1ed910885a97e8e5965afa0af8c79c9e228a31bfc43e2",
} as const;

/**
 * Populate only after a human has visually reviewed every source-pixel point.
 * An authored fixture cannot enter this suite without explicit review locks.
 */
const MANUAL_ANCHOR_LOCKS: Readonly<
  Partial<Record<
    P2S2BHoldoutOracleRoomId,
    Readonly<Record<string, readonly Readonly<{ x: number; y: number }>[]>>
  >>
> = Object.freeze({});

function contractProbe(
  id: string,
  overrides: Partial<P2S2BHoldoutOracleDraftAnnotation> = {}
): P2S2BHoldoutOracleDraftAnnotation {
  return {
    id,
    pointsSourcePx: [{ x: 100, y: 500 }, { x: 200, y: 500 }],
    interpretation: "physical_floor_wall_seam",
    evidenceKind: "direct_visible",
    boundaryState: "physical_wall",
    collisionEligible: true,
    startEndpoint: { status: "visible", frameContact: "no_frame_contact" },
    endEndpoint: { status: "visible", frameContact: "no_frame_contact" },
    notes: "Synthetic contract probe only; this is not holdout oracle evidence.",
    ...overrides,
  };
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  throw new TypeError("non-JSON value");
}

test("P2-S2B authoring binds B/D fixture shells to certified identity only", () => {
  for (const roomId of ROOMS) {
    const identity = getP2S2BHoldoutOracleIdentity(roomId);
    const fixture = buildP2S2BHoldoutOracleFixture(
      roomId,
      [contractProbe("contract-probe")]
    );
    assert.equal(fixture.roomId, identity.roomId);
    assert.equal(fixture.emptyImage.sha256, identity.emptySha256);
    assert.deepEqual(fixture.emptyImage.dimensions, identity.emptyDimensions);
    assert.equal(fixture.emptyImage.generatorId, identity.generatorId);
    assert.equal(
      fixture.emptyImage.generatedFromOriginalSha256,
      identity.originalSha256
    );
    assert.equal(fixture.emptyImage.manifestFileName, identity.manifestFileName);
  }
});

test("P2-S2B authoring output strictly reuses the P2-S1 oracle parser", () => {
  for (const roomId of ROOMS) {
    const parsed = parseEmptyPhysicalBoundaryFixture(
      buildP2S2BHoldoutOracleFixture(
        roomId,
        [contractProbe("parser-contract-probe")]
      )
    );
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.reason);
  }
});

test("P2-S2B authoring fixes the evaluation corridor at exactly six source pixels", () => {
  assert.equal(P2_S2B_HOLDOUT_ORACLE_CORRIDOR_SOURCE_PX, 6);
  for (const roomId of ROOMS) {
    assert.equal(
      buildP2S2BHoldoutOracleFixture(
        roomId,
        [contractProbe("corridor-contract-probe")]
      ).evaluationCorridorSourcePx,
      6
    );
  }
});

test("P2-S2B open and unknown evidence is finite and non-collision", () => {
  for (const boundaryState of ["open", "unknown"] as const) {
    const annotation = contractProbe(`${boundaryState}-contract-probe`, {
      boundaryState,
      collisionEligible: false,
    });
    const validation = validateP2S2BHoldoutOracleDraft("room-b", [annotation]);
    assert.equal(validation.ok, true, validation.errors.join("; "));
    const fixture = buildP2S2BHoldoutOracleFixture("room-b", [annotation]);
    assert.equal(fixture.annotations[0].boundaryState, boundaryState);
    assert.equal(fixture.annotations[0].collisionEligible, false);
    assert.equal(fixture.annotations[0].pointsSourceNormalized.length, 2);
  }
});

test("P2-S2B authoring rejects invented collision and closed chains", () => {
  const invalidOpen = contractProbe("invalid-open", {
    boundaryState: "open",
    collisionEligible: true,
  });
  assert.equal(
    validateP2S2BHoldoutOracleDraft("room-b", [invalidOpen]).ok,
    false
  );
  const closed = contractProbe("closed-chain", {
    pointsSourcePx: [
      { x: 100, y: 500 },
      { x: 200, y: 500 },
      { x: 100, y: 500 },
    ],
  });
  assert.equal(
    validateP2S2BHoldoutOracleDraft("room-b", [closed]).ok,
    false
  );
});

test("P2-S2B occluded and frame-truncated endpoints authorize no continuation", () => {
  const beforeOccluder = contractProbe("before-occluder", {
    endEndpoint: { status: "occluded", frameContact: "no_frame_contact" },
  });
  const afterOccluder = contractProbe("after-occluder", {
    pointsSourcePx: [{ x: 300, y: 500 }, { x: 400, y: 500 }],
    startEndpoint: { status: "occluded", frameContact: "no_frame_contact" },
  });
  const frameSpan = contractProbe("frame-span", {
    pointsSourcePx: [{ x: 400, y: 500 }, { x: 1263, y: 700 }],
    endEndpoint: {
      status: "frame_truncated",
      frameContact: "contacts_frame",
    },
  });
  const fixture = buildP2S2BHoldoutOracleFixture(
    "room-b",
    [beforeOccluder, afterOccluder, frameSpan]
  );
  assert.equal(fixture.annotations.length, 3);
  assert.notDeepEqual(
    fixture.annotations[0].pointsSourceNormalized.at(-1),
    fixture.annotations[1].pointsSourceNormalized[0]
  );
  assert.equal(fixture.annotations[0].endEndpoint.status, "occluded");
  assert.equal(fixture.annotations[1].startEndpoint.status, "occluded");
  assert.equal(fixture.annotations[2].endEndpoint.status, "frame_truncated");
  assert.equal(
    fixture.annotations[2].endEndpoint.frameContact,
    "contacts_frame"
  );
  assert.equal(
    validateP2S2BHoldoutOracleDraft("room-b", [
      contractProbe("bad-frame", {
        endEndpoint: {
          status: "frame_truncated",
          frameContact: "no_frame_contact",
        },
      }),
    ]).ok,
    false
  );
});

test("P2-S2B source-pixel capture converts directly to normalized EMPTY space", () => {
  assert.deepEqual(
    sourcePixelToP2S2BHoldoutOracleNormalized(
      "room-b",
      { x: 1263, y: 847 }
    ),
    { x: 0.999209, y: 0.998821 }
  );
});

test("P2-S2B authoring image loader verifies exact EMPTY bytes and dimensions", async () => {
  for (const roomId of ROOMS) {
    const identity = getP2S2BHoldoutOracleIdentity(roomId);
    const result = await loadP2S2BHoldoutOracleEmptyImage(roomId);
    assert.equal(result.ok, true, result.ok ? undefined : result.code);
    if (!result.ok) continue;
    assert.equal(result.sha256, identity.emptySha256);
    assert.deepEqual(result.dimensions, identity.emptyDimensions);
    assert.equal(result.contentType, "image/png");
  }
});

test("P2-S2B authored fixtures require a complete pair and manual anchor locks", async () => {
  const fixtureNames = (await readdir(ORACLE_ROOT))
    .filter(name => name.endsWith(".json"))
    .sort();
  assert.ok(
    fixtureNames.length === 0 ||
    fixtureNames.join(",") === "room-b.json,room-d.json",
    "holdout oracle freeze must contain either no JSON or the complete B/D pair"
  );
  for (const fixtureName of fixtureNames) {
    const roomId = fixtureName.replace(".json", "") as P2S2BHoldoutOracleRoomId;
    const parsed = parseEmptyPhysicalBoundaryFixture(JSON.parse(
      await readFile(path.join(ORACLE_ROOT, fixtureName), "utf8")
    ) as unknown);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.reason);
    if (!parsed.ok) continue;
    const identity = getP2S2BHoldoutOracleIdentity(roomId);
    assert.equal(verifyEmptyPhysicalBoundaryFixtureIdentity(parsed.fixture, {
      sha256: identity.emptySha256,
      dimensions: identity.emptyDimensions,
    }), true);
    assert.equal(parsed.fixture.evaluationCorridorSourcePx, 6);
    const locks = MANUAL_ANCHOR_LOCKS[roomId];
    assert.ok(locks, `missing human-reviewed anchor locks for ${roomId}`);
    assert.deepEqual(
      parsed.fixture.annotations.map(annotation => annotation.id).sort(),
      Object.keys(locks ?? {}).sort()
    );
    for (const annotation of parsed.fixture.annotations) {
      const anchors: readonly Readonly<{ x: number; y: number }>[] | undefined =
        locks?.[annotation.id];
      assert.ok(anchors, `missing anchor lock for ${roomId}/${annotation.id}`);
      assert.deepEqual(
        annotation.pointsSourceNormalized.map(point => ({
          x: Math.round(point.x * identity.emptyDimensions.width),
          y: Math.round(point.y * identity.emptyDimensions.height),
        })),
        anchors
      );
    }
  }
});

test("P2-S2B authoring sources structurally exclude predictions, scoring, and product authority", async () => {
  const sourceFiles = [
    path.join(RESEARCH_ROOT, "p2-s2b-holdout-oracle-authoring.ts"),
    path.join(RESEARCH_ROOT, "p2-s2b-holdout-oracle-image.ts"),
    path.join(
      RESEARCH_ROOT,
      "p2-s2b-holdout-oracle-authoring",
      "HoldoutOracleAuthoringClient.tsx"
    ),
    path.join(
      RESEARCH_ROOT,
      "p2-s2b-holdout-oracle-authoring",
      "page.tsx"
    ),
    path.join(
      process.cwd(),
      "app",
      "api",
      "admin",
      "3d-room-lab",
      "p2-s2b-holdout-oracle-image",
      "route.ts"
    ),
  ];
  const forbidden = [
    "p2-s2b-holdout-prediction",
    "p2-s2b-holdout-predictions",
    "empty-visible-floor-region",
    "empty-region-boundary-fragments",
    "evaluateEmptyRegionBoundaryFragments",
    "P2_S2A_",
    "scene-state",
    "afc-sr1-live-product",
    "physical-room-envelope",
    "empty-to-world-xz",
    "callCompositor",
  ];
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${sourceFile}: ${token}`);
    }
  }
  const routeSource = await readFile(sourceFiles.at(-1)!, "utf8");
  assert.equal(routeSource.includes("getAuthenticatedAdminUser"), true);
  assert.equal(routeSource.includes('nodeEnv === "production"'), true);
});

test("P2-S2B prediction seal hashes remain canonically unchanged without geometry output", async () => {
  for (const roomId of ROOMS) {
    const predictionPath = path.join(
      RESEARCH_ROOT,
      "fixtures",
      "p2-s2b-holdout-predictions",
      `${roomId}.json`
    );
    const sidecarPath = `${predictionPath}.sha256`;
    const value = JSON.parse(await readFile(predictionPath, "utf8")) as unknown;
    const digest = createHash("sha256")
      .update(JSON.stringify(canonicalize(value)), "utf8")
      .digest("hex");
    const sidecar = (await readFile(sidecarPath, "utf8")).trim();
    assert.equal(digest, CERTIFIED_PREDICTION_HASHES[roomId]);
    assert.equal(sidecar, CERTIFIED_PREDICTION_HASHES[roomId]);
  }
});
