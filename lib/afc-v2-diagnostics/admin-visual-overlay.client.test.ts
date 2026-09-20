import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
  AFC_ADMIN_VISUAL_OVERLAY_VERSION,
  AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY,
  afcDiagnosticVisualOverlayBasisLabel,
  afcDiagnosticVisualOverlayCollisionAvailable,
  afcDiagnosticVisualOverlayErrorMessage,
  afcDiagnosticVisualOverlayFloorAvailable,
  afcDiagnosticVisualOverlayHasGeometry,
  buildAfcDiagnosticVisualOverlayUrl,
  createAfcDiagnosticVisualOverlayCoordinator,
  parseAfcAdminVisualOverlayV1,
} from "./admin-visual-overlay.client";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";

const validOverlay = {
  version: AFC_ADMIN_VISUAL_OVERLAY_VERSION,
  projectionVersion: AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
  artifactBasis: "original",
  frame: { width: 1200, height: 800 },
  floorQuad: {
    space: "source-normalized/v1",
    points: [
      { x: 0.1, y: 0.9 },
      { x: 0.9, y: 0.9 },
      { x: 0.7, y: 0.55 },
      { x: 0.3, y: 0.55 },
    ],
  },
  collisionEdges: [
    {
      id: "rb_right",
      points: [
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.9 },
      ],
    },
  ],
};

test("overlay URL is case+generation+artifact scoped", () => {
  assert.equal(
    buildAfcDiagnosticVisualOverlayUrl({
      caseId: CASE_1,
      generationId: GEN_1,
      kind: "empty",
    }),
    `/api/admin/afc-diagnostics/cases/${CASE_1}/generations/${GEN_1}/overlay?artifact=empty`,
  );
});

test("parser accepts the versioned DTO and ignores extra JSON fields", () => {
  const parsed = parseAfcAdminVisualOverlayV1({
    ...validOverlay,
    extra: true,
    floorQuad: {
      ...validOverlay.floorQuad,
      extraPointMeta: "nope",
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.version, AFC_ADMIN_VISUAL_OVERLAY_VERSION);
  assert.equal(parsed.artifactBasis, "original");
  assert.deepEqual(parsed.frame, { width: 1200, height: 800 });
  assert.equal(parsed.floorQuad?.points.length, 4);
  assert.equal(parsed.collisionEdges[0]?.id, "rb_right");
});

test("parser accepts null floor and empty collision arrays", () => {
  const parsed = parseAfcAdminVisualOverlayV1({
    ...validOverlay,
    artifactBasis: "empty",
    floorQuad: null,
    collisionEdges: [],
  });
  assert.ok(parsed);
  assert.equal(parsed.floorQuad, null);
  assert.deepEqual(parsed.collisionEdges, []);
  assert.equal(afcDiagnosticVisualOverlayFloorAvailable(parsed), false);
  assert.equal(afcDiagnosticVisualOverlayCollisionAvailable(parsed), false);
  assert.equal(afcDiagnosticVisualOverlayHasGeometry(parsed), false);
  assert.equal(
    afcDiagnosticVisualOverlayBasisLabel(parsed),
    AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.unavailable,
  );
});

test("parser rejects unknown versions, malformed frame, and invalid points", () => {
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      version: "afc-admin-visual-overlay/v0",
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      projectionVersion: "other",
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      artifactBasis: "overlay",
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      frame: { width: 0, height: 800 },
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      frame: { width: "1200", height: 800 },
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      floorQuad: {
        space: "source-normalized/v1",
        points: [{ x: 0.1, y: 0.9 }],
      },
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      floorQuad: {
        space: "world",
        points: validOverlay.floorQuad.points,
      },
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      collisionEdges: [{ id: "wall", points: [{ x: 1, y: 1 }] }],
    }),
    null,
  );
  assert.equal(
    parseAfcAdminVisualOverlayV1({
      ...validOverlay,
      collisionEdges: [{ id: "wall", points: [{ x: "0", y: 1 }, { x: 1, y: 1 }] }],
    }),
    null,
  );
});

test("basis labels distinguish ORIGINAL from identity UV", () => {
  const original = parseAfcAdminVisualOverlayV1(validOverlay);
  assert.equal(
    afcDiagnosticVisualOverlayBasisLabel(original),
    AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.originalBasis,
  );
  const empty = parseAfcAdminVisualOverlayV1({
    ...validOverlay,
    artifactBasis: "empty",
  });
  assert.equal(
    afcDiagnosticVisualOverlayBasisLabel(empty),
    AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.identityBasis,
  );
  const tiled = parseAfcAdminVisualOverlayV1({
    ...validOverlay,
    artifactBasis: "tiled",
  });
  assert.equal(
    afcDiagnosticVisualOverlayBasisLabel(tiled),
    AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.identityBasis,
  );
});

test("overlay coordinator aborts stale attempt and artifact tuples; retry stays current", () => {
  const coordinator = createAfcDiagnosticVisualOverlayCoordinator();
  const first = coordinator.begin({
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
  });
  const second = coordinator.begin({
    caseId: CASE_1,
    generationId: GEN_2,
    kind: "empty",
  });
  assert.equal(coordinator.isCurrent(first.seq, first.tuple), false);
  assert.equal(coordinator.isCurrent(second.seq, second.tuple), true);
  assert.equal(first.signal.aborted, true);

  const tiled = coordinator.begin({
    caseId: CASE_1,
    generationId: GEN_2,
    kind: "tiled",
  });
  assert.equal(coordinator.isCurrent(second.seq, second.tuple), false);
  assert.equal(tiled.tuple.kind, "tiled");
  assert.equal(second.signal.aborted, true);

  const retry = coordinator.retry();
  assert.equal(retry.started, true);
  if (!retry.started) throw new Error("retry should start");
  assert.equal(retry.tuple.generationId, GEN_2);
  assert.equal(retry.tuple.kind, "tiled");
  assert.equal(coordinator.isCurrent(tiled.seq, tiled.tuple), false);
  assert.equal(coordinator.isCurrent(retry.seq, retry.tuple), true);
});

test("overlay error mapping stays local and copy has no private field names", () => {
  assert.equal(
    afcDiagnosticVisualOverlayErrorMessage(401),
    "Session expired. Sign in again.",
  );
  assert.equal(
    afcDiagnosticVisualOverlayErrorMessage(403),
    "Admin access required.",
  );
  assert.equal(
    afcDiagnosticVisualOverlayErrorMessage(500),
    AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.error,
  );
  assert.equal(
    afcDiagnosticVisualOverlayErrorMessage("network"),
    AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.error,
  );
  assert.doesNotMatch(
    JSON.stringify(AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY),
    /production_authority|frozenCamera|sourceNormalizedPolygon|signedUrl/,
  );
});
