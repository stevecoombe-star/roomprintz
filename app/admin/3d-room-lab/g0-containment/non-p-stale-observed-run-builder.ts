import { readFile } from "node:fs/promises";
import type {
  BenchmarkRerunReason,
  BenchmarkRunIdentity,
  BenchmarkRunReceiptMetadata,
} from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import {
  buildBenchmarkRunId,
  buildBenchmarkRunIdentityFingerprint,
} from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import { G0_ASSURANCE_LEVELS, type G0ObservedRunRecord } from "./observed-run-record";
import type { NonPStaleProbeId, NonPStaleResolvedProvenance } from "./non-p-stale-provenance-resolver";
import { getNonPStaleNoAuthorityProfile } from "./non-p-stale-no-authority-profiles";
import { G0_PROBE_PACKAGE_VERSION } from "./package";
import {
  G0_RUN_IDENTITY_EVALUATION_VERSION,
  G0_RUN_IDENTITY_EVIDENCE_BUNDLE_VERSION,
  G0_RUN_IDENTITY_SOLVER_GENERATOR_VERSION,
} from "./run-identity-versions";
import { G0_SUPPORTING_CHECKS } from "./supporting-checks";

type JsonObject = Record<string, unknown>;

const ALLOWED_INPUT_KEYS = new Set(["createdAt", "executionNonce", "supersedesRunId", "rerunReason"]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRerunReason(value: unknown): value is BenchmarkRerunReason {
  return (
    value === "basis_changed" ||
    value === "coordinate_space_changed" ||
    value === "annotations_changed" ||
    value === "solver_generator_changed" ||
    value === "evaluation_changed" ||
    value === "evidence_bundle_changed" ||
    value === "incident_correction"
  );
}

export type NonPStaleMinimalInput = {
  readonly createdAt: string;
  readonly executionNonce: string;
  readonly supersedesRunId: string | null;
  readonly rerunReason: BenchmarkRerunReason;
};

export type DeterministicExecutionEvidence = {
  readonly mode: "deterministic_execution_observed";
  readonly emittedResult: string;
  readonly expectedVsObservedComparison: "matches_expected" | "mismatch";
  readonly outcome: "pass" | "safety_mismatch" | "false_authority_event" | "invalid_run" | "infrastructure_failure" | "inconclusive";
  readonly supportingChecks: ReadonlyArray<{
    readonly checkId: string;
    readonly status: "passed" | "failed" | "not_run";
    readonly failureClass: "infrastructure_failure" | "safety_mismatch" | "false_authority_event" | null;
    readonly notes?: string;
  }>;
  readonly pinnedCallInputs: readonly string[];
  readonly artifactReferences: readonly string[];
  readonly manualObservationLog: string;
};

export type ExecutionAdapterAttestedEvidence = {
  readonly mode: "execution_adapter_attested";
  readonly adapterId: string;
  readonly emittedResult: string;
  readonly expectedVsObservedComparison: "matches_expected" | "mismatch";
  readonly outcome: "pass" | "safety_mismatch" | "false_authority_event" | "invalid_run" | "infrastructure_failure" | "inconclusive";
  readonly supportingChecks: ReadonlyArray<{
    readonly checkId: string;
    readonly status: "passed" | "failed" | "not_run";
    readonly failureClass: "infrastructure_failure" | "safety_mismatch" | "false_authority_event" | null;
    readonly notes?: string;
  }>;
  readonly pinnedCallInputs: readonly string[];
  readonly artifactReferences: readonly string[];
  readonly manualObservationLog: string;
};

export type NonPStaleExecutionEvidence =
  | DeterministicExecutionEvidence
  | ExecutionAdapterAttestedEvidence;

export function parseNonPStaleMinimalInput(rawInput: unknown): NonPStaleMinimalInput {
  if (!isObject(rawInput)) {
    throw new Error("input_must_be_object");
  }
  const unknownKeys = Object.keys(rawInput).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`forbidden_or_unknown_input_fields:${unknownKeys.sort().join(",")}`);
  }
  if (!isNonBlankString(rawInput.createdAt)) {
    throw new Error("invalid_createdAt");
  }
  if (!isNonBlankString(rawInput.executionNonce)) {
    throw new Error("invalid_executionNonce");
  }
  const supersedesRunId =
    typeof rawInput.supersedesRunId === "undefined" || rawInput.supersedesRunId === null
      ? null
      : rawInput.supersedesRunId;
  if (supersedesRunId !== null && !isNonBlankString(supersedesRunId)) {
    throw new Error("invalid_supersedesRunId");
  }
  if (!isRerunReason(rawInput.rerunReason)) {
    throw new Error("invalid_rerunReason");
  }
  return {
    createdAt: rawInput.createdAt.trim(),
    executionNonce: rawInput.executionNonce.trim(),
    supersedesRunId: supersedesRunId === null ? null : supersedesRunId.trim(),
    rerunReason: rawInput.rerunReason,
  };
}

export async function readAndParseNonPStaleMinimalInputFile(
  inputPath: string
): Promise<NonPStaleMinimalInput> {
  const rawText = await readFile(inputPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("invalid_json");
  }
  return parseNonPStaleMinimalInput(parsed);
}

function assertSupportingChecksMatchDeclaration(
  probeId: NonPStaleProbeId,
  supportingChecks: NonPStaleExecutionEvidence["supportingChecks"]
): void {
  const expected = G0_SUPPORTING_CHECKS[probeId];
  const expectedIds = new Set(expected.map((check) => check.checkId));
  const seen = new Set<string>();
  for (const check of supportingChecks) {
    if (!expectedIds.has(check.checkId)) {
      throw new Error(`unknown_supporting_check:${check.checkId}`);
    }
    if (seen.has(check.checkId)) {
      throw new Error(`duplicate_supporting_check:${check.checkId}`);
    }
    seen.add(check.checkId);
    if (check.status !== "passed") {
      throw new Error(`required_supporting_check_not_passed:${check.checkId}`);
    }
    if (check.failureClass !== null) {
      throw new Error(`non_failed_supporting_check_must_have_null_failure_class:${check.checkId}`);
    }
  }
  for (const check of expected) {
    if (check.required && !seen.has(check.checkId)) {
      throw new Error(`missing_required_supporting_check:${check.checkId}`);
    }
  }
}

function assertExecutionEvidence(mode: NonPStaleExecutionEvidence): void {
  if (!Array.isArray(mode.pinnedCallInputs) || mode.pinnedCallInputs.length === 0) {
    throw new Error("pinned_call_inputs_required");
  }
  for (const entry of mode.pinnedCallInputs) {
    if (!isNonBlankString(entry)) {
      throw new Error("invalid_pinned_call_input");
    }
  }
  if (!Array.isArray(mode.artifactReferences)) {
    throw new Error("artifact_references_must_be_array");
  }
  for (const reference of mode.artifactReferences) {
    if (!isNonBlankString(reference)) {
      throw new Error("invalid_artifact_reference");
    }
  }
  if (!isNonBlankString(mode.manualObservationLog)) {
    throw new Error("manual_observation_log_required");
  }
  if (mode.mode === "execution_adapter_attested" && !isNonBlankString(mode.adapterId)) {
    throw new Error("invalid_execution_adapter_id");
  }
}

export async function buildNonPStaleRunMetadata(input: {
  minimalInput: NonPStaleMinimalInput;
  provenance: NonPStaleResolvedProvenance;
}): Promise<BenchmarkRunReceiptMetadata> {
  const runIdentity: BenchmarkRunIdentity = {
    fixtureVersion: input.provenance.fixtureReceipt.fixtureVersion,
    basisFingerprint: input.provenance.runIdentityBasisFingerprint,
    coordinateSpaceVersion: input.provenance.runIdentityCoordinateSpaceVersion,
    solverGeneratorVersion: G0_RUN_IDENTITY_SOLVER_GENERATOR_VERSION,
    evaluationVersion: G0_RUN_IDENTITY_EVALUATION_VERSION,
    evidenceBundleVersion: G0_RUN_IDENTITY_EVIDENCE_BUNDLE_VERSION,
  };
  const runId = await buildBenchmarkRunId({
    runIdentity,
    executionNonce: input.minimalInput.executionNonce,
  });
  if (!runId) {
    throw new Error("invalid_run_identity_or_execution_nonce");
  }
  return {
    runId,
    runIdentityFingerprint: await buildBenchmarkRunIdentityFingerprint(runIdentity),
    runIdentity,
    createdAt: input.minimalInput.createdAt,
    supersedesRunId: input.minimalInput.supersedesRunId,
    rerunReason: input.minimalInput.rerunReason,
  };
}

export function buildNonPStaleObservedRunRecord(input: {
  probeId: NonPStaleProbeId;
  provenance: NonPStaleResolvedProvenance;
  runMetadata: BenchmarkRunReceiptMetadata;
  execution: NonPStaleExecutionEvidence;
}): G0ObservedRunRecord {
  if ((input.probeId as string) === "P-stale") {
    throw new Error("non_p_stale_builder_rejects_p_stale");
  }
  assertExecutionEvidence(input.execution);
  assertSupportingChecksMatchDeclaration(input.probeId, input.execution.supportingChecks);
  const expectedResult = input.provenance.fixtureReceipt.expectedRefusalOrContainmentResult;
  if (!expectedResult || input.execution.emittedResult !== expectedResult) {
    throw new Error("emitted_result_must_match_declaration_exactly");
  }
  if (input.execution.expectedVsObservedComparison !== "matches_expected") {
    throw new Error("expected_vs_observed_must_be_matches_expected");
  }
  const supportingDefinitionById = new Map(
    G0_SUPPORTING_CHECKS[input.probeId].map((definition) => [definition.checkId, definition] as const)
  );
  const supportingHarnessChecks = input.execution.supportingChecks.map((check) => {
    const definition = supportingDefinitionById.get(check.checkId);
    if (!definition) {
      throw new Error(`unknown_supporting_check:${check.checkId}`);
    }
    return {
      checkId: check.checkId,
      required: definition.required,
      status: check.status,
      failureClass: check.failureClass,
      notes: check.notes,
    };
  });
  const profile = getNonPStaleNoAuthorityProfile(input.probeId);
  const noAuthorityChecks = G0_ASSURANCE_LEVELS.map((checkId) => ({
    checkId,
    status: profile[checkId],
  }));
  const modeLabel =
    input.execution.mode === "deterministic_execution_observed"
      ? "deterministic_execution_observed"
      : `execution_adapter_attested:${input.execution.adapterId}`;
  const payloadClarification =
    input.provenance.payloadIdentity && input.provenance.payloadDigest
      ? [
          "payload-only probe: no image basis fetched or evaluated; runIdentity.basisFingerprint carries canonical payload digest",
        ]
      : [];
  return {
    probeId: input.probeId,
    probePackageVersion: G0_PROBE_PACKAGE_VERSION,
    fixtureReceiptReference: {
      fixtureId: input.provenance.fixtureReceipt.fixtureId,
      fixtureVersion: input.provenance.fixtureReceipt.fixtureVersion,
      expectedRefusalOrContainmentResult:
        input.provenance.fixtureReceipt.expectedRefusalOrContainmentResult,
      expectedPipelineStage: input.provenance.fixtureReceipt.expectedPipelineStage,
    },
    runMetadata: input.runMetadata,
    primaryObservation: {
      observationKind: "emitted_application_result",
      observedPipelineStage: input.provenance.fixtureReceipt.expectedPipelineStage!,
      observedOperationalState: "calibration_not_attempted",
      outcome: input.execution.outcome,
      expectedVsObservedComparison: input.execution.expectedVsObservedComparison,
      emittedResult: input.execution.emittedResult,
      derivedContainmentConclusion: null,
      rawObservationReferences: [],
    },
    noAuthorityChecks,
    supportingHarnessChecks,
    artifactReferences: [
      ...input.provenance.artifactReferences,
      ...input.execution.artifactReferences,
      `execution_mode:${modeLabel}`,
      ...input.execution.pinnedCallInputs.map((entry) => `pinned_call_input:${entry}`),
    ],
    manualObservationLog: [input.execution.manualObservationLog, ...payloadClarification].join("\n"),
    incidentReference: null,
  };
}
