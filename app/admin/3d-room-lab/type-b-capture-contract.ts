// --- Phase B3D-5A: Type B Capture Contracts, Fingerprints, and Frozen ---------
// Endpoint-Role Resolver (pure) ------------------------------------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. This module establishes the FUTURE
// Type B capture boundary WITHOUT yet producing a snapshot from live UI state.
// It provides:
//   1. capture-result and explicit-input CONTRACTS for a FUTURE B3D-5B phase;
//   2. deterministic, versioned, human-readable structural FINGERPRINTS;
//   3. a pure all-or-nothing endpoint-role + junction-evidence RESOLVER;
//   4. the exact capture-refusal VOCABULARY with a stable refusal order.
//
// ABSOLUTE SCOPE (Phase B3D-5A). Nothing here (now or by consuming this module)
// may implement or perform any of:
//   - constructing a TypeBEvidenceSnapshot from live state; snapshot capture
//     evaluation; live React state handling; UI;
//   - B3C tuple generation; B3D-1 P3P; quartic solving; projection; crop
//     compatibility; branch association; topology / branch-policy validation;
//     diagnostic-run assembly; root filtering; ranking; confidence;
//     recommendation; selected root / branch / FOV / camera; preview; load;
//     Apply; calibration mutation; persistence; API; Type A routing;
//   - any reuse of Type A dimensions, aspect grids, FOV ranges, steps,
//     corridors, confidence, or calibration state.
//
// It NEVER runs a generic geometry solver, DLT, homography, line intersection,
// endpoint averaging, midpoint, inferred hidden near-corner, notes-based
// override, or visual heuristic. Every runtime function is pure, deterministic,
// non-mutating, and NEVER throws for malformed runtime input.
//
// Runtime imports are restricted to committed PURE Type B contract helpers /
// constants (source-frame junction tolerance, the frozen endpoint-role
// resolution rule identity, and the evaluator junction-tolerance formula
// identity). All data-shape imports are `import type`. It has NO React, browser,
// Three.js, Type A, solver / homography / camera, calibration, persistence,
// API, routing, or external mathematics dependency.

import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  resolveTypeBEvaluatorJunctionTolerancePx,
} from "./type-b-evaluator-contract";
import type {
  TypeBDeclaredEndpointRole,
  TypeBEndpointRoleCaptureRefusalReason,
  TypeBEvaluatorEligibilityRefusal,
  TypeBEvidenceSnapshot,
  TypeBFrozenEndpointRoleMap,
  TypeBFrozenJunctionEvidence,
} from "./type-b-evaluator-contract";
import type {
  TypeBDeclaredLineEvidence,
  TypeBEndpointStatus,
  TypeBFrameContactStatus,
  TypeBSourceFrame,
} from "./type-b-evidence-types";
import type {
  TypeBTupleGenerationCoverage,
  TypeBTupleGenerationRefusalReason,
} from "./type-b-tuple-generation";
import type { TypeBFovProbeTopologyDeclaration } from "./type-b-p3p-diagnostic-contract";
import type { TypeBBranchAssociationPolicy } from "./type-b-p3p-branch-association";

// --- 1. Required schema constants (the four runtime schema exports) ----------

// Versioned identity for the FUTURE Type B capture result. The `/v0` suffix
// makes a future shape change an explicit new identifier, never a silent
// redefinition.
export const TYPE_B_CAPTURE_SCHEMA = "vibode-type-b-capture/v0" as const;

// Versioned identity for the structural evidence fingerprint.
export const TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA =
  "vibode-type-b-evidence-fingerprint/v0" as const;

// Versioned identity for the structural coverage fingerprint.
export const TYPE_B_COVERAGE_FINGERPRINT_SCHEMA =
  "vibode-type-b-coverage-fingerprint/v0" as const;

// Versioned identity for the structural association fingerprint.
export const TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA =
  "vibode-type-b-association-fingerprint/v0" as const;

// --- 2. Explicit capture inputs (declarative only) --------------------------

// FUTURE B3D-5B-ready declarative type for the Type B-only operator-authored
// coverage inputs. It carries NO Type A object and NO Type A-derived field. It
// is DECLARATIVE ONLY: B3D-5A never validates it in a capture evaluator.
export type TypeBExplicitCaptureInputs = {
  readonly worldWidth: number;
  readonly authorizedAspectRatios: readonly number[];

  readonly primaryProductClasses: TypeBTupleGenerationCoverage["primaryProductClasses"];

  readonly fovProbesDeg: TypeBTupleGenerationCoverage["fovProbesDeg"];
};

// --- 3. Capture-refusal vocabulary ------------------------------------------

// Dedicated capture-refusal vocabulary. It is SEPARATE from
// `TypeBDiagnosticRefusalReason`; it reuses existing literal strings ONLY where
// their meaning is exactly the same, and it alters NO existing union.
//
// Composition (all reused literals are proven present at compile time via the
// source union or `Extract`, so a typo cannot silently invent a literal):
//   - four frozen endpoint-role literals (TypeBEndpointRoleCaptureRefusalReason);
//   - one evidence/eligibility literal (shared_junction_not_visibly_established);
//   - four NEW capture-only literals;
//   - nine reused B3C run-level coverage-shape literals (class-level B3C reasons
//     are deliberately EXCLUDED so B3D-5B can keep them visible in B3C).
export type TypeBCaptureRefusalReason =
  // Reused frozen endpoint-role literals.
  | TypeBEndpointRoleCaptureRefusalReason
  // Reused evidence/eligibility literal.
  | Extract<TypeBEvaluatorEligibilityRefusal, "shared_junction_not_visibly_established">
  // New capture-only literals.
  | "invalid_snapshot_basis"
  | "latent_condition_not_authorized"
  | "latent_condition_side_terminus_status_mismatch"
  | "frame_truncated_side_terminus_not_contacts_frame"
  // Reused B3C run-level coverage-shape literals (NOT class-level).
  | Extract<
      TypeBTupleGenerationRefusalReason,
      | "no_authorized_aspect_ratios"
      | "duplicate_authorized_aspect_ratio"
      | "no_primary_product_classes"
      | "duplicate_primary_product_class_identity"
      | "duplicate_primary_latent_depth_product"
      | "invalid_primary_product_class"
      | "no_fov_probes"
      | "invalid_fov_probe"
      | "duplicate_fov_probe"
    >;

// The single immutable declared order for capture refusal reasons. It orders
// global / basis facts before junction facts, then role facts, then latent-
// condition consistency, then coverage-shape facts. The resolver returns all
// genuinely evaluable applicable reasons in exactly this order (no first-
// failure-only behavior). This is a module-private ordering: it is NOT exported.
const TYPE_B_CAPTURE_REFUSAL_ORDER: readonly TypeBCaptureRefusalReason[] = [
  // Global / basis facts.
  "invalid_snapshot_basis",
  "latent_condition_not_authorized",
  // Junction facts.
  "junction_endpoint_pair_tied",
  "shared_junction_not_visibly_established",
  // Role facts.
  "junction_endpoint_not_position_certain",
  "non_junction_rear_endpoint_not_position_certain",
  // Latent-condition consistency facts.
  "side_terminus_not_latent",
  "latent_condition_side_terminus_status_mismatch",
  "frame_truncated_side_terminus_not_contacts_frame",
  // Coverage-shape facts (evaluated by a FUTURE B3D-5B capture evaluator, not by
  // the endpoint-role resolver; included here so the capture vocabulary has ONE
  // declared order).
  "no_authorized_aspect_ratios",
  "duplicate_authorized_aspect_ratio",
  "no_primary_product_classes",
  "duplicate_primary_product_class_identity",
  "duplicate_primary_latent_depth_product",
  "invalid_primary_product_class",
  "no_fov_probes",
  "invalid_fov_probe",
  "duplicate_fov_probe",
];

// --- 4. Endpoint-role resolution contract types -----------------------------

// Pure resolver input. It uses the exact existing Type B source-frame and
// declared-seam types, and accepts ONLY the two authorized latent conditions in
// its static shape (`unresolved` / `not_needed_visible` are excluded; a
// runtime-supplied unauthorized value still refuses via
// `latent_condition_not_authorized`).
export type TypeBEndpointRoleResolutionInput = {
  readonly sourceFrame: TypeBSourceFrame;
  readonly rearSeam: TypeBDeclaredLineEvidence;
  readonly strongSideSeam: TypeBDeclaredLineEvidence;

  readonly latentNearCornerCondition: "frame_truncated" | "occluded";
};

// All-or-nothing resolution result. A `resolved` result carries the frozen
// endpoint-role map, the frozen junction evidence, and NO refusal reasons; a
// `refused` result carries at least one refusal reason and NEVER a partial role
// map or junction. There is no intermediate / partial state.
export type TypeBEndpointRoleResolution =
  | {
      readonly status: "resolved";
      readonly endpointRoles: TypeBFrozenEndpointRoleMap;
      readonly junction: TypeBFrozenJunctionEvidence;
      readonly refusalReasons: readonly [];
    }
  | {
      readonly status: "refused";
      readonly endpointRoles?: never;
      readonly junction?: never;
      readonly refusalReasons: readonly [
        TypeBCaptureRefusalReason,
        ...TypeBCaptureRefusalReason[]
      ];
    };

// --- 5. Capture identity + FUTURE capture-result contracts ------------------

// Capture identity. The association fingerprint is intentionally EXCLUDED
// because branch association is not captured.
export type TypeBCaptureIdentity = {
  readonly evidenceFingerprint: string;
  readonly coverageFingerprint: string;
};

// FUTURE capture success. B3D-5A defines the SHAPE only and never constructs one
// (no capture evaluator exists here). It carries the frozen snapshot, the exact
// coverage, and the capture identity, with NO diagnostic result, association
// request, root, branch, selected state, confidence, score, rank, preview,
// load, Apply, or calibration field.
export type TypeBCaptureSuccess = {
  readonly schema: typeof TYPE_B_CAPTURE_SCHEMA;
  readonly status: "captured";
  readonly snapshot: TypeBEvidenceSnapshot;
  readonly coverage: TypeBTupleGenerationCoverage;
  readonly identity: TypeBCaptureIdentity;
  readonly refusalReasons: readonly [];
};

// FUTURE capture refusal. Structurally cannot carry a snapshot, coverage, or
// identity, and always carries at least one capture refusal reason.
export type TypeBCaptureRefusal = {
  readonly schema: typeof TYPE_B_CAPTURE_SCHEMA;
  readonly status: "refused";
  readonly refusalReasons: readonly [
    TypeBCaptureRefusalReason,
    ...TypeBCaptureRefusalReason[]
  ];
};

// FUTURE capture result. A discriminated union so impossible states (snapshot on
// refusal, refusal reasons on success) are unrepresentable.
export type TypeBCaptureResult = TypeBCaptureSuccess | TypeBCaptureRefusal;

// --- 6. Pure primitive guards + source-pixel arithmetic ---------------------

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Best-effort record accessor for defensive (never-throwing) field reads. A
// non-object becomes an empty record so field access is safe and deterministic.
function asRecord(value: unknown): Record<string, unknown> {
  return isObjectRecord(value) ? value : {};
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Minimal source-frame validity, mirroring the committed evidence-facts helper:
// finite, strictly-positive width AND height.
function isValidSourceFrame(
  frame: unknown
): frame is TypeBSourceFrame {
  return (
    isObjectRecord(frame) &&
    isFinitePositive(frame.width) &&
    isFinitePositive(frame.height)
  );
}

// A declared seam is geometry-finite when both declared endpoints have finite
// normalized coordinates. No range enforcement (coordinates need not be [0,1]).
function isSeamGeometryFinite(
  seam: unknown
): seam is TypeBDeclaredLineEvidence {
  if (!isObjectRecord(seam)) return false;
  const start = seam.startNorm;
  const end = seam.endNorm;
  if (!isObjectRecord(start) || !isObjectRecord(end)) return false;
  return (
    isFiniteNumber(start.x) &&
    isFiniteNumber(start.y) &&
    isFiniteNumber(end.x) &&
    isFiniteNumber(end.y)
  );
}

// Source-pixel coordinate of a source-normalized point on a valid frame. This is
// the SAME committed endpoint-to-source-pixel arithmetic used by the Type B
// evidence-facts module (point.x * width, point.y * height); it is mirrored
// here (the facts helper does not export it) rather than diverged.
function toSourcePx(
  x: number,
  y: number,
  frame: TypeBSourceFrame
): { readonly x: number; readonly y: number } {
  return { x: x * frame.width, y: y * frame.height };
}

// Euclidean source-pixel distance, mirroring the committed evidence-facts helper
// (Math.hypot of the coordinate deltas). No averaging, midpoint, or intersection.
function distancePx(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Position-certain endpoint statuses (the exact existing committed literals).
function isPositionCertain(status: TypeBEndpointStatus | unknown): boolean {
  return status === "visible" || status === "near_frame";
}

// Declared endpoint status for a role on a seam, using the exact committed
// field names. Returns `undefined` for a malformed seam.
function endpointStatusFor(
  seam: TypeBDeclaredLineEvidence,
  role: TypeBDeclaredEndpointRole
): TypeBEndpointStatus | undefined {
  return role === "start" ? seam.startEndpointStatus : seam.endEndpointStatus;
}

// Declared frame contact for a role on a seam. Returns `undefined` for a
// malformed seam.
function frameContactFor(
  seam: TypeBDeclaredLineEvidence,
  role: TypeBDeclaredEndpointRole
): TypeBFrameContactStatus | undefined {
  return role === "start" ? seam.startFrameContact : seam.endFrameContact;
}

// Narrowing guard so a refusal reason list can satisfy the head + rest tuple
// contract WITHOUT a cast.
function isNonEmptyReasons(
  reasons: readonly TypeBCaptureRefusalReason[]
): reasons is readonly [TypeBCaptureRefusalReason, ...TypeBCaptureRefusalReason[]] {
  return reasons.length > 0;
}

// Orders a collected set of refusal reasons by the single declared stable order,
// dropping duplicates (a Set already dedupes) and unknown values.
function orderedCaptureRefusals(
  reasons: ReadonlySet<TypeBCaptureRefusalReason>
): TypeBCaptureRefusalReason[] {
  return TYPE_B_CAPTURE_REFUSAL_ORDER.filter((reason) => reasons.has(reason));
}

// --- 7. Frozen endpoint-role + junction-evidence resolver -------------------

/**
 * Pure, deterministic, all-or-nothing resolution of the frozen Type B endpoint
 * roles and shared-junction evidence from declared seams.
 *
 * It NEVER mutates its input, NEVER throws for malformed runtime input, and
 * NEVER runs a generic geometry solver, DLT, homography, line intersection,
 * endpoint averaging, midpoint, inferred hidden near-corner, notes-based
 * override, or visual heuristic. The four participants are ONLY the declared
 * rear start/end and strong-side start/end endpoints.
 *
 * Behavior:
 *   - Global / basis facts (`invalid_snapshot_basis`, `latent_condition_not_
 *     authorized`) are evaluated honestly and may accompany a tie.
 *   - The unique minimum of the FOUR rear × side endpoint-pair source-pixel
 *     distances is the junction pair. An exact-equal minimum (`===`) is
 *     `junction_endpoint_pair_tied` with NO role map and NO arbitrary selection.
 *   - A unique pair must satisfy `resolveTypeBEvaluatorJunctionTolerancePx`;
 *     otherwise `shared_junction_not_visibly_established`.
 *   - Endpoint-specific certainty and latent-condition checks require a unique
 *     resolved pair; they are never accumulated against an invented junction.
 *   - No partial role map is ever returned when any capture refusal exists.
 */
export function resolveTypeBCapturedEndpointRoles(
  input: TypeBEndpointRoleResolutionInput
): TypeBEndpointRoleResolution {
  try {
    const reasons = new Set<TypeBCaptureRefusalReason>();

    const safeInput = (isObjectRecord(input) ? input : {}) as Partial<
      Record<keyof TypeBEndpointRoleResolutionInput, unknown>
    >;
    const sourceFrame = safeInput.sourceFrame;
    const rearSeam = safeInput.rearSeam;
    const strongSideSeam = safeInput.strongSideSeam;
    const condition = safeInput.latentNearCornerCondition;

    // Basis validity: valid source frame AND both seams geometry-finite.
    const frameValid = isValidSourceFrame(sourceFrame);
    const rearFinite = isSeamGeometryFinite(rearSeam);
    const sideFinite = isSeamGeometryFinite(strongSideSeam);
    const basisValid = frameValid && rearFinite && sideFinite;
    if (!basisValid) reasons.add("invalid_snapshot_basis");

    // Latent condition authorization (evaluable independently of the pair).
    const conditionAuthorized =
      condition === "frame_truncated" || condition === "occluded";
    if (!conditionAuthorized) reasons.add("latent_condition_not_authorized");

    // Junction pair resolution (only honestly evaluable with a valid basis).
    let winner: {
      readonly rear: TypeBDeclaredEndpointRole;
      readonly side: TypeBDeclaredEndpointRole;
    } | null = null;
    let winningDistancePx: number | null = null;
    let tolerancePx: number | null = null;

    if (basisValid) {
      // Both narrowed to valid shapes by `basisValid`.
      const frame = sourceFrame as TypeBSourceFrame;
      const rear = rearSeam as TypeBDeclaredLineEvidence;
      const side = strongSideSeam as TypeBDeclaredLineEvidence;

      tolerancePx = resolveTypeBEvaluatorJunctionTolerancePx(frame);

      const rearStartPx = toSourcePx(rear.startNorm.x, rear.startNorm.y, frame);
      const rearEndPx = toSourcePx(rear.endNorm.x, rear.endNorm.y, frame);
      const sideStartPx = toSourcePx(side.startNorm.x, side.startNorm.y, frame);
      const sideEndPx = toSourcePx(side.endNorm.x, side.endNorm.y, frame);

      // Exactly four declared rear × side endpoint pairs. No fifth point is ever
      // created (no intersection, no midpoint, no average).
      const pairs: readonly {
        readonly rear: TypeBDeclaredEndpointRole;
        readonly side: TypeBDeclaredEndpointRole;
        readonly dist: number;
      }[] = [
        { rear: "start", side: "start", dist: distancePx(rearStartPx, sideStartPx) },
        { rear: "start", side: "end", dist: distancePx(rearStartPx, sideEndPx) },
        { rear: "end", side: "start", dist: distancePx(rearEndPx, sideStartPx) },
        { rear: "end", side: "end", dist: distancePx(rearEndPx, sideEndPx) },
      ];

      const minDist = Math.min(
        pairs[0].dist,
        pairs[1].dist,
        pairs[2].dist,
        pairs[3].dist
      );
      // Exact JavaScript numeric equality for tie detection: no epsilon
      // collapsing, no sorting-based break, no index-order selection.
      const minima = pairs.filter((pair) => pair.dist === minDist);

      if (minima.length !== 1) {
        // Two (or more) distinct candidate pairs share the exact minimum.
        reasons.add("junction_endpoint_pair_tied");
      } else if (tolerancePx === null || !(minDist <= tolerancePx)) {
        reasons.add("shared_junction_not_visibly_established");
      } else {
        winner = { rear: minima[0].rear, side: minima[0].side };
        winningDistancePx = minDist;
      }
    } else if (!frameValid) {
      // An invalid source frame means the junction tolerance cannot be resolved.
      reasons.add("shared_junction_not_visibly_established");
    }

    // Role + latent-condition checks require a unique, tolerance-satisfying pair.
    if (winner !== null) {
      const rear = rearSeam as TypeBDeclaredLineEvidence;
      const side = strongSideSeam as TypeBDeclaredLineEvidence;

      const junctionRearRole = winner.rear;
      const junctionSideRole = winner.side;
      const nonJunctionRearRole: TypeBDeclaredEndpointRole =
        junctionRearRole === "start" ? "end" : "start";
      const sideTerminusRole: TypeBDeclaredEndpointRole =
        junctionSideRole === "start" ? "end" : "start";

      const junctionRearStatus = endpointStatusFor(rear, junctionRearRole);
      const junctionSideStatus = endpointStatusFor(side, junctionSideRole);
      const nonJunctionRearStatus = endpointStatusFor(rear, nonJunctionRearRole);
      const terminusStatus = endpointStatusFor(side, sideTerminusRole);
      const terminusContact = frameContactFor(side, sideTerminusRole);

      // Both junction endpoints must be position-certain.
      if (
        !isPositionCertain(junctionRearStatus) ||
        !isPositionCertain(junctionSideStatus)
      ) {
        reasons.add("junction_endpoint_not_position_certain");
      }

      // The non-junction rear endpoint must be position-certain.
      if (!isPositionCertain(nonJunctionRearStatus)) {
        reasons.add("non_junction_rear_endpoint_not_position_certain");
      }

      // Latent side-terminus consistency. `side_terminus_not_latent` is
      // evaluable regardless of the declared condition; the equality / contact
      // checks require an authorized declared condition.
      if (terminusStatus !== "frame_truncated" && terminusStatus !== "occluded") {
        reasons.add("side_terminus_not_latent");
      } else if (conditionAuthorized) {
        if (terminusStatus !== condition) {
          reasons.add("latent_condition_side_terminus_status_mismatch");
        } else if (
          condition === "frame_truncated" &&
          terminusContact !== "contacts_frame"
        ) {
          reasons.add("frame_truncated_side_terminus_not_contacts_frame");
        }
      }
    }

    const ordered = orderedCaptureRefusals(reasons);

    if (!isNonEmptyReasons(ordered)) {
      // No refusal survived: an all-or-nothing resolved result. Reaching here
      // guarantees a unique, tolerance-satisfying junction pair. The extra
      // null checks are a defensive contradiction guard (unreachable in
      // practice) that also proves non-nullness to the type system.
      if (
        winner === null ||
        winningDistancePx === null ||
        tolerancePx === null
      ) {
        return {
          status: "refused",
          refusalReasons: ["invalid_snapshot_basis"],
        };
      }
      const endpointRoles: TypeBFrozenEndpointRoleMap = {
        resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
        junctionRearEndpoint: winner.rear,
        junctionSideEndpoint: winner.side,
      };
      const junction: TypeBFrozenJunctionEvidence = {
        distanceSourcePx: winningDistancePx,
        toleranceFormulaId: TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
        resolvedToleranceSourcePx: tolerancePx,
        established: true,
      };
      return {
        status: "resolved",
        endpointRoles,
        junction,
        refusalReasons: [],
      };
    }

    return { status: "refused", refusalReasons: ordered };
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return { status: "refused", refusalReasons: ["invalid_snapshot_basis"] };
  }
}

// --- 8. Canonical structural fingerprint encoding ---------------------------
// Fingerprints are pure, deterministic, human-readable, versioned, canonical,
// and collision-resistant BY STRUCTURAL SERIALIZATION (never hashing). They are
// free of timestamps, free-text notes, object-key iteration, rounding,
// bucketing, sorting, normalization, and repair. Each begins with its schema
// constant, then the canonical delimiter, then a fixed-field-order payload.

// Canonical top-level delimiter (human-readable).
const FP_DELIM = "|";

// The deterministic malformed-input payload. A fingerprint function returns
// `<schema><delimiter><malformed>` (never a random or throwing fallback) when
// its primary argument(s) are not the expected object shape.
const FP_MALFORMED = "<malformed-input>";

// JSON-string encoding for an actual string value (canonical quoting/escaping).
function encStr(value: string): string {
  return JSON.stringify(value);
}

// Nullable-string encoding: `null` / `undefined` are distinct unquoted tokens so
// they can never collide with the JSON-quoted strings "null" / "undefined".
function encStrOrNull(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return encStr(String(value));
}

// Exact JavaScript number-to-string encoding (no rounding, no locale). A
// non-number is coerced deterministically via String (only relevant for
// best-effort encoding of a partially malformed object).
function encNum(value: unknown): string {
  return typeof value === "number" ? String(value) : `#${String(value)}`;
}

// boolean | null encoding with distinct unquoted tokens.
function encBoolOrNull(value: unknown): string {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null) return "null";
  return "undefined";
}

// Ordered list encoding. Preserves the supplied order exactly (no sorting).
function encList(value: unknown, enc: (item: unknown) => string): string {
  if (!Array.isArray(value)) return "<not-array>";
  return `[${value.map((item) => enc(item)).join(",")}]`;
}

// Canonical encoding of one declared/frozen seam (notes are EXCLUDED).
function encSeam(seam: unknown): string {
  const s = asRecord(seam);
  const start = asRecord(s.startNorm);
  const end = asRecord(s.endNorm);
  return (
    "(" +
    `startNorm=(x=${encNum(start.x)},y=${encNum(start.y)}),` +
    `endNorm=(x=${encNum(end.x)},y=${encNum(end.y)}),` +
    `startEndpointStatus=${encStrOrNull(s.startEndpointStatus)},` +
    `endEndpointStatus=${encStrOrNull(s.endEndpointStatus)},` +
    `startFrameContact=${encStrOrNull(s.startFrameContact)},` +
    `endFrameContact=${encStrOrNull(s.endFrameContact)},` +
    `occlusionStatus=${encStrOrNull(s.occlusionStatus)},` +
    `role=${encStrOrNull(s.role)}` +
    ")"
  );
}

// Canonical encoding of the frozen B1 qualification fingerprint.
function encB1Qualification(q: unknown): string {
  const b1 = asRecord(q);
  const summary = asRecord(b1.evidenceSummary);
  return (
    "(" +
    `status=${encStrOrNull(b1.status)},` +
    `blockingReasons=${encList(b1.blockingReasons, encStrOrNull)},` +
    `advisoryReasons=${encList(b1.advisoryReasons, encStrOrNull)},` +
    "evidenceSummary=(" +
    `rearSeamUsable=${encBoolOrNull(summary.rearSeamUsable)},` +
    `strongSideSeamUsable=${encBoolOrNull(summary.strongSideSeamUsable)},` +
    `rearSideRelationshipUsable=${encBoolOrNull(summary.rearSideRelationshipUsable)},` +
    `latentNearCornerBounded=${encBoolOrNull(summary.latentNearCornerBounded)},` +
    `cropInterpretationUsable=${encBoolOrNull(summary.cropInterpretationUsable)}` +
    ")" +
    ")"
  );
}

// Canonical encoding of the frozen shared-junction evidence.
function encJunction(junction: unknown): string {
  const j = asRecord(junction);
  return (
    "(" +
    `established=${encBoolOrNull(j.established)},` +
    `distanceSourcePx=${encNum(j.distanceSourcePx)},` +
    `toleranceFormulaId=${encStrOrNull(j.toleranceFormulaId)},` +
    `resolvedToleranceSourcePx=${encNum(j.resolvedToleranceSourcePx)}` +
    ")"
  );
}

// Canonical encoding of the frozen endpoint-role map.
function encEndpointRoles(map: unknown): string {
  const m = asRecord(map);
  return (
    "(" +
    `resolutionRuleId=${encStrOrNull(m.resolutionRuleId)},` +
    `junctionRearEndpoint=${encStrOrNull(m.junctionRearEndpoint)},` +
    `junctionSideEndpoint=${encStrOrNull(m.junctionSideEndpoint)}` +
    ")"
  );
}

// Canonical encoding of frozen floor assumptions.
function encFloorAssumptions(floor: unknown): string {
  const f = asRecord(floor);
  return (
    "(" +
    `worldWidth=${encNum(f.worldWidth)},` +
    `authorizedAspectRatios=${encList(f.authorizedAspectRatios, encNum)}` +
    ")"
  );
}

// Canonical encoding of one primary product class (identity + product identity).
function encPrimaryProductClass(entry: unknown): string {
  const e = asRecord(entry);
  const product = asRecord(e.latentDepthProduct);
  return (
    "(" +
    `identity=${encStrOrNull(e.primaryProductClassIdentity)},` +
    `productFormulaId=${encStrOrNull(product.formulaId)},` +
    `productValue=${encNum(product.value)}` +
    ")"
  );
}

// --- 9. Fingerprint functions -----------------------------------------------

/**
 * Deterministic structural fingerprint of a valid captured evidence snapshot.
 * It includes every snapshot-semantic fact (basis, families, Type A handoff
 * context, both declared seams, latent condition, B1 qualification fingerprint,
 * frozen junction, frozen endpoint-role map, and floor assumptions) and
 * EXCLUDES `capturedAtIso` and all free-text notes. It never mutates the input
 * and returns a deterministic schema-prefixed malformed-input fingerprint
 * (`<schema>|<malformed-input>`) rather than throwing for a non-object argument.
 */
export function makeTypeBEvidenceFingerprint(
  snapshot: TypeBEvidenceSnapshot
): string {
  if (!isObjectRecord(snapshot)) {
    return `${TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA}${FP_DELIM}${FP_MALFORMED}`;
  }
  try {
    const basis = asRecord(snapshot.basis);
    const frame = asRecord(basis.sourceFrame);
    const parts: string[] = [
      TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA,
      `snapshotSchema=${encStrOrNull(snapshot.schema)}`,
      "basis=(" +
        `sourceImageIdentity=${encStrOrNull(basis.sourceImageIdentity)},` +
        `sourceFrameKey=${encStrOrNull(basis.sourceFrameKey)},` +
        `sourceFrameWidth=${encNum(frame.width)},` +
        `sourceFrameHeight=${encNum(frame.height)},` +
        `candidateIdentity=${encStrOrNull(basis.candidateIdentity)},` +
        `floorPolygonKey=${encStrOrNull(basis.floorPolygonKey)}` +
        ")",
      `evidenceFamily=${encStrOrNull(snapshot.evidenceFamily)}`,
      `evaluatorFamily=${encStrOrNull(snapshot.evaluatorFamily)}`,
      `typeAContext=${encStrOrNull(snapshot.typeAContext)}`,
      `rearSeam=${encSeam(snapshot.rearSeam)}`,
      `strongSideSeam=${encSeam(snapshot.strongSideSeam)}`,
      `latentNearCornerCondition=${encStrOrNull(snapshot.latentNearCornerCondition)}`,
      `b1Qualification=${encB1Qualification(snapshot.b1Qualification)}`,
      `junction=${encJunction(snapshot.junction)}`,
      `endpointRoles=${encEndpointRoles(snapshot.endpointRoles)}`,
      `floorAssumptions=${encFloorAssumptions(snapshot.floorAssumptions)}`,
    ];
    return parts.join(FP_DELIM);
  } catch {
    return `${TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA}${FP_DELIM}${FP_MALFORMED}`;
  }
}

/**
 * Deterministic structural fingerprint of the coverage authored against a
 * snapshot. It includes the snapshot floor assumptions (world width +
 * authorized aspect ratios in exact declared order), the primary product
 * classes in exact authored order (identity, product formula identity, exact
 * product value), and the FOV probes in exact authored order. It sorts NO list,
 * never mutates its inputs, and returns a deterministic schema-prefixed
 * malformed-input fingerprint for a non-object argument.
 */
export function makeTypeBCoverageFingerprint(
  snapshot: TypeBEvidenceSnapshot,
  coverage: TypeBTupleGenerationCoverage
): string {
  if (!isObjectRecord(snapshot) || !isObjectRecord(coverage)) {
    return `${TYPE_B_COVERAGE_FINGERPRINT_SCHEMA}${FP_DELIM}${FP_MALFORMED}`;
  }
  try {
    const parts: string[] = [
      TYPE_B_COVERAGE_FINGERPRINT_SCHEMA,
      `floorAssumptions=${encFloorAssumptions(snapshot.floorAssumptions)}`,
      `primaryProductClasses=${encList(
        coverage.primaryProductClasses,
        encPrimaryProductClass
      )}`,
      `fovProbesDeg=${encList(coverage.fovProbesDeg, encNum)}`,
    ];
    return parts.join(FP_DELIM);
  } catch {
    return `${TYPE_B_COVERAGE_FINGERPRINT_SCHEMA}${FP_DELIM}${FP_MALFORMED}`;
  }
}

/**
 * Deterministic structural fingerprint of a SUPPLIED association request
 * (topology + policy). It serializes the topology schema, the ordered probes in
 * exact authored order, the step, the policy schema, and all six policy values
 * in declared field order. It does NOT validate, repair, normalize, or decide
 * whether association should be requested; it never mutates its inputs, and
 * returns a deterministic schema-prefixed malformed-input fingerprint for a
 * non-object argument.
 */
export function makeTypeBAssociationFingerprint(request: {
  readonly topology: TypeBFovProbeTopologyDeclaration;
  readonly policy: TypeBBranchAssociationPolicy;
}): string {
  if (
    !isObjectRecord(request) ||
    !isObjectRecord(request.topology) ||
    !isObjectRecord(request.policy)
  ) {
    return `${TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA}${FP_DELIM}${FP_MALFORMED}`;
  }
  try {
    const topology = request.topology as Record<string, unknown>;
    const policy = request.policy as Record<string, unknown>;
    const parts: string[] = [
      TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA,
      `topologySchema=${encStrOrNull(topology.schema)}`,
      `orderedProbesDeg=${encList(topology.orderedProbesDeg, encNum)}`,
      `stepDeg=${encNum(topology.stepDeg)}`,
      `policySchema=${encStrOrNull(policy.schema)}`,
      "policy=(" +
        `maxNormalizedCameraPositionDelta=${encNum(policy.maxNormalizedCameraPositionDelta)},` +
        `maxRotationDeltaDeg=${encNum(policy.maxRotationDeltaDeg)},` +
        `tieMarginNormalizedCameraPosition=${encNum(policy.tieMarginNormalizedCameraPosition)},` +
        `tieMarginRotationDeg=${encNum(policy.tieMarginRotationDeg)},` +
        `nearCoincidentNormalizedCameraPositionDelta=${encNum(policy.nearCoincidentNormalizedCameraPositionDelta)},` +
        `nearCoincidentRotationDeltaDeg=${encNum(policy.nearCoincidentRotationDeltaDeg)}` +
        ")",
    ];
    return parts.join(FP_DELIM);
  } catch {
    return `${TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA}${FP_DELIM}${FP_MALFORMED}`;
  }
}
