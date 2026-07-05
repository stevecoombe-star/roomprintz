import { readFile } from "node:fs/promises";
import type {
  BenchmarkFixtureReceipt,
  BenchmarkRerunReason,
  BenchmarkRunIdentity,
  BenchmarkRunReceiptMetadata,
} from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import {
  BENCHMARK_P_STALE_CONTAINMENT_RESULT,
  buildBenchmarkRunId,
  buildBenchmarkRunIdentityFingerprint,
  isValidSha256Digest,
} from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import type { G0ObservedRunRecord, G0Outcome } from "./observed-run-record";
import { G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";
import { G0_PROBE_PACKAGE_VERSION } from "./package";
import {
  P_STALE_PRECONDITION_V2_ASSET_ID,
  P_STALE_PRECONDITION_V2_FILE_NAME,
  P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH,
} from "./p-stale-precondition-v2-spec";

type JsonObject = Record<string, unknown>;

const STALE_PROBE_ID = "P-stale" as const;
const STALE_OBSERVATION_KIND = "derived_containment_conclusion" as const;
const STALE_PIPELINE_STAGE = "live frame-state transition" as const;
const STALE_OPERATIONAL_STATE = "calibration_not_attempted" as const;
const REQUIRED_SUPPORTING_CHECK_IDS = [
  "shouldDropAuthorityOnFrameChange_predicate",
  "precondition_artifact_readouts",
] as const;
const P_STALE_ACTIVE_PUBLIC_ORIGIN = "http://localhost:3000";
const FORBIDDEN_OVERRIDE_FIELDS = new Set([
  "probeid",
  "probepackageversion",
  "observationkind",
  "observedpipelinestage",
  "observedoperationalstate",
  "emittedresult",
  "derivedcontainmentconclusion",
  "fixturereceiptreference",
  "fixturedeclarationidentity",
  "requiredsupportingcheckidentifiers",
  "incidentreference",
]);

export type PStaleActivePreconditionBinding = {
  readonly fixtureVersion: string;
  readonly sourceAssetId: string;
  readonly expectedPublicUrl: string;
  readonly expectedSha256: string;
};

function normalizeOverrideFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseNonNegativeIntegerField(
  parent: JsonObject,
  field: string,
  context: string
): number {
  const value = parent[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid_${context}_${field}`);
  }
  return value;
}

function parseFrameEvidenceField(value: unknown, fieldName: string): {
  width: number;
  height: number;
  rawObservationReference: string;
} {
  if (!isObject(value)) {
    throw new Error(`invalid_${fieldName}`);
  }
  const width = parseNonNegativeIntegerField(value, "width", fieldName);
  const height = parseNonNegativeIntegerField(value, "height", fieldName);
  const rawObservationReference = value.rawObservationReference;
  if (!isNonBlankString(rawObservationReference)) {
    throw new Error(`invalid_${fieldName}_rawObservationReference`);
  }
  return {
    width,
    height,
    rawObservationReference: rawObservationReference.trim(),
  };
}

function parseObservedClassification(value: unknown): {
  outcome: G0Outcome;
  expectedVsObservedComparison: "matches_expected" | "mismatch";
} {
  if (!isObject(value)) {
    throw new Error("invalid_observedClassification");
  }
  const outcome = value.outcome;
  const expectedVsObservedComparison = value.expectedVsObservedComparison;
  const allowedOutcomes: readonly G0Outcome[] = [
    "pass",
    "safety_mismatch",
    "false_authority_event",
    "invalid_run",
    "infrastructure_failure",
    "inconclusive",
  ];
  if (typeof outcome !== "string" || !allowedOutcomes.includes(outcome as G0Outcome)) {
    throw new Error("invalid_observedClassification_outcome");
  }
  if (
    expectedVsObservedComparison !== "matches_expected" &&
    expectedVsObservedComparison !== "mismatch"
  ) {
    throw new Error("invalid_observedClassification_expectedVsObservedComparison");
  }
  if (outcome === "pass" && expectedVsObservedComparison !== "matches_expected") {
    throw new Error("pass_requires_matches_expected");
  }
  return {
    outcome: outcome as G0Outcome,
    expectedVsObservedComparison,
  };
}

function hasFrameDimensionTransition(input: {
  baselineFrame: { width: number; height: number };
  postTriggerFrame: { width: number; height: number };
}): boolean {
  return (
    input.baselineFrame.width !== input.postTriggerFrame.width ||
    input.baselineFrame.height !== input.postTriggerFrame.height
  );
}

function parseCoordinateSpaceVersion(value: unknown): BenchmarkRunIdentity["coordinateSpaceVersion"] {
  if (!isObject(value)) {
    throw new Error("invalid_runIdentity_coordinateSpaceVersion");
  }
  const decoderId = value.decoderId;
  const normalizationPolicyVersion = value.normalizationPolicyVersion;
  const orientationApplied = value.orientationApplied;
  if (!isNonBlankString(decoderId)) {
    throw new Error("invalid_runIdentity_coordinateSpaceVersion_decoderId");
  }
  if (!isNonBlankString(normalizationPolicyVersion)) {
    throw new Error("invalid_runIdentity_coordinateSpaceVersion_normalizationPolicyVersion");
  }
  if (typeof orientationApplied !== "boolean") {
    throw new Error("invalid_runIdentity_coordinateSpaceVersion_orientationApplied");
  }
  return {
    decoderId: decoderId.trim(),
    normalizationPolicyVersion: normalizationPolicyVersion.trim(),
    orientationApplied,
  };
}

function parseRunIdentity(value: unknown): BenchmarkRunIdentity {
  if (!isObject(value)) {
    throw new Error("invalid_runIdentity");
  }
  if (!isNonBlankString(value.fixtureVersion)) {
    throw new Error("invalid_runIdentity_fixtureVersion");
  }
  if (!isNonBlankString(value.basisFingerprint) || !isValidSha256Digest(value.basisFingerprint.trim())) {
    throw new Error("invalid_runIdentity_basisFingerprint");
  }
  if (!isNonBlankString(value.solverGeneratorVersion)) {
    throw new Error("invalid_runIdentity_solverGeneratorVersion");
  }
  if (!isNonBlankString(value.evaluationVersion)) {
    throw new Error("invalid_runIdentity_evaluationVersion");
  }
  if (!isNonBlankString(value.evidenceBundleVersion)) {
    throw new Error("invalid_runIdentity_evidenceBundleVersion");
  }
  return {
    fixtureVersion: value.fixtureVersion.trim(),
    basisFingerprint: value.basisFingerprint.trim(),
    coordinateSpaceVersion: parseCoordinateSpaceVersion(value.coordinateSpaceVersion),
    solverGeneratorVersion: value.solverGeneratorVersion.trim(),
    evaluationVersion: value.evaluationVersion.trim(),
    evidenceBundleVersion: value.evidenceBundleVersion.trim(),
  };
}

function ensureNoForbiddenOverrides(value: unknown, keyPath: string[] = []): void {
  if (!isObject(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      ensureNoForbiddenOverrides(value[i], keyPath.concat(`[${i}]`));
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_OVERRIDE_FIELDS.has(normalizeOverrideFieldKey(key))) {
      const pathLabel = keyPath.concat(key).join(".");
      throw new Error(`forbidden_override_field:${pathLabel}`);
    }
    ensureNoForbiddenOverrides(nested, keyPath.concat(key));
  }
}

function parseSupportingCheck(
  value: unknown,
  fieldName: string
): {
  status: "passed" | "failed" | "not_run";
  failureClass: "infrastructure_failure" | "safety_mismatch" | "false_authority_event" | null;
  notes?: string;
} {
  if (!isObject(value)) {
    throw new Error(`invalid_supportingChecks_${fieldName}`);
  }
  const status = value.status;
  if (status !== "passed" && status !== "failed" && status !== "not_run") {
    throw new Error(`invalid_supportingChecks_${fieldName}_status`);
  }
  const failureClass = value.failureClass;
  if (
    failureClass !== null &&
    failureClass !== "infrastructure_failure" &&
    failureClass !== "safety_mismatch" &&
    failureClass !== "false_authority_event"
  ) {
    throw new Error(`invalid_supportingChecks_${fieldName}_failureClass`);
  }
  if (status === "failed" && failureClass === null) {
    throw new Error(`failed_supportingChecks_${fieldName}_requires_failureClass`);
  }
  if ((status === "passed" || status === "not_run") && failureClass !== null) {
    throw new Error(`non_failed_supportingChecks_${fieldName}_must_have_null_failureClass`);
  }
  const notes = value.notes;
  if (typeof notes !== "undefined" && !isNonBlankString(notes)) {
    throw new Error(`invalid_supportingChecks_${fieldName}_notes`);
  }
  return {
    status,
    failureClass,
    notes: typeof notes === "string" ? notes.trim() : undefined,
  };
}

export type PStaleObservedRunWriterInput = {
  readonly createdAt: string;
  readonly runIdentity: BenchmarkRunIdentity;
  readonly executionNonce: string;
  readonly supersedesRunId: string | null;
  readonly rerunReason: BenchmarkRerunReason;
  readonly baselineFrame: {
    readonly width: number;
    readonly height: number;
    readonly rawObservationReference: string;
  };
  readonly postTriggerFrame: {
    readonly width: number;
    readonly height: number;
    readonly rawObservationReference: string;
  };
  readonly preconditionArtifact: {
    readonly url: string;
    readonly sha256: string;
  };
  readonly manualObservationLog: string;
  readonly observedClassification: {
    readonly outcome: G0Outcome;
    readonly expectedVsObservedComparison: "matches_expected" | "mismatch";
  };
  readonly supportingChecks?: {
    readonly shouldDropAuthorityOnFrameChange_predicate: {
      readonly status: "passed" | "failed" | "not_run";
      readonly failureClass:
        | "infrastructure_failure"
        | "safety_mismatch"
        | "false_authority_event"
        | null;
      readonly notes?: string;
    };
    readonly precondition_artifact_readouts: {
      readonly status: "passed" | "failed" | "not_run";
      readonly failureClass:
        | "infrastructure_failure"
        | "safety_mismatch"
        | "false_authority_event"
        | null;
      readonly notes?: string;
    };
  };
};

export function resolvePStaleActivePreconditionBinding(
  fixtureReceipt: BenchmarkFixtureReceipt
): PStaleActivePreconditionBinding {
  if (fixtureReceipt.declaredProbeId !== "P-stale") {
    throw new Error("fixture_must_be_p_stale");
  }
  if (fixtureReceipt.sourceAssetIdentity.kind !== "source_asset") {
    throw new Error("p_stale_declaration_source_asset_required");
  }
  if (fixtureReceipt.sourceAssetIdentity.sourceAssetId !== P_STALE_PRECONDITION_V2_ASSET_ID) {
    throw new Error("p_stale_declaration_source_asset_mismatch");
  }
  const registryAsset = G0_SYNTHETIC_ASSETS[P_STALE_PRECONDITION_V2_ASSET_ID];
  if (registryAsset.assetId !== fixtureReceipt.sourceAssetIdentity.sourceAssetId) {
    throw new Error("p_stale_registry_asset_binding_mismatch");
  }
  if (registryAsset.fileName !== P_STALE_PRECONDITION_V2_FILE_NAME) {
    throw new Error("p_stale_registry_filename_mismatch");
  }
  if (
    P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH !==
    `/3d-lab/room-images/${registryAsset.fileName}`
  ) {
    throw new Error("p_stale_public_url_path_mismatch");
  }
  return {
    fixtureVersion: fixtureReceipt.fixtureVersion,
    sourceAssetId: fixtureReceipt.sourceAssetIdentity.sourceAssetId,
    expectedPublicUrl: new URL(
      P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH,
      P_STALE_ACTIVE_PUBLIC_ORIGIN
    ).toString(),
    expectedSha256: registryAsset.sha256,
  };
}

export async function parsePStaleObservedRunWriterInput(
  rawInput: unknown,
  binding: PStaleActivePreconditionBinding
): Promise<PStaleObservedRunWriterInput> {
  ensureNoForbiddenOverrides(rawInput);

  if (!isObject(rawInput)) {
    throw new Error("input_must_be_object");
  }

  const createdAt = rawInput.createdAt;
  if (!isNonBlankString(createdAt)) {
    throw new Error("invalid_createdAt");
  }

  const runIdentity = parseRunIdentity(rawInput.runIdentity);

  const executionNonce = rawInput.executionNonce;
  if (!isNonBlankString(executionNonce)) {
    throw new Error("invalid_executionNonce");
  }

  const rerunReason = rawInput.rerunReason;
  if (
    rerunReason !== "basis_changed" &&
    rerunReason !== "coordinate_space_changed" &&
    rerunReason !== "annotations_changed" &&
    rerunReason !== "solver_generator_changed" &&
    rerunReason !== "evaluation_changed" &&
    rerunReason !== "evidence_bundle_changed" &&
    rerunReason !== "incident_correction"
  ) {
    throw new Error("invalid_rerunReason");
  }

  const supersedesRunId =
    typeof rawInput.supersedesRunId === "undefined" || rawInput.supersedesRunId === null
      ? null
      : rawInput.supersedesRunId;
  if (supersedesRunId !== null && !isNonBlankString(supersedesRunId)) {
    throw new Error("invalid_supersedesRunId");
  }

  const baselineFrame = parseFrameEvidenceField(rawInput.baselineFrame, "baselineFrame");
  const postTriggerFrame = parseFrameEvidenceField(
    rawInput.postTriggerFrame,
    "postTriggerFrame"
  );

  if (!isObject(rawInput.preconditionArtifact)) {
    throw new Error("invalid_preconditionArtifact");
  }
  const artifactUrl = rawInput.preconditionArtifact.url;
  if (!isNonBlankString(artifactUrl)) {
    throw new Error("invalid_preconditionArtifact_url");
  }
  const artifactSha = rawInput.preconditionArtifact.sha256;
  if (!isNonBlankString(artifactSha) || !isValidSha256Digest(artifactSha.trim())) {
    throw new Error("invalid_preconditionArtifact_sha256");
  }

  const manualObservationLog = rawInput.manualObservationLog;
  if (!isNonBlankString(manualObservationLog)) {
    throw new Error("invalid_manualObservationLog");
  }

  const observedClassification = parseObservedClassification(rawInput.observedClassification);
  if (
    observedClassification.outcome === "pass" &&
    typeof rawInput.supportingChecks !== "undefined"
  ) {
    throw new Error("pass_forbids_supportingChecks_override");
  }

  let supportingChecks:
    | {
        shouldDropAuthorityOnFrameChange_predicate: {
          status: "passed" | "failed" | "not_run";
          failureClass:
            | "infrastructure_failure"
            | "safety_mismatch"
            | "false_authority_event"
            | null;
          notes?: string;
        };
        precondition_artifact_readouts: {
          status: "passed" | "failed" | "not_run";
          failureClass:
            | "infrastructure_failure"
            | "safety_mismatch"
            | "false_authority_event"
            | null;
          notes?: string;
        };
      }
    | undefined;
  if (typeof rawInput.supportingChecks !== "undefined") {
    if (!isObject(rawInput.supportingChecks)) {
      throw new Error("invalid_supportingChecks");
    }
    supportingChecks = {
      shouldDropAuthorityOnFrameChange_predicate: parseSupportingCheck(
        rawInput.supportingChecks.shouldDropAuthorityOnFrameChange_predicate,
        "shouldDropAuthorityOnFrameChange_predicate"
      ),
      precondition_artifact_readouts: parseSupportingCheck(
        rawInput.supportingChecks.precondition_artifact_readouts,
        "precondition_artifact_readouts"
      ),
    };
  }

  const normalizedArtifactUrl = artifactUrl.trim();
  const normalizedArtifactSha = artifactSha.trim();
  if (normalizedArtifactUrl !== binding.expectedPublicUrl) {
    throw new Error("preconditionArtifact_url_must_match_active_v2");
  }
  if (normalizedArtifactSha !== binding.expectedSha256) {
    throw new Error("preconditionArtifact_sha256_must_match_active_v2");
  }
  if (runIdentity.basisFingerprint !== binding.expectedSha256) {
    throw new Error("basisFingerprint_must_match_active_v2_sha256");
  }

  const baselineAndPostTriggerDiffer = hasFrameDimensionTransition({
    baselineFrame,
    postTriggerFrame,
  });
  if (observedClassification.outcome === "pass" && !baselineAndPostTriggerDiffer) {
    throw new Error("pass_requires_frame_dimension_change");
  }
  if (!baselineAndPostTriggerDiffer && observedClassification.outcome !== "inconclusive") {
    throw new Error("identical_frame_requires_inconclusive_outcome");
  }
  if (
    !baselineAndPostTriggerDiffer &&
    observedClassification.expectedVsObservedComparison !== "mismatch"
  ) {
    throw new Error("identical_frame_requires_mismatch_comparison");
  }

  return {
    createdAt: createdAt.trim(),
    runIdentity: {
      ...runIdentity,
      fixtureVersion: binding.fixtureVersion,
    },
    executionNonce: executionNonce.trim(),
    supersedesRunId: supersedesRunId === null ? null : supersedesRunId.trim(),
    rerunReason,
    baselineFrame,
    postTriggerFrame,
    preconditionArtifact: {
      url: normalizedArtifactUrl,
      sha256: normalizedArtifactSha,
    },
    manualObservationLog: manualObservationLog.trim(),
    observedClassification,
    supportingChecks,
  };
}

export async function readAndParsePStaleObservedRunWriterInputFile(
  inputPath: string,
  binding: PStaleActivePreconditionBinding
): Promise<PStaleObservedRunWriterInput> {
  const rawText = await readFile(inputPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("invalid_json");
  }
  return parsePStaleObservedRunWriterInput(parsed, binding);
}

export async function buildPStaleRunMetadata(
  input: PStaleObservedRunWriterInput
): Promise<BenchmarkRunReceiptMetadata> {
  const runId = await buildBenchmarkRunId({
    runIdentity: input.runIdentity,
    executionNonce: input.executionNonce,
  });
  if (!runId) {
    throw new Error("invalid_run_identity_or_execution_nonce");
  }
  const runIdentityFingerprint = await buildBenchmarkRunIdentityFingerprint(
    input.runIdentity
  );
  return {
    runId,
    runIdentityFingerprint,
    runIdentity: input.runIdentity,
    createdAt: input.createdAt,
    supersedesRunId: input.supersedesRunId,
    rerunReason: input.rerunReason,
  };
}

function buildNoAuthorityChecks(outcome: G0Outcome): G0ObservedRunRecord["noAuthorityChecks"] {
  const stateTransitionStatus =
    outcome === "pass"
      ? "pass"
      : outcome === "infrastructure_failure" || outcome === "inconclusive"
        ? "not_run"
        : "fail";
  return [
    { checkId: "qualification_refusal_result", status: "not_run" },
    { checkId: "restore_or_import_result", status: "not_run" },
    { checkId: "route_response_result", status: "not_run" },
    { checkId: "apply_gate_defense_in_depth", status: "not_run" },
    { checkId: "client_discard_predicate", status: "not_run" },
    { checkId: "live_snapshot_state_observation", status: stateTransitionStatus },
    { checkId: "state_transition_predicate", status: stateTransitionStatus },
  ];
}

function buildSupportingChecks(
  parsedInput: PStaleObservedRunWriterInput
): G0ObservedRunRecord["supportingHarnessChecks"] {
  if (parsedInput.observedClassification.outcome === "pass") {
    return REQUIRED_SUPPORTING_CHECK_IDS.map((checkId) => ({
      checkId,
      required: true as const,
      status: "passed" as const,
      failureClass: null,
    }));
  }

  const userChecks = parsedInput.supportingChecks;
  if (!userChecks) {
    throw new Error("non_pass_outcomes_require_supportingChecks");
  }
  return [
    {
      checkId: REQUIRED_SUPPORTING_CHECK_IDS[0],
      required: true,
      status: userChecks.shouldDropAuthorityOnFrameChange_predicate.status,
      failureClass: userChecks.shouldDropAuthorityOnFrameChange_predicate.failureClass,
      notes: userChecks.shouldDropAuthorityOnFrameChange_predicate.notes,
    },
    {
      checkId: REQUIRED_SUPPORTING_CHECK_IDS[1],
      required: true,
      status: userChecks.precondition_artifact_readouts.status,
      failureClass: userChecks.precondition_artifact_readouts.failureClass,
      notes: userChecks.precondition_artifact_readouts.notes,
    },
  ];
}

export function buildPStaleObservedRunRecord(input: {
  fixtureReceipt: {
    fixtureId: string;
    fixtureVersion: string;
    expectedRefusalOrContainmentResult?: string;
    expectedPipelineStage?: string;
  };
  runMetadata: BenchmarkRunReceiptMetadata;
  parsedInput: PStaleObservedRunWriterInput;
}): G0ObservedRunRecord {
  return {
    probeId: STALE_PROBE_ID,
    probePackageVersion: G0_PROBE_PACKAGE_VERSION,
    fixtureReceiptReference: {
      fixtureId: input.fixtureReceipt.fixtureId,
      fixtureVersion: input.fixtureReceipt.fixtureVersion,
      expectedRefusalOrContainmentResult:
        input.fixtureReceipt.expectedRefusalOrContainmentResult,
      expectedPipelineStage: input.fixtureReceipt.expectedPipelineStage,
    },
    runMetadata: input.runMetadata,
    primaryObservation: {
      observationKind: STALE_OBSERVATION_KIND,
      observedPipelineStage: STALE_PIPELINE_STAGE,
      observedOperationalState: STALE_OPERATIONAL_STATE,
      outcome: input.parsedInput.observedClassification.outcome,
      expectedVsObservedComparison:
        input.parsedInput.observedClassification.expectedVsObservedComparison,
      emittedResult: null,
      derivedContainmentConclusion: BENCHMARK_P_STALE_CONTAINMENT_RESULT,
      rawObservationReferences: [
        input.parsedInput.baselineFrame.rawObservationReference,
        input.parsedInput.postTriggerFrame.rawObservationReference,
      ],
    },
    noAuthorityChecks: buildNoAuthorityChecks(
      input.parsedInput.observedClassification.outcome
    ),
    supportingHarnessChecks: buildSupportingChecks(input.parsedInput),
    artifactReferences: [
      `precondition_artifact_url:${input.parsedInput.preconditionArtifact.url}`,
      `precondition_artifact_sha256:${input.parsedInput.preconditionArtifact.sha256}`,
      `baseline_frame_dimensions:${input.parsedInput.baselineFrame.width}x${input.parsedInput.baselineFrame.height}`,
      `post_trigger_frame_dimensions:${input.parsedInput.postTriggerFrame.width}x${input.parsedInput.postTriggerFrame.height}`,
    ],
    manualObservationLog: input.parsedInput.manualObservationLog,
    incidentReference: null,
  };
}
