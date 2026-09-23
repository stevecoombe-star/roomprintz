import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type {
  P2S2GCollisionSafeBlockerQualification,
} from "../p2-s2g-collision-safe-blocker-contract";
import type {
  ProjectedVisibleFloorBlocker,
} from "./empty-visible-floor-blocker-world-projection";
import {
  qualifyP2S2FCollisionSafeBlockers,
} from "./p2-s2g-collision-safe-blocker-qualification";

type Point = Readonly<{ x: number; z: number }>;

function blocker(
  sourceFragmentId: string,
  pointsWorldXZ: readonly Point[]
): ProjectedVisibleFloorBlocker {
  return {
    sourceFragmentId,
    sourceGeometryVersion: "p2-s2d-visible-floor-contact-localizer/v1",
    sourcePolicyVersion:
      "p2-s2e-visible-floor-termination-collision-policy/v1",
    projectionVersion: "p2-s2f-visible-floor-blocker-world-projection/v1",
    coordinateSpace: "calibrated-world-xz/v1",
    geometryKind: "finite_open_blocking_polyline",
    pointsWorldXZ,
    startEndpoint: { state: "uncertain_support_limit" },
    endEndpoint: { state: "uncertain_support_limit" },
  };
}

test("emits deterministic finite non-degenerate edges with exact provenance", () => {
  const source = blocker("source-a", [
    { x: -2, z: 4 },
    { x: 0, z: 5 },
    { x: 3, z: 9 },
  ]);
  const first = qualifyP2S2FCollisionSafeBlockers([source]);
  const second = qualifyP2S2FCollisionSafeBlockers([source]);

  assert.deepEqual(first, second);
  assert.deepEqual(first.rejections, []);
  assert.deepEqual(
    first.segments.map(segment => ({
      id: segment.id,
      sourceEdgeIndex: segment.sourceEdgeIndex,
      sourcePointIndices: segment.sourcePointIndices,
      a: segment.a,
      b: segment.b,
    })),
    [
      {
        id: "source-a:edge:0",
        sourceEdgeIndex: 0,
        sourcePointIndices: [0, 1],
        a: source.pointsWorldXZ[0],
        b: source.pointsWorldXZ[1],
      },
      {
        id: "source-a:edge:1",
        sourceEdgeIndex: 1,
        sourcePointIndices: [1, 2],
        a: source.pointsWorldXZ[1],
        b: source.pointsWorldXZ[2],
      },
    ]
  );
  assert.ok(first.segments.every(segment =>
    Number.isFinite(segment.a.x) &&
    Number.isFinite(segment.a.z) &&
    Number.isFinite(segment.b.x) &&
    Number.isFinite(segment.b.z) &&
    (segment.a.x !== segment.b.x || segment.a.z !== segment.b.z)
  ));
  assert.deepEqual(first.segments[0].sourceIdentity, {
    sourceFragmentId: source.sourceFragmentId,
    sourceGeometryVersion: source.sourceGeometryVersion,
    sourcePolicyVersion: source.sourcePolicyVersion,
    sourceProjectionVersion: source.projectionVersion,
    sourceCoordinateSpace: source.coordinateSpace,
    sourceGeometryKind: source.geometryKind,
  });
});

test("open chains remain open and never gain polygon closure", () => {
  const source = blocker("open-chain", [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 2, z: 3 },
  ]);
  const result = qualifyP2S2FCollisionSafeBlockers([source]);

  assert.equal(result.segments.length, 2);
  assert.deepEqual(
    result.segments.map(segment => segment.sourcePointIndices),
    [[0, 1], [1, 2]]
  );
  assert.ok(!result.segments.some(segment =>
    segment.a.x === source.pointsWorldXZ[2].x &&
    segment.a.z === source.pointsWorldXZ[2].z &&
    segment.b.x === source.pointsWorldXZ[0].x &&
    segment.b.z === source.pointsWorldXZ[0].z
  ));
});

test("separate sources never stitch by gap, proximity, collinearity, angle, or corner", () => {
  const sources = [
    blocker("left", [{ x: 0, z: 0 }, { x: 1, z: 0 }]),
    blocker("right", [{ x: 2, z: 0 }, { x: 3, z: 0 }]),
    blocker("near", [{ x: 3.000000000001, z: 0 }, { x: 4, z: 0 }]),
    blocker("angled", [{ x: 4.000000000001, z: 0 }, { x: 5, z: 1 }]),
  ];
  const result = qualifyP2S2FCollisionSafeBlockers(sources);

  assert.equal(result.segments.length, sources.length);
  assert.deepEqual(
    result.segments.map(segment => segment.sourceIdentity.sourceFragmentId),
    sources.map(source => source.sourceFragmentId)
  );
  assert.ok(result.segments.every(segment => segment.sourceEdgeIndex === 0));
  assert.ok(!result.segments.some(segment =>
    segment.a.x === 1 && segment.a.z === 0 &&
    segment.b.x === 2 && segment.b.z === 0
  ), "intentional gap remains open");
});

test("an adversarial tiny near-collinear gap remains two independent segments", () => {
  const gap = 1e-12;
  const left = blocker("tiny-left", [
    { x: -1, z: 2 },
    { x: 0, z: 2 },
  ]);
  const right = blocker("tiny-right", [
    { x: gap, z: 2 + Number.EPSILON },
    { x: 1, z: 2 + Number.EPSILON },
  ]);
  const result = qualifyP2S2FCollisionSafeBlockers([left, right]);

  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments[0].b, left.pointsWorldXZ[1]);
  assert.deepEqual(result.segments[1].a, right.pointsWorldXZ[0]);
  assert.notDeepEqual(result.segments[0].b, result.segments[1].a);
  assert.ok(!result.segments.some(segment =>
    segment.a.x === left.pointsWorldXZ[1].x &&
    segment.b.x === right.pointsWorldXZ[0].x
  ));
});

test("invalid intermediate evidence rejects incident edges without reconnecting neighbors", () => {
  const source = blocker("broken-chain", [
    { x: 0, z: 0 },
    { x: Number.NaN, z: 1 },
    { x: 2, z: 0 },
    { x: 3, z: 0 },
  ]);
  const result = qualifyP2S2FCollisionSafeBlockers([source]);

  assert.deepEqual(
    result.rejections.map(value => ({
      sourceEdgeIndex: value.sourceEdgeIndex,
      reason: value.reason,
    })),
    [
      { sourceEdgeIndex: 0, reason: "non_finite_endpoint" },
      { sourceEdgeIndex: 1, reason: "non_finite_endpoint" },
    ]
  );
  assert.deepEqual(
    result.segments.map(segment => segment.sourcePointIndices),
    [[2, 3]]
  );
  assert.ok(!result.segments.some(segment =>
    segment.a.x === 0 && segment.a.z === 0 &&
    segment.b.x === 2 && segment.b.z === 0
  ), "P0 must not reconnect to P2");
});

test("degenerate source edges are omitted in place without filtering their points", () => {
  const source = blocker("duplicate-point", [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ]);
  const result = qualifyP2S2FCollisionSafeBlockers([source]);

  assert.deepEqual(result.rejections, [{
    sourceFragmentId: source.sourceFragmentId,
    sourceEdgeIndex: 0,
    sourcePointIndices: [0, 1],
    reason: "degenerate_source_edge",
  }]);
  assert.deepEqual(
    result.segments.map(segment => segment.sourcePointIndices),
    [[1, 2]]
  );
});

test("qualification copies exact endpoints without extrapolation or clamping", () => {
  const source = blocker("unbounded-finite", [
    { x: -1e12, z: 8.25 },
    { x: 17.75, z: 1e12 },
  ]);
  const nearby = blocker("nearby", [
    { x: 17.7500000001, z: 1e12 },
    { x: 20, z: 1e12 },
  ]);
  const result = qualifyP2S2FCollisionSafeBlockers([source, nearby]);

  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments[0].a, source.pointsWorldXZ[0]);
  assert.deepEqual(result.segments[0].b, source.pointsWorldXZ[1]);
  assert.deepEqual(result.segments[1].a, nearby.pointsWorldXZ[0]);
  assert.deepEqual(result.segments[1].b, nearby.pointsWorldXZ[1]);
});

test("independently sourced crossing segments remain unsplit and independent", () => {
  const rising = blocker("rising", [
    { x: 0, z: 0 },
    { x: 2, z: 2 },
  ]);
  const falling = blocker("falling", [
    { x: 0, z: 2 },
    { x: 2, z: 0 },
  ]);
  const result = qualifyP2S2FCollisionSafeBlockers([rising, falling]);

  assert.equal(result.segments.length, 2);
  assert.deepEqual(
    result.segments.map(segment => segment.sourceIdentity.sourceFragmentId),
    ["rising", "falling"]
  );
  assert.ok(result.segments.every(segment =>
    !(
      (segment.a.x === 1 && segment.a.z === 1) ||
      (segment.b.x === 1 && segment.b.z === 1)
    )
  ), "crossing does not create a graph junction");
});

test("duplicate identities and uncertified provenance fail closed", () => {
  const duplicate = blocker("duplicate", [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ]);
  const uncertified = {
    ...blocker("uncertified", [{ x: 2, z: 0 }, { x: 3, z: 0 }]),
    projectionVersion: "not-certified",
  } as unknown as ProjectedVisibleFloorBlocker;
  const result = qualifyP2S2FCollisionSafeBlockers([
    duplicate,
    duplicate,
    uncertified,
  ]);

  assert.deepEqual(result.segments, []);
  assert.deepEqual(
    result.rejections.map(value => value.reason),
    [
      "duplicate_source_identity",
      "duplicate_source_identity",
      "uncertified_source_provenance",
    ]
  );
});

test("future runtime contract is isolated from raw S2F, EMPTY, camera, and compositor internals", async () => {
  const root = path.join(process.cwd(), "app", "admin", "3d-room-lab");
  const [contractSource, qualificationSource] = await Promise.all([
    readFile(path.join(root, "p2-s2g-collision-safe-blocker-contract.ts"), "utf8"),
    readFile(path.join(
      root,
      "research",
      "p2-s2g-collision-safe-blocker-qualification.ts"
    ), "utf8"),
  ]);

  assert.doesNotMatch(
    contractSource,
    /empty-visible|projectVisible|PerspectiveCamera|compositor|furniture|normal/
  );
  assert.match(
    qualificationSource,
    /from "\.\/empty-visible-floor-blocker-world-projection"/
  );
  assert.match(
    qualificationSource,
    /from "\.\.\/p2-s2g-collision-safe-blocker-contract"/
  );
  assert.doesNotMatch(
    qualificationSource,
    /projectEmptyFloorPointToWorldXZ|PerspectiveCamera|compositor|solvePerspective|new Homography/
  );

  const futureP2S2HInput = (
    qualification: P2S2GCollisionSafeBlockerQualification
  ) => qualification.segments;
  const qualified = qualifyP2S2FCollisionSafeBlockers([
    blocker("runtime-seam", [{ x: 0, z: 0 }, { x: 1, z: 0 }]),
  ]);
  assert.strictEqual(futureP2S2HInput(qualified), qualified.segments);
});
