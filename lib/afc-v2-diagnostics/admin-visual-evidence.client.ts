/**
 * AFD-4C2A admin visual evidence helpers.
 *
 * Browser-safe. Builds the artifact byte route, maps visual errors, and
 * coordinates stale fetch/object-URL lifecycle. Does not import server
 * storage or AFD-4A read-model primitives.
 */

export const AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS = [
  "original",
  "empty",
  "tiled",
] as const;

export type AfcDiagnosticVisualArtifactKind =
  (typeof AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS)[number];

const KIND_SET = new Set<string>(AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS);

export const AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY = {
  heading: "Visual evidence",
  loading: "Loading visual evidence...",
  retry: "Retry visual evidence",
  original: "Original",
  empty: "Empty",
  tiled: "Tiled",
  present: "Present",
  notPresent: "Not present",
  unavailable: "unavailable",
  notPresentMessage: "Artifact not present for this attempt.",
  bytesUnavailable: "Artifact bytes are unavailable.",
  originalUnavailable: "Original evidence is unavailable for this attempt.",
  integrity: "Artifact evidence could not be verified.",
  error401: "Session expired. Sign in again.",
  error403: "Admin access required.",
  generic: "Couldn't load visual evidence.",
  reported: "Reported",
} as const;

export type AfcDiagnosticVisualEvidenceTuple = Readonly<{
  caseId: string;
  generationId: string;
  kind: AfcDiagnosticVisualArtifactKind;
}>;

export type AfcDiagnosticVisualEvidenceBegin =
  | { started: false }
  | {
      started: true;
      seq: number;
      tuple: AfcDiagnosticVisualEvidenceTuple;
      signal: AbortSignal;
    };

export function isAfcDiagnosticVisualArtifactKind(
  value: unknown,
): value is AfcDiagnosticVisualArtifactKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function parseAfcDiagnosticVisualArtifactKind(
  value: unknown,
): AfcDiagnosticVisualArtifactKind | null {
  return isAfcDiagnosticVisualArtifactKind(value) ? value : null;
}

export function buildAfcDiagnosticVisualArtifactUrl(input: {
  caseId: string;
  generationId: string;
  kind: AfcDiagnosticVisualArtifactKind;
}): string {
  return `/api/admin/afc-diagnostics/cases/${input.caseId}/generations/${input.generationId}/artifacts/${input.kind}`;
}

export function afcDiagnosticVisualEvidenceTupleKey(
  tuple: AfcDiagnosticVisualEvidenceTuple,
): string {
  return `${tuple.caseId}:${tuple.generationId}:${tuple.kind}`;
}

export function isSameAfcDiagnosticVisualEvidenceTuple(
  left: AfcDiagnosticVisualEvidenceTuple,
  right: AfcDiagnosticVisualEvidenceTuple,
): boolean {
  return (
    left.caseId === right.caseId &&
    left.generationId === right.generationId &&
    left.kind === right.kind
  );
}

export function defaultAfcDiagnosticVisualArtifactKind(input: {
  emptyPresent: boolean;
  tiledPresent: boolean;
}): AfcDiagnosticVisualArtifactKind {
  if (input.emptyPresent) return "empty";
  if (input.tiledPresent) return "tiled";
  return "original";
}

export function resolveAfcDiagnosticVisualArtifactKind(input: {
  caseChanged: boolean;
  currentKind: AfcDiagnosticVisualArtifactKind | null;
  emptyPresent: boolean;
  tiledPresent: boolean;
}): AfcDiagnosticVisualArtifactKind {
  if (input.caseChanged || input.currentKind == null) {
    return defaultAfcDiagnosticVisualArtifactKind(input);
  }
  return input.currentKind;
}

export function afcDiagnosticVisualArtifactLabel(
  kind: AfcDiagnosticVisualArtifactKind,
): string {
  if (kind === "original") return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.original;
  if (kind === "empty") return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.empty;
  return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.tiled;
}

export function afcDiagnosticVisualImageAlt(input: {
  kind: AfcDiagnosticVisualArtifactKind;
  attemptOrdinal: number | null;
}): string {
  const artifact = afcDiagnosticVisualArtifactLabel(input.kind);
  const attempt =
    input.attemptOrdinal != null
      ? `Attempt #${input.attemptOrdinal}`
      : "this attempt";
  return `${artifact} evidence for ${attempt}`;
}

export function afcDiagnosticVisualEvidenceErrorMessage(input: {
  status: number | "network" | "blob";
  kind: AfcDiagnosticVisualArtifactKind;
  metadataPresent: boolean;
}): string {
  if (input.status === 401) return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.error401;
  if (input.status === 403) return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.error403;
  if (input.status === 409) return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.integrity;
  if (input.status === 404 && input.kind === "original") {
    return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.originalUnavailable;
  }
  if (input.status === 404 && input.metadataPresent) {
    return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.bytesUnavailable;
  }
  if (input.status === 404) {
    return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.notPresentMessage;
  }
  return AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic;
}

export function isAfcDiagnosticVisualAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function revokeAfcDiagnosticVisualObjectUrl(
  url: string | null | undefined,
): void {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function createAfcDiagnosticVisualEvidenceCoordinator() {
  let latestSeq = 0;
  let controller: AbortController | null = null;
  let bound: AfcDiagnosticVisualEvidenceTuple | null = null;

  return {
    begin(
      tuple: AfcDiagnosticVisualEvidenceTuple,
    ): {
      seq: number;
      tuple: AfcDiagnosticVisualEvidenceTuple;
      signal: AbortSignal;
    } {
      controller?.abort();
      latestSeq += 1;
      controller = new AbortController();
      bound = Object.freeze({ ...tuple });
      return {
        seq: latestSeq,
        tuple: bound,
        signal: controller.signal,
      };
    },
    retry(): AfcDiagnosticVisualEvidenceBegin {
      if (bound == null) return { started: false };
      const started = this.begin(bound);
      return { started: true, ...started };
    },
    isCurrent(
      seq: number,
      tuple: AfcDiagnosticVisualEvidenceTuple,
    ): boolean {
      return (
        seq === latestSeq &&
        bound != null &&
        isSameAfcDiagnosticVisualEvidenceTuple(bound, tuple)
      );
    },
    currentSeq(): number {
      return latestSeq;
    },
    boundTuple(): AfcDiagnosticVisualEvidenceTuple | null {
      return bound;
    },
    abort(): void {
      controller?.abort();
      latestSeq += 1;
      bound = null;
    },
  };
}
