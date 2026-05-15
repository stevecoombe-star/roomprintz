import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSceneRebuildPayload, type SceneRebuildPayload } from "@/lib/vibodeSceneState";
import { finalizeVibodeOutputAsset } from "@/lib/vibodeAssetFinalization";
import { callCompositorVibodeCompose, type VibodeComposePlacement } from "@/lib/callCompositorVibodeCompose";
import { resolveRoomReadModelVersion } from "@/lib/vibodeRoomReadModelVersion";
import type { DetectedRoomObjectLabel } from "@/lib/vibodeRoomObjectLabels";
import {
  parsePlacementStorageRef,
  resolvePlacementDisplayImageUrl,
} from "@/lib/furniturePlacementImageUrl";
import {
  createVibodeGenerationRun,
  getVibodeRoomById,
  updateVibodeRoomAsset,
} from "@/lib/vibodePersistence";
import { stampVibodeVersionKindMetadata } from "@/lib/vibode/version-kind";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const VIBODE_ENABLE_SCENE_REBUILD =
  (process.env.VIBODE_ENABLE_SCENE_REBUILD ?? "false").trim().toLowerCase() === "true";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";
const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();
const SCENE_REBUILD_COMPOSE_TIMEOUT_MS = 120_000;
const PLACEMENT_IMAGE_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_PREVIEW_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 8)
);

type AnySupabaseClient = SupabaseClient;

type SceneRebuildRequest = {
  roomId?: unknown;
  versionId?: unknown;
  modelVersion?: unknown;
  aspectRatio?: unknown;
  activate?: unknown;
  triggerMode?: unknown;
  placementIntent?: unknown;
  modelDecidedFurnitureCandidates?: unknown;
};

type StageRoomRequest = {
  imageBase64: string;
  styleId?: string | null;
  enhancePhoto?: boolean;
  modelVersion?: string | null;
  aspectRatio?: "auto" | "4:3" | "3:2" | "16:9" | "1:1";
  isContinuation?: boolean;
  prompt?: string;
  instruction?: string;
  referenceImageUrls?: string[];
  referenceImageBase64s?: string[];
  referenceImages?: Array<{
    imageBase64: string;
    mimeType?: string;
    sourceUrl?: string;
  }>;
};

type SceneRebuildReferenceImageResult = {
  imageUrl: string;
  usedPlacementCount: number;
};

type SceneRebuildTriggerMode = "manual_test" | "model_decided_auto_place";

type PlacementIntent = "user_directed" | "model_decided";

type ModelDecidedFurnitureCandidate = {
  furnitureId: string | null;
  skuId: string | null;
  label: string | null;
  sourceImageUrl: string | null;
  sourceImagePath: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  placementSource: "clipboard" | "product_url" | "swap" | "my_furniture";
};

type RoomObjectWithGeometry = DetectedRoomObjectLabel & {
  centerX?: number;
  centerY?: number;
};

type InferenceMatcherDiagnostics = {
  submitted_candidate_count: number;
  detected_object_count: number;
  assigned_inferred_marker_count: number;
  category_matched_assignment_count: number;
  uncategorized_fallback_assignment_count: number;
  skipped_no_category_count: number;
  skipped_no_match_count: number;
  skipped_duplicate_count: number;
  skipped_invalid_geometry_count: number;
  skipped_low_confidence_count: number;
  candidate_categories: string[];
  detected_categories: string[];
  skipped_no_category_candidates: Array<{
    label: string | null;
    sku_id: string | null;
    normalized_text: string;
    reason: string;
  }>;
};

type RequestedVersionAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
};

type PlacementSnapshotRow = {
  id: string;
  user_id: string;
  room_id: string;
  version_id: string | null;
  furniture_id: string | null;
  source_image_url: string;
  x: number;
  y: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

class SceneRebuildError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUrlForDuplicateKey(url: string | null | undefined): string | null {
  const raw = safeStr(url);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw.split(/[?#]/, 1)[0]?.trim() || null;
  }
}

function getPlacementDuplicateKey(args: {
  sourceImagePath?: string | null;
  sourceImageUrl?: string | null;
}): string | null {
  const storageRef = parsePlacementStorageRef(args.sourceImagePath, args.sourceImageUrl);
  if (storageRef) {
    return `path:${storageRef.bucket}/${storageRef.path}`;
  }
  const normalizedUrl = normalizeUrlForDuplicateKey(args.sourceImageUrl);
  if (!normalizedUrl) return null;
  return `url:${normalizedUrl}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { name?: unknown; message?: unknown };
  if (candidate.name === "AbortError") return true;
  if (typeof candidate.message !== "string") return false;
  return candidate.message.toLowerCase().includes("abort");
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseAspectRatio(value: unknown): StageRoomRequest["aspectRatio"] {
  const raw = safeStr(value)?.toLowerCase().replace("x", ":");
  if (!raw) return "auto";
  if (raw === "auto" || raw === "4:3" || raw === "3:2" || raw === "16:9" || raw === "1:1") return raw;
  return "auto";
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function parseTriggerMode(value: unknown): SceneRebuildTriggerMode {
  if (typeof value === "undefined" || value === null) {
    return "manual_test";
  }
  const mode = safeStr(value);
  if (!mode) {
    throw new SceneRebuildError("Invalid triggerMode: expected 'manual_test'.", 400, {
      allowedTriggerModes: ["manual_test", "model_decided_auto_place"],
    });
  }
  if (mode !== "manual_test" && mode !== "model_decided_auto_place") {
    throw new SceneRebuildError(`Unsupported triggerMode: '${mode}'.`, 400, {
      allowedTriggerModes: ["manual_test", "model_decided_auto_place"],
    });
  }
  return mode;
}

function parsePlacementIntent(value: unknown): PlacementIntent {
  if (value === "model_decided") return "model_decided";
  return "user_directed";
}

function parseModelDecidedCandidate(value: unknown): ModelDecidedFurnitureCandidate | null {
  if (!isRecord(value)) return null;
  const placementSourceRaw = safeStr(value.placementSource);
  const placementSource =
    placementSourceRaw === "clipboard" ||
    placementSourceRaw === "product_url" ||
    placementSourceRaw === "swap" ||
    placementSourceRaw === "my_furniture"
      ? placementSourceRaw
      : null;
  const sourceImageUrl = safeStr(value.sourceImageUrl);
  const sourceImagePath = safeStr(value.sourceImagePath);
  if (!placementSource || (!sourceImageUrl && !sourceImagePath)) return null;
  return {
    furnitureId: safeStr(value.furnitureId),
    skuId: safeStr(value.skuId),
    label: safeStr(value.label),
    sourceImageUrl,
    sourceImagePath,
    thumbnailUrl: safeStr(value.thumbnailUrl),
    thumbnailPath: safeStr(value.thumbnailPath),
    placementSource,
  };
}

async function resolveModelDecidedCandidateImageUrls(args: {
  candidates: ModelDecidedFurnitureCandidate[];
  signingSupabase: AnySupabaseClient;
}): Promise<ModelDecidedFurnitureCandidate[]> {
  return Promise.all(
    args.candidates.map(async (candidate) => {
      const [sourceImageUrl, thumbnailUrl] = await Promise.all([
        resolvePlacementDisplayImageUrl({
          supabase: args.signingSupabase,
          storagePath: candidate.sourceImagePath,
          candidateUrl: candidate.sourceImageUrl,
          expiresInSeconds: PLACEMENT_IMAGE_SIGNED_URL_EXPIRES_IN_SEC,
        }),
        resolvePlacementDisplayImageUrl({
          supabase: args.signingSupabase,
          storagePath: candidate.thumbnailPath,
          candidateUrl: candidate.thumbnailUrl,
          expiresInSeconds: PLACEMENT_IMAGE_SIGNED_URL_EXPIRES_IN_SEC,
        }),
      ]);
      return {
        ...candidate,
        sourceImageUrl,
        thumbnailUrl,
      };
    })
  );
}

function parseModelDecidedFurnitureCandidates(value: unknown): ModelDecidedFurnitureCandidate[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, ModelDecidedFurnitureCandidate>();
  for (const raw of value) {
    const parsed = parseModelDecidedCandidate(raw);
    if (!parsed) continue;
    const key = [
      parsed.furnitureId ?? "",
      parsed.skuId ?? "",
      parsed.sourceImageUrl ?? "",
      parsed.label ?? "",
    ].join("::");
    if (deduped.has(key)) continue;
    deduped.set(key, parsed);
  }
  return [...deduped.values()];
}

function isLikelyExpiringSignedUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/storage/v1/object/sign/")) return true;
    if (parsed.searchParams.has("token")) return true;
    if (parsed.searchParams.has("X-Amz-Signature")) return true;
    if (parsed.searchParams.has("X-Amz-Credential")) return true;
    return false;
  } catch {
    return false;
  }
}

function getDurableImageUrl(args: { candidateUrl?: string | null; storageBucket?: string | null }) {
  const url = safeStr(args.candidateUrl);
  if (!url) return null;
  const bucket = safeStr(args.storageBucket);
  const isPrivateBucket =
    bucket === "vibode-generations" || bucket === VIBODE_STAGED_BUCKET || bucket === "vibode-base-images";
  if (isPrivateBucket && isLikelyExpiringSignedUrl(url)) return null;
  return url;
}

type SceneRebuildActivationResult =
  | { success: true }
  | {
      success: false;
      step: "deactivate_previous" | "activate_output" | "update_room";
      message: string;
    };

async function activateRebuildOutputVersion(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  outputVersionId: string;
  outputImageUrl: string | null;
  outputStorageBucket: string | null;
}): Promise<SceneRebuildActivationResult> {
  const nowIso = new Date().toISOString();
  const durableCoverImageUrl = getDurableImageUrl({
    candidateUrl: args.outputImageUrl,
    storageBucket: args.outputStorageBucket,
  });

  const { error: deactivateErr } = await args.supabase
    .from("vibode_room_assets")
    .update({ is_active: false })
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .eq("is_active", true)
    .neq("id", args.outputVersionId);
  if (deactivateErr) {
    return {
      success: false,
      step: "deactivate_previous",
      message: deactivateErr.message,
    };
  }

  const { error: activateErr } = await args.supabase
    .from("vibode_room_assets")
    .update({ is_active: true })
    .eq("id", args.outputVersionId)
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId);
  if (activateErr) {
    return {
      success: false,
      step: "activate_output",
      message: activateErr.message,
    };
  }

  const roomUpdatePayload: { active_asset_id: string; sort_key: string; cover_image_url?: string } = {
    active_asset_id: args.outputVersionId,
    sort_key: nowIso,
  };
  if (durableCoverImageUrl) {
    roomUpdatePayload.cover_image_url = durableCoverImageUrl;
  }

  const { error: roomUpdateErr } = await args.supabase
    .from("vibode_rooms")
    .update(roomUpdatePayload)
    .eq("id", args.roomId)
    .eq("user_id", args.userId);
  if (roomUpdateErr) {
    return {
      success: false,
      step: "update_room",
      message: roomUpdateErr.message,
    };
  }

  return { success: true };
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function fetchImageAsBase64(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new SceneRebuildError("Failed to fetch base image for rebuild generation.", 502, {
      upstreamStatus: res.status,
    });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

async function fetchImageAsBytes(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new SceneRebuildError("Failed to fetch image for scene rebuild reference composition.", 502, {
      upstreamStatus: res.status,
      sourceUrl: url,
    });
  }
  return Buffer.from(await res.arrayBuffer());
}

async function buildSceneRebuildReferenceImage(args: {
  baseImageUrl: string;
  payload: SceneRebuildPayload;
  modelVersion: string;
  aspectRatio: StageRoomRequest["aspectRatio"];
  signal?: AbortSignal;
}): Promise<SceneRebuildReferenceImageResult> {
  if (!process.env.ROOMPRINTZ_COMPOSITOR_URL) {
    throw new SceneRebuildError(
      "Scene rebuild reference composition is unavailable (missing ROOMPRINTZ_COMPOSITOR_URL).",
      500
    );
  }

  const visiblePlacements = args.payload.placements.filter((placement) => placement.isVisible);
  if (visiblePlacements.length === 0) {
    throw new SceneRebuildError(
      "Scene rebuild reference composition requires at least one visible placement.",
      400
    );
  }

  const roomImageBytes = await fetchImageAsBytes(args.baseImageUrl, args.signal);
  const sharp = await import("sharp");
  const metadata = await sharp.default(roomImageBytes).metadata();
  const width = finiteNumber(metadata.width) && metadata.width > 0 ? metadata.width : null;
  const height = finiteNumber(metadata.height) && metadata.height > 0 ? metadata.height : null;
  if (!width || !height) {
    throw new SceneRebuildError(
      "Failed to determine base image dimensions for scene rebuild reference composition.",
      422
    );
  }

  const minDimension = Math.min(width, height);
  const baseRadius = Math.max(20, Math.round(minDimension * 0.06));
  const maxPlacements = 24;
  const composePlacements: VibodeComposePlacement[] = [];

  for (const placement of visiblePlacements) {
    if (composePlacements.length >= maxPlacements) break;
    const sourceUrl = placement.sourceImageUrl?.trim() || placement.thumbnailUrl?.trim() || "";
    if (!sourceUrl) continue;

    try {
      const skuImageBytes = await fetchImageAsBytes(sourceUrl, args.signal);
      const normalizedScale = finiteNumber(placement.scale) && placement.scale > 0 ? placement.scale : 1;
      const radiusScaled = Math.round(baseRadius * Math.max(0.4, Math.min(2.2, normalizedScale)));
      composePlacements.push({
        nodeId: placement.id,
        skuId: placement.furnitureId,
        skuImageBytes,
        cxPx: Math.round(clampUnit(placement.x) * width),
        cyPx: Math.round(clampUnit(placement.y) * height),
        rPx: Math.max(16, Math.min(Math.floor(minDimension / 3), radiusScaled)),
        zIndex: composePlacements.length,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      console.warn("[vibode/scene-rebuild] placement reference image skipped", {
        placementId: placement.id,
        sourceUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (composePlacements.length === 0) {
    throw new SceneRebuildError(
      "Scene rebuild reference composition failed: no placement images could be composed.",
      422
    );
  }

  const composeResult = await callCompositorVibodeCompose({
    roomImageBytes,
    placements: composePlacements,
    enhancePhoto: true,
    modelVersion: args.modelVersion,
    aspectRatio: args.aspectRatio,
    signal: args.signal,
  });

  const imageUrl = safeStr(composeResult.imageUrl);
  if (!imageUrl) {
    throw new SceneRebuildError(
      "Scene rebuild reference composition failed: compositor did not return an image URL.",
      502
    );
  }
  return { imageUrl, usedPlacementCount: composePlacements.length };
}

async function fetchRequestedVersionAsset(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  versionId: string;
}): Promise<RequestedVersionAssetRow | null> {
  const { data, error } = await args.supabase
    .from("vibode_room_assets")
    .select("id,room_id,user_id")
    .eq("id", args.versionId)
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) {
    throw new SceneRebuildError("Failed to validate requested version for scene rebuild.", 500, {
      supabaseError: error.message,
    });
  }
  return (data as RequestedVersionAssetRow | null) ?? null;
}

function toPlacementDedupeCoord(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "NaN";
}

function buildPlacementSnapshotDedupeKey(
  row: Pick<PlacementSnapshotRow, "furniture_id" | "source_image_url" | "x" | "y">
): string {
  return [
    row.furniture_id ?? "",
    row.source_image_url.trim(),
    toPlacementDedupeCoord(row.x),
    toPlacementDedupeCoord(row.y),
  ].join("::");
}

async function inheritPlacementSnapshotForRebuildOutput(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  sourceVersionId: string;
  outputVersionId: string;
}): Promise<{ copiedCount: number; skippedCount: number; sourceCount: number }> {
  if (args.sourceVersionId === args.outputVersionId) {
    return { copiedCount: 0, skippedCount: 0, sourceCount: 0 };
  }

  const { data: sourceRows, error: sourceError } = await args.supabase
    .from("room_furniture_placements")
    .select("*")
    .eq("user_id", args.userId)
    .eq("room_id", args.roomId)
    .eq("version_id", args.sourceVersionId)
    .order("created_at", { ascending: true });

  if (sourceError) {
    throw new SceneRebuildError("Failed to load source placement snapshot for rebuild output.", 500, {
      supabaseError: sourceError.message,
      sourceVersionId: args.sourceVersionId,
      outputVersionId: args.outputVersionId,
    });
  }

  const typedSourceRows = (sourceRows ?? []) as PlacementSnapshotRow[];
  if (typedSourceRows.length === 0) {
    console.info("[vibode/scene-rebuild] placement snapshot inherited", {
      sourceVersionId: args.sourceVersionId,
      outputVersionId: args.outputVersionId,
      copiedCount: 0,
      skippedCount: 0,
      sourceCount: 0,
    });
    return { copiedCount: 0, skippedCount: 0, sourceCount: 0 };
  }

  const { data: targetRows, error: targetError } = await args.supabase
    .from("room_furniture_placements")
    .select("furniture_id, source_image_url, x, y")
    .eq("user_id", args.userId)
    .eq("room_id", args.roomId)
    .eq("version_id", args.outputVersionId);

  if (targetError) {
    throw new SceneRebuildError("Failed to load output placement snapshot for rebuild output.", 500, {
      supabaseError: targetError.message,
      sourceVersionId: args.sourceVersionId,
      outputVersionId: args.outputVersionId,
    });
  }

  const existingKeys = new Set(
    ((targetRows ?? []) as Pick<PlacementSnapshotRow, "furniture_id" | "source_image_url" | "x" | "y">[]).map(
      (row) => buildPlacementSnapshotDedupeKey(row)
    )
  );

  const rowsToInsert: Record<string, unknown>[] = [];
  for (const row of typedSourceRows) {
    const dedupeKey = buildPlacementSnapshotDedupeKey(row);
    if (existingKeys.has(dedupeKey)) continue;
    existingKeys.add(dedupeKey);

    const { id, created_at, updated_at, ...copyable } = row;
    void id;
    void created_at;
    void updated_at;
    rowsToInsert.push({
      ...copyable,
      user_id: args.userId,
      room_id: args.roomId,
      version_id: args.outputVersionId,
    });
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await args.supabase.from("room_furniture_placements").insert(rowsToInsert);
    if (insertError) {
      throw new SceneRebuildError("Failed to persist placement snapshot for rebuild output.", 500, {
        supabaseError: insertError.message,
        sourceVersionId: args.sourceVersionId,
        outputVersionId: args.outputVersionId,
        attemptedInsertCount: rowsToInsert.length,
      });
    }
  }

  const copiedCount = rowsToInsert.length;
  const sourceCount = typedSourceRows.length;
  const skippedCount = sourceCount - copiedCount;
  console.info("[vibode/scene-rebuild] placement snapshot inherited", {
    sourceVersionId: args.sourceVersionId,
    outputVersionId: args.outputVersionId,
    copiedCount,
    skippedCount,
    sourceCount,
  });

  return { copiedCount, skippedCount, sourceCount };
}

function normalizeCandidateCategoryText(parts: Array<string | null | undefined>): string {
  const joined = parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" ");
  if (!joined) return "";
  return joined
    .toLowerCase()
    .replace(/['’`"]/g, " ")
    .replace(/[_/\\|+.,:;()[\]{}!?-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function expandCategoryTokens(text: string): string {
  if (!text) return "";
  const tokens = text.split(" ").filter(Boolean);
  const expandedTokens = new Set<string>(tokens);
  for (const token of tokens) {
    expandedTokens.add(singularizeToken(token));
  }
  return [...expandedTokens].join(" ");
}

function hasCategoryTerm(text: string, term: string): boolean {
  const normalizedTerm = term.trim().toLowerCase().replace(/\s+/g, "\\s+");
  if (!normalizedTerm) return false;
  const pattern = new RegExp(`\\b${normalizedTerm}\\b`);
  return pattern.test(text);
}

function hasAnyCategoryTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => hasCategoryTerm(text, term));
}

function inferCandidateCategory(candidate: ModelDecidedFurnitureCandidate): {
  category: string | null;
  normalizedText: string;
  reason: string;
} {
  const normalizedText = normalizeCandidateCategoryText([candidate.label, candidate.skuId]);
  if (!normalizedText) {
    return { category: null, normalizedText, reason: "empty_label_and_sku" };
  }

  const expandedText = expandCategoryTokens(normalizedText);

  const chairTerms = [
    "chair",
    "dining chair",
    "accent chair",
    "lounge chair",
    "armchair",
    "office chair",
    "desk chair",
    "side chair",
    "recliner",
  ];
  if (hasAnyCategoryTerm(expandedText, chairTerms)) {
    return { category: "chair", normalizedText, reason: "matched_chair_terms" };
  }

  const sofaTerms = ["sofa", "couch", "sectional", "loveseat", "chaise", "sleeper sofa"];
  if (hasAnyCategoryTerm(expandedText, sofaTerms)) {
    return { category: "sofa", normalizedText, reason: "matched_sofa_terms" };
  }

  const tableTerms = [
    "table",
    "coffee table",
    "dining table",
    "side table",
    "end table",
    "console table",
    "desk",
    "nightstand",
    "bedside table",
  ];
  if (hasAnyCategoryTerm(expandedText, tableTerms)) {
    return { category: "table", normalizedText, reason: "matched_table_terms" };
  }

  const storageTerms = [
    "dresser",
    "cabinet",
    "credenza",
    "sideboard",
    "media console",
    "bookshelf",
    "shelving",
    "storage",
  ];
  if (hasAnyCategoryTerm(expandedText, storageTerms)) {
    return { category: "storage", normalizedText, reason: "matched_storage_terms" };
  }

  const bedTerms = ["bed", "headboard"];
  if (hasAnyCategoryTerm(expandedText, bedTerms)) {
    return { category: "bed", normalizedText, reason: "matched_bed_terms" };
  }

  const lightingTerms = ["lamp", "floor lamp", "table lamp", "pendant light", "lighting"];
  if (hasAnyCategoryTerm(expandedText, lightingTerms)) {
    return { category: "lamp", normalizedText, reason: "matched_lighting_terms" };
  }

  const rugTerms = ["rug", "carpet", "runner"];
  if (hasAnyCategoryTerm(expandedText, rugTerms)) {
    return { category: "rug", normalizedText, reason: "matched_rug_terms" };
  }

  return { category: null, normalizedText, reason: "no_supported_category_match" };
}

function inferDetectedCategory(label: string): string | null {
  const normalized = label.toLowerCase();
  if (normalized === "chair") return "chair";
  if (normalized === "sofa") return "sofa";
  if (normalized.includes("table")) return "table";
  if (normalized === "lamp") return "lamp";
  if (normalized === "rug") return "rug";
  if (normalized === "bed") return "bed";
  if (
    normalized === "dresser" ||
    normalized === "cabinet" ||
    normalized === "bookshelf" ||
    normalized === "tv stand"
  ) {
    return "storage";
  }
  return null;
}

function hasGeometry(objectLabel: RoomObjectWithGeometry): objectLabel is RoomObjectWithGeometry & {
  centerX: number;
  centerY: number;
} {
  return (
    typeof objectLabel.centerX === "number" &&
    Number.isFinite(objectLabel.centerX) &&
    objectLabel.centerX >= 0 &&
    objectLabel.centerX <= 1 &&
    typeof objectLabel.centerY === "number" &&
    Number.isFinite(objectLabel.centerY) &&
    objectLabel.centerY >= 0 &&
    objectLabel.centerY <= 1
  );
}

async function fetchRoomObjectsForInference(args: {
  req: NextRequest;
  token: string;
  roomId: string;
  assetId: string;
  imageUrl: string;
  modelVersion: string;
}): Promise<RoomObjectWithGeometry[]> {
  const roomReadModelVersion = resolveRoomReadModelVersion(args.modelVersion);
  const endpoint = new URL("/api/vibode/room-image-objects", args.req.nextUrl.origin).toString();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      imageUrl: args.imageUrl,
      roomId: args.roomId,
      assetId: args.assetId,
      versionId: args.assetId,
      allowRoomReadOnMiss: true,
      modelVersion: roomReadModelVersion,
      mode: "geometry",
    }),
    signal: args.req.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SceneRebuildError("Failed to fetch room object geometry for inferred markers.", 502, {
      upstreamStatus: res.status,
      upstreamBody: text || null,
    });
  }
  const payload = (await res.json().catch(() => ({}))) as { objects?: unknown };
  const objects = Array.isArray(payload.objects) ? payload.objects : [];
  return objects.filter(isRecord) as RoomObjectWithGeometry[];
}

async function createModelVisionInferredPlacements(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  outputVersionId: string;
  candidates: ModelDecidedFurnitureCandidate[];
  detectedObjects: RoomObjectWithGeometry[];
}): Promise<{ inferredPlacementCount: number; diagnostics: InferenceMatcherDiagnostics }> {
  const MIN_CONFIDENCE = 0.65;
  const diagnostics: InferenceMatcherDiagnostics = {
    submitted_candidate_count: args.candidates.length,
    detected_object_count: args.detectedObjects.length,
    assigned_inferred_marker_count: 0,
    category_matched_assignment_count: 0,
    uncategorized_fallback_assignment_count: 0,
    skipped_no_category_count: 0,
    skipped_no_match_count: 0,
    skipped_duplicate_count: 0,
    skipped_invalid_geometry_count: 0,
    skipped_low_confidence_count: 0,
    candidate_categories: [],
    detected_categories: [],
    skipped_no_category_candidates: [],
  };
  if (args.candidates.length === 0 || args.detectedObjects.length === 0) {
    return { inferredPlacementCount: 0, diagnostics };
  }
  const { data: existingRows, error: existingRowsErr } = await args.supabase
    .from("room_furniture_placements")
    .select("furniture_id, source_image_url, source_image_path, x, y")
    .eq("user_id", args.userId)
    .eq("room_id", args.roomId)
    .eq("version_id", args.outputVersionId);
  if (existingRowsErr) {
    throw new SceneRebuildError("Failed to load existing placements for inferred-marker dedupe.", 500, {
      supabaseError: existingRowsErr.message,
      outputVersionId: args.outputVersionId,
    });
  }
  const existingFurnitureIds = new Set<string>();
  const existingSourceDuplicateKeys = new Set<string>();
  const existingPlacementPositions: Array<{ x: number; y: number }> = [];
  for (const row of (existingRows ?? []) as Array<{
    furniture_id?: unknown;
    source_image_url?: unknown;
    source_image_path?: unknown;
    x?: unknown;
    y?: unknown;
  }>) {
    const furnitureId = safeStr(row.furniture_id);
    const sourceImageUrl = safeStr(row.source_image_url);
    const sourceImagePath = safeStr(row.source_image_path);
    const x = finiteNumber(row.x) ? row.x : null;
    const y = finiteNumber(row.y) ? row.y : null;
    if (furnitureId) existingFurnitureIds.add(furnitureId);
    const duplicateKey = getPlacementDuplicateKey({
      sourceImagePath,
      sourceImageUrl,
    });
    if (duplicateKey) existingSourceDuplicateKeys.add(duplicateKey);
    if (x !== null && y !== null) existingPlacementPositions.push({ x, y });
  }
  const insertRows: Record<string, unknown>[] = [];
  const candidateCategorySet = new Set<string>();
  const detectedCategorySet = new Set<string>();
  const consumedDetectedIndexes = new Set<number>();
  const detectedByCategory = new Map<
    string,
    Array<{ index: number; object: RoomObjectWithGeometry & { centerX: number; centerY: number } }>
  >();
  const allDetectedWithGeometry: Array<{
    index: number;
    object: RoomObjectWithGeometry & { centerX: number; centerY: number };
    category: string | null;
  }> = [];

  for (const [index, detected] of args.detectedObjects.entries()) {
    if (!hasGeometry(detected)) {
      diagnostics.skipped_invalid_geometry_count += 1;
      continue;
    }
    if (!(typeof detected.confidence === "number" && detected.confidence >= MIN_CONFIDENCE)) {
      diagnostics.skipped_low_confidence_count += 1;
    }
    const detectedCategory = inferDetectedCategory(detected.label);
    if (detectedCategory) {
      detectedCategorySet.add(detectedCategory);
      if (typeof detected.confidence === "number" && detected.confidence >= MIN_CONFIDENCE) {
        const bucket = detectedByCategory.get(detectedCategory) ?? [];
        bucket.push({ index, object: detected });
        detectedByCategory.set(detectedCategory, bucket);
      }
    }
    allDetectedWithGeometry.push({ index, object: detected, category: detectedCategory });
  }
  for (const bucket of detectedByCategory.values()) {
    bucket.sort((left, right) => (right.object.confidence ?? 0) - (left.object.confidence ?? 0));
  }
  allDetectedWithGeometry.sort((left, right) => (right.object.confidence ?? 0) - (left.object.confidence ?? 0));

  const uncategorizedCandidates: Array<{
    candidate: ModelDecidedFurnitureCandidate;
    normalizedText: string;
    reason: string;
  }> = [];

  function isNearExistingPlacement(x: number, y: number): boolean {
    const MAX_DISTANCE = 0.08;
    return existingPlacementPositions.some((position) => {
      const dx = position.x - x;
      const dy = position.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= MAX_DISTANCE;
    });
  }

  for (const candidate of args.candidates) {
    const sourceImageUrl = safeStr(candidate.sourceImageUrl);
    if (!sourceImageUrl) {
      diagnostics.skipped_no_match_count += 1;
      continue;
    }
    const candidateDuplicateKey = getPlacementDuplicateKey({
      sourceImagePath: candidate.sourceImagePath,
      sourceImageUrl,
    });
    const isDuplicateSourceImage =
      candidateDuplicateKey !== null && existingSourceDuplicateKeys.has(candidateDuplicateKey);
    if (
      (candidate.furnitureId && existingFurnitureIds.has(candidate.furnitureId)) ||
      isDuplicateSourceImage
    ) {
      diagnostics.skipped_duplicate_count += 1;
      continue;
    }
    const candidateCategoryResult = inferCandidateCategory(candidate);
    const candidateCategory = candidateCategoryResult.category;
    if (!candidateCategory) {
      uncategorizedCandidates.push({
        candidate,
        normalizedText: candidateCategoryResult.normalizedText,
        reason: candidateCategoryResult.reason,
      });
      continue;
    }
    candidateCategorySet.add(candidateCategory);
    const categoryDetections = detectedByCategory.get(candidateCategory) ?? [];
    const assignment = categoryDetections.find((entry) => !consumedDetectedIndexes.has(entry.index));
    if (!assignment) {
      diagnostics.skipped_no_match_count += 1;
      continue;
    }
    consumedDetectedIndexes.add(assignment.index);
    const match = assignment.object;
    diagnostics.category_matched_assignment_count += 1;

    insertRows.push({
      user_id: args.userId,
      room_id: args.roomId,
      version_id: args.outputVersionId,
      furniture_id: candidate.furnitureId,
      thumbnail_url: candidate.thumbnailUrl ?? candidate.sourceImageUrl,
      thumbnail_path: candidate.thumbnailPath,
      source_image_url: candidate.sourceImageUrl,
      source_image_path: candidate.sourceImagePath,
      x: clampUnit(match.centerX),
      y: clampUnit(match.centerY),
      scale: 1,
      rotation: 0,
      is_visible: true,
      metadata: {
        placementIntent: "model_decided",
        placementSource: "model_vision_inferred",
        ownership: "vibode",
        confidence: typeof match.confidence === "number" ? match.confidence : null,
      },
    });
  }

  for (const uncategorized of uncategorizedCandidates) {
    const fallbackDetection = allDetectedWithGeometry.find((entry) => {
      if (consumedDetectedIndexes.has(entry.index)) return false;
      if (isNearExistingPlacement(entry.object.centerX, entry.object.centerY)) return false;
      return true;
    });
    if (!fallbackDetection) {
      diagnostics.skipped_no_category_count += 1;
      diagnostics.skipped_no_category_candidates.push({
        label: uncategorized.candidate.label,
        sku_id: uncategorized.candidate.skuId,
        normalized_text: uncategorized.normalizedText,
        reason: `${uncategorized.reason}:no_fallback_detection_available`,
      });
      continue;
    }
    consumedDetectedIndexes.add(fallbackDetection.index);
    diagnostics.uncategorized_fallback_assignment_count += 1;

    insertRows.push({
      user_id: args.userId,
      room_id: args.roomId,
      version_id: args.outputVersionId,
      furniture_id: uncategorized.candidate.furnitureId,
      thumbnail_url: uncategorized.candidate.thumbnailUrl ?? uncategorized.candidate.sourceImageUrl,
      thumbnail_path: uncategorized.candidate.thumbnailPath,
      source_image_url: uncategorized.candidate.sourceImageUrl,
      source_image_path: uncategorized.candidate.sourceImagePath,
      x: clampUnit(fallbackDetection.object.centerX),
      y: clampUnit(fallbackDetection.object.centerY),
      scale: 1,
      rotation: 0,
      is_visible: true,
      metadata: {
        placementIntent: "model_decided",
        placementSource: "model_vision_inferred",
        ownership: "vibode",
        confidence:
          typeof fallbackDetection.object.confidence === "number"
            ? fallbackDetection.object.confidence
            : 0.5,
        debug: {
          inferenceMode: "uncategorized_best_effort",
        },
      },
    });
  }

  diagnostics.assigned_inferred_marker_count = insertRows.length;
  diagnostics.candidate_categories = [...candidateCategorySet].sort();
  diagnostics.detected_categories = [...detectedCategorySet].sort();

  console.info("[vibode/scene-rebuild] inferred marker matcher stats", {
    candidateCount: diagnostics.submitted_candidate_count,
    detectedObjectCount: diagnostics.detected_object_count,
    assignedInferredMarkerCount: diagnostics.assigned_inferred_marker_count,
    skippedNoCategoryCount: diagnostics.skipped_no_category_count,
    skippedNoMatchCount: diagnostics.skipped_no_match_count,
    skippedDuplicateCount: diagnostics.skipped_duplicate_count,
    skippedInvalidGeometryCount: diagnostics.skipped_invalid_geometry_count,
    skippedLowConfidenceCount: diagnostics.skipped_low_confidence_count,
    categoryMatchedAssignmentCount: diagnostics.category_matched_assignment_count,
    uncategorizedFallbackAssignmentCount: diagnostics.uncategorized_fallback_assignment_count,
  });

  if (insertRows.length === 0) return { inferredPlacementCount: 0, diagnostics };
  const { error } = await args.supabase.from("room_furniture_placements").insert(insertRows);
  if (error) {
    console.warn("[vibode/scene-rebuild] failed to persist inferred model-decided placement markers", {
      supabaseError: error.message,
      attemptedInsertCount: insertRows.length,
      outputVersionId: args.outputVersionId,
    });
    return { inferredPlacementCount: 0, diagnostics };
  }
  return { inferredPlacementCount: insertRows.length, diagnostics };
}

function buildSceneRebuildPrompt(args: {
  payload: SceneRebuildPayload;
  placementIntent: PlacementIntent;
  modelDecidedFurnitureCandidates: ModelDecidedFurnitureCandidate[];
  modelDecidedReferenceImageUrls: string[];
}): string {
  const payload = args.payload;
  const lines: string[] = [];
  lines.push("Rebuild this room image from the original base room photo.");
  lines.push(
    "Preserve room architecture, camera, lighting, colors, and background details as closely as possible."
  );
  if (args.placementIntent === "model_decided") {
    lines.push("Keep existing room contents stable unless required by listed candidate furniture.");
    lines.push("Choose realistic positions for candidate furniture using room context.");
    lines.push("You must place each listed candidate furniture item into the scene.");
    lines.push("Do not ignore candidate references.");
    lines.push("Candidate furniture to place (no fixed coordinates, use provided references):");
    for (const [index, candidate] of args.modelDecidedFurnitureCandidates.entries()) {
      const label = candidate.label ?? candidate.skuId ?? candidate.furnitureId ?? `candidate_${index + 1}`;
      lines.push(`- item=${label} referenceImageUrl=${safeStr(candidate.sourceImageUrl) ?? "none"}`);
      if (index >= 79) {
        lines.push(
          `- ... ${args.modelDecidedFurnitureCandidates.length - 80} more candidates omitted`
        );
        break;
      }
    }
    if (args.modelDecidedReferenceImageUrls.length > 0) {
      lines.push("Reference image URLs:");
      for (const [index, ref] of args.modelDecidedReferenceImageUrls.entries()) {
        lines.push(`- ref_${index + 1}=${ref}`);
      }
    }
    return lines.join("\n");
  }
  lines.push("Place only the listed furniture items using approximate normalized positions and size cues.");
  lines.push("Do not add extra furniture or decor that is not listed.");
  lines.push("Normalized placement intent (0-1 coordinates):");
  for (const [index, placement] of payload.placements.entries()) {
    const placementLabel = placement.furnitureId ?? placement.id;
    lines.push(
      `- item=${placementLabel} x=${placement.x.toFixed(4)} y=${placement.y.toFixed(4)} scale=${placement.scale.toFixed(4)} rotation=${placement.rotation.toFixed(2)} visible=${placement.isVisible ? "true" : "false"}`
    );
    if (index >= 79) {
      lines.push(`- ... ${payload.placements.length - 80} more placements omitted`);
      break;
    }
  }
  return lines.join("\n");
}

async function callSceneRebuildModel(args: {
  baseImageUrl: string;
  prompt: string;
  modelVersion: string;
  aspectRatio: StageRoomRequest["aspectRatio"];
  placementIntent: PlacementIntent;
  modelDecidedReferenceImageUrls?: string[];
  signal?: AbortSignal;
}): Promise<string> {
  const endpoint = process.env.NANOBANANA_PRO_URL;
  const apiKey = process.env.NANOBANANA_PRO_API_KEY;
  if (!endpoint || !apiKey) {
    throw new SceneRebuildError(
      "Scene rebuild model is not configured (missing NANOBANANA_PRO_URL or NANOBANANA_PRO_API_KEY).",
      500
    );
  }

  const imageBase64 = await fetchImageAsBase64(args.baseImageUrl, args.signal);
  const referenceImages: Array<{ imageBase64: string; mimeType?: string; sourceUrl?: string }> = [];
  for (const url of args.modelDecidedReferenceImageUrls ?? []) {
    if (referenceImages.length >= 8) break;
    try {
      const res = await fetch(url, { signal: args.signal });
      if (!res.ok) continue;
      const mimeType = safeStr(res.headers.get("content-type")) ?? "image/jpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      referenceImages.push({
        imageBase64: buf.toString("base64"),
        mimeType,
        sourceUrl: url,
      });
    } catch {
      // Best-effort only: missing candidate refs should not fail generation.
    }
  }
  const body: StageRoomRequest = {
    imageBase64,
    styleId: null,
    enhancePhoto: true,
    modelVersion: args.modelVersion,
    aspectRatio: args.aspectRatio,
    isContinuation: false,
    prompt: args.prompt,
    instruction: args.prompt,
    ...(Array.isArray(args.modelDecidedReferenceImageUrls) &&
    args.modelDecidedReferenceImageUrls.length > 0
      ? { referenceImageUrls: args.modelDecidedReferenceImageUrls }
      : {}),
    ...(referenceImages.length > 0
      ? {
          referenceImageBase64s: referenceImages.map((item) => item.imageBase64),
          referenceImages,
        }
      : {}),
  };

  console.info("[vibode/scene-rebuild] model payload prepared", {
    placementIntent: args.placementIntent,
    modelInputImageUrlPresent: safeStr(args.baseImageUrl) !== null,
    promptCandidateLineCount: (args.prompt.match(/referenceImageUrl=/g) ?? []).length,
    modelVersion: args.modelVersion,
    referenceImageUrlCount: args.modelDecidedReferenceImageUrls?.length ?? 0,
    embeddedReferenceImageCount: referenceImages.length,
  });
  console.info("[vibode/scene-rebuild] outbound payload debug", {
    placementIntent: args.placementIntent,
    modelInputImageUrlPresent: safeStr(args.baseImageUrl) !== null,
    promptIncludesCandidates: args.prompt.includes("Candidate furniture to place"),
    promptCandidateLineCount: (args.prompt.match(/referenceImageUrl=/g) ?? []).length,
    referenceImageUrlsCount: Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls.length : 0,
    referenceImageBase64sCount: Array.isArray(body.referenceImageBase64s)
      ? body.referenceImageBase64s.length
      : 0,
    referenceImagesCount: Array.isArray(body.referenceImages) ? body.referenceImages.length : 0,
    firstReferenceImage:
      Array.isArray(body.referenceImages) && body.referenceImages.length > 0
        ? {
            hasImageBase64:
              typeof body.referenceImages[0]?.imageBase64 === "string" &&
              body.referenceImages[0].imageBase64.length > 0,
            mimeType: body.referenceImages[0]?.mimeType ?? null,
            sourceUrlPresent:
              typeof body.referenceImages[0]?.sourceUrl === "string" &&
              body.referenceImages[0].sourceUrl.length > 0,
            imageBase64Length:
              typeof body.referenceImages[0]?.imageBase64 === "string"
                ? body.referenceImages[0].imageBase64.length
                : 0,
          }
        : null,
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SceneRebuildError("Scene rebuild generation failed.", 502, {
      upstreamStatus: res.status,
      upstreamBody: text || null,
    });
  }

  const result = (await res.json()) as { imageUrl?: unknown };
  const imageUrl = safeStr(result.imageUrl);
  if (!imageUrl) {
    throw new SceneRebuildError("Scene rebuild generation failed: missing output image URL.", 502);
  }

  return imageUrl;
}

async function runComposeStageWithTimeout<T>(
  reqSignal: AbortSignal,
  runComposeStage: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const composeController = new AbortController();
  let composeTimedOut = false;
  const onRequestAbort = () => composeController.abort();
  reqSignal.addEventListener("abort", onRequestAbort, { once: true });
  const timeoutHandle = setTimeout(() => {
    composeTimedOut = true;
    composeController.abort();
  }, SCENE_REBUILD_COMPOSE_TIMEOUT_MS);
  try {
    return await runComposeStage(composeController.signal);
  } catch (err) {
    if (composeTimedOut) {
      throw new SceneRebuildError("Room preparation took too long", 504, {
        code: "compose_timeout",
        stage: "compose",
        timeoutMs: SCENE_REBUILD_COMPOSE_TIMEOUT_MS,
        helper: "Vibode couldn't finish preparing your room layout. Please try again.",
      });
    }
    if (reqSignal.aborted || isAbortError(err)) {
      throw new SceneRebuildError("Room preparation cancelled.", 499, {
        code: "compose_cancelled",
        stage: "compose",
      });
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    reqSignal.removeEventListener("abort", onRequestAbort);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!VIBODE_ENABLE_SCENE_REBUILD) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "Server misconfigured: missing Supabase env." }, { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized: missing Authorization Bearer token." },
        { status: 401 }
      );
    }

    const supabase = getUserSupabaseClient(token);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const userId = userData.user.id;

    const bodyRaw = (await req.json().catch(() => ({}))) as SceneRebuildRequest;
    const body = isRecord(bodyRaw) ? bodyRaw : {};
    const adminSupabase = getAdminSupabaseClient();
    const roomId = safeStr(body.roomId);
    const versionId = safeStr(body.versionId);
    const modelVersion = safeStr(body.modelVersion) ?? VIBODE_DEFAULT_MODEL_VERSION;
    const aspectRatio = parseAspectRatio(body.aspectRatio);
    const activate = parseOptionalBoolean(body.activate) ?? false;
    const triggerMode = parseTriggerMode(body.triggerMode);
    const placementIntent = parsePlacementIntent(body.placementIntent);
    const modelDecidedFurnitureCandidatesRaw = parseModelDecidedFurnitureCandidates(
      body.modelDecidedFurnitureCandidates
    );
    const modelDecidedFurnitureCandidates = await resolveModelDecidedCandidateImageUrls({
      candidates: modelDecidedFurnitureCandidatesRaw,
      signingSupabase: adminSupabase ?? supabase,
    });
    const modelDecidedReferenceImageUrls =
      placementIntent === "model_decided"
        ? Array.from(
            new Set(
              modelDecidedFurnitureCandidates
                .map((candidate) => safeStr(candidate.sourceImageUrl))
                .filter((url): url is string => Boolean(url))
            )
          ).slice(0, 24)
        : [];

    if (!roomId) {
      return NextResponse.json({ error: "Missing required field: roomId." }, { status: 400 });
    }
    if (!versionId) {
      return NextResponse.json({ error: "Missing required field: versionId." }, { status: 400 });
    }
    const room = await getVibodeRoomById(supabase, roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (room.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const sourceVersionAsset = await fetchRequestedVersionAsset({
      supabase,
      roomId: room.id,
      userId,
      versionId,
    });
    if (!sourceVersionAsset) {
      return NextResponse.json(
        { error: "Requested versionId is invalid for this room." },
        { status: 404 }
      );
    }

    const payload = await buildSceneRebuildPayload({
      supabase,
      signingSupabase: adminSupabase,
      roomId,
      userId,
      versionId,
    });
    console.info("[vibode/scene-rebuild] effective base image resolved", {
      roomId: room.id,
      versionId,
      activeSetVersionId: payload.room.activeSetVersionId,
      activeSetAssetFound: payload.room.activeSetAssetFound,
      activeSetAssetImageUrlPresent: payload.room.activeSetAssetImageUrlPresent,
      effectiveBaseImageStrategy: payload.room.effectiveBaseImageStrategy,
      canonicalBaseVersionId: payload.room.baseVersionId,
      fallbackImageUrlUsed: payload.room.fallbackImageUrlUsed,
    });
    if (!payload.room.baseImageUrl) {
      return NextResponse.json({ error: "Missing base image for rebuild." }, { status: 400 });
    }
    if (payload.room.fallbackImageUrlUsed) {
      return NextResponse.json(
        {
          error:
            "Canonical scene rebuild requires a canonical base image URL; fallback cover image URL is not allowed for this trigger mode.",
        },
        { status: 409 }
      );
    }
    if (placementIntent !== "model_decided" && payload.placementCount === 0) {
      return NextResponse.json(
        { error: "No resolved placements found for requested version." },
        { status: 400 }
      );
    }
    if (placementIntent === "model_decided" && modelDecidedFurnitureCandidates.length === 0) {
      return NextResponse.json(
        { error: "Model-decided rebuild requires at least one furniture candidate." },
        { status: 400 }
      );
    }

    const prompt = buildSceneRebuildPrompt({
      payload,
      placementIntent,
      modelDecidedFurnitureCandidates,
      modelDecidedReferenceImageUrls,
    });
    let modelInputImageUrl = payload.room.baseImageUrl;
    let referencePlacementCountUsed = 0;
    if (payload.placementCount > 0) {
      try {
        const referenceImage = await runComposeStageWithTimeout(req.signal, (composeSignal) =>
          buildSceneRebuildReferenceImage({
            baseImageUrl: payload.room.baseImageUrl,
            payload,
            modelVersion,
            aspectRatio,
            signal: composeSignal,
          })
        );
        modelInputImageUrl = referenceImage.imageUrl;
        referencePlacementCountUsed = referenceImage.usedPlacementCount;
        if (placementIntent !== "model_decided" && referencePlacementCountUsed <= 0) {
          throw new SceneRebuildError(
            "Scene rebuild reference composition must include at least one placement.",
            422
          );
        }
      } catch (err) {
        if (placementIntent !== "model_decided") {
          throw err;
        }
        console.warn("[vibode/scene-rebuild] model_decided compose fallback to base image", {
          error: err instanceof Error ? err.message : String(err),
          roomId: room.id,
          versionId,
        });
      }
    }

    const generatedImageUrl = await callSceneRebuildModel({
      baseImageUrl: modelInputImageUrl,
      prompt,
      modelVersion,
      aspectRatio,
      placementIntent,
      modelDecidedReferenceImageUrls,
      signal: req.signal,
    });

    const outputFinalization = await finalizeVibodeOutputAsset({
      logPrefix: "[vibode/scene-rebuild]",
      adminSupabase,
      persistenceSupabase: supabase,
      roomId: room.id,
      userId,
      assetType: "stage_output",
      stageNumber: room.current_stage ?? 0,
      modelVersion,
      responseImageUrl: generatedImageUrl,
      responseStorageBucket: null,
      responseStoragePath: null,
      responseWidth: null,
      responseHeight: null,
      sourceImageUrlForThumbnail: generatedImageUrl,
      versionKind: "stage",
      markAssetActive: false,
      updateRoomCurrentStage: null,
      updateRoomSortKey: null,
    });

    if (outputFinalization.assetFinalizationError || !outputFinalization.outputAssetId) {
      throw new SceneRebuildError("Rebuild image generated but failed to persist room asset.", 500, {
        finalizationError:
          outputFinalization.assetFinalizationError instanceof Error
            ? outputFinalization.assetFinalizationError.message
            : outputFinalization.assetFinalizationError ?? null,
      });
    }

    await inheritPlacementSnapshotForRebuildOutput({
      supabase,
      roomId: room.id,
      userId,
      sourceVersionId: versionId,
      outputVersionId: outputFinalization.outputAssetId,
    });

    let inferredPlacementCount = 0;
    let inferenceMatcherDiagnostics: InferenceMatcherDiagnostics = {
      submitted_candidate_count: modelDecidedFurnitureCandidates.length,
      detected_object_count: 0,
      assigned_inferred_marker_count: 0,
      category_matched_assignment_count: 0,
      uncategorized_fallback_assignment_count: 0,
      skipped_no_category_count: 0,
      skipped_no_match_count: 0,
      skipped_duplicate_count: 0,
      skipped_invalid_geometry_count: 0,
      skipped_low_confidence_count: 0,
      candidate_categories: [],
      detected_categories: [],
      skipped_no_category_candidates: [],
    };
    if (placementIntent === "model_decided") {
      try {
        const roomObjects = await fetchRoomObjectsForInference({
          req,
          token,
          roomId: room.id,
          assetId: outputFinalization.outputAssetId,
          imageUrl: outputFinalization.imageUrl ?? generatedImageUrl,
          modelVersion,
        });
        const inferenceResult = await createModelVisionInferredPlacements({
          supabase,
          roomId: room.id,
          userId,
          outputVersionId: outputFinalization.outputAssetId,
          candidates: modelDecidedFurnitureCandidates,
          detectedObjects: roomObjects,
        });
        inferredPlacementCount = inferenceResult.inferredPlacementCount;
        inferenceMatcherDiagnostics = inferenceResult.diagnostics;
      } catch (err) {
        console.warn("[vibode/scene-rebuild] model-decided inferred marker creation skipped", {
          roomId: room.id,
          outputVersionId: outputFinalization.outputAssetId,
          error: err instanceof Error ? err.message : String(err),
        });
        inferredPlacementCount = 0;
      }
    }

    console.info("[vibode/scene-rebuild] activation requested", {
      sourceVersionId: versionId,
      outputVersionId: outputFinalization.outputAssetId,
      activateRequested: activate,
    });

    let activated = false;
    let activationError: { step: string; message: string } | null = null;
    if (activate) {
      const activationResult = await activateRebuildOutputVersion({
        supabase,
        roomId: room.id,
        userId,
        outputVersionId: outputFinalization.outputAssetId,
        outputImageUrl: outputFinalization.imageUrl ?? generatedImageUrl,
        outputStorageBucket: outputFinalization.storageBucket,
      });
      if (activationResult.success) {
        activated = true;
      } else {
        activationError = {
          step: activationResult.step,
          message: activationResult.message,
        };
      }
    }

    console.info("[vibode/scene-rebuild] activation result", {
      sourceVersionId: versionId,
      outputVersionId: outputFinalization.outputAssetId,
      activateRequested: activate,
      activated,
      activationError,
    });

    const rebuildMetadata = {
      generation_mode: "scene_rebuild",
      trigger_mode: triggerMode,
      placement_intent: placementIntent,
      source_version_id: versionId,
      base_version_id: payload.room.baseVersionId,
      placement_count: payload.placementCount,
      model_decided_candidate_count:
        placementIntent === "model_decided" ? modelDecidedFurnitureCandidates.length : 0,
      inferred_placement_count: inferredPlacementCount,
      inference_matcher_diagnostics:
        placementIntent === "model_decided" ? inferenceMatcherDiagnostics : undefined,
      reference_image_mode: referencePlacementCountUsed > 0 ? "composite" : "base_only",
      reference_placement_count: referencePlacementCountUsed,
      fallback_image_url_used: payload.room.fallbackImageUrlUsed,
    };

    const { data: outputAssetMetadataRow, error: outputAssetMetadataErr } = await supabase
      .from("vibode_room_assets")
      .select("metadata")
      .eq("id", outputFinalization.outputAssetId)
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (outputAssetMetadataErr) {
      throw new SceneRebuildError("Failed to load output asset metadata for scene rebuild.", 500, {
        supabaseError: outputAssetMetadataErr.message,
        outputVersionId: outputFinalization.outputAssetId,
      });
    }
    const existingOutputMetadata = isRecord(outputAssetMetadataRow?.metadata)
      ? outputAssetMetadataRow.metadata
      : {};
    const mergedRebuildMetadata = stampVibodeVersionKindMetadata(
      {
        ...existingOutputMetadata,
        ...rebuildMetadata,
      },
      "stage"
    );

    await updateVibodeRoomAsset(supabase, outputFinalization.outputAssetId, {
      metadata:
        mergedRebuildMetadata ??
        {
          ...existingOutputMetadata,
          ...rebuildMetadata,
        },
    });

    const generationRun = await createVibodeGenerationRun(supabase, {
      room_id: room.id,
      user_id: userId,
      run_type: "stage",
      stage_number: room.current_stage ?? 0,
      source_asset_id: versionId,
      output_asset_id: outputFinalization.outputAssetId,
      model_version: modelVersion,
      aspect_ratio: aspectRatio,
      status: "completed",
      request_payload: {
        room_id: room.id,
        source_version_id: versionId,
        generation_mode: "scene_rebuild",
        trigger_mode: triggerMode,
        placement_intent: placementIntent,
        base_image_url: payload.room.baseImageUrl,
        model_input_image_url: modelInputImageUrl,
        base_version_id: payload.room.baseVersionId,
        lineage_version_ids: payload.lineageVersionIds,
        placement_count: payload.placementCount,
        model_decided_candidate_count:
          placementIntent === "model_decided" ? modelDecidedFurnitureCandidates.length : 0,
        inferred_placement_count: inferredPlacementCount,
        inference_matcher_diagnostics:
          placementIntent === "model_decided" ? inferenceMatcherDiagnostics : undefined,
        reference_placement_count: referencePlacementCountUsed,
        fallback_image_url_used: payload.room.fallbackImageUrlUsed,
        prompt_preview: prompt.slice(0, 1000),
      },
      response_payload: {
        imageUrl: outputFinalization.imageUrl ?? generatedImageUrl,
        storageBucket: outputFinalization.storageBucket,
        storagePath: outputFinalization.storagePath,
        generation_mode: "scene_rebuild",
        inferred_placement_count: inferredPlacementCount,
        inference_matcher_diagnostics:
          placementIntent === "model_decided" ? inferenceMatcherDiagnostics : undefined,
      },
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      generationMode: "scene_rebuild",
      triggerMode,
      placementIntent,
      roomId: room.id,
      sourceVersionId: versionId,
      outputVersionId: outputFinalization.outputAssetId,
      generationRunId: generationRun.id,
      activated,
      ...(activationError ? { activationError } : {}),
      placementCount: payload.placementCount,
      modelDecidedCandidateCount:
        placementIntent === "model_decided" ? modelDecidedFurnitureCandidates.length : 0,
      inferredPlacementCount,
      referencePlacementCount: referencePlacementCountUsed,
      fallbackImageUrlUsed: payload.room.fallbackImageUrlUsed,
      output: {
        assetId: outputFinalization.outputAssetId,
        imageUrl: outputFinalization.imageUrl ?? generatedImageUrl,
        durableImageUrl: outputFinalization.durableImageUrl,
        storageBucket: outputFinalization.storageBucket,
        storagePath: outputFinalization.storagePath,
        width: outputFinalization.width,
        height: outputFinalization.height,
      },
    });
  } catch (err) {
    if (err instanceof SceneRebuildError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }

    if (req.signal.aborted || isAbortError(err)) {
      return NextResponse.json(
        {
          error: "Scene rebuild was cancelled.",
          details: {
            code: "request_cancelled",
          },
        },
        { status: 499 }
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("missing base image url for rebuild payload")) {
      return NextResponse.json({ error: "Missing base image for rebuild." }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected scene rebuild error.", message }, { status: 500 });
  }
}
