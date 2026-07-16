// --- Phase B3D-2: Pure Branch Association and Lattice-Aware FOV Corridors ----
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A pure, deterministic downstream
// association layer built on the committed B3A / B3B-R / B3C / B3D-R contracts
// and the B3D-1 diagnostic run. It consumes ONE frozen Type B evidence
// snapshot, ONE B3D-1 `TypeBP3pDiagnosticRunRecord`, ONE explicit FOV topology
// declaration, and ONE explicit association policy, and returns a pure
// `TypeBBranchAssociationResult` wrapper.
//
// It NEVER invokes P3P, alters root results, creates or deletes roots, reorders
// roots within a probe, collapses roots, or reinterprets plausibility as
// authority. Every B3D-1 `TypeBPoseHypothesis` from a valid `pose_hypotheses`
// probe result becomes a branch node, and every node appears in EXACTLY ONE
// output `TypeBBranchFovCorridor` (including singleton corridors).
//
// ABSOLUTE SCOPE (Phase B3D-2). This module does NOT implement or perform any
// of: P3P / quartic solving / camera-pose re-evaluation; homography / DLT; crop
// compatibility; near-corner projection; endpoint-role resolution; snapshot
// capture; FOV probe generation / sorting / insertion; global optimization;
// Hungarian assignment; root selection; branch ranking; confidence;
// `highConfidence` population; preview; load; Apply; calibration mutation;
// candidate / polygon / dimension / FOV / readiness mutation; persistence; API;
// Type A routing; UI. It ranks, selects, filters, and recommends NOTHING.
//
// Runtime imports are restricted to PURE constants / helpers from committed
// Type B contract modules; all data shapes are type-only. It has NO React,
// browser, Three.js, Type A, homography-solver, calibration, persistence, API,
// or routing import and no external mathematics dependency.

import {
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  makeTypeBPoseProbeEquivalenceKey,
} from "./type-b-evaluator-contract";
import type {
  TypeBEvidenceSnapshot,
} from "./type-b-evaluator-contract";
import {
  TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
  TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
  TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
} from "./type-b-p3p-diagnostic-contract";
import type {
  TypeBBranchAssociationAnnotation,
  TypeBBranchAssociationState,
  TypeBBranchFovCorridor,
  TypeBBranchPoseProbeRootReference,
  TypeBFovProbeTopologyDeclaration,
  TypeBP3pDiagnosticRunRecord,
} from "./type-b-p3p-diagnostic-contract";

// --- 1. Required schema constants (two of the three runtime exports) --------

// Versioned identity for this branch-association result wrapper. The `/v0`
// suffix makes a future shape change an explicit new identifier, never a silent
// redefinition.
export const TYPE_B_BRANCH_ASSOCIATION_SCHEMA =
  "vibode-type-b-branch-association/v0" as const;

// Versioned identity for the explicit association policy. Separate from the
// result schema so the two evolve independently.
export const TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA =
  "vibode-type-b-branch-association-policy/v0" as const;

// --- 2. Explicit association policy -----------------------------------------
// Every value is an explicit caller-supplied gate. No field expresses rank,
// confidence, preference, winner, or selection; the tie margins are a
// distinguishability margin, never a score.
export type TypeBBranchAssociationPolicy = {
  readonly schema: typeof TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA;

  /**
   * Maximum normalized junction-anchored camera-position displacement
   * for a root pair to be compatible across adjacent lattice probes.
   */
  readonly maxNormalizedCameraPositionDelta: number;

  /**
   * Maximum world-to-camera rotation geodesic angle in degrees for a
   * root pair to be compatible across adjacent lattice probes.
   */
  readonly maxRotationDeltaDeg: number;

  /**
   * Minimum improvement in both position and rotation distances needed
   * to distinguish a preferred compatible candidate from a runner-up.
   * This is a tie-resolution margin, never a score.
   */
  readonly tieMarginNormalizedCameraPosition: number;
  readonly tieMarginRotationDeg: number;

  /**
   * Within-probe thresholds for a near-coincident root condition.
   * If either side of a lattice face contains a near-coincident root
   * pair, no associations are asserted across that entire face.
   */
  readonly nearCoincidentNormalizedCameraPositionDelta: number;
  readonly nearCoincidentRotationDeltaDeg: number;
};

// --- 3. Result wrapper ------------------------------------------------------

export type TypeBBranchAssociationStatus = "associated" | "not_assessed";

export type TypeBBranchAssociationNotAssessedReason =
  | "upstream_diagnostic_run_not_associable"
  | "invalid_branch_association_policy"
  | "invalid_diagnostic_run_linkage"
  | "fov_topology_unresolved";

export type TypeBBranchAssociationResult = {
  readonly schema: typeof TYPE_B_BRANCH_ASSOCIATION_SCHEMA;

  readonly status: TypeBBranchAssociationStatus;

  /**
   * Echoed only when policy validation succeeds.
   */
  readonly policy: TypeBBranchAssociationPolicy | null;

  /**
   * Immutable derived copy of the source run.
   *
   * On success it carries the validated topology and generated branch
   * corridors. On non-assessment it carries no topology and no branch
   * corridors.
   */
  readonly diagnosticRun: TypeBP3pDiagnosticRunRecord;

  readonly notAssessedReasons: readonly TypeBBranchAssociationNotAssessedReason[];
};

// --- 4. Pure primitive helpers ----------------------------------------------

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

// Independent deep copy so a derived run / echoed policy never aliases input
// state. Falls back to the original reference only if a value is non-cloneable
// (defensive; the Type B family carries plain data).
function safeClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

// --- 5. Pure geometric helpers ----------------------------------------------

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
  return (
    Array.isArray(r) && r.length === 9 && r.every((c) => isFiniteNumber(c))
  );
}

// Euclidean camera-position distance normalized by the fixed gauge width. Both
// positions are already in the junction-anchored frame; the centered-floor
// frame is never consulted.
function normalizedPositionDelta(a: V3, b: V3, worldWidth: number): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / worldWidth;
}

// Geodesic rotation angle in degrees between two row-major world-to-camera
// rotations, using acos(clamp((trace(Ra * Rb^T) - 1) / 2, -1, 1)). Because
// trace(Ra * Rb^T) equals the elementwise (Frobenius) inner product of the two
// matrices, this is a plain 9-element dot product.
function rotationGeodesicDeg(
  ra: readonly number[],
  rb: readonly number[]
): number {
  let trace = 0;
  for (let i = 0; i < 9; i += 1) trace += ra[i] * rb[i];
  const cosTheta = Math.max(-1, Math.min(1, (trace - 1) / 2));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

// --- 6. Upstream run status -------------------------------------------------
// A run is associable only when it is a well-formed, generated, un-refused
// B3D-1 run that has NOT already been through association (no branch corridors,
// no FOV topology). Any other state is preserved verbatim as not-associable.
function isUpstreamAssociable(run: unknown): run is TypeBP3pDiagnosticRunRecord {
  if (!isObjectRecord(run)) return false;
  if (run.schema !== TYPE_B_P3P_DIAGNOSTIC_SCHEMA) return false;
  const tupleGeneration = run.tupleGeneration;
  if (!isObjectRecord(tupleGeneration)) return false;
  if (tupleGeneration.status !== "generated") return false;
  if (!Array.isArray(run.refusalReasons) || run.refusalReasons.length > 0) {
    return false;
  }
  if (!Array.isArray(run.branchCorridors) || run.branchCorridors.length > 0) {
    return false;
  }
  if (run.fovTopology !== null) return false;
  return true;
}

// --- 7. Snapshot / run linkage validation -----------------------------------

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
// no hypotheses, and every hypothesis is finite with the junction-anchored
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

// Full snapshot/run linkage validation. Returns true only when the snapshot is
// the fixed gauge source for this exact run and every generated B3C key maps to
// exactly one well-formed pose-probe record. It repairs nothing.
function isLinkageValid(
  snapshot: TypeBEvidenceSnapshot,
  run: TypeBP3pDiagnosticRunRecord
): boolean {
  if (!isObjectRecord(snapshot)) return false;
  if (snapshot.schema !== TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA) return false;
  if (snapshot.evidenceFamily !== "rear_seam_plus_strong_side_seam") {
    return false;
  }
  if (snapshot.evaluatorFamily !== TYPE_B_EVALUATOR_FAMILY) return false;
  const floorAssumptions = snapshot.floorAssumptions;
  if (!isObjectRecord(floorAssumptions)) return false;
  if (!isFinitePositive(floorAssumptions.worldWidth)) return false;

  if (!basesExactlyEqual(snapshot.basis, run.snapshotBasis)) return false;

  const expected = buildExpectedPoseProbeKeys(run);
  if (!expected) return false;

  const poseProbeResults = Array.isArray(run.poseProbeResults)
    ? run.poseProbeResults
    : null;
  if (!poseProbeResults) return false;

  const seenKeys = new Set<string>();
  for (const record of poseProbeResults) {
    if (!isObjectRecord(record)) return false;
    const poseProbeEquivalence = record.poseProbeEquivalence;
    if (!isObjectRecord(poseProbeEquivalence)) return false;
    const key = poseProbeEquivalence.poseProbeEquivalenceKey;
    if (!isNonBlankString(key)) return false;
    const classKey = poseProbeEquivalence.latentDepthEquivalenceClassKey;
    if (!isNonBlankString(classKey)) return false;
    const fovProbeDeg = poseProbeEquivalence.fovProbeDeg;
    if (!isFiniteNumber(fovProbeDeg)) return false;

    const rebuilt = makeTypeBPoseProbeEquivalenceKey(classKey, fovProbeDeg);
    if (rebuilt === null || rebuilt !== key) return false;

    const identity = expected.get(key);
    if (!identity) return false;
    if (
      identity.classKey !== classKey ||
      identity.fovProbeDeg !== fovProbeDeg
    ) {
      return false;
    }

    const equivalence = record.latentDepthEquivalence;
    if (!isObjectRecord(equivalence)) return false;
    if (equivalence.equivalenceClassKey !== classKey) return false;
    if (
      equivalence.poseComparisonReferenceFrame !==
      TYPE_B_POSE_COMPARISON_REFERENCE_FRAME
    ) {
      return false;
    }
    const classProduct = equivalence.latentDepthProduct;
    if (!isObjectRecord(classProduct)) return false;
    if (classProduct.value !== identity.productValue) return false;
    if (classProduct.formulaId !== TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA) {
      return false;
    }

    const recordProduct = record.latentDepthProduct;
    if (!isObjectRecord(recordProduct)) return false;
    if (recordProduct.value !== identity.productValue) return false;
    if (recordProduct.formulaId !== TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA) {
      return false;
    }

    if (!isPoseStageResultLinkable(record.poseStageResult)) return false;

    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
  }

  // Exactly one pose-probe record per declared generated B3C key.
  if (seenKeys.size !== expected.size) return false;
  return true;
}

// --- 8. Policy validation ---------------------------------------------------

function isPolicyValid(policy: unknown): policy is TypeBBranchAssociationPolicy {
  if (!isObjectRecord(policy)) return false;
  if (policy.schema !== TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA) return false;

  const maxPos = policy.maxNormalizedCameraPositionDelta;
  const maxRot = policy.maxRotationDeltaDeg;
  const tiePos = policy.tieMarginNormalizedCameraPosition;
  const tieRot = policy.tieMarginRotationDeg;
  const nearPos = policy.nearCoincidentNormalizedCameraPositionDelta;
  const nearRot = policy.nearCoincidentRotationDeltaDeg;

  if (
    !isFiniteNumber(maxPos) ||
    !isFiniteNumber(maxRot) ||
    !isFiniteNumber(tiePos) ||
    !isFiniteNumber(tieRot) ||
    !isFiniteNumber(nearPos) ||
    !isFiniteNumber(nearRot)
  ) {
    return false;
  }

  // Maximum thresholds strictly positive.
  if (!(maxPos > 0) || !(maxRot > 0)) return false;
  // Tie margins non-negative.
  if (tiePos < 0 || tieRot < 0) return false;
  // Near-coincident thresholds non-negative.
  if (nearPos < 0 || nearRot < 0) return false;
  // Near-coincident thresholds must not exceed matching thresholds.
  if (nearPos > maxPos) return false;
  if (nearRot > maxRot) return false;
  // Rotation thresholds must be <= 180.
  if (maxRot > 180) return false;
  if (nearRot > 180) return false;

  return true;
}

// --- 9. Topology validation -------------------------------------------------

// Multiset equality by exact numeric value (order may differ). Both inputs are
// finite-checked by the caller; no rounding, bucketing, or tolerance is used.
function multisetsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = a.slice().sort((x, y) => x - y);
  const sortedB = b.slice().sort((x, y) => x - y);
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

// Validates the supplied FOV topology against the run's exact B3C coverage. It
// sorts, reorders, rounds, interpolates, and inserts NOTHING; a valid topology
// may contain gaps.
function isTopologyValid(
  topology: unknown,
  coverageFovProbesDeg: readonly number[]
): topology is TypeBFovProbeTopologyDeclaration {
  if (!isObjectRecord(topology)) return false;
  if (topology.schema !== TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA) return false;

  const ordered = topology.orderedProbesDeg;
  if (!Array.isArray(ordered) || ordered.length === 0) return false;
  if (!ordered.every((value) => isFiniteNumber(value))) return false;
  // Strictly ascending (which also forbids duplicate probe values).
  for (let i = 1; i < ordered.length; i += 1) {
    if (!(ordered[i] > ordered[i - 1])) return false;
  }

  if (!isFinitePositive(topology.stepDeg)) return false;

  if (!Array.isArray(coverageFovProbesDeg)) return false;
  if (!coverageFovProbesDeg.every((value) => isFiniteNumber(value))) {
    return false;
  }
  if (!multisetsEqual(ordered, coverageFovProbesDeg)) return false;

  return true;
}

// --- 10. Branch node model --------------------------------------------------

type BranchNode = {
  readonly id: number; // equals the global stable ordinal
  readonly classIndex: number;
  readonly probeIndex: number; // index within topology.orderedProbesDeg
  readonly reference: TypeBBranchPoseProbeRootReference;
  readonly cameraPositionWorld: V3;
  readonly rotation: readonly number[];
};

type PendingAnnotation = {
  readonly fromId: number;
  readonly toId: number | null;
  readonly state: TypeBBranchAssociationState;
  readonly seq: number;
};

// A compatible candidate with its junction-anchored pose distances.
type Candidate = {
  readonly node: BranchNode;
  readonly dPos: number;
  readonly dRot: number;
};

// Returns the single unambiguously preferred candidate's node id, or null when
// there is no candidate or no strictly dominating candidate (a tie). A
// candidate dominates only when it beats EVERY other compatible candidate on
// BOTH position and rotation by more than the respective tie margins.
function preferredCandidateId(
  candidates: readonly Candidate[],
  tieMarginPos: number,
  tieMarginRot: number
): number | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].node.id;
  for (const candidate of candidates) {
    let dominates = true;
    for (const other of candidates) {
      if (other === candidate) continue;
      if (
        !(other.dPos - candidate.dPos > tieMarginPos) ||
        !(other.dRot - candidate.dRot > tieMarginRot)
      ) {
        dominates = false;
        break;
      }
    }
    if (dominates) return candidate.node.id;
  }
  return null;
}

// --- 11. Union-find over branch nodes ---------------------------------------

function findRoot(parent: number[], index: number): number {
  let root = index;
  while (parent[root] !== root) root = parent[root];
  // Path compression keeps repeated lookups deterministic and fast.
  let cursor = index;
  while (parent[cursor] !== root) {
    const next = parent[cursor];
    parent[cursor] = root;
    cursor = next;
  }
  return root;
}

function unionNodes(parent: number[], a: number, b: number): void {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra === rb) return;
  // Always attach the higher-ordinal root under the lower so the component's
  // representative is deterministic (not that corridor order relies on it).
  if (ra < rb) parent[rb] = ra;
  else parent[ra] = rb;
}

// --- 12. Success-path corridor construction ---------------------------------

// Builds branch nodes and corridors for a fully validated run + topology +
// policy. Pure and deterministic; consults ONLY junction-anchored pose fields
// and the snapshot gauge width.
function buildBranchCorridors(
  run: TypeBP3pDiagnosticRunRecord,
  topology: TypeBFovProbeTopologyDeclaration,
  policy: TypeBBranchAssociationPolicy,
  worldWidth: number
): TypeBBranchFovCorridor[] {
  const orderedProbes = topology.orderedProbesDeg;

  // Index pose-probe records by their pose-probe key for O(1) lookup.
  const recordByKey = new Map<
    string,
    TypeBP3pDiagnosticRunRecord["poseProbeResults"][number]
  >();
  for (const record of run.poseProbeResults) {
    recordByKey.set(record.poseProbeEquivalence.poseProbeEquivalenceKey, record);
  }

  // Generated product classes, in exact B3C order.
  const generatedClassKeys: string[] = [];
  for (const productClass of run.tupleGeneration.productClasses) {
    if (productClass.status === "generated") {
      generatedClassKeys.push(
        productClass.latentDepthEquivalence.equivalenceClassKey
      );
    }
  }

  // Enumerate every branch node in the global stable order:
  //   1. generated product-class order
  //   2. topology probe order
  //   3. existing hypothesisIndex order
  const nodes: BranchNode[] = [];
  // nodesByCell[classIndex][probeIndex] = branch nodes (ascending hypothesisIndex).
  const nodesByCell: BranchNode[][][] = [];

  for (let classIndex = 0; classIndex < generatedClassKeys.length; classIndex += 1) {
    const classKey = generatedClassKeys[classIndex];
    nodesByCell.push([]);
    for (let probeIndex = 0; probeIndex < orderedProbes.length; probeIndex += 1) {
      nodesByCell[classIndex].push([]);
      const key = makeTypeBPoseProbeEquivalenceKey(
        classKey,
        orderedProbes[probeIndex]
      );
      if (key === null) continue;
      const record = recordByKey.get(key);
      if (!record) continue;
      const poseStageResult = record.poseStageResult;
      if (poseStageResult.kind !== "pose_hypotheses") continue;

      const sortedHypotheses = poseStageResult.hypotheses
        .slice()
        .sort((a, b) => a.hypothesisIndex - b.hypothesisIndex);

      for (const hypothesis of sortedHypotheses) {
        const node: BranchNode = {
          id: nodes.length,
          classIndex,
          probeIndex,
          reference: {
            poseProbeEquivalenceKey: key,
            fovProbeDeg: orderedProbes[probeIndex],
            hypothesisIndex: hypothesis.hypothesisIndex,
          },
          cameraPositionWorld: {
            x: hypothesis.cameraPositionWorld.x,
            y: hypothesis.cameraPositionWorld.y,
            z: hypothesis.cameraPositionWorld.z,
          },
          rotation: hypothesis.worldToCameraRotation,
        };
        nodes.push(node);
        nodesByCell[classIndex][probeIndex].push(node);
      }
    }
  }

  // Union-find over node ids; associated annotations create the only edges.
  const parent = nodes.map((_, index) => index);
  const annotations: PendingAnnotation[] = [];
  let seq = 0;

  const compatible = (a: BranchNode, b: BranchNode): boolean => {
    const dPos = normalizedPositionDelta(
      a.cameraPositionWorld,
      b.cameraPositionWorld,
      worldWidth
    );
    if (!(dPos <= policy.maxNormalizedCameraPositionDelta)) return false;
    const dRot = rotationGeodesicDeg(a.rotation, b.rotation);
    if (!(dRot <= policy.maxRotationDeltaDeg)) return false;
    return true;
  };

  const hasNearCoincidentSiblingPair = (siblings: readonly BranchNode[]): boolean => {
    for (let i = 0; i < siblings.length; i += 1) {
      for (let j = i + 1; j < siblings.length; j += 1) {
        const dPos = normalizedPositionDelta(
          siblings[i].cameraPositionWorld,
          siblings[j].cameraPositionWorld,
          worldWidth
        );
        if (dPos > policy.nearCoincidentNormalizedCameraPositionDelta) continue;
        const dRot = rotationGeodesicDeg(siblings[i].rotation, siblings[j].rotation);
        if (dRot > policy.nearCoincidentRotationDeltaDeg) continue;
        return true;
      }
    }
    return false;
  };

  const candidatesFor = (
    node: BranchNode,
    others: readonly BranchNode[]
  ): Candidate[] => {
    const out: Candidate[] = [];
    for (const other of others) {
      if (!compatible(node, other)) continue;
      out.push({
        node: other,
        dPos: normalizedPositionDelta(
          node.cameraPositionWorld,
          other.cameraPositionWorld,
          worldWidth
        ),
        dRot: rotationGeodesicDeg(node.rotation, other.rotation),
      });
    }
    return out;
  };

  for (let classIndex = 0; classIndex < generatedClassKeys.length; classIndex += 1) {
    for (let i = 0; i + 1 < orderedProbes.length; i += 1) {
      const currentProbe = orderedProbes[i];
      const nextProbe = orderedProbes[i + 1];
      // Adjacency is defined ONLY by the exact single-step lattice condition.
      const adjacent =
        Math.abs(nextProbe - currentProbe - topology.stepDeg) <=
        8 * Number.EPSILON;
      if (!adjacent) continue;

      const earlier = nodesByCell[classIndex][i];
      const later = nodesByCell[classIndex][i + 1];

      // Conservative near-coincident guard: a near-coincident sibling pair on
      // EITHER side of the face suppresses every association across the face.
      if (
        hasNearCoincidentSiblingPair(earlier) ||
        hasNearCoincidentSiblingPair(later)
      ) {
        for (const node of earlier) {
          annotations.push({
            fromId: node.id,
            toId: null,
            state: "near_coincident_unresolved",
            seq: (seq += 1) - 1,
          });
        }
        for (const node of later) {
          annotations.push({
            fromId: node.id,
            toId: null,
            state: "near_coincident_unresolved",
            seq: (seq += 1) - 1,
          });
        }
        continue;
      }

      // Symmetric mutual-unambiguous matching. Preferences are computed for
      // both sides before any association is asserted.
      const earlierCandidates = new Map<number, Candidate[]>();
      const laterCandidates = new Map<number, Candidate[]>();
      const earlierPreferred = new Map<number, number | null>();
      const laterPreferred = new Map<number, number | null>();

      for (const node of earlier) {
        const cands = candidatesFor(node, later);
        earlierCandidates.set(node.id, cands);
        earlierPreferred.set(
          node.id,
          preferredCandidateId(
            cands,
            policy.tieMarginNormalizedCameraPosition,
            policy.tieMarginRotationDeg
          )
        );
      }
      for (const node of later) {
        const cands = candidatesFor(node, earlier);
        laterCandidates.set(node.id, cands);
        laterPreferred.set(
          node.id,
          preferredCandidateId(
            cands,
            policy.tieMarginNormalizedCameraPosition,
            policy.tieMarginRotationDeg
          )
        );
      }

      for (const node of earlier) {
        const cands = earlierCandidates.get(node.id) ?? [];
        if (cands.length === 0) {
          annotations.push({
            fromId: node.id,
            toId: null,
            state: "unmatched_terminated",
            seq: (seq += 1) - 1,
          });
          continue;
        }
        const preferred = earlierPreferred.get(node.id) ?? null;
        if (preferred !== null && laterPreferred.get(preferred) === node.id) {
          annotations.push({
            fromId: node.id,
            toId: preferred,
            state: "associated",
            seq: (seq += 1) - 1,
          });
          unionNodes(parent, node.id, preferred);
        } else {
          annotations.push({
            fromId: node.id,
            toId: null,
            state: "tied_ambiguous",
            seq: (seq += 1) - 1,
          });
        }
      }

      for (const node of later) {
        const cands = laterCandidates.get(node.id) ?? [];
        if (cands.length === 0) {
          annotations.push({
            fromId: node.id,
            toId: null,
            state: "unmatched_born",
            seq: (seq += 1) - 1,
          });
          continue;
        }
        const preferred = laterPreferred.get(node.id) ?? null;
        if (preferred !== null && earlierPreferred.get(preferred) === node.id) {
          // The mutually unambiguous pair's single annotation is owned by the
          // earlier root; the later root records nothing here.
          continue;
        }
        annotations.push({
          fromId: node.id,
          toId: null,
          state: "tied_ambiguous",
          seq: (seq += 1) - 1,
        });
      }
    }
  }

  // Group nodes into connected components.
  const componentNodeIds = new Map<number, number[]>();
  for (const node of nodes) {
    const root = findRoot(parent, node.id);
    const bucket = componentNodeIds.get(root);
    if (bucket) bucket.push(node.id);
    else componentNodeIds.set(root, [node.id]);
  }

  // Order components by their minimum global ordinal, then assign a stable
  // branchIndex enumeration (never a preference).
  const components = [...componentNodeIds.values()].map((ids) =>
    ids.slice().sort((a, b) => a - b)
  );
  components.sort((a, b) => a[0] - b[0]);

  const corridors: TypeBBranchFovCorridor[] = components.map(
    (nodeIds, branchIndex) => {
      const memberSet = new Set(nodeIds);
      const references: TypeBBranchPoseProbeRootReference[] = nodeIds.map(
        (id) => ({
          poseProbeEquivalenceKey: nodes[id].reference.poseProbeEquivalenceKey,
          fovProbeDeg: nodes[id].reference.fovProbeDeg,
          hypothesisIndex: nodes[id].reference.hypothesisIndex,
        })
      );
      const ownedAnnotations = annotations
        .filter((annotation) => memberSet.has(annotation.fromId))
        .sort((a, b) => a.fromId - b.fromId || a.seq - b.seq);
      const associationAnnotations: TypeBBranchAssociationAnnotation[] =
        ownedAnnotations.map((annotation) => ({
          from: {
            poseProbeEquivalenceKey:
              nodes[annotation.fromId].reference.poseProbeEquivalenceKey,
            fovProbeDeg: nodes[annotation.fromId].reference.fovProbeDeg,
            hypothesisIndex: nodes[annotation.fromId].reference.hypothesisIndex,
          },
          to:
            annotation.toId === null
              ? null
              : {
                  poseProbeEquivalenceKey:
                    nodes[annotation.toId].reference.poseProbeEquivalenceKey,
                  fovProbeDeg: nodes[annotation.toId].reference.fovProbeDeg,
                  hypothesisIndex:
                    nodes[annotation.toId].reference.hypothesisIndex,
                },
          state: annotation.state,
        }));
      return {
        schema: TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
        branchIndex,
        poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
        poseProbeRootReferences: references,
        associationAnnotations,
      };
    }
  );

  return corridors;
}

// --- 13. Result builders ----------------------------------------------------

function makeResult(
  status: TypeBBranchAssociationStatus,
  policy: TypeBBranchAssociationPolicy | null,
  diagnosticRun: TypeBP3pDiagnosticRunRecord,
  notAssessedReasons: readonly TypeBBranchAssociationNotAssessedReason[]
): TypeBBranchAssociationResult {
  return {
    schema: TYPE_B_BRANCH_ASSOCIATION_SCHEMA,
    status,
    policy,
    diagnosticRun,
    notAssessedReasons,
  };
}

// --- 14. Main pure association function -------------------------------------

// Pure, deterministic downstream branch association. Consumes one frozen
// snapshot, one B3D-1 diagnostic run, one explicit FOV topology declaration,
// and one explicit association policy; returns a result wrapper. It never
// mutates inputs, never reads live state, never throws for malformed runtime
// input, invokes NO solver, and ranks / selects / filters / recommends
// NOTHING. Every surviving B3D-1 root remains visible in exactly one corridor.
export function associateTypeBP3pBranchesAndBuildCorridors(
  snapshot: TypeBEvidenceSnapshot,
  diagnosticRun: TypeBP3pDiagnosticRunRecord,
  topology: TypeBFovProbeTopologyDeclaration,
  policy: TypeBBranchAssociationPolicy
): TypeBBranchAssociationResult {
  try {
    // 1. Upstream run status. A non-associable run is preserved verbatim.
    if (!isUpstreamAssociable(diagnosticRun)) {
      return makeResult(
        "not_assessed",
        null,
        safeClone(diagnosticRun),
        ["upstream_diagnostic_run_not_associable"]
      );
    }

    // 2. Snapshot / run linkage. A malformed link is one atomic run refusal.
    if (!isLinkageValid(snapshot, diagnosticRun)) {
      const derived = safeClone(diagnosticRun);
      const baseReasons = Array.isArray(derived.refusalReasons)
        ? derived.refusalReasons
        : [];
      return makeResult(
        "not_assessed",
        null,
        {
          ...derived,
          branchCorridors: [],
          fovTopology: null,
          refusalReasons: [...baseReasons, "invalid_tuple_generation_linkage"],
        },
        ["invalid_diagnostic_run_linkage"]
      );
    }

    // 3. Explicit association policy. A policy error is local and never a
    //    topology refusal.
    if (!isPolicyValid(policy)) {
      const derived = safeClone(diagnosticRun);
      return makeResult(
        "not_assessed",
        null,
        { ...derived, branchCorridors: [], fovTopology: null },
        ["invalid_branch_association_policy"]
      );
    }

    // 4. Explicit FOV topology. Validated only after upstream/linkage/policy.
    const coverageFovProbesDeg = Array.isArray(
      diagnosticRun.tupleGeneration.coverage?.fovProbesDeg
    )
      ? diagnosticRun.tupleGeneration.coverage.fovProbesDeg
      : [];
    if (!isTopologyValid(topology, coverageFovProbesDeg)) {
      const derived = safeClone(diagnosticRun);
      const baseReasons = Array.isArray(derived.refusalReasons)
        ? derived.refusalReasons
        : [];
      return makeResult(
        "not_assessed",
        safeClone(policy),
        {
          ...derived,
          branchCorridors: [],
          fovTopology: null,
          refusalReasons: [...baseReasons, "fov_topology_unresolved"],
        },
        ["fov_topology_unresolved"]
      );
    }

    // 5. Success: build branch corridors over the validated lattice.
    const worldWidth = snapshot.floorAssumptions.worldWidth;
    const corridors = buildBranchCorridors(
      diagnosticRun,
      topology,
      policy,
      worldWidth
    );

    const derived = safeClone(diagnosticRun);
    return makeResult(
      "associated",
      safeClone(policy),
      {
        ...derived,
        branchCorridors: corridors,
        fovTopology: safeClone(topology),
      },
      []
    );
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return makeResult(
      "not_assessed",
      null,
      safeClone(diagnosticRun),
      ["upstream_diagnostic_run_not_associable"]
    );
  }
}
