import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../3d-room-lab/calibrated-camera-readonly-projection";
import {
  deriveAutoMetricScale,
  evaluateTrustedBackWallWidthSpan,
} from "./metric-auto-scale";
import {
  AUTO_METRIC_CANONICAL_LENGTH_EPSILON,
  AUTO_METRIC_LAB_TRUST_LABEL,
  AUTO_METRIC_PHYSICAL_SOURCE_KIND,
  AUTO_METRIC_SCALE_AUTHORITY,
  AUTO_METRIC_SCALE_EXPERIMENTAL_COPY,
  AUTO_METRIC_SCALE_SANITY_MAX,
  AUTO_METRIC_SCALE_SANITY_MIN,
  AUTO_METRIC_SCALE_SOURCE_COPY,
  AUTO_METRIC_SOURCE_PRECEDENCE,
  AUTO_METRIC_UNRELIABLE_COPY,
  deriveUniformMetricScaleFromPhysicalSpan,
  formatAutoMetricScale,
  type AutoMetricS4aSafetyEvidence,
} from "./metric-auto-scale-contract";
import { acceptMetricRoomPrior } from "./metric-room-prior-acceptance";
import {
  buildMetricRoomPriorReceipt,
  parseMetricRoomPriorModelEstimate,
  type MetricRoomPriorModelEstimate,
  type MetricRoomPriorReceipt,
} from "./metric-room-prior-contract";
import {
  METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
  type MetricCorrespondenceSpan,
} from "./metric-correspondence-span-contract";
import { TEST_CUBE_PLACEMENT_LOCAL_AABB } from "./room-collision-footprint";
import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import {
  DEFAULT_WORLD_TRANSFORM,
  TEST_CUBE_EDGE_M,
} from "./scene-layer-state";
import {
  AUTO_METRIC_SCALE,
  computeMetricScale,
  createMetricRealizationMetadata,
  realizeCameraPose,
  realizeCollisionWalls,
  realizeFloorRectangle,
  realizeObjectWorldTransform,
} from "./scene-metric-world-realization";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
} from "./scene-object-runtime";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const V1_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab");
const PROJECTION_EPS = 1e-6;

function readV2(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const ROOM4_LIVE_CANONICAL_LENGTH = 9.582188;
const ROOM4_EARLIER_CANONICAL_LENGTH = 13.949164;
const ROOM4_WIDTH_M = 3.6;
const ROOM4_LIVE_AUTO = ROOM4_WIDTH_M / ROOM4_LIVE_CANONICAL_LENGTH;
const ROOM4_EARLIER_AUTO = ROOM4_WIDTH_M / ROOM4_EARLIER_CANONICAL_LENGTH;
const S4A_SAFE: AutoMetricS4aSafetyEvidence = Object.freeze({
  observedSpanOnly: true,
  hiddenContinuation: false,
  geometryManufactured: false,
});

const canonicalFloor = { worldWidthM: 6, referenceDepthM: 4 };
const canonicalCameraPose = {
  position: { x: 1.25, y: 2.5, z: 3.75 },
  lookAt: { x: 0.25, y: 0.5, z: -0.75 },
  up: { x: 0, y: 1, z: 0 },
};
const xWallAt2: RoomCollisionEnabledWall = {
  id: "rb_right",
  sourceBoundaryId: "rb_right",
  sourceSeamId: "right_floor_wall",
  a: { x: 2, z: -4 },
  b: { x: 2, z: 4 },
  supportPlaneNormal: { x: 1, y: 0, z: 0 },
  supportPlaneConstant: -2,
  sideSign: -1,
};

function parsedPriorEstimate(
  overrides: Record<string, unknown> = {},
): MetricRoomPriorModelEstimate {
  const parsed = parseMetricRoomPriorModelEstimate({
    observability: "recoverable",
    estimatedRoomDepthM: { low: 4.2, best: 4.5, high: 4.8 },
    estimatedRoomWidthM: { low: 3.3, best: ROOM4_WIDTH_M, high: 3.9 },
    estimatedCeilingHeightM: 2.7,
    modelConfidence: 0.8,
    limitations: [],
    notes: null,
    ...overrides,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("metric prior parse failed");
  return parsed.estimate;
}

function priorReceipt(
  overrides: Record<string, unknown> = {},
): MetricRoomPriorReceipt {
  const estimate = parsedPriorEstimate(overrides);
  return buildMetricRoomPriorReceipt({
    sourceImageHash: "a".repeat(64),
    originalAncestorSha256: "a".repeat(64),
    attemptId: "v2-ux3c0",
    loadGeneration: 1,
    provider: "controlled_fixture",
    model: "fixture",
  }, estimate, acceptMetricRoomPrior(estimate), null);
}

function backSpan(
  overrides: Partial<MetricCorrespondenceSpan> = {},
): MetricCorrespondenceSpan {
  return {
    id: "rb_floor_back_wall_seam",
    source: "s4a_floor_wall",
    correspondenceSource: "identity_uv",
    spanTrust: "trusted",
    role: "back_floor_wall",
    imageSpace: METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
    overlaySafeOnOriginal: true,
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.8, y: 0.62 },
    canonicalWorldA: { x: -4.791094, z: 0 },
    canonicalWorldB: { x: 4.791094, z: 0 },
    canonicalLength: ROOM4_LIVE_CANONICAL_LENGTH,
    endpointAClass: "observed_interior",
    endpointBClass: "observed_interior",
    truncation: "none",
    imageLengthNormalized: 0.6,
    confidence: 0.9,
    selectionReasons: ["accepted_s4a_floor_wall", "role_back_floor_wall"],
    lineage: {
      s4aCandidateId: "rb_floor_back_wall_seam",
      sourceSeamId: "floor_back_wall_seam",
      registrationClass: "exact_grid_registered",
      olCandidateId: null,
    },
    ...overrides,
  };
}

function derive(overrides: {
  roomPrior?: MetricRoomPriorReceipt | null;
  selected?: MetricCorrespondenceSpan | null;
  s4aSafety?: AutoMetricS4aSafetyEvidence | null;
  trustSelectedBackSpanAsFullWidth?: boolean;
} = {}) {
  return deriveAutoMetricScale({
    roomPrior: "roomPrior" in overrides ? overrides.roomPrior : priorReceipt(),
    selected: "selected" in overrides ? overrides.selected : backSpan(),
    s4aSafety: "s4aSafety" in overrides ? overrides.s4aSafety ?? null : S4A_SAFE,
    trustSelectedBackSpanAsFullWidth:
      overrides.trustSelectedBackSpanAsFullWidth ?? true,
  });
}

function cubeSize(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(object).getSize(size);
  return size;
}

function projectNdc(
  camera: THREE.PerspectiveCamera,
  point: Readonly<{ x: number; y: number; z: number }>,
): { x: number; y: number } {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: projected.x, y: projected.y };
}

function buildCamera(pose: typeof canonicalCameraPose): THREE.PerspectiveCamera {
  const result = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: 61.5,
    pose,
    frameSize: { width: 1118, height: 698 },
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("calibrated camera construction failed");
  return result.camera;
}

test("Room 4-style derivation uses Gemini width over the trusted back span", () => {
  const expected = deriveUniformMetricScaleFromPhysicalSpan(
    ROOM4_LIVE_CANONICAL_LENGTH,
    ROOM4_WIDTH_M,
  );
  assert.equal(expected, ROOM4_LIVE_AUTO);
  assert.equal(ROOM4_LIVE_AUTO, 3.6 / 9.582188);
  const receipt = derive();
  assert.equal(receipt.accepted, true);
  assert.equal(
    receipt.authority,
    AUTO_METRIC_SCALE_AUTHORITY.gemini_width_back_span_experimental,
  );
  assert.equal(receipt.autoMetricScale, ROOM4_LIVE_AUTO);
  assert.equal(receipt.physicalSource?.kind, "gemini_room_width");
  assert.equal(receipt.physicalSource?.metres, 3.6);
  assert.equal(receipt.canonicalSource?.kind, "back_floor_wall_span");
  assert.equal(receipt.canonicalSource?.gaugeLength, ROOM4_LIVE_CANONICAL_LENGTH);
  assert.ok(receipt.autoMetricScale < 0.5);
  assert.ok(Math.abs(ROOM4_LIVE_CANONICAL_LENGTH * receipt.autoMetricScale - 3.6) < 1e-12);
  assert.deepEqual([...receipt.reasons], [
    "trusted_back_floor_wall_span_experimental",
    "lab_trust_enabled",
    "uniform_physical_span_scale",
  ]);
});

test("another gauge realization keeps the same physical width target", () => {
  const receipt = derive({
    selected: backSpan({ canonicalLength: ROOM4_EARLIER_CANONICAL_LENGTH }),
  });
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.autoMetricScale, ROOM4_EARLIER_AUTO);
  assert.ok(Math.abs(receipt.autoMetricScale - 0.258) < 0.001);
  assert.ok(
    Math.abs(ROOM4_EARLIER_CANONICAL_LENGTH * receipt.autoMetricScale - 3.6) < 1e-12,
  );
  assert.ok(
    Math.abs(ROOM4_LIVE_CANONICAL_LENGTH * ROOM4_LIVE_AUTO - 3.6) < 1e-12,
  );
});

test("Auto derivation does not use Gemini depth / 4 or TILED projective gauges", () => {
  const withShallowDepth = derive({
    roomPrior: priorReceipt({
      estimatedRoomDepthM: { low: 4.2, best: 4.5, high: 4.8 },
    }),
  });
  const withDeeperDepth = derive({
    roomPrior: priorReceipt({
      estimatedRoomDepthM: { low: 8.5, best: 9, high: 9.5 },
    }),
  });
  assert.equal(withShallowDepth.autoMetricScale, ROOM4_LIVE_AUTO);
  assert.equal(withDeeperDepth.autoMetricScale, ROOM4_LIVE_AUTO);
  assert.notEqual(withShallowDepth.autoMetricScale, 4.5 / 4);
  assert.notEqual(withDeeperDepth.autoMetricScale, 9 / 4);
  const autoSource = readV2("metric-auto-scale.ts");
  const autoContract = readV2("metric-auto-scale-contract.ts");
  for (const source of [autoSource, autoContract]) {
    assert.doesNotMatch(source, /referenceDepthM/);
    assert.doesNotMatch(source, /worldWidthM/);
    assert.doesNotMatch(source, /CANONICAL_PROJECTIVE_DEPTH_GAUGE_M/);
    assert.doesNotMatch(source, /derivedShadowAutoMetricScale/);
    assert.doesNotMatch(source, /derivedAutoMetricScale/);
    assert.doesNotMatch(source, /candidateMetricScale/);
    assert.doesNotMatch(source, /estimatedLengthM/);
    assert.doesNotMatch(source, /metricScaleX|metricScaleZ/);
  }
});

test("no anisotropic metricScaleX / metricScaleZ in Auto or UX-2b realization", () => {
  const realization = readV2("scene-metric-world-realization.ts");
  const viewer = readV2("CalibratedRoomViewer.tsx");
  const roomLab = readV2("RoomLabV2.tsx");
  for (const source of [realization, viewer, roomLab]) {
    assert.doesNotMatch(source, /metricScaleX|metricScaleZ/);
  }
});

test("1 m Test Cube remains 1 m under sub-0.50 Auto", () => {
  const realized = realizeObjectWorldTransform(
    { ...DEFAULT_WORLD_TRANSFORM, uniformScale: 1 },
    ROOM4_LIVE_AUTO,
  );
  assert.equal(realized.uniformScale, 1);
  assert.equal(realized.position.y, 0);
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createTestCubeMesh());
  applyWorldTransform(root.placement, realized);
  const size = cubeSize(root.placement);
  assert.ok(Math.abs(size.x - TEST_CUBE_EDGE_M) < 1e-6);
  assert.ok(Math.abs(size.y - TEST_CUBE_EDGE_M) < 1e-6);
  assert.ok(Math.abs(size.z - TEST_CUBE_EDGE_M) < 1e-6);
  assert.equal(TEST_CUBE_EDGE_M, 1);
});

test("camera projection stays invariant under Auto below 0.50", () => {
  const S = ROOM4_LIVE_AUTO;
  assert.ok(S < 0.5);
  const canonicalCamera = buildCamera(canonicalCameraPose);
  const realizedPose = realizeCameraPose(canonicalCameraPose, S);
  const realizedCamera = buildCamera(realizedPose);
  assert.equal(canonicalCamera.fov, realizedCamera.fov);
  assert.deepEqual(canonicalCamera.up.toArray(), realizedCamera.up.toArray());
  const halfW = canonicalFloor.worldWidthM / 2;
  const halfD = canonicalFloor.referenceDepthM / 2;
  const corners = [
    { x: -halfW, y: 0, z: -halfD },
    { x: halfW, y: 0, z: -halfD },
    { x: halfW, y: 0, z: halfD },
    { x: -halfW, y: 0, z: halfD },
  ];
  for (const point of corners) {
    const before = projectNdc(canonicalCamera, point);
    const after = projectNdc(realizedCamera, {
      x: point.x * S,
      y: point.y,
      z: point.z * S,
    });
    const error = Math.hypot(before.x - after.x, before.y - after.y);
    assert.ok(error < PROJECTION_EPS, `pixel drift ${error}`);
  }
  const floor = realizeFloorRectangle(canonicalFloor, S);
  assert.ok(Math.abs(floor.worldWidthM - 6 * S) < 1e-12);
  assert.ok(Math.abs(floor.referenceDepthM - 4 * S) < 1e-12);
});

test("combined auto × user World Scale uses existing UX-2b composition", () => {
  const auto = ROOM4_LIVE_AUTO;
  const user = 1.1;
  const combined = computeMetricScale(auto, user);
  assert.equal(combined, auto * user);
  const metadata = createMetricRealizationMetadata({
    autoMetricScale: auto,
    userWorldScale: user,
  });
  assert.equal(metadata.autoMetricScale, auto);
  assert.equal(metadata.userWorldScale, 1.1);
  assert.equal(metadata.metricScale, auto * 1.1);
  assert.ok(metadata.metricScale < 0.5);
});

test("Gemini unavailable, missing width, and missing span fall back to Auto 1", () => {
  const noGemini = derive({ roomPrior: null });
  assert.equal(noGemini.accepted, false);
  assert.equal(noGemini.autoMetricScale, AUTO_METRIC_SCALE);
  assert.equal(noGemini.authority, AUTO_METRIC_SCALE_AUTHORITY.none);

  const noWidth = derive({
    roomPrior: priorReceipt({ estimatedRoomWidthM: null }),
  });
  assert.equal(noWidth.accepted, false);
  assert.equal(noWidth.autoMetricScale, 1);
  assert.ok(noWidth.reasons.includes("room_prior_not_accepted"));

  const noSpan = derive({ selected: null });
  assert.equal(noSpan.accepted, false);
  assert.equal(noSpan.autoMetricScale, 1);
  assert.ok(noSpan.reasons.includes("selected_span_missing"));
});

test("truncated, non-back, and unsafe spans fall back to Auto 1", () => {
  const truncated = derive({
    selected: backSpan({
      truncation: "one_end",
      endpointAClass: "frame_adjacent",
    }),
  });
  assert.equal(truncated.accepted, false);
  assert.equal(truncated.autoMetricScale, 1);
  assert.ok(truncated.reasons.includes("span_truncated"));

  const nonBack = derive({
    selected: backSpan({ role: "left_floor_wall" }),
  });
  assert.equal(nonBack.accepted, false);
  assert.equal(nonBack.autoMetricScale, 1);
  assert.ok(nonBack.reasons.includes("role_not_back_floor_wall"));

  const overlayUnsafe = derive({
    selected: backSpan({ overlaySafeOnOriginal: false }),
  });
  assert.equal(overlayUnsafe.accepted, false);
  assert.equal(overlayUnsafe.autoMetricScale, 1);

  const manufactured = derive({
    s4aSafety: {
      observedSpanOnly: true,
      hiddenContinuation: false,
      geometryManufactured: true,
    },
  });
  assert.equal(manufactured.accepted, false);
  assert.equal(manufactured.autoMetricScale, 1);

  const olSource = derive({
    selected: backSpan({ source: "ol_floor_wall" }),
  });
  assert.equal(olSource.accepted, false);
  assert.equal(olSource.autoMetricScale, 1);
  assert.ok(olSource.reasons.includes("source_not_s4a_floor_wall"));

  const olCorrespondence = derive({
    selected: backSpan({
      correspondenceSource: "original_localization",
      overlaySafeOnOriginal: false,
      spanTrust: "candidate",
    }),
  });
  assert.equal(olCorrespondence.accepted, false);
  assert.equal(olCorrespondence.autoMetricScale, 1);
  assert.ok(olCorrespondence.reasons.includes("correspondence_not_identity_uv"));
  assert.ok(olCorrespondence.reasons.includes("overlay_unsafe_on_original"));
});

test("valid Auto below 0.50 is accepted and is not clamped to the user slider band", () => {
  const receipt = derive();
  assert.equal(receipt.accepted, true);
  assert.ok(receipt.autoMetricScale < 0.5);
  assert.ok(receipt.autoMetricScale > AUTO_METRIC_SCALE_SANITY_MIN);
  assert.ok(receipt.autoMetricScale < AUTO_METRIC_SCALE_SANITY_MAX);
  assert.equal(computeMetricScale(receipt.autoMetricScale, 1), receipt.autoMetricScale);
});

test("lab trust defaults off and is required for experimental Auto", () => {
  const untrusted = derive({ trustSelectedBackSpanAsFullWidth: false });
  assert.equal(untrusted.accepted, false);
  assert.equal(untrusted.autoMetricScale, 1);
  assert.equal(untrusted.labTrustEnabled, false);
  assert.ok(untrusted.reasons.includes("lab_trust_not_enabled"));
  assert.equal(
    untrusted.authority,
    AUTO_METRIC_SCALE_AUTHORITY.none,
  );
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(roomLab, /trustSelectedBackSpanAsFullWidth/);
  assert.match(roomLab, /AUTO_METRIC_LAB_TRUST_LABEL/);
  assert.match(roomLab, /setTrustSelectedBackSpanAsFullWidth\(false\)/);
  assert.equal(AUTO_METRIC_LAB_TRUST_LABEL, "Trust selected back span as full width");
});

test("trusted-span gate requires S4A back-wall safety invariants", () => {
  const ok = evaluateTrustedBackWallWidthSpan(backSpan(), S4A_SAFE);
  assert.equal(ok.trusted, true);
  const missingSafety = evaluateTrustedBackWallWidthSpan(backSpan(), null);
  assert.equal(missingSafety.trusted, false);
  assert.ok(missingSafety.reasons.includes("s4a_safety_unavailable"));
  const degenerate = evaluateTrustedBackWallWidthSpan(
    backSpan({ canonicalLength: AUTO_METRIC_CANONICAL_LENGTH_EPSILON }),
    S4A_SAFE,
  );
  assert.equal(degenerate.trusted, false);
});

test("catastrophic candidates fallback to 1 and are not silently clamped", () => {
  const huge = deriveUniformMetricScaleFromPhysicalSpan(0.2, 30);
  assert.ok(huge !== null && huge > AUTO_METRIC_SCALE_SANITY_MAX);
  const receipt = derive({
    selected: backSpan({ canonicalLength: 0.2 }),
  });
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.autoMetricScale, 1);
  assert.notEqual(receipt.autoMetricScale, AUTO_METRIC_SCALE_SANITY_MAX);
  assert.ok(receipt.reasons.includes("candidate_outside_catastrophic_sanity_bounds"));
});

test("UX-3b1 matched-span estimate cannot affect Auto", () => {
  const roomLab = readV2("RoomLabV2.tsx");
  const autoSource = readV2("metric-auto-scale.ts");
  assert.doesNotMatch(
    roomLab,
    /deriveAutoMetricScale\([\s\S]{0,500}metricCorrespondenceEstimate/,
  );
  assert.doesNotMatch(autoSource, /metric-correspondence-estimate/);
  const withTrust = derive();
  assert.equal(withTrust.autoMetricScale, ROOM4_LIVE_AUTO);
});

test("UX-3a Gemini depth cannot affect Auto", () => {
  const autoSource = readV2("metric-auto-scale.ts");
  assert.doesNotMatch(autoSource, /estimatedRoomDepthM/);
  const receipt = derive();
  assert.equal(receipt.physicalSource?.kind, AUTO_METRIC_PHYSICAL_SOURCE_KIND.gemini_room_width);
  assert.equal(receipt.physicalSource?.metres, 3.6);
});

test("collision kernel is unchanged and still resolves against realized walls", () => {
  const kernel = readV2("room-collision-geometry.ts");
  const resolver = readV2("scene-collision-resolver.ts");
  assert.doesNotMatch(kernel, /metric-auto-scale|autoMetricScale/);
  assert.doesNotMatch(resolver, /metric-auto-scale|autoMetricScale/);
  const S = ROOM4_LIVE_AUTO;
  const realized = realizeObjectWorldTransform(DEFAULT_WORLD_TRANSFORM, S);
  const walls = realizeCollisionWalls([xWallAt2], S);
  const resolved = resolveSceneObjectCollision({
    current: realized,
    proposed: realized,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls,
    mode: "move",
  });
  assert.equal(resolved.transform.uniformScale, 1);
  assert.equal(resolved.unresolvedOverlap, false);
});

test("RoomLab reuses UX-2b uniform realization and experimental Auto copy", () => {
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(roomLab, /deriveAutoMetricScale\(/);
  assert.match(roomLab, /computeMetricScale\(autoMetricScale, userWorldScale\)/);
  assert.match(roomLab, /realizeFloorRectangle\(applied\.floor, metricScale\)/);
  assert.match(roomLab, /Auto Metric Scale/);
  assert.match(roomLab, /AUTO_METRIC_SCALE_SOURCE_COPY/);
  assert.match(roomLab, /AUTO_METRIC_SCALE_EXPERIMENTAL_COPY/);
  assert.match(roomLab, /AUTO_METRIC_UNRELIABLE_COPY/);
  assert.match(roomLab, /Download Auto Metric Scale/);
  assert.match(roomLab, /afc-v2-auto-metric-scale\.json/);
  assert.match(roomLab, /Diagnostic span estimate/);
  assert.equal(AUTO_METRIC_SCALE_SOURCE_COPY, "Gemini room width + trusted back span");
  assert.equal(AUTO_METRIC_SCALE_EXPERIMENTAL_COPY, "Experimental");
  assert.equal(AUTO_METRIC_UNRELIABLE_COPY, "Couldn't estimate room size reliably");
  assert.equal(formatAutoMetricScale(ROOM4_LIVE_AUTO), "0.38×");
  assert.deepEqual(AUTO_METRIC_SOURCE_PRECEDENCE, [
    "manual_known_span",
    "gemini_room_width_back_span",
    "none",
  ]);
});

test("V1 is untouched by UX-3C0 Auto files", () => {
  const v1Names = readdirSync(V1_DIRECTORY);
  assert.equal(v1Names.includes("metric-auto-scale.ts"), false);
  assert.equal(v1Names.includes("metric-auto-scale-contract.ts"), false);
  const v1Runtime = readdirSync(V1_DIRECTORY)
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => readFileSync(path.join(V1_DIRECTORY, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(v1Runtime, /metric-auto-scale/);
  assert.doesNotMatch(v1Runtime, /gemini_width_back_span_experimental/);
});
