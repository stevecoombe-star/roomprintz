import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import { buildProductionPerspectiveCamera } from "@/lib/afc-v2-runtime/frozen-camera";
import { createPi3aAuthority } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";
import { projectWorldPointToNormalizedImage } from "@/lib/afc-v2-runtime/world-to-image-projection";
import {
  hardFallbackMetricDecisionRaw,
  pathAAcceptedMetricDecisionRaw,
  pathBAcceptedMetricDecisionRaw,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision.fixture";

import { trustedPathBaselineFromGeneration } from "./trusted-path-authority";
import { liftTrustedPathSegment } from "./trusted-path-floor";
import {
  effectiveTrustedPathLengthMeters,
  TRUSTED_PATH_INCHES_PER_METER,
  formatMetersAndImperial,
  formatTrustedPathImperialLabel,
  formatTrustedPathLengthLabel,
  initialTrustedPathVisible,
  nextTrustedPathVisible,
  trustedPathVisibleAfterScaleReset,
} from "./trusted-path";

const BASELINE_METERS = 4.2;

function classifyPair(sizes: Readonly<{
  originalWidth: number;
  originalHeight: number;
  emptyWidth: number;
  emptyHeight: number;
}>) {
  return classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "original",
      decodedWidth: sizes.originalWidth,
      decodedHeight: sizes.originalHeight,
      orientation: 1,
    },
    {
      fingerprint: "empty",
      decodedWidth: sizes.emptyWidth,
      decodedHeight: sizes.emptyHeight,
      orientation: 1,
    },
  );
}

test("1.00× returns the exact baseline trusted-path length", () => {
  const shown = effectiveTrustedPathLengthMeters(BASELINE_METERS, 1);
  assert.equal(shown, BASELINE_METERS);
  assert.equal(formatTrustedPathLengthLabel(shown ?? Number.NaN), "4.20 m");
});

test("0.50× returns half the baseline", () => {
  const shown = effectiveTrustedPathLengthMeters(BASELINE_METERS, 0.5);
  assert.equal(shown, 2.1);
  assert.equal(formatTrustedPathLengthLabel(shown ?? Number.NaN), "2.10 m");
});

test("2.00× returns double the baseline", () => {
  const shown = effectiveTrustedPathLengthMeters(BASELINE_METERS, 2);
  assert.equal(shown, 8.4);
  assert.equal(formatTrustedPathLengthLabel(shown ?? Number.NaN), "8.40 m");
});

test("1.25× scales the baseline by that fraction", () => {
  const shown = effectiveTrustedPathLengthMeters(BASELINE_METERS, 1.25);
  assert.equal(shown, 5.25);
  assert.equal(formatTrustedPathLengthLabel(shown ?? Number.NaN), "5.25 m");
});

test("representative room-scale steps match the certified baseline", () => {
  assert.equal(formatTrustedPathLengthLabel(
    effectiveTrustedPathLengthMeters(BASELINE_METERS, 1.1) ?? Number.NaN,
  ), "4.62 m");
  assert.equal(formatTrustedPathLengthLabel(
    effectiveTrustedPathLengthMeters(BASELINE_METERS, 0.9) ?? Number.NaN,
  ), "3.78 m");
  assert.equal(formatTrustedPathLengthLabel(
    effectiveTrustedPathLengthMeters(BASELINE_METERS, 1.5) ?? Number.NaN,
  ), "6.30 m");
});

test("1.00 m formats as 3 feet 3 inches", () => {
  assert.equal(formatTrustedPathImperialLabel(1), `3' 3"`);
  assert.equal(formatMetersAndImperial(1), `1.00 m\n3' 3"`);
});

test("4.20 m formats as 13 feet 9 inches", () => {
  assert.equal(formatTrustedPathImperialLabel(4.2), `13' 9"`);
  assert.equal(formatMetersAndImperial(4.2), `4.20 m\n13' 9"`);
});

test("5.40 m formats as 17 feet 9 inches", () => {
  assert.equal(formatTrustedPathImperialLabel(5.4), `17' 9"`);
  assert.equal(formatMetersAndImperial(5.4), `5.40 m\n17' 9"`);
});

test("fractional room scale converts the effective metre value", () => {
  const shown = effectiveTrustedPathLengthMeters(4.2, 1.25);
  assert.equal(shown, 5.25);
  assert.equal(formatMetersAndImperial(shown ?? Number.NaN), `5.25 m\n17' 3"`);
  assert.equal(
    formatMetersAndImperial(shown ?? Number.NaN),
    formatMetersAndImperial(5.25),
  );
  assert.equal(formatMetersAndImperial(
    effectiveTrustedPathLengthMeters(4.2, 0.5) ?? Number.NaN,
  ), `2.10 m\n6' 11"`);
});

test("an inch remainder that rounds to 12 becomes the next foot", () => {
  const meters = 11.5 / TRUSTED_PATH_INCHES_PER_METER;
  assert.equal(formatTrustedPathImperialLabel(meters), `1' 0"`);
  assert.equal(formatMetersAndImperial(meters), `0.29 m\n1' 0"`);
});

test("zero and invalid lengths follow the metric helper", () => {
  assert.equal(formatTrustedPathLengthLabel(0), "0.00 m");
  assert.equal(formatMetersAndImperial(0), `0.00 m\n0' 0"`);
  assert.equal(formatTrustedPathLengthLabel(Number.NaN), null);
  assert.equal(formatTrustedPathImperialLabel(Number.NaN), null);
  assert.equal(formatMetersAndImperial(Number.NaN), null);
  assert.equal(formatMetersAndImperial(Number.POSITIVE_INFINITY), null);
  assert.equal(formatTrustedPathLengthLabel(-1), "-1.00 m");
  assert.equal(formatTrustedPathImperialLabel(-1), null);
  assert.equal(formatMetersAndImperial(-1), null);
});

test("metric display stays two decimal metres", () => {
  assert.equal(formatTrustedPathLengthLabel(4.2), "4.20 m");
  assert.equal(formatTrustedPathLengthLabel(5.4), "5.40 m");
  assert.equal(formatMetersAndImperial(4.2)?.startsWith("4.20 m\n"), true);
});

test("reset returns the displayed length to the baseline", () => {
  assert.equal(formatTrustedPathLengthLabel(
    effectiveTrustedPathLengthMeters(BASELINE_METERS, 1.5) ?? Number.NaN,
  ), "6.30 m");
  assert.equal(effectiveTrustedPathLengthMeters(BASELINE_METERS, 1), BASELINE_METERS);
});

test("reset does not force path visibility off", () => {
  assert.equal(trustedPathVisibleAfterScaleReset(true), true);
  assert.equal(trustedPathVisibleAfterScaleReset(false), false);
});

test("path starts hidden and stays hidden when no path is available", () => {
  assert.equal(initialTrustedPathVisible(), false);
  assert.equal(nextTrustedPathVisible(false, false), false);
  assert.equal(nextTrustedPathVisible(true, false), true);
  assert.equal(nextTrustedPathVisible(false, true), true);
  assert.equal(nextTrustedPathVisible(true, true), false);
});

test("missing trusted-path data fails closed", () => {
  const sizes = {
    originalWidth: 1200,
    originalHeight: 800,
    emptyWidth: 1200,
    emptyHeight: 800,
  };
  assert.equal(trustedPathBaselineFromGeneration({
    metricDecision: null,
    ...sizes,
  }), null);
  assert.equal(trustedPathBaselineFromGeneration({
    metricDecision: { schemaVersion: "not-a-decision" },
    ...sizes,
  }), null);
  assert.equal(trustedPathBaselineFromGeneration({
    metricDecision: hardFallbackMetricDecisionRaw(),
    ...sizes,
  }), null);
  const untrusted = pathAAcceptedMetricDecisionRaw();
  assert.equal(trustedPathBaselineFromGeneration({
    metricDecision: {
      ...untrusted,
      pathA: {
        ...untrusted.pathA,
        spanTrust: { ...untrusted.pathA.spanTrust, trusted: false },
      },
    },
    ...sizes,
  }), null);
});

test("path A baseline is the certified physical metres and endpoints", () => {
  const selected = trustedPathBaselineFromGeneration({
    metricDecision: pathAAcceptedMetricDecisionRaw(),
    originalWidth: 100,
    originalHeight: 80,
    emptyWidth: 50,
    emptyHeight: 40,
  });
  assert.ok(selected);
  assert.equal(selected.baselineLengthMeters, 4.1);
  assert.deepEqual(selected.imageA, { x: 0.123, y: 0.842 });
  assert.deepEqual(selected.imageB, { x: 0.774, y: 0.837 });
  assert.equal(effectiveTrustedPathLengthMeters(selected.baselineLengthMeters, 1), 4.1);
});

test("path B accepts an exact-grid pair and keeps the EMPTY endpoints", () => {
  const decision = pathBAcceptedMetricDecisionRaw();
  const sizes = {
    originalWidth: 1000,
    originalHeight: 800,
    emptyWidth: 1000,
    emptyHeight: 800,
  };
  assert.equal(classifyPair(sizes).tier, "exact_grid_compatible");
  const selected = trustedPathBaselineFromGeneration({
    metricDecision: decision,
    ...sizes,
  });
  assert.ok(selected);
  assert.equal(selected.baselineLengthMeters, 2.4);
  assert.deepEqual(selected.imageA, { x: 0.21, y: 0.73 });
  assert.deepEqual(selected.imageB, { x: 0.68, y: 0.74 });
});

test("path B accepts an aspect-compatible rescale and keeps the same endpoints", () => {
  const decision = pathBAcceptedMetricDecisionRaw();
  const sizes = {
    originalWidth: 2048,
    originalHeight: 1367,
    emptyWidth: 1264,
    emptyHeight: 848,
  };
  assert.equal(classifyPair(sizes).tier, "aspect_compatible_rescaled");
  const selected = trustedPathBaselineFromGeneration({
    metricDecision: decision,
    ...sizes,
  });
  assert.ok(selected);
  assert.equal(selected.baselineLengthMeters, 2.4);
  assert.deepEqual(selected.imageA, { x: 0.21, y: 0.73 });
  assert.deepEqual(selected.imageB, { x: 0.68, y: 0.74 });
});

test("path B rejects an incompatible aspect pair", () => {
  const decision = pathBAcceptedMetricDecisionRaw();
  const sizes = {
    originalWidth: 1000,
    originalHeight: 800,
    emptyWidth: 1000,
    emptyHeight: 700,
  };
  assert.equal(classifyPair(sizes).tier, "incompatible");
  assert.equal(trustedPathBaselineFromGeneration({
    metricDecision: decision,
    ...sizes,
  }), null);
});

test("selectedPath none stays unavailable on an aspect-compatible pair", () => {
  const sizes = {
    originalWidth: 2048,
    originalHeight: 1367,
    emptyWidth: 1264,
    emptyHeight: 848,
  };
  assert.equal(classifyPair(sizes).tier, "aspect_compatible_rescaled");
  assert.equal(trustedPathBaselineFromGeneration({
    metricDecision: hardFallbackMetricDecisionRaw(),
    ...sizes,
  }), null);
});

test("lifted floor segment follows the realized camera and matches the scaled length", () => {
  const authority = createPi3aAuthority({ metricScale: 1 });
  const world = realizeProductionWorld(authority, 1);
  const built = buildProductionPerspectiveCamera(world.camera);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const floorA = { x: -0.5, y: 0, z: -0.2 };
  const floorB = { x: 0.7, y: 0, z: -0.2 };
  const imageA = projectWorldPointToNormalizedImage(built.camera, floorA);
  const imageB = projectWorldPointToNormalizedImage(built.camera, floorB);
  assert.ok(imageA && imageB);
  const intrinsic = {
    width: authority.original.decodedWidth,
    height: authority.original.decodedHeight,
  };
  const frame = authority.frozenCamera.frame;
  const lifted = liftTrustedPathSegment(imageA, imageB, intrinsic, frame, built.camera);
  assert.ok(lifted);
  assert.ok(Math.abs(lifted.a.x - floorA.x) < 1e-4);
  assert.ok(Math.abs(lifted.a.z - floorA.z) < 1e-4);
  assert.ok(Math.abs(lifted.b.x - floorB.x) < 1e-4);
  assert.equal(lifted.a.y, 0);
  const baseline = Math.hypot(lifted.b.x - lifted.a.x, lifted.b.z - lifted.a.z);
  assert.equal(effectiveTrustedPathLengthMeters(baseline, 1), baseline);

  const scaledWorld = realizeProductionWorld(authority, 2);
  const scaledCamera = buildProductionPerspectiveCamera(scaledWorld.camera);
  assert.equal(scaledCamera.ok, true);
  if (!scaledCamera.ok) return;
  const scaled = liftTrustedPathSegment(
    imageA,
    imageB,
    intrinsic,
    frame,
    scaledCamera.camera,
  );
  assert.ok(scaled);
  const scaledLength = Math.hypot(scaled.b.x - scaled.a.x, scaled.b.z - scaled.a.z);
  const displayed = effectiveTrustedPathLengthMeters(baseline, 2);
  assert.ok(displayed != null);
  assert.ok(Math.abs(scaledLength - displayed) < 1e-4);
  assert.ok(Math.abs(scaled.a.x - floorA.x * 2) < 1e-4);
  assert.ok(Math.abs(scaled.b.z - floorB.z * 2) < 1e-4);
});

test("room scale popover keeps reset from hiding the path", () => {
  const control = readFileSync("components/stage/RoomScaleControl.tsx", "utf8");
  const context = readFileSync("components/stage/StageEditorContext.tsx", "utf8");
  assert.match(control, /Reset/);
  assert.match(control, />\s*Path\s*</);
  assert.match(control, /justify-between/);
  assert.match(control, /disabled=\{!stage\.trustedPath\}/);
  assert.match(control, /trustedPathVisible/);
  assert.match(context, /initialTrustedPathVisible\(\)/);
  assert.match(context, /nextTrustedPathVisible/);
  const resetAt = control.indexOf("Reset");
  const resetButton = control.slice(resetAt - 180, resetAt);
  assert.match(resetButton, /setRoomScaleMultiplier\(1\)/);
  assert.doesNotMatch(resetButton, /trustedPathVisible|toggleTrustedPath/);
});
