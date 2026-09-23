import {
  sourceNormToContainerNormDiagnostic,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import type { AfcProposalOverlayViewModel } from "./research/afc-proposal-overlay-view-model";

export const AFC_VIEWPORT_CORNER_ORDER = ["NL", "NR", "FR", "FL"] as const;
export type AfcViewportCornerName = (typeof AFC_VIEWPORT_CORNER_ORDER)[number];
export type AfcViewportImageRole = "original" | "empty";

export type AfcViewportDisplayControls = Readonly<{
  showInMainViewport: boolean;
  showFill: boolean;
  showStroke: boolean;
  showMarkers: boolean;
  showLabels: boolean;
  opacity: number;
}>;

export const DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS: AfcViewportDisplayControls = Object.freeze({
  showInMainViewport: false,
  showFill: true,
  showStroke: true,
  showMarkers: true,
  showLabels: true,
  opacity: 0.18,
});

export type AfcViewportEvidenceSnapshot = Readonly<{
  contract: "afc-ui1b-viewport-evidence/v1";
  receipt: Readonly<{
    receiptFileName: string;
    receiptSha256: string;
    r3cCandidateId: string;
  }>;
  selectedImageRole: AfcViewportImageRole;
  images: Readonly<{
    original: Readonly<{ sha256: string; width: number; height: number }>;
    empty: Readonly<{ sha256: string; width: number; height: number }>;
  }>;
  corners: Readonly<Record<AfcViewportCornerName, Readonly<{ x: number; y: number; support: string }>>>;
  display: AfcViewportDisplayControls;
  safety: Readonly<{
    readOnly: true;
    unapplied: true;
    nonAuthoritative: true;
    notPersisted: true;
  }>;
}>;

export type AfcViewportEvidenceSnapshotInput = Readonly<{
  viewModel: AfcProposalOverlayViewModel | null;
  status: string;
  imageUrl: string | null;
  selectedImageRole: AfcViewportImageRole;
  display: AfcViewportDisplayControls;
}>;

type SnapshotImage = Readonly<{ sha256: string; width: number; height: number }>;

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasValidImage(image: SnapshotImage): boolean {
  return typeof image.sha256 === "string" && image.sha256.length > 0 &&
    isFinitePositive(image.width) && isFinitePositive(image.height);
}

function hasValidDisplay(display: AfcViewportDisplayControls): boolean {
  return typeof display.showInMainViewport === "boolean" &&
    typeof display.showFill === "boolean" &&
    typeof display.showStroke === "boolean" &&
    typeof display.showMarkers === "boolean" &&
    typeof display.showLabels === "boolean" &&
    typeof display.opacity === "number" &&
    Number.isFinite(display.opacity) &&
    display.opacity >= 0 &&
    display.opacity <= 1;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Copies the validated UI1A browser view model into a deliberately minimal,
 * frozen evidence-only boundary. No parsed artifact or authority-bearing state
 * crosses into the lab viewport.
 */
export function buildAfcViewportEvidenceSnapshot(
  input: AfcViewportEvidenceSnapshotInput
): AfcViewportEvidenceSnapshot | null {
  const { viewModel, status, imageUrl, selectedImageRole, display } = input;
  if (!viewModel || status !== "valid" || !imageUrl || !hasValidDisplay(display)) return null;

  const original: SnapshotImage = {
    sha256: viewModel.imageBasis.original.sha256,
    width: viewModel.imageBasis.original.width,
    height: viewModel.imageBasis.original.height,
  };
  const empty: SnapshotImage = {
    sha256: viewModel.imageBasis.emptyRoom.sha256,
    width: viewModel.imageBasis.emptyRoom.width,
    height: viewModel.imageBasis.emptyRoom.height,
  };
  if (!hasValidImage(original) || !hasValidImage(empty)) return null;

  const corners = {} as Record<AfcViewportCornerName, Readonly<{ x: number; y: number; support: string }>>;
  for (const name of AFC_VIEWPORT_CORNER_ORDER) {
    const corner = viewModel.corners[name];
    if (!corner || !Number.isFinite(corner.x) || !Number.isFinite(corner.y) || typeof corner.support !== "string") return null;
    corners[name] = { x: corner.x, y: corner.y, support: corner.support };
  }
  if (
    typeof viewModel.artifactIdentity.receiptFileName !== "string" ||
    typeof viewModel.artifactIdentity.receiptSha256 !== "string" ||
    typeof viewModel.candidate.r3cCandidateId !== "string"
  ) return null;

  return deepFreeze({
    contract: "afc-ui1b-viewport-evidence/v1" as const,
    receipt: {
      receiptFileName: viewModel.artifactIdentity.receiptFileName,
      receiptSha256: viewModel.artifactIdentity.receiptSha256,
      r3cCandidateId: viewModel.candidate.r3cCandidateId,
    },
    selectedImageRole,
    images: { original, empty },
    corners,
    display: {
      showInMainViewport: display.showInMainViewport,
      showFill: display.showFill,
      showStroke: display.showStroke,
      showMarkers: display.showMarkers,
      showLabels: display.showLabels,
      opacity: display.opacity,
    },
    safety: {
      readOnly: true as const,
      unapplied: true as const,
      nonAuthoritative: true as const,
      notPersisted: true as const,
    },
  });
}

export type AfcViewportProjectionSuppressedReason =
  | "no_snapshot"
  | "display_disabled"
  | "basis_pending"
  | "basis_mismatch"
  | "intrinsic_dimensions_missing"
  | "intrinsic_dimensions_mismatch"
  | "frame_dimensions_invalid"
  | "projection_failed";

export type AfcProjectedViewportCorner = Readonly<{
  name: AfcViewportCornerName;
  x: number;
  y: number;
  visibleInFrame: boolean;
  overshootX: number;
  overshootY: number;
}>;

export type AfcMainViewportProjection = Readonly<{
  kind: "projected";
  matchedRole: AfcViewportImageRole;
  selectedImageRole: AfcViewportImageRole;
  crossRole: boolean;
  cornerOrder: readonly AfcViewportCornerName[];
  corners: Readonly<Record<AfcViewportCornerName, AfcProjectedViewportCorner>>;
  polygonPointsAttribute: string;
  offFrameCornerCount: number;
  viewportBadgeText: string;
  display: AfcViewportDisplayControls;
  safety: AfcViewportEvidenceSnapshot["safety"];
}>;

export type AfcMainViewportProjectionSuppressed = Readonly<{
  kind: "suppressed";
  reason: AfcViewportProjectionSuppressedReason;
}>;

export type AfcMainViewportProjectionResult =
  | AfcMainViewportProjection
  | AfcMainViewportProjectionSuppressed;

function suppress(reason: AfcViewportProjectionSuppressedReason): AfcMainViewportProjectionSuppressed {
  return Object.freeze({ kind: "suppressed" as const, reason });
}

function isValidSize(size: ImageIntrinsicSize | ImageFrameSize | null): size is ImageIntrinsicSize | ImageFrameSize {
  return !!size && isFinitePositive(size.width) && isFinitePositive(size.height);
}

function matchedRole(
  snapshot: AfcViewportEvidenceSnapshot,
  basisFingerprint: string
): AfcViewportImageRole | null {
  if (basisFingerprint === snapshot.images.original.sha256) return "original";
  if (basisFingerprint === snapshot.images.empty.sha256) return "empty";
  return null;
}

function offFrameBadge(corners: Readonly<Record<AfcViewportCornerName, AfcProjectedViewportCorner>>): string {
  const offFrame = AFC_VIEWPORT_CORNER_ORDER.filter((name) => !corners[name].visibleInFrame);
  if (!offFrame.length) return "AFC evidence — read-only";
  const labels = offFrame.map((name) => {
    const corner = corners[name];
    const directions = [
      corner.x < 0 ? "left" : "",
      corner.x > 1 ? "right" : "",
      corner.y < 0 ? "top" : "",
      corner.y > 1 ? "bottom" : "",
    ].filter(Boolean).join("/");
    return `${name} ↓ ${directions}`;
  });
  return `AFC evidence — read-only · ${offFrame.length} corner${offFrame.length === 1 ? "" : "s"} off-frame: ${labels.join(", ")}`;
}

/**
 * Pure, fail-closed object-cover projection for read-only AFC evidence. The
 * diagnostic helper deliberately preserves truthful off-frame coordinates.
 */
export function projectAfcViewportEvidence(
  snapshot: AfcViewportEvidenceSnapshot | null,
  basisFingerprint: string | null,
  intrinsicSize: ImageIntrinsicSize | null,
  frameSize: ImageFrameSize | null
): AfcMainViewportProjectionResult {
  if (!snapshot) return suppress("no_snapshot");
  if (!snapshot.display.showInMainViewport) return suppress("display_disabled");
  if (!basisFingerprint) return suppress("basis_pending");

  const role = matchedRole(snapshot, basisFingerprint);
  if (!role) return suppress("basis_mismatch");
  if (!isValidSize(intrinsicSize)) return suppress("intrinsic_dimensions_missing");
  const expected = role === "original" ? snapshot.images.original : snapshot.images.empty;
  if (intrinsicSize.width !== expected.width || intrinsicSize.height !== expected.height) {
    return suppress("intrinsic_dimensions_mismatch");
  }
  if (!isValidSize(frameSize)) return suppress("frame_dimensions_invalid");

  const corners = {} as Record<AfcViewportCornerName, AfcProjectedViewportCorner>;
  for (const name of AFC_VIEWPORT_CORNER_ORDER) {
    const source = snapshot.corners[name];
    const diagnostic = sourceNormToContainerNormDiagnostic(source, intrinsicSize, frameSize);
    if (!diagnostic) return suppress("projection_failed");
    const { x, y } = diagnostic.container;
    corners[name] = Object.freeze({
      name,
      x,
      y,
      visibleInFrame: diagnostic.visibleInFrame,
      overshootX: Math.max(0, -x, x - 1),
      overshootY: Math.max(0, -y, y - 1),
    });
  }
  const frozenCorners = Object.freeze(corners);
  return Object.freeze({
    kind: "projected" as const,
    matchedRole: role,
    selectedImageRole: snapshot.selectedImageRole,
    crossRole: role !== snapshot.selectedImageRole,
    cornerOrder: AFC_VIEWPORT_CORNER_ORDER,
    corners: frozenCorners,
    polygonPointsAttribute: AFC_VIEWPORT_CORNER_ORDER
      .map((name) => `${frozenCorners[name].x * 100},${frozenCorners[name].y * 100}`)
      .join(" "),
    offFrameCornerCount: AFC_VIEWPORT_CORNER_ORDER.filter((name) => !frozenCorners[name].visibleInFrame).length,
    viewportBadgeText: offFrameBadge(frozenCorners),
    display: snapshot.display,
    safety: snapshot.safety,
  });
}

export function describeAfcViewportProjectionSuppression(
  result: AfcMainViewportProjectionResult
): string | null {
  if (result.kind === "projected") return null;
  const messages: Record<AfcViewportProjectionSuppressedReason, string> = {
    no_snapshot: "No valid AFC viewport evidence is loaded.",
    display_disabled: "Main viewport evidence display is off.",
    basis_pending: "The main room image basis is pending qualification.",
    basis_mismatch: "The qualified main room image does not exactly match either verified receipt image.",
    intrinsic_dimensions_missing: "The main room image intrinsic dimensions are unavailable.",
    intrinsic_dimensions_mismatch: "The qualified image dimensions do not match the verified receipt image.",
    frame_dimensions_invalid: "The main viewport frame dimensions are unavailable.",
    projection_failed: "AFC evidence projection failed closed; no geometry is shown.",
  };
  return messages[result.reason];
}
