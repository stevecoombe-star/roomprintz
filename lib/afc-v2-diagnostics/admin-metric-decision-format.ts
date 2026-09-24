import type { AfcDiagnosticAdminMetricDecisionRecordedValue } from "./admin-metric-decision-dto";

export const AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE = "Not available";

const PATH_LABELS: Readonly<Record<string, string>> = {
  path_a: "Path A",
  path_b: "Path B",
  none: "None",
};

const FAILURE_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  metric_fallback: "Metric fallback",
  collision_empty: "Collision empty",
};

const SANITY_LABELS: Readonly<Record<string, string>> = {
  inside: "Inside",
  outside: "Outside",
  not_evaluated: "Not evaluated",
};

const LAUNCH_LABELS: Readonly<Record<string, string>> = {
  suppressed_complete_back_geometry: "Suppressed by complete back geometry",
  not_launched_no_candidate: "No candidate",
  not_launched_empty_bytes_missing: "EMPTY missing",
  not_launched_empty_mime_invalid: "EMPTY MIME invalid",
  not_launched_controlled_fixture: "Controlled fixture",
  launched: "Launched",
  launch_failed: "Launch failed",
  not_reached: "Not reached",
};

const LINEAGE_LABELS: Readonly<Record<string, string>> = {
  lineage_rejected: "Lineage rejected",
  not_lineage_rejected: "Not lineage rejected",
  not_evaluated: "Not evaluated",
};

function labeled(value: string | null, labels: Readonly<Record<string, string>>): string {
  if (value == null || value.length === 0) return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  return labels[value] ?? value;
}

export function formatAfcDiagnosticMetricNumber(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  }
  if (Object.is(value, -0)) return "0";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function formatAfcDiagnosticMetricBoolean(value: boolean | null): string {
  if (value == null) return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  return value ? "Yes" : "No";
}

export function formatAfcDiagnosticMetricConfidence(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  }
  if (value < 0 || value > 1) return formatAfcDiagnosticMetricNumber(value);
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function formatAfcDiagnosticMetricPoint(
  point: Readonly<{ x: number; y: number }> | null,
): string {
  if (!point) return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  return `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`;
}

export function formatAfcDiagnosticMetricTriple(
  value: Readonly<{ low: number; best: number; high: number }> | null,
): string {
  if (!value) return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  return `best ${formatAfcDiagnosticMetricNumber(value.best)} (low ${formatAfcDiagnosticMetricNumber(value.low)}, high ${formatAfcDiagnosticMetricNumber(value.high)})`;
}

export function formatAfcDiagnosticMetricPath(value: string | null): string {
  return labeled(value, PATH_LABELS);
}

export function formatAfcDiagnosticMetricFailureState(value: string | null): string {
  return labeled(value, FAILURE_LABELS);
}

export function formatAfcDiagnosticMetricSanity(value: string | null): string {
  return labeled(value, SANITY_LABELS);
}

export function formatAfcDiagnosticMetricLaunchDisposition(value: string | null): string {
  return labeled(value, LAUNCH_LABELS);
}

export function formatAfcDiagnosticMetricLineageStatus(value: string | null): string {
  return labeled(value, LINEAGE_LABELS);
}

export function formatAfcDiagnosticMetricToken(value: string | null): string {
  if (value == null || value.length === 0) return AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE;
  return value;
}

export function formatAfcDiagnosticMetricPathBOutcome(
  pathB: AfcDiagnosticAdminMetricDecisionRecordedValue["pathB"],
): string {
  if (pathB.derivation.accepted) return "Accepted";
  const launched = pathB.estimatorLaunched ||
    pathB.launchDisposition === "launched" ||
    pathB.launchDisposition === "launch_failed";
  if (pathB.model.estimatedLengthM != null) return "Rejected after a parsed estimate";
  if (launched) return "Launched but unusable";
  return "Never launched";
}
