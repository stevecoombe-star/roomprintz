/**
 * AFR-4A manual-perspective working state and persisted record.
 *
 * The human edits the source-normalized floor quad. Calibration derives the
 * centered world rectangle and camera. Editing state is temporary. Apply
 * writes only the manual-perspective record.
 */

import {
  canonicalWorldRectangle,
  cloneManualPerspectiveImagePoints,
  MANUAL_PERSPECTIVE_CORNERS,
  imagePointsEqual,
  imagePointsFromQuad,
  manualPerspectiveBootstrapQuad,
  manualPerspectiveImageQuadValid,
  quadFromImagePoints,
  replaceManualPerspectiveImageCoordinate,
  type ManualPerspectiveCorner,
  type ManualPerspectiveImagePoints,
  type ManualPerspectiveImageQuad,
  type ManualPerspectiveVec3,
  type ManualPerspectiveWorldRectangle,
} from "./manual-perspective-geometry";
import type { ManualPerspectiveSolveResult } from "./manual-perspective-solve";

export const AFC_V2_MANUAL_PERSPECTIVE_SCHEMA_VERSION =
  "afc-v2-manual-perspective/v1" as const;

export const MANUAL_PERSPECTIVE_STATUSES = [
  "idle",
  "solving",
  "converged",
  "unrealizable",
  "error",
] as const;

export type ManualPerspectiveSessionStatus = (typeof MANUAL_PERSPECTIVE_STATUSES)[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ManualPerspectiveAutomaticBaseline = Readonly<{
  generationId: string;
  imagePoints: ManualPerspectiveImagePoints;
  widthDepthRatio: number;
  verticalFovDeg: number;
  worldWidthM: number;
  referenceDepthM: number;
  sourceImageSize: Readonly<{ width: number; height: number }>;
  frameSize: Readonly<{ width: number; height: number }>;
}>;

export type ManualPerspectiveSession = Readonly<{
  baseGenerationId: string;
  automaticPoints: ManualPerspectiveImagePoints;
  openedPoints: ManualPerspectiveImagePoints;
  imagePoints: ManualPerspectiveImagePoints;
  sourceImageSize: Readonly<{ width: number; height: number }>;
  frameSize: Readonly<{ width: number; height: number }>;
  referenceDepthM: number;
  baselineFovDeg: number;
  mode: ManualPerspectiveMode;
  runtime: ManualPerspectiveRuntime;
  status: ManualPerspectiveSessionStatus;
  solveRequestId: number;
  /** Latest completed solve. Stays in place while a newer solve is pending. */
  solution: ManualPerspectiveSolveResult | null;
}>;

export const MANUAL_PERSPECTIVE_PROVISIONAL_REFERENCE_DEPTH_M = 4;

export const MANUAL_PERSPECTIVE_ORIGINS = [
  "automatic_quad_adjustment",
  "manual_quad_bootstrap",
] as const;

export type ManualPerspectiveOrigin = (typeof MANUAL_PERSPECTIVE_ORIGINS)[number];

export const MANUAL_PERSPECTIVE_RUNTIMES = [
  "overlay",
  "diagnostic_only",
  "unavailable",
] as const;

export type ManualPerspectiveRuntime = (typeof MANUAL_PERSPECTIVE_RUNTIMES)[number];

export type ManualPerspectiveMode = "adjust" | "bootstrap";

export type ManualPerspectiveRecord = Readonly<{
  schemaVersion: typeof AFC_V2_MANUAL_PERSPECTIVE_SCHEMA_VERSION;
  perspectiveSource: "manual";
  origin: ManualPerspectiveOrigin;
  baseGenerationId: string;
  appliedAt: string;
  originalSourceQuad: ManualPerspectiveImageQuad | null;
  initialBootstrapQuad: ManualPerspectiveImageQuad | null;
  adjustedSourceQuad: ManualPerspectiveImageQuad;
  derivedFloor: ManualPerspectiveWorldRectangle;
  resultingCamera: Readonly<{
    verticalFovDeg: number;
    position: ManualPerspectiveVec3;
    lookAt: ManualPerspectiveVec3;
    up: ManualPerspectiveVec3;
  }>;
  solverDiagnostics: Readonly<{
    status: "converged";
    objectivePx: number;
    iterationCount: number;
    convergenceReason: string;
    elapsedMs: number;
  }>;
}>;

export type ManualPerspectiveParseResult =
  | Readonly<{ ok: true; record: ManualPerspectiveRecord | null }>
  | Readonly<{ ok: false; reason: "unreadable" }>;

export function manualPerspectiveControlVisible(qaEnabled: boolean): boolean {
  return qaEnabled === true;
}

export function buildManualPerspectiveUrl(caseId: string, generationId: string): string {
  return `/api/admin/afc-manual-perspective/cases/${caseId}/generations/${generationId}`;
}

export function buildManualPerspectiveRecoveryUrl(caseId: string, generationId: string): string {
  return `${buildManualPerspectiveUrl(caseId, generationId)}/recover`;
}

export type ManualPerspectiveRecoverySummary = Readonly<{
  sourceGenerationId: string;
  recoveryIntent: "manual_perspective_recovery";
  geometryAuthority: "manual_source_quad";
  qaUserId: string;
  recoveredAt: string;
}>;

export function parseManualPerspectiveRecoverySummary(
  value: unknown,
): ManualPerspectiveRecoverySummary | null {
  if (!isRecord(value)) return null;
  if (!exactKeys(value, [
    "sourceGenerationId",
    "recoveryIntent",
    "geometryAuthority",
    "qaUserId",
    "recoveredAt",
  ])) {
    return null;
  }
  const sourceGenerationId = uuid(value.sourceGenerationId);
  const qaUserId = uuid(value.qaUserId);
  if (!sourceGenerationId || !qaUserId) return null;
  if (value.recoveryIntent !== "manual_perspective_recovery") return null;
  if (value.geometryAuthority !== "manual_source_quad") return null;
  if (typeof value.recoveredAt !== "string" || Number.isNaN(Date.parse(value.recoveredAt))) {
    return null;
  }
  return Object.freeze({
    sourceGenerationId,
    recoveryIntent: "manual_perspective_recovery",
    geometryAuthority: "manual_source_quad",
    qaUserId,
    recoveredAt: value.recoveredAt,
  });
}

export function parseManualPerspectiveRecoveryEligibility(
  value: unknown,
): Readonly<{ eligible: boolean; blocker: string | null }> | null {
  if (!isRecord(value) || typeof value.eligible !== "boolean") return null;
  if (value.blocker != null && typeof value.blocker !== "string") return null;
  return Object.freeze({
    eligible: value.eligible,
    blocker: typeof value.blocker === "string" ? value.blocker : null,
  });
}

export function manualPerspectiveRecoveryAllowed(
  session: Pick<ManualPerspectiveSession, "runtime" | "status" | "solution" | "imagePoints">,
  eligible: boolean,
): boolean {
  return session.runtime === "diagnostic_only" &&
    eligible &&
    manualPerspectiveApplyAllowed(session);
}

export function parseManualPerspectiveCoordinate(
  raw: string,
): Readonly<{ ok: true; value: number } | { ok: false }> {
  const trimmed = raw.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

export function nudgeManualPerspectiveCoordinate(value: number, delta: number): number {
  return Math.round((value + delta) * 1000) / 1000;
}

export function openManualPerspectiveSession(
  baseline: ManualPerspectiveAutomaticBaseline,
  appliedPoints: ManualPerspectiveImagePoints | null,
  runtime: Exclude<ManualPerspectiveRuntime, "unavailable"> = "overlay",
): ManualPerspectiveSession {
  const openedPoints = appliedPoints
    ? cloneManualPerspectiveImagePoints(appliedPoints)
    : cloneManualPerspectiveImagePoints(baseline.imagePoints);
  return Object.freeze({
    baseGenerationId: baseline.generationId,
    automaticPoints: cloneManualPerspectiveImagePoints(baseline.imagePoints),
    openedPoints,
    imagePoints: cloneManualPerspectiveImagePoints(openedPoints),
    sourceImageSize: Object.freeze({ ...baseline.sourceImageSize }),
    frameSize: Object.freeze({ ...baseline.frameSize }),
    referenceDepthM: baseline.referenceDepthM,
    baselineFovDeg: baseline.verticalFovDeg,
    mode: "adjust" as const,
    runtime,
    status: "solving" as const,
    solveRequestId: 1,
    solution: null,
  });
}

export function openManualPerspectiveBootstrapSession(
  bootstrap: ManualPerspectiveBootstrap,
  appliedPoints: ManualPerspectiveImagePoints | null,
): ManualPerspectiveSession {
  const openedPoints = appliedPoints
    ? cloneManualPerspectiveImagePoints(appliedPoints)
    : cloneManualPerspectiveImagePoints(bootstrap.imagePoints);
  return Object.freeze({
    baseGenerationId: bootstrap.generationId,
    automaticPoints: cloneManualPerspectiveImagePoints(bootstrap.imagePoints),
    openedPoints,
    imagePoints: cloneManualPerspectiveImagePoints(openedPoints),
    sourceImageSize: Object.freeze({ ...bootstrap.sourceImageSize }),
    frameSize: Object.freeze({ ...bootstrap.frameSize }),
    referenceDepthM: bootstrap.referenceDepthM,
    baselineFovDeg: 0,
    mode: "bootstrap" as const,
    runtime: bootstrap.runtime,
    status: "solving" as const,
    solveRequestId: 1,
    solution: null,
  });
}

export function editManualPerspectivePoint(
  session: ManualPerspectiveSession,
  corner: ManualPerspectiveCorner,
  x: number,
  y: number,
): ManualPerspectiveSession {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return session;
  if (session.imagePoints[corner].x === x && session.imagePoints[corner].y === y) return session;
  const next = replaceManualPerspectiveImageCoordinate(session.imagePoints, corner, "x", x);
  return Object.freeze({
    ...session,
    imagePoints: replaceManualPerspectiveImageCoordinate(next, corner, "y", y),
    status: "solving" as const,
    solveRequestId: session.solveRequestId + 1,
  });
}

export function editManualPerspectiveImagePoints(
  session: ManualPerspectiveSession,
  points: ManualPerspectiveImagePoints,
): ManualPerspectiveSession {
  for (const corner of MANUAL_PERSPECTIVE_CORNERS) {
    if (!Number.isFinite(points[corner].x) || !Number.isFinite(points[corner].y)) return session;
  }
  const imagePoints = cloneManualPerspectiveImagePoints(points);
  if (imagePointsEqual(session.imagePoints, imagePoints)) return session;
  return Object.freeze({
    ...session,
    imagePoints,
    status: "solving" as const,
    solveRequestId: session.solveRequestId + 1,
  });
}

export function editManualPerspectiveCoordinate(
  session: ManualPerspectiveSession,
  corner: ManualPerspectiveCorner,
  axis: "x" | "y",
  value: number,
): ManualPerspectiveSession {
  if (!Number.isFinite(value)) return session;
  if (session.imagePoints[corner][axis] === value) return session;
  return Object.freeze({
    ...session,
    imagePoints: replaceManualPerspectiveImageCoordinate(
      session.imagePoints,
      corner,
      axis,
      value,
    ),
    status: "solving" as const,
    solveRequestId: session.solveRequestId + 1,
  });
}

export function revertManualPerspectiveSession(
  session: ManualPerspectiveSession,
): ManualPerspectiveSession {
  if (
    imagePointsEqual(session.imagePoints, session.openedPoints) &&
    session.status !== "solving"
  ) {
    return session;
  }
  return Object.freeze({
    ...session,
    imagePoints: cloneManualPerspectiveImagePoints(session.openedPoints),
    status: "solving" as const,
    solveRequestId: session.solveRequestId + 1,
  });
}

export function commitManualPerspectiveSolve(
  session: ManualPerspectiveSession,
  requestId: number,
  result: ManualPerspectiveSolveResult,
): ManualPerspectiveSession {
  if (session.solveRequestId !== requestId) return session;
  if (!imagePointsEqual(session.imagePoints, result.imagePoints)) return session;
  return Object.freeze({
    ...session,
    status: result.status,
    solution: result,
  });
}

export const MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS = [
  "FOV",
  "Width : Depth",
  "Solver",
  "Error",
  "Iterations",
  "Convergence",
  "Camera height",
  "Solve time",
] as const;

const DIAGNOSTIC_PLACEHOLDER = "—";

export type ManualPerspectiveDiagnosticRow = Readonly<{
  label: (typeof MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS)[number];
  value: string;
}>;

export function manualPerspectiveDiagnosticRows(
  session: Pick<ManualPerspectiveSession, "status" | "solution">,
): readonly ManualPerspectiveDiagnosticRow[] {
  const solution = session.solution;
  const rectangle = solution?.worldRectangle ?? null;
  return [
    { label: "FOV", value: solution?.verticalFovDeg != null ? `${solution.verticalFovDeg.toFixed(1)}°` : DIAGNOSTIC_PLACEHOLDER },
    { label: "Width : Depth", value: rectangle ? rectangle.widthDepthRatio.toFixed(3) : DIAGNOSTIC_PLACEHOLDER },
    { label: "Solver", value: manualPerspectiveSolverLabel(session.status) },
    { label: "Error", value: solution?.objectivePx != null ? `${solution.objectivePx.toFixed(4)} px` : DIAGNOSTIC_PLACEHOLDER },
    { label: "Iterations", value: solution ? String(solution.iterationCount) : DIAGNOSTIC_PLACEHOLDER },
    { label: "Convergence", value: solution?.convergenceReason || DIAGNOSTIC_PLACEHOLDER },
    {
      label: "Camera height",
      value: solution?.pose ? `${solution.pose.position.y.toFixed(3)} m` : DIAGNOSTIC_PLACEHOLDER,
    },
    { label: "Solve time", value: solution ? `${solution.elapsedMs.toFixed(2)} ms` : DIAGNOSTIC_PLACEHOLDER },
  ];
}

export function manualPerspectiveSolverLabel(status: ManualPerspectiveSessionStatus): string {
  if (status === "solving") return "Solving…";
  if (status === "converged") return "Converged";
  if (status === "unrealizable") return "Unrealizable";
  if (status === "error") return "Error";
  return "Idle";
}

export function manualPerspectiveApplyAllowed(
  session: Pick<ManualPerspectiveSession, "status" | "solution" | "imagePoints">,
): boolean {
  const solution = session.solution;
  return (
    session.status === "converged" &&
    solution != null &&
    solution.applySafe === true &&
    solution.status === "converged" &&
    solution.verticalFovDeg != null &&
    solution.worldRectangle != null &&
    solution.pose != null &&
    imagePointsEqual(session.imagePoints, solution.imagePoints)
  );
}

export function buildManualPerspectiveRecord(input: Readonly<{
  generationId: string;
  referenceDepthM: number;
  origin: ManualPerspectiveOrigin;
  originalPoints: ManualPerspectiveImagePoints | null;
  initialBootstrapPoints: ManualPerspectiveImagePoints | null;
  solution: ManualPerspectiveSolveResult;
  appliedAt: string;
}>): ManualPerspectiveRecord | null {
  const solution = input.solution;
  if (!solution.applySafe || solution.status !== "converged") return null;
  if (
    solution.verticalFovDeg == null ||
    solution.worldRectangle == null ||
    solution.pose == null ||
    solution.objectivePx == null
  ) {
    return null;
  }
  if (solution.worldRectangle.referenceDepthM !== input.referenceDepthM) return null;
  if (input.origin === "automatic_quad_adjustment") {
    if (!input.originalPoints || input.initialBootstrapPoints) return null;
  } else if (!input.initialBootstrapPoints || input.originalPoints) {
    return null;
  }
  return Object.freeze({
    schemaVersion: AFC_V2_MANUAL_PERSPECTIVE_SCHEMA_VERSION,
    perspectiveSource: "manual" as const,
    origin: input.origin,
    baseGenerationId: input.generationId,
    appliedAt: input.appliedAt,
    originalSourceQuad: input.originalPoints ? quadFromImagePoints(input.originalPoints) : null,
    initialBootstrapQuad: input.initialBootstrapPoints
      ? quadFromImagePoints(input.initialBootstrapPoints)
      : null,
    adjustedSourceQuad: quadFromImagePoints(solution.imagePoints),
    derivedFloor: solution.worldRectangle,
    resultingCamera: Object.freeze({
      verticalFovDeg: solution.verticalFovDeg,
      position: Object.freeze({ ...solution.pose.position }),
      lookAt: Object.freeze({ ...solution.pose.lookAt }),
      up: Object.freeze({ ...solution.pose.up }),
    }),
    solverDiagnostics: Object.freeze({
      status: "converged" as const,
      objectivePx: solution.objectivePx,
      iterationCount: solution.iterationCount,
      convergenceReason: solution.convergenceReason,
      elapsedMs: solution.elapsedMs,
    }),
  });
}

export function parseManualPerspectiveRecord(value: unknown): ManualPerspectiveParseResult {
  if (value == null) return { ok: true, record: null };
  try {
    const record = parseRecord(value);
    if (!record) return { ok: false, reason: "unreadable" };
    return { ok: true, record };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export function parseManualPerspectiveImagePoints(
  value: unknown,
): ManualPerspectiveImagePoints | null {
  return parseImagePoints(value);
}

export type ManualPerspectiveBootstrap = Readonly<{
  generationId: string;
  imagePoints: ManualPerspectiveImagePoints;
  referenceDepthM: number;
  sourceImageSize: Readonly<{ width: number; height: number }>;
  frameSize: Readonly<{ width: number; height: number }>;
  runtime: Exclude<ManualPerspectiveRuntime, "unavailable">;
  restoredFromRecovery?: boolean;
}>;

export type ManualRecoveryQuadCandidate = Readonly<{
  generationId: string;
  lineageSeq: number;
  recoveryProvenance: unknown;
}>;

/**
 * Latest valid manual recovery quad for a failed source generation.
 *
 * Ordering is lineage_seq descending. recoveredAt, then generation id,
 * breaks ties. Generation status is ignored: a later failed recovery still
 * keeps the quad the user submitted. Malformed provenance is skipped.
 */
export function selectLatestManualRecoveryQuad(
  sourceGenerationId: string,
  candidates: readonly ManualRecoveryQuadCandidate[],
): ManualPerspectiveImagePoints | null {
  const sourceId = sourceGenerationId.toLowerCase();
  const applicable = candidates.flatMap((candidate) => {
    const points = recoveryQuadForSource(sourceId, candidate.recoveryProvenance);
    if (!points || !Number.isFinite(candidate.lineageSeq)) return [];
    return [{
      generationId: candidate.generationId,
      lineageSeq: candidate.lineageSeq,
      recoveredAt: recoveryTimestamp(candidate.recoveryProvenance),
      points,
    }];
  });
  applicable.sort((left, right) => {
    if (left.lineageSeq !== right.lineageSeq) return right.lineageSeq - left.lineageSeq;
    if (left.recoveredAt !== right.recoveredAt) return left.recoveredAt < right.recoveredAt ? 1 : -1;
    return left.generationId < right.generationId ? 1 : -1;
  });
  const selected = applicable[0];
  return selected ? cloneManualPerspectiveImagePoints(selected.points) : null;
}

export type ManualPerspectiveView = Readonly<{
  automatic: ManualPerspectiveAutomaticBaseline | null;
  bootstrap: ManualPerspectiveBootstrap | null;
  runtime: ManualPerspectiveRuntime;
  applied: ManualPerspectiveRecord | null;
  appliedUnreadable: boolean;
  recovery: ManualPerspectiveRecoverySummary | null;
}>;

const AUTOMATIC_KEYS = [
  "generationId",
  "imagePoints",
  "widthDepthRatio",
  "verticalFovDeg",
  "worldWidthM",
  "referenceDepthM",
  "sourceImageSize",
  "frameSize",
] as const;

export function parseManualPerspectiveView(value: unknown): ManualPerspectiveView | null {
  if (!isRecord(value) || value.qaEnabled !== true) return null;
  const legacy = exactKeys(value, ["qaEnabled", "automatic", "applied"]);
  const current = exactKeys(value, ["qaEnabled", "automatic", "bootstrap", "runtime", "applied"]) ||
    exactKeys(value, ["qaEnabled", "automatic", "bootstrap", "runtime", "applied", "recovery"]);
  if (!legacy && !current) return null;
  const recovery = !("recovery" in value) || value.recovery == null
    ? null
    : parseManualPerspectiveRecoverySummary(value.recovery);
  if ("recovery" in value && value.recovery != null && !recovery) return null;
  const automatic = value.automatic == null ? null : parseAutomatic(value.automatic);
  if (value.automatic != null && !automatic) return null;
  const bootstrap = !current || value.bootstrap == null ? null : parseBootstrap(value.bootstrap);
  if (current && value.bootstrap != null && !bootstrap) return null;
  const runtime = current ? parseRuntime(value.runtime) : automatic ? "overlay" : "unavailable";
  if (!runtime) return null;
  if (value.applied == null) {
    return Object.freeze({
      automatic,
      bootstrap,
      runtime,
      applied: null,
      appliedUnreadable: false,
      recovery,
    });
  }
  if (
    isRecord(value.applied) &&
    value.applied.kind === "unreadable" &&
    exactKeys(value.applied, ["kind"])
  ) {
    return Object.freeze({
      automatic,
      bootstrap,
      runtime,
      applied: null,
      appliedUnreadable: true,
      recovery,
    });
  }
  const parsed = parseManualPerspectiveRecord(value.applied);
  if (!parsed.ok || !parsed.record) return null;
  return Object.freeze({
    automatic,
    bootstrap,
    runtime,
    applied: parsed.record,
    appliedUnreadable: false,
    recovery,
  });
}

export function readManualPerspectiveBootstrap(input: Readonly<{
  generationId: string;
  frameWidth: number | null;
  frameHeight: number | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  productionAuthority: unknown;
  authorityComplete: boolean;
  authorityReferenceDepthM: number | null;
}>): ManualPerspectiveBootstrap | null {
  if (!uuid(input.generationId)) return null;
  const frameSize = positiveSize(input.frameWidth, input.frameHeight) ??
    positiveSize(input.originalDecodedWidth, input.originalDecodedHeight) ??
    frameFromAuthority(input.productionAuthority);
  const sourceImageSize =
    positiveSize(input.originalDecodedWidth, input.originalDecodedHeight) ?? frameSize;
  if (!frameSize || !sourceImageSize) return null;
  const referenceDepthM = input.authorityComplete && input.authorityReferenceDepthM != null
    ? input.authorityReferenceDepthM
    : MANUAL_PERSPECTIVE_PROVISIONAL_REFERENCE_DEPTH_M;
  if (!(referenceDepthM > 0)) return null;
  return Object.freeze({
    generationId: input.generationId.toLowerCase(),
    imagePoints: manualPerspectiveBootstrapQuad(),
    referenceDepthM,
    sourceImageSize,
    frameSize,
    runtime: input.authorityComplete ? "overlay" as const : "diagnostic_only" as const,
  });
}

export function manualPerspectiveStageApplyAllowed(
  session: Pick<ManualPerspectiveSession, "runtime" | "status" | "solution" | "imagePoints">,
): boolean {
  return session.runtime === "overlay" && manualPerspectiveApplyAllowed(session);
}

export function readAutomaticPerspectiveBaseline(input: Readonly<{
  generationId: string;
  status: string;
  frameWidth: number | null;
  frameHeight: number | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  productionAuthority: unknown;
}>): ManualPerspectiveAutomaticBaseline | null {
  if (input.status !== "ready") return null;
  if (!uuid(input.generationId)) return null;
  if (!isRecord(input.productionAuthority)) return null;
  const floor = input.productionAuthority.floor;
  const camera = input.productionAuthority.frozenCamera;
  if (!isRecord(floor) || !isRecord(camera)) return null;
  const worldWidthM = positive(floor.worldWidthM);
  const referenceDepthM = positive(floor.referenceDepthM);
  const verticalFovDeg = positive(camera.verticalFovDeg);
  const imagePoints = imagePointsFromQuad(parseQuad(floor.sourceNormalizedPolygon) ?? []);
  if (
    worldWidthM == null ||
    referenceDepthM == null ||
    verticalFovDeg == null ||
    !imagePoints
  ) {
    return null;
  }
  const frameSize = positiveSize(input.frameWidth, input.frameHeight) ?? cameraFrame(camera.frame);
  const sourceImageSize =
    positiveSize(input.originalDecodedWidth, input.originalDecodedHeight) ?? frameSize;
  if (!frameSize || !sourceImageSize) return null;
  const widthDepthRatio = worldWidthM / referenceDepthM;
  if (!Number.isFinite(widthDepthRatio) || !(widthDepthRatio > 0)) return null;
  return Object.freeze({
    generationId: input.generationId.toLowerCase(),
    imagePoints,
    widthDepthRatio,
    verticalFovDeg,
    worldWidthM,
    referenceDepthM,
    sourceImageSize,
    frameSize,
  });
}

function parseAutomatic(value: unknown): ManualPerspectiveAutomaticBaseline | null {
  if (!isRecord(value) || !exactKeys(value, AUTOMATIC_KEYS)) return null;
  const generationId = uuid(value.generationId);
  const imagePoints = parseImagePoints(value.imagePoints);
  const widthDepthRatio = positive(value.widthDepthRatio);
  const verticalFovDeg = positive(value.verticalFovDeg);
  const worldWidthM = positive(value.worldWidthM);
  const referenceDepthM = positive(value.referenceDepthM);
  if (!isRecord(value.sourceImageSize) || !exactKeys(value.sourceImageSize, ["width", "height"])) {
    return null;
  }
  if (!isRecord(value.frameSize) || !exactKeys(value.frameSize, ["width", "height"])) {
    return null;
  }
  const sourceImageSize = positiveSize(value.sourceImageSize.width, value.sourceImageSize.height);
  const frameSize = positiveSize(value.frameSize.width, value.frameSize.height);
  if (
    !generationId ||
    !imagePoints ||
    widthDepthRatio == null ||
    verticalFovDeg == null ||
    worldWidthM == null ||
    referenceDepthM == null ||
    !sourceImageSize ||
    !frameSize
  ) {
    return null;
  }
  return Object.freeze({
    generationId,
    imagePoints,
    widthDepthRatio,
    verticalFovDeg,
    worldWidthM,
    referenceDepthM,
    sourceImageSize,
    frameSize,
  });
}

const RECORD_KEYS = [
  "schemaVersion",
  "perspectiveSource",
  "baseGenerationId",
  "appliedAt",
  "originalSourceQuad",
  "adjustedSourceQuad",
  "derivedFloor",
  "resultingCamera",
  "solverDiagnostics",
] as const;

const CURRENT_RECORD_KEYS = [
  ...RECORD_KEYS,
  "origin",
  "initialBootstrapQuad",
] as const;

const DERIVED_FLOOR_KEYS = [
  "worldWidthM",
  "referenceDepthM",
  "widthDepthRatio",
  "corners",
] as const;

const CAMERA_KEYS = ["verticalFovDeg", "position", "lookAt", "up"] as const;

const DIAGNOSTIC_KEYS = [
  "status",
  "objectivePx",
  "iterationCount",
  "convergenceReason",
  "elapsedMs",
] as const;

function parseRecord(value: unknown): ManualPerspectiveRecord | null {
  if (!isRecord(value)) return null;
  const legacy = exactKeys(value, RECORD_KEYS);
  const current = exactKeys(value, CURRENT_RECORD_KEYS);
  if (!legacy && !current) return null;
  if (value.schemaVersion !== AFC_V2_MANUAL_PERSPECTIVE_SCHEMA_VERSION) return null;
  if (value.perspectiveSource !== "manual") return null;
  const baseGenerationId = uuid(value.baseGenerationId);
  if (!baseGenerationId) return null;
  if (typeof value.appliedAt !== "string" || !Number.isFinite(Date.parse(value.appliedAt))) {
    return null;
  }
  const origin = legacy
    ? "automatic_quad_adjustment"
    : parseOrigin(value.origin);
  if (!origin) return null;
  const originalSourceQuad = value.originalSourceQuad == null
    ? null
    : parseQuad(value.originalSourceQuad);
  if (value.originalSourceQuad != null && !originalSourceQuad) return null;
  const initialBootstrapQuad = !current || value.initialBootstrapQuad == null
    ? null
    : parseQuad(value.initialBootstrapQuad);
  if (current && value.initialBootstrapQuad != null && !initialBootstrapQuad) return null;
  if (origin === "automatic_quad_adjustment" && (!originalSourceQuad || initialBootstrapQuad)) {
    return null;
  }
  if (origin === "manual_quad_bootstrap" && (originalSourceQuad || !initialBootstrapQuad)) {
    return null;
  }
  const adjustedSourceQuad = parseQuad(value.adjustedSourceQuad);
  const derivedFloor = parseDerivedFloor(value.derivedFloor);
  if (!isRecord(value.resultingCamera) || !exactKeys(value.resultingCamera, CAMERA_KEYS)) {
    return null;
  }
  if (!isRecord(value.solverDiagnostics) || !exactKeys(value.solverDiagnostics, DIAGNOSTIC_KEYS)) {
    return null;
  }
  const verticalFovDeg = positive(value.resultingCamera.verticalFovDeg);
  const position = parseVec3(value.resultingCamera.position);
  const lookAt = parseVec3(value.resultingCamera.lookAt);
  const up = parseVec3(value.resultingCamera.up);
  const objectivePx = finite(value.solverDiagnostics.objectivePx);
  const iterationCount = nonNegativeInteger(value.solverDiagnostics.iterationCount);
  const elapsedMs = finite(value.solverDiagnostics.elapsedMs);
  if (
    !baseGenerationId ||
    !adjustedSourceQuad ||
    !derivedFloor ||
    verticalFovDeg == null ||
    !position ||
    !lookAt ||
    !up ||
    objectivePx == null ||
    iterationCount == null ||
    elapsedMs == null ||
    value.solverDiagnostics.status !== "converged" ||
    typeof value.solverDiagnostics.convergenceReason !== "string" ||
    value.solverDiagnostics.convergenceReason.length === 0 ||
    value.solverDiagnostics.convergenceReason.length > 80
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: AFC_V2_MANUAL_PERSPECTIVE_SCHEMA_VERSION,
    perspectiveSource: "manual" as const,
    origin,
    baseGenerationId,
    appliedAt: value.appliedAt,
    originalSourceQuad,
    initialBootstrapQuad,
    adjustedSourceQuad,
    derivedFloor,
    resultingCamera: Object.freeze({
      verticalFovDeg,
      position,
      lookAt,
      up,
    }),
    solverDiagnostics: Object.freeze({
      status: "converged" as const,
      objectivePx,
      iterationCount,
      convergenceReason: value.solverDiagnostics.convergenceReason,
      elapsedMs,
    }),
  });
}

function parseDerivedFloor(value: unknown): ManualPerspectiveWorldRectangle | null {
  if (!isRecord(value) || !exactKeys(value, DERIVED_FLOOR_KEYS)) return null;
  const worldWidthM = positive(value.worldWidthM);
  const referenceDepthM = positive(value.referenceDepthM);
  const widthDepthRatio = positive(value.widthDepthRatio);
  const corners = parseWorldCorners(value.corners);
  if (worldWidthM == null || referenceDepthM == null || widthDepthRatio == null || !corners) {
    return null;
  }
  const canonical = canonicalWorldRectangle(worldWidthM, referenceDepthM);
  if (!canonical || !nearly(canonical.widthDepthRatio, widthDepthRatio)) return null;
  const matches = (["NL", "NR", "FR", "FL"] as const).every((corner) =>
    nearly(corners[corner].x, canonical.corners[corner].x) &&
    nearly(corners[corner].z, canonical.corners[corner].z),
  );
  if (!matches) return null;
  return canonical;
}

function parseWorldCorners(
  value: unknown,
): ManualPerspectiveWorldRectangle["corners"] | null {
  if (!isRecord(value) || !exactKeys(value, ["NL", "NR", "FR", "FL"])) return null;
  const NL = parseWorldCorner(value.NL);
  const NR = parseWorldCorner(value.NR);
  const FR = parseWorldCorner(value.FR);
  const FL = parseWorldCorner(value.FL);
  if (!NL || !NR || !FR || !FL) return null;
  return { NL, NR, FR, FL };
}

function parseWorldCorner(value: unknown): Readonly<{ x: number; z: number }> | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "z"])) return null;
  const x = finite(value.x);
  const z = finite(value.z);
  if (x == null || z == null) return null;
  return { x, z };
}

function parseOrigin(value: unknown): ManualPerspectiveOrigin | null {
  return value === "automatic_quad_adjustment" || value === "manual_quad_bootstrap" ? value : null;
}

function parseRuntime(value: unknown): ManualPerspectiveRuntime | null {
  return value === "overlay" || value === "diagnostic_only" || value === "unavailable"
    ? value
    : null;
}

function parseBootstrap(value: unknown): ManualPerspectiveBootstrap | null {
  if (!isRecord(value)) return null;
  const baseKeys = [
    "generationId",
    "imagePoints",
    "referenceDepthM",
    "sourceImageSize",
    "frameSize",
    "runtime",
  ] as const;
  const withRestore = [...baseKeys, "restoredFromRecovery"] as const;
  if (!exactKeys(value, baseKeys) && !exactKeys(value, withRestore)) return null;
  if (
    "restoredFromRecovery" in value &&
    typeof value.restoredFromRecovery !== "boolean"
  ) {
    return null;
  }
  const generationId = uuid(value.generationId);
  const imagePoints = parseImagePoints(value.imagePoints);
  const referenceDepthM = positive(value.referenceDepthM);
  const runtime = value.runtime === "overlay" || value.runtime === "diagnostic_only"
    ? value.runtime
    : null;
  if (!isRecord(value.sourceImageSize) || !exactKeys(value.sourceImageSize, ["width", "height"])) {
    return null;
  }
  if (!isRecord(value.frameSize) || !exactKeys(value.frameSize, ["width", "height"])) return null;
  const sourceImageSize = positiveSize(value.sourceImageSize.width, value.sourceImageSize.height);
  const frameSize = positiveSize(value.frameSize.width, value.frameSize.height);
  if (!generationId || !imagePoints || referenceDepthM == null || !runtime || !sourceImageSize || !frameSize) {
    return null;
  }
  return Object.freeze({
    generationId,
    imagePoints,
    referenceDepthM,
    sourceImageSize,
    frameSize,
    runtime,
    restoredFromRecovery: value.restoredFromRecovery === true,
  });
}

function recoveryQuadForSource(
  sourceId: string,
  provenance: unknown,
): ManualPerspectiveImagePoints | null {
  if (!isRecord(provenance)) return null;
  if (provenance.recoveryIntent !== "manual_perspective_recovery") return null;
  if (typeof provenance.sourceGenerationId !== "string") return null;
  if (provenance.sourceGenerationId.toLowerCase() !== sourceId) return null;
  const points = Array.isArray(provenance.appliedSourceQuad)
    ? imagePointsFromQuad(parseQuad(provenance.appliedSourceQuad) ?? [])
    : parseImagePoints(provenance.appliedSourceQuad);
  if (!points || !manualPerspectiveImageQuadValid(points)) return null;
  return points;
}

function recoveryTimestamp(provenance: unknown): string {
  if (!isRecord(provenance) || typeof provenance.recoveredAt !== "string") return "";
  return provenance.recoveredAt;
}

function frameFromAuthority(authority: unknown): Readonly<{ width: number; height: number }> | null {
  if (!isRecord(authority)) return null;
  const camera = authority.frozenCamera;
  if (!isRecord(camera)) return null;
  return cameraFrame(camera.frame);
}

function parseImagePoints(value: unknown): ManualPerspectiveImagePoints | null {
  if (!isRecord(value) || !exactKeys(value, ["NL", "NR", "FR", "FL"])) return null;
  const NL = parseImagePoint(value.NL);
  const NR = parseImagePoint(value.NR);
  const FR = parseImagePoint(value.FR);
  const FL = parseImagePoint(value.FL);
  if (!NL || !NR || !FR || !FL) return null;
  return Object.freeze({ NL, NR, FR, FL });
}

function parseQuad(value: unknown): ManualPerspectiveImageQuad | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map(parseImagePoint);
  if (points.some((point) => point == null)) return null;
  return Object.freeze(points) as ManualPerspectiveImageQuad;
}

function parseImagePoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "y"])) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  if (x == null || y == null) return null;
  return Object.freeze({ x, y });
}

function parseVec3(value: unknown): ManualPerspectiveVec3 | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "y", "z"])) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const z = finite(value.z);
  if (x == null || y == null || z == null) return null;
  return Object.freeze({ x, y, z });
}

function cameraFrame(value: unknown): Readonly<{ width: number; height: number }> | null {
  if (!isRecord(value)) return null;
  return positiveSize(value.width, value.height);
}

function positiveSize(
  width: unknown,
  height: unknown,
): Readonly<{ width: number; height: number }> | null {
  const w = positive(width);
  const h = positive(height);
  if (w == null || h == null) return null;
  return Object.freeze({ width: w, height: h });
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number != null && number > 0 ? number : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function nearly(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}
