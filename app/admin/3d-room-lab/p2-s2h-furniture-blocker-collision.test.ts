import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSweptFurnitureBlockerTranslation,
  type FurnitureBlockerFootprint,
  type FurnitureBlockerPointXZ,
  type FurnitureBlockerResponseMode,
} from "./p2-s2h-furniture-blocker-collision";
import type {
  CollisionSafeBlockerSegment,
} from "./p2-s2g-collision-safe-blocker-contract";

const AXIS_ALIGNED_FOOTPRINT: FurnitureBlockerFootprint = {
  halfWidth: 0.5,
  halfDepth: 0.5,
  yawRad: 0,
};

function blocker(
  id: string,
  a: FurnitureBlockerPointXZ,
  b: FurnitureBlockerPointXZ
): CollisionSafeBlockerSegment {
  return {
    id,
    qualificationVersion: "p2-s2g-collision-safe-blocker-qualification/v1",
    coordinateSpace: "calibrated-world-xz/v1",
    geometryKind: "finite_two_sided_line_segment",
    sourceIdentity: {
      sourceFragmentId: id,
      sourceGeometryVersion: "test-source/v1",
      sourcePolicyVersion: "test-policy/v1",
      sourceProjectionVersion: "test-projection/v1",
      sourceCoordinateSpace: "test-source-space/v1",
      sourceGeometryKind: "test-open-polyline",
    },
    sourceEdgeIndex: 0,
    sourcePointIndices: [0, 1],
    a,
    b,
  };
}

function resolve(input: {
  current: FurnitureBlockerPointXZ;
  proposed: FurnitureBlockerPointXZ;
  blockers?: readonly CollisionSafeBlockerSegment[];
  footprint?: FurnitureBlockerFootprint;
  responseMode?: FurnitureBlockerResponseMode;
}) {
  return resolveSweptFurnitureBlockerTranslation({
    currentCenterXZ: input.current,
    proposedCenterXZ: input.proposed,
    footprint: input.footprint ?? AXIS_ALIGNED_FOOTPRINT,
    blockers: input.blockers ?? [],
    responseMode: input.responseMode ?? "stop_at_contact",
  });
}

function assertPointApproximately(
  actual: FurnitureBlockerPointXZ,
  expected: FurnitureBlockerPointXZ,
  epsilon = 1e-9
): void {
  assert.ok(
    Math.abs(actual.x - expected.x) <= epsilon,
    `expected x ${expected.x}, received ${actual.x}`
  );
  assert.ok(
    Math.abs(actual.z - expected.z) <= epsilon,
    `expected z ${expected.z}, received ${actual.z}`
  );
}

function resolvedPoint(
  result: ReturnType<typeof resolve>
): FurnitureBlockerPointXZ {
  assert.equal(result.ok, true);
  assert.ok(result.resolvedCenterXZ);
  assert.ok(Number.isFinite(result.resolvedCenterXZ.x));
  assert.ok(Number.isFinite(result.resolvedCenterXZ.z));
  return result.resolvedCenterXZ;
}

test("no blockers accepts the proposed pose exactly", () => {
  const proposed = { x: 123.456, z: -789.012 };
  const result = resolve({
    current: { x: -3, z: 8 },
    proposed,
    responseMode: "drag_slide",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "accepted");
  assert.equal(result.resolvedCenterXZ, proposed);
  assert.deepEqual(result.contactBlockerIds, []);
});

test("zero motion and a far blocker resolve deterministically without mutation", () => {
  const far = blocker("far", { x: 100, z: 100 }, { x: 101, z: 100 });
  Object.freeze(far.a);
  Object.freeze(far.b);
  Object.freeze(far.sourceIdentity);
  Object.freeze(far);
  const blockers = Object.freeze([far]);
  const before = JSON.stringify(blockers);
  const zero = resolve({
    current: { x: 1, z: 2 },
    proposed: { x: 1, z: 2 },
    blockers,
  });
  const movingInput = {
    current: { x: 1, z: 2 },
    proposed: { x: 3, z: 4 },
    blockers,
  };
  const first = resolve(movingInput);
  const second = resolve(movingInput);

  assert.equal(zero.status, "accepted");
  assert.deepEqual(resolvedPoint(zero), { x: 1, z: 2 });
  assert.deepEqual(first, second);
  assert.deepEqual(resolvedPoint(first), movingInput.proposed);
  assert.equal(JSON.stringify(blockers), before);
});

test("invalid input is explicit and malformed blockers are skipped without repair", () => {
  const malformed = blocker(
    "malformed",
    { x: Number.NaN, z: 0 },
    { x: 1, z: 0 }
  );
  const degenerate = blocker("degenerate", { x: 0, z: 0 }, { x: 0, z: 0 });
  const skipped = resolve({
    current: { x: -2, z: 0 },
    proposed: { x: 2, z: 0 },
    blockers: [malformed, degenerate],
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.status, "accepted");
  assert.deepEqual(resolvedPoint(skipped), { x: 2, z: 0 });
  assert.equal(skipped.skippedInvalidBlockerCount, 2);

  for (const result of [
    resolve({
      current: { x: Number.NaN, z: 0 },
      proposed: { x: 0, z: 0 },
    }),
    resolve({
      current: { x: 0, z: 0 },
      proposed: { x: Number.POSITIVE_INFINITY, z: 0 },
    }),
  ]) {
    assert.deepEqual(result, {
      ok: false,
      status: "invalid_input",
      reason: "non_finite_position",
      resolvedCenterXZ: null,
      contactBlockerIds: [],
      skippedInvalidBlockerCount: 0,
    });
  }
  const invalidFootprint = resolve({
    current: { x: 0, z: 0 },
    proposed: { x: 1, z: 0 },
    footprint: { halfWidth: 0, halfDepth: 1, yawRad: 0 },
  });
  assert.equal(invalidFootprint.ok, false);
  assert.equal(
    invalidFootprint.ok ? null : invalidFootprint.reason,
    "invalid_footprint"
  );
});

test("perpendicular movement stops at first footprint contact with segment interior", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const result = resolve({
    current: { x: -2, z: 0 },
    proposed: { x: 2, z: 0 },
    blockers: [wall],
  });

  assert.equal(result.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(result), { x: -0.5, z: 0 });
  assert.deepEqual(result.contactBlockerIds, ["wall"]);
});

test("a high-speed single-step crossing cannot tunnel through a blocker", () => {
  const wall = blocker("wall", { x: 0, z: -2 }, { x: 0, z: 2 });
  const result = resolve({
    current: { x: -100, z: 0 },
    proposed: { x: 100, z: 0 },
    blockers: [wall],
  });

  assert.equal(result.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(result), { x: -0.5, z: 0 });
});

test("diagonal stop mode clamps both axes at the first contact time", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const result = resolve({
    current: { x: -2, z: -2 },
    proposed: { x: 2, z: 2 },
    blockers: [wall],
  });

  assert.equal(result.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(result), { x: -0.5, z: -0.5 });
});

test("diagonal drag mode removes blocked motion and slides tangentially", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const result = resolve({
    current: { x: -2, z: -2 },
    proposed: { x: 2, z: 2 },
    blockers: [wall],
    responseMode: "drag_slide",
  });

  assert.equal(result.status, "slid");
  assertPointApproximately(resolvedPoint(result), { x: -0.5, z: 2 });
});

test("two genuine blockers stop a drag conservatively at a corner", () => {
  const vertical = blocker("vertical", { x: 0, z: -10 }, { x: 0, z: 10 });
  const horizontal = blocker(
    "horizontal",
    { x: -10, z: 0 },
    { x: 10, z: 0 }
  );
  const result = resolve({
    current: { x: -2, z: -2 },
    proposed: { x: 2, z: 2 },
    blockers: [vertical, horizontal],
    responseMode: "drag_slide",
  });

  assert.equal(result.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(result), { x: -0.5, z: -0.5 });
  assert.deepEqual(result.contactBlockerIds, ["horizontal", "vertical"]);
});

test("a second contact stops the one-pass slide without an iteration loop", () => {
  const vertical = blocker("vertical", { x: 0, z: -10 }, { x: 0, z: 10 });
  const cap = blocker("cap", { x: -10, z: 1 }, { x: 0, z: 1 });
  const result = resolve({
    current: { x: -2, z: -2 },
    proposed: { x: 2, z: 3 },
    blockers: [vertical, cap],
    responseMode: "drag_slide",
  });

  assert.equal(result.status, "slid_then_stopped");
  assertPointApproximately(resolvedPoint(result), { x: -0.5, z: 0.5 });
  assert.deepEqual(result.contactBlockerIds, ["cap", "vertical"]);
});

test("finite segment interior blocks while a physically clear endpoint path passes", () => {
  const finiteWall = blocker("finite", { x: 0, z: -1 }, { x: 0, z: 1 });
  const blocked = resolve({
    current: { x: -2, z: 0 },
    proposed: { x: 2, z: 0 },
    blockers: [finiteWall],
    footprint: { halfWidth: 0.25, halfDepth: 0.25, yawRad: 0 },
  });
  const aroundEndpoint = resolve({
    current: { x: -2, z: 1.3 },
    proposed: { x: 2, z: 1.3 },
    blockers: [finiteWall],
    footprint: { halfWidth: 0.25, halfDepth: 0.25, yawRad: 0 },
  });

  assert.equal(blocked.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(blocked), { x: -0.25, z: 0 });
  assert.equal(aroundEndpoint.status, "accepted");
  assert.deepEqual(resolvedPoint(aroundEndpoint), { x: 2, z: 1.3 });
});

test("wide and tiny intentional gaps remain open when the footprint fits", () => {
  const wideGap = [
    blocker("wide-lower", { x: 0, z: -5 }, { x: 0, z: -2 }),
    blocker("wide-upper", { x: 0, z: 2 }, { x: 0, z: 5 }),
  ];
  const wideResult = resolve({
    current: { x: -2, z: 0 },
    proposed: { x: 2, z: 0 },
    blockers: wideGap,
  });
  assert.equal(wideResult.status, "accepted");

  const halfGap = 5e-9;
  const tinyGap = [
    blocker("tiny-lower", { x: 0, z: -2 }, { x: 0, z: -halfGap }),
    blocker("tiny-upper", { x: 0, z: halfGap }, { x: 0, z: 2 }),
  ];
  const fitting = resolve({
    current: { x: -1, z: 0 },
    proposed: { x: 1, z: 0 },
    blockers: tinyGap,
    footprint: { halfWidth: 1e-9, halfDepth: 1e-9, yawRad: 0 },
  });
  const tooWide = resolve({
    current: { x: -1, z: 0 },
    proposed: { x: 1, z: 0 },
    blockers: tinyGap,
    footprint: { halfWidth: 1e-9, halfDepth: 1e-8, yawRad: 0 },
  });

  assert.equal(fitting.status, "accepted");
  assert.equal(tooWide.status, "stopped_at_contact");
});

test("crossing S2G segments remain independent collision candidates", () => {
  const blockers = [
    blocker("east-west", { x: -2, z: 0 }, { x: 2, z: 0 }),
    blocker("north-south", { x: 0, z: -2 }, { x: 0, z: 2 }),
  ];
  const result = resolve({
    current: { x: -2, z: -2 },
    proposed: { x: 2, z: 2 },
    blockers,
    responseMode: "drag_slide",
  });

  assert.equal(result.status, "stopped_at_contact");
  assert.deepEqual(result.contactBlockerIds, ["east-west", "north-south"]);
  assert.deepEqual(blockers[0].a, { x: -2, z: 0 });
  assert.deepEqual(blockers[1].a, { x: 0, z: -2 });
});

test("exactly and nearly parallel clear movement does not create collision", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const exact = resolve({
    current: { x: -1, z: -5 },
    proposed: { x: -1, z: 5 },
    blockers: [wall],
  });
  const nearly = resolve({
    current: { x: -1, z: -5 },
    proposed: { x: -0.999999, z: 5 },
    blockers: [wall],
  });

  assert.equal(exact.status, "accepted");
  assert.equal(nearly.status, "accepted");
});

test("start-touching permits tangent and away motion but clamps inward motion", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const tangent = resolve({
    current: { x: -0.5, z: 0 },
    proposed: { x: -0.5, z: 2 },
    blockers: [wall],
  });
  const away = resolve({
    current: { x: -0.5, z: 0 },
    proposed: { x: -2, z: 0 },
    blockers: [wall],
  });
  const inward = resolve({
    current: { x: -0.5, z: 0 },
    proposed: { x: 1, z: 0 },
    blockers: [wall],
  });

  assert.equal(tangent.status, "accepted");
  assert.equal(away.status, "accepted");
  assert.equal(inward.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(inward), { x: -0.5, z: 0 });
});

test("start-overlapping returns a deterministic no-pop-out status", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const current = { x: -0.49, z: 0 };
  const result = resolve({
    current,
    proposed: { x: -2, z: 0 },
    blockers: [wall],
  });

  assert.equal(result.status, "start_overlapping");
  assert.equal(result.resolvedCenterXZ, current);
  assert.deepEqual(result.contactBlockerIds, ["wall"]);
});

test("rotated rectangles use yaw-local edge support at 0, 45, and 90 degrees", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const footprint = { halfWidth: 1, halfDepth: 0.25 };
  const cases = [
    { yawRad: 0, expectedX: -1 },
    {
      yawRad: Math.PI / 4,
      expectedX: -(footprint.halfWidth + footprint.halfDepth) / Math.sqrt(2),
    },
    { yawRad: Math.PI / 2, expectedX: -0.25 },
  ];

  for (const { yawRad, expectedX } of cases) {
    const result = resolve({
      current: { x: -3, z: 0 },
      proposed: { x: 3, z: 0 },
      blockers: [wall],
      footprint: { ...footprint, yawRad },
    });
    assert.equal(result.status, "stopped_at_contact");
    assertPointApproximately(resolvedPoint(result), { x: expectedX, z: 0 });
  }
});

test("long narrow footprint behavior changes with yaw and is not circular", () => {
  const wall = blocker("wall", { x: 0, z: -10 }, { x: 0, z: 10 });
  const yaw0 = resolve({
    current: { x: -4, z: 0 },
    proposed: { x: 4, z: 0 },
    blockers: [wall],
    footprint: { halfWidth: 2, halfDepth: 0.1, yawRad: 0 },
  });
  const yaw90 = resolve({
    current: { x: -4, z: 0 },
    proposed: { x: 4, z: 0 },
    blockers: [wall],
    footprint: { halfWidth: 2, halfDepth: 0.1, yawRad: Math.PI / 2 },
  });

  assertPointApproximately(resolvedPoint(yaw0), { x: -2, z: 0 });
  assertPointApproximately(resolvedPoint(yaw90), { x: -0.1, z: 0 });
});

test("collision respects the exact finite endpoint without extension", () => {
  const wall = blocker("wall", { x: 0, z: -1 }, { x: 0, z: 0 });
  const footprint = { halfWidth: 0.1, halfDepth: 0.1, yawRad: 0 };
  const clear = resolve({
    current: { x: -1, z: 0.1001 },
    proposed: { x: 1, z: 0.1001 },
    blockers: [wall],
    footprint,
  });
  const contact = resolve({
    current: { x: -1, z: 0.0999 },
    proposed: { x: 1, z: 0.0999 },
    blockers: [wall],
    footprint,
  });

  assert.equal(clear.status, "accepted");
  assert.equal(contact.status, "stopped_at_contact");
});

test("an extremely short finite non-zero blocker remains collision-active", () => {
  const short = blocker("short", { x: 0, z: 0 }, { x: 0, z: 1e-9 });
  const result = resolve({
    current: { x: -1, z: 5e-10 },
    proposed: { x: 1, z: 5e-10 },
    blockers: [short],
    footprint: { halfWidth: 0.1, halfDepth: 0.1, yawRad: 0 },
  });

  assert.equal(result.status, "stopped_at_contact");
  assertPointApproximately(resolvedPoint(result), { x: -0.1, z: 5e-10 });
  assert.equal(result.skippedInvalidBlockerCount, 0);
});
