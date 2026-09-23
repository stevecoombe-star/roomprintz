import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
  REGISTRATION_MAX_IDENTITY_RESIDUAL,
  REGISTRATION_MAX_RMS_RESIDUAL,
  REGISTRATION_MIN_INLIER_FRACTION,
  REGISTRATION_DIAGNOSTIC_SCALE_ABS_MAX,
  REGISTRATION_DIAGNOSTIC_TX_ABS_MAX,
  REGISTRATION_DIAGNOSTIC_TY_ABS_MAX,
  REGISTRATION_SEARCH_WINDOW,
  type EmptyOriginalFittedLine,
  type EmptyOriginalNormalizedUv,
} from "./empty-original-registration-authority-contract";
import {
  aggregateHybridEvidenceUnits,
  detectBimodalOffsets,
  evaluateHybridRegistrationGates,
  evaluateZoomLock,
  identityResidual,
  orientationBinCount,
  spreadSamplesForUnits,
  type HybridSampleMatch,
} from "./empty-original-registration-geometry";
import {
  classifyOpeningBoundary,
  collectArchitectureRegistrationPriors,
  evidenceUnitKey,
} from "./empty-original-registration-priors";
import { constructEmptyOriginalRegistrationAuthority } from "./empty-original-registration.server";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const V2 = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function verticalLine(u: number): EmptyOriginalFittedLine {
  return {
    theta: 0,
    rho: u,
    origin: { u, v: 0.5 },
    direction: { u: 0, v: 1 },
  };
}

function horizontalLine(v: number): EmptyOriginalFittedLine {
  return {
    theta: Math.PI / 2,
    rho: v,
    origin: { u: 0.5, v },
    direction: { u: 1, v: 0 },
  };
}

function ridgeSample(
  priorId: string,
  structureId: string,
  empty: EmptyOriginalNormalizedUv,
  options: {
    matched?: boolean;
    normalResidual?: number;
    orientationResidual?: number;
    emptyLine?: EmptyOriginalFittedLine | null;
    parentStructureId?: string | null;
    structureKind?: string;
  } = {},
): HybridSampleMatch {
  const matched = options.matched ?? true;
  const tangent = options.emptyLine?.direction ?? { u: 0, v: 1 };
  return {
    priorId,
    structureId,
    parentStructureId: options.parentStructureId ?? null,
    structureKind: options.structureKind ?? "floor_wall",
    evidenceClass: "ridge_normal",
    empty,
    tangent,
    emptyLine: options.emptyLine ?? verticalLine(empty.u),
    original: matched
      ? { u: empty.u + (options.normalResidual ?? 0), v: empty.v }
      : null,
    originalLine: options.emptyLine ?? verticalLine(empty.u),
    ncc: matched ? 0.9 : null,
    pointResidual: null,
    normalResidual: matched ? options.normalResidual ?? 0 : null,
    orientationResidual: matched ? options.orientationResidual ?? 0.01 : null,
    tangentDiagnostic: null,
    tangentLocalization: "ambiguous",
    displaySnapped: false,
    matched,
  };
}

function anchorSample(
  priorId: string,
  structureId: string,
  empty: EmptyOriginalNormalizedUv,
  options: {
    du?: number;
    dv?: number;
    matched?: boolean;
    parentStructureId?: string | null;
    displaySnapped?: boolean;
  } = {},
): HybridSampleMatch {
  const matched = options.matched ?? true;
  const original = matched
    ? { u: empty.u - (options.du ?? 0), v: empty.v - (options.dv ?? 0) }
    : null;
  return {
    priorId,
    structureId,
    parentStructureId: options.parentStructureId ?? null,
    structureKind: "room_corner",
    evidenceClass: "point_anchor",
    empty,
    tangent: null,
    emptyLine: null,
    original,
    originalLine: null,
    ncc: matched ? 0.92 : null,
    pointResidual: original ? identityResidual(empty, original) : null,
    normalResidual: null,
    orientationResidual: null,
    tangentDiagnostic: null,
    tangentLocalization: "localized",
    displaySnapped: options.displaySnapped ?? false,
    matched,
  };
}

function passingRoomUnits(): HybridSampleMatch[] {
  const left = verticalLine(0.18);
  const right = verticalLine(0.82);
  const back = horizontalLine(0.72);
  return [
    ridgeSample("l0", "left", { u: 0.18, v: 0.30 }, { emptyLine: left, normalResidual: 0.0004 }),
    ridgeSample("l1", "left", { u: 0.18, v: 0.50 }, { emptyLine: left, normalResidual: 0.0003 }),
    ridgeSample("l2", "left", { u: 0.18, v: 0.70 }, { emptyLine: left, normalResidual: 0.0005 }),
    ridgeSample("r0", "right", { u: 0.82, v: 0.30 }, { emptyLine: right, normalResidual: -0.0002 }),
    ridgeSample("r1", "right", { u: 0.82, v: 0.50 }, { emptyLine: right, normalResidual: -0.0004 }),
    ridgeSample("r2", "right", { u: 0.82, v: 0.70 }, { emptyLine: right, normalResidual: -0.0003 }),
    ridgeSample("b0", "back", { u: 0.25, v: 0.72 }, { emptyLine: back, normalResidual: 0.0002 }),
    ridgeSample("b1", "back", { u: 0.50, v: 0.72 }, { emptyLine: back, normalResidual: 0.0001 }),
    ridgeSample("b2", "back", { u: 0.75, v: 0.72 }, { emptyLine: back, normalResidual: 0.0004 }),
    anchorSample("c1", "left_back", { u: 0.18, v: 0.72 }, { du: 0.0004, dv: 0.0002 }),
    anchorSample("c2", "right_back", { u: 0.82, v: 0.72 }, { du: -0.0003, dv: 0.0002 }),
  ];
}

function evaluateSamples(samples: readonly HybridSampleMatch[]) {
  const units = aggregateHybridEvidenceUnits(samples);
  return {
    units,
    evaluation: evaluateHybridRegistrationGates(
      units,
      spreadSamplesForUnits(units, samples),
    ),
  };
}

function observationForPriors(emptyIdentity: {
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
}, extraOpenings: unknown[] = []) {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.95 },
          { x: 0.9, y: 0.95 },
          { x: 0.82, y: 0.72 },
          { x: 0.18, y: 0.72 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "left_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.05, y: 0.2 },
          { x: 0.18, y: 0.25 },
          { x: 0.18, y: 0.82 },
          { x: 0.05, y: 0.9 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "back_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.18, y: 0.22 },
          { x: 0.82, y: 0.22 },
          { x: 0.82, y: 0.72 },
          { x: 0.18, y: 0.72 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "right_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.82, y: 0.2 },
          { x: 0.95, y: 0.18 },
          { x: 0.95, y: 0.9 },
          { x: 0.82, y: 0.82 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "left_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "left_wall"],
        sourceNormalizedPolyline: [
          { x: 0.18, y: 0.30 },
          { x: 0.18, y: 0.55 },
          { x: 0.18, y: 0.72 },
          { x: 0.18, y: 0.82 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "back_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "back_wall"],
        sourceNormalizedPolyline: [
          { x: 0.18, y: 0.72 },
          { x: 0.5, y: 0.72 },
          { x: 0.82, y: 0.72 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "right_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "right_wall"],
        sourceNormalizedPolyline: [
          { x: 0.82, y: 0.28 },
          { x: 0.82, y: 0.50 },
          { x: 0.82, y: 0.72 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedOpenings: extraOpenings,
    observedJunctions: [
      {
        id: "left_back_corner",
        category: "room_corner",
        sourceNormalizedPoint: { x: 0.18, y: 0.72 },
        seamIds: ["left_floor_wall", "back_floor_wall"],
        openingIds: [],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    unresolved: [],
  }, {
    attemptId: "s4c0",
    loadGeneration: 1,
    emptyIdentity: {
      ...emptyIdentity,
      byteCount: 8,
      mimeType: "image/png",
      orientation: 1,
    },
    originalAncestorSha256: "a".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-28T12:00:00.000Z",
  });
}

async function scenePng(
  width: number,
  height: number,
  options: {
    shiftU?: number;
    zoom?: number;
    stretchU?: number;
    edgeShift?: number;
    extraParallelU?: number;
    extraStroke?: number;
    leftShiftU?: number;
  } = {},
) {
  const shiftU = options.shiftU ?? 0;
  const zoom = options.zoom ?? 1;
  const stretchU = options.stretchU ?? 1;
  const edgeShift = options.edgeShift ?? 0;
  const map = (u: number, v: number, edge = false) => {
    const uu = 0.5 + (u - 0.5) * zoom * stretchU + shiftU + (edge ? edgeShift : 0);
    const vv = 0.5 + (v - 0.5) * zoom;
    return { x: uu * width, y: vv * height };
  };
  const leftTop = map(0.18 + (options.leftShiftU ?? 0), 0.30, true);
  const leftBot = map(0.18 + (options.leftShiftU ?? 0), 0.82, true);
  const backLeft = map(0.18, 0.72);
  const backRight = map(0.82, 0.72);
  const rightTop = map(0.82, 0.28, true);
  const rightBot = map(0.82, 0.72, true);
  const stroke = Math.max(4, Math.round(width / 70));
  const extra = options.extraParallelU !== undefined
    ? (() => {
      const top = map(options.extraParallelU!, 0.30, true);
      const bot = map(options.extraParallelU!, 0.82, true);
      const extraStroke = options.extraStroke ?? stroke + 2;
      return `<line x1="${top.x}" y1="${top.y}" x2="${bot.x}" y2="${bot.y}" stroke="#ffffff" stroke-width="${extraStroke}"/>`;
    })()
    : "";
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#2b2b2b"/>
    <line x1="${leftTop.x}" y1="${leftTop.y}" x2="${leftBot.x}" y2="${leftBot.y}" stroke="#f7f7f7" stroke-width="${stroke}"/>
    <line x1="${backLeft.x}" y1="${backLeft.y}" x2="${backRight.x}" y2="${backRight.y}" stroke="#f7f7f7" stroke-width="${stroke}"/>
    <line x1="${rightTop.x}" y1="${rightTop.y}" x2="${rightBot.x}" y2="${rightBot.y}" stroke="#f7f7f7" stroke-width="${stroke}"/>
    ${extra}
  </svg>`);
  return sharp(svg).png().toBuffer();
}

async function rasterReceipt(
  options: Parameters<typeof scenePng>[2] = {},
) {
  const emptyBytes = await scenePng(240, 180);
  const originalBytes = await scenePng(480, 360, options);
  const emptyIdentity = {
    sha256: sha(emptyBytes),
    decodedWidth: 240,
    decodedHeight: 180,
    orientation: 1 as const,
  };
  return constructEmptyOriginalRegistrationAuthority({
    emptyIdentity,
    originalIdentity: {
      sha256: sha(originalBytes),
      decodedWidth: 480,
      decodedHeight: 360,
      orientation: 1,
    },
    emptyBytes,
    originalBytes,
    observation: observationForPriors(emptyIdentity),
  });
}

test("exact grid same W/H + orientation is exact_grid_registered and promotion eligible", async () => {
  const receipt = await constructEmptyOriginalRegistrationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    emptyBytes: null,
    originalBytes: null,
    observation: null,
  });
  assert.equal(receipt.registrationClass, "exact_grid_registered");
  assert.equal(receipt.collisionPromotionEligible, true);
  assert.equal(receipt.transformKind, "identity_normalized");
  assert.equal(receipt.geometryManufactured, false);
  assert.equal(receipt.oldCompatibilityTier, "exact_grid_compatible");
  assert.equal(receipt.methodVersion, AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION);
  assert.equal(receipt.zoomLockConfiguration, "not_applicable");
  assert.equal(receipt.lineage.methodVersion, "afc-v2-empty-original-registration-identity/v2");
});

test("raw aspect metadata without raster proof is never promotion eligible", async () => {
  const receipt = await constructEmptyOriginalRegistrationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 800,
      decodedHeight: 600,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 900,
      orientation: 1,
    },
    emptyBytes: null,
    originalBytes: null,
    observation: null,
  });
  assert.equal(receipt.oldCompatibilityTier, "aspect_compatible_rescaled");
  assert.notEqual(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, false);
  assert.match(receipt.constructionReasons.join(" "), /raster_proof/);
});

test("orientation mismatch is rejected", async () => {
  const receipt = await constructEmptyOriginalRegistrationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 6,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    emptyBytes: null,
    originalBytes: null,
    observation: null,
  });
  assert.equal(receipt.registrationClass, "rejected");
  assert.equal(receipt.collisionPromotionEligible, false);
});

test("pure resized identity can certify rescaled registration", async () => {
  const receipt = await rasterReceipt();
  assert.equal(receipt.oldCompatibilityTier, "aspect_compatible_rescaled");
  assert.equal(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, true);
  assert.equal(receipt.transformKind, "identity_normalized");
  assert.ok((receipt.inlierFraction ?? 0) >= REGISTRATION_MIN_INLIER_FRACTION);
  assert.ok((receipt.residuals.ridgeNormalMax ?? 1) <= REGISTRATION_MAX_IDENTITY_RESIDUAL);
  assert.equal(receipt.methodVersion, "afc-v2-empty-original-registration-identity/v2");
  assert.ok((receipt.attemptedEvidenceUnitCount ?? 0) >= 2);
});

test("shifted crop is insufficient or rejected", async () => {
  const receipt = await rasterReceipt({ shiftU: 0.08 });
  assert.notEqual(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, false);
});

test("zoom is rejected or insufficient", async () => {
  const receipt = await rasterReceipt({ zoom: 1.12 });
  assert.notEqual(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, false);
});

test("one-axis distortion is rejected or insufficient", async () => {
  const receipt = await rasterReceipt({ stretchU: 1.08 });
  assert.notEqual(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, false);
});

test("central match with edge drift is rejected", async () => {
  const receipt = await rasterReceipt({ edgeShift: 0.07 });
  assert.notEqual(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, false);
});

test("ridge tangent ambiguity does not fail a normally aligned structure", () => {
  const left = verticalLine(0.18);
  const samples = [
    ridgeSample("a", "left", { u: 0.18, v: 0.20 }, { emptyLine: left, normalResidual: 0.0004 }),
    ridgeSample("b", "left", { u: 0.18, v: 0.45 }, { emptyLine: left, normalResidual: 0.0002 }),
    ridgeSample("c", "left", { u: 0.18, v: 0.80 }, { emptyLine: left, normalResidual: 0.0006 }),
  ];
  const units = aggregateHybridEvidenceUnits(samples);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.status, "inlier");
  assert.equal(units[0]?.kind, "ridge_normal");
  assert.equal(units[0]?.original, null);
  assert.equal(units[0]?.tangentLocalization, "ambiguous");
  assert.equal(units[0]?.ridgeResidual?.tangentDiagnostic, null);
  assert.ok((units[0]?.residual ?? 1) <= REGISTRATION_MAX_IDENTITY_RESIDUAL);
});

test("ridge normal displacement beyond 0.003 is a contradiction", () => {
  const left = verticalLine(0.18);
  const samples = [
    ridgeSample("a", "left", { u: 0.18, v: 0.30 }, { emptyLine: left, normalResidual: 0.008 }),
    ridgeSample("b", "left", { u: 0.18, v: 0.50 }, { emptyLine: left, normalResidual: 0.009 }),
    ridgeSample("c", "left", { u: 0.18, v: 0.70 }, { emptyLine: left, normalResidual: 0.007 }),
  ];
  const units = aggregateHybridEvidenceUnits(samples);
  assert.equal(units[0]?.status, "contradiction");
  assert.equal(units[0]?.inlier, false);
});

test("wrong parallel trim cannot be outvoted by other inlier walls", () => {
  const samples = passingRoomUnits();
  const trim = verticalLine(0.18);
  const bad = [
    ridgeSample("t0", "left", { u: 0.18, v: 0.30 }, { emptyLine: trim, normalResidual: 0.012 }),
    ridgeSample("t1", "left", { u: 0.18, v: 0.50 }, { emptyLine: trim, normalResidual: 0.011 }),
    ridgeSample("t2", "left", { u: 0.18, v: 0.70 }, { emptyLine: trim, normalResidual: 0.013 }),
  ];
  const withoutLeft = samples.filter((sample) => sample.structureId !== "left");
  const { evaluation } = evaluateSamples([...withoutLeft, ...bad]);
  assert.equal(evaluation.accepted, false);
  assert.ok(evaluation.contradictionCount >= 1);
  assert.ok(evaluation.reasons.includes("ridge_normal_contradiction"));
  assert.ok(evaluation.ridgeInlierCount >= 2);
});

test("unique point anchor with raw Euclidean residual under 0.003 is an inlier", () => {
  const samples = [
    anchorSample("c", "corner", { u: 0.18, v: 0.72 }, { du: 0.001, dv: 0.001 }),
  ];
  const units = aggregateHybridEvidenceUnits(samples);
  assert.equal(units[0]?.status, "inlier");
  assert.equal(units[0]?.kind, "point_anchor");
  assert.ok(units[0]?.original);
  assert.ok((units[0]?.pointResidual?.magnitude ?? 1) < REGISTRATION_MAX_IDENTITY_RESIDUAL);
  assert.ok((units[0]?.pointResidual?.magnitude ?? 0) > 0);
});

test("unique point anchor displaced beyond 0.003 is a contradiction", () => {
  const { evaluation } = evaluateSamples([
    ...passingRoomUnits().filter((sample) => sample.evidenceClass === "ridge_normal"),
    anchorSample("c1", "left_back", { u: 0.18, v: 0.72 }, { du: 0.01, dv: 0 }),
    anchorSample("c2", "right_back", { u: 0.82, v: 0.72 }, { du: 0.0002, dv: 0 }),
  ]);
  assert.equal(evaluation.accepted, false);
  assert.ok(evaluation.reasons.includes("point_anchor_contradiction"));
});

test("1.5px identity lock does not zero raw certification residual", () => {
  const empty = { u: 0.4, v: 0.4 };
  const original = { u: 0.4 - 0.0012, v: 0.4 - 0.0004 };
  const residual = identityResidual(empty, original);
  assert.ok(residual.r > 0);
  assert.ok(residual.r < REGISTRATION_MAX_IDENTITY_RESIDUAL);
  const { units } = evaluateSamples([
    anchorSample("c", "corner", empty, { du: 0.0012, dv: 0.0004, displaySnapped: true }),
  ]);
  assert.equal(units[0]?.displaySnapped, true);
  assert.notEqual(units[0]?.pointResidual?.magnitude, 0);
  assert.ok(Math.abs((units[0]?.pointResidual?.magnitude ?? 0) - residual.r) < 1e-12);
  const source = readFileSync(
    path.join(V2, "empty-original-registration.server.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /nearestDist\s*<=\s*1\.5/);
  assert.doesNotMatch(source, /original = nearestDist/);
});

test("20 samples on one floor-wall seam are one ridge evidence unit", () => {
  const line = verticalLine(0.18);
  const samples = Array.from({ length: 20 }, (_, index) =>
    ridgeSample(`s${index}`, "floor_wall_left", { u: 0.18, v: 0.15 + index * 0.03 }, {
      emptyLine: line,
      normalResidual: 0.0004,
    })
  );
  const units = aggregateHybridEvidenceUnits(samples);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.sampleDiagnostics?.sampleCount, 20);
  assert.equal(units[0]?.status, "inlier");
});

test("structure-level 0.70 uses evidence units not raw samples", () => {
  const good = passingRoomUnits();
  const denseNoMatch = Array.from({ length: 20 }, (_, index) =>
    ridgeSample(`n${index}`, "noisy", { u: 0.4, v: 0.2 + index * 0.02 }, {
      emptyLine: verticalLine(0.4),
      matched: false,
    })
  );
  const { evaluation } = evaluateSamples([...good, ...denseNoMatch]);
  assert.equal(evaluation.attemptedEvidenceUnitCount, 6);
  assert.equal(evaluation.inlierCount, 5);
  assert.ok(evaluation.inlierFraction >= REGISTRATION_MIN_INLIER_FRACTION);
  assert.equal(evaluation.inlierFraction, 5 / 6);
});

test("all-parallel ridges without useful anchors are insufficient", () => {
  const lineA = verticalLine(0.18);
  const lineB = verticalLine(0.50);
  const lineC = verticalLine(0.82);
  const samples = [
    ...[0.2, 0.4, 0.7].map((v, index) =>
      ridgeSample(`a${index}`, "a", { u: 0.18, v }, { emptyLine: lineA })
    ),
    ...[0.2, 0.4, 0.7].map((v, index) =>
      ridgeSample(`b${index}`, "b", { u: 0.50, v }, { emptyLine: lineB })
    ),
    ...[0.2, 0.4, 0.7].map((v, index) =>
      ridgeSample(`c${index}`, "c", { u: 0.82, v }, { emptyLine: lineC })
    ),
  ];
  const { evaluation } = evaluateSamples(samples);
  assert.equal(evaluation.accepted, false);
  assert.ok(
    evaluation.reasons.includes("orientation_diversity_insufficient") ||
      evaluation.reasons.includes("zoom_lock_unsatisfied"),
  );
});

test("evidence concentrated in one local region fails spread", () => {
  const line = verticalLine(0.48);
  const back = horizontalLine(0.50);
  const samples = [
    ridgeSample("a0", "a", { u: 0.48, v: 0.48 }, { emptyLine: line }),
    ridgeSample("a1", "a", { u: 0.48, v: 0.50 }, { emptyLine: line }),
    ridgeSample("a2", "a", { u: 0.48, v: 0.52 }, { emptyLine: line }),
    ridgeSample("b0", "b", { u: 0.49, v: 0.50 }, { emptyLine: back }),
    ridgeSample("b1", "b", { u: 0.50, v: 0.50 }, { emptyLine: back }),
    ridgeSample("b2", "b", { u: 0.51, v: 0.50 }, { emptyLine: back }),
    anchorSample("c1", "c1", { u: 0.49, v: 0.49 }),
    anchorSample("c2", "c2", { u: 0.51, v: 0.51 }),
  ];
  const { evaluation } = evaluateSamples(samples);
  assert.equal(evaluation.accepted, false);
  assert.ok(
    evaluation.reasons.includes("correspondence_spread_insufficient") ||
      evaluation.reasons.includes("correspondences_collinear_or_one_wall"),
  );
});

test("single horizontal plus single vertical ridge fails zoom lock", () => {
  const vLine = verticalLine(0.5);
  const hLine = horizontalLine(0.5);
  const samples = [
    ridgeSample("v0", "vert", { u: 0.5, v: 0.3 }, { emptyLine: vLine }),
    ridgeSample("v1", "vert", { u: 0.5, v: 0.5 }, { emptyLine: vLine }),
    ridgeSample("v2", "vert", { u: 0.5, v: 0.7 }, { emptyLine: vLine }),
    ridgeSample("h0", "horz", { u: 0.3, v: 0.5 }, { emptyLine: hLine }),
    ridgeSample("h1", "horz", { u: 0.5, v: 0.5 }, { emptyLine: hLine }),
    ridgeSample("h2", "horz", { u: 0.7, v: 0.5 }, { emptyLine: hLine }),
  ];
  const units = aggregateHybridEvidenceUnits(samples);
  const zoom = evaluateZoomLock(units);
  assert.equal(zoom.satisfied, false);
  assert.equal(orientationBinCount(units.filter((unit) => unit.status === "inlier")), 2);
  const { evaluation } = evaluateSamples(samples);
  assert.equal(evaluation.accepted, false);
  assert.ok(evaluation.reasons.includes("zoom_lock_unsatisfied"));
});

test("bimodal parallel-family offsets fail the structure closed without averaging", () => {
  const line = verticalLine(0.18);
  const samples = [
    ridgeSample("a0", "left", { u: 0.18, v: 0.20 }, { emptyLine: line, normalResidual: 0.0002 }),
    ridgeSample("a1", "left", { u: 0.18, v: 0.28 }, { emptyLine: line, normalResidual: 0.0003 }),
    ridgeSample("a2", "left", { u: 0.18, v: 0.36 }, { emptyLine: line, normalResidual: 0.0001 }),
    ridgeSample("a3", "left", { u: 0.18, v: 0.44 }, { emptyLine: line, normalResidual: 0.0002 }),
    ridgeSample("a4", "left", { u: 0.18, v: 0.52 }, { emptyLine: line, normalResidual: 0.011 }),
    ridgeSample("a5", "left", { u: 0.18, v: 0.60 }, { emptyLine: line, normalResidual: 0.012 }),
    ridgeSample("a6", "left", { u: 0.18, v: 0.68 }, { emptyLine: line, normalResidual: 0.010 }),
    ridgeSample("a7", "left", { u: 0.18, v: 0.76 }, { emptyLine: line, normalResidual: 0.013 }),
  ];
  assert.equal(
    detectBimodalOffsets([0.0002, 0.0003, 0.0001, 0.0002, 0.011, 0.012, 0.010, 0.013]),
    true,
  );
  const units = aggregateHybridEvidenceUnits(samples);
  assert.equal(units[0]?.status, "ambiguous");
  assert.equal(units[0]?.sampleDiagnostics?.bimodalOffsetDetected, true);
  assert.notEqual(units[0]?.status, "inlier");
});

test("room-2-style fixture uses hybrid evidence rather than raw Euclidean points", () => {
  const onlyOneAnchor = passingRoomUnits().filter((sample) =>
    sample.evidenceClass === "ridge_normal" || sample.structureId === "left_back"
  );
  const { evaluation } = evaluateSamples(onlyOneAnchor);
  assert.equal(evaluation.ridgeStructureCount, 3);
  assert.equal(evaluation.anchorCount, 1);
  assert.equal(evaluation.zoomLock.configuration, "parallel_pair_plus_nonparallel");
  assert.equal(evaluation.accepted, true);
});

test("room-3-style fixture ignores tangent jitter that would fail Euclidean RMS", () => {
  const samples = passingRoomUnits();
  const euclidean = samples
    .filter((sample) => sample.matched)
    .map((_, index) => 0.0016 + (index % 3) * 0.0004);
  const euclideanRms = Math.sqrt(
    euclidean.reduce((sum, value) => sum + value * value, 0) / euclidean.length,
  );
  assert.ok(euclideanRms > REGISTRATION_MAX_RMS_RESIDUAL);
  const { units, evaluation } = evaluateSamples(samples);
  assert.ok((evaluation.residuals.ridgeNormalRms ?? 1) <= REGISTRATION_MAX_RMS_RESIDUAL);
  assert.equal(evaluation.accepted, true);
  assert.ok(units.every((unit) => unit.kind !== "ridge_normal" || unit.original === null));
});

test("genuine normal mismatch remains insufficient or rejected", () => {
  const samples = passingRoomUnits().map((sample) =>
    sample.structureId === "right"
      ? { ...sample, normalResidual: 0.01, original: { u: 0.83, v: sample.empty.v } }
      : sample
  );
  const { evaluation } = evaluateSamples(samples);
  assert.equal(evaluation.accepted, false);
  assert.ok(evaluation.contradictionCount >= 1);
});

test("opening corners are anchors; collinear edge vertices are ridge units", () => {
  const opening = {
    id: "window",
    category: "window" as const,
    hostPlaneId: "back_wall",
    sourceNormalizedBoundary: [
      { x: 0.40, y: 0.40 },
      { x: 0.50, y: 0.40 },
      { x: 0.60, y: 0.40 },
      { x: 0.60, y: 0.62 },
      { x: 0.40, y: 0.62 },
    ],
    boundaryClosure: "complete_visible_outline" as const,
    providerClaimedBoundaryClosure: "complete_visible_outline" as const,
    boundaryEvidenceCompleteness: "all_edges_visibly_traced" as const,
    closureValidation: "consistent_complete" as const,
    confidence: 0.9,
    ambiguity: null,
    evidenceClass: "provider_reported_visible_evidence" as const,
  };
  const classified = classifyOpeningBoundary(opening);
  const anchors = classified.filter((item) => item.evidenceClass === "point_anchor");
  const ridges = classified.filter((item) => item.evidenceClass === "ridge_normal");
  assert.ok(anchors.length >= 3 && anchors.length <= 4);
  assert.ok(!anchors.some((anchor) =>
    Math.abs(anchor.empty.u - 0.5) < 1e-9 && Math.abs(anchor.empty.v - 0.4) < 1e-9
  ));
  const ridgeIds = new Set(ridges.map((item) => item.structureId));
  assert.ok(ridgeIds.size >= 3);
  assert.ok(ridges.length > ridgeIds.size);
});

test("independent evidence unit key is structureId times evidenceClass", () => {
  const priors = collectArchitectureRegistrationPriors(
    observationForPriors({
      sha256: "e".repeat(64),
      decodedWidth: 240,
      decodedHeight: 180,
    }),
  );
  const ridgePriors = priors.filter((prior) => prior.evidenceClass === "ridge_normal");
  const left = ridgePriors.filter((prior) => prior.structureId === "left_floor_wall");
  assert.ok(left.length >= 3);
  assert.equal(new Set(left.map(evidenceUnitKey)).size, 1);
  assert.ok(priors.some((prior) => prior.evidenceClass === "point_anchor"));
});

test("thresholds were not lowered", () => {
  assert.equal(REGISTRATION_MAX_IDENTITY_RESIDUAL, 0.003);
  assert.equal(REGISTRATION_MAX_RMS_RESIDUAL, 0.0015);
  assert.equal(REGISTRATION_MIN_INLIER_FRACTION, 0.7);
  assert.equal(REGISTRATION_DIAGNOSTIC_SCALE_ABS_MAX, 0.006);
  assert.equal(REGISTRATION_DIAGNOSTIC_TX_ABS_MAX, 0.004);
  assert.equal(REGISTRATION_DIAGNOSTIC_TY_ABS_MAX, 0.004);
  assert.equal(REGISTRATION_SEARCH_WINDOW, 0.04);
});

test("registration receipt is frozen and digest-stable", async () => {
  const first = await constructEmptyOriginalRegistrationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 100,
      decodedHeight: 100,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 100,
      decodedHeight: 100,
      orientation: 1,
    },
    emptyBytes: null,
    originalBytes: null,
    observation: null,
  });
  const second = await constructEmptyOriginalRegistrationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 100,
      decodedHeight: 100,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 100,
      decodedHeight: 100,
      orientation: 1,
    },
    emptyBytes: null,
    originalBytes: null,
    observation: null,
  });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(first.schemaVersion, AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION);
  assert.equal(first.methodVersion, AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION);
  assert.throws(() => {
    (first as { registrationClass: string }).registrationClass = "insufficient";
  });
});

test("registration geometry and matcher do not import Floor, Camera, or S4A world", () => {
  const files = [
    "empty-original-registration-geometry.ts",
    "empty-original-registration-priors.ts",
    "empty-original-registration.server.ts",
  ];
  for (const fileName of files) {
    const source = readFileSync(path.join(V2, fileName), "utf8");
    assert.doesNotMatch(source, /room-boundary-authority|room-collision-qualification|fully-tiled-floor-authority|afc-fixed-seam-calibration|calibrated-camera-restore/);
    assert.doesNotMatch(source, /constructAfcV2RoomBoundaryAuthority|constructAfcV2RoomCollisionAuthority/);
    assert.doesNotMatch(source, /imagePolylineLineFit/);
  }
});

test("parallel trim raster inside the search window does not certify", async () => {
  const receipt = await rasterReceipt({ leftShiftU: 0.012, extraStroke: 10 });
  assert.notEqual(receipt.registrationClass, "certified_rescaled_registered");
  assert.equal(receipt.collisionPromotionEligible, false);
});
