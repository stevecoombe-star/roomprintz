// --- Phase B3D-3: Pure Frame-Truncation Compatibility -----------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A pure, deterministic, coordinate-free
// diagnostic compatibility layer built on the committed B3A / B3B-R / B3C /
// B3D-R contracts and an existing B3D-1 (or B3D-2) diagnostic run. It consumes
// ONE frozen Type B evidence snapshot plus ONE `TypeBP3pDiagnosticRunRecord`
// and emits ONE neutral compatibility record per generated member × surviving
// P3P root.
//
// It evaluates ONLY the one-sided `frame_truncated` side-terminus exit
// condition: an internal implied full side-edge endpoint N is projected through
// each existing pose hypothesis and tested against the frozen source frame. A
// strict-interior projection contradicts the operator's frame-exit declaration
// (`incompatible`); a projection on the boundary or outside is consistent with
// it (`compatible`); a non-projectable point is `not_evaluated`. An `occluded`
// terminus is `not_applicable` (B1/B2 record no occluder geometry). N — and its
// world / camera / projected / frame-intersection coordinates — is an INTERNAL
// construction and is NEVER returned, logged, persisted, or exposed.
//
// ABSOLUTE SCOPE (Phase B3D-3). This module does NOT implement or perform any
// of: P3P / quartic solving / pose re-evaluation; homography / DLT; root
// filtering; branch association; topology validation; corridor construction;
// near-corner recovery or coordinate output; endpoint-role re-derivation;
// snapshot capture; UI; preview; controlled load; Apply; calibration mutation;
// candidate / polygon / dimension / FOV / readiness mutation; persistence; API;
// Type A routing; ranking; score; confidence; recommendation; selection;
// auto-load; auto-apply. It never selects, filters, ranks, reorders, or removes
// a root, and never alters B3D-1 pose results, B3D-2 branches, topology, or B3C
// member data.
//
// Runtime imports are restricted to PURE constants / helpers from committed
// Type B contract modules; all data shapes are type-only. It has NO React,
// browser, Three.js, Type A, P3P-evaluator, branch-association, homography /
// camera-solver, calibration, persistence, API, or routing import and no
// external mathematics dependency.

import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  makeTypeBPoseProbeEquivalenceKey,
} from "./type-b-evaluator-contract";
import type {
  TypeBCropCompatibilityState,
  TypeBDeclaredEndpointRole,
  TypeBEvidenceSnapshot,
  TypeBFrozenDeclaredLineEvidence,
} from "./type-b-evaluator-contract";
import { TYPE_B_P3P_DIAGNOSTIC_SCHEMA } from "./type-b-p3p-diagnostic-contract";
import type { TypeBP3pDiagnosticRunRecord } from "./type-b-p3p-diagnostic-contract";

// --- 1. Required schema constant (one of the two runtime exports) -----------

// Versioned identity for this frame-truncation compatibility result wrapper.
// The `/v0` suffix makes a future shape change an explicit new identifier,
// never a silent redefinition.
export const TYPE_B_FRAME_TRUNCATION_COMPATIBILITY_SCHEMA =
  "vibode-type-b-frame-truncation-compatibility/v0" as const;

// --- 2. Result status and non-assessment reasons ---------------------------

export type TypeBFrameTruncationCompatibilityStatus =
  | "evaluated"
  | "not_assessed";

// LOCAL wrapper reasons only. B3D-3 never amends `TypeBDiagnosticRefusalReason`,
// never appends `crop_evidence_incompatible` to the diagnostic run, and treats
// an incompatible member × root result as a neutral observation, NOT a
// run-level refusal.
export type TypeBFrameTruncationCompatibilityNotAssessedReason =
  | "upstream_diagnostic_run_not_compatibility_assessable"
  | "invalid_frame_truncation_compatibility_linkage"
  | "invalid_frame_truncation_evidence";

// --- 3. Coordinate-free per-member × root record ----------------------------

export type TypeBFrameTruncationCompatibilityRecord = {
  readonly primaryProductClassIdentity: string;
  readonly floorAspectRatio: number;
  readonly latentSideExtent: number;

  /**
   * Reference to the shared pose-probe diagnostic result.
   * This record contains no pose, root, branch, or coordinate object.
   */
  readonly poseProbeEquivalenceKey: string;

  /**
   * Enumeration only; never rank, selection, or preference.
   */
  readonly hypothesisIndex: number;

  /**
   * For frame_truncated:
   * compatible | incompatible | not_evaluated.
   *
   * For occluded:
   * not_applicable.
   */
  readonly cropCompatibility: TypeBCropCompatibilityState;
};

// --- 4. Result wrapper ------------------------------------------------------

export type TypeBFrameTruncationCompatibilityResult = {
  readonly schema: typeof TYPE_B_FRAME_TRUNCATION_COMPATIBILITY_SCHEMA;

  readonly status: TypeBFrameTruncationCompatibilityStatus;

  /**
   * Echoed without modification. It may be a B3D-1 run or a B3D-2 run.
   * B3D-3 never changes roots, branch corridors, topology, or refusal facts.
   */
  readonly diagnosticRun: TypeBP3pDiagnosticRunRecord;

  /**
   * One record for each generated member × surviving hypothesis.
   * Pose-stage refusals yield no root records.
   */
  readonly records: readonly TypeBFrameTruncationCompatibilityRecord[];

  readonly notAssessedReasons: readonly TypeBFrameTruncationCompatibilityNotAssessedReason[];
};

// --- 5. Pure primitive helpers ----------------------------------------------

// The exact evidence-family literal. B1 exports this as a TYPE only, so it is
// inlined here exactly as the committed B3C / B3D-1 modules do.
const TYPE_B_EVIDENCE_FAMILY_LITERAL = "rear_seam_plus_strong_side_seam";

// The two authorized latent side-terminus conditions for this first family.
const LATENT_CONDITION_FRAME_TRUNCATED = "frame_truncated";
const LATENT_CONDITION_OCCLUDED = "occluded";

// The only run-level refusal literal that keeps a run compatibility-assessable
// (per-probe P3P remains valid; only branch-corridor formation was not
// assessed). Any other refusal makes the run not-assessable.
const TOPOLOGY_ONLY_REFUSAL = "fov_topology_unresolved";

// The exact approved B1/B2 frame-contact literal that establishes true
// source-frame truncation of the side terminus.
const FRAME_CONTACT_TRUE = "contacts_frame";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Independent deep copy so the echoed diagnostic run never aliases the caller's
// input state. Falls back to the original reference only if a value is
// non-cloneable (defensive; the Type B family carries plain data).
function safeClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

// --- 6. Pure geometric helpers ----------------------------------------------

type V3 = { readonly x: number; readonly y: number; readonly z: number };

function isFiniteV3(v: unknown): v is V3 {
  return (
    isObjectRecord(v) &&
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.y) &&
    isFiniteNumber(v.z)
  );
}

function isFiniteRotation(r: unknown): r is readonly number[] {
  return Array.isArray(r) && r.length === 9 && r.every((c) => isFiniteNumber(c));
}

// --- 7. Result builders -----------------------------------------------------

function makeResult(
  status: TypeBFrameTruncationCompatibilityStatus,
  diagnosticRun: TypeBP3pDiagnosticRunRecord,
  records: readonly TypeBFrameTruncationCompatibilityRecord[],
  notAssessedReasons: readonly TypeBFrameTruncationCompatibilityNotAssessedReason[]
): TypeBFrameTruncationCompatibilityResult {
  return {
    schema: TYPE_B_FRAME_TRUNCATION_COMPATIBILITY_SCHEMA,
    status,
    diagnosticRun,
    records,
    notAssessedReasons,
  };
}

function notAssessed(
  diagnosticRun: TypeBP3pDiagnosticRunRecord,
  reason: TypeBFrameTruncationCompatibilityNotAssessedReason
): TypeBFrameTruncationCompatibilityResult {
  // Echo the diagnostic run unchanged (an independent copy so the wrapper never
  // aliases caller state). Never a partial assessment.
  return makeResult("not_assessed", safeClone(diagnosticRun), [], [reason]);
}

// --- 8. Upstream assessability ----------------------------------------------
// A run is compatibility-assessable ONLY when its schema is exact, its B3C
// tuple generation status is "generated", and its run-level refusal reasons are
// either empty or consist ONLY of the topology-only refusal. A B3C-refused run,
// an `invalid_tuple_generation_linkage` run, any unknown / non-topology
// run-level refusal, or a malformed run is NOT assessable. B3D-3 does NOT
// inspect topology or branch corridors to make this decision.
function isUpstreamAssessable(run: unknown): run is TypeBP3pDiagnosticRunRecord {
  if (!isObjectRecord(run)) return false;
  if (run.schema !== TYPE_B_P3P_DIAGNOSTIC_SCHEMA) return false;

  const tupleGeneration = run.tupleGeneration;
  if (!isObjectRecord(tupleGeneration)) return false;
  if (tupleGeneration.status !== "generated") return false;

  const refusalReasons = run.refusalReasons;
  if (!Array.isArray(refusalReasons)) return false;
  for (const reason of refusalReasons) {
    if (reason !== TOPOLOGY_ONLY_REFUSAL) return false;
  }
  return true;
}

// --- 9. Snapshot / run linkage validation -----------------------------------

function basesExactlyEqual(a: unknown, b: unknown): boolean {
  if (!isObjectRecord(a) || !isObjectRecord(b)) return false;
  if (a.sourceImageIdentity !== b.sourceImageIdentity) return false;
  if (a.sourceFrameKey !== b.sourceFrameKey) return false;
  if (a.candidateIdentity !== b.candidateIdentity) return false;
  if (a.floorPolygonKey !== b.floorPolygonKey) return false;
  const fa = a.sourceFrame;
  const fb = b.sourceFrame;
  if (!isObjectRecord(fa) || !isObjectRecord(fb)) return false;
  if (fa.width !== fb.width || fa.height !== fb.height) return false;
  return true;
}

// The exact class-key / product / FOV identity a generated B3C key implies.
type ExpectedKeyIdentity = {
  readonly classKey: string;
  readonly productValue: number;
  readonly fovProbeDeg: number;
};

// Builds the expected pose-probe key -> identity map from the generated B3C
// coverage WITHOUT repairing or reordering it. Returns null on any malformed
// generated class/member/tuple linkage (a whole-run linkage failure).
function buildExpectedPoseProbeKeys(
  run: TypeBP3pDiagnosticRunRecord
): Map<string, ExpectedKeyIdentity> | null {
  const tupleGeneration = run.tupleGeneration;
  const productClasses = Array.isArray(tupleGeneration?.productClasses)
    ? tupleGeneration.productClasses
    : null;
  if (!productClasses) return null;

  const expected = new Map<string, ExpectedKeyIdentity>();
  for (const productClass of productClasses) {
    if (!isObjectRecord(productClass)) return null;
    const status = productClass.status;
    if (status === "refused") continue;
    if (status !== "generated") return null;

    const equivalence = productClass.latentDepthEquivalence;
    if (!isObjectRecord(equivalence)) return null;
    const classKey = equivalence.equivalenceClassKey;
    if (!isNonBlankString(classKey)) return null;
    const product = equivalence.latentDepthProduct;
    if (!isObjectRecord(product) || !isFinitePositive(product.value)) {
      return null;
    }
    const productValue = product.value;

    const members = Array.isArray(productClass.members)
      ? productClass.members
      : null;
    if (!members || members.length === 0) return null;

    for (const member of members) {
      if (!isObjectRecord(member)) return null;
      const memberAspect = member.floorAspectRatio;
      const memberExtent = member.latentSideExtent;
      if (!isFinitePositive(memberAspect) || !isFinitePositive(memberExtent)) {
        return null;
      }
      // Member aspect / extent agree exactly with the class product (IEEE).
      if (memberExtent !== productValue / memberAspect) return null;

      const tuples = Array.isArray(member.tuples) ? member.tuples : null;
      if (!tuples || tuples.length === 0) return null;
      for (const tupleRecord of tuples) {
        if (!isObjectRecord(tupleRecord)) return null;
        const poseProbeEquivalence = tupleRecord.poseProbeEquivalence;
        if (!isObjectRecord(poseProbeEquivalence)) return null;
        const key = poseProbeEquivalence.poseProbeEquivalenceKey;
        if (!isNonBlankString(key)) return null;
        const fovProbeDeg = poseProbeEquivalence.fovProbeDeg;
        if (!isFiniteNumber(fovProbeDeg)) return null;
        if (poseProbeEquivalence.latentDepthEquivalenceClassKey !== classKey) {
          return null;
        }
        const rebuilt = makeTypeBPoseProbeEquivalenceKey(classKey, fovProbeDeg);
        if (rebuilt === null || rebuilt !== key) return null;

        const existing = expected.get(key);
        if (existing) {
          if (
            existing.classKey !== classKey ||
            existing.productValue !== productValue ||
            existing.fovProbeDeg !== fovProbeDeg
          ) {
            return null;
          }
        } else {
          expected.set(key, { classKey, productValue, fovProbeDeg });
        }
      }
    }
  }
  return expected;
}

// Validates that a single pose-stage result is well-formed: a refusal carries
// NO hypotheses, and every hypothesis is finite with the junction-anchored
// frame, a finite camera position, a finite 3x3 rotation, and a stable numeric
// hypothesis index.
function isPoseStageResultLinkable(poseStageResult: unknown): boolean {
  if (!isObjectRecord(poseStageResult)) return false;
  const kind = poseStageResult.kind;
  if (kind === "refusal") {
    const hypotheses = poseStageResult.hypotheses;
    if (Array.isArray(hypotheses) && hypotheses.length > 0) return false;
    return true;
  }
  if (kind !== "pose_hypotheses") return false;
  const hypotheses = poseStageResult.hypotheses;
  if (!Array.isArray(hypotheses)) return false;
  for (const hypothesis of hypotheses) {
    if (!isObjectRecord(hypothesis)) return false;
    if (!isFiniteNumber(hypothesis.hypothesisIndex)) return false;
    if (
      hypothesis.poseComparisonReferenceFrame !==
      TYPE_B_POSE_COMPARISON_REFERENCE_FRAME
    ) {
      return false;
    }
    if (!isFiniteV3(hypothesis.cameraPositionWorld)) return false;
    if (!isFiniteRotation(hypothesis.worldToCameraRotation)) return false;
  }
  return true;
}

// Valid frozen endpoint-role map: exact resolution rule and both role values.
function endpointRolesValid(roles: unknown): roles is {
  readonly junctionRearEndpoint: TypeBDeclaredEndpointRole;
  readonly junctionSideEndpoint: TypeBDeclaredEndpointRole;
} {
  if (!isObjectRecord(roles)) return false;
  if (roles.resolutionRuleId !== TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE) {
    return false;
  }
  const rear = roles.junctionRearEndpoint;
  const side = roles.junctionSideEndpoint;
  if (rear !== "start" && rear !== "end") return false;
  if (side !== "start" && side !== "end") return false;
  return true;
}

// Full snapshot/run linkage validation. Returns the O(1) pose-probe lookup map
// on success, or null on ANY malformed linkage (validated atomically; B3D-3
// never partially assesses a malformed run). It repairs nothing.
function validateLinkage(
  snapshot: TypeBEvidenceSnapshot,
  run: TypeBP3pDiagnosticRunRecord
): Map<string, TypeBP3pDiagnosticRunRecord["poseProbeResults"][number]> | null {
  if (!isObjectRecord(snapshot)) return null;
  if (snapshot.schema !== TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA) return null;
  if (snapshot.evidenceFamily !== TYPE_B_EVIDENCE_FAMILY_LITERAL) return null;
  if (snapshot.evaluatorFamily !== TYPE_B_EVALUATOR_FAMILY) return null;

  const floorAssumptions = snapshot.floorAssumptions;
  if (!isObjectRecord(floorAssumptions)) return null;
  if (!isFinitePositive(floorAssumptions.worldWidth)) return null;

  const basis = snapshot.basis;
  if (!isObjectRecord(basis)) return null;
  const sourceFrame = basis.sourceFrame;
  if (!isObjectRecord(sourceFrame)) return null;
  if (
    !isFinitePositive(sourceFrame.width) ||
    !isFinitePositive(sourceFrame.height)
  ) {
    return null;
  }
  if (!basesExactlyEqual(basis, run.snapshotBasis)) return null;

  if (!endpointRolesValid(snapshot.endpointRoles)) return null;
  if (!isObjectRecord(snapshot.rearSeam)) return null;
  if (!isObjectRecord(snapshot.strongSideSeam)) return null;

  const expected = buildExpectedPoseProbeKeys(run);
  if (!expected) return null;

  const poseProbeResults = Array.isArray(run.poseProbeResults)
    ? run.poseProbeResults
    : null;
  if (!poseProbeResults) return null;

  const recordByKey = new Map<
    string,
    TypeBP3pDiagnosticRunRecord["poseProbeResults"][number]
  >();
  for (const record of poseProbeResults) {
    if (!isObjectRecord(record)) return null;
    const poseProbeEquivalence = record.poseProbeEquivalence;
    if (!isObjectRecord(poseProbeEquivalence)) return null;
    const key = poseProbeEquivalence.poseProbeEquivalenceKey;
    if (!isNonBlankString(key)) return null;
    const classKey = poseProbeEquivalence.latentDepthEquivalenceClassKey;
    if (!isNonBlankString(classKey)) return null;
    const fovProbeDeg = poseProbeEquivalence.fovProbeDeg;
    if (!isFiniteNumber(fovProbeDeg)) return null;

    const rebuilt = makeTypeBPoseProbeEquivalenceKey(classKey, fovProbeDeg);
    if (rebuilt === null || rebuilt !== key) return null;

    const identity = expected.get(key);
    if (!identity) return null;
    if (
      identity.classKey !== classKey ||
      identity.fovProbeDeg !== fovProbeDeg
    ) {
      return null;
    }

    // Valid finite primary product, consistent across the shared key.
    const recordProduct = record.latentDepthProduct;
    if (!isObjectRecord(recordProduct)) return null;
    if (!isFinitePositive(recordProduct.value)) return null;
    if (recordProduct.value !== identity.productValue) return null;
    if (recordProduct.formulaId !== TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA) {
      return null;
    }

    if (!isPoseStageResultLinkable(record.poseStageResult)) return null;

    if (recordByKey.has(key)) return null;
    recordByKey.set(
      key,
      record as unknown as TypeBP3pDiagnosticRunRecord["poseProbeResults"][number]
    );
  }

  // Exactly one pose-probe record per declared generated B3C key.
  if (recordByKey.size !== expected.size) return null;

  // Every member compatibility record links to exactly one pose-probe result
  // and agrees exactly with its class product.
  const memberRecords = Array.isArray(run.memberCompatibilityRecords)
    ? run.memberCompatibilityRecords
    : null;
  if (!memberRecords) return null;
  for (const member of memberRecords) {
    if (!isObjectRecord(member)) return null;
    if (!isNonBlankString(member.primaryProductClassIdentity)) return null;
    const key = member.poseProbeEquivalenceKey;
    if (!isNonBlankString(key)) return null;
    const record = recordByKey.get(key);
    if (!record) return null;
    const aspect = member.floorAspectRatio;
    const extent = member.latentSideExtent;
    if (!isFinitePositive(aspect) || !isFinitePositive(extent)) return null;
    const identity = expected.get(key);
    if (!identity) return null;
    if (extent !== identity.productValue / aspect) return null;
  }

  return recordByKey;
}

// --- 10. Frozen frame-truncation evidence consistency -----------------------

function oppositeRole(
  role: TypeBDeclaredEndpointRole
): TypeBDeclaredEndpointRole {
  return role === "start" ? "end" : "start";
}

// Resolves the frozen side terminus's observed status + frame-contact ONLY via
// the side endpoint opposite `snapshot.endpointRoles.junctionSideEndpoint`
// (never a closest-endpoint re-derivation).
function resolveSideTerminus(
  sideSeam: TypeBFrozenDeclaredLineEvidence,
  junctionSideRole: TypeBDeclaredEndpointRole
): { readonly status: unknown; readonly frameContact: unknown } {
  const terminusRole = oppositeRole(junctionSideRole);
  const status =
    terminusRole === "start"
      ? sideSeam.startEndpointStatus
      : sideSeam.endEndpointStatus;
  const frameContact =
    terminusRole === "start"
      ? sideSeam.startFrameContact
      : sideSeam.endFrameContact;
  return { status, frameContact };
}

// Validates the frozen evidence is internally consistent for the declared
// latent condition. For `frame_truncated`, the side terminus status must be the
// exact `frame_truncated` enum literal AND its frame-contact must be the exact
// approved `contacts_frame` literal that establishes true source-frame
// truncation. For `occluded`, only the exact `occluded` status is required (no
// occluder geometry is interpreted). Any other condition is inconsistent.
function isFrameTruncationEvidenceConsistent(
  snapshot: TypeBEvidenceSnapshot
): boolean {
  const condition = snapshot.latentNearCornerCondition;
  const roles = snapshot.endpointRoles;
  const sideSeam = snapshot.strongSideSeam;
  const { status, frameContact } = resolveSideTerminus(
    sideSeam,
    roles.junctionSideEndpoint
  );

  if (condition === LATENT_CONDITION_FRAME_TRUNCATED) {
    if (status !== LATENT_CONDITION_FRAME_TRUNCATED) return false;
    if (frameContact !== FRAME_CONTACT_TRUE) return false;
    return true;
  }
  if (condition === LATENT_CONDITION_OCCLUDED) {
    if (status !== LATENT_CONDITION_OCCLUDED) return false;
    return true;
  }
  return false;
}

// --- 11. Internal projection procedure --------------------------------------
// Projects the INTERNAL implied full side-edge endpoint N through one existing
// pose hypothesis under the exact B3D-1 CV convention (vertical FOV, square
// pixels, principal point at the frozen source-frame center, x-right, y-down,
// z-forward). It returns ONLY the compatibility state; no coordinate, depth,
// frame-edge location, or implied-corner value is ever surfaced.
function evaluateFrameTruncatedCompatibility(
  floorAspectRatio: number,
  worldWidth: number,
  frameWidth: number,
  frameHeight: number,
  fovProbeDeg: number,
  rotation: readonly number[],
  cameraPositionWorld: V3
): TypeBCropCompatibilityState {
  if (!isFiniteRotation(rotation)) return "not_evaluated";
  if (!isFiniteV3(cameraPositionWorld)) return "not_evaluated";
  if (!isFiniteNumber(fovProbeDeg)) return "not_evaluated";

  const c = cameraPositionWorld;
  // Translation internally: t = -R * C.
  const t = {
    x: -(rotation[0] * c.x + rotation[1] * c.y + rotation[2] * c.z),
    y: -(rotation[3] * c.x + rotation[4] * c.y + rotation[5] * c.z),
    z: -(rotation[6] * c.x + rotation[7] * c.y + rotation[8] * c.z),
  };

  // Internal implied full side-edge endpoint: N = (0, 0, aspect * worldWidth).
  const nz = floorAspectRatio * worldWidth;
  if (!isFiniteNumber(nz)) return "not_evaluated";

  // Transform N into camera space: N_cam = R * N + t (N.x = N.y = 0).
  const camX = rotation[2] * nz + t.x;
  const camY = rotation[5] * nz + t.y;
  const camZ = rotation[8] * nz + t.z;

  // Non-positive camera-space depth is not safely projectable.
  if (!isFiniteNumber(camZ) || camZ <= 0) return "not_evaluated";

  // Intrinsics: vertical FOV, square pixels, principal point at frame center.
  const fovRad = (fovProbeDeg * Math.PI) / 180;
  const fy = frameHeight / (2 * Math.tan(fovRad / 2));
  const fx = fy;
  const cx = frameWidth / 2;
  const cy = frameHeight / 2;
  if (
    !isFiniteNumber(fx) ||
    !isFiniteNumber(fy) ||
    !isFiniteNumber(cx) ||
    !isFiniteNumber(cy) ||
    fx <= 0 ||
    fy <= 0
  ) {
    return "not_evaluated";
  }

  const projX = fx * (camX / camZ) + cx;
  const projY = fy * (camY / camZ) + cy;
  if (!isFiniteNumber(projX) || !isFiniteNumber(projY)) return "not_evaluated";

  // Strict source-frame interior contradicts the declared frame exit.
  const strictInterior =
    projX > 0 && projX < frameWidth && projY > 0 && projY < frameHeight;
  return strictInterior ? "incompatible" : "compatible";
}

// --- 12. Record construction ------------------------------------------------
// Emits one coordinate-free record per member compatibility record × surviving
// hypothesis, preserving the exact order:
//   1. B3C generated-class order (via member compatibility record order),
//   2. member compatibility-record order,
//   3. existing B3D-1 hypothesis-index order.
// A pose-stage refusal yields no records for that member; it never suppresses
// sibling valid probes.
function buildRecords(
  snapshot: TypeBEvidenceSnapshot,
  run: TypeBP3pDiagnosticRunRecord,
  recordByKey: Map<
    string,
    TypeBP3pDiagnosticRunRecord["poseProbeResults"][number]
  >
): TypeBFrameTruncationCompatibilityRecord[] {
  const condition = snapshot.latentNearCornerCondition;
  const worldWidth = snapshot.floorAssumptions.worldWidth;
  const frameWidth = snapshot.basis.sourceFrame.width;
  const frameHeight = snapshot.basis.sourceFrame.height;

  const out: TypeBFrameTruncationCompatibilityRecord[] = [];
  for (const member of run.memberCompatibilityRecords) {
    const key = member.poseProbeEquivalenceKey;
    const poseProbeResult = recordByKey.get(key);
    if (!poseProbeResult) continue;
    const poseStageResult = poseProbeResult.poseStageResult;
    // Pose-stage refusals yield no root records.
    if (poseStageResult.kind !== "pose_hypotheses") continue;

    const fovProbeDeg = poseProbeResult.poseProbeEquivalence.fovProbeDeg;

    // Existing B3D-1 hypothesis-index order.
    const hypotheses = poseStageResult.hypotheses
      .slice()
      .sort((a, b) => a.hypothesisIndex - b.hypothesisIndex);

    for (const hypothesis of hypotheses) {
      let cropCompatibility: TypeBCropCompatibilityState;
      if (condition === LATENT_CONDITION_OCCLUDED) {
        // No occluder geometry exists; no projection is performed.
        cropCompatibility = "not_applicable";
      } else {
        cropCompatibility = evaluateFrameTruncatedCompatibility(
          member.floorAspectRatio,
          worldWidth,
          frameWidth,
          frameHeight,
          fovProbeDeg,
          hypothesis.worldToCameraRotation,
          hypothesis.cameraPositionWorld
        );
      }

      out.push({
        primaryProductClassIdentity: member.primaryProductClassIdentity,
        floorAspectRatio: member.floorAspectRatio,
        latentSideExtent: member.latentSideExtent,
        poseProbeEquivalenceKey: key,
        hypothesisIndex: hypothesis.hypothesisIndex,
        cropCompatibility,
      });
    }
  }
  return out;
}

// --- 13. Main pure evaluator ------------------------------------------------

// Pure, deterministic, coordinate-free frame-truncation compatibility
// evaluation. Consumes one frozen snapshot and one B3D-1 (or B3D-2) diagnostic
// run; returns a result wrapper. It never mutates inputs, never reads live
// state, never throws for malformed runtime input, invokes NO P3P / branch
// association, does NOT modify the supplied diagnostic run, and selects,
// filters, ranks, reorders, or removes NOTHING. Every surviving root is
// retained; an incompatible member × root result is a neutral observation.
export function evaluateTypeBFrameTruncationCompatibility(
  snapshot: TypeBEvidenceSnapshot,
  diagnosticRun: TypeBP3pDiagnosticRunRecord
): TypeBFrameTruncationCompatibilityResult {
  try {
    // 1. Upstream assessability (schema + B3C generated + topology-only refusal).
    if (!isUpstreamAssessable(diagnosticRun)) {
      return notAssessed(
        diagnosticRun,
        "upstream_diagnostic_run_not_compatibility_assessable"
      );
    }

    // 2. Snapshot / run linkage (validated atomically; never partial).
    const recordByKey = validateLinkage(snapshot, diagnosticRun);
    if (!recordByKey) {
      return notAssessed(
        diagnosticRun,
        "invalid_frame_truncation_compatibility_linkage"
      );
    }

    // 3. Frozen frame-truncation evidence consistency.
    if (!isFrameTruncationEvidenceConsistent(snapshot)) {
      return notAssessed(diagnosticRun, "invalid_frame_truncation_evidence");
    }

    // 4. One coordinate-free record per member × surviving root.
    const records = buildRecords(snapshot, diagnosticRun, recordByKey);

    return makeResult("evaluated", safeClone(diagnosticRun), records, []);
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return notAssessed(
      diagnosticRun,
      "upstream_diagnostic_run_not_compatibility_assessable"
    );
  }
}
