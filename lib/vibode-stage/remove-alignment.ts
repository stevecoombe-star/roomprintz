/**
 * REMOVE-1A inspection decisions.
 *
 * ORIGINAL and EMPTY stay immutable. Matching decoded dimensions are a grid
 * comparison only. Pixel registration stays unverified. This module does not
 * write History, the scene, room scale, or the certified camera.
 */

import {
  AFC_V2_ARTIFACT_LINEAGE_EMPTY_SOURCES,
  type AfcV2ArtifactLineageEmptySource,
} from "@/lib/afc-v2-production/artifact-lineage-diagnostic";
import {
  classifyAfcR3cImagePairCompatibility,
  type AfcR3cCompatibilityTier,
} from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";

export const REMOVE_PIXEL_REGISTRATION = "unverified" as const;

export const REMOVE_ALIGNMENT_NOTE =
  "Matching dimensions do not establish pixel registration. Both images are stretched into the certified camera frame.";

export const REMOVE_HARMONIZE_NOTE =
  "Harmonize still captures the History image behind this inspection.";

export const REMOVE_OPACITY_PRESETS = Object.freeze([
  Object.freeze({ id: "original" as const, label: "Original", opacity: 0 }),
  Object.freeze({ id: "blend" as const, label: "Blend", opacity: 50 }),
  Object.freeze({ id: "empty" as const, label: "Empty", opacity: 100 }),
]);

export type RemoveOpacityPresetId = (typeof REMOVE_OPACITY_PRESETS)[number]["id"];

export type RemoveViewMode = "original" | "blend" | "empty";

export type RemoveImageDescriptor = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  byteCount: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type RemoveAlignmentReport = Readonly<{
  usable: true;
  pixelRegistration: typeof REMOVE_PIXEL_REGISTRATION;
  generationId: string;
  original: RemoveImageDescriptor;
  empty: RemoveImageDescriptor & Readonly<{
    artifactSource: "durable" | "generated";
    lineageSource: AfcV2ArtifactLineageEmptySource;
    reusedFromGenerationId: string | null;
    lineageShaMatches: boolean;
  }>;
  frame: Readonly<{ width: number; height: number }>;
  frozenCameraFrame: Readonly<{ width: number; height: number }>;
  gridCompatibility: AfcR3cCompatibilityTier;
  relativeAspectError: number | null;
  originalAspect: number | null;
  emptyAspect: number | null;
}>;

export type RemoveAlignmentAssessment =
  | Readonly<{ usable: true; report: RemoveAlignmentReport }>
  | Readonly<{ usable: false; reason: string }>;

export type RemoveAlignmentLookup =
  | Readonly<{ access: "ready"; report: RemoveAlignmentReport }>
  | Readonly<{ access: "disabled"; reason: string }>
  | Readonly<{ access: "hidden" }>;

export type RemoveInspectionState = Readonly<{
  active: boolean;
  opacity: number;
  furnitureHidden: boolean;
}>;

export type RemoveInspectionEvent =
  | Readonly<{ type: "enter" }>
  | Readonly<{ type: "exit" }>
  | Readonly<{ type: "opacity"; opacity: number }>
  | Readonly<{ type: "preset"; preset: RemoveOpacityPresetId }>
  | Readonly<{ type: "furniture"; hidden: boolean }>;

export type RemoveInspectionInteraction = Readonly<{
  furnitureManipulation: boolean;
  historySelection: boolean;
  undo: boolean;
  roomScale: boolean;
  catalogPlacement: boolean;
}>;

export type RemoveGestureSettlement = "keep" | "clear" | "restore";

const ORIGINAL_UNAVAILABLE = "Authoritative ORIGINAL image is unavailable.";
const ORIGINAL_INTEGRITY = "Authoritative ORIGINAL image failed integrity checks.";
const EMPTY_UNAVAILABLE = "Authoritative EMPTY image is unavailable.";
const FRAME_UNAVAILABLE = "Certified camera frame is unavailable.";
const NOT_READY = "This room has no production-ready AFC generation.";

const SHA256 = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function initialRemoveInspectionState(): RemoveInspectionState {
  return { active: false, opacity: 50, furnitureHidden: false };
}

export function clampRemoveOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function removeViewMode(opacity: number): RemoveViewMode {
  const value = clampRemoveOpacity(opacity);
  if (value <= 0) return "original";
  if (value >= 100) return "empty";
  return "blend";
}

export function removeOverlayLayers(opacity: number): Readonly<{
  showOriginal: boolean;
  showEmpty: boolean;
  emptyOpacity: number;
}> {
  const mode = removeViewMode(opacity);
  if (mode === "original") return { showOriginal: true, showEmpty: false, emptyOpacity: 0 };
  if (mode === "empty") return { showOriginal: false, showEmpty: true, emptyOpacity: 1 };
  return {
    showOriginal: true,
    showEmpty: true,
    emptyOpacity: clampRemoveOpacity(opacity) / 100,
  };
}

export function removeOpacityPreset(opacity: number): RemoveOpacityPresetId | null {
  const value = clampRemoveOpacity(opacity);
  return REMOVE_OPACITY_PRESETS.find((preset) => preset.opacity === value)?.id ?? null;
}

export function presetOpacity(preset: RemoveOpacityPresetId): number {
  return REMOVE_OPACITY_PRESETS.find((item) => item.id === preset)?.opacity ?? 50;
}

/**
 * Inspection pauses the interactions that would write the room. Exit restores
 * them. The function does not carry scene, History, undo, scale, or camera data.
 */
export function removeInspectionInteraction(active: boolean): RemoveInspectionInteraction {
  const open = active !== true;
  return {
    furnitureManipulation: open,
    historySelection: open,
    undo: open,
    roomScale: open,
    catalogPlacement: open,
  };
}

export function removeInspectionAllowsCatalogPlacement(active: boolean): boolean {
  return removeInspectionInteraction(active).catalogPlacement;
}

/**
 * An in-progress drag is not a saved scene. Entering inspection restores the
 * last persisted pose instead of committing or abandoning the live mesh.
 */
export function settleRemoveInspectionGesture(input: Readonly<{
  manipulationEnabled: boolean;
  bodyDrag: "none" | "armed" | "active";
  gizmoDragging: boolean;
}>): RemoveGestureSettlement {
  if (input.manipulationEnabled) return "keep";
  if (input.bodyDrag === "active" || input.gizmoDragging) return "restore";
  if (input.bodyDrag === "armed") return "clear";
  return "keep";
}

export function removeInspectionAllowsHistorySelection(active: boolean): boolean {
  return removeInspectionInteraction(active).historySelection;
}

export function removeInspectionAllowsFurnitureManipulation(active: boolean): boolean {
  return removeInspectionInteraction(active).furnitureManipulation;
}

/** A stored hide flag does not apply after exit. */
export function removeFurnitureRenderingVisible(input: Readonly<{
  active: boolean;
  furnitureHidden: boolean;
}>): boolean {
  return !(input.active === true && input.furnitureHidden === true);
}

export function reduceRemoveInspection(
  state: RemoveInspectionState,
  event: RemoveInspectionEvent,
): RemoveInspectionState {
  if (event.type === "enter") {
    return { active: true, opacity: 50, furnitureHidden: false };
  }
  if (event.type === "exit") {
    return { ...state, active: false, furnitureHidden: false };
  }
  if (!state.active) return state;
  if (event.type === "opacity") {
    return { ...state, opacity: clampRemoveOpacity(event.opacity) };
  }
  if (event.type === "preset") {
    return { ...state, opacity: presetOpacity(event.preset) };
  }
  if (event.type === "furniture") {
    return { ...state, furnitureHidden: event.hidden === true };
  }
  return state;
}

export function removeAlignmentArtifactPath(
  roomId: string,
  artifact: "original" | "empty",
  generationId: string,
): string {
  return `/api/vibode/admin/remove-alignment?roomId=${encodeURIComponent(roomId)}&artifact=${artifact}&generationId=${encodeURIComponent(generationId)}`;
}

export function removeDecodedSizeDisagreement(
  certified: Readonly<{ width: number; height: number }>,
  displayed: Readonly<{ width: number; height: number }> | null,
): string | null {
  if (!displayed) return null;
  if (!positiveInteger(displayed.width) || !positiveInteger(displayed.height)) return null;
  if (displayed.width === certified.width && displayed.height === certified.height) return null;
  return `Displayed ${displayed.width}×${displayed.height} differs from certified ${certified.width}×${certified.height}.`;
}

export type RemoveAlignmentFacts = Readonly<{
  generationId: string;
  status: string;
  original: RemoveImageDescriptor | null;
  originalBytesMatch: boolean;
  empty: RemoveImageDescriptor | null;
  emptyBytesMatch: boolean;
  emptyFailure: string | null;
  emptyArtifactSource: "durable" | "generated" | null;
  lineageSource: AfcV2ArtifactLineageEmptySource | null;
  reusedFromGenerationId: string | null;
  lineageSha256: string | null;
  frame: Readonly<{ width: number; height: number }> | null;
  frozenCameraFrame: Readonly<{ width: number; height: number }> | null;
}>;

export function assessRemoveAlignment(facts: RemoveAlignmentFacts): RemoveAlignmentAssessment {
  if (facts.status !== "ready") return { usable: false, reason: NOT_READY };
  const original = facts.original;
  const empty = facts.empty;
  if (!original || original.orientation !== 1) return { usable: false, reason: ORIGINAL_UNAVAILABLE };
  if (!facts.originalBytesMatch) return { usable: false, reason: ORIGINAL_INTEGRITY };
  if (!empty || empty.orientation !== 1 || !facts.emptyArtifactSource) {
    return { usable: false, reason: facts.emptyFailure ?? EMPTY_UNAVAILABLE };
  }
  if (!facts.emptyBytesMatch) return { usable: false, reason: facts.emptyFailure ?? EMPTY_UNAVAILABLE };
  const frame = positiveFrame(facts.frame);
  const frozen = positiveFrame(facts.frozenCameraFrame);
  if (!frame || !frozen) return { usable: false, reason: FRAME_UNAVAILABLE };
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: original.sha256,
      decodedWidth: original.decodedWidth,
      decodedHeight: original.decodedHeight,
      orientation: original.orientation,
    },
    {
      fingerprint: empty.sha256,
      decodedWidth: empty.decodedWidth,
      decodedHeight: empty.decodedHeight,
      orientation: empty.orientation,
    },
  );
  const lineageSource = facts.lineageSource ?? "unknown";
  const lineageSha = facts.lineageSha256?.toLowerCase() ?? null;
  return {
    usable: true,
    report: {
      usable: true,
      pixelRegistration: REMOVE_PIXEL_REGISTRATION,
      generationId: facts.generationId,
      original,
      empty: {
        ...empty,
        artifactSource: facts.emptyArtifactSource,
        lineageSource,
        reusedFromGenerationId: facts.reusedFromGenerationId,
        lineageShaMatches: lineageSha !== null && lineageSha === empty.sha256.toLowerCase(),
      },
      frame,
      frozenCameraFrame: frozen,
      gridCompatibility: compatibility.tier,
      relativeAspectError: compatibility.relativeAspectError,
      originalAspect: compatibility.originalAspect,
      emptyAspect: compatibility.inputAspect,
    },
  };
}

export function interpretRemoveAlignmentResponse(input: Readonly<{
  status: number;
  payload: unknown;
}>): RemoveAlignmentLookup {
  if (input.status !== 200) return { access: "hidden" };
  const payload = record(input.payload);
  if (!payload) return { access: "hidden" };
  if (payload.usable === false) {
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (!reason) return { access: "hidden" };
    return { access: "disabled", reason };
  }
  if (payload.usable !== true) return { access: "hidden" };
  const report = readRemoveAlignmentReport(payload.report);
  if (!report) return { access: "disabled", reason: "Alignment report is invalid." };
  return { access: "ready", report };
}

export function readRemoveAlignmentReport(value: unknown): RemoveAlignmentReport | null {
  const report = record(value);
  if (!report || report.usable !== true || report.pixelRegistration !== REMOVE_PIXEL_REGISTRATION) {
    return null;
  }
  if (typeof report.generationId !== "string" || !UUID.test(report.generationId)) return null;
  const original = readImage(report.original);
  const emptyImage = readImage(report.empty);
  const empty = record(report.empty);
  const frame = readFrame(report.frame);
  const frozen = readFrame(report.frozenCameraFrame);
  if (!original || !emptyImage || !empty || !frame || !frozen) return null;
  const artifactSource = empty.artifactSource === "durable" || empty.artifactSource === "generated"
    ? empty.artifactSource
    : null;
  const lineageSource = member(empty.lineageSource, AFC_V2_ARTIFACT_LINEAGE_EMPTY_SOURCES);
  if (!artifactSource || !lineageSource) return null;
  const reused = empty.reusedFromGenerationId;
  if (reused !== null && (typeof reused !== "string" || !UUID.test(reused))) return null;
  if (typeof empty.lineageShaMatches !== "boolean") return null;
  const tier = report.gridCompatibility;
  if (tier !== "exact_grid_compatible" && tier !== "aspect_compatible_rescaled" && tier !== "incompatible") {
    return null;
  }
  if (!optionalNumber(report.relativeAspectError)) return null;
  if (!optionalNumber(report.originalAspect) || !optionalNumber(report.emptyAspect)) return null;
  return {
    usable: true,
    pixelRegistration: REMOVE_PIXEL_REGISTRATION,
    generationId: report.generationId,
    original,
    empty: {
      ...emptyImage,
      artifactSource,
      lineageSource,
      reusedFromGenerationId: reused,
      lineageShaMatches: empty.lineageShaMatches,
    },
    frame,
    frozenCameraFrame: frozen,
    gridCompatibility: tier,
    relativeAspectError: report.relativeAspectError as number | null,
    originalAspect: report.originalAspect as number | null,
    emptyAspect: report.emptyAspect as number | null,
  };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function positiveFrame(
  value: Readonly<{ width: number; height: number }> | null,
): Readonly<{ width: number; height: number }> | null {
  if (!value || !positiveInteger(value.width) || !positiveInteger(value.height)) return null;
  return { width: value.width, height: value.height };
}

function readFrame(value: unknown): Readonly<{ width: number; height: number }> | null {
  const frame = record(value);
  if (!frame || !positiveInteger(frame.width) || !positiveInteger(frame.height)) return null;
  return { width: frame.width, height: frame.height };
}

function readImage(value: unknown): RemoveImageDescriptor | null {
  const image = record(value);
  if (!image) return null;
  if (typeof image.sha256 !== "string" || !SHA256.test(image.sha256)) return null;
  if (!positiveInteger(image.decodedWidth) || !positiveInteger(image.decodedHeight)) return null;
  if (!positiveInteger(image.byteCount)) return null;
  if (typeof image.mimeType !== "string" || !MIME.has(image.mimeType)) return null;
  if (image.orientation !== 1) return null;
  return {
    sha256: image.sha256.toLowerCase(),
    decodedWidth: image.decodedWidth,
    decodedHeight: image.decodedHeight,
    byteCount: image.byteCount,
    mimeType: image.mimeType as RemoveImageDescriptor["mimeType"],
    orientation: 1,
  };
}

function optionalNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
