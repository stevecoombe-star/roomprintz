/**
 * AFR-2A visual evidence for the persisted metric span.
 *
 * Read-only. Does not select a span, evaluate trust, or infer endpoints.
 *
 * Path A imageA/imageB are original-source-normalized (top-left, [0,1])
 * and draw on ORIGINAL only.
 * Path B host-geometry imageA/imageB are empty-source-normalized (top-left,
 * [0,1]), from the observed-span EMPTY polyline, and draw on EMPTY only.
 */

import type { AfcDiagnosticAdminMetricDecision } from "./admin-metric-decision-dto";
import { formatAfcDiagnosticMetricLaunchDisposition } from "./admin-metric-decision-format";
import type { AfcDiagnosticVisualArtifactKind } from "./admin-visual-evidence.client";

export const AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_IMAGE_SPACE =
  "original-source-normalized-image/v1" as const;

export const AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE =
  "empty-source-normalized-image/v1" as const;

/** Path A frame. Kept for existing call sites. */
export const AFC_DIAGNOSTIC_METRIC_SPAN_IMAGE_SPACE =
  AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_IMAGE_SPACE;

export const AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_KIND =
  "original" as const satisfies AfcDiagnosticVisualArtifactKind;

export const AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_KIND =
  "empty" as const satisfies AfcDiagnosticVisualArtifactKind;

/** @deprecated Path A frame. Use the per-path target on the overlay model. */
export const AFC_DIAGNOSTIC_METRIC_SPAN_TARGET_KIND =
  AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_KIND;

export const AFC_DIAGNOSTIC_METRIC_SPAN_COPY = {
  label: "Metric span",
  help: "Path A is on ORIGINAL. Path B is on EMPTY.",
  unavailable: "No metric span available",
  pathA: "Path A",
  pathB: "Path B",
  trusted: "Path A — Trusted",
  rejected: "Path A — Rejected",
  trustUnavailable: "Path A — Trust unavailable",
  pathBAccepted: "Path B — Accepted",
  pathBRejected: "Path B — Rejected",
  pathBUnusable: "Path B — Unusable",
} as const;

export type AfcDiagnosticMetricSpanSourcePath = "path_a" | "path_b";

export type AfcDiagnosticMetricSpanLineStyle = "solid" | "dashed" | "dotted";

export type AfcDiagnosticMetricSpanPoint = Readonly<{
  x: number;
  y: number;
}>;

export type AfcDiagnosticMetricSpanOverlayModel = Readonly<{
  sourcePath: AfcDiagnosticMetricSpanSourcePath;
  imageSpace:
    | typeof AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_IMAGE_SPACE
    | typeof AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE;
  targetKind: AfcDiagnosticVisualArtifactKind;
  imageA: AfcDiagnosticMetricSpanPoint;
  imageB: AfcDiagnosticMetricSpanPoint;
  spanId: string;
  reasonCodes: readonly string[];
  role: string;
  canonicalLength: number;
  statusLabel: string;
  lineStyle: AfcDiagnosticMetricSpanLineStyle;
}>;

function finitePoint(
  point: Readonly<{ x: number; y: number }> | null | undefined,
): point is AfcDiagnosticMetricSpanPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pathAModel(
  decision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>,
): AfcDiagnosticMetricSpanOverlayModel | null {
  const span = decision.value.pathA.geometryCorrespondence.selectedSpan;
  if (!span) return null;
  if (!finitePoint(span.imageA) || !finitePoint(span.imageB)) return null;
  if (!Number.isFinite(span.canonicalLength) || span.id.length === 0) return null;
  const trusted = decision.value.pathA.spanTrust.trusted;
  const lineStyle: AfcDiagnosticMetricSpanLineStyle = trusted === true
    ? "solid"
    : trusted === false
    ? "dashed"
    : "dotted";
  const statusLabel = trusted === true
    ? AFC_DIAGNOSTIC_METRIC_SPAN_COPY.trusted
    : trusted === false
    ? AFC_DIAGNOSTIC_METRIC_SPAN_COPY.rejected
    : AFC_DIAGNOSTIC_METRIC_SPAN_COPY.trustUnavailable;
  return Object.freeze({
    sourcePath: "path_a",
    imageSpace: AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_IMAGE_SPACE,
    targetKind: AFC_DIAGNOSTIC_METRIC_SPAN_PATH_A_KIND,
    imageA: Object.freeze({ x: span.imageA.x, y: span.imageA.y }),
    imageB: Object.freeze({ x: span.imageB.x, y: span.imageB.y }),
    spanId: span.id,
    reasonCodes: trusted === false
      ? Object.freeze([...decision.value.pathA.spanTrust.reasonCodes])
      : Object.freeze([]),
    role: span.role,
    canonicalLength: span.canonicalLength,
    statusLabel,
    lineStyle,
  });
}

function pathBReasonCodes(
  pathB: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>["value"]["pathB"],
): readonly string[] {
  const host = pathB.model.hostAcceptance?.reasonCodes ?? [];
  if (host.length > 0) return Object.freeze([...host]);
  if (pathB.derivation.reasonCodes.length > 0) {
    return Object.freeze([...pathB.derivation.reasonCodes]);
  }
  return Object.freeze([...pathB.selection.selectionReasonCodes]);
}

function pathBModel(
  decision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>,
): AfcDiagnosticMetricSpanOverlayModel | null {
  const geometry = decision.value.pathB.hostGeometry;
  if (!geometry) return null;
  if (!finitePoint(geometry.imageA) || !finitePoint(geometry.imageB)) return null;
  if (!Number.isFinite(geometry.canonicalLength) || geometry.id.length === 0) return null;
  const pathB = decision.value.pathB;
  const launched = pathB.estimatorLaunched ||
    pathB.launchDisposition === "launched" ||
    pathB.launchDisposition === "launch_failed";
  let statusLabel: string;
  let lineStyle: AfcDiagnosticMetricSpanLineStyle;
  if (pathB.derivation.accepted) {
    statusLabel = AFC_DIAGNOSTIC_METRIC_SPAN_COPY.pathBAccepted;
    lineStyle = "solid";
  } else if (pathB.model.estimatedLengthM != null) {
    statusLabel = AFC_DIAGNOSTIC_METRIC_SPAN_COPY.pathBRejected;
    lineStyle = "dashed";
  } else if (launched) {
    statusLabel = AFC_DIAGNOSTIC_METRIC_SPAN_COPY.pathBUnusable;
    lineStyle = "dotted";
  } else {
    statusLabel = `Path B — ${formatAfcDiagnosticMetricLaunchDisposition(pathB.launchDisposition)}`;
    lineStyle = "dotted";
  }
  return Object.freeze({
    sourcePath: "path_b",
    imageSpace: AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE,
    targetKind: AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_KIND,
    imageA: Object.freeze({ x: geometry.imageA.x, y: geometry.imageA.y }),
    imageB: Object.freeze({ x: geometry.imageB.x, y: geometry.imageB.y }),
    spanId: geometry.id,
    reasonCodes: lineStyle === "solid" ? Object.freeze([]) : pathBReasonCodes(pathB),
    role: geometry.role,
    canonicalLength: geometry.canonicalLength,
    statusLabel,
    lineStyle,
  });
}

/**
 * Drawable spans for this recorded decision, independent of the current tab.
 *
 * selectedPath path_a → Path A only.
 * selectedPath path_b → Path B only.
 * selectedPath none → every span that still has retained endpoints.
 * When both exist, Path B is the default because runtime evaluates it after Path A.
 */
export function afcDiagnosticMetricSpanOptions(
  metricDecision: AfcDiagnosticAdminMetricDecision,
): readonly AfcDiagnosticMetricSpanOverlayModel[] {
  if (metricDecision == null || metricDecision.kind !== "recorded") return [];
  const pathA = pathAModel(metricDecision);
  const pathB = pathBModel(metricDecision);
  const selected = metricDecision.value.finalDecision.selectedPath;
  if (selected === "path_a") return pathA ? [pathA] : [];
  if (selected === "path_b") return pathB ? [pathB] : [];
  return [pathA, pathB].filter((span): span is AfcDiagnosticMetricSpanOverlayModel => span != null);
}

export function afcDiagnosticMetricSpanDefaultSource(
  options: readonly AfcDiagnosticMetricSpanOverlayModel[],
): AfcDiagnosticMetricSpanSourcePath | null {
  if (options.some((span) => span.sourcePath === "path_b")) return "path_b";
  if (options.some((span) => span.sourcePath === "path_a")) return "path_a";
  return null;
}

export function selectAfcDiagnosticMetricSpanOverlay(input: {
  metricDecision: AfcDiagnosticAdminMetricDecision;
  artifactKind: AfcDiagnosticVisualArtifactKind;
  sourcePath?: AfcDiagnosticMetricSpanSourcePath | null;
}): AfcDiagnosticMetricSpanOverlayModel | null {
  const options = afcDiagnosticMetricSpanOptions(input.metricDecision);
  const source = input.sourcePath ?? afcDiagnosticMetricSpanDefaultSource(options);
  if (!source) return null;
  return options.find((span) =>
    span.sourcePath === source && span.targetKind === input.artifactKind
  ) ?? null;
}

export function metricSpanViewBoxPoint(
  point: AfcDiagnosticMetricSpanPoint,
): AfcDiagnosticMetricSpanPoint {
  return { x: point.x, y: point.y };
}

export function metricSpanContainedDisplaySize(
  container: Readonly<{ width: number; height: number }>,
  source: Readonly<{ width: number; height: number }>,
): { width: number; height: number } {
  if (
    !(container.width > 0) ||
    !(container.height > 0) ||
    !(source.width > 0) ||
    !(source.height > 0) ||
    !Number.isFinite(container.width) ||
    !Number.isFinite(container.height) ||
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height)
  ) {
    return { width: container.width, height: container.height };
  }
  const scale = Math.min(
    container.width / source.width,
    container.height / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function metricSpanContainedPixel(
  point: AfcDiagnosticMetricSpanPoint,
  container: Readonly<{ width: number; height: number }>,
  source: Readonly<{ width: number; height: number }>,
): AfcDiagnosticMetricSpanPoint | null {
  if (!finitePoint(point)) return null;
  const fitted = metricSpanContainedDisplaySize(container, source);
  if (!(fitted.width > 0) || !(fitted.height > 0)) return null;
  return {
    x: point.x * fitted.width,
    y: point.y * fitted.height,
  };
}
