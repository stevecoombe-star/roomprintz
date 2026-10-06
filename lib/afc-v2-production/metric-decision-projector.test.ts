import assert from "node:assert/strict";
import test from "node:test";

import { acceptMetricRoomPrior } from "@/app/admin/3d-room-lab-v2/metric-room-prior-acceptance";
import {
  buildMetricRoomPriorReceipt,
  parseMetricRoomPriorModelEstimate,
  type MetricRoomPriorModelEstimate,
  type MetricRoomPriorReceipt,
} from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import { buildMetricCorrespondenceSelection } from "@/app/admin/3d-room-lab-v2/metric-correspondence-span-contract";
import type { MetricCorrespondenceSpan } from "@/app/admin/3d-room-lab-v2/metric-correspondence-span-contract";
import { METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE } from "@/app/admin/3d-room-lab-v2/metric-correspondence-span-contract";
import {
  AUTO_METRIC_SCALE_SANITY_MAX,
  AUTO_METRIC_SCALE_SANITY_MIN,
} from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import type { ObservedSpanMetricCandidate } from "@/app/admin/3d-room-lab-v2/observed-span-metric-candidate-contract";
import { buildObservedSpanMetricSelection } from "@/app/admin/3d-room-lab-v2/observed-span-metric-candidate-contract";
import type { ObservedSpanPhysicalEstimateReceipt } from "@/app/admin/3d-room-lab-v2/observed-span-physical-estimate-contract";
import type { AfcV2AnalyzeResult } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import {
  AFC_V2_OBSERVED_SPAN_LAUNCH_DISPOSITION,
  launchObservedSpanPhysicalEstimate,
  resolveObservedSpanLaunchDisposition,
} from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { AUTO_METRIC_SCALE } from "@/app/admin/3d-room-lab-v2/scene-metric-world-realization";

import {
  parseAfcV2MetricDecision,
  type AfcV2MetricDecisionDiagnosticV1,
  type AfcV2MetricPathBLaunchDisposition,
} from "./metric-decision-diagnostic";
import {
  captureAfcV2MetricDecision,
  projectAfcV2MetricDecisionDiagnostic,
  type AfcV2MetricDecisionProjectionInput,
} from "./metric-decision-projector";
import {
  buildAfcV2ProductionRoomAuthority,
  type AfcV2ProductionRoomAuthority,
} from "./production-authority-contract";
import {
  createProductionMetricObservation,
  deriveProductionAutoMetric,
  type ProductionAutoMetric,
  type ProductionMetricObservation,
} from "./production-auto-metric";

const GENERATION_ID = "173e217c-6db5-4d04-8ee1-c30532bfbecb";
const PROSE = "RAW_PROVIDER_PROSE_SENTINEL notes limitations basis ambiguity";

type Applied = Extract<AfcV2AnalyzeResult, { status: "applied" }>;

function prior(
  estimateOverrides: Record<string, unknown> = {},
  failure: MetricRoomPriorReceipt["failure"] = null,
): MetricRoomPriorReceipt {
  const parsed = parseMetricRoomPriorModelEstimate({
    observability: "recoverable",
    estimatedRoomDepthM: { low: 4.2, best: 4.5, high: 4.8 },
    estimatedRoomWidthM: { low: 3.3, best: 3.6, high: 3.9 },
    estimatedCeilingHeightM: 2.7,
    modelConfidence: 0.8,
    limitations: [PROSE],
    notes: PROSE,
    ...estimateOverrides,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("prior parse failed");
  const estimate: MetricRoomPriorModelEstimate = parsed.estimate;
  return buildMetricRoomPriorReceipt({
    sourceImageHash: "a".repeat(64),
    originalAncestorSha256: "a".repeat(64),
    attemptId: "attempt-metric",
    loadGeneration: 3,
    provider: "google_gemini",
    model: "gemini-3.5-flash",
  }, failure ? null : estimate, failure
    ? { class: "unavailable", reasons: [PROSE, "configuration"], derivedAutoMetricScale: null }
    : acceptMetricRoomPrior(estimate), failure);
}

function backSpan(overrides: Partial<MetricCorrespondenceSpan> = {}): MetricCorrespondenceSpan {
  return {
    id: "span-back",
    source: "s4a_floor_wall",
    correspondenceSource: "identity_uv",
    spanTrust: "trusted",
    role: "back_floor_wall",
    imageSpace: METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
    overlaySafeOnOriginal: true,
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.8, y: 0.62 },
    canonicalWorldA: { x: -1, z: 0 },
    canonicalWorldB: { x: 1, z: 0 },
    canonicalLength: 2,
    endpointAClass: "observed_interior",
    endpointBClass: "observed_interior",
    truncation: "none",
    imageLengthNormalized: 0.6,
    confidence: 0.9,
    selectionReasons: ["accepted_s4a_floor_wall"],
    lineage: {
      s4aCandidateId: "s4a-back",
      sourceSeamId: "seam-back",
      registrationClass: "exact_grid_registered",
      olCandidateId: null,
    },
    ...overrides,
  };
}

function analysis(overrides: Record<string, unknown> = {}): Applied {
  const selected = "selected" in overrides
    ? overrides.selected as MetricCorrespondenceSpan | null
    : backSpan();
  const tier = (overrides.tier as string | undefined) ?? "exact_grid_compatible";
  return {
    metricRoomPrior: "roomPrior" in overrides
      ? overrides.roomPrior as MetricRoomPriorReceipt | null
      : prior(),
    metricCorrespondence: buildMetricCorrespondenceSelection(
      selected,
      [{ id: "span-left", role: "left_floor_wall", reason: "too_short_in_image" }],
      selected ? ["role_back_floor_wall"] : ["no_eligible_finite_span"],
    ),
    roomBoundaries: {
      candidates: [{
        id: "s4a-back",
        limitations: {
          observedSpanOnly: overrides.observedSpanOnly !== false,
          hiddenContinuation: overrides.hiddenContinuation === true,
          geometryManufactured: overrides.geometryManufactured === true,
        },
      }],
    },
    emptyOriginalRegistration: { oldCompatibilityTier: tier },
    emptyAuthoritativeCollision: { lineage: { compatibilityTier: tier } },
    roomCollision: { lineage: { roomBoundary: { compatibilityTier: tier } } },
    observedSpanMetricSelection: overrides.observedSpanMetricSelection ?? null,
    observedSpanPhysicalEstimate: overrides.observedSpanPhysicalEstimate ?? null,
    floor: {
      authorityKey: "floor-key",
      sourceNormalizedPolygon: [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
        { x: 0.7, y: 0.5 },
        { x: 0.3, y: 0.5 },
      ],
      worldWidthM: 4,
      referenceDepthM: 4,
      widthDepthRatio: 1,
    },
    camera: {
      applied: true,
      verticalFovDeg: 60,
      pose: {
        position: { x: 0, y: 1.5, z: 4 },
        lookAt: { x: 0, y: 1, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      frame: { width: 800, height: 600 },
      originalBasisRestored: true,
    },
  } as unknown as Applied;
}

function observedCandidate(): ObservedSpanMetricCandidate {
  return {
    id: "span-left",
    role: "left_floor_wall",
    imageA: { x: 0.22, y: 0.61 },
    imageB: { x: 0.28, y: 0.84 },
    canonicalLength: 2,
    lineage: {
      sourceSeamId: "seam-left",
      s4aCandidateId: "s4a-left",
    },
    junction: { type: "wall_wall_corroboration" },
  } as ObservedSpanMetricCandidate;
}

function observedEstimate(
  overrides: Partial<ObservedSpanPhysicalEstimateReceipt> = {},
): ObservedSpanPhysicalEstimateReceipt {
  return {
    provider: "google_gemini",
    model: "gemini-3.5-flash",
    promptVersion: "afc-v2-observed-span-physical-estimator/v1",
    schemaVersion: "afc-v2-observed-span-physical-estimate/v1",
    overlayImageHash: "b".repeat(64),
    estimate: {
      status: "recoverable",
      estimatedLengthM: { low: 2.1, best: 2.4, high: 2.8 },
      modelConfidence: 0.8,
      basis: PROSE,
      limitations: [PROSE],
      notes: PROSE,
      ambiguity: PROSE,
    },
    hostAcceptance: {
      class: "accepted",
      reasons: ["host_accepted_observed_span_physical_estimate"],
      autoMetricScale: 1.2,
    },
    lineage: {
      floorAuthorityKey: "0.1,0.9|0.9,0.9",
      freezeReceiptVersion: "freeze-v1",
      freezePayloadSha256: "c".repeat(64),
      attemptId: "attempt-metric",
      loadGeneration: 3,
    },
    diagnostics: { estimatorLaunched: true },
    ...overrides,
  } as ObservedSpanPhysicalEstimateReceipt;
}

function selectionFor(
  candidate: ObservedSpanMetricCandidate | null,
  launched = false,
) {
  return buildObservedSpanMetricSelection(
    candidate,
    [],
    candidate ? ["ranked_best_eligible_observed_span"] : ["no_s4a_floor_wall_candidates"],
    {
      exists: false,
      selectedId: null,
      reasons: ["complete_back_geometry_absent"],
    },
    launched,
  );
}

function authorityFor(
  source: Applied,
  autoMetric: ProductionAutoMetric,
): AfcV2ProductionRoomAuthority {
  const identity = {
    sha256: "a".repeat(64),
    decodedWidth: 800,
    decodedHeight: 600,
    orientation: 1 as const,
  };
  return buildAfcV2ProductionRoomAuthority({
    generationId: GENERATION_ID,
    runId: "run-metric",
    createdAt: "2026-09-23T00:00:00.000Z",
    original: identity,
    empty: identity,
    tiled: identity,
    emptyArtifactSource: "generated",
    tiledArtifactSource: "generated",
    tiledCacheKey: "cache-key",
    tiledForceRegeneration: false,
    readerVersion: "reader",
    frame: { width: 800, height: 600 },
    analysis: source,
    autoMetric,
    collision: {
      source: "s4b",
      collisionAuthority: false,
      walls: [],
    },
  });
}

function readyInput(
  source: Applied,
  extras: Partial<AfcV2MetricDecisionProjectionInput> = {},
): {
  plain: ProductionAutoMetric;
  observed: ProductionAutoMetric;
  observation: ProductionMetricObservation;
  authority: AfcV2ProductionRoomAuthority;
  decision: AfcV2MetricDecisionDiagnosticV1;
} {
  const plain = deriveProductionAutoMetric(source);
  const observation = createProductionMetricObservation();
  const observed = deriveProductionAutoMetric(source, observation);
  assert.deepEqual(observed, plain);
  const authority = authorityFor(source, plain);
  assert.equal(
    JSON.stringify(authorityFor(source, observed)),
    JSON.stringify(authority),
  );
  const projected = projectAfcV2MetricDecisionDiagnostic({
    generationId: GENERATION_ID,
    terminalStatus: "ready",
    attemptId: source.metricRoomPrior?.attemptId ?? null,
    loadGeneration: source.metricRoomPrior?.loadGeneration ?? null,
    authority,
    autoMetric: observed,
    observation,
    roomPrior: source.metricRoomPrior,
    correspondence: source.metricCorrespondence,
    observedSpanSelection: source.observedSpanMetricSelection,
    observedSpanEstimate: source.observedSpanPhysicalEstimate,
    launchDisposition: extras.launchDisposition ?? "not_reached",
    floorAuthorityKey: "floor-key",
    freezeReceiptVersion: null,
    freezePayloadSha256: null,
    suppressWhenCompleteBackGeometryExists: true,
    oldCompatibilityTier:
      source.emptyOriginalRegistration?.oldCompatibilityTier ?? null,
    emptyAuthoritativeCompatibilityTier:
      source.emptyAuthoritativeCollision?.lineage.compatibilityTier ?? null,
    roomBoundaryCompatibilityTier:
      source.roomCollision?.lineage.roomBoundary.compatibilityTier ?? null,
    ...extras,
  });
  const decision = roundTrip(projected);
  assert.equal(decision.finalDecision.selectedPath, authority.metric.path);
  assert.equal(decision.finalDecision.accepted, authority.metric.accepted);
  assert.equal(decision.finalDecision.authority, authority.metric.authority);
  assert.equal(decision.finalDecision.metricScale, authority.metric.metricScale);
  assert.equal(decision.finalDecision.autoMetricScale, authority.metric.autoMetricScale);
  assert.equal(decision.finalDecision.fallbackApplied, authority.metric.fallbackApplied);
  assert.equal(
    decision.finalDecision.safeFailureState,
    authority.recovery.safeFailureState,
  );
  return { plain, observed, observation, authority, decision };
}

function roundTrip(value: unknown): AfcV2MetricDecisionDiagnosticV1 {
  const parsed = parseAfcV2MetricDecision(JSON.parse(JSON.stringify(value)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.decision || !("pathA" in parsed.decision)) {
    throw new Error("recorded decision did not round-trip");
  }
  assert.deepEqual(parsed.decision, parseAfcV2MetricDecision(value).ok
    ? (parseAfcV2MetricDecision(value) as { ok: true; decision: AfcV2MetricDecisionDiagnosticV1 }).decision
    : null);
  return parsed.decision;
}

test("1) Path A accepted projects the receipt scale and keeps production output", () => {
  const result = readyInput(analysis(), { launchDisposition: "suppressed_complete_back_geometry" });
  assert.equal(result.plain.path, "path_a");
  assert.equal(result.plain.receipt.accepted, true);
  assert.equal(result.decision.pathA.disposition, "evaluated");
  assert.equal(result.decision.pathA.roomPrior.estimatedRoomWidthM?.best, 3.6);
  assert.equal(result.decision.pathA.roomPrior.hostAcceptance?.class, "accepted");
  assert.equal(result.decision.pathA.geometryCorrespondence.selectedSpan?.id, "span-back");
  assert.deepEqual(result.decision.pathA.geometryCorrespondence.selectedSpan?.imageA, {
    x: 0.2,
    y: 0.62,
  });
  assert.equal(result.decision.pathA.spanTrust.trusted, true);
  assert.equal(result.decision.pathA.exactGrid.exactGridCompatible, true);
  assert.equal(result.decision.pathA.exactGrid.trustSelectedBackSpanAsFullWidth, true);
  assert.equal(result.decision.pathA.derivation.candidateScaleBeforeFallback, 3.6 / 2);
  assert.equal(result.decision.pathA.derivation.accepted, true);
  assert.equal(result.decision.fallback.used, false);
  assert.equal(result.decision.fallback.numericFallback, null);
  assert.equal(result.decision.finalDecision.rejectedCandidatePresent, false);
  assert.equal(result.decision.pathB.launchDisposition, "suppressed_complete_back_geometry");
});

test("2) Path A room prior missing stays unevaluated as a scale candidate", () => {
  const result = readyInput(analysis({ roomPrior: null, selected: null }));
  assert.equal(result.decision.pathA.roomPrior.attempted, false);
  assert.equal(result.decision.pathA.roomPrior.estimatePresent, false);
  assert.equal(result.decision.pathA.roomPrior.estimatedRoomWidthM, null);
  assert.equal(result.decision.pathA.derivation.candidateScaleBeforeFallback, null);
  assert.equal(result.plain.receipt.accepted, false);
  assert.ok(result.plain.receipt.reasons.includes("room_prior_unavailable"));
});

test("3) Path A weak rejection retains the parsed width", () => {
  const result = readyInput(analysis({
    roomPrior: prior({ observability: "weak", modelConfidence: 0.9 }),
  }));
  assert.equal(result.decision.pathA.roomPrior.hostAcceptance?.class, "weak_rejected");
  assert.equal(result.decision.pathA.roomPrior.estimatedRoomWidthM?.best, 3.6);
  assert.equal(result.decision.pathA.derivation.parsedWidthBest, 3.6);
  assert.equal(result.decision.pathA.derivation.accepted, false);
  assert.equal(result.plain.metricScale, AUTO_METRIC_SCALE);
});

test("4) Path A implausible rejection retains the parsed width", () => {
  const result = readyInput(analysis({
    roomPrior: prior({
      estimatedRoomWidthM: { low: 40, best: 50, high: 60 },
    }),
  }));
  assert.equal(result.decision.pathA.roomPrior.hostAcceptance?.class, "implausible_rejected");
  assert.equal(result.decision.pathA.roomPrior.estimatedRoomWidthM?.best, 50);
  assert.equal(result.decision.pathA.derivation.candidateScaleBeforeFallback, null);
  assert.equal(result.plain.receipt.autoMetricScale, 1);
});

test("5) Path A selected span missing records the production reason", () => {
  const result = readyInput(analysis({ selected: null }));
  assert.equal(result.decision.pathA.geometryCorrespondence.selectedSpan, null);
  assert.equal(result.decision.pathA.geometryCorrespondence.selectionStatus, "no_eligible_finite_span");
  assert.ok(result.decision.pathA.derivation.reasonCodes.includes("selected_span_missing"));
  assert.equal(result.plain.receipt.accepted, false);
});

test("6) Path A span trust rejection uses the retained trust result", () => {
  const result = readyInput(analysis({
    selected: backSpan({ truncation: "one_end" }),
  }));
  assert.equal(result.decision.pathA.spanTrust.trusted, false);
  assert.ok(result.decision.pathA.spanTrust.reasonCodes.includes("span_truncated"));
  assert.equal(result.decision.pathA.derivation.accepted, false);
  assert.ok(result.plain.receipt.reasons.includes("span_truncated"));
});

test("7) exact-grid and completeness rejection stay on the same production branch", () => {
  const result = readyInput(analysis({ tier: "aspect_compatible_rescaled" }));
  assert.equal(result.decision.pathA.exactGrid.consultedTier, "aspect_compatible_rescaled");
  assert.equal(result.decision.pathA.exactGrid.exactGridCompatible, false);
  assert.equal(result.decision.pathA.exactGrid.trustSelectedBackSpanAsFullWidth, false);
  assert.ok(result.decision.pathA.derivation.reasonCodes.includes("lab_trust_not_enabled"));
  assert.ok(result.decision.pathA.derivation.reasonCodes.includes("completeness_not_certified"));
  assert.deepEqual(
    result.plain.receipt.reasons.filter((reason) =>
      reason === "lab_trust_not_enabled" || reason === "completeness_not_certified"
    ),
    ["lab_trust_not_enabled", "completeness_not_certified"],
  );
});

test("8) Path A catastrophic rejection retains the computed candidate", () => {
  const result = readyInput(analysis({
    roomPrior: prior({
      estimatedRoomWidthM: { low: 28, best: 30, high: 30 },
    }),
    selected: backSpan({ canonicalLength: 0.2 }),
  }));
  const candidate = 30 / 0.2;
  assert.ok(candidate > AUTO_METRIC_SCALE_SANITY_MAX);
  assert.equal(result.observation.pathACandidateScaleBeforeFallback, candidate);
  assert.equal(result.plain.receipt.autoMetricScale, 1);
  assert.equal(result.plain.receipt.accepted, false);
  assert.equal(result.decision.pathA.derivation.candidateScaleBeforeFallback, candidate);
  assert.equal(result.decision.pathA.derivation.candidateFinite, true);
  assert.equal(result.decision.pathA.derivation.catastrophicSanity, "outside");
  assert.notEqual(result.decision.pathA.derivation.candidateScaleBeforeFallback, 1);
  assert.equal(result.decision.finalDecision.rejectedCandidateScale, candidate);
  assert.equal(result.decision.finalDecision.fallbackSubstitutedAfterRejection, true);
});

test("9) Path B accepted keeps the host scale and existing output", () => {
  const candidate = observedCandidate();
  const estimate = observedEstimate();
  const result = readyInput(analysis({
    selected: null,
    roomPrior: null,
    observedSpanMetricSelection: selectionFor(candidate, true),
    observedSpanPhysicalEstimate: estimate,
  }), { launchDisposition: "launched" });
  assert.equal(result.plain.path, "path_b");
  assert.equal(result.plain.metricScale, 1.2);
  assert.equal(result.decision.pathB.launchDisposition, "launched");
  assert.equal(result.decision.pathB.modelCall.estimatorLaunched, true);
  assert.equal(result.decision.pathB.modelEstimate.estimatedLengthM?.best, 2.4);
  assert.equal(result.decision.pathB.modelEstimate.hostAcceptance?.candidateScale, 1.2);
  assert.equal(result.decision.pathB.derivation.candidateScaleBeforeFallback, 1.2);
  assert.equal(result.decision.pathB.derivation.accepted, true);
  assert.equal(result.decision.pathB.hostGeometry?.id, "span-left");
  assert.equal(result.decision.pathB.hostGeometry?.floorAuthorityKey, "0.1,0.9|0.9,0.9");
  assert.equal(result.decision.fallback.used, false);
});

test("10) Path B suppressed by complete back geometry does not launch", () => {
  const result = readyInput(analysis({ tier: "aspect_compatible_rescaled" }), {
    launchDisposition: "suppressed_complete_back_geometry",
  });
  assert.equal(result.observation.completeBackGeometryExists, true);
  assert.equal(result.plain.path, "none");
  assert.equal(result.decision.pathB.launchDisposition, "suppressed_complete_back_geometry");
  assert.equal(result.decision.pathB.selection.suppressWhenCompleteBackGeometryExists, true);
  assert.ok(result.decision.pathB.derivation.reasonCodes.includes(
    "complete_back_geometry_suppresses_observed_span_auto",
  ));
});

test("11) Path B no candidate records the existing miss", () => {
  const result = readyInput(analysis({
    selected: null,
    observedSpanMetricSelection: selectionFor(null, false),
  }), { launchDisposition: "not_launched_no_candidate" });
  assert.equal(result.decision.pathB.launchDisposition, "not_launched_no_candidate");
  assert.equal(result.decision.pathB.selection.selectedCandidateId, null);
  assert.equal(result.decision.pathB.modelCall.estimatorLaunched, false);
  assert.ok(result.decision.pathB.derivation.reasonCodes.includes("observed_span_candidate_missing"));
});

test("12) Path B EMPTY bytes missing does not launch", () => {
  const result = readyInput(analysis({
    selected: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), false),
  }), { launchDisposition: "not_launched_empty_bytes_missing" });
  assert.equal(result.decision.pathB.launchDisposition, "not_launched_empty_bytes_missing");
  assert.equal(result.decision.pathB.hostGeometry?.id, "span-left");
  assert.equal(result.decision.pathB.modelEstimate.status, null);
  assert.ok(result.decision.pathB.derivation.reasonCodes.includes("observed_span_estimate_missing"));
});

test("13) Path B invalid EMPTY MIME does not launch", () => {
  const result = readyInput(analysis({
    selected: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), false),
  }), { launchDisposition: "not_launched_empty_mime_invalid" });
  assert.equal(result.decision.pathB.launchDisposition, "not_launched_empty_mime_invalid");
  assert.equal(result.decision.pathB.modelCall.estimatorLaunched, false);
});

test("14) Path B controlled fixture suppression keeps the fixture receipt", () => {
  const estimate = observedEstimate({
    provider: "controlled_fixture",
    model: "fixture",
    estimate: null,
    hostAcceptance: {
      class: "unavailable",
      reasons: ["controlled_fixture_observed_span_not_run"],
      autoMetricScale: null,
    },
    diagnostics: { estimatorLaunched: false },
  } as unknown as Partial<ObservedSpanPhysicalEstimateReceipt>);
  const result = readyInput(analysis({
    selected: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), false),
    observedSpanPhysicalEstimate: estimate,
  }), { launchDisposition: "not_launched_controlled_fixture" });
  assert.equal(result.decision.pathB.launchDisposition, "not_launched_controlled_fixture");
  assert.equal(result.decision.pathB.modelCall.estimatorLaunched, false);
  assert.equal(result.decision.pathB.modelCall.provider, "controlled_fixture");
  assert.equal(result.decision.pathB.modelEstimate.hostAcceptance?.class, "unavailable");
});

test("15) Path B launch failure keeps the launched selection and a null estimate", () => {
  const result = readyInput(analysis({
    selected: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), true),
  }), { launchDisposition: "launch_failed" });
  assert.equal(result.decision.pathB.launchDisposition, "launch_failed");
  assert.equal(result.decision.pathB.modelCall.estimatorLaunched, true);
  assert.equal(result.decision.pathB.modelEstimate.estimatedLengthM, null);
});

test("16) Path B weak rejection retains the parsed length and pre-fallback scale", () => {
  const estimate = observedEstimate({
    estimate: {
      status: "weak",
      estimatedLengthM: { low: 2, best: 2.4, high: 3 },
      modelConfidence: 0.4,
      basis: PROSE,
      limitations: [PROSE],
      notes: PROSE,
      ambiguity: PROSE,
    },
    hostAcceptance: {
      class: "weak_rejected",
      reasons: ["status_weak", PROSE],
      autoMetricScale: 1.2,
    },
  } as Partial<ObservedSpanPhysicalEstimateReceipt>);
  const result = readyInput(analysis({
    selected: null,
    roomPrior: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), true),
    observedSpanPhysicalEstimate: estimate,
  }), { launchDisposition: "launched" });
  assert.equal(result.plain.receipt.autoMetricScale, 1);
  assert.equal(result.decision.pathB.modelEstimate.status, "weak");
  assert.equal(result.decision.pathB.modelEstimate.estimatedLengthM?.best, 2.4);
  assert.equal(result.decision.pathB.modelEstimate.hostAcceptance?.class, "weak_rejected");
  assert.equal(result.decision.pathB.modelEstimate.hostAcceptance?.candidateScale, 1.2);
  assert.equal(result.decision.pathB.derivation.candidateScaleBeforeFallback, 1.2);
  assert.equal(result.decision.pathB.derivation.accepted, false);
  assert.deepEqual(result.decision.pathB.modelEstimate.hostAcceptance?.reasonCodes, ["status_weak"]);
  assert.equal(result.decision.finalDecision.rejectedCandidateScale, 1.2);
});

test("17) Path B implausible rejection retains the parsed length", () => {
  const estimate = observedEstimate({
    estimate: {
      status: "recoverable",
      estimatedLengthM: { low: 90, best: 100, high: 110 },
      modelConfidence: 0.9,
      basis: null,
      limitations: [],
      notes: null,
      ambiguity: null,
    },
    hostAcceptance: {
      class: "implausible_rejected",
      reasons: ["physical_length_outside_segment_sanity"],
      autoMetricScale: 50,
    },
  } as Partial<ObservedSpanPhysicalEstimateReceipt>);
  const result = readyInput(analysis({
    selected: null,
    roomPrior: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), true),
    observedSpanPhysicalEstimate: estimate,
  }), { launchDisposition: "launched" });
  assert.equal(result.decision.pathB.modelEstimate.estimatedLengthM?.best, 100);
  assert.equal(result.decision.pathB.modelEstimate.hostAcceptance?.class, "implausible_rejected");
  assert.equal(result.decision.pathB.derivation.candidateScaleBeforeFallback, 50);
  assert.equal(result.plain.metricScale, 1);
});

test("18) Path B lineage rejection does not invent a candidate scale", () => {
  const estimate = observedEstimate({
    hostAcceptance: {
      class: "lineage_rejected",
      reasons: ["lineage_empty_sha_mismatch"],
      autoMetricScale: null,
    },
  });
  const result = readyInput(analysis({
    selected: null,
    roomPrior: null,
    observedSpanMetricSelection: selectionFor(observedCandidate(), true),
    observedSpanPhysicalEstimate: estimate,
  }), { launchDisposition: "launched" });
  assert.equal(result.decision.pathB.derivation.lineageStatus, "lineage_rejected");
  assert.equal(result.decision.pathB.derivation.candidateScaleBeforeFallback, null);
  assert.equal(result.decision.pathB.modelEstimate.estimatedLengthM?.best, 2.4);
  assert.equal(result.decision.finalDecision.rejectedCandidatePresent, false);
});

test("19) both paths rejected keep the finite Path A candidate", () => {
  const estimate = observedEstimate({
    hostAcceptance: {
      class: "weak_rejected",
      reasons: ["status_weak"],
      autoMetricScale: 1.4,
    },
  });
  const result = readyInput(analysis({
    roomPrior: prior({ estimatedRoomWidthM: { low: 28, best: 30, high: 30 } }),
    selected: backSpan({ canonicalLength: 0.2 }),
    observedSpanMetricSelection: selectionFor(observedCandidate(), true),
    observedSpanPhysicalEstimate: estimate,
  }), { launchDisposition: "launched" });
  assert.equal(result.plain.path, "none");
  assert.equal(result.decision.finalDecision.rejectedCandidateScale, 30 / 0.2);
  assert.equal(result.decision.pathB.derivation.candidateScaleBeforeFallback, 1.4);
  assert.equal(result.decision.fallback.used, true);
  assert.equal(result.decision.fallback.numericFallback, 1);
});

test("20) hard fallback without a finite candidate does not claim a rejected scale", () => {
  const result = readyInput(analysis({ roomPrior: null, selected: null }));
  assert.equal(result.decision.fallback.used, true);
  assert.equal(result.decision.fallback.numericFallback, AUTO_METRIC_SCALE);
  assert.equal(result.decision.fallback.constantName, "AUTO_METRIC_SCALE");
  assert.equal(result.decision.finalDecision.rejectedCandidatePresent, false);
  assert.equal(result.decision.finalDecision.fallbackSubstitutedAfterRejection, false);
  assert.equal(result.decision.finalDecision.fallbackApplied, true);
});

test("21) an accepted path records no numeric fallback", () => {
  const result = readyInput(analysis());
  assert.equal(result.decision.finalDecision.accepted, true);
  assert.equal(result.decision.fallback.used, false);
  assert.equal(result.decision.fallback.numericFallback, null);
  assert.equal(result.authority.metric.fallbackApplied, false);
});

test("22) failed generation before metric does not describe fallback authority", () => {
  const decision = roundTrip(projectAfcV2MetricDecisionDiagnostic({
    generationId: GENERATION_ID,
    terminalStatus: "failed",
    attemptId: null,
    loadGeneration: null,
    authority: null,
    autoMetric: null,
    observation: null,
    roomPrior: null,
    correspondence: null,
    observedSpanSelection: null,
    observedSpanEstimate: null,
    launchDisposition: "not_reached",
    floorAuthorityKey: null,
    freezeReceiptVersion: null,
    freezePayloadSha256: null,
    suppressWhenCompleteBackGeometryExists: null,
    oldCompatibilityTier: null,
    emptyAuthoritativeCompatibilityTier: null,
    roomBoundaryCompatibilityTier: null,
  }));
  assert.equal(decision.finalDecision.terminalStatus, "failed");
  assert.equal(decision.finalDecision.authorityBuilt, false);
  assert.equal(decision.finalDecision.selectedPath, "none");
  assert.equal(decision.finalDecision.metricScale, null);
  assert.equal(decision.finalDecision.fallbackApplied, false);
  assert.equal(decision.finalDecision.safeFailureState, null);
  assert.equal(decision.pathA.disposition, "not_reached");
  assert.equal(decision.pathB.launchDisposition, "not_reached");
  assert.equal(decision.fallback.used, false);
  assert.equal(decision.fallback.numericFallback, null);
});

test("23) failed generation keeps partial room-prior evidence without fallback authority", () => {
  const roomPrior = prior();
  const decision = roundTrip(projectAfcV2MetricDecisionDiagnostic({
    generationId: GENERATION_ID,
    terminalStatus: "failed",
    attemptId: roomPrior.attemptId,
    loadGeneration: roomPrior.loadGeneration,
    authority: null,
    autoMetric: null,
    observation: null,
    roomPrior,
    correspondence: null,
    observedSpanSelection: null,
    observedSpanEstimate: null,
    launchDisposition: "not_reached",
    floorAuthorityKey: null,
    freezeReceiptVersion: null,
    freezePayloadSha256: null,
    suppressWhenCompleteBackGeometryExists: null,
    oldCompatibilityTier: null,
    emptyAuthoritativeCompatibilityTier: null,
    roomBoundaryCompatibilityTier: null,
  }));
  assert.equal(decision.finalDecision.terminalStatus, "failed");
  assert.equal(decision.finalDecision.authorityBuilt, false);
  assert.equal(decision.pathA.disposition, "not_reached");
  assert.equal(decision.pathA.roomPrior.attempted, true);
  assert.equal(decision.pathA.roomPrior.estimatedRoomWidthM?.best, 3.6);
  assert.equal(decision.pathA.derivation.candidateScaleBeforeFallback, null);
  assert.equal(decision.fallback.used, false);
  assert.equal(decision.finalDecision.rejectedCandidatePresent, false);
});

test("24) rejectedCandidatePresent requires a finite candidate and a non-accepted decision", () => {
  const rejected = readyInput(analysis({
    roomPrior: prior({ estimatedRoomWidthM: { low: 28, best: 30, high: 30 } }),
    selected: backSpan({ canonicalLength: 0.2 }),
  }));
  assert.equal(rejected.decision.finalDecision.accepted, false);
  assert.equal(rejected.decision.finalDecision.rejectedCandidatePresent, true);
  assert.equal(rejected.decision.finalDecision.rejectedCandidateFinite, true);
  assert.equal(rejected.decision.finalDecision.rejectedCandidateScale, 150);
  const accepted = readyInput(analysis());
  assert.equal(accepted.decision.finalDecision.rejectedCandidatePresent, false);
  assert.equal(accepted.decision.finalDecision.rejectedCandidateScale, null);
  assert.equal(accepted.decision.finalDecision.rejectedCandidateFinite, false);
});

test("25) provider prose, notes, limitations, basis, and ambiguity are not persisted", () => {
  const result = readyInput(analysis(), {
    launchDisposition: "suppressed_complete_back_geometry",
  });
  const serialized = JSON.stringify(result.decision);
  assert.equal(serialized.includes(PROSE), false);
  assert.equal(serialized.includes("basis"), false);
  assert.equal(serialized.includes("ambiguity"), false);
  assert.equal(serialized.includes("limitations"), false);
  assert.match(serialized, /promptVersion/);
  assert.doesNotMatch(serialized, /"prompt":/);
  assert.equal(result.decision.pathA.roomPrior.failure, null);
  const failedPrior = prior({}, {
    failureClass: "unknown",
    failureStage: "provider_invocation",
    provider: "google_gemini",
    model: "gemini-3.5-flash",
    providerStatus: null,
    safeDetail: "redacted builder detail",
    contractValidationReason: "contract_invalid",
  });
  const failed = roundTrip(projectAfcV2MetricDecisionDiagnostic({
    generationId: GENERATION_ID,
    terminalStatus: "failed",
    attemptId: "attempt-metric",
    loadGeneration: 3,
    authority: null,
    autoMetric: null,
    observation: null,
    roomPrior: failedPrior,
    correspondence: null,
    observedSpanSelection: null,
    observedSpanEstimate: null,
    launchDisposition: "not_reached",
    floorAuthorityKey: null,
    freezeReceiptVersion: null,
    freezePayloadSha256: null,
    suppressWhenCompleteBackGeometryExists: null,
    oldCompatibilityTier: null,
    emptyAuthoritativeCompatibilityTier: null,
    roomBoundaryCompatibilityTier: null,
  }));
  assert.equal(failed.pathA.roomPrior.failure?.safeDetail, "redacted builder detail");
  assert.equal(failed.pathA.roomPrior.hostAcceptance?.reasonCodes.includes(PROSE), false);
  assert.deepEqual(failed.pathA.roomPrior.hostAcceptance?.reasonCodes, ["configuration"]);
});

test("26) a throwing projector becomes capture_failed and does not leak the message", () => {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const decision = captureAfcV2MetricDecision({
      generationId: GENERATION_ID,
      terminalStatus: "failed",
      attemptId: null,
      loadGeneration: null,
      authority: null,
      autoMetric: null,
      observation: null,
      roomPrior: null,
      correspondence: null,
      observedSpanSelection: null,
      observedSpanEstimate: null,
      launchDisposition: null,
      floorAuthorityKey: null,
      freezeReceiptVersion: null,
      freezePayloadSha256: null,
      suppressWhenCompleteBackGeometryExists: null,
      oldCompatibilityTier: null,
      emptyAuthoritativeCompatibilityTier: null,
      roomBoundaryCompatibilityTier: null,
    }, {
      project: () => {
        throw new Error(`PROMPT TEXT ${PROSE}`);
      },
    });
    assert.equal(decision && "captureStatus" in decision && decision.captureStatus, "capture_failed");
    const parsed = parseAfcV2MetricDecision(JSON.parse(JSON.stringify(decision)));
    assert.equal(parsed.ok, true);
    const text = logs.join("\n");
    assert.match(text, new RegExp(GENERATION_ID));
    assert.match(text, /Error/);
    assert.equal(text.includes(PROSE), false);
    assert.equal(text.includes("PROMPT TEXT"), false);
  } finally {
    console.error = original;
  }
});

test("27) parser rejection becomes capture_failed without failing the caller", () => {
  const decision = captureAfcV2MetricDecision({
    generationId: GENERATION_ID,
    terminalStatus: "ready",
    attemptId: null,
    loadGeneration: null,
    authority: null,
    autoMetric: null,
    observation: null,
    roomPrior: null,
    correspondence: null,
    observedSpanSelection: null,
    observedSpanEstimate: null,
    launchDisposition: null,
    floorAuthorityKey: null,
    freezeReceiptVersion: null,
    freezePayloadSha256: null,
    suppressWhenCompleteBackGeometryExists: null,
    oldCompatibilityTier: null,
    emptyAuthoritativeCompatibilityTier: null,
    roomBoundaryCompatibilityTier: null,
  }, {
    project: () => ({
      schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
      captureStatus: "recorded",
      generationId: GENERATION_ID,
    }),
  });
  assert.deepEqual(decision, {
    schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
    captureStatus: "capture_failed",
    generationId: GENERATION_ID,
  });
  const parsed = parseAfcV2MetricDecision(JSON.parse(JSON.stringify(decision)));
  assert.equal(parsed.ok, true);
});

test("recorded metric_decision key set excludes prompt text and secrets", () => {
  const result = readyInput(analysis(), {
    launchDisposition: "suppressed_complete_back_geometry",
  });
  const keys: string[] = [];
  const walk = (value: unknown, prefix: string) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value[0] && typeof value[0] === "object") walk(value[0], `${prefix}[]`);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      keys.push(next);
      walk(child, next);
    }
  };
  walk(result.decision, "");
  const forbidden = [
    "notes",
    "limitations",
    "basis",
    "ambiguity",
    "prompt",
    "promptText",
    "bytes",
    "imageUrl",
    "signedUrl",
    "storagePath",
    "cookie",
    "authorization",
  ];
  for (const key of keys) {
    const leaf = key.split(".").pop()?.replace("[]", "");
    assert.equal(forbidden.includes(leaf ?? ""), false, key);
  }
  const serialized = JSON.stringify(result.decision);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /AIza|bearer |cookie=|signedUrl|storage\/v1/i);
  assert.ok(keys.includes("pathA.roomPrior.promptVersion"));
  assert.ok(result.decision.pathA.derivation.candidateScaleBeforeFallback);
  assert.ok(result.decision.pathA.derivation.candidateScaleBeforeFallback > AUTO_METRIC_SCALE_SANITY_MIN);
});

test("launch disposition labels map onto existing branches without changing them", async () => {
  const dispositions = Object.values(AFC_V2_OBSERVED_SPAN_LAUNCH_DISPOSITION);
  const diagnostic: readonly AfcV2MetricPathBLaunchDisposition[] = [
    "suppressed_complete_back_geometry",
    "not_launched_no_candidate",
    "not_launched_empty_bytes_missing",
    "not_launched_empty_mime_invalid",
    "not_launched_controlled_fixture",
    "launched",
    "launch_failed",
    "not_reached",
  ];
  assert.deepEqual([...dispositions].sort(), [...diagnostic].sort());
  const missed = launchObservedSpanPhysicalEstimate({
    input: { attemptId: "a", loadGeneration: 1 } as never,
    dependencies: {},
    product: {} as never,
    floorAuthorityKey: "floor-key",
    freezeReceipt: null,
    roomBoundaries: null as never,
    roomCollision: null,
    roomObservation: null,
    emptyBytes: null,
    originalBytes: null,
  });
  assert.equal(missed.launchDisposition, "not_launched_no_candidate");
  assert.equal(missed.selection.estimatorLaunched, false);
  assert.equal(missed.suppressWhenCompleteBackGeometryExists, true);
  assert.equal(await missed.estimatePromise, null);
  assert.equal(
    resolveObservedSpanLaunchDisposition("launched", null),
    "launch_failed",
  );
  assert.equal(
    resolveObservedSpanLaunchDisposition("launched", { schemaVersion: "kept" } as never),
    "launched",
  );
  assert.equal(
    resolveObservedSpanLaunchDisposition("not_launched_controlled_fixture", null),
    "not_launched_controlled_fixture",
  );
});
