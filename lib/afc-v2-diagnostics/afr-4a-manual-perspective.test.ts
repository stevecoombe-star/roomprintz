import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import path from "node:path";
import test from "node:test";

import type { AfcDiagnosticsAdminAuth } from "./admin-auth.server";
import {
  canonicalWorldRectangle,
  imagePointsEqual,
  imagePointsFromQuad,
  MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD,
  manualPerspectiveBootstrapQuad,
  manualPerspectiveImageQuadValid,
  replaceManualPerspectiveImageCoordinate,
  type ManualPerspectiveCorner,
} from "./manual-perspective-geometry";
import {
  commitManualPerspectiveSolve,
  editManualPerspectiveCoordinate,
  editManualPerspectivePoint,
  MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS,
  MANUAL_PERSPECTIVE_PROVISIONAL_REFERENCE_DEPTH_M,
  manualPerspectiveApplyAllowed,
  manualPerspectiveDiagnosticRows,
  manualPerspectiveStageApplyAllowed,
  openManualPerspectiveBootstrapSession,
  openManualPerspectiveSession,
  readManualPerspectiveBootstrap,
  parseManualPerspectiveCoordinate,
  parseManualPerspectiveRecord,
  readAutomaticPerspectiveBaseline,
  revertManualPerspectiveSession,
} from "./manual-perspective";
import type { ManualPerspectiveSolveResult } from "./manual-perspective-solve";
import {
  handleManualPerspectiveGet,
  handleManualPerspectivePost,
  type ManualPerspectiveGenerationRow,
  type ManualPerspectiveStore,
} from "./manual-perspective.server";
import { solveManualPerspectiveCalibration } from "./manual-perspective-solve";
import { AFC_V2_REFERENCE_DEPTH_M } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { createPi3aAuthority } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import {
  mapSceneObjectsBetweenCameras,
  remapCanonicalFloorPoint,
  remapCollisionWalls,
} from "@/lib/afc-v2-runtime/effective-floor-remap";
import { resolveEffectiveProductionAuthority } from "@/lib/afc-v2-runtime/effective-production-authority";
import { DEFAULT_WORLD_TRANSFORM } from "@/lib/afc-v2-runtime/types";

const ROOT = process.cwd();
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const LIVE = [
  { x: 0.10345641758985938, y: 0.8502281159111699 },
  { x: 0.285650487293239, y: 0.7847795955191518 },
  { x: 0.22908210999228484, y: 0.7216762120066194 },
  { x: 0.08215266106703666, y: 0.7655805115886138 },
] as const;
const FRAME = { width: 1144, height: 1534 };
const RATIO = 0.72;
const DEPTH = 4;
const FOV = 84.9;

const SOLVE_SOURCE = readFileSync(
  path.join(ROOT, "lib/afc-v2-diagnostics/manual-perspective-solve.ts"),
  "utf8",
);
const UI = readFileSync(
  path.join(ROOT, "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective.tsx"),
  "utf8",
);
const VISUAL = readFileSync(
  path.join(ROOT, "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx"),
  "utf8",
);
const RUNTIME = readFileSync(
  path.join(ROOT, "lib/afc-v2-production/production-adapter.server.ts"),
  "utf8",
);
const THUMBNAIL = readFileSync(
  path.join(ROOT, "lib/vibode-thumbnail-render/payload.server.ts"),
  "utf8",
);
const SCENE = readFileSync(
  path.join(ROOT, "app/api/vibode/3d-scene/route.ts"),
  "utf8",
);

function fullAuthority() {
  const base = createPi3aAuthority({
    generationId: GENERATION_ID,
    frame: FRAME,
    floor: { worldWidthM: RATIO * DEPTH, referenceDepthM: DEPTH },
    verticalFovDeg: FOV,
  });
  return {
    ...base,
    floor: {
      ...base.floor,
      sourceNormalizedPolygon: LIVE.map((point) => ({ x: point.x, y: point.y })),
    },
  };
}

function row(manualPerspective: unknown = null): ManualPerspectiveGenerationRow {
  return {
    id: GENERATION_ID,
    roomId: CASE_ID,
    userId: USER_ID,
    status: "ready",
    frameWidth: FRAME.width,
    frameHeight: FRAME.height,
    originalDecodedWidth: FRAME.width,
    originalDecodedHeight: FRAME.height,
    productionAuthority: fullAuthority(),
    settleDecision: { marker: "automatic-settle" },
    cameraRealizability: { marker: "automatic-camera" },
    artifactLineage: { marker: "automatic-lineage" },
    manualPerspective,
  };
}

class MemoryStore implements ManualPerspectiveStore {
  saves = 0;
  constructor(public generation: ManualPerspectiveGenerationRow | null) {}
  async loadGeneration() {
    return this.generation;
  }
  async saveManualPerspective(
    _generationId: string,
    record: NonNullable<ManualPerspectiveGenerationRow["manualPerspective"]>,
  ) {
    if (!this.generation) throw new Error("missing generation");
    this.saves += 1;
    this.generation = { ...this.generation, manualPerspective: record };
  }
}

function baseline() {
  const value = readAutomaticPerspectiveBaseline({
    generationId: GENERATION_ID,
    status: "ready",
    frameWidth: FRAME.width,
    frameHeight: FRAME.height,
    originalDecodedWidth: FRAME.width,
    originalDecodedHeight: FRAME.height,
    productionAuthority: fullAuthority(),
  });
  assert.ok(value);
  return value!;
}

function authorize(ok: boolean): () => Promise<AfcDiagnosticsAdminAuth> {
  return async () =>
    ok
      ? { ok: true, admin: { userId: USER_ID, email: "qa@example.com" } }
      : {
          ok: false,
          response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
        };
}

test("opening manual perspective loads the automatic image quad and does not write", () => {
  const automatic = baseline();
  const expected = imagePointsFromQuad(LIVE);
  assert.ok(expected);
  assert.equal(imagePointsEqual(automatic.imagePoints, expected), true);
  assert.equal(automatic.verticalFovDeg, FOV);
  assert.equal(automatic.referenceDepthM, DEPTH);
  const session = openManualPerspectiveSession(automatic, null);
  assert.equal(imagePointsEqual(session.imagePoints, automatic.imagePoints), true);
  assert.equal(session.solution, null);
  assert.equal(session.status, "solving");
});

test("the solver keeps every edited image coordinate", () => {
  const automatic = baseline();
  let points = automatic.imagePoints;
  const corners: ManualPerspectiveCorner[] = ["NL", "NR", "FR", "FL"];
  for (const corner of corners) {
    for (const axis of ["x", "y"] as const) {
      points = replaceManualPerspectiveImageCoordinate(
        points,
        corner,
        axis,
        points[corner][axis] + 0.002,
      );
    }
  }
  const solved = solveManualPerspectiveCalibration({
    imagePoints: points,
    sourceImageSize: automatic.sourceImageSize,
    frameSize: automatic.frameSize,
    referenceDepthM: automatic.referenceDepthM,
  });
  assert.equal(imagePointsEqual(solved.imagePoints, points), true);
});

test("a valid manual quad updates ratio, FOV, and the centered world rectangle", () => {
  const automatic = baseline();
  const edited = editManualPerspectiveCoordinate(
    openManualPerspectiveSession(automatic, null),
    "NL",
    "x",
    automatic.imagePoints.NL.x + 0.004,
  );
  const solved = solveManualPerspectiveCalibration({
    imagePoints: edited.imagePoints,
    sourceImageSize: automatic.sourceImageSize,
    frameSize: automatic.frameSize,
    referenceDepthM: automatic.referenceDepthM,
  });
  assert.equal(solved.status, "converged");
  assert.equal(solved.applySafe, true);
  assert.ok(solved.worldRectangle);
  assert.equal(solved.worldRectangle.referenceDepthM, DEPTH);
  assert.notEqual(solved.worldRectangle.widthDepthRatio, RATIO);
  assert.notEqual(solved.verticalFovDeg, FOV);
  assert.ok(solved.pose);
  const rectangle = canonicalWorldRectangle(
    solved.worldRectangle.worldWidthM,
    solved.worldRectangle.referenceDepthM,
  );
  assert.deepEqual(solved.worldRectangle.corners, rectangle?.corners);
  console.log(JSON.stringify({
    elapsedMs: Number(solved.elapsedMs.toFixed(3)),
    iterations: solved.iterationCount,
    fov: solved.verticalFovDeg,
    ratio: solved.worldRectangle.widthDepthRatio,
  }));
});

test("a later solve request cannot commit over a newer edit", () => {
  const automatic = baseline();
  const session = openManualPerspectiveSession(automatic, null);
  const first = editManualPerspectiveCoordinate(session, "NL", "x", 0.2);
  const second = editManualPerspectiveCoordinate(first, "NL", "x", 0.22);
  const stale = solveManualPerspectiveCalibration({
    imagePoints: first.imagePoints,
    sourceImageSize: automatic.sourceImageSize,
    frameSize: automatic.frameSize,
    referenceDepthM: DEPTH,
  });
  const committed = commitManualPerspectiveSolve(second, first.solveRequestId, stale);
  assert.equal(committed, second);
  assert.equal(committed.imagePoints.NL.x, 0.22);
});

test("an invalid image quad stays editable and blocks apply", () => {
  const automatic = baseline();
  const collapsed = editManualPerspectiveCoordinate(
    openManualPerspectiveSession(automatic, null),
    "NR",
    "x",
    automatic.imagePoints.NL.x,
  );
  const solved = solveManualPerspectiveCalibration({
    imagePoints: collapsed.imagePoints,
    sourceImageSize: automatic.sourceImageSize,
    frameSize: automatic.frameSize,
    referenceDepthM: DEPTH,
  });
  const committed = commitManualPerspectiveSolve(collapsed, collapsed.solveRequestId, solved);
  assert.equal(committed.status, "unrealizable");
  assert.equal(committed.imagePoints.NR.x, automatic.imagePoints.NL.x);
  assert.equal(manualPerspectiveApplyAllowed(committed), false);
});

test("revert restores the image quad from when editing opened", () => {
  const automatic = baseline();
  const opened = openManualPerspectiveSession(automatic, null);
  const edited = editManualPerspectiveCoordinate(opened, "FL", "y", 0.5);
  const reverted = revertManualPerspectiveSession(edited);
  assert.equal(imagePointsEqual(reverted.imagePoints, opened.openedPoints), true);
  assert.equal(imagePointsEqual(reverted.imagePoints, automatic.imagePoints), true);
});

test("malformed coordinates are rejected", () => {
  assert.equal(parseManualPerspectiveCoordinate("").ok, false);
  assert.equal(parseManualPerspectiveCoordinate("1e2").ok, false);
  assert.equal(parseManualPerspectiveCoordinate("0.25").ok, true);
});

test("GET does not write, and a non-QA caller receives no floor geometry", async () => {
  const store = new MemoryStore(row());
  const denied = await handleManualPerspectiveGet({
    request: new Request("http://local/manual"),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "off" },
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(store.saves, 0);
  const body = await denied.json();
  assert.equal(body.error, "QA access required.");
  assert.equal("imagePoints" in body, false);
});

test("apply persists a manual record and leaves automatic evidence in place", async () => {
  const store = new MemoryStore(row());
  const automatic = baseline();
  const edited = replaceManualPerspectiveImageCoordinate(
    automatic.imagePoints,
    "NL",
    "x",
    automatic.imagePoints.NL.x + 0.004,
  );
  const response = await handleManualPerspectivePost({
    request: new Request("http://local/manual", {
      method: "POST",
      body: JSON.stringify({ imagePoints: edited }),
    }),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
      now: () => "2026-09-30T00:00:00.000Z",
    },
  });
  assert.equal(response.status, 200);
  const generation = store.generation;
  assert.ok(generation);
  const production = generation.productionAuthority;
  assert.equal(recordMarker(generation.settleDecision), "automatic-settle");
  assert.equal(recordMarker(generation.cameraRealizability), "automatic-camera");
  assert.equal(recordMarker(generation.artifactLineage), "automatic-lineage");
  assert.equal(generation.productionAuthority, production);
  const parsed = parseManualPerspectiveRecord(store.generation?.manualPerspective);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.record) return;
  assert.equal(parsed.record.perspectiveSource, "manual");
  assert.equal(parsed.record.baseGenerationId, GENERATION_ID);
  assert.equal(parsed.record.adjustedSourceQuad[0]?.x, edited.NL.x);
  assert.equal(parsed.record.derivedFloor.referenceDepthM, DEPTH);
  const effective = resolveEffectiveProductionAuthority(fullAuthority(), parsed.record);
  assert.equal(effective.kind, "manual");
  assert.equal(effective.authority.metric.metricScale, fullAuthority().metric.metricScale);
  assert.equal(effective.authority.floor.referenceDepthM, DEPTH);
  assert.notEqual(effective.authority.floor.worldWidthM, fullAuthority().floor.worldWidthM);
  assert.equal(effective.authority.floor.sourceNormalizedPolygon[0]?.x, edited.NL.x);
  assert.notEqual(
    effective.authority.frozenCamera.verticalFovDeg,
    fullAuthority().frozenCamera.verticalFovDeg,
  );
  assert.notDeepEqual(effective.authority.collision.walls, fullAuthority().collision.walls);
  assert.deepEqual(fullAuthority().collision.walls, fullAuthority().collision.walls);
  const automaticAuthority = fullAuthority();
  assert.equal(automaticAuthority.floor.sourceNormalizedPolygon[0]?.x, LIVE[0].x);
});

test("an unrealizable apply does not replace the automatic perspective", async () => {
  const store = new MemoryStore(row());
  const automatic = baseline();
  const collapsed = {
    ...automatic.imagePoints,
    NR: { ...automatic.imagePoints.NL },
    FR: { ...automatic.imagePoints.FL },
  };
  const response = await handleManualPerspectivePost({
    request: new Request("http://local/manual", {
      method: "POST",
      body: JSON.stringify({ imagePoints: collapsed }),
    }),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
    },
  });
  assert.equal(response.status, 409);
  assert.equal(store.saves, 0);
  assert.equal(store.generation?.manualPerspective, null);
});

test("no manual record leaves the automatic authority unchanged", () => {
  const automatic = fullAuthority();
  const resolved = resolveEffectiveProductionAuthority(automatic, null);
  assert.equal(resolved.kind, "automatic");
  assert.equal(resolved.authority, automatic);
});

test("effective walls and furniture stay on the manual camera's floor", async () => {
  const store = new MemoryStore(row());
  const automatic = baseline();
  const edited = replaceManualPerspectiveImageCoordinate(
    automatic.imagePoints,
    "NL",
    "x",
    automatic.imagePoints.NL.x + 0.004,
  );
  const response = await handleManualPerspectivePost({
    request: new Request("http://local/manual", {
      method: "POST",
      body: JSON.stringify({ imagePoints: edited }),
    }),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
      now: () => "2026-09-30T00:00:00.000Z",
    },
  });
  assert.equal(response.status, 200);
  const automaticAuthority = fullAuthority();
  const effective = resolveEffectiveProductionAuthority(
    automaticAuthority,
    store.generation?.manualPerspective,
  );
  assert.equal(effective.kind, "manual");
  const walls = remapCollisionWalls(
    automaticAuthority.collision.walls,
    automaticAuthority.frozenCamera,
    effective.authority.frozenCamera,
  );
  assert.deepEqual(walls, effective.authority.collision.walls);
  const automaticWall = automaticAuthority.collision.walls[0];
  const effectiveWall = effective.authority.collision.walls[0];
  assert.ok(automaticWall && effectiveWall);
  const returned = remapCanonicalFloorPoint(
    effectiveWall.a,
    effective.authority.frozenCamera,
    automaticAuthority.frozenCamera,
  );
  assert.ok(returned);
  assert.ok(Math.abs(returned.x - automaticWall.a.x) < 1e-5);
  assert.ok(Math.abs(returned.z - automaticWall.a.z) < 1e-5);
  assert.ok(Math.abs(
    effective.authority.floor.worldWidthM -
      effective.authority.floor.widthDepthRatio * effective.authority.floor.referenceDepthM,
  ) < 1e-9);
  const furniture = mapSceneObjectsBetweenCameras(
    [{ objectId: "sofa", assetId: "sofa", transform: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0.2, y: 0, z: 0.3 },
      rotationDeg: { x: 0, y: 18, z: 0 },
    } }],
    automaticAuthority.frozenCamera,
    effective.authority.frozenCamera,
  );
  assert.ok(furniture);
  assert.notEqual(furniture[0]?.transform.position.x, 0.2);
  const identity = mapSceneObjectsBetweenCameras(
    furniture,
    effective.authority.frozenCamera,
    automaticAuthority.frozenCamera,
  );
  assert.ok(identity);
  assert.ok(Math.abs((identity[0]?.transform.position.x ?? 0) - 0.2) < 1e-6);
  assert.ok(Math.abs((identity[0]?.transform.position.z ?? 0) - 0.3) < 1e-6);
});

test("thumbnail and STAGE resolve the same effective authority", () => {
  assert.match(RUNTIME, /resolveEffectiveProductionAuthority\(/);
  assert.match(THUMBNAIL, /resolveEffectiveProductionAuthority\(/);
  assert.match(THUMBNAIL, /mapSceneObjectsBetweenCameras\(/);
  assert.match(SCENE, /mapSceneObjectsBetweenCameras\(/);
  assert.match(SCENE, /resolveEffectiveProductionAuthority\(/);
  const automatic = fullAuthority();
  const resolved = resolveEffectiveProductionAuthority(automatic, null);
  assert.equal(resolved.authority.frozenCamera, automatic.frozenCamera);
  assert.equal(resolved.authority.collision, automatic.collision);
  assert.equal(resolved.authority.floor, automatic.floor);
});

test("manual perspective reuses production settle and stays out of the diagnostics API folder", () => {
  assert.match(SOLVE_SOURCE, /settleAfcFixedSeamCalibrationWithRatioExtension\(/);
  assert.match(SOLVE_SOURCE, /evaluateQuadSolvability\(/);
  assert.doesNotMatch(SOLVE_SOURCE, /evaluateRatioFovCell\(/);
  const diagnosticRoutes = readdirSync(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(diagnosticRoutes.includes("afc-manual-perspective"), false);
  assert.match(UI, /manualPerspectiveControlVisible/);
  assert.match(UI, /imagePoints/);
  assert.doesNotMatch(VISUAL, /frozenCamera|sourceNormalizedPolygon|productionAuthority|production_authority/);
  assert.doesNotMatch(UI, /sourceNormalizedPolygon|frozenCamera|productionAuthority/);
});

function recordMarker(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("marker" in value)) return null;
  return value.marker;
}

function failedFrameRow(overrides: Partial<ManualPerspectiveGenerationRow> = {}) {
  return {
    ...row(),
    status: "failed",
    productionAuthority: null,
    ...overrides,
  };
}

test("bootstrap quad is a deterministic visible floor trapezoid", () => {
  const quad = manualPerspectiveBootstrapQuad();
  assert.deepEqual(quad, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD);
  assert.deepEqual(manualPerspectiveBootstrapQuad(), quad);
  assert.equal(manualPerspectiveImageQuadValid(quad), true);
  assert.deepEqual(
    ["NL", "NR", "FR", "FL"].map((corner) => quad[corner as ManualPerspectiveCorner].y > 0.5),
    [true, true, true, true],
  );
  assert.ok(quad.NL.y > quad.FL.y);
  assert.ok(quad.NR.y > quad.FR.y);
  assert.ok(quad.NR.x - quad.NL.x > quad.FR.x - quad.FL.x);
  for (const corner of ["NL", "NR", "FR", "FL"] as const) {
    assert.ok(quad[corner].x > 0 && quad[corner].x < 1);
    assert.ok(quad[corner].y > 0 && quad[corner].y < 1);
  }
  assert.equal(
    MANUAL_PERSPECTIVE_PROVISIONAL_REFERENCE_DEPTH_M,
    AFC_V2_REFERENCE_DEPTH_M,
  );
});

test("a failed generation with a frame opens a diagnostic bootstrap and cannot drive STAGE", async () => {
  const store = new MemoryStore(failedFrameRow());
  const response = await handleManualPerspectiveGet({
    request: new Request("http://local/manual"),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.automatic, null);
  assert.equal(body.runtime, "diagnostic_only");
  assert.equal(body.bootstrap.referenceDepthM, AFC_V2_REFERENCE_DEPTH_M);
  assert.equal(body.bootstrap.imagePoints.NL.x, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD.NL.x);
  const session = openManualPerspectiveBootstrapSession(
    readManualPerspectiveBootstrap({
      generationId: GENERATION_ID,
      frameWidth: FRAME.width,
      frameHeight: FRAME.height,
      originalDecodedWidth: FRAME.width,
      originalDecodedHeight: FRAME.height,
      productionAuthority: null,
      authorityComplete: false,
      authorityReferenceDepthM: null,
    })!,
    null,
  );
  const moved = editManualPerspectivePoint(session, "NL", 0.3, 0.88);
  assert.equal(moved.imagePoints.NL.x, 0.3);
  assert.equal(manualPerspectiveStageApplyAllowed(moved), false);
  const reverted = revertManualPerspectiveSession(moved);
  assert.equal(imagePointsEqual(reverted.imagePoints, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD), true);

  const appliedPoints = {
    ...manualPerspectiveBootstrapQuad(),
    FL: { x: 0.4, y: 0.6 },
  };
  const reopened = openManualPerspectiveBootstrapSession({
    generationId: GENERATION_ID,
    imagePoints: MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD,
    referenceDepthM: AFC_V2_REFERENCE_DEPTH_M,
    sourceImageSize: { width: FRAME.width, height: FRAME.height },
    frameSize: { width: FRAME.width, height: FRAME.height },
    runtime: "diagnostic_only",
  }, appliedPoints);
  const editedApplied = editManualPerspectiveCoordinate(reopened, "NR", "x", 0.7);
  assert.equal(
    imagePointsEqual(revertManualPerspectiveSession(editedApplied).imagePoints, reopened.openedPoints),
    true,
  );

  const post = await handleManualPerspectivePost({
    request: new Request("http://local/manual", {
      method: "POST",
      body: JSON.stringify({ imagePoints: imagePointsFromQuad(LIVE) }),
    }),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
    },
  });
  assert.equal(post.status, 409);
  assert.equal((await post.json()).code, "diagnostic_only");
  assert.equal(store.saves, 0);
  assert.equal(store.generation?.productionAuthority, null);
});

test("a generation with no image frame keeps Manual Perspective unavailable", async () => {
  const store = new MemoryStore(failedFrameRow({
    frameWidth: null,
    frameHeight: null,
    originalDecodedWidth: null,
    originalDecodedHeight: null,
  }));
  const response = await handleManualPerspectiveGet({
    request: new Request("http://local/manual"),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.automatic, null);
  assert.equal(body.bootstrap, null);
  assert.equal(body.runtime, "unavailable");
});

test("a ready authority with no source quad can bootstrap onto the existing production authority", async () => {
  const generation = row();
  const authority = generation.productionAuthority;
  assert.ok(authority && typeof authority === "object");
  const brokenAuthority = {
    ...(authority as Record<string, unknown>),
    floor: {
      ...(authority as { floor: Record<string, unknown> }).floor,
      sourceNormalizedPolygon: [],
    },
  };
  const store = new MemoryStore({
    ...generation,
    productionAuthority: brokenAuthority,
  });
  const automatic = imagePointsFromQuad(LIVE);
  assert.ok(automatic);
  const edited = replaceManualPerspectiveImageCoordinate(automatic, "NL", "x", automatic.NL.x + 0.004);
  const response = await handleManualPerspectivePost({
    request: new Request("http://local/manual", {
      method: "POST",
      body: JSON.stringify({ imagePoints: edited }),
    }),
    caseId: CASE_ID,
    generationId: GENERATION_ID,
    dependencies: {
      authorize: authorize(true),
      store,
      env: { VIBODE_AFC_QA_MODE: "all" },
      now: () => "2026-09-30T00:00:00.000Z",
    },
  });
  assert.equal(response.status, 200);
  const parsed = parseManualPerspectiveRecord(store.generation?.manualPerspective);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.record) return;
  assert.equal(parsed.record.origin, "manual_quad_bootstrap");
  assert.equal(parsed.record.originalSourceQuad, null);
  assert.equal(parsed.record.initialBootstrapQuad?.[0]?.x, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD.NL.x);
  assert.equal(parsed.record.adjustedSourceQuad[0]?.x, edited.NL.x);
  const stored = store.generation?.productionAuthority as { floor: { sourceNormalizedPolygon: unknown[] } };
  assert.equal(stored.floor.sourceNormalizedPolygon.length, 0);
  const effective = resolveEffectiveProductionAuthority(
    store.generation?.productionAuthority as ReturnType<typeof fullAuthority>,
    parsed.record,
  );
  assert.equal(effective.kind, "manual");
  assert.equal(effective.authority.floor.sourceNormalizedPolygon[0]?.x, edited.NL.x);
  assert.equal(effective.authority.metric.metricScale, fullAuthority().metric.metricScale);
  assert.equal(effective.authority.floor.referenceDepthM, DEPTH);
});

function completedSession() {
  const automatic = baseline();
  const opened = openManualPerspectiveSession(automatic, null);
  const rectangle = canonicalWorldRectangle(RATIO * DEPTH, DEPTH);
  assert.ok(rectangle);
  const solution: ManualPerspectiveSolveResult = {
    status: "converged",
    imagePoints: opened.imagePoints,
    worldRectangle: rectangle,
    verticalFovDeg: FOV,
    pose: {
      position: { x: 0, y: 1.6, z: 4 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    objectivePx: 0.42,
    iterationCount: 11,
    convergenceReason: "apply_safe",
    elapsedMs: 21.5,
    applySafe: true,
  };
  return commitManualPerspectiveSolve(opened, opened.solveRequestId, solution);
}

function rowValue(
  rows: ReturnType<typeof manualPerspectiveDiagnosticRows>,
  label: (typeof MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS)[number],
) {
  return rows.find((row) => row.label === label)?.value;
}

test("a pending solve keeps the last diagnostics and the dragged point", () => {
  const solved = completedSession();
  const draggedX = solved.imagePoints.FL.x + 0.004;
  const draggedY = solved.imagePoints.FL.y - 0.002;
  const pending = editManualPerspectivePoint(solved, "FL", draggedX, draggedY);
  assert.equal(pending.status, "solving");
  assert.equal(pending.solution, solved.solution);
  assert.equal(pending.imagePoints.FL.x, draggedX);
  assert.equal(pending.imagePoints.FL.y, draggedY);
  assert.equal(manualPerspectiveApplyAllowed(pending), false);
  const rows = manualPerspectiveDiagnosticRows(pending);
  assert.deepEqual(rows.map((row) => row.label), [...MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS]);
  assert.equal(rowValue(rows, "Solver"), "Solving…");
  assert.equal(rowValue(rows, "FOV"), "84.9°");
  assert.equal(rowValue(rows, "Width : Depth"), "0.720");
  assert.equal(rowValue(rows, "Error"), "0.4200 px");
  assert.equal(rowValue(rows, "Iterations"), "11");
  assert.equal(rowValue(rows, "Convergence"), "apply_safe");
  assert.equal(rowValue(rows, "Camera height"), "1.600 m");
  assert.equal(rowValue(rows, "Solve time"), "21.50 ms");
  assert.equal(pending.imagePoints.FL.x, draggedX);
  assert.equal(pending.imagePoints.FL.y, draggedY);
});

test("a completed solve replaces diagnostics together and unrealizable keeps every row", () => {
  const solved = completedSession();
  const pending = editManualPerspectiveCoordinate(
    solved,
    "NL",
    "x",
    solved.imagePoints.NL.x + 0.004,
  );
  const rectangle = canonicalWorldRectangle(3.12, DEPTH);
  assert.ok(rectangle);
  const next = commitManualPerspectiveSolve(pending, pending.solveRequestId, {
    status: "converged",
    imagePoints: pending.imagePoints,
    worldRectangle: rectangle,
    verticalFovDeg: 88.4,
    pose: {
      position: { x: -1, y: 9.144, z: 14 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    objectivePx: 0.81,
    iterationCount: 20,
    convergenceReason: "apply_safe",
    elapsedMs: 19,
    applySafe: true,
  });
  const completedRows = manualPerspectiveDiagnosticRows(next);
  assert.deepEqual(
    completedRows.map((row) => row.label),
    [...MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS],
  );
  assert.equal(rowValue(completedRows, "Solver"), "Converged");
  assert.equal(rowValue(completedRows, "FOV"), "88.4°");
  assert.equal(rowValue(completedRows, "Width : Depth"), "0.780");
  assert.equal(rowValue(completedRows, "Camera height"), "9.144 m");

  const unrealizable = commitManualPerspectiveSolve(pending, pending.solveRequestId, {
    status: "unrealizable",
    imagePoints: pending.imagePoints,
    worldRectangle: null,
    verticalFovDeg: null,
    pose: null,
    objectivePx: null,
    iterationCount: 12,
    convergenceReason: "no_apply_safe_candidate",
    elapsedMs: 18,
    applySafe: false,
  });
  const unrealizableRows = manualPerspectiveDiagnosticRows(unrealizable);
  assert.deepEqual(
    unrealizableRows.map((row) => row.label),
    [...MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS],
  );
  assert.equal(rowValue(unrealizableRows, "Solver"), "Unrealizable");
  assert.equal(rowValue(unrealizableRows, "FOV"), "—");
  assert.equal(rowValue(unrealizableRows, "Width : Depth"), "—");
  assert.equal(rowValue(unrealizableRows, "Error"), "—");
  assert.equal(rowValue(unrealizableRows, "Camera height"), "—");
  assert.equal(rowValue(unrealizableRows, "Iterations"), "12");
  assert.equal(rowValue(unrealizableRows, "Convergence"), "no_apply_safe_candidate");
  assert.equal(unrealizable.imagePoints.NL.x, pending.imagePoints.NL.x);
  assert.equal(manualPerspectiveApplyAllowed(unrealizable), false);
});

test("a stale solve cannot replace retained diagnostics or the newer point", () => {
  const solved = completedSession();
  const first = editManualPerspectivePoint(solved, "NL", solved.imagePoints.NL.x + 0.004, solved.imagePoints.NL.y);
  const second = editManualPerspectivePoint(first, "NL", first.imagePoints.NL.x + 0.004, first.imagePoints.NL.y);
  const rectangle = canonicalWorldRectangle(3.12, DEPTH);
  assert.ok(rectangle);
  const kept = commitManualPerspectiveSolve(second, first.solveRequestId, {
    status: "converged",
    imagePoints: first.imagePoints,
    worldRectangle: rectangle,
    verticalFovDeg: 11,
    pose: {
      position: { x: 0, y: 3, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    objectivePx: 9,
    iterationCount: 99,
    convergenceReason: "stale",
    elapsedMs: 99,
    applySafe: true,
  });
  assert.equal(kept, second);
  assert.equal(kept.solution, solved.solution);
  assert.equal(kept.imagePoints.NL.x, second.imagePoints.NL.x);
  const rows = manualPerspectiveDiagnosticRows(kept);
  assert.equal(rowValue(rows, "Solver"), "Solving…");
  assert.equal(rowValue(rows, "FOV"), "84.9°");
});
