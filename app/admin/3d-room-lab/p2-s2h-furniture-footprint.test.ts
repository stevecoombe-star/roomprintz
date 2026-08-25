import assert from "node:assert/strict";
import test from "node:test";

import type { AutoBoundsNormalization } from "./model-bounds";
import {
  deriveP2S2HFurnitureFootprint,
  type P2S2HFurnitureFootprintInput,
} from "./p2-s2h-furniture-footprint";
import {
  resolveSweptFurnitureBlockerTranslation,
  type FurnitureBlockerFootprint,
} from "./p2-s2h-furniture-blocker-collision";
import {
  P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE,
  P2_S2G_COLLISION_SAFE_BLOCKER_GEOMETRY_KIND,
  P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION,
  type CollisionSafeBlockerSegment,
} from "./p2-s2g-collision-safe-blocker-contract";

const BASE_AUTO_BOUNDS: AutoBoundsNormalization = {
  ok: true,
  scale: 1,
  offset: { x: -1, y: 0, z: 2 },
  measuredSize: { x: 4, y: 3, z: 2 },
  measuredCenter: { x: 1, y: 1.5, z: -2 },
};

const BASE_INPUT: P2S2HFurnitureFootprintInput = {
  autoBounds: BASE_AUTO_BOUNDS,
  autoNormalizeBoundsEnabled: true,
  effectivePlacementScale: 1,
  modelScaleMultiplier: 1,
  placementYawDeg: 0,
  modelYawOffsetDeg: 0,
};

function derive(
  overrides: Partial<P2S2HFurnitureFootprintInput> = {}
) {
  return deriveP2S2HFurnitureFootprint({
    ...BASE_INPUT,
    ...overrides,
  });
}

function successfulFootprint(
  result: ReturnType<typeof derive>
): FurnitureBlockerFootprint {
  assert.equal(result.ok, true);
  return result.footprint;
}

function bounds(
  overrides: Partial<AutoBoundsNormalization> = {}
): AutoBoundsNormalization {
  return {
    ...BASE_AUTO_BOUNDS,
    ...overrides,
  };
}

function assertApproximately(
  actual: number,
  expected: number,
  epsilon = 1e-12
): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, received ${actual}`
  );
}

test("valid auto-bounds and default authorities derive exact local half-extents and yaw", () => {
  assert.deepEqual(successfulFootprint(derive()), {
    halfWidth: 2,
    halfDepth: 1,
    yawRad: 0,
  });
});

test("auto-bounds normalization scale is applied exactly once", () => {
  const footprint = successfulFootprint(derive({
    autoBounds: bounds({
      scale: 0.25,
      measuredSize: { x: 8, y: 4, z: 2 },
    }),
  }));

  assert.deepEqual(footprint, {
    halfWidth: 1,
    halfDepth: 0.25,
    yawRad: 0,
  });
});

test("effective placement scale applies TransformState.uniformScale equally in XZ", () => {
  assert.deepEqual(successfulFootprint(derive({
    effectivePlacementScale: 1.5,
  })), {
    halfWidth: 3,
    halfDepth: 1.5,
    yawRad: 0,
  });
});

test("modelScaleMultiplier affects both local extents exactly once", () => {
  assert.deepEqual(successfulFootprint(derive({
    modelScaleMultiplier: 2.5,
  })), {
    halfWidth: 5,
    halfDepth: 2.5,
    yawRad: 0,
  });
});

test("nontrivial auto, model, and effective placement scales compose by exact product", () => {
  const footprint = successfulFootprint(derive({
    autoBounds: bounds({
      scale: 0.25,
      measuredSize: { x: 8, y: 4, z: 6 },
    }),
    effectivePlacementScale: 1.5,
    modelScaleMultiplier: 2,
  }));

  assert.deepEqual(footprint, {
    halfWidth: 3,
    halfDepth: 2.25,
    yawRad: 0,
  });
});

test("placement, model, and caller-supplied visual yaw compose without wrapping", () => {
  const cases = [
    { placementYawDeg: 0, modelYawOffsetDeg: 0, additionalYawDeg: 0, expectedDeg: 0 },
    { placementYawDeg: 30, modelYawOffsetDeg: 0, additionalYawDeg: 0, expectedDeg: 30 },
    { placementYawDeg: 0, modelYawOffsetDeg: -45, additionalYawDeg: 0, expectedDeg: -45 },
    { placementYawDeg: 30, modelYawOffsetDeg: -45, additionalYawDeg: 0, expectedDeg: -15 },
    { placementYawDeg: 450, modelYawOffsetDeg: -90, additionalYawDeg: 720, expectedDeg: 1080 },
    { placementYawDeg: 10, modelYawOffsetDeg: 20, additionalYawDeg: 30, expectedDeg: 60 },
  ];

  for (const input of cases) {
    const footprint = successfulFootprint(derive(input));
    assertApproximately(footprint.yawRad, input.expectedDeg * (Math.PI / 180));
  }
});

test("90-degree yaw and long-narrow yaw changes do not swap or inflate local extents", () => {
  const longNarrowBounds = bounds({
    measuredSize: { x: 10, y: 3, z: 2 },
  });
  const yaw0 = successfulFootprint(derive({
    autoBounds: longNarrowBounds,
    placementYawDeg: 0,
  }));
  const yaw90 = successfulFootprint(derive({
    autoBounds: longNarrowBounds,
    placementYawDeg: 90,
  }));
  const yaw137 = successfulFootprint(derive({
    autoBounds: longNarrowBounds,
    placementYawDeg: 137,
  }));

  assert.deepEqual(
    { halfWidth: yaw0.halfWidth, halfDepth: yaw0.halfDepth },
    { halfWidth: 5, halfDepth: 1 }
  );
  for (const footprint of [yaw90, yaw137]) {
    assert.equal(footprint.halfWidth, yaw0.halfWidth);
    assert.equal(footprint.halfDepth, yaw0.halfDepth);
  }
  assertApproximately(yaw90.yawRad, Math.PI / 2);
  assertApproximately(yaw137.yawRad, 137 * (Math.PI / 180));
});

test("invalid or disabled auto-bounds return explicit unavailable reasons", () => {
  const cases: Array<{
    input: Partial<P2S2HFurnitureFootprintInput>;
    reason: string;
  }> = [
    { input: { autoBounds: null }, reason: "auto_bounds_unavailable" },
    { input: { autoBounds: bounds({ ok: false }) }, reason: "auto_bounds_unavailable" },
    { input: { autoNormalizeBoundsEnabled: false }, reason: "auto_bounds_disabled" },
    {
      input: { autoBounds: bounds({ measuredSize: { x: 0, y: 3, z: 2 } }) },
      reason: "invalid_measured_size",
    },
    {
      input: { autoBounds: bounds({ measuredSize: { x: -1, y: 3, z: 2 } }) },
      reason: "invalid_measured_size",
    },
    {
      input: { autoBounds: bounds({ measuredSize: { x: 4, y: 3, z: Number.NaN } }) },
      reason: "invalid_measured_size",
    },
    {
      input: { autoBounds: bounds({ measuredSize: { x: Number.POSITIVE_INFINITY, y: 3, z: 2 } }) },
      reason: "invalid_measured_size",
    },
    {
      input: { autoBounds: bounds({ scale: Number.NaN }) },
      reason: "invalid_auto_bounds_scale",
    },
    {
      input: { autoBounds: bounds({ scale: 0 }) },
      reason: "invalid_auto_bounds_scale",
    },
    {
      input: {
        autoBounds: bounds({
          measuredCenter: { x: Number.NaN, y: 1.5, z: -2 },
        }),
      },
      reason: "invalid_auto_bounds_centering",
    },
  ];

  for (const { input, reason } of cases) {
    assert.deepEqual(derive(input), { ok: false, reason });
  }
});

test("invalid effective, model, and combined scales never fabricate a footprint", () => {
  for (const effectivePlacementScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(derive({ effectivePlacementScale }), {
      ok: false,
      reason: "invalid_effective_scale",
    });
  }
  for (const modelScaleMultiplier of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(derive({ modelScaleMultiplier }), {
      ok: false,
      reason: "invalid_model_scale",
    });
  }
  assert.deepEqual(derive({
    autoBounds: bounds({ scale: Number.MAX_VALUE }),
    effectivePlacementScale: Number.MAX_VALUE,
  }), {
    ok: false,
    reason: "invalid_combined_scale",
  });
});

test("non-finite yaw authority is rejected explicitly", () => {
  for (const input of [
    { placementYawDeg: Number.NaN },
    { placementYawDeg: Number.POSITIVE_INFINITY },
    { modelYawOffsetDeg: Number.NaN },
    { modelYawOffsetDeg: Number.NEGATIVE_INFINITY },
    { additionalYawDeg: Number.NaN },
    { additionalYawDeg: Number.POSITIVE_INFINITY },
  ]) {
    assert.deepEqual(derive(input), {
      ok: false,
      reason: "invalid_yaw",
    });
  }
});

test("derivation is deterministic and does not mutate frozen authority inputs", () => {
  Object.freeze(BASE_AUTO_BOUNDS.offset);
  Object.freeze(BASE_AUTO_BOUNDS.measuredSize);
  Object.freeze(BASE_AUTO_BOUNDS.measuredCenter);
  Object.freeze(BASE_AUTO_BOUNDS);
  Object.freeze(BASE_INPUT);
  const before = JSON.stringify(BASE_INPUT);

  const first = deriveP2S2HFurnitureFootprint(BASE_INPUT);
  const second = deriveP2S2HFurnitureFootprint(BASE_INPUT);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(BASE_INPUT), before);
});

test("model yaw never substitutes the yaw-expanded placement-local AABB", () => {
  const footprint = successfulFootprint(derive({
    autoBounds: bounds({
      scale: 0.5,
      measuredSize: { x: 10, y: 3, z: 2 },
    }),
    modelYawOffsetDeg: 45,
  }));

  assert.equal(footprint.halfWidth, 2.5);
  assert.equal(footprint.halfDepth, 0.5);
  assertApproximately(footprint.yawRad, Math.PI / 4);
  assert.notEqual(footprint.halfWidth, footprint.halfDepth);
});

test("derived footprint is accepted directly by the certified S2H-a kernel", () => {
  const footprint = successfulFootprint(derive());
  const blocker: CollisionSafeBlockerSegment = {
    id: "wall",
    qualificationVersion: P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION,
    coordinateSpace: P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE,
    geometryKind: P2_S2G_COLLISION_SAFE_BLOCKER_GEOMETRY_KIND,
    sourceIdentity: {
      sourceFragmentId: "wall",
      sourceGeometryVersion: "test/v1",
      sourcePolicyVersion: "test/v1",
      sourceProjectionVersion: "test/v1",
      sourceCoordinateSpace: "test/v1",
      sourceGeometryKind: "test-open-polyline",
    },
    sourceEdgeIndex: 0,
    sourcePointIndices: [0, 1],
    a: { x: 0, z: -10 },
    b: { x: 0, z: 10 },
  };

  const result = resolveSweptFurnitureBlockerTranslation({
    currentCenterXZ: { x: -4, z: 0 },
    proposedCenterXZ: { x: 4, z: 0 },
    footprint,
    blockers: [blocker],
    responseMode: "stop_at_contact",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "stopped_at_contact");
  assert.deepEqual(result.resolvedCenterXZ, { x: -2, z: 0 });
});
