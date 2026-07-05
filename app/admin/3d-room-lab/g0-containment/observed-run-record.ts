import type { BenchmarkFixtureReceipt, BenchmarkRunReceiptMetadata } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import { validateBenchmarkRunReceiptMetadata } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import type { BenchmarkOperationalState } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import type { G0ProbeId } from "./package";
import { G0_SUPPORTING_CHECKS } from "./supporting-checks";

export type G0ObservationKind =
  | "emitted_application_result"
  | "derived_containment_conclusion";

export type G0Outcome =
  | "pass"
  | "safety_mismatch"
  | "false_authority_event"
  | "invalid_run"
  | "infrastructure_failure"
  | "inconclusive";

export const G0_ASSURANCE_LEVELS = [
  "qualification_refusal_result",
  "restore_or_import_result",
  "route_response_result",
  "apply_gate_defense_in_depth",
  "client_discard_predicate",
  "live_snapshot_state_observation",
  "state_transition_predicate",
] as const;

export type G0NoAuthorityCheckId = (typeof G0_ASSURANCE_LEVELS)[number];

export type G0NoAuthorityCheckStatus = "pass" | "fail" | "not_run";
export type G0SupportingCheckStatus = "passed" | "failed" | "not_run";

export type G0NoAuthorityCheckRecord = {
  readonly checkId: G0NoAuthorityCheckId;
  readonly status: G0NoAuthorityCheckStatus;
  readonly notes?: string;
};

export type G0SupportingCheckFailureClass =
  | "infrastructure_failure"
  | "safety_mismatch"
  | "false_authority_event";

export type G0SupportingHarnessCheckRecord = {
  readonly checkId: string;
  readonly required: boolean;
  readonly status: G0SupportingCheckStatus;
  readonly failureClass: G0SupportingCheckFailureClass | null;
  readonly notes?: string;
};

export type G0PrimaryObservation = {
  readonly observationKind: G0ObservationKind;
  readonly observedPipelineStage: string;
  readonly observedOperationalState: BenchmarkOperationalState;
  readonly outcome: G0Outcome;
  readonly expectedVsObservedComparison: "matches_expected" | "mismatch";
  readonly emittedResult: string | null;
  readonly derivedContainmentConclusion: string | null;
  readonly rawObservationReferences: readonly string[];
};

export type G0ObservedRunRecord = {
  readonly probeId: G0ProbeId;
  readonly probePackageVersion: string;
  readonly fixtureReceiptReference: {
    readonly fixtureId: string;
    readonly fixtureVersion: string;
    readonly expectedRefusalOrContainmentResult: string | undefined;
    readonly expectedPipelineStage: string | undefined;
  };
  readonly runMetadata: BenchmarkRunReceiptMetadata;
  readonly primaryObservation: G0PrimaryObservation;
  readonly noAuthorityChecks: readonly G0NoAuthorityCheckRecord[];
  readonly supportingHarnessChecks: readonly G0SupportingHarnessCheckRecord[];
  readonly artifactReferences: readonly string[];
  readonly manualObservationLog: string | null;
  readonly incidentReference: string | null;
};

const FORBIDDEN_KEY_PARTS = [
  "authority_label",
  "evaluator",
  "capability",
  "metric",
  "external_reference",
  "externalreference",
] as const;

function hasForbiddenKeys(value: unknown): boolean {
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    return FORBIDDEN_KEY_PARTS.some((part) => lowered.includes(part));
  }
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (FORBIDDEN_KEY_PARTS.some((part) => lowered.includes(part))) {
      return true;
    }
    if (hasForbiddenKeys(nested)) return true;
  }
  return false;
}

function isFailureOutcome(value: G0Outcome): boolean {
  return value === "infrastructure_failure" || value === "safety_mismatch" || value === "false_authority_event";
}

function hasMeaningfulText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function validateG0ObservedRunRecord(input: {
  fixtureReceipt: BenchmarkFixtureReceipt;
  record: G0ObservedRunRecord;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const metadataResult = await validateBenchmarkRunReceiptMetadata(input.record.runMetadata);
  if (!metadataResult.ok) {
    return { ok: false, reason: `invalid_run_metadata:${metadataResult.reason}` };
  }

  if (input.record.primaryObservation.observedOperationalState !== "calibration_not_attempted") {
    return { ok: false, reason: "invalid_operational_state" };
  }

  if (hasForbiddenKeys(input.record)) {
    return { ok: false, reason: "forbidden_field_present" };
  }

  if (input.record.probeId !== input.fixtureReceipt.declaredProbeId) {
    return { ok: false, reason: "probe_mismatch" };
  }

  const isPStale = input.record.probeId === "P-stale";
  if (isPStale) {
    if (input.record.primaryObservation.observationKind !== "derived_containment_conclusion") {
      return { ok: false, reason: "probe_observation_kind_mismatch" };
    }
    if (input.record.primaryObservation.emittedResult !== null) {
      return { ok: false, reason: "stale_emitted_result_forbidden" };
    }
    if (!hasMeaningfulText(input.record.primaryObservation.derivedContainmentConclusion)) {
      return { ok: false, reason: "derived_containment_required" };
    }
    if (input.record.primaryObservation.rawObservationReferences.length === 0) {
      return { ok: false, reason: "raw_observation_references_required" };
    }
  } else {
    if (input.record.primaryObservation.observationKind !== "emitted_application_result") {
      return { ok: false, reason: "probe_observation_kind_mismatch" };
    }
    if (!hasMeaningfulText(input.record.primaryObservation.emittedResult)) {
      return { ok: false, reason: "emitted_result_required" };
    }
    if (input.record.primaryObservation.derivedContainmentConclusion !== null) {
      return { ok: false, reason: "derived_containment_forbidden_for_emitted_observation" };
    }
  }

  const noAuthorityCheckIds = new Set(input.record.noAuthorityChecks.map((check) => check.checkId));
  for (const checkId of G0_ASSURANCE_LEVELS) {
    if (!noAuthorityCheckIds.has(checkId)) {
      return { ok: false, reason: `missing_no_authority_check:${checkId}` };
    }
  }

  const supportedCheckIds = new Set(
    G0_SUPPORTING_CHECKS[input.record.probeId].map((check) => check.checkId)
  );
  const requiredCheckIds = new Set(
    G0_SUPPORTING_CHECKS[input.record.probeId]
      .filter((check) => check.required)
      .map((check) => check.checkId)
  );

  const supportingById = new Map<string, G0SupportingHarnessCheckRecord>();
  for (const check of input.record.supportingHarnessChecks) {
    if (!supportedCheckIds.has(check.checkId)) {
      return { ok: false, reason: `unknown_supporting_check:${check.checkId}` };
    }
    if (supportingById.has(check.checkId)) {
      return { ok: false, reason: `duplicate_supporting_check:${check.checkId}` };
    }
    supportingById.set(check.checkId, check);
    if (requiredCheckIds.has(check.checkId) && check.required !== true) {
      return { ok: false, reason: `required_supporting_check_flag_mismatch:${check.checkId}` };
    }
    if (check.status === "failed" && check.required && check.failureClass === null) {
      return { ok: false, reason: `required_supporting_failure_missing_class:${check.checkId}` };
    }
  }

  const requiredFailure = input.record.supportingHarnessChecks.find(
    (check) => check.required && check.status === "failed"
  );
  if (requiredFailure && !isFailureOutcome(input.record.primaryObservation.outcome)) {
    return { ok: false, reason: "required_supporting_failure_not_reflected_in_outcome" };
  }

  const requiredChecks = [...requiredCheckIds].map((id) => supportingById.get(id) ?? null);
  const missingRequiredCheck = [...requiredCheckIds].find((id) => !supportingById.has(id));
  if (input.record.primaryObservation.outcome === "pass") {
    if (missingRequiredCheck) {
      return { ok: false, reason: `missing_required_supporting_check:${missingRequiredCheck}` };
    }
    for (const check of requiredChecks) {
      if (!check) continue;
      if (check.status !== "passed") {
        return { ok: false, reason: `required_supporting_check_not_passed:${check.checkId}` };
      }
    }
  } else if (
    input.record.primaryObservation.outcome === "infrastructure_failure" ||
    input.record.primaryObservation.outcome === "inconclusive"
  ) {
    const hasIncompleteRequiredCheck =
      Boolean(missingRequiredCheck) ||
      requiredChecks.some((check) => check !== null && check.status === "not_run");
    if (hasIncompleteRequiredCheck) {
      const hasHarnessExplanation =
        hasMeaningfulText(input.record.manualObservationLog) ||
        input.record.supportingHarnessChecks.some((check) => hasMeaningfulText(check.notes));
      if (!hasHarnessExplanation) {
        return { ok: false, reason: "incomplete_supporting_checks_without_harness_explanation" };
      }
    }
  }

  return { ok: true };
}
