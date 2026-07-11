import type { SupportPlane, SupportVec3 } from "./support-plane-math";
import type { WallSupportKind } from "./wall-support-geometry";

export type AttachableSupportKind = "floor" | WallSupportKind;
export type Vec2 = { u: number; v: number };
export type ModelLocalBounds = { min: SupportVec3; max: SupportVec3 };
export type ObjectContactProfile =
  | { kind: "floor"; contactAxis: "local_y"; contactSide: "min" }
  | { kind: "wall"; contactAxis: "local_z"; contactSide: "min" | "max" };

export type ObjectSupportAttachment = {
  supportKind: AttachableSupportKind;
  supportBindingKey: string;
  localPosition: Vec2;
  rotationAboutNormalDeg: number;
  uniformScale: number;
  contactProfile: ObjectContactProfile;
  attachedAtIso: string;
};

export type AttachmentFailureReason =
  | "attachment_not_configured"
  | "attachment_target_support_unusable"
  | "attachment_binding_stale"
  | "attachment_support_derivation_unavailable"
  | "attachment_model_bounds_unavailable"
  | "attachment_model_bounds_invalid"
  | "attachment_contact_profile_invalid"
  | "attachment_scale_invalid"
  | "attachment_frame_invalid"
  | "attachment_basis_invalid"
  | "attachment_camera_inactive"
  | "attachment_ray_invalid"
  | "attachment_ray_parallel"
  | "attachment_intersection_behind_camera"
  | "attachment_intersection_non_finite"
  | "attachment_anchor_outside_support"
  | "attachment_orientation_invalid"
  | "attachment_contact_invalid";

export type AttachmentBindingContext = {
  supportKind: AttachableSupportKind;
  sourcePolygonKey: string;
  confirmationStampKey: string | null;
  imageBasisId: string;
  imageBasisFingerprint: string;
  cameraAppliedAtIso: string;
  frameWidth: number;
  frameHeight: number;
};

export type AttachmentSupportFrame =
  | {
      kind: "floor";
      point: SupportVec3;
      boundaryUV: readonly Vec2[];
    }
  | {
      kind: WallSupportKind;
      plane: SupportPlane;
      seamNormal: SupportVec3;
      boundaryUV: readonly Vec2[];
    };

export type SupportAttachmentTransformResult =
  | {
      ok: true;
      worldPosition: SupportVec3;
      orientationBasis: { x: SupportVec3; y: SupportVec3; z: SupportVec3 };
      uniformScale: number;
      contactPointWorld: SupportVec3;
      supportNormalWorld: SupportVec3;
      boundaryLocalPoint: Vec2;
      diagnostics: { contactDistanceToPlane: number; orientationDeterminant: number };
    }
  | { ok: false; reasons: AttachmentFailureReason[] };

export type AttachmentDragResult =
  | { ok: true; localPosition: Vec2; intersectionWorld: SupportVec3 }
  | { ok: false; reasons: AttachmentFailureReason[] };

export type ObjectTransformMode = "detached" | "support_attached_current" | "support_attached_blocked";
export type PlacementTransformAuthority = "legacy" | "attachment_current" | "attachment_frozen" | "attachment_hold";

const EPSILON = 1e-7;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteVec3(value: SupportVec3 | null | undefined): value is SupportVec3 {
  return !!value && finite(value.x) && finite(value.y) && finite(value.z);
}

function add(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function multiply(value: SupportVec3, scalar: number): SupportVec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function dot(a: SupportVec3, b: SupportVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(value: SupportVec3): SupportVec3 | null {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!finite(length) || length <= EPSILON) return null;
  const normalized = multiply(value, 1 / length);
  return finiteVec3(normalized) ? normalized : null;
}

function rotateAroundAxis(value: SupportVec3, axis: SupportVec3, degrees: number): SupportVec3 | null {
  const unitAxis = normalize(axis);
  if (!unitAxis || !finite(degrees)) return null;
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const rotated = add(
    add(multiply(value, c), multiply(cross(unitAxis, value), s)),
    multiply(unitAxis, dot(unitAxis, value) * (1 - c))
  );
  return finiteVec3(rotated) ? rotated : null;
}

function determinant(basis: { x: SupportVec3; y: SupportVec3; z: SupportVec3 }): number {
  return dot(cross(basis.x, basis.y), basis.z);
}

function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  if (polygon.length < 3 || !finite(point.u) || !finite(point.v)) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous];
    const b = polygon[index];
    if (!finite(a.u) || !finite(a.v) || !finite(b.u) || !finite(b.v)) return false;
    const onSegment =
      Math.abs((b.u - a.u) * (point.v - a.v) - (b.v - a.v) * (point.u - a.u)) <= EPSILON &&
      point.u >= Math.min(a.u, b.u) - EPSILON &&
      point.u <= Math.max(a.u, b.u) + EPSILON &&
      point.v >= Math.min(a.v, b.v) - EPSILON &&
      point.v <= Math.max(a.v, b.v) + EPSILON;
    if (onSegment) return true;
    if ((a.v > point.v) !== (b.v > point.v)) {
      const crossingU = ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u;
      if (point.u < crossingU) inside = !inside;
    }
  }
  return inside;
}

function planeForFrame(frame: AttachmentSupportFrame): { point: SupportVec3; normal: SupportVec3 } {
  return frame.kind === "floor"
    ? { point: frame.point, normal: { x: 0, y: 1, z: 0 } }
    : { point: frame.plane.point, normal: frame.plane.normal };
}

function initialOrientation(frame: AttachmentSupportFrame): {
  basis: { x: SupportVec3; y: SupportVec3; z: SupportVec3 };
  normal: SupportVec3;
} | null {
  if (frame.kind === "floor") {
    return {
      basis: {
        x: { x: 1, y: 0, z: 0 },
        y: { x: 0, y: 1, z: 0 },
        z: { x: 0, y: 0, z: 1 },
      },
      normal: { x: 0, y: 1, z: 0 },
    };
  }
  const seamU = normalize(frame.plane.basisU);
  const seamV = normalize(frame.plane.basisV);
  const seamNormal = normalize(frame.seamNormal);
  const cameraFacing = normalize(frame.plane.normal);
  if (!seamU || !seamV || !seamNormal || !cameraFacing) return null;
  if (Math.abs(dot(seamU, seamV)) > EPSILON || Math.abs(dot(cross(seamU, seamV), seamNormal) - 1) > 1e-5) {
    return null;
  }
  const facingSign = dot(seamNormal, cameraFacing) >= 0 ? 1 : -1;
  // Flip U and N as a pair. Combining unchanged U/V with the independent
  // camera-facing plane normal would mirror the object when the normal flips.
  const basis = {
    x: multiply(seamU, facingSign),
    y: seamV,
    z: multiply(seamNormal, facingSign),
  };
  return determinant(basis) > 0 ? { basis, normal: basis.z } : null;
}

function validateBounds(bounds: ModelLocalBounds | null | undefined): AttachmentFailureReason[] {
  if (!bounds) return ["attachment_model_bounds_unavailable"];
  const values = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
  if (!values.every(finite)) return ["attachment_model_bounds_invalid"];
  if (
    bounds.max.x - bounds.min.x <= EPSILON ||
    bounds.max.y - bounds.min.y <= EPSILON ||
    bounds.max.z - bounds.min.z <= EPSILON
  ) {
    return ["attachment_model_bounds_invalid"];
  }
  return [];
}

export function buildAttachmentBindingKey(context: AttachmentBindingContext): string {
  return JSON.stringify([
    context.supportKind,
    context.sourcePolygonKey,
    context.confirmationStampKey,
    context.imageBasisId,
    context.imageBasisFingerprint,
    context.cameraAppliedAtIso,
    context.frameWidth,
    context.frameHeight,
  ]);
}

export function isAttachmentBindingCurrent(
  attachment: ObjectSupportAttachment | null,
  context: AttachmentBindingContext | null
): boolean {
  return !!attachment && !!context && attachment.supportKind === context.supportKind &&
    attachment.supportBindingKey === buildAttachmentBindingKey(context);
}

export function selectObjectTransformMode(input: {
  attachment: ObjectSupportAttachment | null;
  bindingCurrent: boolean;
  supportUsable: boolean;
  cameraActive: boolean;
}): ObjectTransformMode {
  if (!input.attachment) return "detached";
  return input.bindingCurrent && input.supportUsable && input.cameraActive
    ? "support_attached_current"
    : "support_attached_blocked";
}

/** Model identity and child-group normalization are immutable while attached. */
export function isAttachedObjectModelLocked(attachment: ObjectSupportAttachment | null): boolean {
  return attachment !== null;
}

export function canMutateModelWhileAttached(attachment: ObjectSupportAttachment | null): boolean {
  return !isAttachedObjectModelLocked(attachment);
}

/**
 * A blocked attachment with no captured world transform must hold the current
 * Three.js placement; it must never fall through to detached placement.
 */
export function selectPlacementTransformAuthority(input: {
  mode: ObjectTransformMode;
  hasCurrentAttachmentTransform: boolean;
  hasFrozenAttachmentTransform: boolean;
}): PlacementTransformAuthority {
  if (input.mode === "detached") return "legacy";
  if (input.mode === "support_attached_current") {
    return input.hasCurrentAttachmentTransform ? "attachment_current" : "attachment_hold";
  }
  return input.hasFrozenAttachmentTransform ? "attachment_frozen" : "attachment_hold";
}

export function isAttachmentAnchorInsideSupport(frame: AttachmentSupportFrame, localPosition: Vec2): boolean {
  return pointInPolygon(localPosition, frame.boundaryUV);
}

export function computeSupportAttachmentTransform(input: {
  attachment: ObjectSupportAttachment;
  frame: AttachmentSupportFrame | null;
  modelBounds: ModelLocalBounds | null;
  scaleRange: { min: number; max: number };
}): SupportAttachmentTransformResult {
  const { attachment, frame, modelBounds, scaleRange } = input;
  const reasons: AttachmentFailureReason[] = [];
  if (!frame) reasons.push("attachment_support_derivation_unavailable");
  reasons.push(...validateBounds(modelBounds));
  if (!finite(attachment.uniformScale) || attachment.uniformScale < scaleRange.min || attachment.uniformScale > scaleRange.max) {
    reasons.push("attachment_scale_invalid");
  }
  if (!finite(attachment.localPosition.u) || !finite(attachment.localPosition.v) || !finite(attachment.rotationAboutNormalDeg)) {
    reasons.push("attachment_frame_invalid");
  }
  if (
    (attachment.supportKind === "floor" && attachment.contactProfile.kind !== "floor") ||
    (attachment.supportKind !== "floor" && attachment.contactProfile.kind !== "wall")
  ) {
    reasons.push("attachment_contact_profile_invalid");
  }
  if (reasons.length > 0) return { ok: false, reasons };
  const usableFrame = frame!;
  const usableBounds = modelBounds!;
  if (usableFrame.kind !== attachment.supportKind) return { ok: false, reasons: ["attachment_frame_invalid"] };
  if (!isAttachmentAnchorInsideSupport(usableFrame, attachment.localPosition)) {
    return { ok: false, reasons: ["attachment_anchor_outside_support"] };
  }
  const initial = initialOrientation(usableFrame);
  if (!initial) return { ok: false, reasons: ["attachment_basis_invalid"] };
  const x = rotateAroundAxis(initial.basis.x, initial.normal, attachment.rotationAboutNormalDeg);
  const y = rotateAroundAxis(initial.basis.y, initial.normal, attachment.rotationAboutNormalDeg);
  const z = rotateAroundAxis(initial.basis.z, initial.normal, attachment.rotationAboutNormalDeg);
  if (!x || !y || !z) return { ok: false, reasons: ["attachment_orientation_invalid"] };
  const basis = { x, y, z };
  const orientationDeterminant = determinant(basis);
  if (!finite(orientationDeterminant) || orientationDeterminant <= 0.9999) {
    return { ok: false, reasons: ["attachment_orientation_invalid"] };
  }
  const plane = planeForFrame(usableFrame);
  const anchor =
    usableFrame.kind === "floor"
      ? { x: usableFrame.point.x + attachment.localPosition.u, y: usableFrame.point.y, z: usableFrame.point.z + attachment.localPosition.v }
      : add(
          usableFrame.plane.point,
          add(
            // boundaryUV was derived in the reviewed seam frame
            // (plane.basisU/plane.basisV). Keep anchor coordinates in that
            // documented frame even when orientationU flips with the visible
            // camera-facing side.
            multiply(usableFrame.plane.basisU, attachment.localPosition.u),
            multiply(usableFrame.plane.basisV, attachment.localPosition.v)
          )
        );
  if (!finiteVec3(anchor)) return { ok: false, reasons: ["attachment_frame_invalid"] };
  const contactLocal =
    attachment.contactProfile.kind === "floor"
      ? usableBounds.min.y
      : attachment.contactProfile.contactSide === "min"
        ? usableBounds.min.z
        : usableBounds.max.z;
  const contactAxis = attachment.contactProfile.kind === "floor" ? basis.y : basis.z;
  if (!finite(contactLocal) || Math.abs(contactLocal) > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reasons: ["attachment_contact_profile_invalid"] };
  }
  const worldPosition = subtract(anchor, multiply(contactAxis, contactLocal * attachment.uniformScale));
  const contactPointWorld = add(worldPosition, multiply(contactAxis, contactLocal * attachment.uniformScale));
  const contactDistanceToPlane = dot(subtract(contactPointWorld, plane.point), normalize(plane.normal) ?? plane.normal);
  if (
    !finiteVec3(worldPosition) ||
    !finiteVec3(contactPointWorld) ||
    !finite(contactDistanceToPlane) ||
    Math.abs(contactDistanceToPlane) > 1e-5
  ) {
    return { ok: false, reasons: ["attachment_contact_invalid"] };
  }
  return {
    ok: true,
    worldPosition,
    orientationBasis: basis,
    uniformScale: attachment.uniformScale,
    contactPointWorld,
    supportNormalWorld: initial.normal,
    boundaryLocalPoint: attachment.localPosition,
    diagnostics: { contactDistanceToPlane, orientationDeterminant },
  };
}

export function deriveAttachmentDragCandidate(input: {
  frame: AttachmentSupportFrame | null;
  ray: { origin: SupportVec3; direction: SupportVec3 } | null;
  grabOffset: Vec2 | null;
}): AttachmentDragResult {
  if (!input.frame) return { ok: false, reasons: ["attachment_support_derivation_unavailable"] };
  if (!input.ray || !finiteVec3(input.ray.origin) || !finiteVec3(input.ray.direction)) {
    return { ok: false, reasons: ["attachment_ray_invalid"] };
  }
  if (!input.grabOffset || !finite(input.grabOffset.u) || !finite(input.grabOffset.v)) {
    return { ok: false, reasons: ["attachment_frame_invalid"] };
  }
  const plane = planeForFrame(input.frame);
  const normal = normalize(plane.normal);
  const direction = normalize(input.ray.direction);
  if (!normal || !direction) return { ok: false, reasons: ["attachment_ray_invalid"] };
  const denominator = dot(direction, normal);
  if (Math.abs(denominator) <= EPSILON) return { ok: false, reasons: ["attachment_ray_parallel"] };
  const distance = dot(subtract(plane.point, input.ray.origin), normal) / denominator;
  if (!finite(distance)) return { ok: false, reasons: ["attachment_intersection_non_finite"] };
  if (distance <= EPSILON) return { ok: false, reasons: ["attachment_intersection_behind_camera"] };
  const intersectionWorld = add(input.ray.origin, multiply(direction, distance));
  if (!finiteVec3(intersectionWorld)) return { ok: false, reasons: ["attachment_intersection_non_finite"] };
  const rawLocal =
    input.frame.kind === "floor"
      ? { u: intersectionWorld.x - input.frame.point.x, v: intersectionWorld.z - input.frame.point.z }
      : {
          u: dot(subtract(intersectionWorld, input.frame.plane.point), input.frame.plane.basisU),
          v: dot(subtract(intersectionWorld, input.frame.plane.point), input.frame.plane.basisV),
        };
  const localPosition = { u: rawLocal.u + input.grabOffset.u, v: rawLocal.v + input.grabOffset.v };
  if (!isAttachmentAnchorInsideSupport(input.frame, localPosition)) {
    return { ok: false, reasons: ["attachment_anchor_outside_support"] };
  }
  return { ok: true, localPosition, intersectionWorld };
}
