/**
 * Shopper Harmonize experience decisions.
 *
 * Capture, enqueue, and History publication stay on the existing job path.
 * This module decides access, disclosure, progress, and how a published
 * image is shown. It does not insert History rows or contact a provider.
 */

import type { HarmonizeBackdropKind } from "@/lib/vibode-stage/harmonize-jobs/backdrop-kind";
import { canonicalJson } from "@/lib/vibode-stage/harmonize-export";

export const HARMONIZE_AI_DISCLOSURE_KEY = "harmonize_ai_disclosure_v1";

export const HARMONIZE_AI_DISCLOSURE_TEXT =
  "AI-generated image — for inspiration. Colors, materials, textures and product details may differ from the actual products. Check the retailer's product information before purchasing.";

export const HARMONIZE_AI_LABEL = "AI-generated";

export const HARMONIZE_HISTORY_SAVED_NOTICE = "Harmonized image saved to History.";

export const HARMONIZE_WATCH_STORAGE_KEY = "vibode.harmonize.watch";

export const HARMONIZE_SCENE_UNAVAILABLE = "This Harmonized image has no editable furniture scene.";

export const HARMONIZE_BACKDROP_UNAVAILABLE =
  "The captured background for this Harmonized image is unavailable.";

export const HARMONIZE_BACKDROP_LOADING = "Loading the Harmonized view…";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HarmonizeExperiencePhase =
  | "idle"
  | "preparing"
  | "queued"
  | "running"
  | "publishing"
  | "published"
  | "failed"
  | "blocked";

export type HarmonizeButtonAccess = "hidden" | "disabled" | "ready";

export type HarmonizeDisclosureChoice = "unknown" | "accepted" | "declined";

export type HarmonizeExperienceJob = Readonly<{
  id: string;
  status: string;
  historyState: "pending" | "published" | "unavailable" | null;
  outputAssetId: string | null;
  outputActive: boolean | null;
  roomId: string | null;
  sourceVersionId: string | null;
  afcGenerationId: string | null;
  backdropKind: HarmonizeBackdropKind | null;
  sceneObjectsSha256: string | null;
  backgroundSha256: string | null;
  roomScaleMultiplier: number | null;
  failureCode: string | null;
  failureMessage: string | null;
}>;

/** Owner-readable capture identity. Backdrop kind comes from the job row. */
export type HarmonizeHistoryView = Readonly<{
  assetId: string;
  sourceVersionId: string | null;
  afcGenerationId: string | null;
  backdropKind: HarmonizeBackdropKind | null;
  outputActive: boolean;
}>;

export type HarmonizeHistoryAccess =
  | Readonly<{ status: "hidden" }>
  | Readonly<{ status: "ordinary" }>
  | Readonly<{ status: "ready"; view: HarmonizeHistoryView }>;

export type HarmonizeLiveCapture = Readonly<{
  roomId: string | null;
  sourceVersionId: string | null;
  afcGenerationId: string | null;
  roomScaleMultiplier: number | null;
  sceneObjectsSha256: string | null;
  backgroundSha256: string | null;
}>;

export type HarmonizePublicationDecision = Readonly<{
  action: "show-2d" | "notice";
  assetId: string | null;
  activate: false;
  reloadHistory: true;
  insertHistory: false;
  message: string | null;
}>;

export type HarmonizeEditorPresentation = Readonly<{
  harmonized: boolean;
  sceneVersionId: string | null;
  saveVersionId: string | null;
  backgroundImageUrl: string | null;
  lockBackground: boolean;
  mountViewer: boolean;
  showAiLabel: boolean;
  forkScene: false;
  renderFurnitureOnHarmonizedImage: false;
  unavailableMessage: string | null;
}>;

type HistoryVersion = Readonly<{
  id: string;
  imageUrl: string | null;
  isActive?: unknown;
}>;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uuid(value: unknown): string | null {
  const id = text(value);
  return id && UUID_RE.test(id) ? id : null;
}

function normalizeUrl(value: string | null | undefined): string | null {
  return text(value);
}

/** Durable `harmonize_job_id` only. Version metadata is not capture authority. */
export function isHarmonizedHistoryAsset(asset: unknown): boolean {
  const row = record(asset);
  if (!row) return false;
  return Boolean(uuid(row.harmonize_job_id) ?? uuid(row.harmonizeJobId));
}

export function harmonizeAssetClaim(asset: unknown): Readonly<{
  roomId: string;
  assetId: string;
}> | null {
  const row = record(asset);
  const roomId = uuid(row?.room_id);
  const assetId = uuid(row?.id);
  const jobId = uuid(row?.harmonize_job_id) ?? uuid(row?.harmonizeJobId);
  if (!row || !roomId || !assetId || !jobId) return null;
  return { roomId, assetId };
}

/** A stored acknowledgement never bypasses the Harmonize access gate. */
export function harmonizeAcknowledgementGrantsAccess(): false {
  return false;
}

export function harmonizeButtonAccess(input: Readonly<{
  isAdmin: boolean;
  available: boolean | null;
  qaReady: boolean;
}>): HarmonizeButtonAccess {
  if (!input.isAdmin) return "hidden";
  if (input.available !== true || !input.qaReady) return "disabled";
  return "ready";
}

export function harmonizeDisclosureGate(
  choice: HarmonizeDisclosureChoice,
): "ask" | "proceed" | "stop" {
  if (choice === "accepted") return "proceed";
  if (choice === "declined") return "stop";
  return "ask";
}

export function harmonizeExperiencePhase(input: Readonly<{
  submitting: boolean;
  job: HarmonizeExperienceJob | null;
}>): HarmonizeExperiencePhase {
  if (input.submitting) return "preparing";
  const job = input.job;
  if (!job) return "idle";
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "failed" || job.status === "cancelled") return "failed";
  if (job.status !== "succeeded") return "idle";
  if (job.historyState === "published") return "published";
  if (job.historyState === "unavailable") return "blocked";
  return "publishing";
}

export function harmonizeButtonLabel(phase: HarmonizeExperiencePhase): string {
  switch (phase) {
    case "preparing":
      return "Saving scene…";
    case "queued":
      return "Harmonize queued";
    case "running":
      return "Harmonizing…";
    case "publishing":
      return "Not in History yet";
    case "failed":
      return "Harmonize failed";
    case "blocked":
      return "History unavailable";
    default:
      return "Harmonize";
  }
}

/** Provider work in this session. A pending or blocked History result is not busy. */
export function harmonizePhaseBusy(phase: HarmonizeExperiencePhase): boolean {
  return phase === "preparing" || phase === "queued" || phase === "running";
}

export function harmonizeCanSubmit(input: Readonly<{
  access: HarmonizeButtonAccess;
  phase: HarmonizeExperiencePhase;
  gateHeld: boolean;
}>): boolean {
  if (input.access !== "ready" || input.gateHeld) return false;
  return input.phase === "idle"
    || input.phase === "published"
    || input.phase === "failed"
    || input.phase === "blocked";
}

export function harmonizeShouldPoll(phase: HarmonizeExperiencePhase): boolean {
  return phase === "queued" || phase === "running" || phase === "publishing";
}

export function harmonizeWatchJobId(input: Readonly<{
  jobId: string | null;
  phase: HarmonizeExperiencePhase;
  watchedJobId: string | null;
}>): string | null {
  if (!input.watchedJobId) return null;
  if (input.jobId && input.watchedJobId !== input.jobId) return null;
  if (
    (input.phase === "failed" || input.phase === "blocked")
    && input.watchedJobId === input.jobId
  ) {
    return null;
  }
  return input.watchedJobId;
}

export function harmonizeShouldSettlePublication(input: Readonly<{
  jobId: string;
  phase: HarmonizeExperiencePhase;
  watchedJobId: string | null;
}>): boolean {
  return input.phase === "published" && input.watchedJobId === input.jobId;
}

export async function hashHarmonizeSceneObjects(
  objects: readonly unknown[],
): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalJson(objects));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function harmonizeLiveBackgroundSha256(
  job: HarmonizeExperienceJob,
  live: Readonly<{
    sourceVersionId: string | null;
    afcGenerationId: string | null;
  }>,
): string | null {
  if (!job.backgroundSha256 || !job.backdropKind) return null;
  if (job.backdropKind === "room_asset") {
    return live.sourceVersionId === job.sourceVersionId ? job.backgroundSha256 : null;
  }
  return live.afcGenerationId === job.afcGenerationId ? job.backgroundSha256 : null;
}

function sameText(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left === right);
}

export function planHarmonizePublicationView(input: Readonly<{
  job: HarmonizeExperienceJob;
  versions: readonly HistoryVersion[];
  live: HarmonizeLiveCapture;
}>): HarmonizePublicationDecision {
  const notice: HarmonizePublicationDecision = {
    action: "notice",
    assetId: null,
    activate: false,
    reloadHistory: true,
    insertHistory: false,
    message: HARMONIZE_HISTORY_SAVED_NOTICE,
  };
  const job = input.job;
  if (job.historyState !== "published" || !job.outputAssetId) return notice;
  const listed = input.versions.find((version) => version.id === job.outputAssetId);
  if (!listed) return notice;
  const live = input.live;
  const matches = sameText(live.roomId, job.roomId)
    && sameText(live.sourceVersionId, job.sourceVersionId)
    && sameText(live.afcGenerationId, job.afcGenerationId)
    && live.roomScaleMultiplier != null
    && job.roomScaleMultiplier != null
    && live.roomScaleMultiplier === job.roomScaleMultiplier
    && sameText(live.sceneObjectsSha256, job.sceneObjectsSha256)
    && sameText(live.backgroundSha256, job.backgroundSha256);
  if (!matches || job.outputActive !== true || listed.isActive !== true) return notice;
  return {
    action: "show-2d",
    assetId: job.outputAssetId,
    activate: false,
    reloadHistory: true,
    insertHistory: false,
    message: null,
  };
}

export function resolveHarmonizeBackdrop(input: Readonly<{
  backdropKind: HarmonizeBackdropKind | null;
  harmonizedImageUrl: string | null;
  sourceImageUrl: string | null;
  originalImageUrl: string | null;
  emptyImageUrl: string | null;
  originalValid: boolean;
}>): string | null {
  const harmonized = normalizeUrl(input.harmonizedImageUrl);
  const accept = (value: string | null | undefined): string | null => {
    const url = normalizeUrl(value);
    if (!url || url === harmonized) return null;
    return url;
  };
  if (input.backdropKind === "afc_empty") return accept(input.emptyImageUrl);
  if (input.backdropKind === "afc_original") {
    return input.originalValid ? accept(input.originalImageUrl) : null;
  }
  if (input.backdropKind === "room_asset") {
    return accept(input.sourceImageUrl)
      ?? (input.originalValid ? accept(input.originalImageUrl) : null);
  }
  return null;
}

export function planHarmonizeEditorPresentation(input: Readonly<{
  selected: Readonly<{
    id: string;
    imageUrl: string | null;
    harmonizeJobId: string | null;
  }> | null;
  versions: readonly HistoryVersion[];
  presentation: HarmonizeHistoryView | null;
  selectionStatus: "idle" | "loading" | "ready" | "unavailable";
  generationId: string | null;
  originalImageUrl: string | null;
  emptyImageUrl: string | null;
  standardBackgroundUrl: string | null;
}>): HarmonizeEditorPresentation {
  const selected = input.selected;
  const standard: HarmonizeEditorPresentation = {
    harmonized: false,
    sceneVersionId: selected?.id ?? null,
    saveVersionId: selected?.id ?? null,
    backgroundImageUrl: input.standardBackgroundUrl,
    lockBackground: false,
    mountViewer: true,
    showAiLabel: false,
    forkScene: false,
    renderFurnitureOnHarmonizedImage: false,
    unavailableMessage: null,
  };
  if (!selected || !uuid(selected.harmonizeJobId)) return standard;
  const view = input.presentation?.assetId === selected.id ? input.presentation : null;
  const sourceId = view?.sourceVersionId && view.sourceVersionId !== selected.id
    ? view.sourceVersionId
    : null;
  const source = sourceId
    ? input.versions.find((version) => version.id === sourceId) ?? null
    : null;
  const base = {
    harmonized: true,
    sceneVersionId: source ? sourceId : null,
    saveVersionId: source ? sourceId : null,
    lockBackground: true,
    showAiLabel: true,
    forkScene: false as const,
    renderFurnitureOnHarmonizedImage: false as const,
  };
  if (input.selectionStatus === "loading") {
    return {
      ...base,
      sceneVersionId: null,
      saveVersionId: null,
      backgroundImageUrl: null,
      mountViewer: false,
      unavailableMessage: HARMONIZE_BACKDROP_LOADING,
    };
  }
  if (!view || input.selectionStatus !== "ready") {
    return {
      ...base,
      sceneVersionId: null,
      saveVersionId: null,
      backgroundImageUrl: null,
      mountViewer: false,
      unavailableMessage: HARMONIZE_BACKDROP_UNAVAILABLE,
    };
  }
  if (!sourceId || !source) {
    return {
      ...base,
      backgroundImageUrl: null,
      mountViewer: false,
      unavailableMessage: HARMONIZE_SCENE_UNAVAILABLE,
    };
  }
  const generationMatches = Boolean(
    view.afcGenerationId && view.afcGenerationId === input.generationId,
  );
  const backdrop = resolveHarmonizeBackdrop({
    backdropKind: view.backdropKind,
    harmonizedImageUrl: selected.imageUrl,
    sourceImageUrl: source.imageUrl,
    originalImageUrl: input.originalImageUrl,
    emptyImageUrl: generationMatches ? input.emptyImageUrl : null,
    originalValid: generationMatches && Boolean(normalizeUrl(input.originalImageUrl)),
  });
  if (!backdrop) {
    return {
      ...base,
      backgroundImageUrl: null,
      mountViewer: false,
      unavailableMessage: HARMONIZE_BACKDROP_UNAVAILABLE,
    };
  }
  return {
    ...base,
    backgroundImageUrl: backdrop,
    mountViewer: true,
    unavailableMessage: null,
  };
}

export function harmonizeHistoryAccess(input: Readonly<{
  callerUserId: string;
  roomId: string;
  assetId: string;
  asset: Readonly<{
    id: string;
    roomId: string;
    userId: string;
    harmonizeJobId: string | null;
    isActive: boolean;
  }> | null;
  job: Readonly<{
    id: string;
    userId: string;
    roomId: string;
    outputAssetId: string | null;
    sourceVersionId: string | null;
    afcGenerationId: string | null;
    backdropKind: string | null;
    historyState: string | null;
    status: string;
  }> | null;
}>): HarmonizeHistoryAccess {
  const asset = input.asset;
  if (
    !asset
    || asset.id !== input.assetId
    || asset.roomId !== input.roomId
    || asset.userId !== input.callerUserId
  ) {
    return { status: "hidden" };
  }
  const jobId = uuid(asset.harmonizeJobId);
  if (!jobId) return { status: "ordinary" };
  const job = input.job;
  if (
    !job
    || job.id !== jobId
    || job.userId !== input.callerUserId
    || job.roomId !== input.roomId
    || job.outputAssetId !== asset.id
    || job.historyState !== "published"
    || job.status !== "succeeded"
  ) {
    return { status: "hidden" };
  }
  return {
    status: "ready",
    view: {
      assetId: asset.id,
      sourceVersionId: uuid(job.sourceVersionId),
      afcGenerationId: uuid(job.afcGenerationId),
      backdropKind: backdropKind(job.backdropKind),
      outputActive: asset.isActive === true,
    },
  };
}

function backdropKind(value: unknown): HarmonizeBackdropKind | null {
  return value === "afc_empty" || value === "afc_original" || value === "room_asset"
    ? value
    : null;
}

function historyState(value: unknown): HarmonizeExperienceJob["historyState"] {
  return value === "pending" || value === "published" || value === "unavailable" ? value : null;
}

export function readHarmonizeExperienceJobRecord(value: unknown): HarmonizeExperienceJob | null {
  const row = record(value);
  const id = text(row?.id);
  const status = text(row?.status);
  if (!row || !id || !UUID_RE.test(id) || !status) return null;
  const scale = row.roomScaleMultiplier;
  return {
    id,
    status,
    historyState: historyState(row.historyState),
    outputAssetId: text(row.outputAssetId),
    outputActive: typeof row.outputActive === "boolean" ? row.outputActive : null,
    roomId: text(row.roomId),
    sourceVersionId: text(row.sourceVersionId),
    afcGenerationId: text(row.afcGenerationId),
    backdropKind: backdropKind(row.backdropKind),
    sceneObjectsSha256: text(row.sceneObjectsSha256),
    backgroundSha256: text(row.backgroundSha256),
    roomScaleMultiplier: typeof scale === "number" && Number.isFinite(scale) ? scale : null,
    failureCode: text(row.failureCode),
    failureMessage: text(row.failureMessage),
  };
}

export function readHarmonizeHistoryViewResponse(value: unknown): HarmonizeHistoryView | "ordinary" | null {
  const row = record(value);
  if (!row) return null;
  if (row.harmonized === false) return "ordinary";
  if (row.harmonized !== true) return null;
  const assetId = uuid(row.assetId);
  if (!assetId) return null;
  return {
    assetId,
    sourceVersionId: uuid(row.sourceVersionId),
    afcGenerationId: uuid(row.afcGenerationId),
    backdropKind: backdropKind(row.backdropKind),
    outputActive: row.outputActive === true,
  };
}

export type HarmonizeSourceSceneResolution = "deny" | "missing" | "present" | "malformed";

/**
 * Read-only rule for a Harmonized History asset whose source scene row is gone.
 * A denied or missing result must not fall through to PI-4D inheritance.
 */
export function harmonizeSourceSceneResolution(input: Readonly<{
  callerUserId: string;
  roomId: string;
  sourceVersionId: string;
  harmonizeAssetId: string;
  asset: Readonly<{
    id: string;
    roomId: string;
    userId: string;
    harmonizeJobId: string | null;
  }> | null;
  job: Readonly<{
    id: string;
    userId: string;
    roomId: string;
    sourceVersionId: string | null;
    outputAssetId: string | null;
    historyState: string | null;
    status: string;
  }> | null;
  scene: "missing" | "present" | "malformed";
}>): HarmonizeSourceSceneResolution {
  const asset = input.asset;
  const jobId = uuid(asset?.harmonizeJobId);
  const job = input.job;
  const linked = Boolean(
    asset
    && jobId
    && job
    && asset.id === input.harmonizeAssetId
    && asset.roomId === input.roomId
    && asset.userId === input.callerUserId
    && job.id === jobId
    && job.userId === input.callerUserId
    && job.roomId === input.roomId
    && job.sourceVersionId === input.sourceVersionId
    && job.outputAssetId === asset.id
    && job.historyState === "published"
    && job.status === "succeeded"
    && input.sourceVersionId !== asset.id,
  );
  if (!linked) return "deny";
  return input.scene;
}
