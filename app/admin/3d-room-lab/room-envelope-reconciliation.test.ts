import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOM_ENVELOPE_BLOCKER_ORDER,
  buildRoomEnvelopeCanonicalFrame,
  reconcileRoomEnvelope,
  selectRoomEnvelopeAnchor,
} from "./room-envelope-reconciliation";
import type {
  RoomEnvelopeGeometryInput,
  RoomEnvelopeInclusionState,
  RoomEnvelopeSupportGeometries,
  RoomEnvelopeWallGeometry,
} from "./room-envelope-types";

const ALL_INCLUDED: RoomEnvelopeInclusionState = {
  floor: true,
  wall_back: true,
  wall_left: true,
  wall_right: true,
  ceiling: false,
};

function plane(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) {
  return { point, normal, basisU: { x: 1, y: 0, z: 0 }, basisV: { x: 0, y: 1, z: 0 } };
}

function wall(
  kind: "wall_back" | "wall_left" | "wall_right",
  seam: readonly [{ x: number; y: number; z: number }, { x: number; y: number; z: number }],
  normal: { x: number; y: number; z: number },
  boundary: readonly { x: number; y: number; z: number }[],
  planePoint = seam[0]
): RoomEnvelopeWallGeometry {
  return { kind, seamWorld: seam, boundaryWorld: boundary, plane: plane(planePoint, normal) };
}

function roomSupports(): RoomEnvelopeSupportGeometries {
  return {
    floor: {
      kind: "floor",
      boundaryWorld: [
        { x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }, { x: -2, y: 0, z: 4 },
      ],
      plane: plane({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
    },
    wall_back: wall(
      "wall_back",
      [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      { x: 0, y: 0, z: 1 },
      [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: -2, y: 3, z: 0 }]
    ),
    wall_left: wall(
      "wall_left",
      [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 4 }],
      { x: 1, y: 0, z: 0 },
      [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 4 }, { x: -2, y: 3, z: 4 }, { x: -2, y: 3, z: 0 }]
    ),
    wall_right: wall(
      "wall_right",
      [{ x: 2, y: 0, z: 4 }, { x: 2, y: 0, z: 0 }],
      { x: -1, y: 0, z: 0 },
      [{ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }, { x: 2, y: 3, z: 4 }, { x: 2, y: 3, z: 0 }]
    ),
    ceiling: {
      kind: "ceiling",
      boundaryWorld: [
        { x: -2, y: 3, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 2, y: 3, z: 4 }, { x: -2, y: 3, z: 4 },
      ],
      plane: plane({ x: 0, y: 3, z: 0 }, { x: 0, y: -1, z: 0 }),
      roomHeight: 3,
    },
  };
}

function input(overrides: Partial<RoomEnvelopeGeometryInput> = {}): RoomEnvelopeGeometryInput {
  return {
    supports: roomSupports(),
    included: { ...ALL_INCLUDED },
    anchorChoice: { mode: "default" },
    foregroundCap: null,
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function hasFiniteNumbers(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return true;
  return Object.values(value).every(hasFiniteNumbers);
}

function determinant(frame: NonNullable<ReturnType<typeof buildRoomEnvelopeCanonicalFrame>["frame"]>) {
  const { xAxisWorld: x, yAxisWorld: y, zAxisWorld: z } = frame;
  return (x.y * y.z - x.z * y.y) * z.x + (x.z * y.x - x.x * y.z) * z.y + (x.x * y.y - x.y * y.x) * z.z;
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function rotateYaw(vector: { x: number; y: number; z: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: vector.x * cosine + vector.z * sine,
    y: vector.y,
    z: -vector.x * sine + vector.z * cosine,
  };
}

function rotatedRoomSupports(degrees: number): RoomEnvelopeSupportGeometries {
  const supports = roomSupports();
  const rotatePlane = (value: NonNullable<RoomEnvelopeSupportGeometries["floor"]>["plane"]) => ({
    point: rotateYaw(value.point, degrees),
    normal: rotateYaw(value.normal, degrees),
    basisU: rotateYaw(value.basisU, degrees),
    basisV: rotateYaw(value.basisV, degrees),
  });
  const rotateWall = (value: RoomEnvelopeWallGeometry) => ({
    ...value,
    seamWorld: [rotateYaw(value.seamWorld[0], degrees), rotateYaw(value.seamWorld[1], degrees)] as const,
    boundaryWorld: value.boundaryWorld.map((point) => rotateYaw(point, degrees)),
    plane: rotatePlane(value.plane),
  });
  return {
    floor: {
      ...supports.floor!,
      boundaryWorld: supports.floor!.boundaryWorld.map((point) => rotateYaw(point, degrees)),
      plane: rotatePlane(supports.floor!.plane),
    },
    wall_back: rotateWall(supports.wall_back!),
    wall_left: rotateWall(supports.wall_left!),
    wall_right: rotateWall(supports.wall_right!),
    ceiling: {
      ...supports.ceiling!,
      boundaryWorld: supports.ceiling!.boundaryWorld.map((point) => rotateYaw(point, degrees)),
      plane: rotatePlane(supports.ceiling!.plane),
    },
  };
}

function roomSupportsWithWidth(width: number): RoomEnvelopeSupportGeometries {
  const supports = roomSupports();
  const remap = (point: { x: number; y: number; z: number }) => ({ x: ((point.x + 2) * width) / 4, y: point.y, z: point.z });
  const remapWall = (value: RoomEnvelopeWallGeometry) => ({
    ...value,
    seamWorld: [remap(value.seamWorld[0]), remap(value.seamWorld[1])] as const,
    boundaryWorld: value.boundaryWorld.map(remap),
    plane: { ...value.plane, point: remap(value.plane.point) },
  });
  return {
    floor: {
      ...supports.floor!,
      boundaryWorld: supports.floor!.boundaryWorld.map(remap),
      plane: { ...supports.floor!.plane, point: remap(supports.floor!.plane.point) },
    },
    wall_back: remapWall(supports.wall_back!),
    wall_left: remapWall(supports.wall_left!),
    wall_right: remapWall(supports.wall_right!),
    ceiling: {
      ...supports.ceiling!,
      boundaryWorld: supports.ceiling!.boundaryWorld.map(remap),
      plane: { ...supports.ceiling!.plane, point: remap(supports.ceiling!.plane.point) },
    },
  };
}

function a3PartialSupports(): RoomEnvelopeSupportGeometries {
  const supports = roomSupports();
  supports.wall_right = null;
  supports.ceiling = null;
  supports.wall_left = {
    ...supports.wall_left!,
    // Polygon order is lower-start, lower-end, upper-end, upper-start.
    // The upper-start is the visible Back/Left seam corner and intentionally
    // extends 0.120 units behind the candidate Back face.
    boundaryWorld: [
      { x: -2, y: 0, z: 0 },
      { x: -2, y: 0, z: 4 },
      { x: -2, y: 3, z: 4 },
      { x: -2, y: 3, z: -0.12 },
    ],
  };
  return supports;
}

function boundaryObservation(
  result: ReturnType<typeof reconcileRoomEnvelope>,
  expected: {
    supportKind: string;
    pointRole: string;
    pointIndex?: number;
    candidateFaceId: string;
  }
) {
  const observation = result.residuals.boundaryObservations.find(
    (candidate) =>
      candidate.supportKind === expected.supportKind &&
      candidate.pointRole === expected.pointRole &&
      (expected.pointIndex === undefined || candidate.pointIndex === expected.pointIndex) &&
      candidate.candidateFaceId === expected.candidateFaceId
  );
  assert.ok(observation, `missing boundary observation ${JSON.stringify(expected)}`);
  return observation;
}

test("canonical anchors construct positive, orthonormal world frames independent of seam direction", () => {
  const supports = roomSupports();
  const expected = {
    wall_back: { x: { x: 1, y: 0, z: 0 }, z: { x: 0, y: 0, z: 1 } },
    wall_left: { x: { x: 1, y: 0, z: 0 }, z: { x: 0, y: 0, z: 1 } },
    wall_right: { x: { x: 1, y: 0, z: 0 }, z: { x: 0, y: 0, z: 1 } },
    floor_axes: { x: { x: 1, y: 0, z: 0 }, z: { x: 0, y: 0, z: 1 } },
  };
  for (const anchor of Object.keys(expected) as ("wall_back" | "wall_left" | "wall_right" | "floor_axes")[]) {
    const result = buildRoomEnvelopeCanonicalFrame(input({ supports, anchorChoice: { mode: "explicit", anchor } }));
    assert.equal(result.blockers.length, 0, anchor);
    assert.deepEqual(result.frame?.xAxisWorld, expected[anchor].x);
    assert.deepEqual(result.frame?.yAxisWorld, { x: 0, y: 1, z: 0 });
    assert.deepEqual(result.frame?.zAxisWorld, expected[anchor].z);
    assert.ok(result.frame && determinant(result.frame) > 0);
    assert.ok(result.frame && Math.abs(Math.hypot(result.frame.xAxisWorld.x, result.frame.xAxisWorld.y, result.frame.xAxisWorld.z) - 1) < 1e-12);
    assert.ok(result.frame && Math.abs(dot(result.frame.xAxisWorld, result.frame.yAxisWorld)) < 1e-12);
    assert.ok(result.frame && Math.abs(dot(result.frame.xAxisWorld, result.frame.zAxisWorld)) < 1e-12);
  }
  assert.deepEqual(
    buildRoomEnvelopeCanonicalFrame(input({ anchorChoice: { mode: "explicit", anchor: "wall_left" } })).frame?.originWorld,
    { x: -2, y: 0, z: 2 }
  );
  assert.deepEqual(
    buildRoomEnvelopeCanonicalFrame(input({ anchorChoice: { mode: "explicit", anchor: "floor_axes" } })).frame?.originWorld,
    { x: 0, y: 0, z: 0 }
  );
  const reversed = roomSupports();
  reversed.wall_back = { ...reversed.wall_back!, seamWorld: [{ x: 2, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }] };
  const normal = buildRoomEnvelopeCanonicalFrame(input()).frame!;
  const flip = buildRoomEnvelopeCanonicalFrame(input({ supports: reversed })).frame!;
  assert.deepEqual(flip, normal);
  assert.deepEqual(normal.originWorld, { x: 0, y: 0, z: 0 });
  const sideReversed = roomSupports();
  sideReversed.wall_left = {
    ...sideReversed.wall_left!,
    seamWorld: [{ x: -2, y: 0, z: 4 }, { x: -2, y: 0, z: 0 }],
  };
  sideReversed.wall_right = {
    ...sideReversed.wall_right!,
    seamWorld: [{ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }],
  };
  assert.deepEqual(reconcileRoomEnvelope(input({ supports: sideReversed })), reconcileRoomEnvelope(input()));
});

test("anchor selection uses fixed precedence, explicit override, and fails closed", () => {
  assert.deepEqual(selectRoomEnvelopeAnchor(input()).resolvedAnchor, { kind: "wall_back", selection: "default" });
  assert.deepEqual(selectRoomEnvelopeAnchor(input({ anchorChoice: { mode: "explicit", anchor: "wall_right" } })).resolvedAnchor, {
    kind: "wall_right", selection: "explicit",
  });
  const noBack = input();
  noBack.supports.wall_back = null;
  assert.deepEqual(selectRoomEnvelopeAnchor(noBack).resolvedAnchor, { kind: "wall_left", selection: "default" });
  const onlyRight = input({ included: { ...ALL_INCLUDED, wall_back: false, wall_left: false } });
  assert.deepEqual(selectRoomEnvelopeAnchor(onlyRight).resolvedAnchor, { kind: "wall_right", selection: "default" });
  const floorOnly = input({ included: { ...ALL_INCLUDED, wall_back: false, wall_left: false, wall_right: false } });
  assert.deepEqual(selectRoomEnvelopeAnchor(floorOnly).resolvedAnchor, { kind: "floor_axes", selection: "default" });
  assert.deepEqual(selectRoomEnvelopeAnchor(input({ anchorChoice: { mode: "explicit", anchor: "wall_back" }, included: { ...ALL_INCLUDED, wall_back: false } })).blockers, ["explicit_anchor_excluded"]);
  assert.deepEqual(selectRoomEnvelopeAnchor(input({ supports: { ...roomSupports(), wall_back: null }, anchorChoice: { mode: "explicit", anchor: "wall_back" } })).blockers, ["explicit_anchor_missing"]);
});

test("partial and candidate rules preserve missing support facts without blockers", () => {
  const cases: [string, Partial<RoomEnvelopeInclusionState>][] = [
    ["floor only", { wall_back: false, wall_left: false, wall_right: false }],
    ["floor back", { wall_left: false, wall_right: false }],
    ["floor side", { wall_back: false, wall_right: false }],
    ["two adjacent", { wall_right: false }],
    ["left right", { wall_back: false }],
  ];
  for (const [label, changes] of cases) {
    const result = reconcileRoomEnvelope(input({ included: { ...ALL_INCLUDED, ...changes } }));
    assert.equal(result.status, "partial", label);
    assert.deepEqual(result.blockers, [], label);
    if (label === "left right") assert.deepEqual(result.dimensions.width, { present: true, value: 4, provenance: "machine_derived_world_extent" });
  }
  const exact = reconcileRoomEnvelope(input());
  assert.equal(exact.status, "candidate");
  assert.equal(exact.residuals.maxStructuralBoundaryDistance, 0);
  assert.equal(exact.residuals.maxFinitePatchBoundaryOverrun, 0);
  assert.equal(exact.residuals.maxAbsSupportPlaneOffset, 0);
  assert.equal(exact.hasCeiling, false);
  assert.equal(exact.hasForegroundCap, false);
  assert.equal(exact.isCompleteCappedEnvelope, false);
  const ceiling = reconcileRoomEnvelope(input({ included: { ...ALL_INCLUDED, ceiling: true } }));
  assert.equal(ceiling.status, "candidate");
  assert.deepEqual(ceiling.dimensions.roomHeight, { present: true, value: 3, provenance: "machine_derived_world_extent" });
  const floorCeilingOnly = reconcileRoomEnvelope(input({
    included: { ...ALL_INCLUDED, wall_back: false, wall_left: false, wall_right: false, ceiling: true },
  }));
  assert.equal(floorCeilingOnly.status, "partial");
  assert.deepEqual(floorCeilingOnly.blockers, []);
  assert.deepEqual(floorCeilingOnly.dimensions.roomHeight, { present: true, value: 3, provenance: "machine_derived_world_extent" });
});

test("a coherent 90-degree yawed room remains a complete candidate in canonical coordinates", () => {
  const result = reconcileRoomEnvelope(input({
    supports: rotatedRoomSupports(90),
    included: { ...ALL_INCLUDED, ceiling: true },
    foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 },
  }));
  assert.equal(result.status, "candidate");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.dimensions.width, { present: true, value: 4, provenance: "machine_derived_world_extent" });
  assert.ok(result.residuals.maxStructuralBoundaryDistance < 1e-9);
  assert.ok(result.residuals.maxFinitePatchBoundaryOverrun < 1e-9);
  assert.ok(result.residuals.maxAbsSupportPlaneOffset < 1e-9);
  assert.equal(result.isCompleteCappedEnvelope, true);
  assert.deepEqual(result.faces.front, {
    present: true,
    source: "operator_assumption",
    assumptionKind: "foreground_depth_from_back",
    offset: 4,
  });
});

test("a genuinely reversed non-anchor role remains inconsistent after a 90-degree yaw", () => {
  const supports = rotatedRoomSupports(90);
  supports.wall_left = {
    ...supports.wall_left!,
    plane: {
      ...supports.wall_left!.plane,
      normal: rotateYaw({ x: -1, y: 0, z: 0 }, 90),
    },
  };
  const result = reconcileRoomEnvelope(input({ supports }));
  assert.equal(result.status, "inconsistent");
  assert.deepEqual(result.blockers, ["support_role_inconsistent"]);
});

test("floor-ceiling plane disagreement is a positive orientation blocker, separate from coverage", () => {
  const geometry = input({
    included: { ...ALL_INCLUDED, wall_back: false, wall_left: false, wall_right: false, ceiling: true },
  });
  geometry.supports.ceiling = {
    ...geometry.supports.ceiling!,
    plane: plane({ x: 0, y: 3, z: 0 }, { x: 0.1, y: -1, z: 0 }),
  };
  const result = reconcileRoomEnvelope(geometry);
  assert.equal(result.status, "inconsistent");
  assert.deepEqual(result.blockers, ["floor_ceiling_nonparallel"]);
  assert.ok(result.residuals.floorCeilingParallelism.degrees > 2);
});

test("the inclusive 0.05 minimum dimension policy rejects only smaller widths", () => {
  const below = reconcileRoomEnvelope(input({ supports: roomSupportsWithWidth(0.049) }));
  assert.equal(below.status, "inconsistent");
  assert.deepEqual(below.blockers, ["dimension_out_of_bounds"]);
  const exact = reconcileRoomEnvelope(input({ supports: roomSupportsWithWidth(0.05) }));
  assert.equal(exact.status, "candidate");
  assert.deepEqual(exact.blockers, []);
  assert.deepEqual(exact.dimensions.width, { present: true, value: 0.05, provenance: "machine_derived_world_extent" });
  const above = reconcileRoomEnvelope(input({ supports: roomSupportsWithWidth(0.051) }));
  assert.equal(above.status, "candidate");
  assert.deepEqual(above.blockers, []);
});

test("foreground cap is an explicit operator assumption and completes only a capped ceiling room", () => {
  const result = reconcileRoomEnvelope(input({
    included: { ...ALL_INCLUDED, ceiling: true },
    foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 },
  }));
  assert.equal(result.status, "candidate");
  assert.deepEqual(result.faces.front, {
    present: true, source: "operator_assumption", assumptionKind: "foreground_depth_from_back", offset: 4,
  });
  assert.equal(result.faces.front.present && result.faces.front.source, "operator_assumption");
  assert.deepEqual(result.dimensions.assumedCappedDepth, { present: true, value: 4, provenance: "operator_assumption" });
  assert.equal(result.isCompleteCappedEnvelope, true);
  for (const cap of [Number.NaN, 0, -1, 0.01, 51]) {
    const invalid = reconcileRoomEnvelope(input({ foregroundCap: { mode: "room_depth_from_back", depthWorld: cap } }));
    assert.equal(invalid.status, "inconsistent");
    assert.ok(invalid.blockers.includes("foreground_cap_invalid"));
  }
  const noBack = reconcileRoomEnvelope(input({ included: { ...ALL_INCLUDED, wall_back: false }, foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 } }));
  assert.ok(noBack.blockers.includes("foreground_cap_requires_back"));
});

test("angular, seam, plane, closure, role, order, and boundary disagreement block deterministically", () => {
  const nonParallel = input();
  nonParallel.supports.wall_right = { ...nonParallel.supports.wall_right!, plane: plane({ x: 2, y: 0, z: 0 }, { x: -0.9, y: 0, z: 0.435 }) };
  assert.ok(reconcileRoomEnvelope(nonParallel).blockers.includes("left_right_nonparallel"));
  const backLeft = input();
  backLeft.supports.wall_left = { ...backLeft.supports.wall_left!, plane: plane({ x: -2, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0.435 }) };
  assert.ok(reconcileRoomEnvelope(backLeft).blockers.includes("back_left_nonorthogonal"));
  const backRight = input();
  backRight.supports.wall_right = { ...backRight.supports.wall_right!, plane: plane({ x: 2, y: 0, z: 0 }, { x: -0.9, y: 0, z: 0.435 }) };
  assert.ok(reconcileRoomEnvelope(backRight).blockers.includes("back_right_nonorthogonal"));
  const seamY = input();
  seamY.supports.wall_left = { ...seamY.supports.wall_left!, seamWorld: [{ x: -2, y: 0.1, z: 0 }, { x: -2, y: 0.1, z: 4 }] };
  assert.ok(reconcileRoomEnvelope(seamY).blockers.includes("wall_floor_seam_error"));
  const planeOffset = input();
  planeOffset.supports.wall_left = { ...planeOffset.supports.wall_left!, plane: plane({ x: -1.8, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) };
  assert.ok(reconcileRoomEnvelope(planeOffset).blockers.includes("support_plane_offset"));
  const closure = input();
  closure.supports.wall_left = {
    ...closure.supports.wall_left!,
    seamWorld: [{ x: -2, y: 0, z: 0 }, { x: -1.8, y: 0, z: 4 }],
  };
  assert.ok(reconcileRoomEnvelope(closure).blockers.includes("corner_closure_error"));
  const ordered = input();
  ordered.supports.wall_left = { ...ordered.supports.wall_left!, seamWorld: [{ x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }] };
  ordered.supports.wall_right = { ...ordered.supports.wall_right!, seamWorld: [{ x: 2, y: 0, z: 4 }, { x: 2, y: 0, z: 0 }] };
  assert.ok(reconcileRoomEnvelope(ordered).blockers.includes("left_right_order_invalid"));
  const wrongRole = input();
  wrongRole.supports.wall_right = { ...wrongRole.supports.wall_right!, plane: plane({ x: 2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) };
  assert.ok(reconcileRoomEnvelope(wrongRole).blockers.includes("support_role_inconsistent"));
});

test("ceiling finite patch coverage is visible but does not block coherent planes", () => {
  const below = input({ included: { ...ALL_INCLUDED, ceiling: true } });
  below.supports.wall_left = {
    ...below.supports.wall_left!,
    boundaryWorld: [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 4 }, { x: -2, y: 2, z: 4 }, { x: -2, y: 2, z: 0 }],
  };
  const lower = reconcileRoomEnvelope(below);
  assert.equal(lower.status, "candidate", JSON.stringify(lower.blockers));
  assert.ok(lower.residuals.wallCeilingCoverage.find((item) => item.wallKind === "wall_left")!.upperCornerGaps.every((gap) => gap > 0));
  const above = clone(below);
  above.supports.wall_left!.boundaryWorld = [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 4 }, { x: -2, y: 3.1, z: 4 }, { x: -2, y: 3.1, z: 0 }];
  const higher = reconcileRoomEnvelope(above);
  assert.equal(higher.status, "candidate");
  assert.ok(higher.residuals.wallCeilingCoverage.find((item) => item.wallKind === "wall_left")!.upperCornerGaps.some((gap) => gap < 0));
  const croppedCeiling = clone(below);
  croppedCeiling.supports.ceiling!.boundaryWorld = [{ x: -1, y: 3, z: 1 }, { x: 1, y: 3, z: 1 }, { x: 1, y: 3, z: 2 }, { x: -1, y: 3, z: 2 }];
  assert.equal(reconcileRoomEnvelope(croppedCeiling).status, "candidate");
});

test("excluded supports remain diagnostic-only and cannot alter candidate faces", () => {
  const geometry = input({ included: { ...ALL_INCLUDED, ceiling: true } });
  geometry.supports.ceiling = {
    ...geometry.supports.ceiling!,
    plane: plane({ x: 0, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }),
  };
  assert.equal(reconcileRoomEnvelope(geometry).status, "inconsistent");
  const excluded = reconcileRoomEnvelope({ ...geometry, included: { ...geometry.included, ceiling: false } });
  assert.equal(excluded.status, "candidate");
  assert.equal(excluded.faces.ceiling.present, false);
  assert.equal(excluded.residuals.excludedSupportResiduals[0]?.supportKind, "ceiling");
  assert.equal(excluded.blockers.includes("wall_ceiling_plane_inconsistent"), false);
});

test("conditioning and invalid input fail closed with finite inspectable diagnostics", () => {
  const zeroSeam = input();
  zeroSeam.supports.wall_left = { ...zeroSeam.supports.wall_left!, seamWorld: [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }] };
  const zero = reconcileRoomEnvelope(zeroSeam);
  assert.ok(zero.blockers.includes("degenerate_wall_seam"));
  const degenerateNormal = input();
  degenerateNormal.supports.wall_left = { ...degenerateNormal.supports.wall_left!, plane: plane({ x: -2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }) };
  assert.ok(reconcileRoomEnvelope(degenerateNormal).blockers.includes("degenerate_normal"));
  const parallelLines = input();
  parallelLines.supports.wall_left = {
    ...parallelLines.supports.wall_left!,
    seamWorld: [{ x: -2, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }],
  };
  assert.ok(reconcileRoomEnvelope(parallelLines).blockers.includes("corner_ill_conditioned"));
  const nan = input();
  nan.supports.ceiling = { ...nan.supports.ceiling!, roomHeight: Number.NaN };
  const invalid = reconcileRoomEnvelope({ ...nan, included: { ...nan.included, ceiling: true } });
  assert.ok(invalid.blockers.includes("non_finite_input"));
  assert.ok(hasFiniteNumbers(invalid));
  const nonFiniteCases: [string, (value: RoomEnvelopeGeometryInput) => void][] = [
    ["wall seam coordinate", (value) => {
      value.supports.wall_left = {
        ...value.supports.wall_left!,
        seamWorld: [{ x: Number.NaN, y: 0, z: 0 }, value.supports.wall_left!.seamWorld[1]],
      };
    }],
    ["wall plane normal", (value) => {
      value.supports.wall_left = {
        ...value.supports.wall_left!,
        plane: plane({ x: -2, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: 0 }),
      };
    }],
    ["wall finite boundary point", (value) => {
      value.supports.wall_left = {
        ...value.supports.wall_left!,
        boundaryWorld: [{ x: Number.NaN, y: 0, z: 0 }, ...value.supports.wall_left!.boundaryWorld.slice(1)],
      };
    }],
    ["floor finite boundary point", (value) => {
      value.supports.floor = {
        ...value.supports.floor!,
        boundaryWorld: [{ x: Number.NaN, y: 0, z: 0 }, ...value.supports.floor!.boundaryWorld.slice(1)],
      };
    }],
  ];
  for (const [label, mutate] of nonFiniteCases) {
    const malformed = input();
    mutate(malformed);
    const result = reconcileRoomEnvelope(malformed);
    assert.equal(result.status, "inconsistent", label);
    assert.equal(result.blockers[0], "non_finite_input", label);
    assert.equal(result.blockers.filter((blocker) => blocker === "non_finite_input").length, 1, label);
    assert.ok(hasFiniteNumbers(result), label);
  }
  const wide = input();
  wide.supports.wall_right = { ...wide.supports.wall_right!, seamWorld: [{ x: 51, y: 0, z: 4 }, { x: 51, y: 0, z: 0 }] };
  assert.ok(reconcileRoomEnvelope(wide).blockers.includes("dimension_out_of_bounds"));
});

test("reconciliation is immutable, deterministic, and returns fixed deduplicated blocker order", () => {
  const original = input();
  const frozen = deepFreeze(clone(original));
  const a = reconcileRoomEnvelope(frozen);
  const b = reconcileRoomEnvelope(frozen);
  assert.deepEqual(a, b);
  assert.deepEqual(frozen, original);
  const reordered = input();
  reordered.supports = {
    ceiling: reordered.supports.ceiling,
    wall_right: reordered.supports.wall_right,
    wall_left: reordered.supports.wall_left,
    wall_back: reordered.supports.wall_back,
    floor: reordered.supports.floor,
  };
  assert.deepEqual(reconcileRoomEnvelope(reordered), a);
  const bad = input();
  bad.supports.wall_left = { ...bad.supports.wall_left!, seamWorld: [{ x: -2, y: 0.2, z: 0 }, { x: -2, y: 0.2, z: 0 }] };
  const blockers = reconcileRoomEnvelope(bad).blockers;
  assert.deepEqual(blockers, [...new Set(blockers)]);
  assert.deepEqual(blockers, ROOM_ENVELOPE_BLOCKER_ORDER.filter((blocker) => blockers.includes(blocker)));
});

test("A3 truthful Left upper Back seam overrun is finite-patch coverage, not structural containment", () => {
  const result = reconcileRoomEnvelope(input({
    supports: a3PartialSupports(),
    included: { ...ALL_INCLUDED, wall_right: false, ceiling: false },
  }));

  assert.equal(result.status, "partial");
  assert.deepEqual(result.blockers, []);
  assert.ok(result.residuals.maxStructuralBoundaryDistance <= 0.05);
  assert.ok(Math.abs(result.residuals.maxFinitePatchBoundaryOverrun - 0.12) < 1e-12);
  assert.deepEqual(boundaryObservation(result, {
    supportKind: "wall_left",
    pointRole: "wall_upper_start",
    candidateFaceId: "back",
  }), {
    supportKind: "wall_left",
    pointRole: "wall_upper_start",
    pointIndex: 3,
    candidateFaceId: "back",
    classification: "finite_patch_coverage",
    blocking: false,
    pointWorld: { x: -2, y: 3, z: -0.12 },
    outsideDistanceWorld: 0.12,
  });
});

test("Right and Back upper corners beyond adjacent faces remain finite-patch coverage", () => {
  const rightSupports = roomSupports();
  rightSupports.wall_left = null;
  rightSupports.wall_right = {
    ...rightSupports.wall_right!,
    boundaryWorld: [
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 4 },
      { x: 2, y: 3, z: 4 },
      { x: 2, y: 3, z: -0.12 },
    ],
  };
  const right = reconcileRoomEnvelope(input({
    supports: rightSupports,
    included: { ...ALL_INCLUDED, wall_left: false, ceiling: false },
  }));
  assert.equal(right.status, "partial");
  assert.deepEqual(right.blockers, []);
  assert.deepEqual(boundaryObservation(right, {
    supportKind: "wall_right",
    pointRole: "wall_upper_start",
    candidateFaceId: "back",
  }), {
    supportKind: "wall_right",
    pointRole: "wall_upper_start",
    pointIndex: 3,
    candidateFaceId: "back",
    classification: "finite_patch_coverage",
    blocking: false,
    pointWorld: { x: 2, y: 3, z: -0.12 },
    outsideDistanceWorld: 0.12,
  });

  const backSupports = a3PartialSupports();
  backSupports.wall_back = {
    ...backSupports.wall_back!,
    boundaryWorld: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: -2.12, y: 3, z: 0 },
    ],
  };
  const back = reconcileRoomEnvelope(input({
    supports: backSupports,
    included: { ...ALL_INCLUDED, wall_right: false, ceiling: false },
  }));
  assert.equal(back.status, "partial");
  assert.deepEqual(back.blockers, []);
  assert.deepEqual(boundaryObservation(back, {
    supportKind: "wall_back",
    pointRole: "wall_upper_start",
    candidateFaceId: "left",
  }), {
    supportKind: "wall_back",
    pointRole: "wall_upper_start",
    pointIndex: 3,
    candidateFaceId: "left",
    classification: "finite_patch_coverage",
    blocking: false,
    pointWorld: { x: -2.12, y: 3, z: 0 },
    outsideDistanceWorld: 0.1200000000000001,
  });
});

test("Ceiling boundary overrun is finite-patch coverage while Floor boundary overrun remains structural", () => {
  const ceilingSupports = roomSupports();
  ceilingSupports.ceiling = {
    ...ceilingSupports.ceiling!,
    boundaryWorld: [
      { x: -2, y: 3, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 2.084, y: 3, z: 4 },
      { x: -2, y: 3, z: 4 },
    ],
  };
  const ceiling = reconcileRoomEnvelope(input({ supports: ceilingSupports, included: { ...ALL_INCLUDED, ceiling: true } }));
  assert.equal(ceiling.status, "candidate");
  assert.deepEqual(ceiling.blockers, []);
  assert.equal(boundaryObservation(ceiling, {
    supportKind: "ceiling",
    pointRole: "ceiling_boundary",
    pointIndex: 2,
    candidateFaceId: "right",
  }).blocking, false);
  assert.ok(Math.abs(boundaryObservation(ceiling, {
    supportKind: "ceiling",
    pointRole: "ceiling_boundary",
    pointIndex: 2,
    candidateFaceId: "right",
  }).outsideDistanceWorld - 0.084) < 1e-12);

  const floorSupports = roomSupports();
  floorSupports.wall_right = null;
  floorSupports.ceiling = null;
  floorSupports.floor = {
    ...floorSupports.floor!,
    boundaryWorld: [
      { x: -2, y: 0, z: -0.12 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 4 },
      { x: -2, y: 0, z: 4 },
    ],
  };
  const floor = reconcileRoomEnvelope(input({
    supports: floorSupports,
    included: { ...ALL_INCLUDED, wall_right: false, ceiling: false },
  }));
  assert.equal(floor.status, "inconsistent");
  assert.deepEqual(floor.blockers, ["boundary_outside_envelope"]);
  assert.deepEqual(boundaryObservation(floor, {
    supportKind: "floor",
    pointRole: "floor_boundary",
    candidateFaceId: "back",
  }), {
    supportKind: "floor",
    pointRole: "floor_boundary",
    pointIndex: 0,
    candidateFaceId: "back",
    classification: "structural",
    blocking: true,
    pointWorld: { x: -2, y: 0, z: -0.12 },
    outsideDistanceWorld: 0.12,
  });
});

test("a wall lower seam overrun blocks while adjacent upper-patch overrun remains visible", () => {
  const supports = a3PartialSupports();
  supports.wall_left = {
    ...supports.wall_left!,
    seamWorld: [{ x: -2, y: 0, z: -0.12 }, { x: -2, y: 0, z: 4 }],
  };
  const result = reconcileRoomEnvelope(input({
    supports,
    included: { ...ALL_INCLUDED, wall_right: false, ceiling: false },
  }));

  assert.equal(result.status, "inconsistent");
  assert.deepEqual(result.blockers, ["boundary_outside_envelope"]);
  assert.deepEqual(boundaryObservation(result, {
    supportKind: "wall_left",
    pointRole: "wall_lower_start",
    candidateFaceId: "back",
  }), {
    supportKind: "wall_left",
    pointRole: "wall_lower_start",
    pointIndex: 0,
    candidateFaceId: "back",
    classification: "structural",
    blocking: true,
    pointWorld: { x: -2, y: 0, z: -0.12 },
    outsideDistanceWorld: 0.12,
  });
  assert.deepEqual(boundaryObservation(result, {
    supportKind: "wall_left",
    pointRole: "wall_upper_start",
    candidateFaceId: "back",
  }), {
    supportKind: "wall_left",
    pointRole: "wall_upper_start",
    pointIndex: 3,
    candidateFaceId: "back",
    classification: "finite_patch_coverage",
    blocking: false,
    pointWorld: { x: -2, y: 3, z: -0.12 },
    outsideDistanceWorld: 0.12,
  });
});

test("structural and finite-patch aggregates remain separate and report their largest points", () => {
  const supports = a3PartialSupports();
  supports.wall_left = {
    ...supports.wall_left!,
    seamWorld: [{ x: -2, y: 0, z: -0.12 }, { x: -2, y: 0, z: 4 }],
    boundaryWorld: [
      { x: -2, y: 0, z: 0 },
      { x: -2, y: 0, z: 4 },
      { x: -2, y: 3, z: 4 },
      { x: -2, y: 3, z: -0.2 },
    ],
  };
  const result = reconcileRoomEnvelope(input({
    supports,
    included: { ...ALL_INCLUDED, wall_right: false, ceiling: false },
  }));

  assert.equal(result.status, "inconsistent");
  assert.deepEqual(result.blockers, ["boundary_outside_envelope"]);
  assert.ok(Math.abs(result.residuals.maxStructuralBoundaryDistance - 0.12) < 1e-12);
  assert.ok(Math.abs(result.residuals.maxFinitePatchBoundaryOverrun - 0.2) < 1e-12);
  assert.ok(result.residuals.rmsStructuralBoundaryDistance < result.residuals.maxStructuralBoundaryDistance);
  assert.ok(result.residuals.rmsFinitePatchBoundaryOverrun < result.residuals.maxFinitePatchBoundaryOverrun);
});

test("boundary provenance ordering is deterministic, immutable, and excluded patch coverage remains separate", () => {
  const source = input({
    supports: a3PartialSupports(),
    included: { ...ALL_INCLUDED, wall_left: false, wall_right: false, ceiling: false },
  });
  const frozen = deepFreeze(clone(source));
  const first = reconcileRoomEnvelope(frozen);
  const second = reconcileRoomEnvelope(frozen);
  assert.equal(first.status, "partial");
  assert.deepEqual(first.blockers, []);
  assert.deepEqual(first.residuals.boundaryObservations, second.residuals.boundaryObservations);
  assert.deepEqual(frozen, source);
  assert.ok(Object.isFrozen(first.residuals.boundaryObservations));
  assert.ok(first.residuals.boundaryObservations.every(Object.isFrozen));
  const fullyIncluded = reconcileRoomEnvelope(input());
  const observationKeys = fullyIncluded.residuals.boundaryObservations.map((observation) =>
    `${observation.supportKind}:${observation.pointRole}:${observation.pointIndex}:${observation.candidateFaceId}`
  );
  assert.equal(new Set(observationKeys).size, observationKeys.length);
  assert.deepEqual(
    fullyIncluded.residuals.boundaryObservations.slice(0, 6).map((observation) => [
      observation.supportKind,
      observation.pointRole,
      observation.pointIndex,
      observation.candidateFaceId,
    ]),
    [
      ["floor", "floor_boundary", 0, "left"],
      ["floor", "floor_boundary", 0, "right"],
      ["floor", "floor_boundary", 0, "back"],
      ["floor", "floor_boundary", 1, "left"],
      ["floor", "floor_boundary", 1, "right"],
      ["floor", "floor_boundary", 1, "back"],
    ]
  );
  assert.deepEqual(
    first.residuals.boundaryObservations.slice(0, 4).map((observation) => [
      observation.supportKind,
      observation.pointRole,
      observation.pointIndex,
      observation.candidateFaceId,
    ]),
    [
      ["floor", "floor_boundary", 0, "back"],
      ["floor", "floor_boundary", 1, "back"],
      ["floor", "floor_boundary", 2, "back"],
      ["floor", "floor_boundary", 3, "back"],
    ]
  );
  const excludedLeft = first.residuals.excludedSupportResiduals.find((item) => item.supportKind === "wall_left");
  assert.ok(excludedLeft);
  assert.ok(Object.isFrozen(excludedLeft.boundaryObservations));
  assert.deepEqual(excludedLeft.boundaryObservations.find((observation) =>
    observation.pointRole === "wall_upper_start" && observation.candidateFaceId === "back"
  ), {
    supportKind: "wall_left",
    pointRole: "wall_upper_start",
    pointIndex: 3,
    candidateFaceId: "back",
    classification: "finite_patch_coverage",
    blocking: false,
    pointWorld: { x: -2, y: 3, z: -0.12 },
    outsideDistanceWorld: 0.12,
  });
});
