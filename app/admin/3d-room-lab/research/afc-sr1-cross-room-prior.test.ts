import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AFC_SR1_CROSS_ROOM_ANCHOR_DISTANCE_TOLERANCE_SOURCE_NORM,
  AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION,
  AFC_SR1_CROSS_ROOM_MAX_PROJECTION_RESIDUAL_SOURCE_NORM,
  AFC_SR1_CROSS_ROOM_PRIOR_VERSION,
  deriveAfcSr1AdjustableCornerFromTruncatedAnchor,
  deriveAfcSr1CrossRoomPrior,
  validateAfcSr1CrossRoomLineEvidence,
} from "./afc-sr1-cross-room-prior";

const polygon = [
  { x: 0.2, y: 0.8 },
  { x: 0.8, y: 0.8 },
  { x: 0.65, y: 0.4 },
  { x: 0.35, y: 0.4 },
] as const;

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION,
    coordinateSpace: "source-normalized/v1",
    truncatedAnchor: "NL",
    anchorEndpoint: polygon[0],
    oppositeEndpoint: { x: 0.71, y: 0.56 },
    ...overrides,
  };
}

function usable(input: unknown) {
  const result = deriveAfcSr1CrossRoomPrior(input);
  if (result.status !== "usable") assert.fail(`Expected usable prior, received ${result.reason}`);
  return result;
}

test("cross-room versions and thresholds are explicit source-normalized v1 policy", () => {
  assert.equal(AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION, "afc-sr1-cross-room-line-evidence/v1");
  assert.equal(AFC_SR1_CROSS_ROOM_PRIOR_VERSION, "afc-sr1-cross-room-prior/v1");
  assert.equal(AFC_SR1_CROSS_ROOM_ANCHOR_DISTANCE_TOLERANCE_SOURCE_NORM, 0.1);
  assert.equal(AFC_SR1_CROSS_ROOM_MAX_PROJECTION_RESIDUAL_SOURCE_NORM, 0.1);
});

test("NL truncated anchor maps to NR adjustable and the NR-to-FR canonical seam", () => {
  const prior = usable({ sourcePolygon: polygon, evidence: evidence() });
  assert.equal(deriveAfcSr1AdjustableCornerFromTruncatedAnchor("NL"), "NR");
  assert.equal(prior.truncatedAnchor, "NL");
  assert.equal(prior.adjustableCorner, "NR");
  assert.equal(prior.canonicalSeamId, "NR_to_FR");
  assert.deepEqual(prior.legalSeam.seamStartNear, polygon[1]);
  assert.deepEqual(prior.legalSeam.seamEndFar, polygon[2]);
});

test("NR truncated anchor maps to NL adjustable and the NL-to-FL canonical seam", () => {
  const prior = usable({
    sourcePolygon: polygon,
    evidence: evidence({
      truncatedAnchor: "NR",
      anchorEndpoint: polygon[1],
      oppositeEndpoint: { x: 0.29, y: 0.56 },
    }),
  });
  assert.equal(deriveAfcSr1AdjustableCornerFromTruncatedAnchor("NR"), "NL");
  assert.equal(prior.truncatedAnchor, "NR");
  assert.equal(prior.adjustableCorner, "NL");
  assert.equal(prior.canonicalSeamId, "NL_to_FL");
  assert.deepEqual(prior.legalSeam.seamStartNear, polygon[0]);
  assert.deepEqual(prior.legalSeam.seamEndFar, polygon[3]);
});

test("exact legal-seam observations produce usable NL and mirrored NR priors", () => {
  const nlTruncated = usable({ sourcePolygon: polygon, evidence: evidence() });
  const nrTruncated = usable({
    sourcePolygon: polygon,
    evidence: evidence({
      truncatedAnchor: "NR",
      anchorEndpoint: polygon[1],
      oppositeEndpoint: { x: 0.29, y: 0.56 },
    }),
  });
  assert.ok(Math.abs(nlTruncated.seamT - 0.6) < 1e-12);
  assert.ok(Math.abs(nrTruncated.seamT - 0.6) < 1e-12);
  assert.ok(nlTruncated.projectionResidualSourceNorm < 1e-12);
  assert.ok(nrTruncated.projectionResidualSourceNorm < 1e-12);
});

test("small perpendicular error is projected deterministically and remains observable", () => {
  const normalLength = Math.hypot(0.4, -0.15);
  const prior = usable({
    sourcePolygon: polygon,
    evidence: evidence({
      oppositeEndpoint: {
        x: 0.71 + 0.02 * (0.4 / normalLength),
        y: 0.56 + 0.02 * (-0.15 / normalLength),
      },
    }),
  });
  assert.ok(Math.abs(prior.seamT - 0.6) < 1e-12);
  assert.ok(Math.abs(prior.projectedPoint.x - 0.71) < 1e-12);
  assert.ok(Math.abs(prior.projectedPoint.y - 0.56) < 1e-12);
  assert.ok(Math.abs(prior.projectionResidualSourceNorm - 0.02) < 1e-12);
});

test("grossly off-seam evidence is rejected without a repaired prior", () => {
  const result = deriveAfcSr1CrossRoomPrior({
    sourcePolygon: polygon,
    evidence: evidence({ oppositeEndpoint: { x: 0.91, y: 0.56 } }),
  });
  assert.deepEqual(result, {
    schemaVersion: AFC_SR1_CROSS_ROOM_PRIOR_VERSION,
    authority: "advisory_only",
    status: "rejected",
    reason: "opposite_endpoint_off_legal_seam",
  });
});

test("projected seam endpoints are rejected under the strict adjustable-seam domain", () => {
  for (const oppositeEndpoint of [polygon[1], polygon[2]]) {
    const result = deriveAfcSr1CrossRoomPrior({
      sourcePolygon: polygon,
      evidence: evidence({ oppositeEndpoint }),
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "projected_seam_t_outside_domain");
  }
});

test("invalid numeric, malformed, and collapsed evidence fails closed", () => {
  for (const invalidEvidence of [
    evidence({ anchorEndpoint: { x: Number.NaN, y: 0.8 } }),
    evidence({ oppositeEndpoint: { x: Number.POSITIVE_INFINITY, y: 0.56 } }),
    evidence({ oppositeEndpoint: { x: 0.71 } }),
    evidence({ oppositeEndpoint: polygon[0] }),
  ]) {
    const result = deriveAfcSr1CrossRoomPrior({ sourcePolygon: polygon, evidence: invalidEvidence });
    assert.equal(result.status, "rejected");
  }
  assert.deepEqual(
    validateAfcSr1CrossRoomLineEvidence(evidence({ oppositeEndpoint: { x: 0.71 } })),
    { status: "rejected", reason: "opposite_endpoint_shape_invalid" }
  );
});

test("invalid semantic floor polygons are rejected through the existing SR1 polygon validator", () => {
  const reordered = [polygon[1], polygon[2], polygon[3], polygon[0]];
  const collapsedNrSeam = [polygon[0], polygon[1], polygon[1], polygon[3]];
  for (const sourcePolygon of [reordered, collapsedNrSeam]) {
    const result = deriveAfcSr1CrossRoomPrior({ sourcePolygon, evidence: evidence() });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "source_polygon_invalid");
  }
});

test("a clearly contradictory declared anchor is rejected", () => {
  const result = deriveAfcSr1CrossRoomPrior({
    sourcePolygon: polygon,
    evidence: evidence({ anchorEndpoint: polygon[1] }),
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "anchor_endpoint_inconsistent");
});

test("identical immutable inputs replay to deeply identical immutable advisory output", () => {
  const input = Object.freeze({
    sourcePolygon: Object.freeze(polygon.map(point => Object.freeze({ ...point }))),
    evidence: Object.freeze({
      ...evidence(),
      anchorEndpoint: Object.freeze({ ...polygon[0] }),
      oppositeEndpoint: Object.freeze({ x: 0.71, y: 0.56 }),
    }),
  });
  const first = deriveAfcSr1CrossRoomPrior(input);
  const second = deriveAfcSr1CrossRoomPrior(input);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(input.sourcePolygon, polygon);
});

test("mirrored cross-room evidence preserves semantic behavior under x reflection", () => {
  const left = usable({ sourcePolygon: polygon, evidence: evidence() });
  const right = usable({
    sourcePolygon: polygon,
    evidence: evidence({
      truncatedAnchor: "NR",
      anchorEndpoint: polygon[1],
      oppositeEndpoint: { x: 1 - left.projectedPoint.x, y: left.projectedPoint.y },
    }),
  });
  assert.equal(left.seamT, right.seamT);
  assert.ok(Math.abs(left.projectionResidualSourceNorm - right.projectionResidualSourceNorm) < 1e-12);
  assert.equal(left.adjustableCorner, "NR");
  assert.equal(right.adjustableCorner, "NL");
  assert.ok(Math.abs(left.projectedPoint.x + right.projectedPoint.x - 1) < 1e-12);
  assert.ok(Math.abs(left.projectedPoint.y - right.projectedPoint.y) < 1e-12);
});

test("module containment is geometry-only and has no UI, Apply, or provider imports", () => {
  const source = readFileSync(new URL("./afc-sr1-cross-room-prior.ts", import.meta.url), "utf8");
  for (const forbiddenDependency of [
    "three-room-lab",
    "floor-apply",
    "camera-apply",
    "provider-execution",
    "perspective-adjust",
    "vibode/",
    "gemini",
  ]) {
    assert.equal(source.includes(forbiddenDependency), false, forbiddenDependency);
  }
});
