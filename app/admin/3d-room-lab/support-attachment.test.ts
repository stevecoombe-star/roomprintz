import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAttachmentBindingKey,
  canMutateModelWhileAttached,
  computeSupportAttachmentTransform,
  deriveAttachmentDragCandidate,
  isAttachedObjectModelLocked,
  isAttachmentBindingCurrent,
  selectPlacementTransformAuthority,
  selectObjectTransformMode,
  type AttachmentBindingContext,
  type AttachmentSupportFrame,
  type ModelLocalBounds,
  type ObjectSupportAttachment,
} from "./support-attachment";

const BOUNDS: ModelLocalBounds = {
  min: { x: -0.5, y: -1, z: -0.25 },
  max: { x: 0.5, y: 1, z: 0.75 },
};
const FLOOR: AttachmentSupportFrame = {
  kind: "floor",
  point: { x: 0, y: 0, z: 0 },
  boundaryUV: [
    { u: -2, v: -2 },
    { u: 2, v: -2 },
    { u: 2, v: 2 },
    { u: -2, v: 2 },
  ],
};

function attachment(overrides: Partial<ObjectSupportAttachment> = {}): ObjectSupportAttachment {
  return {
    supportKind: "floor",
    supportBindingKey: "binding",
    localPosition: { u: 0.5, v: -0.5 },
    rotationAboutNormalDeg: 0,
    uniformScale: 1,
    contactProfile: { kind: "floor", contactAxis: "local_y", contactSide: "min" },
    attachedAtIso: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function wallFrame(normalZ = 1): AttachmentSupportFrame {
  return {
    kind: "wall_back",
    plane: {
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: normalZ },
      basisU: { x: 1, y: 0, z: 0 },
      basisV: { x: 0, y: 1, z: 0 },
    },
    seamNormal: { x: 0, y: 0, z: 1 },
    boundaryUV: [
      { u: -2, v: 0 },
      { u: 2, v: 0 },
      { u: 2, v: 3 },
      { u: -2, v: 3 },
    ],
  };
}

function backWallPlane() {
  const frame = wallFrame();
  if (frame.kind === "floor") throw new Error("expected wall frame");
  return frame.plane;
}

function transform(value: ObjectSupportAttachment, frame: AttachmentSupportFrame) {
  return computeSupportAttachmentTransform({
    attachment: value,
    frame,
    modelBounds: BOUNDS,
    scaleRange: { min: 0.1, max: 4 },
  });
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

test("floor transform is right handed and keeps its bottom face on Y=0", () => {
  const result = transform(attachment(), FLOOR);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.worldPosition.y, 1);
  assert.equal(result.contactPointWorld.y, 0);
  assert.ok(Math.abs(result.diagnostics.contactDistanceToPlane) < 1e-8);
  assert.ok(result.diagnostics.orientationDeterminant > 0.999);
  assert.deepEqual(cross(result.orientationBasis.x, result.orientationBasis.y), result.orientationBasis.z);
});

test("floor scale and rotation preserve support contact", () => {
  const scaled = transform(attachment({ uniformScale: 2 }), FLOOR);
  const rotated = transform(attachment({ rotationAboutNormalDeg: 90 }), FLOOR);
  assert.equal(scaled.ok, true);
  assert.equal(rotated.ok, true);
  if (!scaled.ok || !rotated.ok) return;
  assert.equal(scaled.worldPosition.y, 2);
  assert.ok(Math.abs(scaled.contactPointWorld.y) < 1e-8);
  assert.ok(Math.abs(rotated.contactPointWorld.y) < 1e-8);
  assert.deepEqual(rotated.boundaryLocalPoint, { u: 0.5, v: -0.5 });
});

test("outside floor anchor fails closed", () => {
  const result = transform(attachment({ localPosition: { u: 3, v: 0 } }), FLOOR);
  assert.deepEqual(result, { ok: false, reasons: ["attachment_anchor_outside_support"] });
});

test("wall min-Z contact extends to the camera-facing side", () => {
  const result = transform(
    attachment({
      supportKind: "wall_back",
      localPosition: { u: 0, v: 1 },
      contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "min" },
    }),
    wallFrame()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.worldPosition.z, 0.25);
  assert.equal(result.contactPointWorld.z, 0);
  assert.ok(result.worldPosition.z > 0);
  assert.ok(Math.abs(result.diagnostics.contactDistanceToPlane) < 1e-8);
});

test("wall max-Z contact changes only the selected contact face", () => {
  const result = transform(
    attachment({
      supportKind: "wall_back",
      localPosition: { u: 0, v: 1 },
      uniformScale: 2,
      contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "max" },
    }),
    wallFrame()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.worldPosition.z, -1.5);
  assert.equal(result.contactPointWorld.z, 0);
});

test("wall frame flips horizontal tangent and normal together", () => {
  const forward = transform(
    attachment({
      supportKind: "wall_back",
      localPosition: { u: 0, v: 1 },
      contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "min" },
    }),
    wallFrame(1)
  );
  const flipped = transform(
    attachment({
      supportKind: "wall_back",
      localPosition: { u: 0, v: 1 },
      contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "min" },
    }),
    wallFrame(-1)
  );
  assert.equal(forward.ok, true);
  assert.equal(flipped.ok, true);
  if (!forward.ok || !flipped.ok) return;
  assert.equal(forward.orientationBasis.x.x, 1);
  assert.equal(forward.orientationBasis.z.z, 1);
  assert.equal(flipped.orientationBasis.x.x, -1);
  assert.equal(flipped.orientationBasis.z.z, -1);
  assert.ok(flipped.diagnostics.orientationDeterminant > 0.999);
  assert.deepEqual(cross(flipped.orientationBasis.x, flipped.orientationBasis.y), flipped.orientationBasis.z);
});

test("wall anchor remains in the documented reviewed-seam UV frame after a facing flip", () => {
  const result = transform(
    attachment({
      supportKind: "wall_back",
      localPosition: { u: 1.25, v: 1 },
      contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "min" },
    }),
    wallFrame(-1)
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.contactPointWorld.x, 1.25);
});

test("wall rotation retains contact and right-handed orientation", () => {
  const result = transform(
    attachment({
      supportKind: "wall_back",
      localPosition: { u: 0, v: 1 },
      rotationAboutNormalDeg: 45,
      contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "min" },
    }),
    wallFrame()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(Math.abs(result.contactPointWorld.z) < 1e-8);
  assert.ok(result.diagnostics.orientationDeterminant > 0.999);
});

test("wall seam orientation stays right handed for back, left, and right kinds", () => {
  for (const kind of ["wall_back", "wall_left", "wall_right"] as const) {
    const frame: AttachmentSupportFrame = {
      ...wallFrame(),
      kind,
      plane:
        kind === "wall_back"
          ? backWallPlane()
          : kind === "wall_left"
            ? {
                point: { x: 0, y: 0, z: 0 },
                normal: { x: 1, y: 0, z: 0 },
                basisU: { x: 0, y: 0, z: -1 },
                basisV: { x: 0, y: 1, z: 0 },
              }
            : {
                point: { x: 0, y: 0, z: 0 },
                normal: { x: -1, y: 0, z: 0 },
                basisU: { x: 0, y: 0, z: 1 },
                basisV: { x: 0, y: 1, z: 0 },
              },
      seamNormal: kind === "wall_back" ? { x: 0, y: 0, z: 1 } : kind === "wall_left" ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 },
    };
    const result = transform(
      attachment({
        supportKind: kind,
        localPosition: { u: 0, v: 1 },
        contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "min" },
      }),
      frame
    );
    assert.equal(result.ok, true, kind);
    if (result.ok) assert.ok(result.diagnostics.orientationDeterminant > 0.999, kind);
  }
});

const binding: AttachmentBindingContext = {
  supportKind: "floor",
  sourcePolygonKey: "floor-poly",
  confirmationStampKey: "floor:manually_confirmed",
  imageBasisId: "basis-id",
  imageBasisFingerprint: "basis-fingerprint",
  cameraAppliedAtIso: "2026-07-10T00:00:00.000Z",
  frameWidth: 1000,
  frameHeight: 800,
};

test("binding requires exact geometry, basis, camera, frame, and wall kind", () => {
  const bound = attachment({ supportBindingKey: buildAttachmentBindingKey(binding) });
  assert.equal(isAttachmentBindingCurrent(bound, binding), true);
  assert.equal(isAttachmentBindingCurrent(bound, { ...binding, sourcePolygonKey: "changed" }), false);
  assert.equal(isAttachmentBindingCurrent(bound, { ...binding, cameraAppliedAtIso: "later" }), false);
  assert.equal(isAttachmentBindingCurrent(bound, { ...binding, imageBasisFingerprint: "changed" }), false);
  assert.equal(isAttachmentBindingCurrent(bound, { ...binding, frameWidth: 999 }), false);
  assert.equal(isAttachmentBindingCurrent(bound, { ...binding, confirmationStampKey: "changed-stamp" }), false);
  assert.equal(isAttachmentBindingCurrent(bound, { ...binding, supportKind: "wall_back" }), false);
});

test("invalid bounds, contact profiles, and scale fail with named reasons", () => {
  const invalidBounds = computeSupportAttachmentTransform({
    attachment: attachment(),
    frame: FLOOR,
    modelBounds: null,
    scaleRange: { min: 0.1, max: 4 },
  });
  assert.deepEqual(invalidBounds, { ok: false, reasons: ["attachment_model_bounds_unavailable"] });
  const invalidScale = transform(attachment({ uniformScale: 5 }), FLOOR);
  assert.deepEqual(invalidScale, { ok: false, reasons: ["attachment_scale_invalid"] });
  const wrongProfile = transform(
    attachment({ supportKind: "wall_back", contactProfile: { kind: "floor", contactAxis: "local_y", contactSide: "min" } }),
    wallFrame()
  );
  assert.deepEqual(wrongProfile, { ok: false, reasons: ["attachment_contact_profile_invalid"] });
});

test("drag ray maps floor and wall coordinates, preserves grab offsets, and rejects outside", () => {
  const floor = deriveAttachmentDragCandidate({
    frame: FLOOR,
    ray: { origin: { x: 0, y: 2, z: 0 }, direction: { x: 0.5, y: -2, z: 0.5 } },
    grabOffset: { u: 0.25, v: -0.25 },
  });
  assert.equal(floor.ok, true);
  if (floor.ok) assert.deepEqual(floor.localPosition, { u: 0.75, v: 0.25 });
  const wall = deriveAttachmentDragCandidate({
    frame: wallFrame(),
    ray: { origin: { x: 0, y: 1, z: 3 }, direction: { x: 1, y: 1, z: -3 } },
    grabOffset: { u: 0, v: 0 },
  });
  assert.equal(wall.ok, true);
  if (wall.ok) assert.deepEqual(wall.localPosition, { u: 1, v: 2 });
  const outside = deriveAttachmentDragCandidate({
    frame: FLOOR,
    ray: { origin: { x: 0, y: 2, z: 0 }, direction: { x: 5, y: -2, z: 0 } },
    grabOffset: { u: 0, v: 0 },
  });
  assert.deepEqual(outside, { ok: false, reasons: ["attachment_anchor_outside_support"] });
});

test("drag returns deterministic ray failures and transform authority never selects legacy while attached", () => {
  assert.deepEqual(
    deriveAttachmentDragCandidate({
      frame: FLOOR,
      ray: { origin: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      grabOffset: { u: 0, v: 0 },
    }),
    { ok: false, reasons: ["attachment_ray_parallel"] }
  );
  assert.deepEqual(
    deriveAttachmentDragCandidate({
      frame: FLOOR,
      ray: { origin: { x: 0, y: 2, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
      grabOffset: { u: 0, v: 0 },
    }),
    { ok: false, reasons: ["attachment_intersection_behind_camera"] }
  );
  assert.equal(selectObjectTransformMode({ attachment: null, bindingCurrent: false, supportUsable: false, cameraActive: false }), "detached");
  assert.equal(selectObjectTransformMode({ attachment: attachment(), bindingCurrent: true, supportUsable: true, cameraActive: true }), "support_attached_current");
  assert.equal(selectObjectTransformMode({ attachment: attachment(), bindingCurrent: false, supportUsable: true, cameraActive: true }), "support_attached_blocked");
  assert.equal(selectObjectTransformMode({ attachment: attachment(), bindingCurrent: true, supportUsable: true, cameraActive: false }), "support_attached_blocked");
});

test("model mutation lock is determined by attachment existence, not derived mode", () => {
  assert.equal(isAttachedObjectModelLocked(null), false);
  assert.equal(canMutateModelWhileAttached(null), true);
  assert.equal(isAttachedObjectModelLocked(attachment()), true);
  assert.equal(canMutateModelWhileAttached(attachment()), false);
  // A current or blocked mode is derived from this same attachment. If the
  // facts ever diverge, attachment existence remains the safety authority.
  for (const mode of ["support_attached_current", "support_attached_blocked"] as const) {
    assert.notEqual(mode, "detached");
    assert.equal(isAttachedObjectModelLocked(attachment()), true);
  }
});

test("placement authority holds rather than selecting legacy for incomplete attached transforms", () => {
  assert.equal(
    selectPlacementTransformAuthority({
      mode: "support_attached_current",
      hasCurrentAttachmentTransform: true,
      hasFrozenAttachmentTransform: false,
    }),
    "attachment_current"
  );
  assert.equal(
    selectPlacementTransformAuthority({
      mode: "support_attached_blocked",
      hasCurrentAttachmentTransform: false,
      hasFrozenAttachmentTransform: true,
    }),
    "attachment_frozen"
  );
  assert.equal(
    selectPlacementTransformAuthority({
      mode: "support_attached_blocked",
      hasCurrentAttachmentTransform: false,
      hasFrozenAttachmentTransform: false,
    }),
    "attachment_hold"
  );
  assert.equal(
    selectPlacementTransformAuthority({
      mode: "detached",
      hasCurrentAttachmentTransform: false,
      hasFrozenAttachmentTransform: false,
    }),
    "legacy"
  );
});
