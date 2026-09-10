/**
 * Presentation-only helpers for the production AFC viewer.
 *
 * These values must never become AFC generation identity, Camera/Floor
 * authority, metric scale, collision input, or a Three.js world reset key.
 */

export type ViewerBackgroundImageInput = Readonly<{
  backgroundImageUrl?: string | null;
  originalImageUrl?: string | null;
}>;

export type IntegratedEditorBackgroundImageInput = Readonly<{
  selectedVersionImageUrl?: string | null;
  editorVisualUrl?: string | null;
  originalImageUrl?: string | null;
}>;

export type IntegratedViewerWorldLifecycleInput = Readonly<{
  generationId: string;
  selectedVersionId?: string | null;
  activeAssetId?: string | null;
  backgroundImageUrl?: string | null;
  originalImageUrl?: string | null;
}>;

export const VIEWER_BACKGROUND_IMAGE_ALT = "Active Vibode room version";

export type ProductionViewerFloorPresentation = Readonly<{
  renderMesh: false;
}>;

export function productionViewerFloorPresentation(): ProductionViewerFloorPresentation {
  return { renderMesh: false };
}

export function resolveViewerBackgroundImageUrl(
  input: ViewerBackgroundImageInput,
): string | null {
  const preferred = normalizePresentationImageUrl(input.backgroundImageUrl);
  if (preferred) return preferred;
  return normalizePresentationImageUrl(input.originalImageUrl);
}

/**
 * Integrated Editor 3D background is the active History version visual.
 * ORIGINAL / runtime originalImageUrl is last-resort presentation only.
 */
export function resolveIntegratedEditorBackgroundImageUrl(
  input: IntegratedEditorBackgroundImageInput,
): string | null {
  return resolveViewerBackgroundImageUrl({
    backgroundImageUrl:
      normalizePresentationImageUrl(input.selectedVersionImageUrl) ??
      normalizePresentationImageUrl(input.editorVisualUrl),
    originalImageUrl: input.originalImageUrl,
  });
}

export function productionViewerWorldLifecycleKey(
  authority: Readonly<{ generationId: string }>,
): string {
  return authority.generationId;
}

function normalizePresentationImageUrl(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function integratedViewerWorldLifecycleKey(
  input: IntegratedViewerWorldLifecycleInput,
): string {
  return productionViewerWorldLifecycleKey({ generationId: input.generationId });
}
