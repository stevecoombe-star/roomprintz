import assert from "node:assert/strict";
import test from "node:test";
import { reconcileRoomEnvelope } from "./room-envelope-reconciliation";
import { deriveRoomEnvelopeWireframe } from "./room-envelope-wireframe";
import type { RoomEnvelopeGeometryInput, RoomEnvelopeInclusionState, RoomEnvelopeSupportGeometries } from "./room-envelope-types";

const ALL_INCLUDED: RoomEnvelopeInclusionState = {
  floor: true,
  wall_back: true,
  wall_left: true,
  wall_right: true,
  ceiling: true,
};

function plane(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) {
  return { point, normal, basisU: { x: 1, y: 0, z: 0 }, basisV: { x: 0, y: 1, z: 0 } };
}

function supports(): RoomEnvelopeSupportGeometries {
  return {
    floor: {
      kind: "floor",
      boundaryWorld: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }, { x: -2, y: 0, z: 4 }],
      plane: plane({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
      xAxisWorld: { x: 1, y: 0, z: 0 },
      zAxisWorld: { x: 0, y: 0, z: 1 },
    },
    wall_back: {
      kind: "wall_back",
      seamWorld: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      boundaryWorld: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: -2, y: 3, z: 0 }],
      plane: plane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    },
    wall_left: {
      kind: "wall_left",
      seamWorld: [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 4 }],
      boundaryWorld: [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 4 }, { x: -2, y: 3, z: 4 }, { x: -2, y: 3, z: 0 }],
      plane: plane({ x: -2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    },
    wall_right: {
      kind: "wall_right",
      seamWorld: [{ x: 2, y: 0, z: 4 }, { x: 2, y: 0, z: 0 }],
      boundaryWorld: [{ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }, { x: 2, y: 3, z: 4 }, { x: 2, y: 3, z: 0 }],
      plane: plane({ x: 2, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
    },
    ceiling: {
      kind: "ceiling",
      boundaryWorld: [{ x: -2, y: 3, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 2, y: 3, z: 4 }, { x: -2, y: 3, z: 4 }],
      plane: plane({ x: 0, y: 3, z: 0 }, { x: 0, y: -1, z: 0 }),
      roomHeight: 3,
    },
  };
}

function input(overrides: Partial<RoomEnvelopeGeometryInput> = {}): RoomEnvelopeGeometryInput {
  return {
    supports: supports(),
    included: { ...ALL_INCLUDED },
    anchorChoice: { mode: "default" },
    foregroundCap: null,
    ...overrides,
  };
}

function wireframe(value: RoomEnvelopeGeometryInput) {
  return deriveRoomEnvelopeWireframe({ reconciliation: reconcileRoomEnvelope(value), geometry: value });
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

function key(segment: ReturnType<typeof wireframe>["segments"][number]): string {
  const point = (value: { x: number; y: number; z: number }) => [value.x, value.y, value.z].map((number) => number.toFixed(9)).join(",");
  return [point(segment.startWorld), point(segment.endWorld)].sort().join("|");
}

test("exact complete capped envelope returns deterministic frame segments", () => {
  const value = input({ foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 } });
  const result = wireframe(value);
  assert.equal(result.status, "candidate");
  assert.ok(result.segments.some((segment) => segment.kind === "room_frame"));
  assert.ok(result.segments.some((segment) => segment.kind === "assumed_foreground_cap"));
});

test("exact capped geometry retains frame and assumed-cap provenance", () => {
  const result = wireframe(input({ foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 } }));
  assert.deepEqual(result.segments.find((segment) => segment.id === "frame:back:floor"), {
    id: "frame:back:floor",
    startWorld: { x: -2, y: 0, z: 0 },
    endWorld: { x: 2, y: 0, z: 0 },
    kind: "room_frame",
    faceId: "back",
  });
  assert.deepEqual(result.segments.find((segment) => segment.id === "frame:back:left-vertical"), {
    id: "frame:back:left-vertical",
    startWorld: { x: -2, y: 0, z: 0 },
    endWorld: { x: -2, y: 3, z: 0 },
    kind: "room_frame",
    faceId: "back",
  });
  assert.deepEqual(result.segments.find((segment) => segment.id === "cap:front:floor"), {
    id: "cap:front:floor",
    startWorld: { x: -2, y: 0, z: 4 },
    endWorld: { x: 2, y: 0, z: 4 },
    kind: "assumed_foreground_cap",
    faceId: "front",
  });
});

test("segment IDs are stable across repeated calls", () => {
  const value = input();
  assert.deepEqual(wireframe(value).segments.map((segment) => segment.id), wireframe(value).segments.map((segment) => segment.id));
});

test("segment ordering is deterministic", () => {
  const ids = wireframe(input()).segments.map((segment) => segment.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("deep-frozen inputs are not mutated", () => {
  const original = input();
  const frozen = deepFreeze(clone(original));
  wireframe(frozen);
  assert.deepEqual(frozen, original);
});

test("reordered support inputs do not change output", () => {
  const value = input();
  const reordered: RoomEnvelopeGeometryInput = {
    ...value,
    supports: {
      ceiling: value.supports.ceiling,
      wall_right: value.supports.wall_right,
      wall_left: value.supports.wall_left,
      wall_back: value.supports.wall_back,
      floor: value.supports.floor,
    },
  };
  assert.deepEqual(wireframe(reordered), wireframe(value));
});

test("open-front candidate does not return assumed front-face geometry", () => {
  const result = wireframe(input());
  assert.equal(result.segments.some((segment) => segment.kind === "assumed_foreground_cap"), false);
  assert.equal(result.segments.some((segment) => segment.faceId === "front"), false);
});

test("open-front output has no closing front room-frame rectangle", () => {
  const result = wireframe(input());
  assert.equal(result.segments.some((segment) => segment.kind === "room_frame" && segment.faceId === "front"), false);
});

test("visible reviewed depth is classified as visible extent", () => {
  const result = wireframe(input());
  assert.ok(result.segments.some((segment) => segment.kind === "visible_extent"));
});

test("visible extent is not classified as support geometry", () => {
  const result = wireframe(input());
  assert.ok(result.segments.filter((segment) => segment.kind === "visible_extent").every((segment) => !segment.supportKind));
});

test("a capped fixture emits cap segments only as assumed foreground cap", () => {
  const result = wireframe(input({ foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 } }));
  assert.ok(result.segments.some((segment) => segment.kind === "assumed_foreground_cap"));
  assert.ok(result.segments.filter((segment) => segment.faceId === "front").every((segment) => segment.kind === "assumed_foreground_cap"));
});

test("no cap segment reports support provenance", () => {
  const result = wireframe(input({ foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 } }));
  assert.ok(result.segments.filter((segment) => segment.kind === "assumed_foreground_cap").every((segment) => !segment.supportKind));
});

test("floor-only returns only Floor-derived patch geometry", () => {
  const result = wireframe(input({ included: { ...ALL_INCLUDED, wall_back: false, wall_left: false, wall_right: false, ceiling: false } }));
  assert.equal(result.status, "partial");
  assert.ok(result.segments.length > 0);
  assert.ok(result.segments.every((segment) => segment.kind === "reconciled_support_patch" && segment.supportKind === "floor"));
});

test("Floor plus Back returns no invented side or foreground faces", () => {
  const result = wireframe(input({ included: { ...ALL_INCLUDED, wall_left: false, wall_right: false, ceiling: false } }));
  assert.ok(result.segments.every((segment) => !["left", "right", "front"].includes(segment.faceId ?? "")));
});

test("Floor plus one side returns no invented Back or opposite wall", () => {
  const result = wireframe(input({ included: { ...ALL_INCLUDED, wall_back: false, wall_right: false, ceiling: false } }));
  assert.ok(result.segments.every((segment) => !["back", "right", "front"].includes(segment.faceId ?? "")));
});

test("Floor plus Left and Right without Back remains partial and does not invent Back", () => {
  const result = wireframe(input({ included: { ...ALL_INCLUDED, wall_back: false, ceiling: false } }));
  assert.equal(result.status, "partial");
  assert.equal(result.segments.some((segment) => segment.faceId === "back"), false);
});

test("missing Ceiling emits no top envelope plane", () => {
  const result = wireframe(input({ included: { ...ALL_INCLUDED, ceiling: false } }));
  assert.equal(result.segments.some((segment) => segment.faceId === "ceiling"), false);
  assert.equal(result.segments.some((segment) => segment.id.includes(":top")), false);
});

test("Ceiling present enables safely defined top geometry", () => {
  const result = wireframe(input());
  assert.ok(result.segments.some((segment) => segment.faceId === "ceiling"));
  assert.ok(result.segments.some((segment) => segment.id.includes(":top")));
});

test("an inconsistent result with safe candidate geometry still returns segments", () => {
  const value = input();
  value.supports.wall_right = {
    ...value.supports.wall_right!,
    plane: plane({ x: 2, y: 0, z: 0 }, { x: -0.9, y: 0, z: 0.435 }),
  };
  const result = wireframe(value);
  assert.equal(result.status, "inconsistent");
  assert.ok(result.segments.length > 0);
});

test("wireframe retains the inconsistent presentation classification", () => {
  const value = input();
  value.supports.wall_left = {
    ...value.supports.wall_left!,
    plane: plane({ x: -2, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0.435 }),
  };
  assert.equal(wireframe(value).status, "inconsistent");
});

test("unavailable results return no segments", () => {
  const result = wireframe(input({ included: { ...ALL_INCLUDED, floor: false } }));
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.segments, []);
});

test("non-finite candidate data produces no non-finite segment endpoints", () => {
  const value = input();
  value.supports.ceiling = { ...value.supports.ceiling!, boundaryWorld: [{ x: Number.NaN, y: 3, z: 0 }], roomHeight: Number.NaN };
  const result = wireframe(value);
  assert.ok(result.segments.every((segment) => [segment.startWorld, segment.endWorld].every((point) => Object.values(point).every(Number.isFinite))));
});

test("zero-length duplicate segments are removed", () => {
  const value = input({ included: { ...ALL_INCLUDED, wall_back: false, wall_left: false, wall_right: false, ceiling: false } });
  value.supports.floor = {
    ...value.supports.floor!,
    boundaryWorld: [{ x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }, { x: -2, y: 0, z: 4 }],
  };
  assert.ok(wireframe(value).segments.every((segment) => key(segment).split("|")[0] !== key(segment).split("|")[1]));
});

test("shared edges are deterministically deduplicated", () => {
  const result = wireframe(input());
  const keys = result.segments.map(key);
  assert.equal(new Set(keys).size, keys.length);
});

test("a reversed reviewed Floor boundary still emits one shared back edge", () => {
  const value = input();
  value.supports.floor = {
    ...value.supports.floor!,
    boundaryWorld: [
      { x: -2, y: 0, z: 0 },
      { x: -2, y: 0, z: 4 },
      { x: 2, y: 0, z: 4 },
      { x: 2, y: 0, z: 0 },
    ],
  };
  const result = wireframe(value);
  const backEdgeKey = "-2.000000000,0.000000000,0.000000000|2.000000000,0.000000000,0.000000000";
  assert.equal(result.segments.filter((segment) => key(segment) === backEdgeKey).length, 1);
});

test("all output coordinates remain finite", () => {
  const result = wireframe(input({ foregroundCap: { mode: "room_depth_from_back", depthWorld: 4 } }));
  assert.ok(result.segments.every((segment) => [segment.startWorld, segment.endWorld].every((point) => Object.values(point).every(Number.isFinite))));
});
