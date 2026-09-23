import assert from "node:assert/strict";
import test from "node:test";

import { AFC_V2_AUTO_METRIC_SCALE_VERSION } from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import { AUTO_METRIC_SCALE } from "@/app/admin/3d-room-lab-v2/scene-metric-world-realization";

import {
  AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
  isAfcV2MetricDecisionCaptureFailedV1,
  isAfcV2MetricDecisionDiagnosticV1,
  parseAfcV2MetricDecision,
  type AfcV2MetricDecisionDiagnosticV1,
} from "./metric-decision-diagnostic";

const GENERATION_ID = "173e217c-6db5-4d04-8ee1-c30532bfbecb";
const PROSE = "RAW_PROVIDER_PROSE_SENTINEL";

function minimalRecorded(): AfcV2MetricDecisionDiagnosticV1 {
  return {
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    captureStatus: "recorded",
    generationId: GENERATION_ID,
    lineage: {
      attemptId: null,
      loadGeneration: null,
      autoMetricVersion: AFC_V2_AUTO_METRIC_SCALE_VERSION,
    },
    finalDecision: {
      terminalStatus: "failed",
      authorityBuilt: false,
      selectedPath: "none",
      accepted: false,
      authority: "none",
      metricScale: null,
      autoMetricScale: null,
      fallbackApplied: false,
      safeFailureState: null,
      winningReasonCodes: [],
      rejectedCandidatePresent: false,
      rejectedCandidateScale: null,
      rejectedCandidateFinite: false,
      fallbackSubstitutedAfterRejection: false,
    },
    pathA: {
      disposition: "not_reached",
      roomPrior: {
        attempted: false,
        provider: null,
        model: null,
        promptVersion: null,
        evidenceSchemaVersion: null,
        estimatePresent: false,
        failure: null,
        observability: null,
        estimatedRoomWidthM: null,
        estimatedRoomDepthM: null,
        estimatedCeilingHeightM: null,
        modelConfidence: null,
        hostAcceptance: null,
      },
      geometryCorrespondence: {
        selectionStatus: null,
        selectionReasonCodes: [],
        selectedSpan: null,
        rejectedAlternatives: [],
      },
      spanTrust: {
        trusted: null,
        reasonCodes: [],
        s4aSafetyPresent: null,
        observedSpanOnly: null,
        hiddenContinuation: null,
        geometryManufactured: null,
      },
      exactGrid: {
        consultedTier: null,
        trustSelectedBackSpanAsFullWidth: null,
        exactGridCompatible: null,
        oldCompatibilityTier: null,
        emptyAuthoritativeCompatibilityTier: null,
        roomBoundaryCompatibilityTier: null,
      },
      derivation: {
        physicalMetres: null,
        parsedWidthBest: null,
        canonicalGaugeLength: null,
        candidateScaleBeforeFallback: null,
        candidateFinite: false,
        catastrophicSanity: "not_evaluated",
        accepted: false,
        reasonCodes: [],
        authority: "none",
      },
    },
    pathB: {
      selection: {
        selectionAttempted: false,
        selectionStatus: null,
        selectionReasonCodes: [],
        selectedCandidateId: null,
        pathAGeometry: {
          exists: false,
          selectedId: null,
          reasonCodes: [],
        },
        suppressWhenCompleteBackGeometryExists: true,
      },
      launchDisposition: "not_reached",
      hostGeometry: null,
      modelCall: {
        estimatorLaunched: false,
        provider: null,
        model: null,
        promptVersion: null,
        schemaVersion: null,
      },
      modelEstimate: {
        status: null,
        estimatedLengthM: null,
        modelConfidence: null,
        hostAcceptance: null,
      },
      derivation: {
        candidateScaleBeforeFallback: null,
        lineageStatus: "not_evaluated",
        catastrophicSanity: "not_evaluated",
        accepted: false,
        authority: "none",
        reasonCodes: [],
      },
    },
    fallback: {
      used: false,
      numericFallback: null,
      constantName: AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
      reasonCodes: [],
      winningPathReceipt: "none",
    },
  };
}

function populatedRecorded(): AfcV2MetricDecisionDiagnosticV1 {
  const decision = minimalRecorded();
  return {
    ...decision,
    lineage: {
      attemptId: "attempt-7",
      loadGeneration: 4,
      autoMetricVersion: "afc-v2-auto-metric-scale/v1",
    },
    finalDecision: {
      terminalStatus: "ready",
      authorityBuilt: true,
      selectedPath: "path_a",
      accepted: true,
      authority: "gemini_width_back_span_experimental",
      metricScale: 1.25,
      autoMetricScale: 1.25,
      fallbackApplied: false,
      safeFailureState: "none",
      winningReasonCodes: ["host_accepted_width_prior"],
      rejectedCandidatePresent: false,
      rejectedCandidateScale: null,
      rejectedCandidateFinite: false,
      fallbackSubstitutedAfterRejection: false,
    },
    pathA: {
      ...decision.pathA,
      disposition: "evaluated",
      roomPrior: {
        attempted: true,
        provider: "google_gemini",
        model: "gemini-3.5-flash",
        promptVersion: "afc-v2-metric-room-prior/v1",
        evidenceSchemaVersion: "afc-v2-metric-room-prior-evidence/v1",
        estimatePresent: true,
        failure: null,
        observability: "recoverable",
        estimatedRoomWidthM: { low: 3.2, best: 4.1, high: 5 },
        estimatedRoomDepthM: { low: 5, best: 4, high: 3 },
        estimatedCeilingHeightM: 2.4,
        modelConfidence: 0.8,
        hostAcceptance: {
          class: "accepted",
          reasonCodes: ["host_accepted_width_prior"],
        },
      },
      geometryCorrespondence: {
        selectionStatus: "selected",
        selectionReasonCodes: ["back_floor_wall"],
        selectedSpan: {
          id: "span-back",
          source: "s4a_floor_wall",
          role: "back_floor_wall",
          canonicalLength: 3.28,
          imageA: { x: 0.12, y: 0.81 },
          imageB: { x: 0.88, y: 0.8 },
          correspondenceSpanTrust: "trusted",
          correspondenceSource: "identity_uv",
          lineage: {
            s4aCandidateId: "s4a-1",
            sourceSeamId: "seam-1",
          },
        },
        rejectedAlternatives: [
          {
            id: "span-left",
            role: "left_floor_wall",
            reason: "too_short_in_image",
          },
        ],
      },
      spanTrust: {
        trusted: true,
        reasonCodes: ["trusted_back_wall"],
        s4aSafetyPresent: true,
        observedSpanOnly: false,
        hiddenContinuation: false,
        geometryManufactured: false,
      },
      exactGrid: {
        consultedTier: "exact_grid_compatible",
        trustSelectedBackSpanAsFullWidth: true,
        exactGridCompatible: true,
        oldCompatibilityTier: "exact_grid_compatible",
        emptyAuthoritativeCompatibilityTier: "exact_grid_compatible",
        roomBoundaryCompatibilityTier: "exact_grid_compatible",
      },
      derivation: {
        physicalMetres: 4.1,
        parsedWidthBest: 4.1,
        canonicalGaugeLength: 3.28,
        candidateScaleBeforeFallback: 1.25,
        candidateFinite: true,
        catastrophicSanity: "inside",
        accepted: true,
        reasonCodes: ["host_accepted_width_prior"],
        authority: "gemini_width_back_span_experimental",
      },
    },
    pathB: {
      ...decision.pathB,
      selection: {
        selectionAttempted: true,
        selectionStatus: "suppressed_by_path_a",
        selectionReasonCodes: ["path_a_complete_back_geometry_present"],
        selectedCandidateId: null,
        pathAGeometry: {
          exists: true,
          selectedId: "span-back",
          reasonCodes: ["complete_back_geometry_present"],
        },
        suppressWhenCompleteBackGeometryExists: true,
      },
      launchDisposition: "suppressed_complete_back_geometry",
    },
    fallback: {
      used: false,
      numericFallback: null,
      constantName: "AUTO_METRIC_SCALE",
      reasonCodes: ["host_accepted_width_prior"],
      winningPathReceipt: "path_a",
    },
  };
}

type DeepMutable<T> = T extends ReadonlyArray<infer U>
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

function clone<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

function assertRejected(value: unknown, reasonPattern: RegExp) {
  const parsed = parseAfcV2MetricDecision(value);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.reason, reasonPattern);
  assert.equal(isAfcV2MetricDecisionDiagnosticV1(value), false);
}

test("schema version and fallback constant name are the approved literals", () => {
  assert.equal(
    AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    "afc-v2-metric-decision-diagnostic/v1",
  );
  assert.equal(AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME, "AUTO_METRIC_SCALE");
  assert.equal(AFC_V2_AUTO_METRIC_SCALE_VERSION, "afc-v2-auto-metric-scale/v1");
  assert.equal(AUTO_METRIC_SCALE, 1);
});

test("1) minimal capture_failed V1 parses and stays minimal", () => {
  const input = {
    schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
    captureStatus: "capture_failed",
    generationId: GENERATION_ID,
  };
  const parsed = parseAfcV2MetricDecision(input);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.decision, input);
  assert.equal(isAfcV2MetricDecisionCaptureFailedV1(input), true);
  assert.equal(isAfcV2MetricDecisionDiagnosticV1(input), false);
  assert.equal(Object.keys(parsed.decision ?? {}).length, 3);
});

test("2) populated recorded V1 fixture parses without reordering ranges", () => {
  const input = populatedRecorded();
  const parsed = parseAfcV2MetricDecision(input);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.decision === null || !("pathA" in parsed.decision)) return;
  assert.equal(isAfcV2MetricDecisionDiagnosticV1(input), true);
  assert.deepEqual(parsed.decision.pathA.roomPrior.estimatedRoomDepthM, {
    low: 5,
    best: 4,
    high: 3,
  });
  assert.equal(parsed.decision.finalDecision.selectedPath, "path_a");
  assert.equal(parsed.decision.pathB.launchDisposition, "suppressed_complete_back_geometry");
  assert.deepEqual(
    parsed.decision.pathA.geometryCorrespondence.selectedSpan?.imageA,
    { x: 0.12, y: 0.81 },
  );
});

test("3) null is the legacy persistence state and undefined is not inferred as null", () => {
  const parsed = parseAfcV2MetricDecision(null);
  assert.deepEqual(parsed, { ok: true, decision: null });
  assertRejected(undefined, /metric_decision_not_object/);
  assertRejected("null", /metric_decision_not_object/);
});

test("4) malformed schemaVersion is rejected and is not treated as V1", () => {
  const base = minimalRecorded();
  assertRejected({ ...base, schemaVersion: "" }, /schemaVersion_invalid/);
  assertRejected({ ...base, schemaVersion: 1 }, /schemaVersion_invalid/);
  assertRejected({ ...base, schemaVersion: null }, /schemaVersion_invalid/);
  const missing = clone(base) as Record<string, unknown>;
  delete missing.schemaVersion;
  assertRejected(missing, /schemaVersion_missing/);
});

test("5) unknown future schemaVersion is unsupported and not read as V1", () => {
  const parsed = parseAfcV2MetricDecision({
    schemaVersion: "afc-v2-metric-decision-diagnostic/v2",
    captureStatus: "recorded",
    generationId: GENERATION_ID,
    notes: PROSE,
    pathA: { disposition: "evaluated" },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.decision, {
    kind: "unsupported_schema",
    schemaVersion: "afc-v2-metric-decision-diagnostic/v2",
  });
  assert.equal(JSON.stringify(parsed.decision).includes(PROSE), false);
  assert.equal(isAfcV2MetricDecisionDiagnosticV1({
    schemaVersion: "afc-v2-metric-decision-diagnostic/v2",
    captureStatus: "recorded",
    generationId: GENERATION_ID,
  }), false);
});

test("6) malformed generationId is rejected", () => {
  const base = minimalRecorded();
  assertRejected({ ...base, generationId: "" }, /generationId_invalid/);
  assertRejected({ ...base, generationId: "   " }, /generationId_invalid/);
  assertRejected({ ...base, generationId: 12 }, /generationId_invalid/);
  const missing = clone(base) as Record<string, unknown>;
  delete missing.generationId;
  assertRejected(missing, /generationId_missing/);
});

test("7) malformed numeric ranges fail and finite unordered triples are preserved", () => {
  const base = populatedRecorded();
  const bad = clone(base);
  bad.pathA.roomPrior.estimatedRoomWidthM = {
    low: Number.NaN,
    best: 4,
    high: 5,
  };
  assertRejected(bad, /estimatedRoomWidthM_invalid/);
  const missingHigh = clone(base);
  missingHigh.pathA.roomPrior.estimatedRoomWidthM = {
    low: 1,
    best: 2,
  } as typeof missingHigh.pathA.roomPrior.estimatedRoomWidthM;
  assertRejected(missingHigh, /estimatedRoomWidthM_invalid/);
  const unordered = clone(base);
  unordered.pathA.roomPrior.estimatedRoomWidthM = { low: 9, best: 1, high: 4 };
  const parsed = parseAfcV2MetricDecision(unordered);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.decision === null || !("pathA" in parsed.decision)) return;
  assert.deepEqual(parsed.decision.pathA.roomPrior.estimatedRoomWidthM, {
    low: 9,
    best: 1,
    high: 4,
  });
});

test("8) malformed endpoints are rejected", () => {
  const base = populatedRecorded();
  const missingY = clone(base);
  const span = missingY.pathA.geometryCorrespondence.selectedSpan;
  assert.ok(span);
  span.imageA = { x: 0.2 } as typeof span.imageA;
  assertRejected(missingY, /imageA_invalid/);
  const infinite = clone(base);
  const infiniteSpan = infinite.pathA.geometryCorrespondence.selectedSpan;
  assert.ok(infiniteSpan);
  infiniteSpan.imageB = { x: 0.2, y: Number.POSITIVE_INFINITY };
  assertRejected(infinite, /imageB_invalid/);
});

test("9) malformed reasonCodes are rejected", () => {
  const base = minimalRecorded();
  const notArray = clone(base);
  notArray.finalDecision.winningReasonCodes = "host_accepted_width_prior" as unknown as string[];
  assertRejected(notArray, /winningReasonCodes_invalid/);
  const mixed = clone(base);
  mixed.finalDecision.winningReasonCodes = ["ok", 1] as unknown as string[];
  assertRejected(mixed, /winningReasonCodes_invalid/);
  const missing = clone(base);
  delete (missing.finalDecision as { winningReasonCodes?: unknown }).winningReasonCodes;
  assertRejected(missing, /winningReasonCodes_missing/);
});

test("10) malformed finalDecision path is rejected", () => {
  const base = minimalRecorded();
  const badPath = clone(base);
  badPath.finalDecision.selectedPath = "path_c" as "none";
  assertRejected(badPath, /selectedPath_invalid/);
  const missing = clone(base);
  delete (missing as { finalDecision?: unknown }).finalDecision;
  assertRejected(missing, /finalDecision_missing/);
});

test("11) malformed authority is rejected", () => {
  const base = minimalRecorded();
  const bad = clone(base);
  bad.finalDecision.authority = "manual_known_span" as "none";
  assertRejected(bad, /finalDecision\.authority_invalid/);
  const pathAuthority = clone(base);
  pathAuthority.pathA.derivation.authority = "gemini" as "none";
  assertRejected(pathAuthority, /pathA\.derivation\.authority_invalid/);
});

test("12) malformed Path B launch disposition is rejected", () => {
  const base = minimalRecorded();
  const bad = clone(base);
  bad.pathB.launchDisposition = "skipped" as "not_reached";
  assertRejected(bad, /launchDisposition_invalid/);
});

test("13) extra provider prose is not admitted into the typed record", () => {
  const input = populatedRecorded() as Record<string, unknown>;
  input.notes = PROSE;
  input.basis = PROSE;
  input.limitations = [PROSE];
  input.ambiguity = PROSE;
  input.prompt = PROSE;
  const roomPrior = (input.pathA as { roomPrior: Record<string, unknown> }).roomPrior;
  roomPrior.notes = PROSE;
  roomPrior.limitations = [PROSE];
  (roomPrior.hostAcceptance as Record<string, unknown>).derivedAutoMetricScale = 0.25;
  const parsed = parseAfcV2MetricDecision(input);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const serialized = JSON.stringify(parsed.decision);
  assert.equal(serialized.includes(PROSE), false);
  assert.equal(serialized.includes("derivedAutoMetricScale"), false);
  assert.equal(serialized.includes("\"notes\""), false);
  assert.equal(serialized.includes("\"basis\""), false);
  assert.equal(serialized.includes("\"limitations\""), false);
  assert.equal(serialized.includes("\"ambiguity\""), false);
  assert.equal(serialized.includes("\"prompt\""), false);
  const bloatedFailure = {
    schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
    captureStatus: "capture_failed",
    generationId: GENERATION_ID,
    notes: PROSE,
  };
  assertRejected(bloatedFailure, /capture_failed_not_minimal/);
});

test("14) valid null fields remain null", () => {
  const parsed = parseAfcV2MetricDecision(minimalRecorded());
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.decision === null || !("pathA" in parsed.decision)) return;
  assert.equal(parsed.decision.lineage.attemptId, null);
  assert.equal(parsed.decision.lineage.loadGeneration, null);
  assert.equal(parsed.decision.finalDecision.metricScale, null);
  assert.equal(parsed.decision.finalDecision.safeFailureState, null);
  assert.equal(parsed.decision.pathA.roomPrior.failure, null);
  assert.equal(parsed.decision.pathA.roomPrior.estimatedRoomWidthM, null);
  assert.equal(parsed.decision.pathA.geometryCorrespondence.selectedSpan, null);
  assert.equal(parsed.decision.pathA.spanTrust.trusted, null);
  assert.equal(parsed.decision.pathB.hostGeometry, null);
  assert.equal(parsed.decision.fallback.numericFallback, null);
});

test("15) parser does not mutate its input", () => {
  const input = populatedRecorded();
  Object.freeze(input);
  Object.freeze(input.pathA.roomPrior);
  const before = clone(input);
  const parsed = parseAfcV2MetricDecision(input);
  assert.deepEqual(input, before);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.decision === null) return;
  assert.notEqual(parsed.decision, input);
  assert.equal(Object.isFrozen(parsed.decision), true);
  assert.throws(() => {
    (parsed.decision as { generationId: string }).generationId = "changed";
  }, TypeError);
});

test("16) parser does not infer missing values", () => {
  const missingScale = clone(minimalRecorded());
  delete (missingScale.pathA.derivation as { candidateScaleBeforeFallback?: unknown })
    .candidateScaleBeforeFallback;
  const parsed = parseAfcV2MetricDecision(missingScale);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.reason, /candidateScaleBeforeFallback_missing/);
  }
  assert.equal(
    JSON.stringify(parsed).includes("\"candidateScaleBeforeFallback\":null"),
    false,
  );
});

test("arbitrary json does not throw", () => {
  for (const value of [1, true, [], {}, "hello", Number.NaN]) {
    assert.doesNotThrow(() => parseAfcV2MetricDecision(value));
    const parsed = parseAfcV2MetricDecision(value);
    assert.equal(parsed.ok, false);
  }
});
