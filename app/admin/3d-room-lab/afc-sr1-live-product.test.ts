import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  executeAfcSr1CompleteProductAttempt,
  getAfcSr1LiveAttemptEvidence,
  type AfcSr1LiveProductDependencies,
} from "./afc-sr1-live-product";
import {
  AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
  classifyAfcSr1SupportedRoomView,
} from "./afc-sr1-supported-room-view";
import type { AfcSr1LiveAnalyzeRequest } from "./afc-sr1-live-product-contract";
import type { AfcSr1RawFirstPlacementAwareOrchestrationResultV1 } from "./research/afc-sr1-raw-first-placement-aware-orchestration";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

const originalSha = "a".repeat(64);
const emptySha = "b".repeat(64);
const roomC = [
  { x: 0.045, y: 1 },
  { x: 1, y: 0.82 },
  { x: 0.415, y: 0.616 },
  { x: 0.077, y: 0.694 },
] as const satisfies AfcSr1SourcePolygon;
const roomA = [
  { x: 0.10837393593189963, y: 0.9249876495993743 },
  { x: 1, y: 0.93 },
  { x: 0.688, y: 0.648 },
  { x: 0.356, y: 0.648 },
] as const satisfies AfcSr1SourcePolygon;
const productSource = readFileSync(
  new URL("./afc-sr1-live-product.ts", import.meta.url),
  "utf8"
);

function request(attemptId: string): AfcSr1LiveAnalyzeRequest {
  return {
    attemptId,
    sourceImageUrl: "https://images.unsplash.com/room.jpg",
    sourceImageIdentity: {
      sha256: originalSha,
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    labLoadGeneration: 7,
    referenceDepthM: 5.25,
  };
}

function pathResult(input: {
  mode: "raw-direct" | "tiled-placement" | "rejected";
  finalReason?: "placement_rejected";
  seamT?: number;
  placementReason?: string;
  validationP90Px?: number;
}): AfcSr1RawFirstPlacementAwareOrchestrationResultV1 {
  const tiled = input.mode === "tiled-placement";
  const rejected = input.mode === "rejected";
  return {
    schemaVersion: "afc-sr1-raw-first-placement-aware-orchestration/v1",
    policyVersion: "afc-sr1-raw-first-placement-aware-orchestration-policy/v1",
    parentImageIdentity: {
      sha256: emptySha,
      byteCount: 3,
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    semanticPolygonIdentity: {
      schemaVersion: "afc-sr1-basis-bound-source-polygon/v1",
      polygonFingerprint: "c".repeat(64),
      evidenceDigest: "d".repeat(64),
      basisFingerprint: emptySha,
    },
    truncatedAnchor: "NL",
    anchorAuthority: {
      kind: "supported_domain_near_side_derived",
      truncatedAnchor: "NL",
      evidenceReference: "test",
    },
    rawAttempt: {
      receipt: null,
      commonBasisHandoff: null,
      projective: input.mode === "raw-direct"
        ? { status: "usable", reason: null, seamT: input.seamT ?? 0.2 }
        : null,
      fallbackEligibilityClass:
        input.mode === "raw-direct"
          ? "success"
          : "evidence_rejected_fallback_eligible",
    },
    fallbackAttempt: tiled || rejected
      ? {
          lineage: { status: "validated", evidenceDigest: "e".repeat(64) },
          childImageIdentity: {
            sha256: "f".repeat(64),
            byteCount: 4,
            decodedWidth: 1200,
            decodedHeight: 800,
            mimeType: "image/png",
            orientation: 1,
          },
          placement: {
            evidenceDigest: "1".repeat(64),
            status: rejected ? "rejected" : "usable",
            reason: rejected ? input.placementReason ?? "other" : null,
          },
          childReader: tiled
            ? { evidenceDigest: "2".repeat(64), status: "usable", reason: null }
            : null,
          placementBoundHandoff: tiled
            ? { status: "validated", evidenceDigest: "3".repeat(64), reason: null }
            : null,
          finalProjective: tiled
            ? { status: "usable", reason: null, seamT: input.seamT ?? 0.2 }
            : null,
        }
      : null,
    attemptCounts: {
      rawReader: 1,
      ts0: tiled || rejected ? 1 : 0,
      placement: tiled || rejected ? 1 : 0,
      childReader: tiled ? 1 : 0,
      placementBoundHandoff: tiled ? 1 : 0,
      tiledProjective: tiled ? 1 : 0,
    },
    mode: input.mode,
    finalReason: input.finalReason ?? null,
    evidenceCanonicalJson: "{}",
    evidenceDigest: {
      algorithm: "sha256",
      encoding: "hex",
      value: "4".repeat(64),
    },
    diagnostics: {
      excludedFromCanonicalEvidence: true,
      rawTrack1aPriorReason: null,
      fallbackTrack1aPriorReason: null,
      ts0Failure: null,
      lineageFailure: null,
      placementReason: input.placementReason ?? null,
      validationP90Px: input.validationP90Px ?? null,
    },
  };
}

function harness(input: {
  polygon?: AfcSr1SourcePolygon;
  candidates?: number;
  path?: ReturnType<typeof pathResult>;
  invokeTs0Capture?: boolean;
}) {
  const observed = {
    qualify: 0,
    empty: 0,
    gemini: 0,
    classifier: 0,
    classifierDimensions: null as { decodedWidth: number; decodedHeight: number } | null,
    pathA: 0,
    anchorEvidenceReference: null as string | null,
  };
  const candidateCount = input.candidates ?? 1;
  const polygon = input.polygon ?? roomC;
  const dependencies: AfcSr1LiveProductDependencies = {
    createResultId: () => "result-1",
    qualifyOriginal: async () => {
      observed.qualify++;
      return {
        sourceImageUrl: "https://images.unsplash.com/room.jpg",
        basis: {
          sha256: originalSha,
          byteCount: 10,
          decodedWidth: 1200,
          decodedHeight: 800,
          mimeType: "image/jpeg",
          orientation: 1,
        },
      };
    },
    resolveEmpty: async () => {
      observed.empty++;
      return {
        basis: {
          sha256: emptySha,
          byteCount: 3,
          decodedWidth: 1264,
          decodedHeight: 848,
          mimeType: "image/png",
          orientation: 1,
        },
        bytes: Uint8Array.from([1, 2, 3]),
        generated: true,
      };
    },
    resolveCanonicalFloor: async () => {
      observed.gemini++;
      return {
        status: "selected" as const,
        polygon,
        selectedCandidateId: "vision-cand-0",
        selectedCandidateIndex: 0,
        candidateCount,
        geometryScore: 0.8,
        scoreBand: "high" as const,
        model: "test-auto-floor-model",
      };
    },
    classifyRoom: (value, dimensions) => {
      observed.classifier++;
      observed.classifierDimensions = dimensions;
      return classifyAfcSr1SupportedRoomView(value, dimensions);
    },
    executePathA: async (pathInput, pathDependencies) => {
      observed.pathA++;
      observed.anchorEvidenceReference =
        pathInput.anchorAuthority.evidenceReference;
      if (input.invokeTs0Capture) {
        const childBytes = Uint8Array.from([9, 8, 7]);
        await pathDependencies?.onTs0ChildValidated?.({
          childBytes,
          identity: {
            sha256: createHash("sha256").update(childBytes).digest("hex"),
            byteCount: 3,
            decodedWidth: 1200,
            decodedHeight: 800,
            mimeType: "image/png",
            orientation: 1,
          },
          lineageEvidenceDigest: "6".repeat(64),
        });
      }
      return input.path ?? pathResult({ mode: "raw-direct" });
    },
  };
  return { dependencies, observed };
}

test("off-axis RAW-direct is one complete authoritative attempt", async () => {
  const { dependencies, observed } = harness({
    path: pathResult({ mode: "raw-direct", seamT: 0.2 }),
  });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("raw-attempt"),
    dependencies
  );
  assert.equal(result.status, "authoritative_geometry");
  if (result.status !== "authoritative_geometry") return;
  assert.equal(result.geometry.mode, "raw-direct");
  assert.equal(result.geometry.anchorAuthorityKind, "supported_domain_near_side_derived");
  assert.equal(result.geometry.fixedAnchor, "NL");
  assert.equal(result.geometry.adjustableCorner, "NR");
  assert.equal(
    result.geometry.classifierVersion,
    AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION
  );
  assert.equal(result.metric.referenceDepthM, 5.25);
  assert.equal(result.metric.metricScaleAuthority, "provisional_reference_depth");
  assert.deepEqual(observed, {
    qualify: 1,
    empty: 1,
    gemini: 1,
    classifier: 1,
    classifierDimensions: { decodedWidth: 1264, decodedHeight: 848 },
    pathA: 1,
    anchorEvidenceReference: observed.anchorEvidenceReference,
  });
  assert.match(
    observed.anchorEvidenceReference ?? "",
    /classifier=afc-sr1-supported-room-view-classifier\/v2/
  );
  assert.match(observed.anchorEvidenceReference ?? "", /leftVisibleRunPx=/);
  assert.match(observed.anchorEvidenceReference ?? "", /rightVisibleRunPx=/);
  assert.match(observed.anchorEvidenceReference ?? "", /truncationAsymmetry=/);
  assert.deepEqual(result.diagnostics.attemptCounts, {
    originalQualification: 1,
    emptyGeneration: 1,
    geminiFloorProposal: 1,
    supportedRoomClassifier: 1,
    onAxisCorrection: 0,
    pathA: 1,
    rawReader: 1,
    ts0: 0,
    placement: 0,
    childReader: 0,
  });
});

test("optional pair-independence diagnostics cannot alter live geometry or settle inputs", async () => {
  const baselinePath = pathResult({ mode: "raw-direct", seamT: 0.2 });
  const sidecarPath = structuredClone(baselinePath) as any;
  sidecarPath.diagnostics.v3ReaderDiagnostics = {
    rawReader: {
      familyPairIndependenceDiagnostics: {
        contractVersion: "afc-sr1-family-pair-independence-diagnostics/v1",
        coordinateSpace: "analysis-pixel/v1",
        authority: "none",
        role: "observation_only",
        excludedFromCanonicalEvidence: true,
        familyOrientationSummaries: [],
        pairs: [],
      },
    },
    childReader: null,
    authoritativeReaderRole: "rawReader",
  };
  const baselineHarness = harness({ path: baselinePath });
  const sidecarHarness = harness({ path: sidecarPath });
  const baseline = await executeAfcSr1CompleteProductAttempt(
    request("live-sidecar-baseline"), baselineHarness.dependencies
  );
  const withSidecar = await executeAfcSr1CompleteProductAttempt(
    request("live-sidecar-observation"), sidecarHarness.dependencies
  );

  assert.equal(withSidecar.status, baseline.status);
  assert.equal(withSidecar.status, "authoritative_geometry");
  if (withSidecar.status !== "authoritative_geometry" ||
      baseline.status !== "authoritative_geometry") return;
  assert.deepEqual(withSidecar.geometry, baseline.geometry);
  assert.deepEqual(withSidecar.metric, baseline.metric);
  assert.deepEqual(withSidecar.perspectiveAdjust, baseline.perspectiveAdjust);
  assert.deepEqual(withSidecar.diagnostics.attemptCounts, baseline.diagnostics.attemptCounts);
  assert.equal(withSidecar.diagnostics.evidenceDigest, baseline.diagnostics.evidenceDigest);
  assert.equal(
    withSidecar.diagnostics.v3ReaderDiagnostics?.rawReader?.familyPairIndependenceDiagnostics
      ?.pairs.length,
    0
  );
  assert.equal(baselineHarness.observed.pathA, 1);
  assert.equal(sidecarHarness.observed.pathA, 1);
});

test("off-axis tiled success preserves exact PATH A counts", async () => {
  const { dependencies } = harness({
    path: pathResult({ mode: "tiled-placement", seamT: 0.25 }),
  });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("tiled-attempt"),
    dependencies
  );
  assert.equal(result.status, "authoritative_geometry");
  if (result.status !== "authoritative_geometry") return;
  assert.equal(result.geometry.mode, "tiled-placement");
  assert.equal(result.diagnostics.attemptCounts.rawReader, 1);
  assert.equal(result.diagnostics.attemptCounts.ts0, 1);
  assert.equal(result.diagnostics.attemptCounts.placement, 1);
  assert.equal(result.diagnostics.attemptCounts.childReader, 1);
});

test("on-axis correction bypasses PATH A and Perspective Adjust", async () => {
  const { dependencies, observed } = harness({ polygon: roomA });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("on-axis-attempt"),
    dependencies
  );
  assert.equal(result.status, "authoritative_geometry");
  if (result.status !== "authoritative_geometry") return;
  assert.equal(result.geometry.mode, "on-axis-parallel-width");
  assert.equal(result.geometry.onAxisConstruction, "NL_fixed");
  assert.equal(result.geometry.fixedAnchor, null);
  assert.equal(result.geometry.adjustableCorner, null);
  assert.equal(result.perspectiveAdjust.supported, false);
  assert.equal(observed.pathA, 0);
  assert.equal(result.diagnostics.attemptCounts.onAxisCorrection, 1);
});

test("residual placement rejection becomes degraded evidence and retains TS0", async () => {
  const { dependencies } = harness({
    invokeTs0Capture: true,
    path: pathResult({
      mode: "rejected",
      finalReason: "placement_rejected",
      placementReason: "validation_residual_exceeds_limit",
      validationP90Px: 4.75,
    }),
  });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("residual-attempt"),
    dependencies
  );
  assert.equal(result.status, "degraded_evidence");
  if (result.status !== "degraded_evidence") return;
  assert.equal(result.geometryAuthority, "none");
  assert.equal(result.reason, "validation_residual_exceeds_limit");
  assert.equal(
    result.diagnostics.placementReason,
    "validation_residual_exceeds_limit"
  );
  assert.equal(result.diagnostics.validationP90Px, 4.75);
  assert.equal(result.diagnostics.sameAttemptTs0Retained, true);
  assert.deepEqual(
    getAfcSr1LiveAttemptEvidence("residual-attempt")?.ts0Child?.bytes,
    Uint8Array.from([9, 8, 7])
  );
});

test("multiple detector hypotheses are one call and do not block the selected Floor", async () => {
  const { dependencies, observed } = harness({ candidates: 2 });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("multi-attempt"),
    dependencies
  );
  assert.equal(result.status, "authoritative_geometry");
  assert.equal(observed.gemini, 1);
  assert.equal(observed.classifier, 1);
  assert.equal(observed.pathA, 1);
});

test("ordinary live product contains no R3C Floor provider or fallback", () => {
  assert.match(productSource, /resolveCanonicalAfcFloorFromEmpty/);
  assert.doesNotMatch(
    productSource,
    /callAfcR3cGeminiProvider|buildAfcR3cGeminiFloorProposalPrompt|parseGeminiFloorProposalResponse|gemini_multiple_hypotheses/
  );
});

test("off-frame proposal is not clamped and stops before PATH A", async () => {
  const { dependencies, observed } = harness({
    polygon: [
      { x: -0.01, y: 0.96 },
      { x: 0.95, y: 0.82 },
      { x: 0.7, y: 0.62 },
      { x: 0.25, y: 0.65 },
    ],
  });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("off-frame-attempt"),
    dependencies
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "floor_proposal_off_frame");
  assert.equal(observed.pathA, 0);
});

test("ambiguous supported-room geometry stops before PATH A", async () => {
  const { dependencies, observed } = harness({
    polygon: [
      { x: 0.08, y: 0.92 },
      { x: 0.92, y: 0.87 },
      { x: 0.7, y: 0.62 },
      { x: 0.3, y: 0.64 },
    ],
  });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("ambiguous-attempt"),
    dependencies
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "supported_room_ambiguous");
    assert.equal("geometry" in result, false);
    assert.deepEqual(result.diagnostics.supportedRoomClassifier, {
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      emptyDecodedWidth: 1264,
      emptyDecodedHeight: 848,
      semanticFloorPolygon: {
        NL: { x: 0.08, y: 0.92 },
        NR: { x: 0.92, y: 0.87 },
        FR: { x: 0.7, y: 0.62 },
        FL: { x: 0.3, y: 0.64 },
      },
      observables: result.diagnostics.supportedRoomClassifier?.observables,
      reason: "ambiguous_supported_domain",
    });
    assert.deepEqual(result.diagnostics.floorReadDiagnostic?.polygon, [
      { x: 0.08, y: 0.92 },
      { x: 0.92, y: 0.87 },
      { x: 0.7, y: 0.62 },
      { x: 0.3, y: 0.64 },
    ]);
    assert.match(
      JSON.stringify(result.diagnostics.supportedRoomClassifier),
      /afc-sr1-supported-room-view-classifier\/v2/
    );
    assert.doesNotMatch(
      JSON.stringify(result.diagnostics.supportedRoomClassifier),
      /providerEnvelope|modelOutput|bytes/i
    );
  }
  assert.equal(observed.empty, 1);
  assert.equal(observed.gemini, 1);
  assert.equal(observed.classifier, 1);
  assert.equal(observed.pathA, 0);
});

test("canonical Empty-Room Assist Floor diagnostic is retained separately from corrected geometry", async () => {
  const { dependencies, observed } = harness({
    path: pathResult({ mode: "raw-direct", seamT: 0.2 }),
  });
  const result = await executeAfcSr1CompleteProductAttempt(
    request("floor-read-authoritative"),
    dependencies
  );
  assert.equal(result.status, "authoritative_geometry");
  if (result.status !== "authoritative_geometry") return;
  const diagnostic = result.diagnostics.floorReadDiagnostic;
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.polygon, roomC);
  assert.notDeepEqual(
    diagnostic.polygon,
    result.geometry.sourceNormalizedPolygon,
    "the read-only proposal must not become the seam-corrected geometry"
  );
  assert.equal(diagnostic.detectorKind, "empty_room_assist_empty_arm");
  assert.equal(diagnostic.selectedCandidateId, "vision-cand-0");
  assert.equal(diagnostic.candidateCount, 1);
  assert.equal(diagnostic.emptyImage.kind, "attempt_bound_empty_image");
  assert.match(diagnostic.emptyImage.url, /live-attempt-empty\?attemptId=floor-read-authoritative/);
  assert.equal(diagnostic.originalPreview.kind, "current_qualified_original_preview_only");
  assert.doesNotMatch(JSON.stringify(diagnostic), /bytes|providerEnvelope|modelOutput/i);
  assert.deepEqual(observed, {
    qualify: 1,
    empty: 1,
    gemini: 1,
    classifier: 1,
    classifierDimensions: { decodedWidth: 1264, decodedHeight: 848 },
    pathA: 1,
    anchorEvidenceReference: observed.anchorEvidenceReference,
  });
});

test("downstream failures retain the accepted Floor read while Gemini insufficient evidence does not", async () => {
  const pathFailure = harness({
    path: pathResult({ mode: "rejected" }),
  });
  const failed = await executeAfcSr1CompleteProductAttempt(
    request("floor-read-path-failure"),
    pathFailure.dependencies
  );
  assert.equal(failed.status, "failed");
  if (failed.status !== "failed") return;
  assert.equal(failed.reason, "path_a_failed");
  assert.deepEqual(failed.diagnostics.floorReadDiagnostic?.polygon, roomC);
  assert.equal(pathFailure.observed.gemini, 1);
  assert.equal(pathFailure.observed.empty, 1);

  const insufficient = harness({});
  const noRead = await executeAfcSr1CompleteProductAttempt(
    request("floor-read-insufficient"),
    {
      ...insufficient.dependencies,
      resolveCanonicalFloor: async () => ({
        status: "insufficient_evidence" as const,
        reason: "test_insufficient",
        evidenceDigest: null,
      }),
    }
  );
  assert.equal(noRead.status, "failed");
  if (noRead.status !== "failed") return;
  assert.equal(noRead.reason, "gemini_insufficient_evidence");
  assert.equal(noRead.diagnostics.floorReadDiagnostic, null);
});
