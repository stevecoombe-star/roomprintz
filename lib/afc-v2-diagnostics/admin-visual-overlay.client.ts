/**
 * AFD-4C2B admin visual overlay helpers.
 *
 * Browser-safe. Builds the overlay JSON route, parses the versioned DTO,
 * and coordinates stale overlay fetches. Does not import server storage,
 * production authority, or frozen camera.
 */

import {
  createAfcDiagnosticVisualEvidenceCoordinator,
  isAfcDiagnosticVisualAbortError,
  parseAfcDiagnosticVisualArtifactKind,
  type AfcDiagnosticVisualArtifactKind,
  type AfcDiagnosticVisualEvidenceBegin,
  type AfcDiagnosticVisualEvidenceTuple,
} from "./admin-visual-evidence.client";

export const AFC_ADMIN_VISUAL_OVERLAY_VERSION =
  "afc-admin-visual-overlay/v1" as const;

export const AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION =
  "afc-admin-world-to-image/v1" as const;

export const AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE =
  "source-normalized/v1" as const;

export const AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY = {
  floor: "Floor quad",
  collision: "Collision wall edges",
  floorHelp: "Certified perspective floor boundary.",
  collisionHelp:
    "Runtime collision segments projected onto this image. Not raw wall detection.",
  loading: "Loading overlays...",
  error: "Couldn't load overlays.",
  retry: "Retry overlays",
  unavailable: "Overlays unavailable for this artifact basis.",
  originalBasis: "Overlay basis: ORIGINAL frame",
  identityBasis: "Overlay basis: identity UV from ORIGINAL",
  floorUnavailable: "Floor quad unavailable for this artifact.",
  collisionUnavailable: "Collision wall edges unavailable for this artifact.",
} as const;

export type AfcAdminVisualOverlayPoint = Readonly<{
  x: number;
  y: number;
}>;

export type AfcAdminVisualOverlayFloorQuad = Readonly<{
  space: typeof AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE;
  points: readonly AfcAdminVisualOverlayPoint[];
}>;

export type AfcAdminVisualOverlayCollisionEdge = Readonly<{
  id: string;
  points: readonly AfcAdminVisualOverlayPoint[];
}>;

export type AfcAdminVisualOverlayV1 = Readonly<{
  version: typeof AFC_ADMIN_VISUAL_OVERLAY_VERSION;
  projectionVersion: typeof AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION;
  artifactBasis: AfcDiagnosticVisualArtifactKind;
  frame: Readonly<{
    width: number;
    height: number;
  }>;
  floorQuad: AfcAdminVisualOverlayFloorQuad | null;
  collisionEdges: readonly AfcAdminVisualOverlayCollisionEdge[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parsePoint(value: unknown): AfcAdminVisualOverlayPoint | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x == null || y == null) return null;
  return Object.freeze({ x, y });
}

function parsePoints(
  value: unknown,
  minimum: number,
): readonly AfcAdminVisualOverlayPoint[] | null {
  if (!Array.isArray(value) || value.length < minimum) return null;
  const points: AfcAdminVisualOverlayPoint[] = [];
  for (const entry of value) {
    const point = parsePoint(entry);
    if (!point) return null;
    points.push(point);
  }
  return Object.freeze(points);
}

function parseFloorQuad(
  value: unknown,
): AfcAdminVisualOverlayFloorQuad | null | undefined {
  if (value == null) return null;
  if (!isRecord(value)) return undefined;
  if (value.space !== AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE) return undefined;
  const points = parsePoints(value.points, 3);
  if (!points) return undefined;
  return Object.freeze({
    space: AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE,
    points,
  });
}

function parseCollisionEdge(
  value: unknown,
): AfcAdminVisualOverlayCollisionEdge | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  const points = parsePoints(value.points, 2);
  if (!points) return null;
  return Object.freeze({
    id: value.id,
    points,
  });
}

export function parseAfcAdminVisualOverlayV1(
  value: unknown,
): AfcAdminVisualOverlayV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== AFC_ADMIN_VISUAL_OVERLAY_VERSION) return null;
  if (value.projectionVersion !== AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION) {
    return null;
  }
  const artifactBasis = parseAfcDiagnosticVisualArtifactKind(
    value.artifactBasis,
  );
  if (!artifactBasis) return null;
  if (!isRecord(value.frame)) return null;
  const width = finiteNumber(value.frame.width);
  const height = finiteNumber(value.frame.height);
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  const floorQuad = parseFloorQuad(value.floorQuad);
  if (floorQuad === undefined) return null;
  if (!Array.isArray(value.collisionEdges)) return null;
  const collisionEdges: AfcAdminVisualOverlayCollisionEdge[] = [];
  for (const entry of value.collisionEdges) {
    const edge = parseCollisionEdge(entry);
    if (!edge) return null;
    collisionEdges.push(edge);
  }
  return Object.freeze({
    version: AFC_ADMIN_VISUAL_OVERLAY_VERSION,
    projectionVersion: AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
    artifactBasis,
    frame: Object.freeze({ width, height }),
    floorQuad,
    collisionEdges: Object.freeze(collisionEdges),
  });
}

export function buildAfcDiagnosticVisualOverlayUrl(input: {
  caseId: string;
  generationId: string;
  kind: AfcDiagnosticVisualArtifactKind;
}): string {
  return `/api/admin/afc-diagnostics/cases/${input.caseId}/generations/${input.generationId}/overlay?artifact=${input.kind}`;
}

export function createAfcDiagnosticVisualOverlayCoordinator() {
  return createAfcDiagnosticVisualEvidenceCoordinator();
}

export type AfcDiagnosticVisualOverlayBegin = AfcDiagnosticVisualEvidenceBegin;

export function isAfcDiagnosticVisualOverlayAbortError(error: unknown): boolean {
  return isAfcDiagnosticVisualAbortError(error);
}

export function afcDiagnosticVisualOverlayFloorAvailable(
  overlay: AfcAdminVisualOverlayV1 | null | undefined,
): boolean {
  return overlay?.floorQuad != null;
}

export function afcDiagnosticVisualOverlayCollisionAvailable(
  overlay: AfcAdminVisualOverlayV1 | null | undefined,
): boolean {
  return (overlay?.collisionEdges.length ?? 0) > 0;
}

export function afcDiagnosticVisualOverlayHasGeometry(
  overlay: AfcAdminVisualOverlayV1 | null | undefined,
): boolean {
  return (
    afcDiagnosticVisualOverlayFloorAvailable(overlay) ||
    afcDiagnosticVisualOverlayCollisionAvailable(overlay)
  );
}

export function afcDiagnosticVisualOverlayBasisLabel(
  overlay: AfcAdminVisualOverlayV1 | null | undefined,
): string {
  if (!overlay || !afcDiagnosticVisualOverlayHasGeometry(overlay)) {
    return AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.unavailable;
  }
  if (overlay.artifactBasis === "original") {
    return AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.originalBasis;
  }
  return AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.identityBasis;
}

export function afcDiagnosticVisualOverlayErrorMessage(status: number | "network"): string {
  if (status === 401) return "Session expired. Sign in again.";
  if (status === 403) return "Admin access required.";
  return AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.error;
}

export type { AfcDiagnosticVisualArtifactKind, AfcDiagnosticVisualEvidenceTuple };
