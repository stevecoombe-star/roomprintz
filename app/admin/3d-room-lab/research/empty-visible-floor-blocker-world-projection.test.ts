import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  projectEmptyFloorPointToWorldXZ,
  type EmptyToWorldXZProjectionInput,
} from "../empty-to-world-xz-projection";
import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import {
  P2_S2F_ACCIDENTAL_CLOSURE_TOLERANCE_METERS,
  projectVisibleFloorBlockersToWorldXZ,
  type P2S2FProjectionPolicyRecord,
  type P2S2FWorldProjectionInput,
} from "./empty-visible-floor-blocker-world-projection";
import type { VisibleFloorTerminationFragment } from "./empty-visible-floor-contact-localizer";

const SIZE = Object.freeze({ width: 1600, height: 900 });

function camera(horizontal = false): THREE.PerspectiveCamera {
  const value = new THREE.PerspectiveCamera(52, SIZE.width / SIZE.height, 0.1, 100);
  value.position.set(0.4, 2.2, 4.8);
  value.up.set(0, 1, 0);
  value.lookAt(0.4, horizontal ? 2.2 : 0, -0.6);
  value.updateProjectionMatrix();
  value.updateMatrixWorld(true);
  return value;
}

function fragment(
  id: string,
  pointsSourceNormalized: readonly Readonly<{ x: number; y: number }>[]
): VisibleFloorTerminationFragment {
  const first = pointsSourceNormalized[0] ?? { x: 0, y: 0 };
  const last = pointsSourceNormalized.at(-1) ?? { x: 0, y: 0 };
  return {
    id,
    roomId: "room-test",
    emptyImageSha256: "e".repeat(64),
    coordinateSpace: "empty-source-normalized/v1",
    proposalVersion: "p2-s2d-visible-floor-contact-localizer/v1",
    geometryKind: "finite_open_visible_floor_termination",
    pointsSourceNormalized,
    startEndpoint: {
      state: "uncertain_support_limit",
      pointSourceNormalized: first,
    },
    endEndpoint: {
      state: "uncertain_support_limit",
      pointSourceNormalized: last,
    },
    evidence: {
      sourceRegionVersion: "p2-s2a-visible-floor-region/v1",
      interiorSupportRule:
        "seed_connected_local_appearance_continuity_with_thin_reconciliation",
      outwardDirectionRule: "local_core_contour_normal",
      transitionRule: "first_supported_outward_appearance_transition",
      sourcePixelLength: 10,
      contactSampleCount: pointsSourceNormalized.length,
      meanSearchDistancePx: 4,
      maximumNeighborStepPx: 2,
      meanInsideRegionSupportFraction: 1,
      meanOutsideRegionExclusionFraction: 1,
      meanInsideRawMaskSupportFraction: 1,
      meanOutsideRawMaskExclusionFraction: 1,
      coreOriginStartSourcePx: { x: 1, y: 1 },
      coreOriginEndSourcePx: { x: 2, y: 2 },
      meanOutwardNormal: { x: 0, y: -1 },
      meanTransitionRgbDistance: 20,
      minimumTransitionRgbDistance: 15,
      minimumFrameDistancePx: 12,
    },
  };
}

function policy(
  fragmentId: string,
  collisionPolicy: P2S2FProjectionPolicyRecord["collisionPolicy"] = "block"
): P2S2FProjectionPolicyRecord {
  return { fragmentId, collisionPolicy };
}

function input(
  fragments: readonly VisibleFloorTerminationFragment[],
  policies = fragments.map(value => policy(value.id)),
  calibratedCamera = camera()
): P2S2FWorldProjectionInput {
  return {
    fragments,
    policies,
    emptyIntrinsicSize: SIZE,
    originalIntrinsicSize: SIZE,
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: "o".repeat(64),
        decodedWidth: SIZE.width,
        decodedHeight: SIZE.height,
        orientation: 1,
      },
      {
        fingerprint: "e".repeat(64),
        decodedWidth: SIZE.width,
        decodedHeight: SIZE.height,
        orientation: 1,
      }
    ),
    containerSize: SIZE,
    calibratedCamera,
  };
}

function success(result: ReturnType<typeof projectVisibleFloorBlockersToWorldXZ>) {
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result));
  return result as Extract<typeof result, { ok: true }>;
}

test("projects one fragment point-for-point in exact source order without mutation", () => {
  const source = fragment("f-1", [
    { x: 0.2, y: 0.72 },
    { x: 0.5, y: 0.76 },
    { x: 0.8, y: 0.7 },
  ]);
  const before = structuredClone(source);
  const value = input([source]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(value));
  const expected = source.pointsSourceNormalized.map(emptySourceNormalized => {
    const pointInput: EmptyToWorldXZProjectionInput = {
      ...value,
      emptySourceNormalized,
    };
    const projected = projectEmptyFloorPointToWorldXZ(pointInput);
    if (!projected.ok) assert.fail(projected.reason);
    return projected.worldXZ;
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.blockers.length, 1);
  assert.deepEqual(result.blockers[0].pointsWorldXZ, expected);
  assert.equal(
    result.blockers[0].pointsWorldXZ.length,
    source.pointsSourceNormalized.length
  );
  assert.equal(result.blockers[0].sourceFragmentId, source.id);
  assert.deepEqual(source, before);
});

test("joins policies by fragment ID rather than array position", () => {
  const first = fragment("f-1", [{ x: 0.2, y: 0.72 }, { x: 0.3, y: 0.73 }]);
  const second = fragment("f-2", [{ x: 0.7, y: 0.72 }, { x: 0.8, y: 0.73 }]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(input(
    [first, second],
    [policy(second.id), policy(first.id)]
  )));

  assert.deepEqual(
    result.blockers.map(blocker => blocker.sourceFragmentId),
    [first.id, second.id]
  );
});

test("accepts empty source and policy arrays", () => {
  assert.deepEqual(projectVisibleFloorBlockersToWorldXZ(input([], [])), {
    ok: true,
    blockers: [],
    failures: [],
  });
});

test("fails closed for missing, duplicate, and unknown policy IDs", () => {
  const source = fragment("f-1", [{ x: 0.2, y: 0.72 }, { x: 0.3, y: 0.73 }]);
  assert.equal(
    projectVisibleFloorBlockersToWorldXZ(input([source], [])).ok,
    false
  );
  assert.deepEqual(
    projectVisibleFloorBlockersToWorldXZ(input(
      [source],
      [policy(source.id), policy(source.id)]
    )),
    {
      ok: false,
      reason: "duplicate_policy_id",
      sourceFragmentId: source.id,
      detail: `Duplicate policy fragment ID: ${source.id}`,
    }
  );
  assert.deepEqual(
    projectVisibleFloorBlockersToWorldXZ(input([source], [policy("unknown")])),
    {
      ok: false,
      reason: "unknown_policy_id",
      sourceFragmentId: "unknown",
      detail: "Policy references unknown fragment ID: unknown",
    }
  );
});

test("fails closed for duplicate fragment IDs and mixed source provenance", () => {
  const source = fragment("f-1", [{ x: 0.2, y: 0.72 }, { x: 0.3, y: 0.73 }]);
  assert.equal(
    projectVisibleFloorBlockersToWorldXZ(input(
      [source, structuredClone(source)],
      [policy(source.id)]
    )).ok,
    false
  );
  const otherRoom = { ...fragment("f-2", [
    { x: 0.4, y: 0.72 },
    { x: 0.5, y: 0.73 },
  ]), roomId: "other-room" };
  const mixed = projectVisibleFloorBlockersToWorldXZ(input(
    [source, otherRoom],
    [policy(source.id), policy(otherRoom.id)]
  ));
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.reason, "inconsistent_provenance");
});

test("future pass policy remains an intentional world gap", () => {
  const blocked = fragment("blocked", [
    { x: 0.2, y: 0.72 },
    { x: 0.3, y: 0.73 },
  ]);
  const passed = fragment("passed", [
    { x: 0.7, y: 0.72 },
    { x: 0.8, y: 0.73 },
  ]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(input(
    [blocked, passed],
    [policy(passed.id, "pass"), policy(blocked.id)]
  )));

  assert.deepEqual(
    result.blockers.map(blocker => blocker.sourceFragmentId),
    [blocked.id]
  );
  assert.deepEqual(result.failures, []);
});

test("one failed point atomically rejects its whole fragment", () => {
  const source = fragment("atomic", [
    { x: 0.4, y: 0.7 },
    { x: 0.5, y: 0.5 },
    { x: 0.6, y: 0.7 },
  ]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(
    input([source], undefined, camera(true))
  ));

  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.failures, [{
    sourceFragmentId: source.id,
    reason: "ray_parallel_to_floor",
    failedPointIndex: 1,
  }]);
});

test("a failed fragment does not suppress a successful sibling", () => {
  const failed = fragment("failed", [
    { x: 0.4, y: 0.7 },
    { x: 0.5, y: 0.5 },
  ]);
  const sibling = fragment("sibling", [
    { x: 0.6, y: 0.7 },
    { x: 0.7, y: 0.72 },
  ]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(
    input([failed, sibling], undefined, camera(true))
  ));

  assert.deepEqual(
    result.blockers.map(blocker => blocker.sourceFragmentId),
    [sibling.id]
  );
  assert.equal(result.failures[0].sourceFragmentId, failed.id);
});

test("preserves duplicate consecutive projected world points", () => {
  const duplicate = { x: 0.5, y: 0.75 };
  const source = fragment("duplicates", [
    { x: 0.3, y: 0.72 },
    duplicate,
    duplicate,
    { x: 0.7, y: 0.72 },
  ]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(input([source])));
  const world = result.blockers[0].pointsWorldXZ;

  assert.equal(world.length, 4);
  assert.deepEqual(world[1], world[2]);
});

test("rejects an empty polyline without minting geometry", () => {
  const source = fragment("empty", []);
  const result = success(projectVisibleFloorBlockersToWorldXZ(input([source])));
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.failures, [{
    sourceFragmentId: source.id,
    reason: "empty_polyline",
    failedPointIndex: null,
  }]);
});

test("rejects numerical first/last collapse as accidental closure", () => {
  const first = { x: 0.6, y: 0.72 };
  const source = fragment("closure", [
    first,
    { x: 0.7, y: 0.75 },
    { x: first.x + Number.EPSILON, y: first.y },
  ]);
  const result = success(projectVisibleFloorBlockersToWorldXZ(input([source])));

  assert.notDeepEqual(
    source.pointsSourceNormalized[0],
    source.pointsSourceNormalized.at(-1)
  );
  assert.equal(P2_S2F_ACCIDENTAL_CLOSURE_TOLERANCE_METERS, 1e-9);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.failures, [{
    sourceFragmentId: source.id,
    reason: "accidental_closure",
    failedPointIndex: null,
  }]);
});
