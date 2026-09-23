import assert from "node:assert/strict";
import test from "node:test";
import {
  AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
  classifyAfcSr1SupportedRoomView,
} from "./afc-sr1-supported-room-view";

const emptyDimensions = { decodedWidth: 1264, decodedHeight: 848 } as const;

const roomC = [
  { x: 0.045, y: 1 },
  { x: 1, y: 0.82 },
  { x: 0.415, y: 0.616 },
  { x: 0.077, y: 0.694 },
] as const;

const roomA = [
  { x: 0.10837393593189963, y: 0.9249876495993743 },
  { x: 1, y: 0.93 },
  { x: 0.688, y: 0.648 },
  { x: 0.356, y: 0.648 },
] as const;

test("classifies Room C from EMPTY geometry as left-near", () => {
  const result = classifyAfcSr1SupportedRoomView(roomC, emptyDimensions);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.classifierVersion, AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION);
  assert.equal(result.photoClass, "off_axis_left_near");
  assert.equal(result.truncatedAnchor, "NL");
  assert.ok(Math.abs(result.observables.leftVisibleRunPx - 262.62) < 0.02);
  assert.ok(Math.abs(result.observables.rightVisibleRunPx - 759.41) < 0.02);
  assert.ok(Math.abs(result.observables.truncationAsymmetry - 0.654) < 0.002);
});

test("classifies mirrored Room C as right-near", () => {
  const mirrored = [
    { x: 1 - roomC[1].x, y: roomC[1].y },
    { x: 1 - roomC[0].x, y: roomC[0].y },
    { x: 1 - roomC[3].x, y: roomC[3].y },
    { x: 1 - roomC[2].x, y: roomC[2].y },
  ] as const;
  const result = classifyAfcSr1SupportedRoomView(mirrored, emptyDimensions);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.photoClass, "off_axis_right_near");
  assert.equal(result.truncatedAnchor, "NR");
  assert.ok(Math.abs(result.observables.leftVisibleRunPx - 759.41) < 0.02);
  assert.ok(Math.abs(result.observables.rightVisibleRunPx - 262.62) < 0.02);
  assert.ok(Math.abs(result.observables.truncationAsymmetry - 0.654) < 0.002);
});

test("prioritizes on-axis detection over Room A crop asymmetry", () => {
  const result = classifyAfcSr1SupportedRoomView(roomA, emptyDimensions);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.photoClass, "on_axis");
  assert.equal(result.truncatedAnchor, null);
  assert.ok(Math.abs(result.observables.leftVisibleRunPx - 391.33) < 0.02);
  assert.ok(Math.abs(result.observables.rightVisibleRunPx - 461.21) < 0.02);
  assert.ok(result.observables.truncationAsymmetry > 0.08);
});

test("uses more-truncated right side when near y-values give no direction", () => {
  const result = classifyAfcSr1SupportedRoomView([
    { x: 0.08, y: 0.94 },
    { x: 0.94, y: 0.94 },
    { x: 0.86, y: 0.7 },
    { x: 0.2, y: 0.58 },
  ], emptyDimensions);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.photoClass, "off_axis_right_near");
  assert.equal(result.truncatedAnchor, "NR");
  assert.equal(result.observables.dyNear, 0);
  assert.ok(result.observables.truncationAsymmetry >= 0.08);
});

function truncationBoundary(rightRunY: number) {
  return [
    { x: 0.1, y: 0.95 },
    { x: 0.9, y: 0.85 },
    { x: 0.901, y: rightRunY },
    { x: 0.1, y: 0.65 },
  ] as const;
}

test("fails closed just below the MTS threshold", () => {
  const result = classifyAfcSr1SupportedRoomView(
    truncationBoundary(0.5739),
    { decodedWidth: 1000, decodedHeight: 1000 }
  );
  assert.deepEqual(
    { status: result.status, reason: result.status === "unsupported" ? result.reason : null },
    { status: "unsupported", reason: "ambiguous_supported_domain" }
  );
});

test("classifies exactly at the MTS threshold", () => {
  const exactRightRunY = 0.85 - Math.sqrt(0.276 ** 2 - 0.001 ** 2);
  const result = classifyAfcSr1SupportedRoomView(
    truncationBoundary(exactRightRunY),
    { decodedWidth: 1000, decodedHeight: 1000 }
  );
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.photoClass, "off_axis_right_near");
  assert.ok(Math.abs(result.observables.truncationAsymmetry - 0.08) < 1e-12);
});

test("classifies clearly above the MTS threshold", () => {
  const result = classifyAfcSr1SupportedRoomView(
    truncationBoundary(0.58),
    { decodedWidth: 1000, decodedHeight: 1000 }
  );
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.photoClass, "off_axis_right_near");
  assert.ok(result.observables.truncationAsymmetry > 0.08);
});

test("fails closed for equal side runs after on-axis is rejected", () => {
  const result = classifyAfcSr1SupportedRoomView([
    { x: 0.1, y: 0.95 },
    { x: 0.9, y: 0.85 },
    { x: 0.85, y: 0.5541960108450192 },
    { x: 0.1, y: 0.65 },
  ], { decodedWidth: 1000, decodedHeight: 1000 });
  assert.equal(result.status, "unsupported");
  if (result.status === "unsupported") {
    assert.equal(result.reason, "ambiguous_supported_domain");
  }
});

test("rejects invalid polygons before classification", () => {
  const result = classifyAfcSr1SupportedRoomView([
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.9 },
    { x: 0.2, y: 0.6 },
    { x: 0.8, y: 0.6 },
  ], emptyDimensions);
  assert.equal(result.status, "unsupported");
  if (result.status === "unsupported") assert.equal(result.reason, "invalid_polygon");
});

test("fails closed for invalid EMPTY dimensions", () => {
  for (const dimensions of [
    { decodedWidth: 0, decodedHeight: 848 },
    { decodedWidth: -1264, decodedHeight: 848 },
    { decodedWidth: Number.NaN, decodedHeight: 848 },
    { decodedWidth: 1264, decodedHeight: Number.POSITIVE_INFINITY },
  ]) {
    const result = classifyAfcSr1SupportedRoomView(roomC, dimensions);
    assert.equal(result.status, "unsupported");
    if (result.status === "unsupported") {
      assert.equal(result.reason, "invalid_empty_dimensions");
    }
  }
});

test("fails closed for a degenerate side edge", () => {
  const result = classifyAfcSr1SupportedRoomView([
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.8 },
    { x: 0.7, y: 0.6 },
    { x: 0.1, y: 0.9 },
  ], emptyDimensions);
  assert.equal(result.status, "unsupported");
});

test("uses true parallelism before a crop-asymmetric far wall", () => {
  const result = classifyAfcSr1SupportedRoomView([
    { x: 0.1, y: 0.92 },
    { x: 0.9, y: 0.82 },
    { x: 0.85, y: 0.59 },
    { x: 0.45, y: 0.64 },
  ], emptyDimensions);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.photoClass, "on_axis");
  assert.equal(result.observables.widthVanishingPointAtInfinity, true);
  assert.ok(Math.abs(result.observables.farMidX - 0.5) > 0.1);
});
