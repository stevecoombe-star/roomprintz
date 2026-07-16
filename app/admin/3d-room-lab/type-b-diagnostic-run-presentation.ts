// --- Phase B3E: Read-Only Type B Diagnostic Run Presentation ----------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A pure, React-free projection layer
// that turns a committed Type B capture result plus an assembled diagnostic-run
// envelope into safe, literal, display-ready rows.
//
// It DERIVES NOTHING. It ranks, scores, prefers, chooses, or advises NOTHING.
// It never surfaces a pose, translation, rotation, world point, projected
// point, source-pixel, frame-intersection, near-corner, camera-space depth,
// branch preference, numeric ordering signal, or any authority state. Every
// value it emits is copied verbatim from an already-committed pure record.
//
// It emits ONLY literal facts: statuses, refusal / non-assessment literals,
// fingerprints, timestamps, basis identity, authored coverage, equivalence
// keys, enumeration indices, observation labels/states, coordinate-free
// compatibility states, and topology/policy values authored by the operator.
//
// It has NO React, browser, Three.js, Type A, solver, geometry, calibration,
// persistence, API, or routing dependency. Its only imports are `import type`
// aliases of the committed Type B capture and diagnostic-run-assembly result
// contracts. Its ONLY runtime export is `presentTypeBDiagnosticRun`.

import type { TypeBCaptureResult } from "./type-b-capture-contract";
import type { TypeBDiagnosticRunAssemblyResult } from "./type-b-diagnostic-run-assembly";

// --- 1. Input ---------------------------------------------------------------

// The two raw records this projection reads. Either may be absent (a diagnostic
// envelope only ever exists alongside a captured result in the lab UI, but the
// projection tolerates any nullable combination without throwing).
export type TypeBDiagnosticRunPresentationInput = {
  readonly capture: TypeBCaptureResult | null;
  readonly envelope: TypeBDiagnosticRunAssemblyResult | null;
};

// --- 2. Capture section -----------------------------------------------------

export type TypeBCaptureBasisPresentation = {
  readonly sourceImageIdentity: string;
  readonly sourceFrameKey: string;
  readonly sourceFrameWidth: number;
  readonly sourceFrameHeight: number;
  readonly candidateIdentity: string | null;
  readonly floorPolygonKey: string | null;
};

export type TypeBCaptureProductClassPresentation = {
  readonly primaryProductClassIdentity: string;
  readonly latentDepthProductFormulaId: string;
  readonly latentDepthProductValue: number;
};

// B3F-O: explicit handoff provenance projected verbatim from the successful
// capture wrapper. It states whether the effective exhausted context was a
// genuine Type A handoff or a lab-only Type B test override. `overrideSchema`
// is present ONLY for the lab-override kind. The UI can render a fixed warning
// from `labTestOverrideActive === true`. It carries NO pose, root, branch,
// scoring, ranking, confidence, selection, or calibration data.
export type TypeBCaptureHandoffProvenancePresentation = {
  readonly kind: string;
  readonly actualTypeAContext: string;
  readonly effectiveTypeAContext: string;
  readonly labTestOverrideActive: boolean;
  readonly overrideSchema: string | null;
};

// Discriminated so a refusal presentation STRUCTURALLY cannot carry any
// snapshot / coverage fact (no fingerprint, basis, world width, aspects,
// classes, probes, or timestamp), and a captured presentation always carries
// its verbatim facts with an empty refusal list.
export type TypeBCapturePresentation =
  | {
      readonly status: "refused";
      readonly refusalLiterals: readonly string[];
    }
  | {
      readonly status: "captured";
      readonly refusalLiterals: readonly [];
      readonly evidenceFingerprint: string;
      readonly coverageFingerprint: string;
      readonly capturedAtIso: string;
      readonly basis: TypeBCaptureBasisPresentation;
      readonly worldWidth: number;
      readonly authorizedAspectRatios: readonly number[];
      readonly productClasses: readonly TypeBCaptureProductClassPresentation[];
      readonly fovProbesDeg: readonly number[];
      readonly typeAHandoffProvenance: TypeBCaptureHandoffProvenancePresentation;
    };

// --- 3. Run manifest --------------------------------------------------------

export type TypeBRunManifestPresentation = {
  readonly assemblySchema: string;
  readonly diagnosticSchema: string;
  readonly evidenceFamily: string | null;
  readonly evaluatorFamily: string | null;
  readonly tupleGenerationStatus: string;
  readonly tupleGenerationRefusalLiterals: readonly string[];
  readonly associationRequested: boolean;
  readonly runRefusalLiterals: readonly string[];
  // B3F-O: echoed verbatim from the capture provenance. The UI can render a
  // fixed lab-override warning from `labTestOverrideActive === true`.
  readonly labTestOverrideActive: boolean;
  readonly actualTypeAContext: string | null;
  readonly effectiveTypeAContext: string | null;
  readonly handoffKind: string | null;
};

// --- 4. Tuple classes -------------------------------------------------------

export type TypeBTupleMemberPresentation = {
  readonly memberAspectRatio: number;
  readonly memberLatentSideExtent: number;
  readonly probeListDeg: readonly number[];
};

export type TypeBTupleClassPresentation = {
  readonly primaryProductClassIdentity: string;
  readonly productEquivalenceKey: string | null;
  readonly primaryLatentDepthProduct: number | null;
  readonly status: string;
  readonly refusalLiterals: readonly string[];
  readonly members: readonly TypeBTupleMemberPresentation[];
};

// --- 5. P3P probe outcomes --------------------------------------------------

export type TypeBP3pConstructionObservationPresentation = {
  readonly label: string;
  readonly state: string;
  readonly residual: number | null;
};

export type TypeBP3pPlausibilityObservationPresentation = {
  readonly label: string;
  readonly state: string;
};

export type TypeBP3pRootCensusPresentation = {
  readonly algebraicCandidateCount: number;
  readonly realRootCount: number;
  readonly positiveDistanceRootCount: number;
  readonly deduplicatedRootCount: number;
};

export type TypeBP3pHypothesisPresentation = {
  readonly hypothesisIndex: number;
  readonly constructionObservations: readonly TypeBP3pConstructionObservationPresentation[];
  readonly plausibilityObservations: readonly TypeBP3pPlausibilityObservationPresentation[];
};

export type TypeBP3pProbePresentation = {
  readonly productEquivalenceKey: string;
  readonly latentDepthProductValue: number | null;
  readonly fovProbeDeg: number;
  readonly poseStageKind: string;
  readonly stageRefusalLiterals: readonly string[];
  readonly rootCensus: TypeBP3pRootCensusPresentation | null;
  readonly hypotheses: readonly TypeBP3pHypothesisPresentation[];
};

// --- 6. Branch corridors (only when association was requested) --------------

export type TypeBBranchTopologyPresentation = {
  readonly orderedProbesDeg: readonly number[];
  readonly stepDeg: number;
};

export type TypeBBranchPolicyPresentation = {
  readonly maxNormalizedCameraPositionDelta: number;
  readonly maxRotationDeltaDeg: number;
  readonly tieMarginNormalizedCameraPosition: number;
  readonly tieMarginRotationDeg: number;
  readonly nearCoincidentNormalizedCameraPositionDelta: number;
  readonly nearCoincidentRotationDeltaDeg: number;
};

export type TypeBBranchRootReferencePresentation = {
  readonly poseProbeEquivalenceKey: string;
  readonly fovProbeDeg: number;
  readonly hypothesisIndex: number;
};

export type TypeBBranchAnnotationPresentation = {
  readonly fromReference: TypeBBranchRootReferencePresentation;
  readonly toReference: TypeBBranchRootReferencePresentation | null;
  readonly state: string;
};

export type TypeBBranchPresentation = {
  readonly branchIndex: number;
  // Fixed literal label. `branchIndex` is a stable enumeration ordinal only.
  readonly branchIndexLabel: "Enumeration only";
  readonly rootReferences: readonly TypeBBranchRootReferencePresentation[];
  readonly annotations: readonly TypeBBranchAnnotationPresentation[];
};

export type TypeBBranchCorridorsPresentation = {
  readonly status: string;
  readonly topology: TypeBBranchTopologyPresentation | null;
  readonly policy: TypeBBranchPolicyPresentation | null;
  readonly notAssessedLiterals: readonly string[];
  readonly branches: readonly TypeBBranchPresentation[];
};

// --- 7. Frame-truncation compatibility --------------------------------------

export type TypeBFrameTruncationRecordPresentation = {
  readonly primaryProductClassIdentity: string;
  readonly floorAspectRatio: number;
  readonly latentSideExtent: number;
  readonly poseProbeEquivalenceKey: string;
  readonly hypothesisIndex: number;
  readonly cropCompatibility: string;
};

export type TypeBFrameTruncationPresentation = {
  readonly status: string;
  readonly notAssessedLiterals: readonly string[];
  readonly records: readonly TypeBFrameTruncationRecordPresentation[];
};

// --- 8. Top-level presentation ----------------------------------------------

export type TypeBDiagnosticRunPresentation = {
  readonly capture: TypeBCapturePresentation | null;
  readonly runManifest: TypeBRunManifestPresentation | null;
  readonly tupleClasses: readonly TypeBTupleClassPresentation[];
  readonly poseProbeOutcomes: readonly TypeBP3pProbePresentation[];
  // Null unless the assembled envelope requested branch association.
  readonly branchCorridors: TypeBBranchCorridorsPresentation | null;
  readonly frameTruncation: TypeBFrameTruncationPresentation | null;
};

// --- 9. Pure, defensive read helpers ----------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Best-effort record accessor for defensive (never-throwing) reads. A non-object
// becomes an empty record so nested field access stays safe and deterministic.
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

// Copies a list of literal string reasons verbatim, dropping nothing and
// reinterpreting nothing. A non-array yields an empty list.
function copyStringLiterals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

// Copies a numeric list verbatim, preserving exact authored order (including
// any non-finite value). A non-array yields an empty list.
function copyNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => entry as number);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// --- 10. Capture projection -------------------------------------------------

function presentCapture(
  capture: TypeBCaptureResult | null
): TypeBCapturePresentation | null {
  if (!isRecord(capture)) return null;

  if (capture.status !== "captured") {
    // Refusal (or any non-captured status): literal refusal facts ONLY. No
    // snapshot / coverage field is projected.
    return {
      status: "refused",
      refusalLiterals: copyStringLiterals(capture.refusalReasons),
    };
  }

  const snapshot = asRecord(capture.snapshot);
  const coverage = asRecord(capture.coverage);
  const identity = asRecord(capture.identity);
  const basis = asRecord(snapshot.basis);
  const sourceFrame = asRecord(basis.sourceFrame);
  const floorAssumptions = asRecord(snapshot.floorAssumptions);
  const provenance = asRecord(capture.typeAHandoffProvenance);

  const productClasses: TypeBCaptureProductClassPresentation[] = asArray(
    coverage.primaryProductClasses
  ).map((entry) => {
    const e = asRecord(entry);
    const product = asRecord(e.latentDepthProduct);
    return {
      primaryProductClassIdentity: String(e.primaryProductClassIdentity),
      latentDepthProductFormulaId: String(product.formulaId),
      latentDepthProductValue: product.value as number,
    };
  });

  return {
    status: "captured",
    refusalLiterals: [],
    evidenceFingerprint: String(identity.evidenceFingerprint),
    coverageFingerprint: String(identity.coverageFingerprint),
    capturedAtIso: String(snapshot.capturedAtIso),
    basis: {
      sourceImageIdentity: String(basis.sourceImageIdentity),
      sourceFrameKey: String(basis.sourceFrameKey),
      sourceFrameWidth: sourceFrame.width as number,
      sourceFrameHeight: sourceFrame.height as number,
      candidateIdentity: asString(basis.candidateIdentity),
      floorPolygonKey: asString(basis.floorPolygonKey),
    },
    worldWidth: floorAssumptions.worldWidth as number,
    authorizedAspectRatios: copyNumberList(
      floorAssumptions.authorizedAspectRatios
    ),
    productClasses,
    fovProbesDeg: copyNumberList(coverage.fovProbesDeg),
    typeAHandoffProvenance: {
      kind: String(provenance.kind),
      actualTypeAContext: String(provenance.actualTypeAContext),
      effectiveTypeAContext: String(provenance.effectiveTypeAContext),
      labTestOverrideActive: provenance.labTestOverrideActive === true,
      overrideSchema: asString(provenance.overrideSchema),
    },
  };
}

// --- 11. Run manifest projection --------------------------------------------

function presentRunManifest(
  capture: TypeBCaptureResult | null,
  envelope: TypeBDiagnosticRunAssemblyResult
): TypeBRunManifestPresentation {
  const envelopeRecord = asRecord(envelope);
  const diagnosticRun = asRecord(envelopeRecord.diagnosticRun);
  const tupleGeneration = asRecord(diagnosticRun.tupleGeneration);

  // Evidence / evaluator family are literal facts of the captured snapshot the
  // run was assembled from; they are read from the capture record, never
  // derived.
  let evidenceFamily: string | null = null;
  let evaluatorFamily: string | null = null;
  // B3F-O: handoff provenance echoed verbatim from the capture wrapper (never
  // derived). Defaults describe "no captured provenance" (override inactive).
  let labTestOverrideActive = false;
  let actualTypeAContext: string | null = null;
  let effectiveTypeAContext: string | null = null;
  let handoffKind: string | null = null;
  if (isRecord(capture) && capture.status === "captured") {
    const snapshot = asRecord(capture.snapshot);
    evidenceFamily = asString(snapshot.evidenceFamily);
    evaluatorFamily = asString(snapshot.evaluatorFamily);
    const provenance = asRecord(capture.typeAHandoffProvenance);
    labTestOverrideActive = provenance.labTestOverrideActive === true;
    actualTypeAContext = asString(provenance.actualTypeAContext);
    effectiveTypeAContext = asString(provenance.effectiveTypeAContext);
    handoffKind = asString(provenance.kind);
  }

  return {
    assemblySchema: String(envelopeRecord.schema),
    diagnosticSchema: String(diagnosticRun.schema),
    evidenceFamily,
    evaluatorFamily,
    tupleGenerationStatus: String(tupleGeneration.status),
    tupleGenerationRefusalLiterals: copyStringLiterals(
      tupleGeneration.refusalReasons
    ),
    associationRequested: envelopeRecord.branchAssociation != null,
    runRefusalLiterals: copyStringLiterals(diagnosticRun.refusalReasons),
    labTestOverrideActive,
    actualTypeAContext,
    effectiveTypeAContext,
    handoffKind,
  };
}

// --- 12. Tuple-class projection ---------------------------------------------

function presentTupleClasses(
  envelope: TypeBDiagnosticRunAssemblyResult
): TypeBTupleClassPresentation[] {
  const diagnosticRun = asRecord(asRecord(envelope).diagnosticRun);
  const tupleGeneration = asRecord(diagnosticRun.tupleGeneration);
  const productClasses = asArray(tupleGeneration.productClasses);

  return productClasses.map((entry) => {
    const cls = asRecord(entry);
    const equivalence = isRecord(cls.latentDepthEquivalence)
      ? cls.latentDepthEquivalence
      : null;
    const product =
      equivalence && isRecord(equivalence.latentDepthProduct)
        ? equivalence.latentDepthProduct
        : null;

    const members: TypeBTupleMemberPresentation[] = asArray(cls.members).map(
      (memberEntry) => {
        const member = asRecord(memberEntry);
        const probeListDeg = asArray(member.tuples).map((tupleEntry) => {
          const tuple = asRecord(asRecord(tupleEntry).tuple);
          return tuple.fovProbeDeg as number;
        });
        return {
          memberAspectRatio: member.floorAspectRatio as number,
          memberLatentSideExtent: member.latentSideExtent as number,
          probeListDeg,
        };
      }
    );

    return {
      primaryProductClassIdentity: String(cls.primaryProductClassIdentity),
      productEquivalenceKey: equivalence
        ? asString(equivalence.equivalenceClassKey)
        : null,
      primaryLatentDepthProduct: product ? asNumber(product.value) : null,
      status: String(cls.status),
      refusalLiterals: copyStringLiterals(cls.refusalReasons),
      members,
    };
  });
}

// --- 13. P3P probe-outcome projection ---------------------------------------

function presentPoseProbeOutcomes(
  envelope: TypeBDiagnosticRunAssemblyResult
): TypeBP3pProbePresentation[] {
  const diagnosticRun = asRecord(asRecord(envelope).diagnosticRun);
  const poseProbeResults = asArray(diagnosticRun.poseProbeResults);

  return poseProbeResults.map((entry) => {
    const record = asRecord(entry);
    const poseProbeEquivalence = asRecord(record.poseProbeEquivalence);
    const latentDepthProduct = isRecord(record.latentDepthProduct)
      ? record.latentDepthProduct
      : null;
    const poseStageResult = asRecord(record.poseStageResult);
    const census = isRecord(record.rootCensus) ? record.rootCensus : null;

    const poseStageKind = String(poseStageResult.kind);
    const stageRefusalLiterals =
      poseStageResult.kind === "refusal" && poseStageResult.reason != null
        ? [String(poseStageResult.reason)]
        : [];

    const hypothesisEntries =
      poseStageResult.kind === "pose_hypotheses"
        ? asArray(poseStageResult.hypotheses)
        : [];
    const hypotheses: TypeBP3pHypothesisPresentation[] = hypothesisEntries.map(
      (hypothesisEntry) => {
        const hypothesis = asRecord(hypothesisEntry);
        const constructionObservations: TypeBP3pConstructionObservationPresentation[] =
          asArray(hypothesis.constructionObservations).map((obsEntry) => {
            const obs = asRecord(obsEntry);
            return {
              label: String(obs.kind),
              state: String(obs.interpretation),
              residual: asNumber(obs.residualPx),
            };
          });
        const plausibilityObservations: TypeBP3pPlausibilityObservationPresentation[] =
          asArray(hypothesis.plausibility).map((obsEntry) => {
            const obs = asRecord(obsEntry);
            return {
              label: String(obs.checkId),
              state: String(obs.state),
            };
          });
        return {
          hypothesisIndex: hypothesis.hypothesisIndex as number,
          constructionObservations,
          plausibilityObservations,
        };
      }
    );

    return {
      productEquivalenceKey: String(
        poseProbeEquivalence.latentDepthEquivalenceClassKey
      ),
      latentDepthProductValue: latentDepthProduct
        ? asNumber(latentDepthProduct.value)
        : null,
      fovProbeDeg: poseProbeEquivalence.fovProbeDeg as number,
      poseStageKind,
      stageRefusalLiterals,
      rootCensus: census
        ? {
            algebraicCandidateCount: census.algebraicCandidateCount as number,
            realRootCount: census.realRootCount as number,
            positiveDistanceRootCount:
              census.positiveDistanceRootCount as number,
            deduplicatedRootCount: census.deduplicatedRootCount as number,
          }
        : null,
      hypotheses,
    };
  });
}

// --- 14. Branch-corridor projection (only when requested) -------------------

function presentRootReference(
  value: unknown
): TypeBBranchRootReferencePresentation {
  const ref = asRecord(value);
  return {
    poseProbeEquivalenceKey: String(ref.poseProbeEquivalenceKey),
    fovProbeDeg: ref.fovProbeDeg as number,
    hypothesisIndex: ref.hypothesisIndex as number,
  };
}

function presentBranchCorridors(
  envelope: TypeBDiagnosticRunAssemblyResult
): TypeBBranchCorridorsPresentation | null {
  const branchAssociation = asRecord(envelope).branchAssociation;
  // Not requested: NO branch-corridor section at all.
  if (branchAssociation == null) return null;

  const assoc = asRecord(branchAssociation);
  const diagnosticRun = asRecord(assoc.diagnosticRun);
  const fovTopology = isRecord(diagnosticRun.fovTopology)
    ? diagnosticRun.fovTopology
    : null;
  const policy = isRecord(assoc.policy) ? assoc.policy : null;
  const branchCorridors = asArray(diagnosticRun.branchCorridors);

  const branches: TypeBBranchPresentation[] = branchCorridors.map((entry) => {
    const corridor = asRecord(entry);
    const rootReferences = asArray(corridor.poseProbeRootReferences).map(
      presentRootReference
    );
    const annotations: TypeBBranchAnnotationPresentation[] = asArray(
      corridor.associationAnnotations
    ).map((annotationEntry) => {
      const annotation = asRecord(annotationEntry);
      return {
        fromReference: presentRootReference(annotation.from),
        toReference:
          annotation.to == null ? null : presentRootReference(annotation.to),
        state: String(annotation.state),
      };
    });
    return {
      branchIndex: corridor.branchIndex as number,
      branchIndexLabel: "Enumeration only",
      rootReferences,
      annotations,
    };
  });

  return {
    status: String(assoc.status),
    topology: fovTopology
      ? {
          orderedProbesDeg: copyNumberList(fovTopology.orderedProbesDeg),
          stepDeg: fovTopology.stepDeg as number,
        }
      : null,
    policy: policy
      ? {
          maxNormalizedCameraPositionDelta:
            policy.maxNormalizedCameraPositionDelta as number,
          maxRotationDeltaDeg: policy.maxRotationDeltaDeg as number,
          tieMarginNormalizedCameraPosition:
            policy.tieMarginNormalizedCameraPosition as number,
          tieMarginRotationDeg: policy.tieMarginRotationDeg as number,
          nearCoincidentNormalizedCameraPositionDelta:
            policy.nearCoincidentNormalizedCameraPositionDelta as number,
          nearCoincidentRotationDeltaDeg:
            policy.nearCoincidentRotationDeltaDeg as number,
        }
      : null,
    notAssessedLiterals: copyStringLiterals(assoc.notAssessedReasons),
    branches,
  };
}

// --- 15. Frame-truncation projection ----------------------------------------

function presentFrameTruncation(
  envelope: TypeBDiagnosticRunAssemblyResult
): TypeBFrameTruncationPresentation | null {
  const raw = asRecord(envelope).frameTruncationCompatibility;
  if (!isRecord(raw)) return null;
  const frameTruncation = raw;

  const records: TypeBFrameTruncationRecordPresentation[] = asArray(
    frameTruncation.records
  ).map((entry) => {
    const record = asRecord(entry);
    return {
      primaryProductClassIdentity: String(record.primaryProductClassIdentity),
      floorAspectRatio: record.floorAspectRatio as number,
      latentSideExtent: record.latentSideExtent as number,
      poseProbeEquivalenceKey: String(record.poseProbeEquivalenceKey),
      hypothesisIndex: record.hypothesisIndex as number,
      cropCompatibility: String(record.cropCompatibility),
    };
  });

  return {
    status: String(frameTruncation.status),
    notAssessedLiterals: copyStringLiterals(frameTruncation.notAssessedReasons),
    records,
  };
}

// --- 16. Main projection ----------------------------------------------------

/**
 * Pure, deterministic, non-mutating projection of a Type B capture result plus
 * an assembled diagnostic-run envelope into safe, literal, read-only display
 * rows. It NEVER throws for malformed runtime input, NEVER mutates its inputs,
 * and returns deeply-equal output for equal input. It exposes ONLY literal
 * facts and never a pose coordinate, rotation, translation, world/projected
 * point, source-pixel, frame-intersection, near-corner, depth, branch score,
 * confidence, rank, selection, preference, recommendation, preview, load,
 * Apply, or calibration value.
 */
export function presentTypeBDiagnosticRun(
  input: TypeBDiagnosticRunPresentationInput
): TypeBDiagnosticRunPresentation {
  try {
    const source = asRecord(input);
    const capture = (source.capture ?? null) as TypeBCaptureResult | null;
    const envelope = (source.envelope ??
      null) as TypeBDiagnosticRunAssemblyResult | null;

    const capturePresentation = presentCapture(capture);

    if (!isRecord(envelope)) {
      return {
        capture: capturePresentation,
        runManifest: null,
        tupleClasses: [],
        poseProbeOutcomes: [],
        branchCorridors: null,
        frameTruncation: null,
      };
    }

    return {
      capture: capturePresentation,
      runManifest: presentRunManifest(capture, envelope),
      tupleClasses: presentTupleClasses(envelope),
      poseProbeOutcomes: presentPoseProbeOutcomes(envelope),
      branchCorridors: presentBranchCorridors(envelope),
      frameTruncation: presentFrameTruncation(envelope),
    };
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return {
      capture: null,
      runManifest: null,
      tupleClasses: [],
      poseProbeOutcomes: [],
      branchCorridors: null,
      frameTruncation: null,
    };
  }
}
