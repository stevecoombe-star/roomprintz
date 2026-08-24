import assert from "node:assert/strict";
import test from "node:test";

import {
  type BoundaryFragmentVerification,
  type EmptyRegionBoundaryFragment,
} from "./empty-region-boundary-fragments";
import {
  P2_S2C_BOUNDARY_EVIDENCE_CLASSES,
  P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS,
  P2_S2C_BOUNDARY_COLLISION_POLICY_VERSION,
  P2_S2C_COLLISION_POLICIES,
  P2_S2C_COLLISION_POLICY_REASONS,
  classifyP2S2CCollisionPolicies,
  classifyP2S2CCollisionPolicy,
} from "./empty-boundary-collision-policy";

const BASE_VERIFICATION: BoundaryFragmentVerification = Object.freeze({
  sourcePixelLength: 60,
  sourcePixelXSpan: 47,
  sampleCount: 12,
  maximumLineResidualPx: 20,
  insideFloorLikeFraction: 0,
  outsideFloorLikeFraction: 0.2,
  meanInsideSeedRgbDistance: 200,
  meanOutsideSeedRgbDistance: 0,
  meanOutsideToInsideLumaDrop: -100,
  meanOutsideToInsideRgbDistance: 0,
  meanInsideToOutsideWarmChromaDrop: -100,
  insideRegionSupportFraction: 0.8,
  outsideRegionExclusionFraction: 0.8,
});

function sourceFragment(
  suffix: string,
  overrides: Readonly<{
    boundaryState?: EmptyRegionBoundaryFragment["boundaryState"];
    touchesImageFrame?: boolean;
    verification?: Partial<BoundaryFragmentVerification>;
    pointsSourceNormalized?: EmptyRegionBoundaryFragment[
      "pointsSourceNormalized"
    ];
  }> = {}
): EmptyRegionBoundaryFragment {
  const boundaryState = overrides.boundaryState ?? "unknown";
  const frame = boundaryState === "frame_truncated";
  const endpoint = Object.freeze({
    status: frame ? "frame_truncated" as const : "visible" as const,
    frameContact: frame ? "contacts_frame" as const : "no_frame_contact" as const,
  });
  return Object.freeze({
    id: `p2-s2a-region-boundary-fragments/v1:room-test:${suffix}`,
    roomId: "room-test",
    emptyImageSha256: "0".repeat(64),
    coordinateSpace: "empty-source-normalized/v1",
    proposalVersion: "p2-s2a-region-boundary-fragments/v1",
    sourceRegionVersion: "p2-s2a-visible-floor-region/v1",
    sourcePerimeterSpanId: `span:${suffix}`,
    geometryKind: "finite_open_observed_perimeter_span",
    boundaryState,
    classificationReasons: Object.freeze(
      boundaryState === "physical_wall"
        ? ["verified_floor_termination" as const]
        : boundaryState === "frame_truncated"
          ? ["image_frame_contact" as const]
          : ["weak_inside_outside_transition" as const]
    ),
    startEndpoint: endpoint,
    endEndpoint: endpoint,
    touchesImageFrame: overrides.touchesImageFrame ?? frame,
    pointsSourceNormalized: overrides.pointsSourceNormalized ??
      Object.freeze([{ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }]),
    verification: Object.freeze({
      ...BASE_VERIFICATION,
      ...overrides.verification,
    }),
  });
}

test("P2-S2C exposes the frozen v1 global termination thresholds", () => {
  assert.equal(
    P2_S2C_BOUNDARY_COLLISION_POLICY_VERSION,
    "p2-s2c-boundary-collision-policy/v1"
  );
  assert.deepEqual(P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS, {
    minimumSourcePixelLength: 48,
    minimumInsideRegionSupportFraction: 0.8,
    minimumOutsideRegionExclusionFraction: 0.8,
    maximumOutsideFloorLikeFraction: 0.2,
  });
  assert.deepEqual(P2_S2C_BOUNDARY_EVIDENCE_CLASSES, [
    "verified_wall_contact",
    "observed_floor_termination",
    "frame_truncated",
    "unresolved",
  ]);
  assert.deepEqual(P2_S2C_COLLISION_POLICIES, [
    "block",
    "pass",
    "unresolved",
  ]);
  assert.deepEqual(P2_S2C_COLLISION_POLICY_REASONS, [
    "source_physical_wall",
    "observed_floor_termination",
    "image_frame_contact",
    "insufficient_finite_support",
    "insufficient_region_side_support",
    "outside_still_floor_like",
  ]);
});

test("P2-S2C maps a physical wall to verified wall contact and block", () => {
  assert.deepEqual(classifyP2S2CCollisionPolicy(sourceFragment("0000", {
    boundaryState: "physical_wall",
  })), {
    fragmentId: "p2-s2a-region-boundary-fragments/v1:room-test:0000",
    evidenceClass: "verified_wall_contact",
    collisionPolicy: "block",
    policyReasons: ["source_physical_wall"],
  });
});

test("P2-S2C maps frame state or frame contact to frame truncated and pass", () => {
  const frameState = classifyP2S2CCollisionPolicy(sourceFragment("0001", {
    boundaryState: "frame_truncated",
  }));
  const frameContact = classifyP2S2CCollisionPolicy(sourceFragment("0002", {
    touchesImageFrame: true,
  }));
  for (const result of [frameState, frameContact]) {
    assert.equal(result.evidenceClass, "frame_truncated");
    assert.equal(result.collisionPolicy, "pass");
    assert.deepEqual(result.policyReasons, ["image_frame_contact"]);
  }
});

test("P2-S2C maps a supported unknown termination to block without wall gates", () => {
  const result = classifyP2S2CCollisionPolicy(sourceFragment("0003"));
  assert.deepEqual(result, {
    fragmentId: "p2-s2a-region-boundary-fragments/v1:room-test:0003",
    evidenceClass: "observed_floor_termination",
    collisionPolicy: "block",
    policyReasons: ["observed_floor_termination"],
  });
});

test("P2-S2C leaves a short unknown unresolved and non-blocking", () => {
  const result = classifyP2S2CCollisionPolicy(sourceFragment("0004", {
    verification: { sourcePixelLength: 47.999 },
  }));
  assert.equal(result.evidenceClass, "unresolved");
  assert.equal(result.collisionPolicy, "pass");
  assert.deepEqual(result.policyReasons, ["insufficient_finite_support"]);
});

test("P2-S2C leaves weak region-side support unresolved and non-blocking", () => {
  const result = classifyP2S2CCollisionPolicy(sourceFragment("0005", {
    verification: {
      insideRegionSupportFraction: 0.799,
      outsideRegionExclusionFraction: 0.799,
    },
  }));
  assert.equal(result.evidenceClass, "unresolved");
  assert.equal(result.collisionPolicy, "pass");
  assert.deepEqual(result.policyReasons, ["insufficient_region_side_support"]);
});

test("P2-S2C leaves outside-floor-like evidence unresolved and non-blocking", () => {
  const result = classifyP2S2CCollisionPolicy(sourceFragment("0006", {
    verification: { outsideFloorLikeFraction: 0.201 },
  }));
  assert.equal(result.evidenceClass, "unresolved");
  assert.equal(result.collisionPolicy, "pass");
  assert.deepEqual(result.policyReasons, ["outside_still_floor_like"]);
});

test("P2-S2C records every failed deterministic termination gate", () => {
  const result = classifyP2S2CCollisionPolicy(sourceFragment("0007", {
    verification: {
      sourcePixelLength: 1,
      insideRegionSupportFraction: null,
      outsideRegionExclusionFraction: null,
      outsideFloorLikeFraction: null,
    },
  }));
  assert.deepEqual(result.policyReasons, [
    "insufficient_finite_support",
    "insufficient_region_side_support",
    "outside_still_floor_like",
  ]);
});

test("P2-S2C emits ID-only records and cannot alter, close, or bridge geometry", () => {
  const left = sourceFragment("0008", {
    pointsSourceNormalized: Object.freeze([
      { x: 0.1, y: 0.5 },
      { x: 0.3, y: 0.4 },
    ]),
  });
  const right = sourceFragment("0009", {
    pointsSourceNormalized: Object.freeze([
      { x: 0.7, y: 0.4 },
      { x: 0.9, y: 0.5 },
    ]),
  });
  const before = structuredClone([left, right]);
  const records = classifyP2S2CCollisionPolicies([left, right]);

  assert.deepEqual([left, right], before);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => Object.keys(record).sort()), [
    ["collisionPolicy", "evidenceClass", "fragmentId", "policyReasons"],
    ["collisionPolicy", "evidenceClass", "fragmentId", "policyReasons"],
  ]);
  assert.deepEqual(records.map(record => record.fragmentId), [left.id, right.id]);
  assert.equal(records.some(record => "pointsSourceNormalized" in record), false);
  assert.equal(records.some(record => "boundaryState" in record), false);
  assert.notDeepEqual(
    left.pointsSourceNormalized.at(-1),
    right.pointsSourceNormalized[0],
    "the source opening remains a literal unrepresented gap"
  );
  for (const fragment of [left, right]) {
    assert.notDeepEqual(
      fragment.pointsSourceNormalized[0],
      fragment.pointsSourceNormalized.at(-1)
    );
  }
});
