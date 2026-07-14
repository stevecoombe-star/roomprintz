import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOM_ENVELOPE_CONTEXT_VERSION,
  ROOM_ENVELOPE_DERIVATION_VERSION,
  ROOM_ENVELOPE_NUMERIC_POLICY_VERSION,
  buildRoomEnvelopeContextKey,
  buildRoomEnvelopeDepthKey,
} from "./room-envelope-identity";
import type { RoomEnvelopeContextInput, RoomEnvelopeSupportKind } from "./room-envelope-types";

function support(identityKey: string, included = true) {
  return { present: true, included, identityKey };
}

function context(): RoomEnvelopeContextInput {
  return {
    basis: { basisId: "basis-a", basisFingerprint: "fingerprint-a" },
    camera: { appliedAtIso: "2026-07-12T12:00:00.000Z", frameWidth: 1600, frameHeight: 900 },
    supports: {
      floor: support("floor-a"),
      wall_back: support("back-a"),
      wall_left: support("left-a"),
      wall_right: support("right-a", false),
      ceiling: support("ceiling-a"),
    },
    resolvedAnchor: { kind: "wall_back", selection: "default" },
    foregroundCap: {
      mode: "room_depth_from_back",
      depthKey: buildRoomEnvelopeDepthKey(4),
      assumptionId: "depth-assumption-a",
      revision: "1",
    },
  };
}

test("identical and insertion-reordered context inputs have byte-identical keys", () => {
  const value = context();
  const reordered: RoomEnvelopeContextInput = {
    ...value,
    supports: {
      ceiling: value.supports.ceiling,
      wall_right: value.supports.wall_right,
      wall_left: value.supports.wall_left,
      wall_back: value.supports.wall_back,
      floor: value.supports.floor,
    },
  };
  assert.equal(buildRoomEnvelopeContextKey(value), buildRoomEnvelopeContextKey(value));
  assert.equal(buildRoomEnvelopeContextKey(value), buildRoomEnvelopeContextKey(reordered));
  assert.equal(buildRoomEnvelopeDepthKey(2.5), "2.500000");
  assert.equal(buildRoomEnvelopeDepthKey(Number.NaN), "invalid");
});

test("every basis, camera, support, inclusion, and anchor provenance fact is bound", () => {
  const original = context();
  const key = buildRoomEnvelopeContextKey(original);
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, basis: { ...original.basis, basisId: "basis-b" } }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, basis: { ...original.basis, basisFingerprint: "fingerprint-b" } }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, camera: { ...original.camera, appliedAtIso: "later" } }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, camera: { ...original.camera, frameWidth: 1200 } }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, camera: { ...original.camera, frameHeight: 800 } }));
  for (const kind of ["floor", "wall_back", "wall_left", "wall_right", "ceiling"] as RoomEnvelopeSupportKind[]) {
    const changed = context();
    changed.supports = { ...changed.supports, [kind]: { ...changed.supports[kind], identityKey: `${kind}-changed` } };
    assert.notEqual(key, buildRoomEnvelopeContextKey(changed), kind);
  }
  const inclusion = context();
  inclusion.supports = { ...inclusion.supports, wall_right: { ...inclusion.supports.wall_right, included: true } };
  assert.notEqual(key, buildRoomEnvelopeContextKey(inclusion));
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, resolvedAnchor: { kind: "wall_left", selection: "default" } }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...original, resolvedAnchor: { kind: "wall_back", selection: "explicit" } }));
});

test("context key binds the v2 boundary-policy derivation while preserving numeric policy v1", () => {
  const value = context();
  const key = buildRoomEnvelopeContextKey(value);
  assert.notEqual(key, buildRoomEnvelopeContextKey({ ...value, foregroundCap: null }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({
    ...value,
    foregroundCap: { ...value.foregroundCap!, depthKey: buildRoomEnvelopeDepthKey(4.1) },
  }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({
    ...value,
    foregroundCap: { ...value.foregroundCap!, assumptionId: "depth-assumption-b" },
  }));
  assert.notEqual(key, buildRoomEnvelopeContextKey({
    ...value,
    foregroundCap: { ...value.foregroundCap!, revision: "2" },
  }));
  assert.match(key, new RegExp(ROOM_ENVELOPE_CONTEXT_VERSION));
  assert.match(key, new RegExp(ROOM_ENVELOPE_DERIVATION_VERSION));
  assert.match(key, new RegExp(ROOM_ENVELOPE_NUMERIC_POLICY_VERSION));
  assert.equal(ROOM_ENVELOPE_DERIVATION_VERSION, "room-envelope-derivation/v2");
  assert.equal(ROOM_ENVELOPE_NUMERIC_POLICY_VERSION, "room-envelope-numeric/v1");
  assert.equal(key.includes("room-envelope-derivation/v1"), false);
  assert.equal(key.includes("residual"), false);
  assert.equal(key.includes("dimensions"), false);
});
