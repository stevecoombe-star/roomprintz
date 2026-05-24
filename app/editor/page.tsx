// app/editor/page.tsx
"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  EditorCanvas,
  type PasteToPlaceProgressOperationView,
} from "@/components/editor/EditorCanvas";
import {
  MyFurniturePicker,
  type MyFurniturePickerItem,
  type MyFurniturePickerMode,
} from "@/components/editor/MyFurniturePicker";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { TokenBalanceBadge } from "@/components/tokens/TokenBalanceBadge";
import { TokenStatusNotice } from "@/components/tokens/TokenStatusNotice";
import { SnackbarHost, type Snackbar } from "@/components/ui/SnackbarHost";
import {
  toImageSpaceTransform,
  useEditorStore,
  type FurnitureNode,
  type VibodeRoomAsset,
} from "@/stores/editorStore";
import { MOCK_COLLECTIONS, type RoomSizeBundleId } from "@/data/mockCollections";
import { IKEA_CA_SKUS, type IkeaCaSku } from "@/data/mockIkeaCaSkus";
import { clearPendingLocal, loadPendingLocal, savePendingLocal } from "@/lib/pendingGeneration";
import {
  clearPendingFurnitureSelection,
  getPendingFurnitureSelection,
  setPendingFurnitureClipboardSuppressionHash,
} from "@/lib/pendingFurnitureAction";
import { DEFAULT_PX_PER_IN, skuFootprintInchesFromDims } from "@/lib/ikeaSizing";
import { blobToDataUrl, readClipboardImageWithStatus } from "@/lib/readClipboardImage";
import { hashDataUrlForLogs } from "@/lib/pasteToPlaceDebug";
import { classifyPasteToPlaceUrl } from "@/lib/pasteToPlace/directImageUrl";
import {
  isPasteToPlaceCancelledResponsePayload,
  type PasteToPlaceJobControl,
} from "@/lib/pasteToPlaceJobControl";
import { PrepareRoomImageError, prepareRoomImageForUpload } from "@/lib/prepareRoomImageForUpload";
import type { DetectedRoomObjectLabel } from "@/lib/vibodeRoomObjectLabels";
import {
  hashPlacementState,
  normalizePlacementStateForHash,
  type NormalizedPlacementStateRow,
  type PlacementStateHashInput,
} from "@/lib/vibodePlacementState";
import {
  defaultUserDirectedPlacementMetadata,
  normalizePlacementMetadata,
  type PlacementMetadata,
  type PlacementSource,
} from "@/lib/placementMetadata";
import {
  getEffectiveBaseSetVersion,
  isVersionEligibleForActiveSet,
  resolveActiveSetVersionId,
} from "@/lib/vibode/active-set";
import { getVibodeVersionKind, type VibodeVersionKind } from "@/lib/vibode/version-kind";

import { getSupabaseBrowserAccessToken, supabaseBrowser } from "@/lib/supabaseBrowser";
import { useTokenBalance } from "@/hooks/useTokenBalance";

const USER_SKU_MAX_INPUT_BYTES = 12 * 1024 * 1024;
const VIBODE_MODEL_STORAGE_KEY = "vibode:modelVersion";
const FREE_PASTE_TO_PLACE_SESSION_KEY = "vibode:hasUsedFreePasteToPlace";
const PASTE_TO_PLACE_CLIPBOARD_HEADS_UP_SESSION_KEY = "vibode:pasteToPlaceClipboardHeadsUpShown";
const EDITOR_RIGHT_PANEL_STATE_KEY = "vibode.editor.rightPanelState.v1";
const VIBODE_FURNITURE_LAYER_VISIBILITY_KEY = "vibode:furniture-layer-visibility:v1";
const VIBODE_EDITOR_WORKSPACE_KEY = "vibode:editor-workspace:v1";
const VIBODE_EDITOR_WORKSPACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const VIBODE_MODEL_NBP = "NBP";
const VIBODE_MODEL_NB2 = "NB2";
const ROOM_PREPARING_MESSAGE = "Your room is still preparing. Try again in a moment.";
const REMOVE_LABEL_FALLBACK = "object";
const REMOVE_LABEL_PLACEHOLDER = "";
const PASTE_TO_PLACE_CANCEL_SETTLE_MS = 20000;
const STAGE_RUN_CANCEL_SETTLE_MS = 20000;
const SCENE_REBUILD_RENDERING_MESSAGE_DELAY_MS = 50_000;
const SCENE_REBUILD_COMPOSE_WARNING_MS = 90_000;
const SCENE_REBUILD_COMPOSE_TIMEOUT_MS = 120_000;
const LOW_TOKEN_WARNING_THRESHOLD = 10;
const DEFAULT_ACTION_TOKEN_COST = 1;
const STAGE_TOKEN_COST = {
  1: 2,
  2: 2,
  3: 2,
  4: 4,
  5: 5,
} as const;
const VERSION_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTokenCostLabel(tokenCost: number): string {
  return `${tokenCost} token${tokenCost === 1 ? "" : "s"}`;
}

function safeId(prefix = "sn") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function pickBundleIdFromSqft(sqft: number): RoomSizeBundleId {
  if (sqft < 130) return "small";
  if (sqft < 220) return "medium";
  return "large";
}

function isFiniteNumber(n: unknown) {
  return typeof n === "number" && Number.isFinite(n);
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }
  return null;
}

function isSceneRebuildGenerationFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("scene rebuild generation failed") ||
    normalized.includes("scene rebuild failed (http 502)")
  );
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeStr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildRemovePromptForLabel(label: string): string {
  if (label === REMOVE_LABEL_FALLBACK) {
    return "Remove only the object directly under the red X marker. Preserve all other furniture, walls, floors, lighting, shadows, and room details.";
  }
  return `Remove only the ${label} under the red X marker. Preserve all other furniture, walls, floors, lighting, shadows, and room details.`;
}

function formatRemoveModeMarkedCount(count: number): string {
  if (count === 1) return "1 object marked for removal";
  return `${count} objects marked for removal`;
}

function formatRemoveModeManualMarkerCount(count: number): string {
  if (count === 1) return "1 manual marker";
  return `${count} manual markers`;
}

function hasSufficientGeometryRoomObjects(objects: DetectedRoomObjectLabel[]): boolean {
  if (objects.length === 0) return false;
  const geometryCount = objects.filter(
    (object) =>
      Boolean(object.bbox) ||
      (typeof object.centerX === "number" &&
        Number.isFinite(object.centerX) &&
        typeof object.centerY === "number" &&
        Number.isFinite(object.centerY))
  ).length;
  return geometryCount > 0;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function deriveDetectedRemoveObjectKey(object: DetectedRoomObjectLabel, index: number): string {
  const record = object as Record<string, unknown>;
  const id = safeStr(record.id) ?? safeStr(record.objectId) ?? safeStr(record.key);
  if (id) return `id:${id}`;

  const centerFromBbox =
    object.bbox &&
    Number.isFinite(object.bbox.x) &&
    Number.isFinite(object.bbox.w) &&
    Number.isFinite(object.bbox.y)
      ? {
          x: object.bbox.x + object.bbox.w / 2,
          y: object.bbox.y,
        }
      : null;
  const centerFromPoint =
    typeof object.centerX === "number" &&
    Number.isFinite(object.centerX) &&
    typeof object.centerY === "number" &&
    Number.isFinite(object.centerY)
      ? { x: object.centerX, y: object.centerY }
      : null;
  const anchor = centerFromBbox ?? centerFromPoint;
  if (anchor) {
    const roundedX = anchor.x.toFixed(3);
    const roundedY = anchor.y.toFixed(3);
    return `${object.label}:${roundedX}:${roundedY}`;
  }
  return `idx:${index}`;
}

type RemoveModeGuidanceDetectedTarget = {
  number: number;
  sourceKey: string;
  label: string;
  xNorm: number;
  yNorm: number;
  bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
};
type RemoveModeGuidanceManualTarget = {
  sourceKey: string;
  xNorm: number;
  yNorm: number;
};
type RemoveModeGuidanceManifest = {
  detectedTargets: RemoveModeGuidanceDetectedTarget[];
  manualTargets: RemoveModeGuidanceManualTarget[];
  targetCount: number;
};
type RemoveModeTargetOverride = {
  xNorm: number;
  yNorm: number;
};

function sanitizeGuidanceLabel(raw: string | null | undefined): string {
  const safe = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return safe || "object";
}

function deriveRemoveModeGuidanceManifest(args: {
  removeModeObjects: DetectedRoomObjectLabel[];
  selectedRemoveObjectKeys: string[];
  removeModeManualMarkers: Array<{ id: string; xNorm: number; yNorm: number }>;
  removeModeObjectTargetOverrides?: Record<string, RemoveModeTargetOverride>;
}): RemoveModeGuidanceManifest {
  const selectedKeySet = new Set(args.selectedRemoveObjectKeys);
  const detectedUnnumbered: Array<Omit<RemoveModeGuidanceDetectedTarget, "number">> = [];

  args.removeModeObjects.forEach((object, index) => {
    const key = deriveDetectedRemoveObjectKey(object, index);
    if (!selectedKeySet.has(key)) return;
    const bbox =
      object.bbox &&
      Number.isFinite(object.bbox.x) &&
      Number.isFinite(object.bbox.y) &&
      Number.isFinite(object.bbox.w) &&
      Number.isFinite(object.bbox.h)
        ? {
            x: clampUnit(object.bbox.x),
            y: clampUnit(object.bbox.y),
            w: clampUnit(object.bbox.w),
            h: clampUnit(object.bbox.h),
          }
        : undefined;
    const centerFromBbox = bbox
      ? {
          x: clampUnit(bbox.x + bbox.w / 2),
          y: clampUnit(bbox.y + bbox.h / 2),
        }
      : null;
    const centerFromPoint =
      typeof object.centerX === "number" &&
      Number.isFinite(object.centerX) &&
      typeof object.centerY === "number" &&
      Number.isFinite(object.centerY)
        ? {
            x: clampUnit(object.centerX),
            y: clampUnit(object.centerY),
          }
        : null;
    const override = args.removeModeObjectTargetOverrides?.[key] ?? null;
    const centerFromOverride =
      override &&
      Number.isFinite(override.xNorm) &&
      Number.isFinite(override.yNorm)
        ? {
            x: clampUnit(override.xNorm),
            y: clampUnit(override.yNorm),
          }
        : null;
    const center = centerFromOverride ?? centerFromBbox ?? centerFromPoint;
    if (!center) return;
    detectedUnnumbered.push({
      sourceKey: key,
      label: sanitizeGuidanceLabel(object.label),
      xNorm: center.x,
      yNorm: center.y,
      ...(bbox ? { bbox } : {}),
    });
  });

  const detectedTargets = [...detectedUnnumbered]
    .sort((left, right) => {
      if (left.yNorm !== right.yNorm) return left.yNorm - right.yNorm;
      if (left.xNorm !== right.xNorm) return left.xNorm - right.xNorm;
      return left.sourceKey.localeCompare(right.sourceKey);
    })
    .map((target, index) => ({
      ...target,
      number: index + 1,
    }));

  const manualTargets: RemoveModeGuidanceManualTarget[] = args.removeModeManualMarkers.map((marker) => ({
      sourceKey: marker.id,
      xNorm: clampUnit(marker.xNorm),
      yNorm: clampUnit(marker.yNorm),
    }));

  return {
    detectedTargets,
    manualTargets,
    targetCount: detectedTargets.length + manualTargets.length,
  };
}

async function prepareRemoveGuidanceImageDataUrl(args: {
  imageUrl: string;
  manifest: RemoveModeGuidanceManifest;
}): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Remove guidance image preparation requires a browser environment.");
  }
  const imageResponse = await fetch(args.imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to load source image (HTTP ${imageResponse.status}).`);
  }
  const imageBlob = await imageResponse.blob();
  const objectUrl = URL.createObjectURL(imageBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Failed to decode source image."));
      nextImage.src = objectUrl;
    });
    const width = Math.max(1, Math.round(image.naturalWidth || image.width || 0));
    const height = Math.max(1, Math.round(image.naturalHeight || image.height || 0));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to create drawing context for removal guidance image.");
    }
    ctx.drawImage(image, 0, 0, width, height);
    const markerRadius = Math.max(10, Math.round(Math.min(width, height) * 0.02));
    const strokeWidth = Math.max(3, Math.round(markerRadius * 0.3));
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    for (const target of args.manifest.manualTargets) {
      const x = clampUnit(target.xNorm) * width;
      const y = clampUnit(target.yNorm) * height;
      ctx.beginPath();
      ctx.moveTo(x - markerRadius, y - markerRadius);
      ctx.lineTo(x + markerRadius, y + markerRadius);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - markerRadius, y + markerRadius);
      ctx.lineTo(x + markerRadius, y - markerRadius);
      ctx.stroke();
    }
    const badgeRadius = Math.max(11, Math.round(Math.min(width, height) * 0.018));
    for (const target of args.manifest.detectedTargets) {
      const x = clampUnit(target.xNorm) * width;
      const y = clampUnit(target.yNorm) * height;
      ctx.beginPath();
      ctx.fillStyle = "#dc2626";
      ctx.arc(x, y, badgeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, Math.round(badgeRadius * 0.2));
      ctx.strokeStyle = "#fee2e2";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `600 ${Math.max(11, Math.round(badgeRadius * 1.05))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(target.number), x, y);
    }
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function buildRemoveModeGuidancePromptText(manifest: RemoveModeGuidanceManifest): string {
  const lines: string[] = [];
  if (manifest.detectedTargets.length > 0) {
    lines.push("Detected furniture targets:");
    for (const target of manifest.detectedTargets) {
      lines.push(`- Target ${target.number}: ${target.label}`);
    }
  }
  if (manifest.manualTargets.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Manual remove markers:");
    lines.push("- Remove the objects directly under the red X markers.");
  }
  return lines.join("\n");
}

function isServerFetchableImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed);
}

function isDurablePlacementSourceImageUrl(url: string | null | undefined): boolean {
  if (!isServerFetchableImageUrl(url)) return false;
  const trimmed = url?.trim() ?? "";
  if (!trimmed) return false;
  return !/^(https?:\/\/localhost|https?:\/\/127\.0\.0\.1|https?:\/\/0\.0\.0\.0)/i.test(trimmed);
}

const STORAGE_PATH_CANDIDATE_KEYS = [
  "storagePath",
  "storage_path",
  "imagePath",
  "image_path",
  "previewImagePath",
  "preview_image_path",
  "normalizedPath",
  "normalized_path",
  "objectPath",
  "object_path",
] as const;

const STORAGE_OBJECT_IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const KNOWN_STORAGE_PATH_PREFIXES = [
  "property-images/",
  "vibode-generations/",
  "vibode-base-images/",
] as const;

function extractSupabaseStorageObjectPathFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const pathname = parsed.pathname ?? "";
  const match = pathname.match(/^\/storage\/v1\/object\/(?:sign|public)\/(.+)$/i);
  if (!match || typeof match[1] !== "string") return null;
  const rawPath = match[1].trim().replace(/^\/+/, "");
  if (!rawPath) return null;
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

function normalizeRawStorageObjectPathCandidate(value: string): string | null {
  const normalized = value.trim().replace(/^\/+/, "");
  if (!normalized) return null;
  if (/^(https?:|data:|blob:)/i.test(normalized)) return null;
  const pathOnly = normalized.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!pathOnly) return null;
  if (!pathOnly.includes("/")) return null;
  if (!STORAGE_OBJECT_IMAGE_EXTENSION_RE.test(pathOnly)) return null;
  const [bucket] = pathOnly.split("/", 1);
  if (!bucket || !/^[a-z0-9][a-z0-9._-]*$/i.test(bucket)) return null;
  const lowered = pathOnly.toLowerCase();
  if (KNOWN_STORAGE_PATH_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return pathOnly;
  }
  return pathOnly;
}

function normalizeStorageObjectPathCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return extractSupabaseStorageObjectPathFromUrl(trimmed);
  }
  return normalizeRawStorageObjectPathCandidate(trimmed);
}

function extractStorageObjectPathFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    return extractSupabaseStorageObjectPathFromUrl(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractStorageObjectPathFromUnknown(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of STORAGE_PATH_CANDIDATE_KEYS) {
    const found = normalizeStorageObjectPathCandidate(value[key]);
    if (found) return found;
  }
  for (const nestedValue of Object.values(value)) {
    const found = extractStorageObjectPathFromUnknown(nestedValue, depth + 1);
    if (found) return found;
  }
  return null;
}

function isDataImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^data:/i.test(trimmed);
}

function isRoomReadImageUrlSupported(url: string | null | undefined): boolean {
  return isServerFetchableImageUrl(url) || isDataImageUrl(url);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read uploaded image."));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      resolve(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

type IkeaKind =
  | "sofa"
  | "loveseat"
  | "armchair"
  | "dining_table"
  | "dining_chair"
  | "coffee_table"
  | "side_table"
  | "bed"
  | "rug"
  | "floor_lamp";

type SwapKindBucket = "sofa" | "chair" | "table" | "lamp" | "bed" | "rug";

const IKEA_KIND_TO_BUCKET: Record<IkeaKind, SwapKindBucket> = {
  sofa: "sofa",
  loveseat: "sofa",
  armchair: "chair",
  dining_chair: "chair",
  dining_table: "table",
  coffee_table: "table",
  side_table: "table",
  floor_lamp: "lamp",
  bed: "bed",
  rug: "rug",
};

function mapIkeaKindToBucket(kind: IkeaKind): SwapKindBucket {
  return IKEA_KIND_TO_BUCKET[kind];
}

function findIkeaSkuById(skuId?: string | null): IkeaCaSku | null {
  if (!skuId) return null;
  return IKEA_CA_SKUS.find((sku) => sku.skuId === skuId) ?? null;
}

function isIkeaNode(node: FurnitureNode | null): boolean {
  if (!node) return false;
  if (node.vendor === "IKEA_CA") return true;
  if (node.imageUrl || node.productUrl || node.articleNumber) return true;
  return !!findIkeaSkuById(node.skuId);
}

function nodeSwapKind(node: FurnitureNode): SwapKindBucket | null {
  if (!isIkeaNode(node)) return null;

  const sku = findIkeaSkuById(node.skuId);
  if (sku?.kind) return mapIkeaKindToBucket(sku.kind as IkeaKind);

  const hay = `${node.skuId} ${node.label} ${node.displayName ?? ""}`.toLowerCase();
  if (hay.includes("sofa") || hay.includes("loveseat")) return "sofa";
  if (hay.includes("armchair") || hay.includes("chair")) return "chair";
  if (hay.includes("table") || hay.includes("coffee") || hay.includes("side")) return "table";
  if (hay.includes("lamp")) return "lamp";
  if (hay.includes("bed")) return "bed";
  if (hay.includes("rug")) return "rug";
  return null;
}

type FreezePayloadAccess = {
  generationId?: unknown;
  baseImage?: unknown;
  vibodeIntent?: unknown;
};

type FreezeBaseImageAccess = {
  kind?: unknown;
  url?: unknown;
  signedUrl?: unknown;
  storageKey?: unknown;
  imageBase64?: unknown;
  widthPx?: unknown;
  heightPx?: unknown;
};

function getFreezePayloadAccess(payload: unknown): {
  generationId: unknown | null;
  baseImage: FreezeBaseImageAccess | null;
  vibodeIntent: unknown | null;
} {
  if (!payload || typeof payload !== "object") {
    return { generationId: null, baseImage: null, vibodeIntent: null };
  }
  const typed = payload as FreezePayloadAccess;
  const baseImage =
    typed.baseImage && typeof typed.baseImage === "object"
      ? (typed.baseImage as FreezeBaseImageAccess)
      : null;
  return {
    generationId: typed.generationId ?? null,
    baseImage,
    vibodeIntent: typed.vibodeIntent ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isEditorRightPanelsState(value: unknown): value is EditorRightPanelsState {
  if (!isRecord(value)) return false;
  return (
    typeof value.workflow === "boolean" &&
    typeof value.editTools === "boolean" &&
    typeof value.versions === "boolean"
  );
}

function buildTokenUsageMessage(payload: unknown, fallbackCost = DEFAULT_ACTION_TOKEN_COST): string {
  const safeFallback = Number.isFinite(fallbackCost) ? Math.max(1, Math.round(fallbackCost)) : 1;
  let tokenCost = safeFallback;
  let tokenBalance: number | null = null;

  if (isRecord(payload)) {
    const costCandidate = payload.tokenCost;
    const balanceCandidate = payload.tokenBalance;
    if (typeof costCandidate === "number" && Number.isFinite(costCandidate) && costCandidate > 0) {
      tokenCost = Math.round(costCandidate);
    }
    if (typeof balanceCandidate === "number" && Number.isFinite(balanceCandidate)) {
      tokenBalance = Math.max(0, Math.round(balanceCandidate));
    }
  }

  const tokenLabel = `${tokenCost} token${tokenCost === 1 ? "" : "s"} used`;
  if (tokenBalance === null) return tokenLabel;
  return `${tokenLabel} - ${tokenBalance.toLocaleString()} remaining`;
}

function hasValidSwapReplacement(mark: unknown): boolean {
  if (!isRecord(mark)) return false;
  const replacement = mark.replacement;
  if (!isRecord(replacement)) return false;
  const imageUrl = replacement.imageUrl;
  return typeof imageUrl === "string" && imageUrl.trim().length > 0;
}

function hasSwapMarksWithReplacement(vibodeIntent: unknown): boolean {
  if (!isRecord(vibodeIntent)) return false;

  const swap = vibodeIntent.swap;
  const canonicalSwapMarks =
    isRecord(swap) && Array.isArray(swap.marks) ? (swap.marks as unknown[]) : [];
  if (canonicalSwapMarks.some(hasValidSwapReplacement)) return true;

  const legacyMarks = Array.isArray(vibodeIntent.marks) ? (vibodeIntent.marks as unknown[]) : [];
  return legacyMarks.some(hasValidSwapReplacement);
}

type WorkflowStage = 1 | 2 | 3 | 4 | 5;
type WorkflowMode = Exclude<VibodeVersionKind, "unknown">;
type EditorVersionWithKind = VibodeRoomAsset & {
  versionKind: VibodeVersionKind;
  isActiveSetEligible: boolean;
};
type StageRunStatus = "idle" | "running" | "success" | "error";
type DeclutterMode = "off" | "light" | "heavy";
type VibodeModelVersion = typeof VIBODE_MODEL_NBP | typeof VIBODE_MODEL_NB2;
type VibodeAspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";
type EditorRightPanelsState = {
  workflow: boolean;
  editTools: boolean;
  versions: boolean;
};

const DEFAULT_PANELS_STATE: EditorRightPanelsState = {
  workflow: false,
  editTools: false,
  versions: false,
};

const WORKFLOW_MODE_HELPER_COPY: Record<WorkflowMode, string> = {
  set: "Prepare your room",
  stage: "Place furniture",
  style: "Create the vibe",
};
type PasteToPlaceStatus = "reading" | "preparing" | "placing";
type Stage4Action =
  | "style_room"
  | "accessories"
  | "wall_art"
  | "shelves"
  | "curtains"
  | "ceiling_light";
type StageStatusMap = Record<WorkflowStage, StageRunStatus>;
type StageOutputMap = Partial<Record<WorkflowStage, unknown>>;
type UserSku = {
  skuId: string;
  label: string;
  variants: string[];
  sourceUrl?: string;
  status: "ready" | "failed";
  reason?: string | null;
};
type Stage3SkuSource = "user" | "catalog";
type Stage3SkuItem = {
  skuId: string;
  label: string;
  source: Stage3SkuSource;
  active: boolean;
  variants: Array<{ imageUrl: string }>;
};
type ScenePlacement = {
  placementId: string;
  skuId: string;
  label?: string;
  source?: "catalog" | "user";
  bbox?: { x: number; y: number; w: number; h: number };
  rotationDeg?: number;
  stageAdded?: number;
  locked?: boolean;
};
type EditAction = "add" | "remove" | "swap" | "rotate";
type VibodeEligibleSku = {
  skuId: string;
  label: string;
  source?: "catalog" | "user";
  variants: Array<{ imageUrl: string }>;
};
type MyFurnitureResolveResponse = {
  id: string;
  userSkuId: string;
  eligibleSku: VibodeEligibleSku;
  item: {
    displayName: string | null;
    previewImageUrl: string | null;
    sourceUrl: string | null;
    category: string | null;
  };
};
type MyFurnitureListApiItem = {
  id: string;
  user_sku_id: string;
  display_name: string | null;
  preview_image_url: string | null;
  source_url: string | null;
  category: string | null;
  times_used: number | null;
  last_used_at: string | null;
  created_at: string;
};
type VibodeEditRunTarget = {
  placementId?: string;
  skuId?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  xNorm?: number;
  yNorm?: number;
  [key: string]: unknown;
};
type VibodeEditRunRequest = {
  baseImageUrl: string;
  action: EditAction;
  placements?: ScenePlacement[];
  target?: VibodeEditRunTarget;
  params?: Record<string, unknown>;
  xNorm?: number;
  yNorm?: number;
  rotationDegrees?: number;
  eligibleSkus?: VibodeEligibleSku[];
  modelVersion?: VibodeModelVersion;
  vibodeRoomId?: string;
  stageNumber?: number;
  pasteToPlaceControl?: PasteToPlaceJobControl;
  mode?: "guidance-image";
};
type VibodeEditRunResponse = {
  imageUrl: string;
  placements?: ScenePlacement[];
};
type PasteToPlaceClickHint = { xNorm: number; yNorm: number };
type RotateMarker = {
  xNorm: number;
  yNorm: number;
};
type RotateDirection = "cw" | "ccw";
type RotateAmount = 5 | 15 | 30 | 45 | 90;
type RotateToolState = {
  marker: RotateMarker | null;
  direction: RotateDirection;
  amountDegrees: RotateAmount;
};
type RoomReadResponse = {
  objects?: DetectedRoomObjectLabel[];
};
type RemoveModeOverlayTarget = {
  key: string;
  label: string;
  xNorm: number;
  yNorm: number;
  confidence: number;
};
type RemoveModeManualMarker = {
  id: string;
  xNorm: number;
  yNorm: number;
  createdAt: number;
};
type PlacementLayerNode = {
  id: string;
  userId: string;
  roomId: string;
  versionId: string | null;
  furnitureId: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  sourceImageUrl: string;
  sourceImagePath: string | null;
  // x/y are normalized canvas coordinates in [0, 1], not pixel positions.
  x: number;
  y: number;
  scale: number;
  rotation: number;
  isVisible: boolean;
  metadata: PlacementMetadata;
  createdAt: string;
  updatedAt: string;
};
type PlacementLayerDragState = {
  nodeId: string;
  startedAsSuggested: boolean;
};
type PlacementLayerListResponse = {
  nodes?: unknown;
};
type PlacementLayerRevertResponse = {
  nodes?: unknown;
};
type PlacementLayerCreateResponse = {
  node?: unknown;
  deduped?: boolean;
};
type ModelDecidedFurnitureCandidatePayload = {
  furnitureId: string | null;
  skuId: string | null;
  label: string | null;
  sourceImageUrl: string | null;
  sourceImagePath: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  placementSource: "clipboard" | "product_url" | "swap" | "my_furniture";
};
type SceneRenderStateMetadata = {
  renderedPlacementStateHash?: unknown;
  renderedPlacementSnapshot?: unknown;
  originalPlacementStateHash?: unknown;
  originalPlacementSnapshot?: unknown;
  renderedAt?: unknown;
  sourceVersionId?: unknown;
};
type PasteToPlacePreparedProduct = {
  source: "clipboard" | "my_furniture" | "product_url";
  skuId: string;
  eligibleSkus: VibodeEligibleSku[];
  savedFurnitureId?: string | null;
  sourceMeta?: {
    inputType: "url";
    domain: string | null;
    classification: "direct_image_url" | null;
    confidence: null;
  };
};
type PreparedProductLike = PasteToPlacePreparedProduct;
type ActivePasteSource =
  | {
      type: "clipboard";
      skuId: string;
      preparedProduct: PreparedProductLike;
      durableSavedPreviewUrl: string | null;
      rawPreviewUrl: string | null;
      normalizedPreviewUrl: string | null;
      sourceImagePathHint: string | null;
      thumbnailPathHint: string | null;
      clipboardDataUrlHash: string;
      requestId?: string | null;
      activatedAt: number;
    }
  | {
      type: "my_furniture";
      skuId: string;
      furnitureId: string;
      furnitureIds: string[];
      selectionCount: number;
      selectedPreviewUrls: string[];
      preparedProduct: PreparedProductLike;
      rawPreviewUrl: string | null;
      normalizedPreviewUrl: string | null;
      sourceImagePathHint: string | null;
      thumbnailPathHint: string | null;
      clipboardDataUrlHash: null;
      activatedAt: number;
    }
  | {
      type: "product_url";
      urlKind: "product_page_url" | "direct_image_url";
      skuId: string;
      furnitureId: string | null;
      preparedOnly: boolean;
      preparedProduct: PreparedProductLike;
      rawPreviewUrl: string | null;
      normalizedPreviewUrl: string | null;
      sourceImagePathHint: string | null;
      thumbnailPathHint: string | null;
      displayName: string | null;
      supplier: string | null;
      domain: string | null;
      sourceUrl: string | null;
      userSkuId: string;
      clipboardDataUrlHash: null;
      activatedAt: number;
    }
  | null;

function normalizeLikelyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefixed = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(prefixed);
    if (!parsed.hostname) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLikelySafariBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const looksLikeSafari = ua.includes("safari");
  const isKnownNonSafari =
    ua.includes("chrome") ||
    ua.includes("chromium") ||
    ua.includes("crios") ||
    ua.includes("edg") ||
    ua.includes("opr") ||
    ua.includes("fxios");
  return looksLikeSafari && !isKnownNonSafari;
}

function getDomainFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const hostname = new URL(rawUrl).hostname.trim();
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (!isRecord(error)) return false;
  return error.name === "AbortError";
}

function isIntentionalPasteToPlaceCancellation(
  payload: unknown,
  options?: { suppressCancellationError?: boolean }
): boolean {
  if (!options?.suppressCancellationError) return false;
  return isPasteToPlaceCancelledResponsePayload(payload);
}
type PasteToPlaceClipboardPreparationResult =
  | {
      status: "ready";
      source: Extract<ActivePasteSource, { type: "clipboard" }>;
    }
  | { status: "no-image" }
  | { status: "blocked" }
  | { status: "failed"; reason?: string };
type PasteToPlaceProductUrlPrepareResponse = {
  prepared?: {
    userSkuId?: unknown;
    previewImageUrl?: unknown;
    displayName?: unknown;
    sourceUrl?: unknown;
    sourceDomain?: unknown;
    supplierName?: unknown;
    parsedSourceDomain?: unknown;
    parsedSupplierName?: unknown;
  } | null;
  code?: unknown;
  error?: unknown;
};
type PasteToPlaceProductUrlSaveResponse = {
  item?: {
    id?: unknown;
    user_sku_id?: unknown;
  } | null;
  savedFurniture?: {
    id?: unknown;
  } | null;
  furniture?: {
    id?: unknown;
  } | null;
  id?: unknown;
  code?: unknown;
  error?: unknown;
};
type PasteToPlaceMenuPreparationResult =
  | {
      status: "ready";
      source: NonNullable<ActivePasteSource>;
    }
  | { status: "no-image" }
  | { status: "blocked" }
  | { status: "failed"; reason?: string };

function parseProductUrlSaveFurnitureId(payload: unknown): string | null {
  const response = isRecord(payload) ? payload : null;
  if (!response) return null;
  const idCandidates: unknown[] = [];
  const item = isRecord(response.item) ? response.item : null;
  const savedFurniture = isRecord(response.savedFurniture) ? response.savedFurniture : null;
  const furniture = isRecord(response.furniture) ? response.furniture : null;
  idCandidates.push(item?.id);
  idCandidates.push(savedFurniture?.id);
  idCandidates.push(furniture?.id);
  idCandidates.push(response.id);
  const itemAsArray = Array.isArray(response.item) ? response.item : null;
  if (itemAsArray && itemAsArray.length > 0) {
    const firstItem = isRecord(itemAsArray[0]) ? itemAsArray[0] : null;
    idCandidates.push(firstItem?.id);
  }
  for (const candidate of idCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function parseSavedFurnitureDurablePreviewUrl(savedFurniture: unknown): string | null {
  if (!isRecord(savedFurniture)) return null;
  const candidates: unknown[] = [
    savedFurniture.previewImageUrl,
    savedFurniture.preview_image_url,
    savedFurniture.imageUrl,
    savedFurniture.image_url,
    savedFurniture.normalizedPreviewUrl,
    savedFurniture.normalized_preview_url,
    savedFurniture.thumbnailUrl,
    savedFurniture.thumbnail_url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
    const normalizedCandidate = candidate.trim();
    if (!isDurablePlacementSourceImageUrl(normalizedCandidate)) continue;
    return normalizedCandidate;
  }
  return null;
}

function parseSavedFurnitureStoragePath(savedFurniture: unknown): string | null {
  if (!isRecord(savedFurniture)) return null;
  return extractStorageObjectPathFromUnknown(savedFurniture);
}
type PasteToPlaceMenuState = {
  xNorm: number;
  yNorm: number;
  anchorCssX: number;
  anchorCssY: number;
  anchorX?: number;
  anchorY?: number;
} | null;
type AwaitingPasteToPlaceReason =
  | "safari"
  | "clipboard_access_unavailable"
  | "refresh_copied_item";
type AwaitingPasteToPlaceSession = {
  operationId: number;
  reason: AwaitingPasteToPlaceReason;
  createdAt: number;
};
type PasteEventClipboardImagePayload = {
  operationId: number;
  file: Blob | File;
  dataUrl: string;
  dataUrlHash: string | null;
  createdAt: number;
};
type PasteToPlaceUrlCandidatePreview = {
  kind: "product_page_url" | "direct_image_url";
  sourceUrl: string;
  normalizedUrl: string;
  previewImageUrl: string;
  title: string | null;
  domain: string | null;
  operationId: number;
};
type PendingPasteToPlacePlacementSnapshot = Readonly<{
  operationId: number;
  committedAtMs: number;
  mode: "place_here" | "swap_item" | "auto_place";
  point: Readonly<{
    xNorm: number;
    yNorm: number;
    anchorCssX: number;
    anchorCssY: number;
    anchorX?: number;
    anchorY?: number;
  }>;
  roomIdAtCommit: string | null;
  versionIdAtCommit: string | null;
  sourceAtCommit: NonNullable<ActivePasteSource> | null;
  provisionalClipboardPreviewUrlAtCommit: string | null;
  urlCandidatePreviewAtCommit: PasteToPlaceUrlCandidatePreview | null;
  productUrlInputAtCommit: string;
  pasteToPlaceControl: PasteToPlaceJobControl | null;
}>;
type PendingPasteToPlaceCommitContext = Readonly<{
  operationId: number;
  snapshot: PendingPasteToPlacePlacementSnapshot;
  pasteToPlaceControl: PasteToPlaceJobControl | null;
  abortController: AbortController | null;
  progressAnchor: Readonly<NonNullable<PasteToPlaceMenuState>>;
  registeredAtMs: number;
  updatedAtMs: number;
}>;
type PendingStage3Payload = {
  skuItems?: unknown;
  showCatalog?: unknown;
};
type PendingLocalPayload = {
  sceneId?: unknown;
  stage3?: PendingStage3Payload;
  [key: string]: unknown;
};
type CanvasPresentationState = {
  frameAspectRatio: number | null;
  placeholderImageUrl: string | null;
  finalImageReady: boolean;
  isHydratingRoom: boolean;
  showPlaceholder: boolean;
};
type RoomCanvasHydrationTarget = {
  imageUrl: string;
  token: number;
};

const STAGE4_PRIMARY_ACTION: Stage4Action = "style_room";
const STAGE4_ADVANCED_ACTIONS: Stage4Action[] = [
  "accessories",
  "wall_art",
  "shelves",
  "curtains",
  "ceiling_light",
];
const STAGE4_ACTION_LABELS: Record<Stage4Action, string> = {
  style_room: "Style Room",
  accessories: "Accessories",
  wall_art: "Wall Art",
  shelves: "Shelves",
  curtains: "Curtains",
  ceiling_light: "Ceiling Light",
};
const INITIAL_STAGE_STATUS: StageStatusMap = {
  1: "idle",
  2: "idle",
  3: "idle",
  4: "idle",
  5: "idle",
};
const ROOM_OPEN_PLACEHOLDER_FADE_MS = 200;
const ROOM_OPEN_REVEAL_SETTLE_MS = 180;

function isStage4Action(value: unknown): value is Stage4Action {
  if (typeof value !== "string") return false;
  return Object.prototype.hasOwnProperty.call(STAGE4_ACTION_LABELS, value);
}

function mergeStage3SkuItems(prev: Stage3SkuItem[], userSkus: UserSku[]): Stage3SkuItem[] {
  const next: Stage3SkuItem[] = [];
  const seenSkuIds = new Set<string>();

  for (const item of prev) {
    if (!item?.skuId || seenSkuIds.has(item.skuId)) continue;
    seenSkuIds.add(item.skuId);
    next.push(item);
  }

  for (const sku of userSkus) {
    if (!sku?.skuId || seenSkuIds.has(sku.skuId)) continue;
    const userItem: Stage3SkuItem = {
      skuId: sku.skuId,
      label: sku.label || sku.skuId,
      source: "user",
      active: true,
      variants: (sku.variants ?? [])
        .filter((imageUrl): imageUrl is string => typeof imageUrl === "string")
        .map((imageUrl) => ({ imageUrl })),
    };
    const lastUserIndex = next.findLastIndex((item) => item.source === "user");
    next.splice(lastUserIndex + 1, 0, userItem);
    seenSkuIds.add(sku.skuId);
  }

  for (const sku of IKEA_CA_SKUS) {
    if (!sku?.skuId || seenSkuIds.has(sku.skuId)) continue;
    seenSkuIds.add(sku.skuId);
    next.push({
      skuId: sku.skuId,
      label: sku.displayName ?? sku.skuId,
      source: "catalog",
      active: false,
      variants: sku.imageUrl ? [{ imageUrl: sku.imageUrl }] : [],
    });
  }

  return next;
}

function mergeEligibleSkusForSavedFurniture(
  base: VibodeEligibleSku[],
  resolved: VibodeEligibleSku
): VibodeEligibleSku[] {
  const next = base.filter((sku) => sku.skuId !== resolved.skuId);
  next.push(resolved);
  return next;
}

function serializeStage3SkuItems(rawItems: unknown): Stage3SkuItem[] {
  if (!Array.isArray(rawItems)) return [];
  const next: Stage3SkuItem[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const skuId = typeof item.skuId === "string" ? item.skuId : "";
    if (!skuId) continue;

    const source: Stage3SkuSource =
      item.source === "catalog" || item.source === "user" ? item.source : "catalog";
    const variantsRaw = Array.isArray(item.variants) ? item.variants : [];
    const variants = variantsRaw
      .map((variant) => {
        if (!variant || typeof variant !== "object") return null;
        const imageUrl = (variant as Record<string, unknown>).imageUrl;
        return typeof imageUrl === "string" ? { imageUrl } : null;
      })
      .filter((variant): variant is { imageUrl: string } => Boolean(variant));

    next.push({
      skuId,
      label: typeof item.label === "string" && item.label.trim() ? item.label : skuId,
      source,
      active: item.active === true,
      variants,
    });
  }

  return next;
}

function buildPendingStage3Payload(
  stage3SkuItems: Stage3SkuItem[],
  stage3ShowCatalog: boolean
): { skuItems: Stage3SkuItem[]; showCatalog: boolean } {
  return {
    skuItems: serializeStage3SkuItems(stage3SkuItems),
    showCatalog: stage3ShowCatalog === true,
  };
}

function getImageUrlFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.imageUrl === "string" && record.imageUrl.trim().length > 0) {
    return record.imageUrl;
  }
  const output = record.output;
  if (
    output &&
    typeof output === "object" &&
    typeof (output as Record<string, unknown>).imageUrl === "string"
  ) {
    const outputImage = (output as Record<string, unknown>).imageUrl as string;
    return outputImage.trim().length > 0 ? outputImage : null;
  }
  return null;
}

function getHistoryRecordImageUrl(record: unknown): string | null {
  if (!isRecord(record)) return null;

  const directCandidates = [record.outputImageUrl, record.compositeImageUrl];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const freeze = isRecord(record.freeze) ? (record.freeze as Record<string, unknown>) : null;
  if (!freeze) return null;

  const nestedCandidates = [
    isRecord(freeze.baseImage) ? freeze.baseImage.url : null,
    isRecord(freeze.sceneSnapshot) ? freeze.sceneSnapshot.baseImageUrl : null,
    isRecord(freeze.sceneSnapshotImageSpace) ? freeze.sceneSnapshotImageSpace.baseImageUrl : null,
  ];
  for (const candidate of nestedCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function validateFreezePayloadV1(payload: unknown): { ok: true } | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "payload missing" };
  const payloadRecord = payload as { payloadVersion?: unknown; sceneSnapshotImageSpace?: unknown };
  if (payloadRecord.payloadVersion !== "v1")
    return { ok: false, reason: `payloadVersion must be "v1"` };

  const base = getFreezePayloadAccess(payload).baseImage;
  if (!base || typeof base !== "object") return { ok: false, reason: "baseImage missing" };
  const baseKind = (base.kind as string | undefined) ?? "";
  if (!["publicUrl", "signedUrl", "storageKey"].includes(baseKind))
    return { ok: false, reason: "baseImage.kind invalid" };
  if ((baseKind === "publicUrl" || baseKind === "signedUrl") && !base.url)
    return { ok: false, reason: "baseImage.url missing" };
  if (baseKind === "storageKey" && !base.storageKey)
    return { ok: false, reason: "baseImage.storageKey missing" };
  if (!isFiniteNumber(base.widthPx) || !isFiniteNumber(base.heightPx))
    return { ok: false, reason: "baseImage width/height missing" };

  const snap = payloadRecord.sceneSnapshotImageSpace as {
    nodes?: Array<{ id?: unknown; skuId?: unknown; transform?: unknown }>;
  };
  if (!snap || typeof snap !== "object")
    return { ok: false, reason: "sceneSnapshotImageSpace missing" };
  if (!Array.isArray(snap.nodes))
    return { ok: false, reason: "sceneSnapshotImageSpace.nodes missing" };

  for (const n of snap.nodes) {
    if (!n?.id || !n?.skuId) return { ok: false, reason: "node missing id/skuId" };
    const t = n.transform && typeof n.transform === "object" ? (n.transform as Record<string, unknown>) : null;
    if (!t) return { ok: false, reason: `node ${n.id} missing transform` };
    const fields = ["x", "y", "width", "height", "rotation"] as const;
    for (const f of fields) {
      if (!isFiniteNumber(t[f]))
        return { ok: false, reason: `node ${n.id} transform.${f} invalid` };
    }
    const width = t.width as number;
    const height = t.height as number;
    if (width <= 0 || height <= 0)
      return { ok: false, reason: `node ${n.id} width/height must be > 0` };
  }

  return { ok: true };
}

async function tryGetSupabaseAccessToken(): Promise<string | null> {
  try {
    const token = await getSupabaseBrowserAccessToken();
    lastKnownSupabaseAccessToken = token;
    return token;
  } catch (err) {
    console.warn("[supabase] access token lookup threw:", err);
    return null;
  }
}

let lastKnownSupabaseAccessToken: string | null = null;

type VibodeRoomHydrationRow = {
  id: string;
  selected_model: string | null;
  current_stage: number | null;
  active_asset_id: string | null;
  base_asset_id: string | null;
  metadata: Record<string, unknown> | null;
};

type VibodeRoomAssetHydrationRow = {
  id: string;
  room_id: string;
  user_id: string;
  asset_type: string;
  stage_number: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  image_url: string | null;
  preview_url: string | null;
  width: number | null;
  height: number | null;
  model_version: string | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type VibodeEditorWorkspaceSnapshot = {
  roomId: string | null;
  versionId: string | null;
  furnitureLayerEnabled: boolean;
  timestamp: number;
};
type VibodeRoomRowForRecovery = {
  id: string;
  active_asset_id: string | null;
  sort_key: string | null;
};

type VibodeDebugWindow = Window & {
  __VIBODE_DEBUG_ROOM_OPEN__?: boolean;
};

function parseRoomIdFromSearch(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseRoomPreviewUrlFromSearch(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 8192) return null;
  if (/^(https?:\/\/|blob:|data:image\/|\/)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

type SearchParamReader = {
  get: (key: string) => string | null;
};

function parsePositiveNumberFromSearch(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function parseRequestedRoomAspectRatioFromSearch(params: SearchParamReader): number | null {
  return (
    normalizeAspectRatio(params.get("roomAspectRatio")) ??
    normalizeAspectRatio(params.get("roomAspect")) ??
    normalizeAspectRatio(params.get("aspectRatio")) ??
    normalizeAspectRatio(params.get("frameAspectRatio")) ??
    null
  );
}

function parseRequestedPreviewAspectRatioFromSearch(params: SearchParamReader): number | null {
  const directRatio =
    normalizeAspectRatio(params.get("roomPreviewAspectRatio")) ??
    normalizeAspectRatio(params.get("previewAspectRatio")) ??
    normalizeAspectRatio(params.get("previewAr")) ??
    null;
  if (directRatio) return directRatio;

  const previewWidth =
    parsePositiveNumberFromSearch(params.get("roomPreviewWidthPx")) ??
    parsePositiveNumberFromSearch(params.get("roomPreviewWidth")) ??
    parsePositiveNumberFromSearch(params.get("previewWidthPx")) ??
    parsePositiveNumberFromSearch(params.get("previewWidth")) ??
    null;
  const previewHeight =
    parsePositiveNumberFromSearch(params.get("roomPreviewHeightPx")) ??
    parsePositiveNumberFromSearch(params.get("roomPreviewHeight")) ??
    parsePositiveNumberFromSearch(params.get("previewHeightPx")) ??
    parsePositiveNumberFromSearch(params.get("previewHeight")) ??
    null;
  return aspectRatioFromDimensions(previewWidth, previewHeight);
}

function normalizeAspectRatio(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const ratioMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (ratioMatch) {
      const width = Number(ratioMatch[1]);
      const height = Number(ratioMatch[2]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return width / height;
      }
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function aspectRatioFromDimensions(width: unknown, height: unknown): number | null {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return width / height;
}

function aspectRatioFromAssetMetadata(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata) return null;
  const directRatio =
    normalizeAspectRatio(metadata.aspectRatio) ??
    normalizeAspectRatio(metadata.aspect_ratio) ??
    normalizeAspectRatio(metadata.frameAspectRatio) ??
    normalizeAspectRatio(metadata.frame_aspect_ratio);
  if (directRatio) return directRatio;

  return (
    aspectRatioFromDimensions(metadata.widthPx, metadata.heightPx) ??
    aspectRatioFromDimensions(metadata.width, metadata.height) ??
    null
  );
}

const SCENE_PLACEMENT_ARRAY_KEYS = [
  "placements",
  "scenePlacements",
  "scene_placements",
  "editablePlacements",
  "editable_placements",
  "currentPlacements",
] as const;

const SCENE_PLACEMENT_NESTED_KEYS = [
  "metadata",
  "output",
  "result",
  "response",
  "data",
  "scene",
  "sceneState",
  "scene_state",
  "editState",
  "edit_state",
  "request_payload",
  "response_payload",
] as const;

function parsePlacementBbox(value: unknown): ScenePlacement["bbox"] | undefined {
  if (!isRecord(value)) return undefined;
  const x = parseFiniteNumber(value.x);
  const y = parseFiniteNumber(value.y);
  const w = parseFiniteNumber(value.w) ?? parseFiniteNumber(value.width);
  const h = parseFiniteNumber(value.h) ?? parseFiniteNumber(value.height);
  if (x === null || y === null || w === null || h === null) return undefined;
  return { x, y, w, h };
}

function normalizeScenePlacement(value: unknown): ScenePlacement | null {
  if (!isRecord(value)) return null;
  const placementId =
    safeStr(value.placementId) ?? safeStr(value.placement_id) ?? safeStr(value.id);
  const skuId = safeStr(value.skuId) ?? safeStr(value.sku_id);
  if (!placementId || !skuId) return null;
  const sourceRaw = safeStr(value.source);
  const source: ScenePlacement["source"] =
    sourceRaw === "catalog" || sourceRaw === "user" ? sourceRaw : undefined;
  const stageAddedRaw = parseFiniteNumber(value.stageAdded) ?? parseFiniteNumber(value.stage_added);
  const rotationDegRaw =
    parseFiniteNumber(value.rotationDeg) ??
    parseFiniteNumber(value.rotationDegrees) ??
    parseFiniteNumber(value.rotation);
  return {
    placementId,
    skuId,
    label: safeStr(value.label) ?? undefined,
    source,
    bbox: parsePlacementBbox(value.bbox) ?? parsePlacementBbox(value.box),
    rotationDeg: rotationDegRaw ?? undefined,
    stageAdded: stageAddedRaw ?? undefined,
    locked: typeof value.locked === "boolean" ? value.locked : undefined,
  };
}

function normalizeScenePlacementsArray(value: unknown): ScenePlacement[] {
  if (!Array.isArray(value)) return [];
  const next: ScenePlacement[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeScenePlacement(item);
    if (!normalized || seen.has(normalized.placementId)) continue;
    seen.add(normalized.placementId);
    next.push(normalized);
  }
  return next;
}

function normalizePlacementLayerNode(value: unknown): PlacementLayerNode | null {
  if (!isRecord(value)) return null;
  const id = safeStr(value.id);
  const userId = safeStr(value.user_id) ?? safeStr(value.userId);
  const roomId = safeStr(value.room_id) ?? safeStr(value.roomId);
  const versionId = safeStr(value.version_id) ?? safeStr(value.versionId);
  const sourceImageUrl = safeStr(value.source_image_url) ?? safeStr(value.sourceImageUrl);
  const createdAt = safeStr(value.created_at) ?? safeStr(value.createdAt);
  const updatedAt = safeStr(value.updated_at) ?? safeStr(value.updatedAt);
  const x = parseFiniteNumber(value.x);
  const y = parseFiniteNumber(value.y);
  const scale = parseFiniteNumber(value.scale) ?? 1;
  const rotation = parseFiniteNumber(value.rotation) ?? 0;
  if (!id || !userId || !roomId || !sourceImageUrl || createdAt === null || updatedAt === null) {
    return null;
  }
  if (x === null || y === null) return null;
  return {
    id,
    userId,
    roomId,
    versionId,
    furnitureId: safeStr(value.furniture_id) ?? safeStr(value.furnitureId),
    thumbnailUrl: safeStr(value.thumbnail_url) ?? safeStr(value.thumbnailUrl),
    thumbnailPath: safeStr(value.thumbnail_path) ?? safeStr(value.thumbnailPath),
    sourceImageUrl,
    sourceImagePath: safeStr(value.source_image_path) ?? safeStr(value.sourceImagePath),
    x,
    y,
    scale,
    rotation,
    isVisible: typeof value.is_visible === "boolean" ? value.is_visible : value.isVisible !== false,
    metadata: normalizePlacementMetadata(
      value.metadata,
      defaultUserDirectedPlacementMetadata()
    ),
    createdAt,
    updatedAt,
  };
}

function readSceneRenderStateMetadata(metadata: unknown): SceneRenderStateMetadata | null {
  if (!isRecord(metadata)) return null;
  const sceneRenderState = metadata.sceneRenderState;
  if (!isRecord(sceneRenderState)) return null;
  return sceneRenderState as SceneRenderStateMetadata;
}

function readRenderedPlacementStateHashFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const sceneRenderState = readSceneRenderStateMetadata(metadata);
  const nestedHash = safeStr(sceneRenderState?.renderedPlacementStateHash);
  if (nestedHash) return nestedHash;
  return safeStr(metadata.renderedPlacementStateHash);
}

function readRenderedPlacementSnapshotFromMetadata(metadata: unknown): NormalizedPlacementStateRow[] | null {
  if (!isRecord(metadata)) return null;
  const sceneRenderState = readSceneRenderStateMetadata(metadata);
  if (!sceneRenderState) return null;
  const snapshotRaw = sceneRenderState.renderedPlacementSnapshot;
  if (!Array.isArray(snapshotRaw)) return null;
  return normalizePlacementStateForHash(snapshotRaw as PlacementStateHashInput[]);
}

function readOriginalPlacementStateHashFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const sceneRenderState = readSceneRenderStateMetadata(metadata);
  const nestedHash = safeStr(sceneRenderState?.originalPlacementStateHash);
  if (nestedHash) return nestedHash;
  return null;
}

function readOriginalPlacementSnapshotFromMetadata(metadata: unknown): NormalizedPlacementStateRow[] | null {
  if (!isRecord(metadata)) return null;
  const sceneRenderState = readSceneRenderStateMetadata(metadata);
  if (!sceneRenderState) return null;
  const snapshotRaw = sceneRenderState.originalPlacementSnapshot;
  if (!Array.isArray(snapshotRaw)) return null;
  return normalizePlacementStateForHash(snapshotRaw as PlacementStateHashInput[]);
}

function extractScenePlacementsFromUnknown(value: unknown, depth = 0): ScenePlacement[] {
  if (depth > 4) return [];
  const directPlacements = normalizeScenePlacementsArray(value);
  if (directPlacements.length > 0) return directPlacements;
  if (!isRecord(value)) return [];

  for (const key of SCENE_PLACEMENT_ARRAY_KEYS) {
    const placements = normalizeScenePlacementsArray(value[key]);
    if (placements.length > 0) return placements;
  }

  for (const key of SCENE_PLACEMENT_NESTED_KEYS) {
    const placements = extractScenePlacementsFromUnknown(value[key], depth + 1);
    if (placements.length > 0) return placements;
  }

  return [];
}

function isRoomOpenDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window as VibodeDebugWindow).__VIBODE_DEBUG_ROOM_OPEN__ === true;
}

function logEditorRoomOpen(event: string, payload?: Record<string, unknown>) {
  if (!isRoomOpenDebugEnabled()) return;
  if (payload) {
    console.log("[editor-room-open]", event, payload);
    return;
  }
  console.log("[editor-room-open]", event);
}

function logEditorRecovery(message: string, payload?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  if (payload) {
    console.debug(message, payload);
    return;
  }
  console.debug(message);
}

function pickMostRelevantVersion(
  versions: VibodeRoomAsset[],
  options?: {
    preferredVersionId?: string | null;
    activeVersionId?: string | null;
  }
): VibodeRoomAsset | null {
  if (versions.length === 0) return null;
  const preferredVersionId = options?.preferredVersionId ?? null;
  const activeVersionId = options?.activeVersionId ?? null;
  if (preferredVersionId) {
    const preferred = versions.find((asset) => asset.id === preferredVersionId);
    if (preferred) return preferred;
  }
  if (activeVersionId) {
    const activeByRoom = versions.find((asset) => asset.id === activeVersionId);
    if (activeByRoom) return activeByRoom;
  }
  const flaggedActive = versions.find((asset) => asset.is_active);
  if (flaggedActive) return flaggedActive;
  const newest = versions
    .slice()
    .sort((a, b) => {
      const aMs = Date.parse(a.created_at);
      const bMs = Date.parse(b.created_at);
      const safeA = Number.isFinite(aMs) ? aMs : 0;
      const safeB = Number.isFinite(bMs) ? bMs : 0;
      return safeB - safeA;
    })[0];
  return newest ?? versions[0] ?? null;
}

function readWorkspaceSnapshot(): VibodeEditorWorkspaceSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(VIBODE_EDITOR_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const timestamp = parseFiniteNumber(parsed.timestamp);
    if (timestamp === null) return null;
    return {
      roomId: safeStr(parsed.roomId),
      versionId: safeStr(parsed.versionId),
      furnitureLayerEnabled: parsed.furnitureLayerEnabled === true,
      timestamp,
    };
  } catch {
    return null;
  }
}

function clearWorkspaceSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(VIBODE_EDITOR_WORKSPACE_KEY);
  } catch {
    // Ignore storage write errors.
  }
}

function hasExplicitNewRoomIntent(params: { get: (key: string) => string | null }): boolean {
  return params.get("newRoom") === "1";
}

function hasRoomIdInCurrentLocation(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(parseRoomIdFromSearch(params.get("roomId") ?? params.get("vibodeRoomId")));
}

async function fetchPreviewUrlForRoom(roomId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("/api/vibode/room-preview-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ roomId }),
    });
    if (!res.ok) {
      return null;
    }

    const payload = (await res.json()) as { previewUrl?: unknown };
    const previewUrl =
      typeof payload.previewUrl === "string" && payload.previewUrl.trim().length > 0
      ? payload.previewUrl
      : null;
    return previewUrl;
  } catch (err) {
    console.warn("[editor] failed to resolve room preview URL:", err);
    return null;
  }
}

async function setActiveVersionForRoom(args: {
  roomId: string;
  assetId: string;
  accessToken: string;
}): Promise<void> {
  const res = await fetch("/api/vibode/set-active-version", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      roomId: args.roomId,
      assetId: args.assetId,
    }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to set active version (HTTP ${res.status})`;
    throw new Error(message);
  }
}

async function setActiveSetVersionForRoom(args: {
  roomId: string;
  activeSetVersionId: string;
  accessToken: string;
}): Promise<{ activeSetVersionId: string; metadata: Record<string, unknown> | null }> {
  const res = await fetch("/api/vibode/set-active-set", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      roomId: args.roomId,
      activeSetVersionId: args.activeSetVersionId,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    activeSetVersionId?: unknown;
    metadata?: unknown;
  };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to set Base Image (HTTP ${res.status})`;
    throw new Error(message);
  }

  const resolvedActiveSetVersionId =
    typeof payload.activeSetVersionId === "string" && payload.activeSetVersionId.trim().length > 0
      ? payload.activeSetVersionId
      : args.activeSetVersionId;
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  return { activeSetVersionId: resolvedActiveSetVersionId, metadata };
}

async function deleteVersionForRoom(args: {
  roomId: string;
  assetId: string;
  accessToken: string;
}): Promise<{ deletedWasActive: boolean; nextActiveAssetId: string | null }> {
  const res = await fetch("/api/vibode/delete-version", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      roomId: args.roomId,
      assetId: args.assetId,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    deletedWasActive?: unknown;
    nextActiveAssetId?: unknown;
  };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to delete room version (HTTP ${res.status})`;
    throw new Error(message);
  }

  return {
    deletedWasActive: payload.deletedWasActive === true,
    nextActiveAssetId:
      typeof payload.nextActiveAssetId === "string" && payload.nextActiveAssetId.trim().length > 0
        ? payload.nextActiveAssetId
        : null,
  };
}

function normalizeRoomAssetForStore(row: VibodeRoomAssetHydrationRow): VibodeRoomAsset | null {
  if (typeof row.image_url !== "string" || row.image_url.trim().length === 0) return null;
  const previewUrl =
    typeof row.preview_url === "string" && row.preview_url.trim().length > 0
      ? row.preview_url
      : row.image_url;
  return {
    id: row.id,
    room_id: row.room_id,
    user_id: row.user_id,
    asset_type: row.asset_type,
    stage_number: row.stage_number,
    storage_bucket: row.storage_bucket,
    storage_path: row.storage_path,
    image_url: row.image_url,
    preview_url: previewUrl,
    width: row.width,
    height: row.height,
    model_version: row.model_version,
    is_active: row.is_active === true,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
  };
}

async function loadRoomVersions(roomId: string, accessToken: string): Promise<VibodeRoomAsset[]> {
  const res = await fetch("/api/vibode/room-versions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ roomId }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    versions?: VibodeRoomAssetHydrationRow[];
    error?: unknown;
  };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to load room versions (HTTP ${res.status})`;
    throw new Error(message);
  }

  const hydratedRows = (Array.isArray(payload.versions) ? payload.versions : []).map((row) =>
    normalizeRoomAssetForStore(row)
  );
  return hydratedRows.filter((row): row is VibodeRoomAsset => Boolean(row));
}

async function loadPlacementLayerNodesForVersion(args: {
  roomId: string;
  versionId: string;
  accessToken: string;
}): Promise<PlacementLayerNode[]> {
  const res = await fetch(
    `/api/vibode/room-furniture-placements?roomId=${encodeURIComponent(args.roomId)}&versionId=${encodeURIComponent(args.versionId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.accessToken}`,
      },
    }
  );
  const payload = (await res.json().catch(() => ({}))) as PlacementLayerListResponse & { error?: unknown };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to load placement nodes (HTTP ${res.status})`;
    throw new Error(message);
  }
  const rows = Array.isArray(payload.nodes) ? payload.nodes : [];
  return rows
    .map((row) => normalizePlacementLayerNode(row))
    .filter((row): row is PlacementLayerNode => Boolean(row));
}

async function persistSceneRenderStateForVersion(args: {
  roomId: string;
  assetId: string;
  accessToken: string;
  sceneRenderState: {
    renderedPlacementStateHash: string;
    renderedPlacementSnapshot: NormalizedPlacementStateRow[];
    renderedAt: string;
    sourceVersionId: string | null;
  };
}): Promise<Record<string, unknown> | null> {
  const res = await fetch("/api/vibode/room-version-render-state", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      roomId: args.roomId,
      assetId: args.assetId,
      sceneRenderState: args.sceneRenderState,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: unknown; metadata?: unknown };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to persist scene render state (HTTP ${res.status})`;
    throw new Error(message);
  }
  return isRecord(payload.metadata) ? payload.metadata : null;
}

async function persistVersionMetadataPatchForRoom(args: {
  roomId: string;
  assetId: string;
  accessToken: string;
  metadataPatch: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const res = await fetch("/api/vibode/room-version-render-state", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      roomId: args.roomId,
      assetId: args.assetId,
      metadataPatch: args.metadataPatch,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: unknown; metadata?: unknown };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to update room version metadata (HTTP ${res.status})`;
    throw new Error(message);
  }
  return isRecord(payload.metadata) ? payload.metadata : null;
}

async function revertPlacementLayerNodesToSnapshot(args: {
  roomId: string;
  versionId: string;
  accessToken: string;
  snapshot: NormalizedPlacementStateRow[];
}): Promise<PlacementLayerNode[]> {
  const res = await fetch("/api/vibode/room-furniture-placements/revert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      roomId: args.roomId,
      versionId: args.versionId,
      snapshot: args.snapshot,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as PlacementLayerRevertResponse & { error?: unknown };
  if (!res.ok) {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Failed to revert placement nodes (HTTP ${res.status})`;
    throw new Error(message);
  }
  const rows = Array.isArray(payload.nodes) ? payload.nodes : [];
  return rows
    .map((row) => normalizePlacementLayerNode(row))
    .filter((row): row is PlacementLayerNode => Boolean(row));
}

function formatVersionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return VERSION_TIMESTAMP_FORMATTER.format(date);
}

function getVersionSecondaryLabel(asset: VibodeRoomAsset): string {
  if (asset.asset_type !== "stage_output") return "Original upload";
  const stageLabel =
    typeof asset.stage_number === "number" && Number.isFinite(asset.stage_number)
      ? String(asset.stage_number)
      : "?";
  const modelLabel =
    typeof asset.model_version === "string" && asset.model_version.trim().length > 0
      ? asset.model_version
      : "Unknown model";
  return `Stage ${stageLabel} · ${modelLabel}`;
}

async function loadRoomHydrationData(
  roomId: string,
  accessToken: string
): Promise<{ room: VibodeRoomHydrationRow; imageUrl: string | null; versions: VibodeRoomAsset[] }> {
  const client = supabaseBrowser();

  const { data: roomData, error: roomErr } = await client
    .from("vibode_rooms")
    .select("id,selected_model,current_stage,active_asset_id,base_asset_id,metadata")
    .eq("id", roomId)
    .maybeSingle();
  if (roomErr || !roomData) {
    throw new Error(roomErr?.message ?? "Room not found.");
  }

  const room = roomData as VibodeRoomHydrationRow;
  const imageUrl = await fetchPreviewUrlForRoom(room.id, accessToken);
  const versions = await loadRoomVersions(room.id, accessToken);
  return { room, imageUrl, versions };
}

// upload helper (blob preview -> storage signed URL)
async function uploadBaseImageToStorage(opts: {
  file: File;
  sceneId: string;
  selectedModel?: string;
  aspectRatio?: VibodeAspectRatio;
  accessToken: string;
}): Promise<{
  storageKey: string;
  signedUrl: string;
  widthPx?: number;
  heightPx?: number;
  vibodeRoomId?: string;
}> {
  const fd = new FormData();
  fd.set("file", opts.file);
  fd.set("sceneId", opts.sceneId);
  if (opts.selectedModel) {
    fd.set("selectedModel", opts.selectedModel);
  }
  if (opts.aspectRatio) {
    fd.set("aspectRatio", opts.aspectRatio);
  }

  const authorizationHeaderValue = `Bearer ${opts.accessToken}`;
  const authorizationHeaderAttached =
    authorizationHeaderValue.startsWith("Bearer ") && opts.accessToken.length > 0;
  console.debug("[upload-base][auth-diag]", {
    tokenPresent: opts.accessToken.length > 0,
    tokenLength: opts.accessToken.length,
    authorizationHeaderAttached,
  });

  const res = await fetch("/api/vibode/upload-base", {
    method: "POST",
    headers: {
      Authorization: authorizationHeaderValue,
    },
    body: fd,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Upload failed (HTTP ${res.status})`);
  }

  const json = (await res.json()) as {
    storageKey?: string;
    signedUrl?: string;
    widthPx?: number;
    heightPx?: number;
    vibodeRoomId?: string;
  };

  if (!json?.storageKey || !json?.signedUrl) {
    throw new Error("Upload succeeded but missing storageKey/signedUrl");
  }

  return {
    storageKey: json.storageKey,
    signedUrl: json.signedUrl,
    widthPx: json.widthPx,
    heightPx: json.heightPx,
    vibodeRoomId: typeof json.vibodeRoomId === "string" ? json.vibodeRoomId : undefined,
  };
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      img.onload = null;
      img.onerror = null;
      resolve();
    };
    img.onerror = () => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("Failed to preload image."));
    };
    img.src = url;
  });
}

function probeImageAspectRatio(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      img.onload = null;
      img.onerror = null;
      resolve(aspectRatioFromDimensions(img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => {
      img.onload = null;
      img.onerror = null;
      resolve(null);
    };
    img.src = url;
  });
}

function EditorPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRoomId = parseRoomIdFromSearch(
    searchParams.get("roomId") ?? searchParams.get("vibodeRoomId")
  );
  const requestedNewRoomIntent = hasExplicitNewRoomIntent(searchParams);
  const isExplicitBlankEditorIntent = !requestedRoomId && requestedNewRoomIntent;
  const requestedRoomPreviewUrl = parseRoomPreviewUrlFromSearch(
    searchParams.get("roomPreview") ?? searchParams.get("previewUrl")
  );
  const requestedRoomAspectRatio = parseRequestedRoomAspectRatioFromSearch(searchParams);
  const requestedPreviewAspectRatio = parseRequestedPreviewAspectRatioFromSearch(searchParams);
  const requestedInitialFrameAspectRatio = requestedRoomAspectRatio ?? requestedPreviewAspectRatio;
  const [workspaceRecoveryRoomId, setWorkspaceRecoveryRoomId] = useState<string | null>(null);
  const [workspaceRecoveryVersionId, setWorkspaceRecoveryVersionId] = useState<string | null>(null);
  const [workspaceRecoveryFurnitureLayerEnabled, setWorkspaceRecoveryFurnitureLayerEnabled] = useState<
    boolean | null
  >(null);
  const [workspaceRecoveryResolved, setWorkspaceRecoveryResolved] = useState<boolean>(
    Boolean(requestedRoomId || isExplicitBlankEditorIntent)
  );
  const effectiveRequestedRoomId = requestedRoomId ?? workspaceRecoveryRoomId;
  const effectiveRequestedRoomPreviewUrl = requestedRoomId ? requestedRoomPreviewUrl : null;
  const effectiveRequestedInitialFrameAspectRatio = requestedRoomId
    ? requestedInitialFrameAspectRatio
    : null;
  const isWorkspaceRecoveryPending =
    !requestedRoomId && !isExplicitBlankEditorIntent && !workspaceRecoveryResolved;
  const myFurnitureReturnTo = useMemo(() => {
    if (requestedRoomId) {
      return `/editor?roomId=${encodeURIComponent(requestedRoomId)}`;
    }
    return "/editor";
  }, [requestedRoomId]);
  const myFurnitureHref = useMemo(
    () => `/my-furniture?returnTo=${encodeURIComponent(myFurnitureReturnTo)}`,
    [myFurnitureReturnTo]
  );

  const scene = useEditorStore((s) => s.scene);
  const nodes = useEditorStore((s) => s.scene.nodes);
  const viewport = useEditorStore((s) => s.viewport);

  const activeTool = useEditorStore((s) => s.ui.activeTool);
  const selectedSwapMarkId = useEditorStore((s) => s.ui.selectedSwapMarkId);

  const workingSet = useEditorStore((s) => s.workingSet);
  const history = useEditorStore((s) => s.history);
  const versions = useEditorStore((s) => s.versions);
  const activeAssetId = useEditorStore((s) => s.activeAssetId);

  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setRoomDims = useEditorStore((s) => s.setRoomDims);
  const setCollection = useEditorStore((s) => s.setCollection);
  const setWorkingSet = useEditorStore((s) => s.setWorkingSet);
  // legacy mock boundary (keeps UI behavior today)
  const commitGenerateMock = useEditorStore((s) => s.commitGenerateMock);

  // canonical freeze payload writer
  const freezeNowV1 = useEditorStore((s) => s.freezeNowV1);
  const freezeNowV2 = useEditorStore((s) => s.freezeNowV2);

  const setBaseImageFromFile = useEditorStore((s) => s.setBaseImageFromFile);
  const setBaseImageUrl = useEditorStore((s) => s.setBaseImageUrl);
  const setVersions = useEditorStore((s) => s.setVersions);
  const setActiveAssetId = useEditorStore((s) => s.setActiveAssetId);

  const applySwap = useEditorStore((s) => s.applySwap);
  const setPendingSwap = useEditorStore((s) => s.setPendingSwap);
  const selectSwapMark = useEditorStore((s) => s.selectSwapMark);
  const setSwapReplacement = useEditorStore((s) => s.setSwapReplacement);

  // Calibration
  const calibration = useEditorStore((s) => s.scene.calibration);
  const ensurePpfFromAssumption = useEditorStore((s) => s.ensurePpfFromAssumption);

  const beginCalibration = useEditorStore((s) => s.beginCalibration);
  const clearCalibrationDraft = useEditorStore((s) => s.clearCalibrationDraft);
  const setCalibrationRealFeet = useEditorStore((s) => s.setCalibrationRealFeet);
  const finalizeCalibrationFromLine = useEditorStore((s) => s.finalizeCalibrationFromLine);
  const clearCalibrationLine = useEditorStore((s) => s.clearCalibrationLine);

  // Rescale prompt modal (from store UI)
  const rescalePrompt = useEditorStore((s) => s.ui.rescalePrompt);
  const suppressRescalePrompt = useEditorStore((s) => s.ui.suppressRescalePrompt);
  const setSuppressRescalePrompt = useEditorStore((s) => s.setSuppressRescalePrompt);
  const dismissRescalePrompt = useEditorStore((s) => s.dismissRescalePrompt);
  const confirmRescalePrompt = useEditorStore((s) => s.confirmRescalePrompt);

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);
  const [panels, setPanels] = useState<EditorRightPanelsState>(DEFAULT_PANELS_STATE);
  const [versionShelfExpanded, setVersionShelfExpanded] = useState<{
    style: boolean;
    stage: boolean;
    set: boolean;
    unknown: boolean;
  }>({
    style: false,
    stage: false,
    set: false,
    unknown: false,
  });
  const [hasLoadedPanelsFromStorage, setHasLoadedPanelsFromStorage] = useState(false);
  const [isPasteProductImageCollapsed, setIsPasteProductImageCollapsed] = useState(false);
  const [isSetupCollapsed, setIsSetupCollapsed] = useState(false);
  const [isCalibrationCollapsed, setIsCalibrationCollapsed] = useState(false);
  const showObsoleteV0RightPanels = false;
  const [selectedModel, setSelectedModel] = useState<VibodeModelVersion>(VIBODE_MODEL_NBP);
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<VibodeRoomAsset | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [settingBaseImageVersionId, setSettingBaseImageVersionId] = useState<string | null>(null);
  const [togglingFavouriteVersionId, setTogglingFavouriteVersionId] = useState<string | null>(null);
  const [isFavouritesFilterOn, setIsFavouritesFilterOn] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(EDITOR_RIGHT_PANEL_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (isEditorRightPanelsState(parsed)) {
        setPanels(parsed);
      }
    } catch {
      // Ignore storage/parse errors and keep default collapsed panel state.
    } finally {
      setHasLoadedPanelsFromStorage(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedPanelsFromStorage) return;
    try {
      window.localStorage.setItem(EDITOR_RIGHT_PANEL_STATE_KEY, JSON.stringify(panels));
    } catch {
      // Ignore storage write errors.
    }
  }, [hasLoadedPanelsFromStorage, panels]);

  const [snacks, setSnacks] = useState<Snackbar[]>([]);
  const pushSnack = useCallback((message: string) => {
    setSnacks((prev) => [...prev, { id: safeId("sn"), message }]);
  }, []);
  const { visible: tokenBalanceVisible, balance: tokenBalance } = useTokenBalance();
  const isOutOfTokens =
    tokenBalanceVisible && typeof tokenBalance === "number" && Number.isFinite(tokenBalance) && tokenBalance <= 0;
  const notifyTokenBalanceChanged = useCallback(() => {
    window.dispatchEvent(new Event("tokens:changed"));
  }, []);
  const [pasteToPlaceStatus, setPasteToPlaceStatus] = useState<PasteToPlaceStatus | null>(null);
  const [pasteToPlaceMenuState, setPasteToPlaceMenuState] = useState<PasteToPlaceMenuState>(null);
  const [activePasteSource, setActivePasteSource] = useState<ActivePasteSource>(null);
  const activePasteSourceRef = useRef<ActivePasteSource>(null);
  const [pasteToPlaceMenuClipboardPreviewUrl, setPasteToPlaceMenuClipboardPreviewUrl] =
    useState<string | null>(null);
  const [
    isPasteToPlaceMenuClipboardPreviewLoading,
    setIsPasteToPlaceMenuClipboardPreviewLoading,
  ] = useState(false);
  const pasteToPlaceMenuClipboardPreviewTokenRef = useRef(0);
  const lastSurfacedProvisionalClipboardPreviewHashRef = useRef<string | null>(null);
  const suppressedPasteToPlaceMenuClipboardPreviewHashRef = useRef<string | null>(null);
  const [isPasteToPlaceMenuIngesting, setIsPasteToPlaceMenuIngesting] = useState(false);
  const isRefreshingCopiedItemRef = useRef(false);
  const [isRefreshingCopiedItem, setIsRefreshingCopiedItem] = useState(false);
  const [pasteToPlaceProductUrlInput, setPasteToPlaceProductUrlInput] = useState("");
  const [pasteToPlaceUrlCandidatePreview, setPasteToPlaceUrlCandidatePreview] =
    useState<PasteToPlaceUrlCandidatePreview | null>(null);
  const [isPasteToPlaceUrlCandidatePreviewLoading, setIsPasteToPlaceUrlCandidatePreviewLoading] =
    useState(false);
  const pasteToPlaceUrlCandidatePreviewTokenRef = useRef(0);
  const [pasteToPlaceProgressCardState, setPasteToPlaceProgressCardState] =
    useState<PasteToPlaceMenuState>(null);
  const [pasteToPlaceProgressCardPreviewUrl, setPasteToPlaceProgressCardPreviewUrl] =
    useState<string | null>(null);
  const awaitingPasteToPlaceSessionRef = useRef<AwaitingPasteToPlaceSession | null>(null);
  const [awaitingPasteToPlaceSessionUiState, setAwaitingPasteToPlaceSessionUiState] =
    useState<AwaitingPasteToPlaceSession | null>(null);
  const pasteEventClipboardImagePayloadRef = useRef<PasteEventClipboardImagePayload | null>(null);
  const pasteToPlaceOperationIdRef = useRef(0);
  const pendingPasteToPlacePlacementSnapshotRef =
    useRef<PendingPasteToPlacePlacementSnapshot | null>(null);
  const pendingPasteToPlaceCommitRegistryRef = useRef<Map<number, PendingPasteToPlaceCommitContext>>(
    new Map()
  );
  const pasteToPlaceClientSessionIdRef = useRef<string>(safeId("ptp_session"));
  const activePasteToPlaceJobControlRef = useRef<PasteToPlaceJobControl | null>(null);
  const [activePasteToPlaceJobControlUiState, setActivePasteToPlaceJobControlUiState] =
    useState<PasteToPlaceJobControl | null>(null);
  const versionRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const inFlightProductUrlAutosavesRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const pasteToPlaceAbortControllerRef = useRef<AbortController | null>(null);
  const activePasteToPlaceSettlingRequestIdRef = useRef<string | null>(null);
  const pasteToPlaceCancelCooldownTimerRef = useRef<number | null>(null);
  const isPasteToPlaceCancelCooldownActiveRef = useRef(false);
  const stageRunCancelCooldownTimerRef = useRef<number | null>(null);
  const isStageRunCancelCooldownActiveRef = useRef(false);
  const stageRunOperationIdRef = useRef(0);
  const stageRunAbortControllerRef = useRef<AbortController | null>(null);
  const activeStageRunRef = useRef<{
    operationId: number;
    stageNumber: WorkflowStage;
    previousStageStatus: StageRunStatus;
    controller: AbortController;
  } | null>(null);
  const [activeStageRunUiState, setActiveStageRunUiState] = useState<{
    stageNumber: WorkflowStage;
  } | null>(null);
  const [isStageRunSettling, setIsStageRunSettling] = useState(false);
  const [isPasteToPlaceCancelling, setIsPasteToPlaceCancelling] = useState(false);
  const [isPasteToPlaceSettling, setIsPasteToPlaceSettling] = useState(false);
  const lastObservedClipboardDataUrlHashRef = useRef<string | null>(null);
  function getBaseImageLabel(url?: string): string {
    if (!url) return "—";
    try {
      const clean = url.split("?")[0];
      const parts = clean.split("/");
      return parts[parts.length - 1] || clean;
    } catch {
      return url;
    }
  }

  const didLogFirstGenerateAttemptRef = useRef(false);
  const hydratedRoomIdRef = useRef<string | null>(null);
  const roomOpenSessionRef = useRef(0);
  const inFlightRoomHydrationRoomIdRef = useRef<string | null>(null);
  const hasAppliedBlankEditorResetRef = useRef(false);
  const roomPhotoUploadInputRef = useRef<HTMLInputElement | null>(null);
  const roomPhotoCanvasDragDepthRef = useRef(0);

  const [isUploading, setIsUploading] = useState(false);
  const [isOptimizingRoomImage, setIsOptimizingRoomImage] = useState(false);
  const [roomPhotoUploadError, setRoomPhotoUploadError] = useState<string | null>(null);
  const [isRoomHydrating, setIsRoomHydrating] = useState(false);
  const [canvasPresentation, setCanvasPresentation] = useState<CanvasPresentationState>({
    frameAspectRatio: null,
    placeholderImageUrl: null,
    finalImageReady: true,
    isHydratingRoom: false,
    showPlaceholder: false,
  });
  const [isRoomOpenRevealSettling, setIsRoomOpenRevealSettling] = useState(false);
  const roomCanvasHydrationTokenRef = useRef(0);
  const roomCanvasHydrationFadeTimeoutRef = useRef<number | null>(null);
  const roomCanvasHydrationSettleTimeoutRef = useRef<number | null>(null);
  const [roomCanvasHydrationTarget, setRoomCanvasHydrationTarget] =
    useState<RoomCanvasHydrationTarget | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const useFreezeV2 = process.env.NEXT_PUBLIC_VIBODE_FREEZE_V2 === "1";
  const devUnlockPasteToPlaceRaw = process.env.NEXT_PUBLIC_VIBODE_DEV_UNLOCK_PASTE_TO_PLACE;
  const isDevUnlockPasteToPlace =
    devUnlockPasteToPlaceRaw === "1" || devUnlockPasteToPlaceRaw?.toLowerCase() === "true";
  const devSceneRebuildEnabledRaw = process.env.NEXT_PUBLIC_VIBODE_ENABLE_SCENE_REBUILD;
  const isDevSceneRebuildEnabled =
    typeof devSceneRebuildEnabledRaw === "undefined"
      ? true
      : devSceneRebuildEnabledRaw === "1" || devSceneRebuildEnabledRaw.toLowerCase() === "true";
  const isSceneRebuildOverlayEnabled = isDevSceneRebuildEnabled;
  const showDevSceneRebuildButton =
    process.env.NODE_ENV !== "production" && isDevUnlockPasteToPlace && isDevSceneRebuildEnabled;

  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("stage");
  const workflowTabSingleClickTimeoutRef = useRef<number | null>(null);
  const [activeStage, setActiveStage] = useState<WorkflowStage>(1);
  const [stageStatus, setStageStatus] = useState<StageStatusMap>(INITIAL_STAGE_STATUS);
  const [stage4RunningAction, setStage4RunningAction] = useState<Stage4Action | null>(null);
  const [hasFurniturePass, setHasFurniturePass] = useState(false);
  const [lastStageOutputs, setLastStageOutputs] = useState<StageOutputMap>({});
  const [workingImageUrl, setWorkingImageUrl] = useState<string | null>(null);
  const [isWorkingImageGenerated, setIsWorkingImageGenerated] = useState(false);
  const [scenePlacements, setScenePlacements] = useState<ScenePlacement[]>([]);
  const [myFurnitureOpen, setMyFurnitureOpen] = useState(false);
  const [myFurnitureItems, setMyFurnitureItems] = useState<MyFurniturePickerItem[]>([]);
  const [myFurnitureLoading, setMyFurnitureLoading] = useState(false);
  const [myFurnitureMode, setMyFurnitureMode] = useState<MyFurniturePickerMode | null>(null);
  const [myFurnitureSelectingIds, setMyFurnitureSelectingIds] = useState<string[]>([]);
  const [selectedMyFurnitureItemIds, setSelectedMyFurnitureItemIds] = useState<string[]>([]);
  const [isPendingFurnitureSelectionRunning, setIsPendingFurnitureSelectionRunning] = useState(false);
  const [isDevSceneRebuildRunning, setIsDevSceneRebuildRunning] = useState(false);
  const [devSceneRebuildStage, setDevSceneRebuildStage] = useState<"compose" | "persist" | null>(
    null
  );
  const [isDevSceneRebuildComposeWarningVisible, setIsDevSceneRebuildComposeWarningVisible] =
    useState(false);
  const [isRevertingPlacementChanges, setIsRevertingPlacementChanges] = useState(false);
  const [isRestoringOriginalPlacementPositions, setIsRestoringOriginalPlacementPositions] =
    useState(false);
  const [sceneNeedsUpdate, setSceneNeedsUpdate] = useState(false);
  const [canRestoreOriginalPlacementPositions, setCanRestoreOriginalPlacementPositions] =
    useState(false);
  const [devSceneRebuildFeedback, setDevSceneRebuildFeedback] = useState<{
    tone: "success" | "error";
    message: string;
    title?: string;
    helper?: string;
  } | null>(null);
  const sceneRebuildAbortControllerRef = useRef<AbortController | null>(null);
  const sceneRebuildRenderingMessageTimerRef = useRef<number | null>(null);
  const sceneRebuildComposeWarningTimerRef = useRef<number | null>(null);
  const sceneRebuildComposeTimeoutTimerRef = useRef<number | null>(null);
  const sceneRebuildAbortReasonRef = useRef<"user_cancel" | "compose_timeout" | null>(null);
  const [isDevSceneRebuildRenderingMessageVisible, setIsDevSceneRebuildRenderingMessageVisible] =
    useState(false);
  const [pendingMyFurnitureReturnPreviewUrl, setPendingMyFurnitureReturnPreviewUrl] = useState<
    string | null
  >(null);
  const [rotateToolState, setRotateToolState] = useState<RotateToolState>({
    marker: null,
    direction: "cw",
    amountDegrees: 15,
  });
  const [isRotateMarkerTargeting, setIsRotateMarkerTargeting] = useState(false);
  const [, setEditWarning] = useState<string | null>(null);
  const [isEditRunning, setIsEditRunning] = useState(false);
  const [removeMarkerPosition, setRemoveMarkerPosition] = useState<PasteToPlaceClickHint | null>(null);
  const [isRemoveMarkerTargeting, setIsRemoveMarkerTargeting] = useState(false);
  const [isRemoveModeEnabled, setIsRemoveModeEnabled] = useState(false);
  const [isRemoveModeReadingObjects, setIsRemoveModeReadingObjects] = useState(false);
  const [isSetGeometryPrewarming, setIsSetGeometryPrewarming] = useState(false);
  const [removeModeError, setRemoveModeError] = useState<string | null>(null);
  const [removeModeObjects, setRemoveModeObjects] = useState<DetectedRoomObjectLabel[]>([]);
  const [selectedRemoveObjectKeys, setSelectedRemoveObjectKeys] = useState<string[]>([]);
  const [removeModeManualMarkers, setRemoveModeManualMarkers] = useState<RemoveModeManualMarker[]>([]);
  const [removeModeObjectTargetOverrides, setRemoveModeObjectTargetOverrides] = useState<
    Record<string, RemoveModeTargetOverride>
  >({});
  const [removeModeGuidanceImageDataUrl, setRemoveModeGuidanceImageDataUrl] = useState<string | null>(null);
  const [removeModeGuidanceManifest, setRemoveModeGuidanceManifest] =
    useState<RemoveModeGuidanceManifest | null>(null);
  const [removeModeGuidancePromptText, setRemoveModeGuidancePromptText] = useState<string>("");
  const [removeModeGuidancePreparedSignature, setRemoveModeGuidancePreparedSignature] = useState<string>("");
  const [isPreparingRemoveGuidanceImage, setIsPreparingRemoveGuidanceImage] = useState(false);
  const [, setRemoveModeGuidanceError] = useState<string | null>(null);
  const [, setRemoveModeGuidanceTargetCount] = useState(0);
  const [detectedRoomObjectLabels, setDetectedRoomObjectLabels] = useState<DetectedRoomObjectLabel[]>(
    []
  );
  const [placementLayerNodes, setPlacementLayerNodes] = useState<PlacementLayerNode[]>([]);
  const [placementLayerDragState, setPlacementLayerDragState] = useState<PlacementLayerDragState | null>(
    null
  );
  const placementLayerNodesRef = useRef<PlacementLayerNode[]>([]);
  const [isFurnitureLayerEnabled, setIsFurnitureLayerEnabled] = useState(false);
  const [hasLoadedFurnitureLayerVisibilityFromStorage, setHasLoadedFurnitureLayerVisibilityFromStorage] =
    useState(false);
  const toggleFurnitureLayer = useCallback(() => {
    setIsFurnitureLayerEnabled((prev) => !prev);
  }, []);
  const isEditorKeyboardShortcutBlocked = swapOpen || swapPickerOpen || myFurnitureOpen;
  const [selectedRemoveLabel, setSelectedRemoveLabel] = useState<string>(REMOVE_LABEL_PLACEHOLDER);
  const roomReadByImageKeyRef = useRef<Map<string, DetectedRoomObjectLabel[]>>(new Map());
  const roomReadInFlightKeysRef = useRef<Set<string>>(new Set());
  const roomReadSkipLogKeysRef = useRef<Set<string>>(new Set());
  const placementLayerHydratedScopeKeyRef = useRef<string | null>(null);
  const placementLayerInFlightScopeKeyRef = useRef<string | null>(null);
  const sceneDirtyLocallyConfirmedRef = useRef(false);
  // TODO(vibode-entitlements): replace this local free-gate stub with server entitlements.
  const [hasUsedFreePasteToPlace, setHasUsedFreePasteToPlace] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(FREE_PASTE_TO_PLACE_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });
  const canUseFreePasteToPlace = isDevUnlockPasteToPlace || !hasUsedFreePasteToPlace;
  const [hasShownPasteToPlaceClipboardHeadsUp, setHasShownPasteToPlaceClipboardHeadsUp] = useState(
    () => {
      if (typeof window === "undefined") return false;
      try {
        return window.sessionStorage.getItem(PASTE_TO_PLACE_CLIPBOARD_HEADS_UP_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    }
  );
  const lastPasteToPlaceClipboardSnackAtRef = useRef(0);
  const placementNodeCreateGuardByOperationRef = useRef<Map<number, "in_flight" | "done">>(
    new Map()
  );
  const invalidatePasteToPlaceOperation = useCallback(() => {
    pasteToPlaceOperationIdRef.current += 1;
  }, []);
  const beginPasteToPlaceOperation = useCallback(() => {
    const nextOperationId = pasteToPlaceOperationIdRef.current + 1;
    pasteToPlaceOperationIdRef.current = nextOperationId;
    return nextOperationId;
  }, []);
  const isPasteToPlaceOperationActive = useCallback(
    (operationId: number) => pasteToPlaceOperationIdRef.current === operationId,
    []
  );
  const getPendingPasteToPlaceCommitContext = useCallback((operationId: number) => {
    return pendingPasteToPlaceCommitRegistryRef.current.get(operationId) ?? null;
  }, []);
  const isPendingPasteToPlaceCommitOperationActive = useCallback(
    (operationId: number) => pendingPasteToPlaceCommitRegistryRef.current.has(operationId),
    []
  );
  const getPendingPasteToPlaceCommitCount = useCallback(
    () => pendingPasteToPlaceCommitRegistryRef.current.size,
    []
  );
  const canStartPasteToPlaceCommit = useCallback(
    (args: {
      mode: PendingPasteToPlacePlacementSnapshot["mode"];
      pendingCount: number;
      sourceType?: NonNullable<ActivePasteSource>["type"];
    }): boolean => {
      if (args.pendingCount <= 0) return true;
      if (args.pendingCount >= 2) return false;
      if (args.mode !== "place_here") return false;
      if (typeof args.sourceType === "undefined") return true;
      return args.sourceType === "clipboard";
    },
    []
  );
  const getPendingPasteToPlacePlacementSnapshotForOperation = useCallback(
    (operationId: number): PendingPasteToPlacePlacementSnapshot | null => {
      const contextSnapshot = getPendingPasteToPlaceCommitContext(operationId)?.snapshot ?? null;
      if (contextSnapshot) return contextSnapshot;
      const mirroredSnapshot = pendingPasteToPlacePlacementSnapshotRef.current;
      return mirroredSnapshot?.operationId === operationId ? mirroredSnapshot : null;
    },
    [getPendingPasteToPlaceCommitContext]
  );
  const registerPendingPasteToPlaceCommitContext = useCallback(
    ({
      snapshot,
      pasteToPlaceControl,
      abortController,
      progressAnchor,
    }: {
      snapshot: PendingPasteToPlacePlacementSnapshot;
      pasteToPlaceControl?: PasteToPlaceJobControl | null;
      abortController?: AbortController | null;
      progressAnchor: Readonly<NonNullable<PasteToPlaceMenuState>>;
    }): PendingPasteToPlaceCommitContext => {
      const now = Date.now();
      const nextContext = Object.freeze({
        operationId: snapshot.operationId,
        snapshot,
        pasteToPlaceControl: pasteToPlaceControl ?? snapshot.pasteToPlaceControl ?? null,
        abortController: abortController ?? null,
        progressAnchor,
        registeredAtMs: now,
        updatedAtMs: now,
      });
      pendingPasteToPlaceCommitRegistryRef.current.set(snapshot.operationId, nextContext);
      // Phase 6A compatibility mirror: singleton snapshot ref remains source for unchanged paths.
      pendingPasteToPlacePlacementSnapshotRef.current = snapshot;
      return nextContext;
    },
    []
  );
  const updatePendingPasteToPlaceCommitContext = useCallback(
    (
      operationId: number,
      updates: Partial<
        Pick<
          PendingPasteToPlaceCommitContext,
          "pasteToPlaceControl" | "abortController" | "progressAnchor"
        >
      >
    ) => {
      const existingContext = pendingPasteToPlaceCommitRegistryRef.current.get(operationId);
      if (!existingContext) return;
      const nextContext = Object.freeze({
        ...existingContext,
        ...updates,
        updatedAtMs: Date.now(),
      });
      pendingPasteToPlaceCommitRegistryRef.current.set(operationId, nextContext);
    },
    []
  );
  const clearPendingPasteToPlaceCommitContext = useCallback((operationId?: number) => {
    if (typeof operationId === "number") {
      pendingPasteToPlaceCommitRegistryRef.current.delete(operationId);
      if (pendingPasteToPlacePlacementSnapshotRef.current?.operationId === operationId) {
        pendingPasteToPlacePlacementSnapshotRef.current = null;
      }
      return;
    }
    pendingPasteToPlaceCommitRegistryRef.current.clear();
    pendingPasteToPlacePlacementSnapshotRef.current = null;
  }, []);
  const setAwaitingPasteToPlaceSession = useCallback((session: AwaitingPasteToPlaceSession | null) => {
    awaitingPasteToPlaceSessionRef.current = session;
    setAwaitingPasteToPlaceSessionUiState(session);
  }, []);
  const clearPasteEventClipboardImagePayload = useCallback((operationId?: number) => {
    const currentPayload = pasteEventClipboardImagePayloadRef.current;
    if (typeof operationId === "number" && currentPayload?.operationId !== operationId) return;
    pasteEventClipboardImagePayloadRef.current = null;
  }, []);
  const clearAwaitingPasteToPlaceSession = useCallback(
    (operationId?: number) => {
      const currentSession = awaitingPasteToPlaceSessionRef.current;
      if (typeof operationId === "number" && currentSession?.operationId !== operationId) return;
      awaitingPasteToPlaceSessionRef.current = null;
      setAwaitingPasteToPlaceSessionUiState(null);
      clearPasteEventClipboardImagePayload(operationId);
    },
    [clearPasteEventClipboardImagePayload]
  );
  const invalidateStageRunOperation = useCallback(() => {
    stageRunOperationIdRef.current += 1;
  }, []);
  const beginStageRunOperation = useCallback(
    (stageNumber: WorkflowStage, previousStageStatus: StageRunStatus) => {
      stageRunAbortControllerRef.current?.abort();
      const controller = new AbortController();
      stageRunAbortControllerRef.current = controller;
      const nextOperationId = stageRunOperationIdRef.current + 1;
      stageRunOperationIdRef.current = nextOperationId;
      activeStageRunRef.current = {
        operationId: nextOperationId,
        stageNumber,
        previousStageStatus,
        controller,
      };
      setActiveStageRunUiState({ stageNumber });
      return {
        operationId: nextOperationId,
        controller,
      };
    },
    []
  );
  const isStageRunOperationActive = useCallback(
    (operationId: number) => stageRunOperationIdRef.current === operationId,
    []
  );
  const clearStageRunOperation = useCallback((operationId: number, controller: AbortController) => {
    const activeRun = activeStageRunRef.current;
    if (!activeRun) return;
    if (activeRun.operationId !== operationId) return;
    if (activeRun.controller !== controller) return;
    activeStageRunRef.current = null;
    setActiveStageRunUiState(null);
    if (stageRunAbortControllerRef.current === controller) {
      stageRunAbortControllerRef.current = null;
    }
  }, []);
  const markStageRunSettling = useCallback((reason: string) => {
    console.info("[Stage-run][settling] settling set true", { reason });
    setIsStageRunSettling(true);
  }, []);
  const clearStageRunCancelCooldownTimer = useCallback(() => {
    if (stageRunCancelCooldownTimerRef.current === null) return;
    window.clearTimeout(stageRunCancelCooldownTimerRef.current);
    stageRunCancelCooldownTimerRef.current = null;
  }, []);
  const clearStageRunSettling = useCallback(() => {
    if (isStageRunCancelCooldownActiveRef.current) return;
    setIsStageRunSettling(false);
  }, []);
  const startStageRunCancelCooldown = useCallback(
    (reason: string) => {
      markStageRunSettling(reason);
      isStageRunCancelCooldownActiveRef.current = true;
      clearStageRunCancelCooldownTimer();
      stageRunCancelCooldownTimerRef.current = window.setTimeout(() => {
        isStageRunCancelCooldownActiveRef.current = false;
        stageRunCancelCooldownTimerRef.current = null;
        setIsStageRunSettling(false);
        console.info("[Stage-run][settling] stage cancel cooldown complete");
      }, STAGE_RUN_CANCEL_SETTLE_MS);
      console.info("[Stage-run][settling] stage cancel cooldown started", {
        reason,
        cooldownMs: STAGE_RUN_CANCEL_SETTLE_MS,
      });
    },
    [clearStageRunCancelCooldownTimer, markStageRunSettling]
  );
  const cancelStageRunGeneration = useCallback(() => {
    const activeRun = activeStageRunRef.current;
    if (!activeRun) return;
    activeRun.controller.abort();
    startStageRunCancelCooldown("cancel");
    if (stageRunAbortControllerRef.current === activeRun.controller) {
      stageRunAbortControllerRef.current = null;
    }
    activeStageRunRef.current = null;
    setActiveStageRunUiState(null);
    invalidateStageRunOperation();
    setStageStatus((prev) => ({ ...prev, [activeRun.stageNumber]: activeRun.previousStageStatus }));
    if (activeRun.stageNumber === 4) {
      setStage4RunningAction(null);
    }
    pushSnack("Generation cancelled.");
  }, [invalidateStageRunOperation, pushSnack, startStageRunCancelCooldown]);
  const markPasteToPlaceClipboardHeadsUpShown = useCallback(() => {
    setHasShownPasteToPlaceClipboardHeadsUp(true);
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(PASTE_TO_PLACE_CLIPBOARD_HEADS_UP_SESSION_KEY, "1");
    } catch {
      // no-op
    }
  }, []);
  const [stage1Enhance, setStage1Enhance] = useState(true);
  const [stage1Declutter, setStage1Declutter] = useState<DeclutterMode>("off");
  const [stage2Repair, setStage2Repair] = useState(false);
  const [stage2Repaint, setStage2Repaint] = useState(false);
  const [stage2Flooring, setStage2Flooring] = useState<"none" | "carpet" | "hardwood" | "tile">(
    "none"
  );
  const [productImageUrl, setProductImageUrl] = useState("");
  const [productLabel, setProductLabel] = useState("User Upload");
  const [uploadedImageDataUrl, setUploadedImageDataUrl] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestedUserSku, setIngestedUserSku] = useState<UserSku | null>(null);
  const [userSkusAddedToStage3, setUserSkusAddedToStage3] = useState<UserSku[]>([]);
  const [vibodeRoomId, setVibodeRoomId] = useState<string | null>(null);
  const [roomMetadata, setRoomMetadata] = useState<Record<string, unknown> | null>(null);
  const [stage3SkuItems, setStage3SkuItems] = useState<Stage3SkuItem[]>([]);
  const [stage3ShowCatalog, setStage3ShowCatalog] = useState(false);
  const shouldSkipPendingRestoreRef = useRef<boolean>(hasRoomIdInCurrentLocation());
  const didRestorePendingRef = useRef(false);
  const [roomBaseAssetId, setRoomBaseAssetId] = useState<string | null>(null);
  const requestedRoomIdRef = useRef<string | null>(requestedRoomId);
  const vibodeRoomIdRef = useRef<string | null>(vibodeRoomId);
  const lastStageOutputsRef = useRef<StageOutputMap>(lastStageOutputs);
  const pendingPlacementNodeHydrationRef = useRef<ScenePlacement[] | null>(null);
  const clearLegacyPlacementNodes = useCallback(() => {
    pendingPlacementNodeHydrationRef.current = null;
    useEditorStore.setState((s) => ({
      ...s,
      scene: { ...s.scene, nodes: [] },
      ui: s.ui.selectedNodeId ? { ...s.ui, selectedNodeId: null } : s.ui,
    }));
  }, []);
  const clearTransientInteractionOverlaysAfterImageCommit = useCallback(() => {
    setRemoveMarkerPosition(null);
    setIsRemoveMarkerTargeting(false);
    setRotateToolState((prev) => (prev.marker ? { ...prev, marker: null } : prev));
    setIsRotateMarkerTargeting(false);
    setEditWarning(null);

    setPasteToPlaceStatus(null);
    setPasteToPlaceMenuState(null);
    setPasteToPlaceProgressCardState(null);
    setPasteToPlaceProgressCardPreviewUrl(null);
    setIsPasteToPlaceMenuIngesting(false);
    setIsPasteToPlaceMenuClipboardPreviewLoading(false);
    clearAwaitingPasteToPlaceSession();
    clearPasteEventClipboardImagePayload();
    pasteToPlaceMenuClipboardPreviewTokenRef.current += 1;
    setPasteToPlaceMenuClipboardPreviewUrl(null);
    pasteToPlaceUrlCandidatePreviewTokenRef.current += 1;
    setPasteToPlaceUrlCandidatePreview(null);
    setIsPasteToPlaceUrlCandidatePreviewLoading(false);

    useEditorStore.getState().clearRemoveMarks();
  }, [clearAwaitingPasteToPlaceSession, clearPasteEventClipboardImagePayload]);
  useEffect(() => {
    requestedRoomIdRef.current = requestedRoomId;
  }, [requestedRoomId]);
  useEffect(() => {
    vibodeRoomIdRef.current = vibodeRoomId;
  }, [vibodeRoomId]);
  const createPasteToPlaceJobControl = useCallback(
    (operationId: number): PasteToPlaceJobControl => {
      const scopeRoomPart = vibodeRoomIdRef.current ?? "no_room";
      const scopeId = `${pasteToPlaceClientSessionIdRef.current}:${scopeRoomPart}`;
      return {
        scopeId,
        jobId: `${scopeId}:${operationId}`,
      };
    },
    []
  );
  useEffect(() => {
    lastStageOutputsRef.current = lastStageOutputs;
  }, [lastStageOutputs]);
  useEffect(() => {
    activePasteSourceRef.current = activePasteSource;
  }, [activePasteSource]);
  const setActivePasteSourceWithLifecycle = useCallback(
    ({
      nextSource,
    }: {
      nextSource: ActivePasteSource;
      reason: string;
      requestId?: string | null;
    }) => {
      activePasteSourceRef.current = nextSource;
      setActivePasteSource(nextSource);
    },
    []
  );
  const clearPasteToPlaceActiveSource = useCallback(
    (reason: string) => {
      setActivePasteSourceWithLifecycle({ nextSource: null, reason });
    },
    [setActivePasteSourceWithLifecycle]
  );
  const activatePasteToPlaceSource = useCallback(
    (nextSource: NonNullable<ActivePasteSource>, reason: string, requestId?: string | null) => {
      setActivePasteSourceWithLifecycle({ nextSource, reason, requestId });
    },
    [setActivePasteSourceWithLifecycle]
  );
  const clearPasteToPlaceProgressPreview = useCallback(() => {
    invalidatePasteToPlaceOperation();
    setPasteToPlaceProgressCardState(null);
    setPasteToPlaceProgressCardPreviewUrl(null);
    setIsPasteToPlaceMenuIngesting(false);
  }, [invalidatePasteToPlaceOperation]);
  const beginPasteToPlaceAbortController = useCallback(() => {
    pasteToPlaceAbortControllerRef.current?.abort();
    const controller = new AbortController();
    pasteToPlaceAbortControllerRef.current = controller;
    const pendingOperationId = pendingPasteToPlacePlacementSnapshotRef.current?.operationId;
    if (typeof pendingOperationId === "number") {
      updatePendingPasteToPlaceCommitContext(pendingOperationId, {
        abortController: controller,
      });
    }
    setIsPasteToPlaceCancelling(false);
    return controller;
  }, [updatePendingPasteToPlaceCommitContext]);
  const beginPasteToPlacePlacementOperation = useCallback(() => {
    pasteToPlaceAbortControllerRef.current?.abort();
    pasteToPlaceAbortControllerRef.current = null;
    setIsPasteToPlaceCancelling(false);
    return beginPasteToPlaceOperation();
  }, [beginPasteToPlaceOperation]);
  const clonePreparedProductForPlacementSnapshot = useCallback(
    (preparedProduct: PreparedProductLike): PreparedProductLike =>
      Object.freeze({
        ...preparedProduct,
        eligibleSkus: preparedProduct.eligibleSkus.map((sku) =>
          Object.freeze({
            ...sku,
            variants: sku.variants.map((variant) => Object.freeze({ ...variant })),
          })
        ),
        sourceMeta: preparedProduct.sourceMeta
          ? Object.freeze({
              ...preparedProduct.sourceMeta,
            })
          : undefined,
      }),
    []
  );
  const cloneActivePasteSourceForPlacementSnapshot = useCallback(
    (source: ActivePasteSource): NonNullable<ActivePasteSource> | null => {
      if (!source) return null;
      if (source.type === "clipboard") {
        return Object.freeze({
          ...source,
          preparedProduct: clonePreparedProductForPlacementSnapshot(source.preparedProduct),
        });
      }
      if (source.type === "my_furniture") {
        return Object.freeze({
          ...source,
          furnitureIds: [...source.furnitureIds],
          selectedPreviewUrls: [...source.selectedPreviewUrls],
          preparedProduct: clonePreparedProductForPlacementSnapshot(source.preparedProduct),
        });
      }
      return Object.freeze({
        ...source,
        preparedProduct: clonePreparedProductForPlacementSnapshot(source.preparedProduct),
      });
    },
    [clonePreparedProductForPlacementSnapshot]
  );
  const clonePasteToPlaceUrlCandidatePreviewForSnapshot = useCallback(
    (candidate: PasteToPlaceUrlCandidatePreview | null): PasteToPlaceUrlCandidatePreview | null => {
      if (!candidate) return null;
      return Object.freeze({ ...candidate });
    },
    []
  );
  const getPasteToPlaceSourcePreviewUrl = useCallback((source: ActivePasteSource): string | null => {
    if (!source) return null;
    if (source.type === "my_furniture") {
      return source.rawPreviewUrl ?? source.normalizedPreviewUrl ?? null;
    }
    return source.normalizedPreviewUrl ?? source.rawPreviewUrl ?? null;
  }, []);
  const getPasteToPlaceProgressCardPreviewUrlFromSnapshot = useCallback(
    (snapshot: PendingPasteToPlacePlacementSnapshot): string | null =>
      snapshot.provisionalClipboardPreviewUrlAtCommit ??
      snapshot.urlCandidatePreviewAtCommit?.previewImageUrl ??
      getPasteToPlaceSourcePreviewUrl(snapshot.sourceAtCommit),
    [getPasteToPlaceSourcePreviewUrl]
  );
  const createPendingPasteToPlacePlacementSnapshot = useCallback(
    (args: {
      operationId: number;
      mode: PendingPasteToPlacePlacementSnapshot["mode"];
      menuStateSnapshot: NonNullable<PasteToPlaceMenuState>;
      pasteToPlaceControl?: PasteToPlaceJobControl;
    }): PendingPasteToPlacePlacementSnapshot => {
      const point = Object.freeze({
        xNorm: args.menuStateSnapshot.xNorm,
        yNorm: args.menuStateSnapshot.yNorm,
        anchorCssX: args.menuStateSnapshot.anchorCssX,
        anchorCssY: args.menuStateSnapshot.anchorCssY,
        anchorX: args.menuStateSnapshot.anchorX,
        anchorY: args.menuStateSnapshot.anchorY,
      });
      const snapshot = Object.freeze({
        operationId: args.operationId,
        committedAtMs: Date.now(),
        mode: args.mode,
        point,
        roomIdAtCommit: vibodeRoomId?.trim() ?? null,
        versionIdAtCommit: activeAssetId?.trim() ?? null,
        sourceAtCommit: cloneActivePasteSourceForPlacementSnapshot(activePasteSourceRef.current),
        provisionalClipboardPreviewUrlAtCommit: pasteToPlaceMenuClipboardPreviewUrl,
        urlCandidatePreviewAtCommit: clonePasteToPlaceUrlCandidatePreviewForSnapshot(
          pasteToPlaceUrlCandidatePreview
        ),
        productUrlInputAtCommit: pasteToPlaceProductUrlInput,
        pasteToPlaceControl: args.pasteToPlaceControl ?? null,
      });
      registerPendingPasteToPlaceCommitContext({
        snapshot,
        pasteToPlaceControl: args.pasteToPlaceControl ?? null,
        progressAnchor: point,
      });
      return snapshot;
    },
    [
      activeAssetId,
      cloneActivePasteSourceForPlacementSnapshot,
      clonePasteToPlaceUrlCandidatePreviewForSnapshot,
      pasteToPlaceMenuClipboardPreviewUrl,
      pasteToPlaceProductUrlInput,
      pasteToPlaceUrlCandidatePreview,
      registerPendingPasteToPlaceCommitContext,
      vibodeRoomId,
    ]
  );
  const clearPendingPasteToPlacePlacementSnapshot = useCallback((operationId?: number) => {
    if (typeof operationId === "number") {
      clearPendingPasteToPlaceCommitContext(operationId);
      return;
    }
    clearPendingPasteToPlaceCommitContext();
  }, [clearPendingPasteToPlaceCommitContext]);
  const clearPasteToPlaceProgressPreviewForOperation = useCallback(
    (operationId?: number) => {
      if (typeof operationId !== "number") {
        clearPasteToPlaceProgressPreview();
        return;
      }
      const mirroredOperationId = pendingPasteToPlacePlacementSnapshotRef.current?.operationId;
      if (mirroredOperationId !== operationId) return;
      setPasteToPlaceProgressCardState(null);
      setPasteToPlaceProgressCardPreviewUrl(null);
      setIsPasteToPlaceMenuIngesting(false);
    },
    [clearPasteToPlaceProgressPreview]
  );
  const beginPasteToPlaceSettlingRequest = useCallback(() => {
    const requestId = safeId("ptp_settle_req");
    activePasteToPlaceSettlingRequestIdRef.current = requestId;
    return requestId;
  }, []);
  const markPasteToPlaceSettling = useCallback((reason: string) => {
    console.info("[Paste-to-Place][settling] settling set true", {
      reason,
      activeRequestId: activePasteToPlaceSettlingRequestIdRef.current,
    });
    setIsPasteToPlaceSettling(true);
  }, []);
  const clearPasteToPlaceCancelCooldownTimer = useCallback(() => {
    if (pasteToPlaceCancelCooldownTimerRef.current === null) return;
    window.clearTimeout(pasteToPlaceCancelCooldownTimerRef.current);
    pasteToPlaceCancelCooldownTimerRef.current = null;
  }, []);
  const startPasteToPlaceCancelCooldown = useCallback(
    (reason: string) => {
      markPasteToPlaceSettling(reason);
      isPasteToPlaceCancelCooldownActiveRef.current = true;
      clearPasteToPlaceCancelCooldownTimer();
      pasteToPlaceCancelCooldownTimerRef.current = window.setTimeout(() => {
        isPasteToPlaceCancelCooldownActiveRef.current = false;
        pasteToPlaceCancelCooldownTimerRef.current = null;
        activePasteToPlaceSettlingRequestIdRef.current = null;
        setIsPasteToPlaceSettling(false);
        console.info("[Paste-to-Place][settling] cancel cooldown complete; settling cleared");
      }, PASTE_TO_PLACE_CANCEL_SETTLE_MS);
      console.info("[Paste-to-Place][settling] cancel cooldown started", {
        reason,
        cooldownMs: PASTE_TO_PLACE_CANCEL_SETTLE_MS,
      });
    },
    [clearPasteToPlaceCancelCooldownTimer, markPasteToPlaceSettling]
  );
  const clearPasteToPlaceSettlingForRequest = useCallback(
    (requestId: string | null | undefined, context: string) => {
      console.info("[Paste-to-Place][settling] settling clear attempted", {
        context,
        requestId,
        activeRequestId: activePasteToPlaceSettlingRequestIdRef.current,
      });
      if (isPasteToPlaceCancelCooldownActiveRef.current) {
        console.info("[Paste-to-Place][settling] settling clear skipped due to cancel cooldown", {
          context,
          requestId,
        });
        return;
      }
      if (!requestId) return;
      if (activePasteToPlaceSettlingRequestIdRef.current !== requestId) return;
      activePasteToPlaceSettlingRequestIdRef.current = null;
      setIsPasteToPlaceSettling(false);
      console.info("[Paste-to-Place][settling] settling cleared", {
        context,
        requestId,
      });
    },
    []
  );
  const isSamePasteToPlaceJobControl = useCallback(
    (left: PasteToPlaceJobControl | null | undefined, right: PasteToPlaceJobControl | null | undefined) =>
      Boolean(
        left &&
          right &&
          left.jobId === right.jobId &&
          left.scopeId === right.scopeId
      ),
    []
  );
  const setActivePasteToPlaceJobControl = useCallback((jobControl: PasteToPlaceJobControl | null) => {
    const pendingOperationId = pendingPasteToPlacePlacementSnapshotRef.current?.operationId;
    if (typeof pendingOperationId === "number") {
      updatePendingPasteToPlaceCommitContext(pendingOperationId, {
        pasteToPlaceControl: jobControl,
      });
    }
    activePasteToPlaceJobControlRef.current = jobControl;
    setActivePasteToPlaceJobControlUiState(jobControl);
  }, [updatePendingPasteToPlaceCommitContext]);
  const clearActivePasteToPlaceJobControlIfMatching = useCallback(
    (jobControl: PasteToPlaceJobControl | null | undefined) => {
      if (!jobControl) return;
      if (isSamePasteToPlaceJobControl(activePasteToPlaceJobControlRef.current, jobControl)) {
        const pendingOperationId = pendingPasteToPlacePlacementSnapshotRef.current?.operationId;
        if (typeof pendingOperationId === "number") {
          updatePendingPasteToPlaceCommitContext(pendingOperationId, {
            pasteToPlaceControl: null,
          });
        }
        activePasteToPlaceJobControlRef.current = null;
      }
      setActivePasteToPlaceJobControlUiState((currentJobControl) =>
        isSamePasteToPlaceJobControl(currentJobControl, jobControl) ? null : currentJobControl
      );
    },
    [isSamePasteToPlaceJobControl, updatePendingPasteToPlaceCommitContext]
  );
  const finalizePasteToPlaceCommitOperation = useCallback(
    ({
      operationId,
      pasteToPlaceControl,
      clearUi = false,
    }: {
      operationId?: number;
      pasteToPlaceControl?: PasteToPlaceJobControl | null;
      clearUi?: boolean;
    }) => {
      if (clearUi) {
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreviewForOperation(operationId);
      }
      clearActivePasteToPlaceJobControlIfMatching(pasteToPlaceControl);
      clearPendingPasteToPlacePlacementSnapshot(operationId);
    },
    [
      clearActivePasteToPlaceJobControlIfMatching,
      clearPendingPasteToPlacePlacementSnapshot,
      clearPasteToPlaceProgressPreviewForOperation,
    ]
  );
  const hasPendingPasteToPlaceCommit = useCallback(
    () =>
      Boolean(
        getPendingPasteToPlaceCommitCount() > 0 ||
        activePasteToPlaceJobControlRef.current || activePasteToPlaceJobControlUiState
      ),
    [activePasteToPlaceJobControlUiState, getPendingPasteToPlaceCommitCount]
  );
  const clearPasteToPlaceAbortController = useCallback((controller?: AbortController | null) => {
    if (!controller) {
      const pendingOperationId = pendingPasteToPlacePlacementSnapshotRef.current?.operationId;
      if (typeof pendingOperationId === "number") {
        updatePendingPasteToPlaceCommitContext(pendingOperationId, {
          abortController: null,
        });
      }
      pasteToPlaceAbortControllerRef.current = null;
      setIsPasteToPlaceCancelling(false);
      return;
    }
    if (pasteToPlaceAbortControllerRef.current === controller) {
      const pendingOperationId = pendingPasteToPlacePlacementSnapshotRef.current?.operationId;
      if (typeof pendingOperationId === "number") {
        updatePendingPasteToPlaceCommitContext(pendingOperationId, {
          abortController: null,
        });
      }
      pasteToPlaceAbortControllerRef.current = null;
      setIsPasteToPlaceCancelling(false);
    }
  }, [updatePendingPasteToPlaceCommitContext]);
  const cancelPasteToPlaceGeneration = useCallback(() => {
    if (isPasteToPlaceCancelling) return;
    setIsPasteToPlaceCancelling(true);
    startPasteToPlaceCancelCooldown("cancel");
    const activeJobControl =
      activePasteToPlaceJobControlUiState ?? activePasteToPlaceJobControlRef.current;
    if (activeJobControl) {
      console.info("[Paste-to-Place] cancel clicked", activeJobControl.jobId);
      void (async () => {
        try {
          const buildCancelHeaders = (accessToken: string | null) => ({
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          });
          const dispatchCancelRequest = (accessToken: string | null) =>
            fetch("/api/vibode/paste-to-place/cancel", {
              method: "POST",
              headers: buildCancelHeaders(accessToken),
              body: JSON.stringify(activeJobControl),
            });
          const canCancelWithCookieSessionAuth = false;
          console.info("[Paste-to-Place] cancel auth start");
          const cachedAccessToken = lastKnownSupabaseAccessToken;

          if (cachedAccessToken) {
            console.info("[Paste-to-Place] cancel auth ready");
            const cancelRequest = dispatchCancelRequest(cachedAccessToken);
            console.info("[Paste-to-Place] cancel request dispatched", activeJobControl.jobId);
            clearActivePasteToPlaceJobControlIfMatching(activeJobControl);
            await cancelRequest;
            return;
          }

          const accessToken = await tryGetSupabaseAccessToken();
          console.info("[Paste-to-Place] cancel auth ready");
          if (!accessToken && canCancelWithCookieSessionAuth) {
            const cancelRequest = dispatchCancelRequest(null);
            console.info("[Paste-to-Place] cancel request dispatched", activeJobControl.jobId);
            clearActivePasteToPlaceJobControlIfMatching(activeJobControl);
            await cancelRequest;
            return;
          }
          if (!accessToken) {
            return;
          }
          const cancelRequest = fetch("/api/vibode/paste-to-place/cancel", {
            method: "POST",
            headers: buildCancelHeaders(accessToken),
            body: JSON.stringify(activeJobControl),
          });
          console.info("[Paste-to-Place] cancel request dispatched", activeJobControl.jobId);
          clearActivePasteToPlaceJobControlIfMatching(activeJobControl);
          await cancelRequest;
        } catch {
          // Best-effort only: UI cancellation remains immediate even if backend cancel fails.
        }
      })();
    }
    pasteToPlaceAbortControllerRef.current?.abort();
    pasteToPlaceAbortControllerRef.current = null;
    invalidatePasteToPlaceOperation();
    setPasteToPlaceStatus(null);
    clearPasteToPlaceProgressPreview();
    setPasteToPlaceMenuState(null);
    clearPendingPasteToPlacePlacementSnapshot();
    clearAwaitingPasteToPlaceSession();
    clearPasteEventClipboardImagePayload();
    pushSnack("Generation cancelled.");
    setIsPasteToPlaceCancelling(false);
  }, [
    clearAwaitingPasteToPlaceSession,
    clearPasteEventClipboardImagePayload,
    startPasteToPlaceCancelCooldown,
    clearPasteToPlaceProgressPreview,
    clearPendingPasteToPlacePlacementSnapshot,
    clearActivePasteToPlaceJobControlIfMatching,
    invalidatePasteToPlaceOperation,
    isPasteToPlaceCancelling,
    pushSnack,
    activePasteToPlaceJobControlUiState,
  ]);
  const clearPasteToPlaceMenuClipboardPreview = useCallback(() => {
    pasteToPlaceMenuClipboardPreviewTokenRef.current += 1;
    setPasteToPlaceMenuClipboardPreviewUrl(null);
    setIsPasteToPlaceMenuClipboardPreviewLoading(false);
  }, []);
  const clearPasteToPlaceUrlCandidatePreview = useCallback(() => {
    pasteToPlaceUrlCandidatePreviewTokenRef.current += 1;
    setPasteToPlaceUrlCandidatePreview(null);
    setIsPasteToPlaceUrlCandidatePreviewLoading(false);
  }, []);
  const handlePasteToPlaceProductUrlInputChange = useCallback(
    (nextValue: string) => {
      setPasteToPlaceProductUrlInput(nextValue);
      const normalizedNextValue = normalizeLikelyUrl(nextValue);
      setPasteToPlaceUrlCandidatePreview((currentCandidate) => {
        if (!currentCandidate) return currentCandidate;
        if (!normalizedNextValue || currentCandidate.normalizedUrl !== normalizedNextValue) {
          return null;
        }
        return currentCandidate;
      });
    },
    []
  );
  const readClipboardTextWithStatus = useCallback(async (): Promise<{
    text: string | null;
    status: "ok" | "access-unavailable" | "failed";
  }> => {
    if (typeof navigator === "undefined") return { text: null, status: "access-unavailable" };
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      return { text: null, status: "access-unavailable" };
    }
    try {
      const text = await navigator.clipboard.readText();
      return {
        text: typeof text === "string" ? text : null,
        status: "ok",
      };
    } catch {
      return { text: null, status: "failed" };
    }
  }, []);
  const requestPasteToPlaceUrlCandidatePreview = useCallback(
    async ({
      sourceUrl,
      operationId,
      showFailureSnack = true,
    }: {
      sourceUrl: string;
      operationId?: number;
      showFailureSnack?: boolean;
    }): Promise<PasteToPlaceUrlCandidatePreview | null> => {
      const classified = classifyPasteToPlaceUrl(sourceUrl);
      if (!classified) {
        setPasteToPlaceUrlCandidatePreview(null);
        return null;
      }
      const previewToken = pasteToPlaceUrlCandidatePreviewTokenRef.current + 1;
      pasteToPlaceUrlCandidatePreviewTokenRef.current = previewToken;
      setIsPasteToPlaceUrlCandidatePreviewLoading(true);
      try {
        if (classified.kind === "direct_image_url") {
          const normalizedUrl = classified.normalizedUrl;
          const canLoadImage = await new Promise<boolean>((resolve) => {
            const image = new Image();
            let settled = false;
            const complete = (ok: boolean) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeoutId);
              image.onload = null;
              image.onerror = null;
              resolve(ok);
            };
            const timeoutId = window.setTimeout(() => complete(false), 7000);
            image.onload = () => complete(true);
            image.onerror = () => complete(false);
            image.src = normalizedUrl;
          });
          if (previewToken !== pasteToPlaceUrlCandidatePreviewTokenRef.current) return null;
          if (typeof operationId === "number" && !isPasteToPlaceOperationActive(operationId)) return null;
          if (!canLoadImage) {
            setPasteToPlaceUrlCandidatePreview(null);
            if (showFailureSnack) {
              pushSnack("We couldn't load that copied image address. Try copying the product image instead.");
            }
            return null;
          }
          setPasteToPlaceProductUrlInput(normalizedUrl);
          setPendingMyFurnitureReturnPreviewUrl(null);
          const candidate: PasteToPlaceUrlCandidatePreview = {
            kind: "direct_image_url",
            sourceUrl: normalizedUrl,
            normalizedUrl,
            previewImageUrl: normalizedUrl,
            title: null,
            domain: getDomainFromUrl(normalizedUrl),
            operationId: typeof operationId === "number" ? operationId : pasteToPlaceOperationIdRef.current,
          };
          setPasteToPlaceUrlCandidatePreview(candidate);
          return candidate;
        }

        const normalizedUrl = classified.normalizedUrl;
        const res = await fetch("/api/vibode/product-url/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceUrl: normalizedUrl,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: unknown;
          normalizedUrl?: unknown;
          title?: unknown;
          previewImageUrl?: unknown;
          domain?: unknown;
        };
        if (previewToken !== pasteToPlaceUrlCandidatePreviewTokenRef.current) return null;
        if (typeof operationId === "number" && !isPasteToPlaceOperationActive(operationId)) return null;
        if (!res.ok || payload.ok !== true) {
          setPasteToPlaceUrlCandidatePreview(null);
          if (showFailureSnack) {
            pushSnack("We couldn't prepare that product link. Try copying the product image instead.");
          }
          return null;
        }
        const normalizedPayloadUrl =
          typeof payload.normalizedUrl === "string" && payload.normalizedUrl.trim().length > 0
            ? payload.normalizedUrl.trim()
            : normalizedUrl;
        const previewImageUrl =
          typeof payload.previewImageUrl === "string" && payload.previewImageUrl.trim().length > 0
            ? payload.previewImageUrl.trim()
            : null;
        if (!previewImageUrl) {
          setPasteToPlaceUrlCandidatePreview(null);
          if (showFailureSnack) {
            pushSnack("We couldn't prepare that product link. Try copying the product image instead.");
          }
          return null;
        }
        setPasteToPlaceProductUrlInput(normalizedPayloadUrl);
        setPendingMyFurnitureReturnPreviewUrl(null);
        const candidate: PasteToPlaceUrlCandidatePreview = {
          kind: "product_page_url",
          sourceUrl: normalizedPayloadUrl,
          normalizedUrl: normalizedPayloadUrl,
          previewImageUrl,
          title:
            typeof payload.title === "string" && payload.title.trim().length > 0
              ? payload.title.trim()
              : null,
          domain:
            typeof payload.domain === "string" && payload.domain.trim().length > 0
              ? payload.domain.trim()
              : null,
          operationId: typeof operationId === "number" ? operationId : pasteToPlaceOperationIdRef.current,
        };
        setPasteToPlaceUrlCandidatePreview(candidate);
        return candidate;
      } catch {
        if (previewToken !== pasteToPlaceUrlCandidatePreviewTokenRef.current) return null;
        if (typeof operationId === "number" && !isPasteToPlaceOperationActive(operationId)) return null;
        setPasteToPlaceUrlCandidatePreview(null);
        if (showFailureSnack) {
          pushSnack("We couldn't prepare that product link. Try copying the product image instead.");
        }
        return null;
      } finally {
        if (previewToken === pasteToPlaceUrlCandidatePreviewTokenRef.current) {
          setIsPasteToPlaceUrlCandidatePreviewLoading(false);
        }
      }
    },
    [isPasteToPlaceOperationActive, pushSnack]
  );

  const currentAspectRatioForUpload: VibodeAspectRatio = useMemo(() => {
    const width = scene.baseImageWidthPx;
    const height = scene.baseImageHeightPx;
    if (!isFiniteNumber(width) || !isFiniteNumber(height) || Number(height) <= 0) return "auto";
    const ratio = Number(width) / Number(height);
    const candidates: Array<{ label: Exclude<VibodeAspectRatio, "auto">; value: number }> = [
      { label: "4:3", value: 4 / 3 },
      { label: "3:2", value: 3 / 2 },
      { label: "16:9", value: 16 / 9 },
      { label: "1:1", value: 1 },
    ];
    let best: Exclude<VibodeAspectRatio, "auto"> = "4:3";
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const delta = Math.abs(ratio - candidate.value);
      if (delta < bestDelta) {
        best = candidate.label;
        bestDelta = delta;
      }
    }
    return best;
  }, [scene.baseImageHeightPx, scene.baseImageWidthPx]);

  const resetWorkflowForIncomingImage = useCallback(() => {
    const store = useEditorStore.getState();
    setHasFurniturePass(false);
    setStageStatus(INITIAL_STAGE_STATUS);
    setStage4RunningAction(null);
    setLastStageOutputs((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    setWorkingImageUrl(null);
    setIsWorkingImageGenerated(false);
    setSceneNeedsUpdate(false);
    pendingPlacementNodeHydrationRef.current = null;
    store.resetSessionForIncomingImage();
    setScenePlacements([]);
    setMyFurnitureOpen(false);
    setMyFurnitureMode(null);
    setMyFurnitureItems([]);
    setMyFurnitureLoading(false);
    setMyFurnitureSelectingIds([]);
    setSelectedMyFurnitureItemIds([]);
    setRotateToolState({
      marker: null,
      direction: "cw",
      amountDegrees: 15,
    });
    setIsRotateMarkerTargeting(false);
    setEditWarning(null);
    setIsEditRunning(false);
    setProductImageUrl("");
    setProductLabel("User Upload");
    setUploadedImageDataUrl(null);
    setUploadedImageName(null);
    setIsIngesting(false);
    setIngestError(null);
    setIngestedUserSku(null);
    setUserSkusAddedToStage3([]);
    setStage3SkuItems([]);
    setStage3ShowCatalog(false);
    setPendingMyFurnitureReturnPreviewUrl(null);
    clearPasteToPlaceProgressPreview();
    clearPasteToPlaceMenuClipboardPreview();
    clearPasteToPlaceUrlCandidatePreview();
    clearAwaitingPasteToPlaceSession();
    clearPasteEventClipboardImagePayload();
    clearPasteToPlaceActiveSource("workflow_reset");
    lastObservedClipboardDataUrlHashRef.current = null;
    lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
    suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
    setPendingFurnitureClipboardSuppressionHash(null);
    setActiveStage(1);
    setVibodeRoomId(null);
    setRoomMetadata(null);
    setRoomBaseAssetId(null);
    clearPendingLocal();
  }, [
    clearPasteToPlaceActiveSource,
    clearAwaitingPasteToPlaceSession,
    clearPasteEventClipboardImagePayload,
    clearPasteToPlaceMenuClipboardPreview,
    clearPasteToPlaceUrlCandidatePreview,
    clearPasteToPlaceProgressPreview,
    setSceneNeedsUpdate,
  ]);

  const refreshRoomVersions = useCallback(
    async (roomId: string): Promise<VibodeRoomAsset[] | null> => {
      try {
        let accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          accessToken = await tryGetSupabaseAccessToken();
        }
        if (!accessToken) {
          throw new Error("No Supabase session.");
        }

        const latestVersions = await loadRoomVersions(roomId, accessToken);
        setVersions(latestVersions);
        setActiveAssetId(latestVersions.find((asset) => asset.is_active)?.id ?? null);
        return latestVersions;
      } catch (err) {
        console.warn("[editor] failed to refresh room versions:", err);
        return null;
      }
    },
    [setActiveAssetId, setVersions]
  );

  const trackMyFurnitureUsage = useCallback(
    async (
      userFurnitureId: string,
      eventType: "added" | "swapped"
    ) => {
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) return;
        const res = await fetch("/api/vibode/my-furniture/track", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            userFurnitureId,
            eventType,
            roomId: vibodeRoomId,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error || `Track request failed (HTTP ${res.status})`);
        }
      } catch (err) {
        console.warn("[editor] failed to track My Furniture usage:", err);
      }
    },
    [vibodeRoomId]
  );

  const openMyFurniturePicker = useCallback(
    async (mode: MyFurniturePickerMode) => {
      setMyFurnitureMode(mode);
      setMyFurnitureOpen(true);
      setMyFurnitureLoading(true);
      setMyFurnitureSelectingIds([]);
      setSelectedMyFurnitureItemIds([]);
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          throw new Error("No Supabase session.");
        }
        const res = await fetch("/api/vibode/my-furniture/list", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          items?: MyFurnitureListApiItem[];
        };
        if (!res.ok) {
          throw new Error(json.error || `Failed to load My Furniture (HTTP ${res.status})`);
        }
        const items = Array.isArray(json.items) ? json.items : [];
        setMyFurnitureItems(
          items.map((item) => ({
            id: item.id,
            userSkuId: item.user_sku_id,
            displayName: item.display_name,
            previewImageUrl: item.preview_image_url,
            sourceUrl: item.source_url,
            category: item.category,
            timesUsed: Number(item.times_used ?? 0),
            lastUsedAt: item.last_used_at,
            createdAt: item.created_at,
          }))
        );
      } catch (err: unknown) {
        setMyFurnitureItems([]);
        const errMessage = getErrorMessage(err);
        const message =
          errMessage === "No Supabase session."
            ? "Please sign in again to open My Furniture."
            : "Couldn't load My Furniture right now. Please try again.";
        pushSnack(message);
      } finally {
        setMyFurnitureLoading(false);
      }
    },
    [pushSnack]
  );

  const resolveMyFurnitureForEdit = useCallback(
    async (id: string): Promise<MyFurnitureResolveResponse | null> => {
      const accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        throw new Error("No Supabase session.");
      }
      const res = await fetch("/api/vibode/my-furniture/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json().catch(() => ({}))) as
        | (MyFurnitureResolveResponse & { error?: never })
        | { error?: string };
      if (!res.ok) {
        throw new Error(("error" in json && json.error) || `Failed to resolve item (HTTP ${res.status})`);
      }
      if (!("eligibleSku" in json) || !json.eligibleSku?.skuId) {
        throw new Error("Saved furniture resolve response is missing eligibleSku.");
      }
      return json as MyFurnitureResolveResponse;
    },
    []
  );

  useEffect(() => {
    const raw = window.localStorage.getItem(VIBODE_MODEL_STORAGE_KEY);
    if (raw === VIBODE_MODEL_NBP || raw === VIBODE_MODEL_NB2) {
      setSelectedModel(raw);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIBODE_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(VIBODE_FURNITURE_LAYER_VISIBILITY_KEY);
      if (raw === "1" || raw === "true") {
        setIsFurnitureLayerEnabled(true);
      } else if (raw === "0" || raw === "false") {
        setIsFurnitureLayerEnabled(false);
      }
    } catch {
      // Ignore storage read failures and keep current default behavior.
    } finally {
      setHasLoadedFurnitureLayerVisibilityFromStorage(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedFurnitureLayerVisibilityFromStorage) return;
    try {
      window.localStorage.setItem(
        VIBODE_FURNITURE_LAYER_VISIBILITY_KEY,
        isFurnitureLayerEnabled ? "1" : "0"
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [hasLoadedFurnitureLayerVisibilityFromStorage, isFurnitureLayerEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (hasUsedFreePasteToPlace) {
        window.sessionStorage.setItem(FREE_PASTE_TO_PLACE_SESSION_KEY, "1");
      } else {
        window.sessionStorage.removeItem(FREE_PASTE_TO_PLACE_SESSION_KEY);
      }
    } catch {
      // Ignore sessionStorage failures; entitlements will replace this gate.
    }
  }, [hasUsedFreePasteToPlace]);

  useEffect(() => {
    if (requestedRoomId) {
      setWorkspaceRecoveryRoomId(null);
      setWorkspaceRecoveryVersionId(null);
      setWorkspaceRecoveryFurnitureLayerEnabled(null);
      setWorkspaceRecoveryResolved(true);
      return;
    }

    const hasExplicitBlankIntentFromLocation =
      typeof window !== "undefined" &&
      hasExplicitNewRoomIntent(new URLSearchParams(window.location.search)) &&
      !hasRoomIdInCurrentLocation();
    if (isExplicitBlankEditorIntent || hasExplicitBlankIntentFromLocation) {
      setWorkspaceRecoveryRoomId(null);
      setWorkspaceRecoveryVersionId(null);
      setWorkspaceRecoveryFurnitureLayerEnabled(null);
      setWorkspaceRecoveryResolved(true);
      clearWorkspaceSnapshot();
      logEditorRecovery("[editor-recovery] explicit blank editor intent, skipped recovery");
      return;
    }

    let cancelled = false;
    setWorkspaceRecoveryResolved(false);

    const runWorkspaceRecovery = async () => {
      let accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        accessToken = await tryGetSupabaseAccessToken();
      }
      if (!accessToken) {
        if (cancelled) return;
        logEditorRecovery("[editor-recovery] no valid room found, showing upload state", {
          reason: "no-access-token",
        });
        setWorkspaceRecoveryRoomId(null);
        setWorkspaceRecoveryVersionId(null);
        setWorkspaceRecoveryFurnitureLayerEnabled(null);
        setWorkspaceRecoveryResolved(true);
        return;
      }

      const snapshot = readWorkspaceSnapshot();
      const now = Date.now();
      const hasFreshSnapshot =
        snapshot && Number.isFinite(snapshot.timestamp) && now - snapshot.timestamp <= VIBODE_EDITOR_WORKSPACE_MAX_AGE_MS;
      if (hasFreshSnapshot) {
        logEditorRecovery("[editor-recovery] snapshot found", {
          roomId: snapshot.roomId,
          versionId: snapshot.versionId,
          ageMs: now - snapshot.timestamp,
        });
      } else if (snapshot) {
        logEditorRecovery("[editor-recovery] snapshot invalid, falling back", {
          reason: "stale",
          ageMs: now - snapshot.timestamp,
        });
      }

      const resolveRoomCandidate = async (args: {
        roomId: string | null;
        preferredVersionId: string | null;
        activeVersionId?: string | null;
      }): Promise<{ roomId: string; versionId: string; usedPreferredVersion: boolean } | null> => {
        const roomId = safeStr(args.roomId);
        if (!roomId || !accessToken) return null;
        let roomVersions: VibodeRoomAsset[] = [];
        try {
          roomVersions = await loadRoomVersions(roomId, accessToken);
        } catch {
          return null;
        }
        const version = pickMostRelevantVersion(roomVersions, {
          preferredVersionId: args.preferredVersionId,
          activeVersionId: args.activeVersionId,
        });
        if (!version) return null;
        return {
          roomId,
          versionId: version.id,
          usedPreferredVersion: Boolean(args.preferredVersionId && version.id === args.preferredVersionId),
        };
      };

      if (hasFreshSnapshot) {
        const resolvedFromSnapshot = await resolveRoomCandidate({
          roomId: snapshot.roomId,
          preferredVersionId: snapshot.versionId,
        });
        if (resolvedFromSnapshot && !cancelled) {
          setWorkspaceRecoveryRoomId(resolvedFromSnapshot.roomId);
          setWorkspaceRecoveryVersionId(resolvedFromSnapshot.versionId);
          setWorkspaceRecoveryFurnitureLayerEnabled(snapshot.furnitureLayerEnabled);
          setWorkspaceRecoveryResolved(true);
          logEditorRecovery("[editor-recovery] snapshot restored", {
            roomId: resolvedFromSnapshot.roomId,
            versionId: resolvedFromSnapshot.versionId,
            usedPreferredVersion: resolvedFromSnapshot.usedPreferredVersion,
          });
          return;
        }
        logEditorRecovery("[editor-recovery] snapshot invalid, falling back", {
          reason: "missing-room-or-version",
          roomId: snapshot.roomId,
          versionId: snapshot.versionId,
        });
        clearWorkspaceSnapshot();
      }

      const client = supabaseBrowser();
      const { data: roomRows, error: roomError } = await client
        .from("vibode_rooms")
        .select("id,active_asset_id,sort_key")
        .order("sort_key", { ascending: false })
        .limit(25);
      if (roomError) {
        if (cancelled) return;
        logEditorRecovery("[editor-recovery] no valid room found, showing upload state", {
          reason: roomError.message,
        });
        setWorkspaceRecoveryRoomId(null);
        setWorkspaceRecoveryVersionId(null);
        setWorkspaceRecoveryFurnitureLayerEnabled(null);
        setWorkspaceRecoveryResolved(true);
        return;
      }

      const rooms = (Array.isArray(roomRows) ? roomRows : []) as VibodeRoomRowForRecovery[];
      let fallbackCandidate: { roomId: string; versionId: string } | null = null;
      for (const room of rooms) {
        const resolved = await resolveRoomCandidate({
          roomId: room.id,
          preferredVersionId: null,
          activeVersionId: room.active_asset_id,
        });
        if (resolved) {
          fallbackCandidate = {
            roomId: resolved.roomId,
            versionId: resolved.versionId,
          };
          break;
        }
      }

      if (cancelled) return;
      if (fallbackCandidate) {
        setWorkspaceRecoveryRoomId(fallbackCandidate.roomId);
        setWorkspaceRecoveryVersionId(fallbackCandidate.versionId);
        setWorkspaceRecoveryFurnitureLayerEnabled(null);
        setWorkspaceRecoveryResolved(true);
        logEditorRecovery("[editor-recovery] hydrated newest active room", fallbackCandidate);
        return;
      }

      setWorkspaceRecoveryRoomId(null);
      setWorkspaceRecoveryVersionId(null);
      setWorkspaceRecoveryFurnitureLayerEnabled(null);
      setWorkspaceRecoveryResolved(true);
      logEditorRecovery("[editor-recovery] no valid room found, showing upload state");
    };

    void runWorkspaceRecovery();

    return () => {
      cancelled = true;
    };
  }, [isExplicitBlankEditorIntent, requestedRoomId]);

  useEffect(() => {
    if (workspaceRecoveryFurnitureLayerEnabled === null) return;
    setIsFurnitureLayerEnabled((prev) =>
      prev === workspaceRecoveryFurnitureLayerEnabled ? prev : workspaceRecoveryFurnitureLayerEnabled
    );
  }, [workspaceRecoveryFurnitureLayerEnabled]);

  useEffect(() => {
    if (didRestorePendingRef.current) return;
    if (!requestedRoomId) {
      shouldSkipPendingRestoreRef.current = true;
      didRestorePendingRef.current = true;
      clearPendingLocal();
      return;
    }

    useEditorStore.getState().tryRestorePendingFromLocalStorage();
    const pending = loadPendingLocal() as PendingLocalPayload | null;
    const restoredSkuItems = serializeStage3SkuItems(pending?.stage3?.skuItems);
    const hasSkuItems = Array.isArray(pending?.stage3?.skuItems);
    const restoredShowCatalog =
      typeof pending?.stage3?.showCatalog === "boolean" ? pending.stage3.showCatalog : null;

    if (hasSkuItems) {
      setStage3SkuItems(restoredSkuItems);
    }
    if (restoredShowCatalog !== null) {
      setStage3ShowCatalog(restoredShowCatalog);
    }

    console.debug("[stage3.restore]", {
      restoredSkuItemsCount: restoredSkuItems.length,
      restoredActiveCount: restoredSkuItems.filter((item) => item.active).length,
      showCatalog: restoredShowCatalog ?? false,
    });
    didRestorePendingRef.current = true;
  }, [activeAssetId, requestedRoomId, versions, vibodeRoomId]);

  const clearRoomCanvasFadeTimeout = useCallback(() => {
    if (roomCanvasHydrationFadeTimeoutRef.current !== null) {
      window.clearTimeout(roomCanvasHydrationFadeTimeoutRef.current);
      roomCanvasHydrationFadeTimeoutRef.current = null;
    }
  }, []);
  const clearRoomCanvasSettleTimeout = useCallback(() => {
    if (roomCanvasHydrationSettleTimeoutRef.current !== null) {
      window.clearTimeout(roomCanvasHydrationSettleTimeoutRef.current);
      roomCanvasHydrationSettleTimeoutRef.current = null;
    }
  }, []);
  const resetEditorToBlankState = useCallback(() => {
    roomOpenSessionRef.current += 1;
    inFlightRoomHydrationRoomIdRef.current = null;
    hydratedRoomIdRef.current = null;
    requestedRoomIdRef.current = null;
    shouldSkipPendingRestoreRef.current = true;
    didRestorePendingRef.current = true;
    roomCanvasHydrationTokenRef.current += 1;
    clearRoomCanvasFadeTimeout();
    clearRoomCanvasSettleTimeout();
    setRoomCanvasHydrationTarget(null);
    setIsRoomOpenRevealSettling(false);
    setCanvasPresentation({
      frameAspectRatio: null,
      placeholderImageUrl: null,
      finalImageReady: true,
      isHydratingRoom: false,
      showPlaceholder: false,
    });
    setIsRoomHydrating(false);
    roomPhotoCanvasDragDepthRef.current = 0;
    setIsCanvasDragOver(false);
    setSwapOpen(false);
    setSwapTargetId(null);
    setSwapPickerOpen(false);
    setPasteToPlaceStatus(null);
    setPasteToPlaceMenuState(null);
    resetWorkflowForIncomingImage();
  }, [clearRoomCanvasFadeTimeout, clearRoomCanvasSettleTimeout, resetWorkflowForIncomingImage]);

  const beginRoomCanvasHydration = useCallback(
    (args: { aspectRatio?: number | null; placeholderImageUrl?: string | null }) => {
      roomCanvasHydrationTokenRef.current += 1;
      clearRoomCanvasFadeTimeout();
      clearRoomCanvasSettleTimeout();
      setRoomCanvasHydrationTarget(null);
      setIsRoomOpenRevealSettling(false);
      setCanvasPresentation({
        frameAspectRatio: normalizeAspectRatio(args.aspectRatio) ?? 1,
        placeholderImageUrl: args.placeholderImageUrl ?? null,
        finalImageReady: false,
        isHydratingRoom: true,
        showPlaceholder: Boolean(args.placeholderImageUrl),
      });
      return roomCanvasHydrationTokenRef.current;
    },
    [clearRoomCanvasFadeTimeout, clearRoomCanvasSettleTimeout]
  );

  useEffect(() => {
    return () => {
      clearRoomCanvasFadeTimeout();
      clearRoomCanvasSettleTimeout();
    };
  }, [clearRoomCanvasFadeTimeout, clearRoomCanvasSettleTimeout]);

  useEffect(() => {
    if (isWorkspaceRecoveryPending) {
      return;
    }
    if (!effectiveRequestedRoomId) {
      if (!hasAppliedBlankEditorResetRef.current) {
        resetEditorToBlankState();
        hasAppliedBlankEditorResetRef.current = true;
      }
      return;
    }
    hasAppliedBlankEditorResetRef.current = false;
    shouldSkipPendingRestoreRef.current = true;
    if (hydratedRoomIdRef.current === effectiveRequestedRoomId) {
      setIsRoomHydrating(false);
      return;
    }

    if (inFlightRoomHydrationRoomIdRef.current === effectiveRequestedRoomId) {
      return;
    }

    inFlightRoomHydrationRoomIdRef.current = effectiveRequestedRoomId;
    const roomOpenSessionId = roomOpenSessionRef.current + 1;
    roomOpenSessionRef.current = roomOpenSessionId;
    let cancelled = false;
    const isRoomOpenSessionActive = () =>
      !cancelled && roomOpenSessionRef.current === roomOpenSessionId;
    const clearInFlightHydrationFlag = () => {
      if (
        roomOpenSessionRef.current === roomOpenSessionId &&
        inFlightRoomHydrationRoomIdRef.current === effectiveRequestedRoomId
      ) {
        inFlightRoomHydrationRoomIdRef.current = null;
      }
    };

    const hydrateFromRoom = async () => {
      let didApplyHydratedRoom = false;
      const roomOpenPreviewUrl = effectiveRequestedRoomPreviewUrl;
      const initialFrameAspectRatio = effectiveRequestedInitialFrameAspectRatio;
      const canvasHydrationToken = beginRoomCanvasHydration({
        aspectRatio: initialFrameAspectRatio,
        placeholderImageUrl: roomOpenPreviewUrl,
      });
      if (!initialFrameAspectRatio && roomOpenPreviewUrl) {
        void probeImageAspectRatio(roomOpenPreviewUrl).then((previewAspectRatio) => {
          if (!previewAspectRatio || !isRoomOpenSessionActive()) return;
          if (roomCanvasHydrationTokenRef.current !== canvasHydrationToken) return;
          setCanvasPresentation((prev) => ({
            ...prev,
            frameAspectRatio: normalizeAspectRatio(previewAspectRatio) ?? prev.frameAspectRatio ?? 1,
          }));
        });
      }
      logEditorRoomOpen("roomHydration:start", { requestedRoomId: effectiveRequestedRoomId });
      hydratedRoomIdRef.current = null;
      setIsRoomHydrating(true);
      resetWorkflowForIncomingImage();
      if (!isRoomOpenSessionActive()) {
        return;
      }
      try {
        let accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          accessToken = await tryGetSupabaseAccessToken();
        }
        if (!isRoomOpenSessionActive()) {
          return;
        }
        if (!accessToken) {
          logEditorRoomOpen("roomHydration:failed", {
            requestedRoomId: effectiveRequestedRoomId,
            error: "no-access-token",
          });
          hydratedRoomIdRef.current = null;
          pushSnack("Your session expired. Redirecting to sign in...");
          router.push(`/login?next=${encodeURIComponent(`/editor?roomId=${effectiveRequestedRoomId}`)}`);
          return;
        }

        const hydrated = await loadRoomHydrationData(effectiveRequestedRoomId, accessToken);
        if (!isRoomOpenSessionActive()) {
          return;
        }
        const shouldUseRecoveryPreferredVersion =
          !requestedRoomId && workspaceRecoveryRoomId === effectiveRequestedRoomId;
        const recoveryPreferredVersionId = shouldUseRecoveryPreferredVersion
          ? workspaceRecoveryVersionId
          : null;

        const hydratedActiveVersion =
          pickMostRelevantVersion(hydrated.versions, {
            preferredVersionId: recoveryPreferredVersionId,
            activeVersionId: hydrated.room.active_asset_id,
          }) ?? null;
        const hydratedImageUrl = hydrated.imageUrl ?? hydratedActiveVersion?.image_url ?? null;

        if (!hydratedImageUrl) {
          logEditorRoomOpen("roomHydration:failed", {
            requestedRoomId: effectiveRequestedRoomId,
            error: "missing-preview-url",
            roomId: hydrated.room.id,
          });
          hydratedRoomIdRef.current = null;
          pushSnack("Unable to load this room image right now. Please try again.");
          return;
        }

        const hydratedAspectRatio =
          aspectRatioFromAssetMetadata(hydratedActiveVersion?.metadata) ??
          aspectRatioFromDimensions(hydratedActiveVersion?.width, hydratedActiveVersion?.height) ??
          initialFrameAspectRatio;
        setCanvasPresentation((prev) => ({
          ...prev,
          frameAspectRatio: normalizeAspectRatio(hydratedAspectRatio) ?? prev.frameAspectRatio ?? 1,
        }));
        setRoomCanvasHydrationTarget({
          imageUrl: hydratedImageUrl,
          token: canvasHydrationToken,
        });
        setBaseImageUrl(hydratedImageUrl);
        setWorkingImageUrl(hydratedImageUrl);
        if (!isRoomOpenSessionActive()) {
          return;
        }
        setVibodeRoomId(hydrated.room.id);
        setRoomMetadata(hydrated.room.metadata ?? null);
        setVersions(hydrated.versions);
        setActiveAssetId(hydratedActiveVersion?.id ?? hydrated.room.active_asset_id ?? null);
        const hydratedPlacements = extractScenePlacementsFromUnknown(hydratedActiveVersion?.metadata);
        setScenePlacements(hydratedPlacements);
        hydrateSceneNodesFromPlacements(hydratedPlacements);
        setRoomBaseAssetId(hydrated.room.base_asset_id ?? null);
        setIsWorkingImageGenerated(false);

        if (hydrated.room.selected_model === VIBODE_MODEL_NBP || hydrated.room.selected_model === VIBODE_MODEL_NB2) {
          setSelectedModel(hydrated.room.selected_model);
        }

        const maybeStage = hydrated.room.current_stage;
        if (typeof maybeStage === "number" && maybeStage >= 1 && maybeStage <= 5) {
          setActiveStage(maybeStage as WorkflowStage);
        }
        hydratedRoomIdRef.current = effectiveRequestedRoomId;
        didApplyHydratedRoom = true;
        setIsRoomHydrating(false);
        logEditorRoomOpen("roomHydration:finish", {
          requestedRoomId: effectiveRequestedRoomId,
          hydratedRoomId: hydrated.room.id,
          hasImageUrl: Boolean(hydratedImageUrl),
        });

        const nowIso = new Date().toISOString();
        const client = supabaseBrowser();
        await client
          .from("vibode_rooms")
          .update({ last_opened_at: nowIso, sort_key: nowIso })
          .eq("id", hydrated.room.id);
        if (!isRoomOpenSessionActive()) {
          return;
        }

        pushSnack("Room loaded.");
      } catch (err: unknown) {
        if (!isRoomOpenSessionActive()) {
          return;
        }
        logEditorRoomOpen("roomHydration:failed", {
          requestedRoomId: effectiveRequestedRoomId,
          error: getErrorMessage(err) ?? "error",
        });
        console.error("[editor] room hydration failed:", err);
        hydratedRoomIdRef.current = null;
        setCanvasPresentation((prev) => ({
          ...prev,
          finalImageReady: false,
          isHydratingRoom: false,
          showPlaceholder: Boolean(prev.placeholderImageUrl),
        }));
        pushSnack("We couldn't open that room right now. Please try again.");
      } finally {
        if (isRoomOpenSessionActive()) {
          if (!didApplyHydratedRoom) {
            setIsRoomHydrating(false);
            setCanvasPresentation((prev) => ({
              ...prev,
              isHydratingRoom: false,
              showPlaceholder: prev.finalImageReady ? false : Boolean(prev.placeholderImageUrl),
            }));
          }
        }
        clearInFlightHydrationFlag();
      }
    };

    void hydrateFromRoom();

    return () => {
      cancelled = true;
      clearInFlightHydrationFlag();
    };
  }, [
    beginRoomCanvasHydration,
    clearRoomCanvasFadeTimeout,
    clearRoomCanvasSettleTimeout,
    effectiveRequestedInitialFrameAspectRatio,
    effectiveRequestedRoomId,
    effectiveRequestedRoomPreviewUrl,
    isWorkspaceRecoveryPending,
    pushSnack,
    requestedRoomId,
    resetEditorToBlankState,
    resetWorkflowForIncomingImage,
    router,
    setActiveAssetId,
    setBaseImageUrl,
    setVersions,
    workspaceRecoveryRoomId,
    workspaceRecoveryVersionId,
  ]);

  useEffect(() => {
    if (!roomCanvasHydrationTarget) return;
    const { imageUrl, token } = roomCanvasHydrationTarget;
    if (!imageUrl) return;

    let cancelled = false;
    const img = new Image();

    const isCurrentToken = () => roomCanvasHydrationTokenRef.current === token;
    const markReady = () => {
      if (cancelled || !isCurrentToken()) return;
      setCanvasPresentation((prev) => ({
        ...prev,
        finalImageReady: true,
        isHydratingRoom: false,
        showPlaceholder: Boolean(prev.placeholderImageUrl),
      }));
      setIsRoomOpenRevealSettling(true);
      clearRoomCanvasFadeTimeout();
      clearRoomCanvasSettleTimeout();
      roomCanvasHydrationFadeTimeoutRef.current = window.setTimeout(() => {
        if (!isCurrentToken()) return;
        setCanvasPresentation((prev) => ({
          ...prev,
          showPlaceholder: false,
        }));
        roomCanvasHydrationFadeTimeoutRef.current = null;
        roomCanvasHydrationSettleTimeoutRef.current = window.setTimeout(() => {
          if (!isCurrentToken()) return;
          setIsRoomOpenRevealSettling(false);
          roomCanvasHydrationSettleTimeoutRef.current = null;
        }, ROOM_OPEN_REVEAL_SETTLE_MS);
      }, ROOM_OPEN_PLACEHOLDER_FADE_MS);
    };

    img.onload = () => {
      if (typeof img.decode === "function") {
        void img
          .decode()
          .catch(() => undefined)
          .finally(() => {
            markReady();
          });
        return;
      }
      markReady();
    };
    img.onerror = () => {
      if (cancelled || !isCurrentToken()) return;
      setIsRoomOpenRevealSettling(false);
      setCanvasPresentation((prev) => ({
        ...prev,
        finalImageReady: false,
        isHydratingRoom: false,
        showPlaceholder: Boolean(prev.placeholderImageUrl),
      }));
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [clearRoomCanvasFadeTimeout, clearRoomCanvasSettleTimeout, roomCanvasHydrationTarget]);

  useEffect(() => {
    if (shouldSkipPendingRestoreRef.current) return;
    if (!didRestorePendingRef.current) return;
    const currentPending = loadPendingLocal() as PendingLocalPayload | null;
    if (!currentPending) return;
    const currentSceneId =
      typeof currentPending.sceneId === "string" ? currentPending.sceneId : undefined;
    if (currentSceneId !== scene.sceneId) return;

    savePendingLocal({
      ...currentPending,
      stage3: buildPendingStage3Payload(stage3SkuItems, stage3ShowCatalog),
    });
  }, [scene.sceneId, stage3ShowCatalog, stage3SkuItems]);

  useEffect(() => {
    if (activeTool === "swap" && selectedSwapMarkId) return;
    setSwapPickerOpen(false);
  }, [activeTool, selectedSwapMarkId]);

  useEffect(() => {
    if (activeStage !== 3) return;
    setStage3SkuItems((prev) => mergeStage3SkuItems(prev, userSkusAddedToStage3));
  }, [activeStage, userSkusAddedToStage3]);

  const stage3SkuItemsActive = useMemo<VibodeEligibleSku[]>(
    () =>
      stage3SkuItems
        .filter((item) => item.active)
        .map((item) => ({
          skuId: item.skuId,
          label: item.label || item.skuId,
          source: item.source,
          variants: (item.variants ?? []).filter(
            (variant): variant is { imageUrl: string } =>
              !!variant && typeof variant.imageUrl === "string" && variant.imageUrl.length > 0
          ),
        })),
    [stage3SkuItems]
  );

  const buildPreparedMyFurnitureProduct = useCallback(
    (resolved: MyFurnitureResolveResponse, furnitureId: string): PasteToPlacePreparedProduct => {
      const mergedEligibleSkus = mergeEligibleSkusForSavedFurniture(
        stage3SkuItemsActive,
        resolved.eligibleSku
      );
      return {
        source: "my_furniture",
        skuId: resolved.eligibleSku.skuId,
        eligibleSkus: mergedEligibleSkus,
        savedFurnitureId: furnitureId,
      };
    },
    [stage3SkuItemsActive]
  );

  const activatePreparedMyFurnitureSource = useCallback(
    (
      preparedProduct: PasteToPlacePreparedProduct,
      options?: {
        normalizedPreviewUrl?: string | null;
        suppressedClipboardPreviewHash?: string | null;
        selectedFurnitureIds?: string[];
        selectedPreviewUrls?: string[];
      }
    ) => {
      const candidateFurnitureIds = options?.selectedFurnitureIds?.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      ) ?? [];
      const selectedFurnitureIds =
        candidateFurnitureIds.length > 0
          ? Array.from(new Set(candidateFurnitureIds))
          : preparedProduct.savedFurnitureId
            ? [preparedProduct.savedFurnitureId]
            : [];
      const selectedPreviewUrls = Array.from(
        new Set(
          (options?.selectedPreviewUrls ?? []).filter(
            (previewUrl): previewUrl is string =>
              typeof previewUrl === "string" && previewUrl.trim().length > 0
          )
        )
      );
      const primaryFurnitureId = selectedFurnitureIds[0] ?? null;
      if (!primaryFurnitureId) {
        return;
      }
      const fallbackPreview =
        preparedProduct.eligibleSkus.find((sku) => sku.skuId === preparedProduct.skuId)?.variants?.find(
          (variant) => typeof variant?.imageUrl === "string" && variant.imageUrl.trim().length > 0
        )?.imageUrl ?? null;
      const handoffSuppressedClipboardPreviewHash =
        typeof options?.suppressedClipboardPreviewHash === "string" &&
        options.suppressedClipboardPreviewHash.trim().length > 0
          ? options.suppressedClipboardPreviewHash
          : null;
      if (handoffSuppressedClipboardPreviewHash) {
        suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = handoffSuppressedClipboardPreviewHash;
        lastSurfacedProvisionalClipboardPreviewHashRef.current = handoffSuppressedClipboardPreviewHash;
      } else {
        const provisionalClipboardPreviewHash = lastSurfacedProvisionalClipboardPreviewHashRef.current;
        if (provisionalClipboardPreviewHash) {
          suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = provisionalClipboardPreviewHash;
        }
      }
      setPendingMyFurnitureReturnPreviewUrl(null);
      clearPasteToPlaceProgressPreview();
      clearPasteToPlaceMenuClipboardPreview();
      clearPasteToPlaceUrlCandidatePreview();
      activatePasteToPlaceSource({
        type: "my_furniture",
        skuId: preparedProduct.skuId,
        furnitureId: primaryFurnitureId,
        furnitureIds: selectedFurnitureIds,
        selectionCount: selectedFurnitureIds.length,
        selectedPreviewUrls,
        preparedProduct,
        rawPreviewUrl: null,
        normalizedPreviewUrl: options?.normalizedPreviewUrl ?? fallbackPreview,
        sourceImagePathHint: extractStorageObjectPathFromUnknown([
          preparedProduct,
          options?.normalizedPreviewUrl ?? fallbackPreview,
        ]),
        thumbnailPathHint: extractStorageObjectPathFromUnknown([
          preparedProduct,
          options?.normalizedPreviewUrl ?? fallbackPreview,
        ]),
        clipboardDataUrlHash: null,
        activatedAt: Date.now(),
      }, "my_furniture_selected");
    },
    [
      activatePasteToPlaceSource,
      clearPasteToPlaceMenuClipboardPreview,
      clearPasteToPlaceUrlCandidatePreview,
      clearPasteToPlaceProgressPreview,
    ]
  );

  useEffect(() => {
    if (!scene.baseImageUrl) {
      if (workingImageUrl !== null) {
        setWorkingImageUrl(null);
      }
      return;
    }
    if (!workingImageUrl) {
      setWorkingImageUrl(scene.baseImageUrl);
    }
  }, [activeAssetId, requestedRoomId, scene.baseImageUrl, vibodeRoomId, versions, workingImageUrl]);
  const hydrateRoomImageObjects = useCallback(
    async (args: {
      trigger:
        | "load"
        | "room-upload"
        | "stage-run"
        | "edit-run"
        | "paste-to-place"
        | "remove-mode"
        | "set-base-upload"
        | "set-remove-result";
      imageUrl: string | null;
      roomId: string | null;
      assetId: string | null;
      versionId?: string | null;
      allowRoomReadOnMiss: boolean;
      purpose?: "suggested-placement" | "remove-mode" | "legacy";
      mode?: "labels_only" | "geometry";
      suppressErrors?: boolean;
    }): Promise<DetectedRoomObjectLabel[]> => {
      const imageUrl = args.imageUrl?.trim() ?? null;
      const versionId = args.versionId ?? args.assetId;
      const purpose = args.purpose ?? "legacy";
      const mode = args.mode ?? "labels_only";
      const hasStableIdentity = Boolean(args.roomId || args.assetId || versionId);
      const skipReason = !hasStableIdentity
        ? "no stable image identity"
        : imageUrl && !isRoomReadImageUrlSupported(imageUrl)
          ? "non-supported image URL"
          : null;

      if (skipReason) {
        const skipKey = `${args.trigger}:${skipReason}:${args.roomId ?? "no_room"}:${args.assetId ?? "no_asset"}:${imageUrl ?? "no_image"}`;
        if (!roomReadSkipLogKeysRef.current.has(skipKey)) {
          roomReadSkipLogKeysRef.current.add(skipKey);
          if (roomReadSkipLogKeysRef.current.size > 300) {
            roomReadSkipLogKeysRef.current.clear();
          }
          console.log("[room-image-objects] skipped because no stable image identity", {
            trigger: args.trigger,
            reason: skipReason,
          });
        }
        if (!args.allowRoomReadOnMiss) {
          setDetectedRoomObjectLabels([]);
        }
        return [];
      }

      const imageIdentity = `${args.roomId ?? "no_room"}:${args.assetId ?? "no_asset"}:${versionId ?? "no_version"}:${imageUrl ?? "no_image"}`;
      const scopedImageIdentity = `${imageIdentity}:${purpose}:${mode}`;
      const cacheKey = `${scopedImageIdentity}:${args.allowRoomReadOnMiss ? "warm" : "read"}`;
      const cached =
        roomReadByImageKeyRef.current.get(cacheKey) ??
        roomReadByImageKeyRef.current.get(scopedImageIdentity);
      const shouldBypassCachedGeometryMiss =
        Boolean(
          cached &&
            mode === "geometry" &&
            args.allowRoomReadOnMiss &&
            !hasSufficientGeometryRoomObjects(cached)
        );
      if (cached && !shouldBypassCachedGeometryMiss) {
        roomReadByImageKeyRef.current.set(cacheKey, cached);
        setDetectedRoomObjectLabels(cached);
        return cached;
      }
      if (roomReadInFlightKeysRef.current.has(cacheKey)) {
        return [];
      }

      roomReadInFlightKeysRef.current.add(cacheKey);
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        const res = await fetch("/api/vibode/room-image-objects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            imageUrl,
            vibodeRoomId: args.roomId ?? undefined,
            assetId: args.assetId ?? undefined,
            versionId: versionId ?? undefined,
            purpose,
            mode,
            allowRoomReadOnMiss: args.allowRoomReadOnMiss,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        const json = (await res.json().catch(() => ({}))) as RoomReadResponse;
        const objects = Array.isArray(json.objects) ? json.objects : [];
        roomReadByImageKeyRef.current.set(scopedImageIdentity, objects);
        roomReadByImageKeyRef.current.set(cacheKey, objects);
        setDetectedRoomObjectLabels(objects);
        return objects;
      } catch (err: unknown) {
        console.warn("[room-image-objects] failed", {
          trigger: args.trigger,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!args.allowRoomReadOnMiss) {
          setDetectedRoomObjectLabels([]);
        }
        if (args.suppressErrors === false) {
          throw err;
        }
        return [];
      } finally {
        roomReadInFlightKeysRef.current.delete(cacheKey);
      }
    },
    []
  );
  const hydratePlacementLayerNodes = useCallback(
    async (args: {
      roomId: string | null;
      versionId: string | null;
      trigger: "load" | "room-upload" | "stage-run" | "edit-run" | "paste-to-place";
    }) => {
      const roomId = args.roomId?.trim() ?? null;
      const versionId = args.versionId?.trim() ?? null;
      const scopeKey = roomId && versionId ? `${roomId}:${versionId}` : null;
      if (!scopeKey) {
        placementLayerHydratedScopeKeyRef.current = null;
        placementLayerInFlightScopeKeyRef.current = null;
        setPlacementLayerNodes([]);
        console.log("[placement-layer] hydrated", {
          trigger: args.trigger,
          roomId: roomId ?? null,
          versionId: versionId ?? null,
          count: 0,
        });
        return;
      }
      const scopedRoomId = roomId as string;
      const scopedVersionId = versionId as string;
      if (placementLayerHydratedScopeKeyRef.current !== scopeKey) {
        // Prevent stale markers from briefly showing while version-scoped nodes load.
        setPlacementLayerNodes([]);
      }
      if (placementLayerInFlightScopeKeyRef.current === scopeKey) return;
      placementLayerInFlightScopeKeyRef.current = scopeKey;
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        const res = await fetch(
          `/api/vibode/room-furniture-placements?roomId=${encodeURIComponent(scopedRoomId)}&versionId=${encodeURIComponent(scopedVersionId)}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
          }
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        const payload = (await res.json().catch(() => ({}))) as PlacementLayerListResponse;
        const rows = Array.isArray(payload.nodes) ? payload.nodes : [];
        const normalized = rows
          .map((row) => normalizePlacementLayerNode(row))
          .filter((row): row is PlacementLayerNode => Boolean(row));
        placementLayerHydratedScopeKeyRef.current = scopeKey;
        setPlacementLayerNodes(normalized);
        console.log("[placement-layer] hydrated", {
          trigger: args.trigger,
          roomId,
          versionId,
          count: normalized.length,
        });
      } catch (err: unknown) {
        console.warn("[placement-layer] hydrate failed", {
          trigger: args.trigger,
          roomId,
          versionId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (placementLayerInFlightScopeKeyRef.current === scopeKey) {
          placementLayerInFlightScopeKeyRef.current = null;
        }
      }
    },
    []
  );

  useEffect(() => {
    const roomId = vibodeRoomId?.trim() ?? null;
    const assetId = activeAssetId?.trim() ?? null;
    const imageUrl = workingImageUrl?.trim() ?? null;
    if (!roomId && !assetId) return;
    void hydrateRoomImageObjects({
      trigger: "load",
      imageUrl,
      roomId,
      assetId,
      versionId: assetId,
      mode: "geometry",
      allowRoomReadOnMiss: false,
    });
  }, [activeAssetId, hydrateRoomImageObjects, vibodeRoomId, workingImageUrl]);
  useEffect(() => {
    void hydratePlacementLayerNodes({
      roomId: vibodeRoomId,
      versionId: activeAssetId,
      trigger: "load",
    });
  }, [activeAssetId, hydratePlacementLayerNodes, vibodeRoomId, workingImageUrl]);
  const isBaseImageEditReady = useMemo(() => {
    return (
      !isRoomHydrating &&
      isServerFetchableImageUrl(scene.baseImageUrl) &&
      isServerFetchableImageUrl(workingImageUrl)
    );
  }, [isRoomHydrating, scene.baseImageUrl, workingImageUrl]);

  const activeStageOutputImageUrl = useMemo(
    () => getImageUrlFromUnknown(lastStageOutputs[activeStage]),
    [activeStage, lastStageOutputs]
  );
  const hasHydratedRequestedRoom =
    !requestedRoomId || hydratedRoomIdRef.current === requestedRoomId;
  const isRequestedRoomSessionActive =
    !requestedRoomId || vibodeRoomId === requestedRoomId || hasHydratedRequestedRoom;
  const roomOpenBridgeImageUrl = requestedRoomId ? requestedRoomPreviewUrl : null;
  const shouldPreferRoomOpenBridge =
    !!roomOpenBridgeImageUrl && !hasHydratedRequestedRoom;
  const currentImageUrl =
    isRequestedRoomSessionActive
      ? workingImageUrl ?? activeStageOutputImageUrl ?? scene.baseImageUrl ?? null
      : null;
  const previewImageUrl = shouldPreferRoomOpenBridge
    ? roomOpenBridgeImageUrl
    : currentImageUrl ?? roomOpenBridgeImageUrl;
  const canvasImageUrl = currentImageUrl;
  const hasCanvasPresentationPlaceholder =
    canvasPresentation.showPlaceholder && Boolean(canvasPresentation.placeholderImageUrl);
  const hasCanvasPresentationImage =
    Boolean(canvasImageUrl) || canvasPresentation.isHydratingRoom || hasCanvasPresentationPlaceholder;
  const isRoomOpenPresentationTransition =
    Boolean(requestedRoomId) &&
    (canvasPresentation.isHydratingRoom ||
      hasCanvasPresentationPlaceholder ||
      isRoomOpenRevealSettling);
  const shouldPinCanvasFrameAspectRatio = isRoomOpenPresentationTransition;
  const resolvedCanvasFrameAspectRatio = shouldPinCanvasFrameAspectRatio
    ? (canvasPresentation.frameAspectRatio ??
      aspectRatioFromDimensions(scene.baseImageWidthPx, scene.baseImageHeightPx) ??
      1)
    : null;
  const isCanvasEmpty = !hasCanvasPresentationImage;
  const isOpeningExistingRoom = Boolean(effectiveRequestedRoomId) || isWorkspaceRecoveryPending;
  const shouldShowUploadOverlay = isCanvasEmpty && !isOpeningExistingRoom;
  const activePasteSourcePreviewUrl = activePasteSource
    ? activePasteSource.type === "my_furniture"
      ? activePasteSource.rawPreviewUrl ?? activePasteSource.normalizedPreviewUrl
      : activePasteSource.normalizedPreviewUrl ?? activePasteSource.rawPreviewUrl
    : null;
  const pasteToPlaceUrlCandidatePreviewUrl = pasteToPlaceUrlCandidatePreview?.previewImageUrl ?? null;
  const activePasteToPlaceCandidatePreviewUrl =
    pasteToPlaceMenuClipboardPreviewUrl ?? pasteToPlaceUrlCandidatePreviewUrl;
  const shouldHideAuthoritativeMyFurniturePreviewDuringClipboardProbe =
    activePasteSource?.type === "my_furniture" &&
    !pasteToPlaceMenuClipboardPreviewUrl &&
    isPasteToPlaceMenuClipboardPreviewLoading;
  const pasteToPlaceDisplayedPreviewUrl =
    activePasteToPlaceCandidatePreviewUrl ??
    (shouldHideAuthoritativeMyFurniturePreviewDuringClipboardProbe
      ? null
      : (pendingMyFurnitureReturnPreviewUrl ?? activePasteSourcePreviewUrl));
  const isMyFurnitureMultiPreparedSource =
    activePasteSource?.type === "my_furniture" && activePasteSource.selectionCount > 1;
  const myFurniturePreparedSelectionCount =
    activePasteSource?.type === "my_furniture" ? activePasteSource.selectionCount : 0;
  const myFurniturePreparedSelectedPreviewUrls =
    activePasteSource?.type === "my_furniture" ? activePasteSource.selectedPreviewUrls : [];
  const isClipboardPasteToPlaceIngestPending =
    isPasteToPlaceMenuIngesting &&
    (pasteToPlaceStatus === "reading" || pasteToPlaceStatus === "preparing");
  const isCommittedPasteToPlacePending = hasPendingPasteToPlaceCommit();
  const isPasteToPlaceMenuPreviewLoading =
    (!isCommittedPasteToPlacePending && isPasteToPlaceMenuIngesting) ||
    isPasteToPlaceMenuClipboardPreviewLoading ||
    isPasteToPlaceUrlCandidatePreviewLoading;
  const isPasteToPlaceProductUrlPreparing =
    !isCommittedPasteToPlacePending &&
    isPasteToPlaceMenuIngesting &&
    pasteToPlaceStatus === "preparing";
  const pasteToPlaceProgressOperations: PasteToPlaceProgressOperationView[] = (() => {
    const contexts = Array.from(pendingPasteToPlaceCommitRegistryRef.current.values()).sort(
      (left, right) => left.registeredAtMs - right.registeredAtMs
    );
    if (contexts.length === 0) return [];
    const isLoading = isPasteToPlaceMenuIngesting || Boolean(pasteToPlaceStatus);
    const canCancel = contexts.length === 1 && hasPendingPasteToPlaceCommit();

    const status: PasteToPlaceProgressOperationView["status"] = isPasteToPlaceCancelling
      ? "cancelling"
      : isPasteToPlaceSettling && !pasteToPlaceStatus
      ? "settling"
      : pasteToPlaceStatus;

    return contexts
      .map((context) => ({
        operationId: context.operationId,
        anchor: context.progressAnchor,
        previewUrl: getPasteToPlaceProgressCardPreviewUrlFromSnapshot(context.snapshot),
        mode: context.snapshot.mode,
        status,
        isLoading,
        isCancelling: isPasteToPlaceCancelling,
        canCancel,
      }))
      .filter((operation) => Boolean(operation.previewUrl) || operation.isLoading);
  })();
  const canShowSingletonPasteToPlaceCancel =
    hasPendingPasteToPlaceCommit() && getPendingPasteToPlaceCommitCount() === 1;
  const isAwaitingRefreshCopiedItem =
    awaitingPasteToPlaceSessionUiState?.reason === "refresh_copied_item";
  const isRefreshClipboardCandidateReady = Boolean(
    awaitingPasteToPlaceSessionUiState &&
      awaitingPasteToPlaceSessionUiState.reason === "refresh_copied_item" &&
      pasteEventClipboardImagePayloadRef.current &&
      pasteEventClipboardImagePayloadRef.current.operationId ===
        awaitingPasteToPlaceSessionUiState.operationId
  );
  const isPasteToPlaceRefreshInteractionLocked =
    isRefreshingCopiedItem || (isAwaitingRefreshCopiedItem && !isRefreshClipboardCandidateReady);
  const pasteToPlaceAwaitingPasteMessage = awaitingPasteToPlaceSessionUiState
    ? awaitingPasteToPlaceSessionUiState.reason === "refresh_copied_item"
      ? isRefreshClipboardCandidateReady
        ? null
        : "Press ⌘V to refresh copied item."
      : awaitingPasteToPlaceSessionUiState.reason === "clipboard_access_unavailable"
        ? "Clipboard access is blocked. Press ⌘V to paste instead."
        : "Press ⌘V to paste furniture image."
    : null;
  const productUrlPreparedDisplayName =
    activePasteSource?.type === "product_url" ? activePasteSource.displayName : null;
  const productUrlPreparedSupplier =
    activePasteSource?.type === "product_url" ? activePasteSource.supplier : null;
  const productUrlPreparedSourceUrl =
    activePasteSource?.type === "product_url" ? activePasteSource.sourceUrl : null;
  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => {
      if (pasteToPlaceMenuState && !isPasteToPlaceSettling) {
        const pastedText = event.clipboardData?.getData("text/plain") ?? "";
        const normalizedPastedUrl = normalizeLikelyUrl(pastedText);
        if (normalizedPastedUrl) {
          event.preventDefault();
          setPasteToPlaceProductUrlInput(normalizedPastedUrl);
          const activeOperationId = pasteToPlaceOperationIdRef.current;
          if (isPasteToPlaceOperationActive(activeOperationId)) {
            void requestPasteToPlaceUrlCandidatePreview({
              sourceUrl: normalizedPastedUrl,
              operationId: activeOperationId,
              showFailureSnack: true,
            });
          }
          const activeSession = awaitingPasteToPlaceSessionRef.current;
          if (
            activeSession &&
            isPasteToPlaceOperationActive(activeSession.operationId) &&
            !isClipboardPasteToPlaceIngestPending &&
            activeSession.reason !== "refresh_copied_item"
          ) {
            clearAwaitingPasteToPlaceSession(activeSession.operationId);
            clearPasteEventClipboardImagePayload(activeSession.operationId);
          }
          return;
        }
      }
      const activeSession = awaitingPasteToPlaceSessionRef.current;
      if (!activeSession) return;
      if (!isPasteToPlaceOperationActive(activeSession.operationId)) {
        clearAwaitingPasteToPlaceSession(activeSession.operationId);
        clearPasteEventClipboardImagePayload(activeSession.operationId);
        return;
      }
      if (!pasteToPlaceMenuState) {
        clearAwaitingPasteToPlaceSession(activeSession.operationId);
        clearPasteEventClipboardImagePayload(activeSession.operationId);
        return;
      }
      const clipboardData = event.clipboardData;
      const clipboardItems = clipboardData?.items ?? null;
      let clipboardImageFile: File | null = null;
      if (clipboardItems) {
        for (const item of clipboardItems) {
          if (item.kind !== "file") continue;
          if (!item.type.startsWith("image/")) continue;
          clipboardImageFile = item.getAsFile();
          if (clipboardImageFile) break;
        }
      }
      if (!clipboardImageFile) {
        pushSnack("Clipboard did not contain an image. Copy a furniture image and press ⌘V.");
        clearAwaitingPasteToPlaceSession(activeSession.operationId);
        clearPasteEventClipboardImagePayload(activeSession.operationId);
        return;
      }
      event.preventDefault();
      void (async () => {
        const clipboardDataUrl = await blobToDataUrl(clipboardImageFile);
        if (!clipboardDataUrl || !clipboardDataUrl.startsWith("data:image/")) {
          pushSnack("Clipboard image could not be read. Copy the image again and press ⌘V.");
          clearAwaitingPasteToPlaceSession(activeSession.operationId);
          clearPasteEventClipboardImagePayload(activeSession.operationId);
          return;
        }
        if (!isPasteToPlaceOperationActive(activeSession.operationId)) {
          clearAwaitingPasteToPlaceSession(activeSession.operationId);
          clearPasteEventClipboardImagePayload(activeSession.operationId);
          return;
        }
        const latestSession = awaitingPasteToPlaceSessionRef.current;
        if (!latestSession || latestSession.operationId !== activeSession.operationId) {
          return;
        }
        pasteEventClipboardImagePayloadRef.current = {
          operationId: activeSession.operationId,
          file: clipboardImageFile,
          dataUrl: clipboardDataUrl,
          dataUrlHash: hashDataUrlForLogs(clipboardDataUrl),
          createdAt: Date.now(),
        };
        setPasteToPlaceMenuClipboardPreviewUrl(clipboardDataUrl);
        setIsPasteToPlaceMenuClipboardPreviewLoading(false);
        if (activeSession.reason === "refresh_copied_item") {
          clearPasteToPlaceActiveSource("refresh_copied_item_preview_ready");
          setAwaitingPasteToPlaceSession({
            operationId: activeSession.operationId,
            reason: "refresh_copied_item",
            createdAt: activeSession.createdAt,
          });
          pushSnack("Copied item refreshed.");
          return;
        }
        setIsPasteToPlaceMenuIngesting(false);
        pushSnack("Pasted image ready. Choose Place here or Swap item.");
      })();
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [
    clearAwaitingPasteToPlaceSession,
    clearPasteEventClipboardImagePayload,
    clearPasteToPlaceActiveSource,
    isClipboardPasteToPlaceIngestPending,
    isPasteToPlaceOperationActive,
    isPasteToPlaceSettling,
    pasteToPlaceMenuState,
    pushSnack,
    requestPasteToPlaceUrlCandidatePreview,
    setAwaitingPasteToPlaceSession,
  ]);
  const selectedVersionId =
    activeAssetId ?? versions.find((asset) => asset.is_active)?.id ?? null;
  const lastSnapshotPersistSkipReasonRef = useRef<string | null>(null);
  const persistWorkspaceSnapshot = useCallback(
    (overrides?: Partial<VibodeEditorWorkspaceSnapshot>) => {
      if (typeof window === "undefined") return;
      const emitSkipLog = (reason: string) => {
        if (lastSnapshotPersistSkipReasonRef.current === reason) return;
        lastSnapshotPersistSkipReasonRef.current = reason;
        logEditorRecovery("[editor-recovery] skipped snapshot persist", {
          reason,
          roomId: vibodeRoomId,
          versionId: selectedVersionId,
          isRoomHydrating,
          isWorkspaceRecoveryPending,
          versionCount: versions.length,
          isRoomOpenRevealSettling,
          isCanvasHydratingRoom: canvasPresentation.isHydratingRoom,
        });
      };

      if (isRoomHydrating) {
        emitSkipLog("room_hydrating");
        return;
      }
      if (isWorkspaceRecoveryPending) {
        emitSkipLog("workspace_recovery_pending");
        return;
      }
      if (isExplicitBlankEditorIntent) {
        emitSkipLog("explicit_blank_editor_intent");
        return;
      }
      if (versions.length === 0 && (canvasPresentation.isHydratingRoom || isRoomOpenRevealSettling)) {
        emitSkipLog("versions_empty_during_hydration_settling");
        return;
      }

      const nextSnapshot: VibodeEditorWorkspaceSnapshot = {
        roomId: overrides?.roomId ?? vibodeRoomId ?? null,
        versionId: overrides?.versionId ?? selectedVersionId ?? null,
        furnitureLayerEnabled:
          overrides?.furnitureLayerEnabled ?? isFurnitureLayerEnabled,
        timestamp: Date.now(),
      };
      if (!nextSnapshot.roomId && !nextSnapshot.versionId) {
        emitSkipLog("missing_room_and_version");
        return;
      }
      if (!nextSnapshot.roomId) {
        emitSkipLog("missing_room");
        return;
      }

      lastSnapshotPersistSkipReasonRef.current = null;
      try {
        window.sessionStorage.setItem(
          VIBODE_EDITOR_WORKSPACE_KEY,
          JSON.stringify(nextSnapshot)
        );
      } catch {
        // Ignore storage write errors.
      }
    },
    [
      canvasPresentation.isHydratingRoom,
      isFurnitureLayerEnabled,
      isRoomHydrating,
      isRoomOpenRevealSettling,
      isExplicitBlankEditorIntent,
      isWorkspaceRecoveryPending,
      selectedVersionId,
      vibodeRoomId,
      versions.length,
    ]
  );
  const persistWorkspaceSnapshotForBillingNavigation = useCallback(() => {
    persistWorkspaceSnapshot();
  }, [persistWorkspaceSnapshot]);
  useEffect(() => {
    persistWorkspaceSnapshot();
  }, [persistWorkspaceSnapshot]);
  const selectedVersion = useMemo(
    () => versions.find((asset) => asset.id === selectedVersionId) ?? null,
    [selectedVersionId, versions]
  );
  const selectedVersionRenderedPlacementStateHash = useMemo(
    () => readRenderedPlacementStateHashFromMetadata(selectedVersion?.metadata),
    [selectedVersion?.metadata]
  );
  const selectedVersionRenderedPlacementSnapshot = useMemo(
    () => readRenderedPlacementSnapshotFromMetadata(selectedVersion?.metadata),
    [selectedVersion?.metadata]
  );
  const selectedVersionOriginalPlacementStateHash = useMemo(
    () => readOriginalPlacementStateHashFromMetadata(selectedVersion?.metadata),
    [selectedVersion?.metadata]
  );
  const selectedVersionOriginalPlacementSnapshot = useMemo(
    () => readOriginalPlacementSnapshotFromMetadata(selectedVersion?.metadata),
    [selectedVersion?.metadata]
  );
  const selectedVersionIdRef = useRef<string | null>(selectedVersionId);
  const selectedVersionRenderedPlacementStateHashRef = useRef<string | null>(
    selectedVersionRenderedPlacementStateHash
  );
  const selectedVersionOriginalPlacementStateHashRef = useRef<string | null>(
    selectedVersionOriginalPlacementStateHash
  );
  const selectedVersionOriginalPlacementSnapshotRef = useRef<NormalizedPlacementStateRow[] | null>(
    selectedVersionOriginalPlacementSnapshot
  );
  useEffect(() => {
    selectedVersionIdRef.current = selectedVersionId;
  }, [selectedVersionId]);
  useEffect(() => {
    selectedVersionRenderedPlacementStateHashRef.current = selectedVersionRenderedPlacementStateHash;
  }, [selectedVersionRenderedPlacementStateHash]);
  useEffect(() => {
    selectedVersionOriginalPlacementStateHashRef.current = selectedVersionOriginalPlacementStateHash;
  }, [selectedVersionOriginalPlacementStateHash]);
  useEffect(() => {
    selectedVersionOriginalPlacementSnapshotRef.current = selectedVersionOriginalPlacementSnapshot;
  }, [selectedVersionOriginalPlacementSnapshot]);
  const computePlacementStateHashAndSnapshot = useCallback(async (placements: PlacementLayerNode[]) => {
    const renderedPlacementSnapshot = normalizePlacementStateForHash(placements);
    const placementStateHash = await hashPlacementState(placements);
    return { renderedPlacementSnapshot, placementStateHash };
  }, []);
  const updateSceneNeedsUpdateFromPlacements = useCallback(
    async (
      placements: PlacementLayerNode[],
      expectedVersionId: string | null = selectedVersionId,
      options?: { missingRenderedHashMeansDirty?: boolean }
    ) => {
      const activeVersionId = selectedVersionIdRef.current;
      if (!expectedVersionId || expectedVersionId !== activeVersionId) return false;
      const missingRenderedHashMeansDirty = options?.missingRenderedHashMeansDirty === true;
      const renderedHash = selectedVersionRenderedPlacementStateHashRef.current;
      if (!renderedHash) {
        if (missingRenderedHashMeansDirty || sceneDirtyLocallyConfirmedRef.current) {
          setSceneNeedsUpdate(true);
          setCanRestoreOriginalPlacementPositions(false);
          return true;
        }
        setSceneNeedsUpdate(false);
        setCanRestoreOriginalPlacementPositions(false);
        return false;
      }
      const placementStateHash = await hashPlacementState(placements);
      if (expectedVersionId !== selectedVersionIdRef.current) return false;
      const isDirty = placementStateHash !== renderedHash;
      setSceneNeedsUpdate(isDirty);
      const originalHash = selectedVersionOriginalPlacementStateHashRef.current;
      const hasOriginalSnapshot = Array.isArray(selectedVersionOriginalPlacementSnapshotRef.current);
      setCanRestoreOriginalPlacementPositions(
        !isDirty && !!originalHash && hasOriginalSnapshot && placementStateHash !== originalHash
      );
      return isDirty;
    },
    [selectedVersionId]
  );
  const activeVersionMetadataPlacements = useMemo(
    () => extractScenePlacementsFromUnknown(selectedVersion?.metadata),
    [selectedVersion?.metadata]
  );
  const stage3OutputPlacements = useMemo(
    () => extractScenePlacementsFromUnknown(lastStageOutputs[3]),
    [lastStageOutputs]
  );
  const activeStageOutputPlacements = useMemo(
    () => extractScenePlacementsFromUnknown(lastStageOutputs[activeStage]),
    [activeStage, lastStageOutputs]
  );
  const authoritativeDisplayedPlacements = useMemo(() => {
    if (scenePlacements.length > 0) return scenePlacements;
    if (activeVersionMetadataPlacements.length > 0) return activeVersionMetadataPlacements;
    if (stage3OutputPlacements.length > 0) return stage3OutputPlacements;
    if (activeStageOutputPlacements.length > 0) return activeStageOutputPlacements;
    return [];
  }, [
    activeStageOutputPlacements,
    activeVersionMetadataPlacements,
    scenePlacements,
    stage3OutputPlacements,
  ]);
  const hydrateSceneNodesFromPlacements = useCallback(
    (placements: ScenePlacement[]) => {
      void placements;
      // Legacy placement->node hydration is intentionally disabled.
      clearLegacyPlacementNodes();
    },
    [clearLegacyPlacementNodes]
  );
  const versionsWithKind = useMemo<EditorVersionWithKind[]>(
    () =>
      versions.map((version) => ({
        ...version,
        versionKind: getVibodeVersionKind(version),
        isActiveSetEligible: isVersionEligibleForActiveSet(version),
      })),
    [versions]
  );
  const activeSetVersionId = useMemo(
    () =>
      resolveActiveSetVersionId({
        roomMetadata,
        versions,
        baseAssetId: roomBaseAssetId,
        activeAssetId,
      }),
    [activeAssetId, roomBaseAssetId, roomMetadata, versions]
  );
  const effectiveBaseSetVersion = useMemo(
    () =>
      getEffectiveBaseSetVersion({
        roomMetadata,
        versions,
        baseAssetId: roomBaseAssetId,
        activeAssetId,
      }).version,
    [activeAssetId, roomBaseAssetId, roomMetadata, versions]
  );
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!vibodeRoomId) return;
    const eligibleVersionIds = versionsWithKind
      .filter((version) => version.isActiveSetEligible)
      .map((version) => version.id);
    console.debug("[active-set] resolution", {
      roomId: vibodeRoomId,
      activeSetVersionId,
      effectiveBaseSetVersionId: effectiveBaseSetVersion?.id ?? null,
      eligibleVersionIds,
      selectedVersionId,
      activeAssetId,
      baseAssetId: roomBaseAssetId,
      hasRoomMetadata: Boolean(roomMetadata),
    });
  }, [
    activeAssetId,
    activeSetVersionId,
    effectiveBaseSetVersion?.id,
    roomBaseAssetId,
    roomMetadata,
    selectedVersionId,
    versionsWithKind,
    vibodeRoomId,
  ]);
  const originalVersion = useMemo(() => {
    if (roomBaseAssetId) {
      const byRoomBaseId = versionsWithKind.find((asset) => asset.id === roomBaseAssetId);
      if (byRoomBaseId) return byRoomBaseId;
    }
    return versionsWithKind.find((asset) => asset.asset_type !== "stage_output") ?? null;
  }, [roomBaseAssetId, versionsWithKind]);
  const versionsForShelves = useMemo(() => {
    return versionsWithKind.slice().sort((a, b) => {
      const aMs = Date.parse(a.created_at);
      const bMs = Date.parse(b.created_at);
      const safeA = Number.isFinite(aMs) ? aMs : 0;
      const safeB = Number.isFinite(bMs) ? bMs : 0;
      return safeB - safeA;
    });
  }, [versionsWithKind]);
  const groupedVersions = useMemo(() => {
    const set: EditorVersionWithKind[] = [];
    const stage: EditorVersionWithKind[] = [];
    const style: EditorVersionWithKind[] = [];
    const unknown: EditorVersionWithKind[] = [];

    for (const version of versionsForShelves) {
      if (version.versionKind === "set" || version.asset_type === "base") {
        set.push(version);
        continue;
      }
      if (version.versionKind === "stage") {
        stage.push(version);
        continue;
      }
      if (version.versionKind === "style") {
        style.push(version);
        continue;
      }
      unknown.push(version);
    }

    return { set, stage, style, unknown };
  }, [versionsForShelves]);
  const selectedCanvasVersion = useMemo(
    () => versionsWithKind.find((asset) => asset.id === selectedVersionId) ?? null,
    [selectedVersionId, versionsWithKind]
  );
  const canDeleteVersions = versions.length > 1;
  const isVersionEligibleForFavourite = useCallback((asset: EditorVersionWithKind): boolean => {
    return asset.versionKind === "stage" || asset.versionKind === "style";
  }, []);
  const isVersionFavourited = useCallback((asset: EditorVersionWithKind): boolean => {
    if (!isVersionEligibleForFavourite(asset)) return false;
    const metadata = isRecord(asset.metadata) ? asset.metadata : null;
    return metadata?.isFavourite === true;
  }, [isVersionEligibleForFavourite]);
  const groupedVersionsForDisplay = useMemo(() => {
    if (!isFavouritesFilterOn) return groupedVersions;
    return {
      set: groupedVersions.set,
      unknown: [] as EditorVersionWithKind[],
      stage: groupedVersions.stage.filter((version) => isVersionFavourited(version)),
      style: groupedVersions.style.filter((version) => isVersionFavourited(version)),
    };
  }, [groupedVersions, isFavouritesFilterOn, isVersionFavourited]);
  const isFavouritesFilterEmpty =
    isFavouritesFilterOn &&
    groupedVersionsForDisplay.stage.length === 0 &&
    groupedVersionsForDisplay.style.length === 0;

  useEffect(() => {
    placementLayerNodesRef.current = placementLayerNodes;
  }, [placementLayerNodes]);

  useEffect(() => {
    sceneDirtyLocallyConfirmedRef.current = false;
    setCanRestoreOriginalPlacementPositions(false);
  }, [selectedVersionId, vibodeRoomId]);

  useEffect(() => {
    if (!selectedVersionId || !vibodeRoomId) {
      setSceneNeedsUpdate(false);
      setCanRestoreOriginalPlacementPositions(false);
      return;
    }
    const scopeKey = `${vibodeRoomId}:${selectedVersionId}`;
    if (placementLayerHydratedScopeKeyRef.current !== scopeKey) {
      return;
    }
    if (placementLayerInFlightScopeKeyRef.current === scopeKey) {
      return;
    }
    void (async () => {
      await updateSceneNeedsUpdateFromPlacements(placementLayerNodesRef.current, selectedVersionId);
    })();
  }, [
    placementLayerNodes,
    selectedVersionId,
    selectedVersionOriginalPlacementStateHash,
    selectedVersionRenderedPlacementStateHash,
    updateSceneNeedsUpdateFromPlacements,
    vibodeRoomId,
  ]);

  const applyVersionToEditorState = useCallback(
    (asset: VibodeRoomAsset, sourceVersions: VibodeRoomAsset[]) => {
      const nextUrl = typeof asset.image_url === "string" ? asset.image_url.trim() : "";
      if (!nextUrl) return false;
      const versionPlacements = extractScenePlacementsFromUnknown(asset.metadata);

      clearPasteToPlaceProgressPreview();
      setSceneNeedsUpdate(false);
      setWorkingImageUrl(nextUrl);
      setIsWorkingImageGenerated(asset.asset_type === "stage_output");
      setScenePlacements(versionPlacements);
      hydrateSceneNodesFromPlacements(versionPlacements);
      setActiveAssetId(asset.id);
      setVersions(
        sourceVersions.map((candidate) =>
          candidate.id === asset.id
            ? { ...candidate, is_active: true }
            : { ...candidate, is_active: false }
        )
      );
      return true;
    },
    [
      clearPasteToPlaceProgressPreview,
      hydrateSceneNodesFromPlacements,
      setActiveAssetId,
      setScenePlacements,
      setVersions,
    ]
  );

  const handleSelectVersion = useCallback(
    (asset: VibodeRoomAsset) => {
      const applied = applyVersionToEditorState(asset, versions);
      if (!applied) return;

      if (!vibodeRoomId) return;

      void (async () => {
        try {
          const accessToken = await tryGetSupabaseAccessToken();
          if (!accessToken) {
            pushSnack("Couldn't sync versions right now. Please refresh.");
            return;
          }
          await setActiveVersionForRoom({
            roomId: vibodeRoomId,
            assetId: asset.id,
            accessToken,
          });
        } catch (err) {
          console.warn("[editor] failed to sync active version:", err);
          pushSnack("Couldn't sync that version. Refreshing your version list...");
          await refreshRoomVersions(vibodeRoomId);
        }
      })();
    },
    [
      applyVersionToEditorState,
      pushSnack,
      refreshRoomVersions,
      vibodeRoomId,
      versions,
    ]
  );

  const handleSetVersionAsBaseImage = useCallback(
    async (asset: EditorVersionWithKind) => {
      if (!vibodeRoomId) return;
      if (!asset.isActiveSetEligible) return;
      if (activeSetVersionId === asset.id) return;
      if (settingBaseImageVersionId) return;

      setSettingBaseImageVersionId(asset.id);
      try {
        let accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          accessToken = await tryGetSupabaseAccessToken();
        }
        if (!accessToken) {
          throw new Error("No Supabase session.");
        }

        const result = await setActiveSetVersionForRoom({
          roomId: vibodeRoomId,
          activeSetVersionId: asset.id,
          accessToken,
        });

        setRoomMetadata((prev) => {
          if (result.metadata) return result.metadata;
          return {
            ...(isRecord(prev) ? prev : {}),
            activeSetVersionId: result.activeSetVersionId,
          };
        });
        pushSnack("Base Image updated.");
      } catch (err) {
        console.warn("[editor] failed to set active set version:", err);
        pushSnack("Couldn't set Base Image right now.");
      } finally {
        setSettingBaseImageVersionId(null);
      }
    },
    [activeSetVersionId, pushSnack, settingBaseImageVersionId, vibodeRoomId]
  );

  const clearSceneRebuildComposeGuardTimers = useCallback(() => {
    if (sceneRebuildComposeWarningTimerRef.current !== null) {
      window.clearTimeout(sceneRebuildComposeWarningTimerRef.current);
      sceneRebuildComposeWarningTimerRef.current = null;
    }
    if (sceneRebuildComposeTimeoutTimerRef.current !== null) {
      window.clearTimeout(sceneRebuildComposeTimeoutTimerRef.current);
      sceneRebuildComposeTimeoutTimerRef.current = null;
    }
  }, []);

  const clearSceneRebuildComposeTimers = useCallback(() => {
    if (sceneRebuildRenderingMessageTimerRef.current !== null) {
      window.clearTimeout(sceneRebuildRenderingMessageTimerRef.current);
      sceneRebuildRenderingMessageTimerRef.current = null;
    }
    clearSceneRebuildComposeGuardTimers();
  }, [clearSceneRebuildComposeGuardTimers]);

  const clearSceneRebuildAbortController = useCallback((controller?: AbortController | null) => {
    if (!controller) {
      sceneRebuildAbortControllerRef.current = null;
      return;
    }
    if (sceneRebuildAbortControllerRef.current === controller) {
      sceneRebuildAbortControllerRef.current = null;
    }
  }, []);

  const handleCancelDevSceneRebuild = useCallback(() => {
    if (!isDevSceneRebuildRunning || devSceneRebuildStage !== "compose") {
      return;
    }
    clearSceneRebuildComposeTimers();
    setIsDevSceneRebuildRenderingMessageVisible(false);
    setIsDevSceneRebuildComposeWarningVisible(false);
    sceneRebuildAbortReasonRef.current = "user_cancel";
    sceneRebuildAbortControllerRef.current?.abort();
  }, [clearSceneRebuildComposeTimers, devSceneRebuildStage, isDevSceneRebuildRunning]);

  useEffect(() => {
    if (!isDevSceneRebuildRunning || devSceneRebuildStage !== "compose") return;
    if (!isDevSceneRebuildRenderingMessageVisible) return;
    clearSceneRebuildComposeGuardTimers();
  }, [
    clearSceneRebuildComposeGuardTimers,
    devSceneRebuildStage,
    isDevSceneRebuildRenderingMessageVisible,
    isDevSceneRebuildRunning,
  ]);

  const handleDevRebuildActiveVersion = useCallback(
    async (options?: {
      placementIntent?: "user_directed" | "model_decided";
      modelDecidedFurnitureCandidates?: ModelDecidedFurnitureCandidatePayload[];
      successMessage?: string;
      signal?: AbortSignal;
    }) => {
    if (isDevSceneRebuildRunning) return;

    if (!vibodeRoomId || !selectedVersionId) {
      const missingMessage = !vibodeRoomId
        ? "Select an active room before rebuilding."
        : "Select an active version before rebuilding.";
      setDevSceneRebuildFeedback({ tone: "error", message: missingMessage });
      pushSnack(missingMessage);
      return;
    }

    const sourceVersionIdForRenderState = selectedVersionId;
    setIsDevSceneRebuildRunning(true);
    setDevSceneRebuildStage("compose");
    setIsDevSceneRebuildRenderingMessageVisible(false);
    setIsDevSceneRebuildComposeWarningVisible(false);
    setDevSceneRebuildFeedback(null);

    const controller = new AbortController();
    sceneRebuildAbortControllerRef.current?.abort();
    sceneRebuildAbortControllerRef.current = controller;
    sceneRebuildAbortReasonRef.current = null;
    clearSceneRebuildComposeTimers();
    sceneRebuildRenderingMessageTimerRef.current = window.setTimeout(() => {
      setIsDevSceneRebuildRenderingMessageVisible(true);
      clearSceneRebuildComposeGuardTimers();
    }, SCENE_REBUILD_RENDERING_MESSAGE_DELAY_MS);
    sceneRebuildComposeWarningTimerRef.current = window.setTimeout(() => {
      setIsDevSceneRebuildComposeWarningVisible(true);
    }, SCENE_REBUILD_COMPOSE_WARNING_MS);
    sceneRebuildComposeTimeoutTimerRef.current = window.setTimeout(() => {
      sceneRebuildAbortReasonRef.current = "compose_timeout";
      controller.abort();
    }, SCENE_REBUILD_COMPOSE_TIMEOUT_MS);

    try {
      let accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        accessToken = await tryGetSupabaseAccessToken();
      }
      if (!accessToken) {
        throw new Error("No Supabase session.");
      }

      const res = await fetch("/api/vibode/scene-rebuild", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          roomId: vibodeRoomId,
          versionId: selectedVersionId,
          activate: true,
          placementIntent: options?.placementIntent ?? "user_directed",
          modelDecidedFurnitureCandidates: options?.modelDecidedFurnitureCandidates,
          triggerMode:
            options?.placementIntent === "model_decided" ? "model_decided_auto_place" : undefined,
        }),
        signal: options?.signal ?? controller.signal,
      });
      clearSceneRebuildComposeTimers();
      setIsDevSceneRebuildRenderingMessageVisible(false);
      setIsDevSceneRebuildComposeWarningVisible(false);
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        outputVersionId?: string;
        details?: {
          code?: string;
          helper?: string;
        };
      };
      if (!res.ok) {
        if (json.details?.code === "compose_timeout") {
          const timeoutTitle = "Room preparation took too long";
          const timeoutHelper =
            json.details.helper ??
            "Vibode couldn't finish preparing your room layout. Please try again.";
          setDevSceneRebuildFeedback({
            tone: "error",
            message: timeoutTitle,
            title: timeoutTitle,
            helper: timeoutHelper,
          });
          pushSnack(timeoutTitle);
          return;
        }
        if (json.details?.code === "compose_cancelled" || json.details?.code === "request_cancelled") {
          setDevSceneRebuildFeedback(null);
          return;
        }
        const generationFailureMessage = json.error ?? json.message ?? null;
        if (res.status === 502 || isSceneRebuildGenerationFailure(generationFailureMessage)) {
          const generationFailureTitle = "Room rendering failed";
          const generationFailureHelper =
            "Vibode couldn't finish generating your updated room. Please try again.";
          setDevSceneRebuildFeedback({
            tone: "error",
            message: generationFailureTitle,
            title: generationFailureTitle,
            helper: generationFailureHelper,
          });
          pushSnack(generationFailureTitle);
          return;
        }
        throw new Error(json.error || json.message || `Scene rebuild failed (HTTP ${res.status})`);
      }

      setDevSceneRebuildStage("persist");
      const latestVersions = await refreshRoomVersions(vibodeRoomId);
      const refreshedActiveVersion =
        latestVersions?.find((asset) => asset.is_active) ??
        latestVersions?.find((asset) => asset.id === json.outputVersionId) ??
        latestVersions?.[0] ??
        null;
      if (refreshedActiveVersion && latestVersions) {
        applyVersionToEditorState(refreshedActiveVersion, latestVersions);
      }
      if (latestVersions && !refreshedActiveVersion) {
        console.warn("[scene-render-state] active output asset missing after rebuild", {
          roomId: vibodeRoomId,
          outputVersionId: json.outputVersionId ?? null,
        });
      }
      if (latestVersions && refreshedActiveVersion) {
        try {
          const persistedPlacementNodes = await loadPlacementLayerNodesForVersion({
            roomId: vibodeRoomId,
            versionId: refreshedActiveVersion.id,
            accessToken,
          });
          const { renderedPlacementSnapshot, placementStateHash } =
            await computePlacementStateHashAndSnapshot(persistedPlacementNodes);
          const sceneRenderState = {
            renderedPlacementStateHash: placementStateHash,
            renderedPlacementSnapshot,
            renderedAt: new Date().toISOString(),
            sourceVersionId: sourceVersionIdForRenderState ?? null,
          };
          // Safer long-term: move this metadata write into /api/vibode/scene-rebuild for atomicity.
          const updatedMetadata = await persistSceneRenderStateForVersion({
            roomId: vibodeRoomId,
            assetId: refreshedActiveVersion.id,
            accessToken,
            sceneRenderState,
          });
          let sourceVersionUpdatedMetadata: Record<string, unknown> | null = null;
          if (
            sourceVersionIdForRenderState &&
            sourceVersionIdForRenderState !== refreshedActiveVersion.id
          ) {
            const sourcePlacementNodes = await loadPlacementLayerNodesForVersion({
              roomId: vibodeRoomId,
              versionId: sourceVersionIdForRenderState,
              accessToken,
            });
            const sourcePlacementRenderState =
              await computePlacementStateHashAndSnapshot(sourcePlacementNodes);
            const sourceSceneRenderState = {
              renderedPlacementStateHash: sourcePlacementRenderState.placementStateHash,
              renderedPlacementSnapshot: sourcePlacementRenderState.renderedPlacementSnapshot,
              renderedAt: new Date().toISOString(),
              sourceVersionId: sourceVersionIdForRenderState,
            };
            sourceVersionUpdatedMetadata = await persistSceneRenderStateForVersion({
              roomId: vibodeRoomId,
              assetId: sourceVersionIdForRenderState,
              accessToken,
              sceneRenderState: sourceSceneRenderState,
            });
          }
          setVersions(
            latestVersions.map((asset) => {
              if (asset.id === refreshedActiveVersion.id) {
                return {
                  ...asset,
                  metadata:
                    updatedMetadata ??
                    {
                      ...(isRecord(asset.metadata) ? asset.metadata : {}),
                      sceneRenderState,
                    },
                };
              }
              if (asset.id === sourceVersionIdForRenderState && sourceVersionUpdatedMetadata) {
                return {
                  ...asset,
                  metadata: sourceVersionUpdatedMetadata,
                };
              }
              return asset;
            })
          );
          sceneDirtyLocallyConfirmedRef.current = false;
          setSceneNeedsUpdate(false);
        } catch (err: unknown) {
          console.warn("[scene-render-state] metadata persistence failed", {
            roomId: vibodeRoomId,
            outputVersionId: refreshedActiveVersion.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const successMessage = options?.successMessage ?? "Scene rebuild complete.";
      setDevSceneRebuildFeedback({ tone: "success", message: successMessage });
      pushSnack(successMessage);
    } catch (err: unknown) {
      if (isAbortError(err)) {
        const abortReason = sceneRebuildAbortReasonRef.current;
        if (abortReason === "compose_timeout") {
          const timeoutTitle = "Room preparation took too long";
          const timeoutHelper =
            "Vibode couldn't finish preparing your room layout. Please try again.";
          setDevSceneRebuildFeedback({
            tone: "error",
            message: timeoutTitle,
            title: timeoutTitle,
            helper: timeoutHelper,
          });
          pushSnack(timeoutTitle);
        } else if (abortReason === "user_cancel") {
          setDevSceneRebuildFeedback(null);
          pushSnack("Update cancelled.");
        }
        return;
      }
      const message = getErrorMessage(err) ?? "Scene rebuild failed.";
      if (isSceneRebuildGenerationFailure(message)) {
        const generationFailureTitle = "Room rendering failed";
        const generationFailureHelper =
          "Vibode couldn't finish generating your updated room. Please try again.";
        setDevSceneRebuildFeedback({
          tone: "error",
          message: generationFailureTitle,
          title: generationFailureTitle,
          helper: generationFailureHelper,
        });
        pushSnack(generationFailureTitle);
      } else {
        setDevSceneRebuildFeedback({ tone: "error", message });
        pushSnack(message);
      }
    } finally {
      clearSceneRebuildComposeTimers();
      clearSceneRebuildAbortController(controller);
      sceneRebuildAbortReasonRef.current = null;
      setDevSceneRebuildStage(null);
      setIsDevSceneRebuildRenderingMessageVisible(false);
      setIsDevSceneRebuildComposeWarningVisible(false);
      setIsDevSceneRebuildRunning(false);
    }
    },
    [
    applyVersionToEditorState,
    clearSceneRebuildAbortController,
    clearSceneRebuildComposeGuardTimers,
    clearSceneRebuildComposeTimers,
    computePlacementStateHashAndSnapshot,
    isDevSceneRebuildRunning,
    pushSnack,
    refreshRoomVersions,
    selectedVersionId,
    setVersions,
    vibodeRoomId,
    ]
  );

  const handleRevertPlacementChanges = useCallback(async () => {
    if (isRevertingPlacementChanges) return;

    const renderedSnapshot = selectedVersionRenderedPlacementSnapshot;
    if (!vibodeRoomId || !selectedVersionId || !renderedSnapshot) {
      const missingMessage = !vibodeRoomId
        ? "Select an active room before reverting."
        : !selectedVersionId
          ? "Select an active version before reverting."
          : "No rendered furniture snapshot is available for this version.";
      pushSnack(missingMessage);
      return;
    }

    const expectedVersionId = selectedVersionId;
    setIsRevertingPlacementChanges(true);

    try {
      let accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        accessToken = await tryGetSupabaseAccessToken();
      }
      if (!accessToken) {
        throw new Error("No Supabase session.");
      }

      const revertedNodes = await revertPlacementLayerNodesToSnapshot({
        roomId: vibodeRoomId,
        versionId: expectedVersionId,
        accessToken,
        snapshot: renderedSnapshot,
      });

      if (selectedVersionIdRef.current !== expectedVersionId) return;

      const renderedHash = selectedVersionRenderedPlacementStateHashRef.current;
      if (renderedHash) {
        const revertedHash = await hashPlacementState(revertedNodes);
        if (revertedHash !== renderedHash) {
          throw new Error("Reverted placement state hash mismatch.");
        }
      }

      placementLayerNodesRef.current = revertedNodes;
      setPlacementLayerNodes(revertedNodes);
      sceneDirtyLocallyConfirmedRef.current = false;
      setSceneNeedsUpdate(false);
      pushSnack("Reverted furniture changes.");
    } catch (err) {
      console.warn("[room-furniture-placements][revert] failed", err);
      pushSnack(getErrorMessage(err) ?? "Couldn't revert furniture changes.");
    } finally {
      setIsRevertingPlacementChanges(false);
    }
  }, [
    isRevertingPlacementChanges,
    pushSnack,
    selectedVersionId,
    selectedVersionRenderedPlacementSnapshot,
    vibodeRoomId,
  ]);

  const handleRestoreOriginalPlacementPositions = useCallback(async () => {
    if (isRestoringOriginalPlacementPositions) return;

    const originalSnapshot = selectedVersionOriginalPlacementSnapshot;
    if (!vibodeRoomId || !selectedVersionId || !originalSnapshot) {
      const missingMessage = !vibodeRoomId
        ? "Select an active room before restoring positions."
        : !selectedVersionId
          ? "Select an active version before restoring positions."
          : "Original placement positions aren't available for this version yet.";
      pushSnack(missingMessage);
      return;
    }

    const expectedVersionId = selectedVersionId;
    setIsRestoringOriginalPlacementPositions(true);

    try {
      let accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        accessToken = await tryGetSupabaseAccessToken();
      }
      if (!accessToken) {
        throw new Error("No Supabase session.");
      }

      const restoredNodes = await revertPlacementLayerNodesToSnapshot({
        roomId: vibodeRoomId,
        versionId: expectedVersionId,
        accessToken,
        snapshot: originalSnapshot,
      });
      if (selectedVersionIdRef.current !== expectedVersionId) return;

      const restoredRenderState = await computePlacementStateHashAndSnapshot(restoredNodes);
      const expectedOriginalHash = selectedVersionOriginalPlacementStateHashRef.current;
      if (
        expectedOriginalHash &&
        restoredRenderState.placementStateHash !== expectedOriginalHash &&
        expectedVersionId === selectedVersionIdRef.current
      ) {
        throw new Error("Restored placement state hash mismatch.");
      }

      const sceneRenderState = {
        renderedPlacementStateHash: restoredRenderState.placementStateHash,
        renderedPlacementSnapshot: restoredRenderState.renderedPlacementSnapshot,
        renderedAt: new Date().toISOString(),
        sourceVersionId: expectedVersionId,
      };
      const updatedMetadata = await persistSceneRenderStateForVersion({
        roomId: vibodeRoomId,
        assetId: expectedVersionId,
        accessToken,
        sceneRenderState,
      });
      if (selectedVersionIdRef.current !== expectedVersionId) return;

      placementLayerNodesRef.current = restoredNodes;
      setPlacementLayerNodes(restoredNodes);
      setVersions(
        versions.map((asset) =>
          asset.id === expectedVersionId
            ? {
                ...asset,
                metadata:
                  updatedMetadata ??
                  {
                    ...(isRecord(asset.metadata) ? asset.metadata : {}),
                    sceneRenderState,
                  },
              }
            : asset
        )
      );
      sceneDirtyLocallyConfirmedRef.current = false;
      setSceneNeedsUpdate(false);
      setCanRestoreOriginalPlacementPositions(false);
      pushSnack("Restored original placement positions.");
    } catch (err) {
      console.warn("[room-furniture-placements][restore-original] failed", err);
      pushSnack(getErrorMessage(err) ?? "Couldn't restore original placement positions.");
    } finally {
      setIsRestoringOriginalPlacementPositions(false);
    }
  }, [
    computePlacementStateHashAndSnapshot,
    isRestoringOriginalPlacementPositions,
    pushSnack,
    selectedVersionId,
    selectedVersionOriginalPlacementSnapshot,
    setVersions,
    versions,
    vibodeRoomId,
  ]);

  const handleRequestDeleteVersion = useCallback(
    (asset: VibodeRoomAsset) => {
      if (!canDeleteVersions) return;
      if (deletingVersionId) return;
      setDeleteVersionTarget(asset);
    },
    [canDeleteVersions, deletingVersionId]
  );

  const handleConfirmDeleteVersion = useCallback(async () => {
    if (!deleteVersionTarget) return;
    if (deletingVersionId) return;
    if (!vibodeRoomId || versions.length <= 1) {
      setDeleteVersionTarget(null);
      pushSnack("Couldn't delete that version right now.");
      return;
    }

    const target = deleteVersionTarget;
    setDeletingVersionId(target.id);
    try {
      let accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        accessToken = await tryGetSupabaseAccessToken();
      }
      if (!accessToken) {
        throw new Error("No Supabase session.");
      }

      const result = await deleteVersionForRoom({
        roomId: vibodeRoomId,
        assetId: target.id,
        accessToken,
      });
      const latestVersions = await refreshRoomVersions(vibodeRoomId);

      if (result.deletedWasActive) {
        const trustedVersions =
          latestVersions ?? (await loadRoomVersions(vibodeRoomId, accessToken));
        if (!latestVersions) {
          setVersions(trustedVersions);
          setActiveAssetId(trustedVersions.find((asset) => asset.is_active)?.id ?? null);
        }
        const nextActive =
          trustedVersions.find((asset) => asset.id === result.nextActiveAssetId) ??
          trustedVersions.find((asset) => asset.is_active) ??
          trustedVersions[0] ??
          null;
        if (!nextActive || !applyVersionToEditorState(nextActive, trustedVersions)) {
          throw new Error("No replacement active version after delete.");
        }
      }

      pushSnack("Version deleted.");
      setDeleteVersionTarget(null);
    } catch (err) {
      console.warn("[editor] failed to delete room version:", err);
      pushSnack("Couldn't delete that version right now.");
    } finally {
      setDeletingVersionId(null);
    }
  }, [
    applyVersionToEditorState,
    deleteVersionTarget,
    deletingVersionId,
    pushSnack,
    refreshRoomVersions,
    setActiveAssetId,
    setVersions,
    vibodeRoomId,
    versions.length,
  ]);
  const handleToggleVersionFavourite = useCallback(
    async (asset: EditorVersionWithKind) => {
      if (!vibodeRoomId) {
        pushSnack("Couldn't update favourites right now.");
        return;
      }
      if (!isVersionEligibleForFavourite(asset)) return;
      if (togglingFavouriteVersionId) return;

      const currentIsFavourite = isVersionFavourited(asset);
      const nextIsFavourite = !currentIsFavourite;

      setTogglingFavouriteVersionId(asset.id);
      const optimisticVersions = versions.map((version) =>
        version.id === asset.id
          ? {
              ...version,
              metadata: {
                ...(isRecord(version.metadata) ? version.metadata : {}),
                isFavourite: nextIsFavourite,
              },
            }
          : version
      );
      setVersions(optimisticVersions);

      try {
        let accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          accessToken = await tryGetSupabaseAccessToken();
        }
        if (!accessToken) {
          throw new Error("No Supabase session.");
        }

        const updatedMetadata = await persistVersionMetadataPatchForRoom({
          roomId: vibodeRoomId,
          assetId: asset.id,
          accessToken,
          metadataPatch: { isFavourite: nextIsFavourite },
        });

        if (updatedMetadata) {
          setVersions(
            optimisticVersions.map((version) =>
              version.id === asset.id
                ? {
                    ...version,
                    metadata: updatedMetadata,
                  }
                : version
            )
          );
        }
      } catch (err) {
        console.warn("[editor] failed to toggle version favourite:", err);
        setVersions(
          versions.map((version) =>
            version.id === asset.id
              ? {
                  ...version,
                  metadata: {
                    ...(isRecord(version.metadata) ? version.metadata : {}),
                    isFavourite: currentIsFavourite,
                  },
                }
              : version
          )
        );
        pushSnack("Couldn't update favourites right now.");
      } finally {
        setTogglingFavouriteVersionId(null);
      }
    },
    [
      isVersionEligibleForFavourite,
      isVersionFavourited,
      pushSnack,
      setVersions,
      togglingFavouriteVersionId,
      vibodeRoomId,
      versions,
    ]
  );

  const isImageFile = (file: File | null | undefined) =>
    !!file && typeof file.type === "string" && file.type.startsWith("image/");
  const isPreparingRoomPhotoUpload = isUploading || isOptimizingRoomImage;

  const hasDraggedImageFile = (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return false;

    const items = Array.from(dataTransfer.items ?? []);
    if (items.some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
      return true;
    }

    const files = Array.from(dataTransfer.files ?? []);
    return files.some((file) => isImageFile(file));
  };

  const handleRoomPhotoFile = async (file: File) => {
    if (!isImageFile(file)) {
      const message = "Please upload a JPG, PNG, or WebP image.";
      setRoomPhotoUploadError(message);
      pushSnack(message);
      return;
    }

    setRoomPhotoUploadError(null);
    let uploadFile: File;

    setIsOptimizingRoomImage(true);
    try {
      uploadFile = await prepareRoomImageForUpload(file);
    } catch (err: unknown) {
      const message =
        err instanceof PrepareRoomImageError
          ? err.message
          : "We couldn’t process this image. Try a smaller or lower-resolution photo.";
      setRoomPhotoUploadError(message);
      pushSnack(message);
      return;
    } finally {
      setIsOptimizingRoomImage(false);
    }

    resetWorkflowForIncomingImage();

    // 1) Instant preview (blob)
    setBaseImageFromFile(uploadFile);
    pushSnack("Room photo added. Uploading securely...");

    // 2) Upload to storage + swap to signed URL (kills blob in payload)
    setIsUploading(true);
    try {
      let accessToken = await tryGetSupabaseAccessToken();
      if (!accessToken) {
        // Small retry to reduce early-click hydration races right after page load.
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        accessToken = await tryGetSupabaseAccessToken();
      }

      if (!accessToken) {
        console.warn("[upload-base][auth-diag]", {
          tokenPresent: false,
          tokenLength: 0,
          authorizationHeaderAttached: false,
        });
        pushSnack("Your session expired. Redirecting to sign in...");
        router.push(`/login?next=${encodeURIComponent("/editor")}`);
        return;
      }

      const sceneId = useEditorStore.getState().scene.sceneId;
      const up = await uploadBaseImageToStorage({
        file: uploadFile,
        sceneId,
        selectedModel,
        aspectRatio: currentAspectRatioForUpload,
        accessToken,
      });
      await preloadImage(up.signedUrl);

      setBaseImageUrl(up.signedUrl);
      setWorkingImageUrl(up.signedUrl);
      setIsWorkingImageGenerated(false);
      setVibodeRoomId(up.vibodeRoomId ?? null);
      let resolvedAssetId: string | null = null;
      if (up.vibodeRoomId) {
        const latestVersions = await refreshRoomVersions(up.vibodeRoomId);
        const baseAsset = latestVersions?.find((asset) => asset.asset_type === "base") ?? null;
        const activeAsset = latestVersions?.find((asset) => asset.is_active) ?? null;
        setRoomBaseAssetId(baseAsset?.id ?? null);
        resolvedAssetId = activeAsset?.id ?? baseAsset?.id ?? null;
        setActiveAssetId(resolvedAssetId);
      }
      // Intentional SET-canonical geometry prewarm for base room images.
      setIsSetGeometryPrewarming(true);
      void (async () => {
        try {
          await hydrateRoomImageObjects({
            trigger: "set-base-upload",
            imageUrl: up.signedUrl,
            roomId: up.vibodeRoomId ?? null,
            assetId: resolvedAssetId,
            versionId: resolvedAssetId,
            mode: "geometry",
            allowRoomReadOnMiss: true,
          });
        } catch (err) {
          console.warn("[room-image-objects] SET geometry prewarm failed", err);
        } finally {
          setIsSetGeometryPrewarming(false);
        }
      })();
      pushSnack("Room photo uploaded.");
    } catch (err: unknown) {
      console.error(err);
      setVibodeRoomId(null);
      setRoomMetadata(null);
      setRoomBaseAssetId(null);
      const message = "Upload didn't finish. Keeping your local preview for now.";
      setRoomPhotoUploadError(message);
      pushSnack(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRoomPhotoInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = event.currentTarget;
    const file = inputEl.files?.[0];
    if (!file) return;

    try {
      await handleRoomPhotoFile(file);
    } finally {
      // allow re-pick same file
      inputEl.value = "";
    }
  };

  const handleCanvasDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isCanvasEmpty || !hasDraggedImageFile(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    roomPhotoCanvasDragDepthRef.current += 1;
    setIsCanvasDragOver(true);
  };

  const handleCanvasDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isCanvasEmpty || !hasDraggedImageFile(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isCanvasDragOver) {
      setIsCanvasDragOver(true);
    }
  };

  const handleCanvasDragLeave = () => {
    if (!isCanvasEmpty) return;
    roomPhotoCanvasDragDepthRef.current = Math.max(0, roomPhotoCanvasDragDepthRef.current - 1);
    if (roomPhotoCanvasDragDepthRef.current === 0) {
      setIsCanvasDragOver(false);
    }
  };

  const handleCanvasDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!isCanvasEmpty) return;
    roomPhotoCanvasDragDepthRef.current = 0;
    setIsCanvasDragOver(false);

    const imageFile = Array.from(event.dataTransfer.files ?? []).find((file) => isImageFile(file));
    if (!imageFile) return;

    event.preventDefault();
    await handleRoomPhotoFile(imageFile);
  };

  useEffect(() => {
    if (!isCanvasEmpty && isCanvasDragOver) {
      roomPhotoCanvasDragDepthRef.current = 0;
      setIsCanvasDragOver(false);
    }
  }, [isCanvasDragOver, isCanvasEmpty]);

  const handleDownloadPreview = async () => {
    if (!previewImageUrl || isDownloading) return;

    setIsDownloading(true);
    try {
      const response = await fetch(previewImageUrl);
      if (!response.ok) {
        throw new Error(`Download failed (HTTP ${response.status}).`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const filename = workingImageUrl
        ? `vibode-edit-stage-${activeStage}.png`
        : activeStageOutputImageUrl
          ? `vibode-stage-${activeStage}.png`
          : "vibode-original.png";

      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }

      pushSnack("Downloaded current preview.");
    } catch (err: unknown) {
      const errMessage = getErrorMessage(err);
      const message = errMessage
        ? `Download failed. ${errMessage}`
        : "Download failed. Please try again.";
      console.warn("[download-preview] failed", err);
      pushSnack(message);
    } finally {
      setIsDownloading(false);
    }
  };

  const removeLabelOptions = useMemo(() => {
    const labels = Array.from(
      new Set(
        detectedRoomObjectLabels
          .map((item) => item.label)
          .filter((label) => label !== REMOVE_LABEL_FALLBACK)
      )
    );
    return [...labels, REMOVE_LABEL_FALLBACK];
  }, [detectedRoomObjectLabels]);

  useEffect(() => {
    if (selectedRemoveLabel === REMOVE_LABEL_PLACEHOLDER) {
      return;
    }
    if (!removeLabelOptions.includes(selectedRemoveLabel)) {
      setSelectedRemoveLabel(REMOVE_LABEL_PLACEHOLDER);
    }
  }, [removeLabelOptions, selectedRemoveLabel]);

  const removeModeOverlayTargets = useMemo<RemoveModeOverlayTarget[]>(() => {
    const next: RemoveModeOverlayTarget[] = [];
    removeModeObjects.forEach((object, index) => {
      const key = deriveDetectedRemoveObjectKey(object, index);
      const bbox = object.bbox;
      const hasBboxAnchor =
        bbox &&
        Number.isFinite(bbox.x) &&
        Number.isFinite(bbox.y) &&
        Number.isFinite(bbox.w) &&
        Number.isFinite(bbox.h);
      const centerX =
        hasBboxAnchor && bbox
          ? bbox.x + bbox.w / 2
          : typeof object.centerX === "number" && Number.isFinite(object.centerX)
            ? object.centerX
            : null;
      const centerY =
        hasBboxAnchor && bbox
          ? bbox.y
          : typeof object.centerY === "number" && Number.isFinite(object.centerY)
            ? object.centerY
            : null;
      if (centerX === null || centerY === null) return;
      const override = removeModeObjectTargetOverrides[key] ?? null;
      const xNorm =
        override && Number.isFinite(override.xNorm)
          ? clampUnit(override.xNorm)
          : Math.max(0, Math.min(1, centerX));
      const yNorm =
        override && Number.isFinite(override.yNorm)
          ? clampUnit(override.yNorm)
          : Math.max(0, Math.min(1, centerY));
      next.push({
        key,
        label: object.label,
        xNorm,
        yNorm,
        confidence: object.confidence,
      });
    });
    return next;
  }, [removeModeObjectTargetOverrides, removeModeObjects]);
  const removeModeGuidanceManifestDraft = useMemo(
    () =>
      deriveRemoveModeGuidanceManifest({
        removeModeObjects,
        selectedRemoveObjectKeys,
        removeModeManualMarkers,
        removeModeObjectTargetOverrides,
      }),
    [
      removeModeManualMarkers,
      removeModeObjectTargetOverrides,
      removeModeObjects,
      selectedRemoveObjectKeys,
    ]
  );
  const removeModeGuidanceDraftSignature = useMemo(
    () =>
      JSON.stringify({
        detected: removeModeGuidanceManifestDraft.detectedTargets.map((target) => ({
          sourceKey: target.sourceKey,
          number: target.number,
          xNorm: Number(target.xNorm.toFixed(5)),
          yNorm: Number(target.yNorm.toFixed(5)),
          label: target.label,
        })),
        manual: removeModeGuidanceManifestDraft.manualTargets.map((target) => ({
          sourceKey: target.sourceKey,
          xNorm: Number(target.xNorm.toFixed(5)),
          yNorm: Number(target.yNorm.toFixed(5)),
        })),
      }),
    [removeModeGuidanceManifestDraft]
  );
  const isRemoveModeGuidanceFresh = useMemo(
    () =>
      Boolean(
        removeModeGuidanceImageDataUrl &&
          removeModeGuidanceManifest &&
          removeModeGuidancePromptText &&
          removeModeGuidancePreparedSignature &&
          removeModeGuidancePreparedSignature === removeModeGuidanceDraftSignature
      ),
    [
      removeModeGuidanceDraftSignature,
      removeModeGuidanceImageDataUrl,
      removeModeGuidanceManifest,
      removeModeGuidancePreparedSignature,
      removeModeGuidancePromptText,
    ]
  );
  useEffect(() => {
    if (!removeModeGuidanceImageDataUrl) return;
    if (!removeModeGuidancePreparedSignature) return;
    if (removeModeGuidancePreparedSignature === removeModeGuidanceDraftSignature) return;
    setRemoveModeGuidanceImageDataUrl(null);
    setRemoveModeGuidanceManifest(null);
    setRemoveModeGuidancePromptText("");
    setRemoveModeGuidancePreparedSignature("");
    setRemoveModeGuidanceTargetCount(0);
  }, [
    removeModeGuidanceDraftSignature,
    removeModeGuidanceImageDataUrl,
    removeModeGuidancePreparedSignature,
  ]);
  useEffect(() => {
    if (!removeModeGuidancePromptText) return;
    if (!isRoomOpenDebugEnabled()) return;
    console.log("[remove-mode] guidance prompt preview", {
      prompt: removeModeGuidancePromptText,
    });
  }, [removeModeGuidancePromptText]);

  const queuedDeletes = useMemo(
    () => nodes.filter((n) => n.status === "markedForDelete").length,
    [nodes]
  );

  const queuedSwaps = useMemo(
    () => nodes.filter((n) => n.status === "pendingSwap").length,
    [nodes]
  );

  const swapTargetNode = useMemo(() => {
    if (!swapTargetId) return null;
    return nodes.find((n) => n.id === swapTargetId) ?? null;
  }, [nodes, swapTargetId]);

  const collection = useMemo(() => {
    const id = scene.collection?.collectionId;
    if (!id) return null;
    return MOCK_COLLECTIONS.find((c) => c.collectionId === id) ?? null;
  }, [scene.collection?.collectionId]);

  const swapTargetSku = useMemo(() => {
    if (!collection || !swapTargetNode) return null;
    const rawSku = (collection.catalog as Record<string, unknown>)[swapTargetNode.skuId];
    if (!isRecord(rawSku)) return null;
    const skuId = safeStr(rawSku.skuId);
    const label = safeStr(rawSku.label);
    if (!skuId || !label) return null;
    const variantsRaw = Array.isArray(rawSku.variants) ? rawSku.variants : [];
    const variants = variantsRaw
      .map((variant) => {
        if (!isRecord(variant)) return null;
        const variantId = safeStr(variant.variantId);
        if (!variantId) return null;
        return {
          variantId,
          label: safeStr(variant.label) ?? variantId,
        };
      })
      .filter((variant): variant is { variantId: string; label: string } => Boolean(variant));

    return { skuId, label, variants };
  }, [collection, swapTargetNode]);
  const ingestedSourceHost = useMemo(() => {
    if (!ingestedUserSku) return null;
    const source =
      ingestedUserSku.sourceUrl ?? (uploadedImageDataUrl ? null : productImageUrl.trim());
    if (!source) return null;
    try {
      return new URL(source).hostname;
    } catch {
      return null;
    }
  }, [ingestedUserSku, productImageUrl, uploadedImageDataUrl]);
  const hasIngestedSkuBeenAdded = useMemo(() => {
    if (!ingestedUserSku) return false;
    return userSkusAddedToStage3.some((sku) => sku.skuId === ingestedUserSku.skuId);
  }, [ingestedUserSku, userSkusAddedToStage3]);
  const hasProductImageInput = useMemo(
    () => Boolean(productImageUrl.trim() || uploadedImageDataUrl),
    [productImageUrl, uploadedImageDataUrl]
  );

  const closeSwap = () => {
    if (swapTargetId) setPendingSwap(swapTargetId, false);
    setSwapOpen(false);
    setSwapTargetId(null);
  };

  const fetchAndNormalizeProductImage = async () => {
    const imageUrl = productImageUrl.trim();
    const imageBase64 = uploadedImageDataUrl;
    if (!imageBase64 && !imageUrl) {
      setIngestError("Please paste a product image URL or upload an image.");
      return;
    }

    setIsIngesting(true);
    setIngestError(null);
    setIngestedUserSku(null);

    try {
      const accessToken = await tryGetSupabaseAccessToken();
      const res = await fetch("/api/vibode/user-skus/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-roomprintz-ingest-source": uploadedImageDataUrl ? "upload" : "product_url",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          ...(imageBase64 ? { imageBase64 } : { imageUrl }),
          label: productLabel.trim() || "User Upload",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        userSku?: UserSku;
        error?: string;
        savedFurniture?: unknown;
      };

      if (!res.ok) {
        throw new Error(json.error || "Failed to normalize image.");
      }

      if (!json.userSku) {
        throw new Error("Ingest response missing userSku.");
      }

      setIngestedUserSku(json.userSku);
      if (json.userSku.status === "failed") {
        setIngestError(json.userSku.reason ?? "Normalization failed.");
      } else if (json.userSku.status === "ready" && isRecord(json.savedFurniture)) {
        pushSnack("Saved to My Furniture.");
      }
    } catch (err: unknown) {
      setIngestError(getErrorMessage(err) ?? "Failed to normalize image.");
    } finally {
      setIsIngesting(false);
    }
  };

  const addIngestedSkuToRoom = () => {
    if (!ingestedUserSku || ingestedUserSku.status !== "ready") return;

    setUserSkusAddedToStage3((prev) =>
      prev.some((sku) => sku.skuId === ingestedUserSku.skuId) ? prev : [...prev, ingestedUserSku]
    );
    setStage3SkuItems((prev) => mergeStage3SkuItems(prev, [ingestedUserSku]));
    pushSnack("Added to Stage 3 items.");
  };


  const clearUploadedProductImage = () => {
    setUploadedImageDataUrl(null);
    setUploadedImageName(null);
    setIngestError(null);
    setIngestedUserSku(null);
  };

  const onUploadedProductImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = event.currentTarget;
    const file = inputEl.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadedImageDataUrl(null);
      setUploadedImageName(null);
      setIngestedUserSku(null);
      setIngestError("Please select an image file (.jpg/.png).");
      inputEl.value = "";
      return;
    }

    if (file.size > USER_SKU_MAX_INPUT_BYTES) {
      setUploadedImageDataUrl(null);
      setUploadedImageName(null);
      setIngestedUserSku(null);
      setIngestError("Image is too large. Please upload a file up to 12MB.");
      inputEl.value = "";
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith("data:image/")) {
        throw new Error("Please select a valid image file.");
      }
      setUploadedImageDataUrl(dataUrl);
      setUploadedImageName(file.name || "uploaded-image");
      setIngestError(null);
      setIngestedUserSku(null);
    } catch (err: unknown) {
      setUploadedImageDataUrl(null);
      setUploadedImageName(null);
      setIngestedUserSku(null);
      setIngestError(getErrorMessage(err) ?? "Failed to read uploaded image.");
    } finally {
      // Allow selecting the same file again on subsequent picks.
      inputEl.value = "";
    }
  };

  const eligibleForDrag = workingSet.eligibleSkus ?? [];
  const selectedSwapMark = useMemo(() => {
    if (!selectedSwapMarkId) return null;
    return (scene.swapMarks ?? []).find((m) => m.id === selectedSwapMarkId) ?? null;
  }, [scene.swapMarks, selectedSwapMarkId]);
  const rotateMarks = scene.rotateMarks ?? [];
  const hasRotateMarks = rotateMarks.length > 0;
  const showSwapReplacementPicker = activeTool === "swap" && !!selectedSwapMarkId;
  const swapReplacementOptions = useMemo(() => {
    const eligibleIds = new Set(
      (workingSet.eligibleSkus ?? [])
        .map((item) => (isRecord(item) && typeof item.skuId === "string" ? item.skuId : null))
        .filter((skuId): skuId is string => Boolean(skuId))
    );
    const preferred = IKEA_CA_SKUS.filter((sku) => eligibleIds.has(sku.skuId));
    const source = preferred.length > 0 ? preferred : IKEA_CA_SKUS;
    return source.slice(0, 12);
  }, [workingSet.eligibleSkus]);
  const canApplyCal =
    !!calibration?.draft?.p1 &&
    !!calibration?.draft?.p2 &&
    (calibration?.draft?.realFeet ?? 0) > 0;

  // Dims optional (lazy-user mode)
  const dims = scene.room?.dims;
  const width = dims?.widthFt ?? 0;
  const length = dims?.lengthFt ?? 0;
  const hasManualDims = width > 0 && length > 0;
  const sqft = hasManualDims ? Math.round(width * length * 10) / 10 : undefined;

  const isBusy = scene.phase === "GENERATING" || scene.phase === "STALL";
  const baseImageNaturalWidth =
    typeof scene.baseImageWidthPx === "number" && Number.isFinite(scene.baseImageWidthPx)
      ? scene.baseImageWidthPx
      : viewport?.imageNaturalW;
  const baseImageNaturalHeight =
    typeof scene.baseImageHeightPx === "number" && Number.isFinite(scene.baseImageHeightPx)
      ? scene.baseImageHeightPx
      : viewport?.imageNaturalH;
  const hasNaturalDims =
    typeof baseImageNaturalWidth === "number" &&
    baseImageNaturalWidth > 0 &&
    typeof baseImageNaturalHeight === "number" &&
    baseImageNaturalHeight > 0;
  const hasImageMapping =
    !!viewport &&
    Number.isFinite(viewport.imageStageX) &&
    Number.isFinite(viewport.imageStageY) &&
    Number.isFinite(viewport.imageStageW) &&
    Number.isFinite(viewport.imageStageH) &&
    Number.isFinite(viewport.scale) &&
    viewport.imageStageW > 0 &&
    viewport.imageStageH > 0 &&
    viewport.scale > 0;
  const hasFiniteConversionInputs = useMemo(() => {
    const numericInputs: number[] = [];

    if (typeof baseImageNaturalWidth === "number") numericInputs.push(baseImageNaturalWidth);
    if (typeof baseImageNaturalHeight === "number") numericInputs.push(baseImageNaturalHeight);

    if (viewport) {
      numericInputs.push(
        viewport.imageStageX,
        viewport.imageStageY,
        viewport.imageStageW,
        viewport.imageStageH,
        viewport.scale,
        viewport.imageNaturalW,
        viewport.imageNaturalH
      );
    }

    for (const node of nodes) {
      numericInputs.push(
        node.transform.x,
        node.transform.y,
        node.transform.width,
        node.transform.height,
        node.transform.rotation
      );
    }

    return numericInputs.every((value) => Number.isFinite(value));
  }, [baseImageNaturalHeight, baseImageNaturalWidth, nodes, viewport]);
  const imageSpaceReadinessReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!hasNaturalDims) reasons.push("missing natural dims");
    if (!hasImageMapping) reasons.push("missing mapping");
    if (!hasFiniteConversionInputs) reasons.push("invalid conversion inputs");
    return reasons;
  }, [hasFiniteConversionInputs, hasImageMapping, hasNaturalDims]);
  const isImageSpaceReady = hasNaturalDims && hasImageMapping && hasFiniteConversionInputs;

  const blobUrlToBase64 = async (blobUrl: string): Promise<string> => {
    const blobResponse = await fetch(blobUrl);
    const blob = await blobResponse.blob();

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read uploaded image blob."));
      reader.onloadend = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        const commaIndex = dataUrl.indexOf(",");
        if (commaIndex === -1) {
          reject(new Error("Failed to convert uploaded image to base64."));
          return;
        }
        resolve(dataUrl.slice(commaIndex + 1));
      };
      reader.readAsDataURL(blob);
    });
  };

  const isInlineImageSource = (value: unknown): value is string =>
    typeof value === "string" &&
    (value.startsWith("blob:") || value.startsWith("data:image/"));

  const sanitizeStageRunPayloadForLog = (payload: Record<string, unknown>) => {
    if (typeof payload.roomImageBase64 !== "string") return payload;
    return {
      ...payload,
      roomImageBase64: `[omitted base64, ${payload.roomImageBase64.length} chars]`,
    };
  };

  const STAGE5_DEV_BYPASS = process.env.NODE_ENV !== "production";

  const runStage = async (
    stageNumber: WorkflowStage,
    options: Record<string, unknown> = {},
    lifecycle?: {
      onImageCommitted?: (nextImageUrl: string) => void;
      beforeCommit?: () => boolean;
    },
    requestOptions?: {
      signal?: AbortSignal;
      suppressAbortError?: boolean;
      suppressCancellationError?: boolean;
      pasteToPlaceControl?: PasteToPlaceJobControl;
      pasteToPlaceSettlingRequestId?: string | null;
    }
  ) => {
    if (isOutOfTokens) {
      pushSnack("You're out of tokens.");
      return null;
    }
    const previousStageStatus = stageStatus[stageNumber];
    if (stageNumber === 5 && !hasFurniturePass && !STAGE5_DEV_BYPASS) {
      pushSnack("Stage 5 is locked until Stage 3 furniture pass succeeds.");
      return null;
    }

    const stage4ActionForRun: Stage4Action =
      stageNumber === 4
        ? isStage4Action(options.stage4Action)
          ? options.stage4Action
          : isStage4Action(options.mode)
            ? options.mode
            : isStage4Action(options.action)
              ? options.action
              : STAGE4_PRIMARY_ACTION
        : STAGE4_PRIMARY_ACTION;

    setStageStatus((prev) => ({ ...prev, [stageNumber]: "running" }));
    if (stageNumber === 4) {
      setStage4RunningAction(stage4ActionForRun);
    }

    try {
      const payload: Record<string, unknown> = {
        stage: stageNumber,
        stageNumber,
        modelVersion: selectedModel,
        vibodeRoomId: vibodeRoomId ?? undefined,
        pasteToPlaceControl: requestOptions?.pasteToPlaceControl,
      };
      const candidateUrl =
        typeof currentImageUrl === "string" && currentImageUrl.trim().length > 0
          ? currentImageUrl
          : null;
      const baseComesFromHistory =
        typeof candidateUrl === "string" &&
        history.some((record) => getHistoryRecordImageUrl(record) === candidateUrl);
      payload.isContinuation = isWorkingImageGenerated || baseComesFromHistory;
      if (typeof candidateUrl === "string" && candidateUrl.startsWith("blob:")) {
        payload.roomImageBase64 = await blobUrlToBase64(candidateUrl);
      } else if (
        typeof candidateUrl === "string" &&
        candidateUrl.startsWith("data:image/")
      ) {
        payload.roomImageBase64 =
          candidateUrl.split(",", 2)[1] ?? candidateUrl;
      } else {
        payload.baseImageUrl = candidateUrl;
      }

      if (stageNumber === 1) {
        const declutterMode =
          options.declutter === "off" ||
          options.declutter === "light" ||
          options.declutter === "heavy"
            ? options.declutter
            : stage1Declutter;
        const cleanupRoom = declutterMode === "light" || declutterMode === "heavy";
        const heavyDeclutter = declutterMode === "heavy";
        const emptyRoom = options.emptyRoom === true;

        payload.enhancePhoto =
          typeof options.enhance === "boolean" ? options.enhance : stage1Enhance;
        payload.cleanupRoom = cleanupRoom;
        payload.heavyDeclutter = heavyDeclutter;
        if (emptyRoom) {
          payload.emptyRoom = true;
          payload.stage1Mode = "empty_room";
        }
      } else if (stageNumber === 2) {
        payload.enhancePhoto = true;
        payload.repairDamage = stage2Repair;
        payload.repaintWalls = stage2Repaint;
        payload.flooringPreset = stage2Flooring !== "none" ? stage2Flooring : undefined;
      } else {
        payload.enhancePhoto = true;
      }

      if (stageNumber === 3 || stageNumber === 4) {
        if (stageNumber === 3) {
          const activeItems = stage3SkuItems.filter((item) => item.active);
          const defaultEligibleSkus = activeItems.map((item) => ({
            skuId: item.skuId,
            label: item.label || item.skuId,
            variants: (item.variants ?? [])
              .filter(
                (variant): variant is { imageUrl: string } =>
                  !!variant && typeof variant.imageUrl === "string"
              )
              .map((variant) => ({ imageUrl: variant.imageUrl })),
          }));
          const hasEligibleSkusOverride = Array.isArray(options.eligibleSkus);
          const hasTargetCountOverride =
            typeof options.targetCount === "number" && Number.isFinite(options.targetCount);

          payload.eligibleSkus = hasEligibleSkusOverride
            ? (options.eligibleSkus as typeof defaultEligibleSkus)
            : defaultEligibleSkus;
          payload.targetCount = hasTargetCountOverride ? options.targetCount : 8;
        } else if (stageNumber === 4) {
          payload.stage4Mode = stage4ActionForRun;
        }
      }

      if (stageNumber === 3) {
        const eligibleSkusForLog = Array.isArray(payload.eligibleSkus)
          ? (payload.eligibleSkus as Array<Record<string, unknown>>)
          : [];

        const skuDebugRows = eligibleSkusForLog.map((sku) => {
          const skuId = typeof sku.skuId === "string" ? sku.skuId : "";
          const label = typeof sku.label === "string" ? sku.label : null;
          const variants = Array.isArray(sku.variants) ? sku.variants : [];
          const firstVariant = variants[0];

          let firstVariantPreview = "";
          if (typeof firstVariant === "string") {
            firstVariantPreview = firstVariant.slice(0, 60);
          } else if (isRecord(firstVariant) && typeof firstVariant.imageUrl === "string") {
            firstVariantPreview = firstVariant.imageUrl.slice(0, 60);
          } else if (firstVariant != null) {
            const serialized = JSON.stringify(firstVariant);
            firstVariantPreview = (serialized ?? "").slice(0, 60);
          }

          return {
            skuId,
            label,
            variantsLength: variants.length,
            firstVariantPreview,
            source: sku.source ?? null,
            priority: sku.priority ?? null,
          };
        });

        const skuIdsInOrder = skuDebugRows.map((row) => row.skuId);
        const userSkuCount = skuIdsInOrder.filter((id) => id.startsWith("user_")).length;
        const nonUserSkuCount = skuIdsInOrder.length - userSkuCount;
        const baseImageField = typeof payload.baseImageUrl === "string"
          ? "baseImageUrl"
          : typeof payload.baseImageId === "string"
            ? "baseImageId"
            : typeof payload.roomImageBase64 === "string"
              ? "roomImageBase64"
              : null;
        const payloadForLog = sanitizeStageRunPayloadForLog(payload);

        console.log("[stage3][pre-post][summary]", {
          stage: stageNumber,
          targetCount: payload.targetCount ?? null,
          baseImageField,
          eligibleSkusLength: eligibleSkusForLog.length,
          skuIdsInOrder,
          skuDebugRows,
          userSkuCount,
          nonUserSkuCount,
        });
        console.log("[stage3][pre-post][payload-json]", JSON.stringify(payloadForLog, null, 2));
      }

      console.log("[runStage][image-source-debug]", {
        stageNumber,
        workingImageUrl,
        activeStageOutputImageUrl,
        "scene.baseImageUrl": scene.baseImageUrl,
        candidateUrl,
        selectedPayloadImageField:
          typeof candidateUrl === "string" &&
          (candidateUrl.startsWith("blob:") || candidateUrl.startsWith("data:image/"))
            ? "roomImageBase64"
            : "baseImageUrl",
        "payload.isContinuation": payload.isContinuation,
      });
      console.log("stage-run payload", sanitizeStageRunPayloadForLog(payload));
      const accessToken = await tryGetSupabaseAccessToken();
      const res = await fetch("/api/vibode/stage-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: requestOptions?.signal,
      });

      const json: unknown = await res.json().catch(() => ({}));
      const jsonRecord = isRecord(json) ? json : null;
      if (isIntentionalPasteToPlaceCancellation(json, requestOptions)) {
        setStageStatus((prev) => ({ ...prev, [stageNumber]: previousStageStatus }));
        return null;
      }

      if (!res.ok) {
        throw new Error(
          safeStr(jsonRecord?.error) ??
            safeStr(jsonRecord?.message) ??
            safeStr(jsonRecord?.detail) ??
            `Stage ${stageNumber} failed.`
        );
      }

      const nextImageUrl = getImageUrlFromUnknown(json);
      if (!nextImageUrl) throw new Error("Stage run response missing imageUrl.");

      if (lifecycle?.beforeCommit && !lifecycle.beforeCommit()) {
        return null;
      }
      setStageStatus((prev) => ({ ...prev, [stageNumber]: "success" }));
      setLastStageOutputs((prev) => ({ ...prev, [stageNumber]: json }));
      const responsePlacements = extractScenePlacementsFromUnknown(json);
      if (responsePlacements.length > 0) {
        setScenePlacements(responsePlacements);
        hydrateSceneNodesFromPlacements(responsePlacements);
      }
      setWorkingImageUrl(nextImageUrl);
      setIsWorkingImageGenerated(true);
      if (!isInlineImageSource(nextImageUrl)) {
        setBaseImageUrl(nextImageUrl);
      }
      clearTransientInteractionOverlaysAfterImageCommit();
      lifecycle?.onImageCommitted?.(nextImageUrl);
      let resolvedAssetId: string | null = activeAssetId;
      if (vibodeRoomId) {
        const latestVersions = await refreshRoomVersions(vibodeRoomId);
        if (lifecycle?.beforeCommit && !lifecycle.beforeCommit()) {
          return null;
        }
        const baseAsset = latestVersions?.find((asset) => asset.asset_type === "base") ?? null;
        const activeAsset = latestVersions?.find((asset) => asset.is_active) ?? null;
        if (baseAsset) {
          setRoomBaseAssetId(baseAsset.id);
        }
        resolvedAssetId = activeAsset?.id ?? latestVersions?.[0]?.id ?? null;
        setActiveAssetId(resolvedAssetId);
      }
      // Auto room-object reads deprecated. Remove Mode now triggers intentional reads on demand.

      if (stageNumber === 3) {
        setHasFurniturePass(true);
      }

      const tokenUsageMessage = buildTokenUsageMessage(json);
      if (stageNumber === 4) {
        pushSnack(`Stage 4 ${STAGE4_ACTION_LABELS[stage4ActionForRun]} complete. ${tokenUsageMessage}.`);
      } else {
        pushSnack(`Stage ${stageNumber} complete. ${tokenUsageMessage}.`);
      }
      notifyTokenBalanceChanged();
      return json;
    } catch (err: unknown) {
      if (requestOptions?.suppressAbortError && isAbortError(err)) {
        setStageStatus((prev) => ({ ...prev, [stageNumber]: previousStageStatus }));
        return null;
      }
      setStageStatus((prev) => ({ ...prev, [stageNumber]: "error" }));
      const errMessage = getErrorMessage(err);
      if (errMessage) {
        pushSnack(errMessage);
      } else if (stageNumber === 4) {
        pushSnack(`Stage 4 ${STAGE4_ACTION_LABELS[stage4ActionForRun]} failed.`);
      } else {
        pushSnack(`Stage ${stageNumber} failed.`);
      }
      return null;
    } finally {
      if (requestOptions?.pasteToPlaceSettlingRequestId) {
        clearPasteToPlaceSettlingForRequest(
          requestOptions.pasteToPlaceSettlingRequestId,
          `run_stage_${stageNumber}:finally`
        );
      }
      if (stageNumber === 4) {
        if (!lifecycle?.beforeCommit || lifecycle.beforeCommit()) {
          setStage4RunningAction(null);
        }
      }
    }
  };

  const runStageWithCancellation = async (
    stageNumber: WorkflowStage,
    options: Record<string, unknown> = {}
  ) => {
      if (isStageRunSettling) {
        console.info("[Stage-run][settling] stage run blocked because settling", {
          stageNumber,
          cooldownActive: isStageRunCancelCooldownActiveRef.current,
        });
        return null;
      }
      const previousStageStatus = stageStatus[stageNumber];
      const { operationId, controller } = beginStageRunOperation(stageNumber, previousStageStatus);
      const isOperationStale = () => !isStageRunOperationActive(operationId);

      try {
        return await runStage(
          stageNumber,
          options,
          {
            beforeCommit: () => !isOperationStale(),
          },
          {
            signal: controller.signal,
            suppressAbortError: true,
          }
        );
      } finally {
        clearStageRunOperation(operationId, controller);
        clearStageRunSettling();
      }
    };

  const runEdit = async (
    action: EditAction,
    payloadParts: Partial<VibodeEditRunRequest> = {},
    lifecycle?: {
      onImageCommitted?: (response: VibodeEditRunResponse) => void;
      beforeCommit?: () => boolean;
    },
    requestOptions?: {
      signal?: AbortSignal;
      suppressAbortError?: boolean;
      suppressCancellationError?: boolean;
      pasteToPlaceControl?: PasteToPlaceJobControl;
      pasteToPlaceSettlingRequestId?: string | null;
      onPostDurableCommit?: (args: {
        action: EditAction;
        roomId: string | null;
        assetId: string | null;
        imageUrl: string | null;
        response: VibodeEditRunResponse;
      }) => Promise<void> | void;
    }
  ): Promise<VibodeEditRunResponse | null> => {
    if (isOutOfTokens) {
      const message = "You're out of tokens";
      setEditWarning(message);
      pushSnack(message);
      return null;
    }
    const baseImageUrl = workingImageUrl;
    if (!baseImageUrl) {
      const message = "No working image yet. Run a stage or upload a room photo first.";
      setEditWarning(message);
      console.warn("[edit-run] blocked: workingImageUrl missing");
      pushSnack(message);
      return null;
    }
    if (!isBaseImageEditReady) {
      setEditWarning(ROOM_PREPARING_MESSAGE);
      pushSnack(ROOM_PREPARING_MESSAGE);
      return null;
    }

    setIsEditRunning(true);
    setEditWarning(null);

    try {
      const accessToken = await tryGetSupabaseAccessToken();
      const targetRecord = isRecord(payloadParts.target)
        ? ({ ...payloadParts.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadParts.params)
        ? ({ ...payloadParts.params } as Record<string, unknown>)
        : {};
      let normalizedTarget = payloadParts.target;
      let normalizedParams = payloadParts.params;
      let rotatePayload: { xNorm: number; yNorm: number; rotationDegrees: number } | null = null;

      if (action === "remove") {
        const removeMode =
          typeof paramsRecord.mode === "string" ? paramsRecord.mode.trim().toLowerCase() : null;
        const isGuidanceImageMode = removeMode === "guidance-image";
        if (isGuidanceImageMode) {
          normalizedTarget = payloadParts.target;
          normalizedParams = { ...paramsRecord, mode: "guidance-image" };
        } else {
          const xNormRaw =
            parseFiniteNumber(targetRecord.xNorm) ??
            parseFiniteNumber(targetRecord.x) ??
            parseFiniteNumber(paramsRecord.xNorm) ??
            parseFiniteNumber(paramsRecord.x);
          const yNormRaw =
            parseFiniteNumber(targetRecord.yNorm) ??
            parseFiniteNumber(targetRecord.y) ??
            parseFiniteNumber(paramsRecord.yNorm) ??
            parseFiniteNumber(paramsRecord.y);
          if (xNormRaw === null || yNormRaw === null) {
            const message = "remove requires finite target.xNorm and target.yNorm.";
            setEditWarning(message);
            pushSnack(message);
            return null;
          }
          const xNorm = Math.max(0, Math.min(1, xNormRaw));
          const yNorm = Math.max(0, Math.min(1, yNormRaw));
          normalizedTarget = { xNorm, yNorm, x: xNorm, y: yNorm };
          normalizedParams = { ...paramsRecord, xNorm, yNorm, x: xNorm, y: yNorm };
        }
      } else if (action === "rotate") {
        const xNormRaw =
          parseFiniteNumber(payloadParts.xNorm) ??
          parseFiniteNumber(targetRecord.xNorm) ??
          parseFiniteNumber(targetRecord.x) ??
          parseFiniteNumber(paramsRecord.xNorm) ??
          parseFiniteNumber(paramsRecord.x);
        const yNormRaw =
          parseFiniteNumber(payloadParts.yNorm) ??
          parseFiniteNumber(targetRecord.yNorm) ??
          parseFiniteNumber(targetRecord.y) ??
          parseFiniteNumber(paramsRecord.yNorm) ??
          parseFiniteNumber(paramsRecord.y);
        const rotationDegreesRaw =
          parseFiniteNumber(payloadParts.rotationDegrees) ??
          parseFiniteNumber(paramsRecord.rotationDegrees) ??
          parseFiniteNumber(paramsRecord.rotationDeg) ??
          parseFiniteNumber(targetRecord.rotationDegrees);
        if (xNormRaw === null || yNormRaw === null || rotationDegreesRaw === null) {
          const message = "rotate requires finite xNorm, yNorm, and rotationDegrees.";
          setEditWarning(message);
          pushSnack(message);
          return null;
        }
        rotatePayload = {
          xNorm: Math.max(0, Math.min(1, xNormRaw)),
          yNorm: Math.max(0, Math.min(1, yNormRaw)),
          rotationDegrees: rotationDegreesRaw,
        };
        normalizedTarget = undefined;
        normalizedParams = undefined;
      }
      const payloadPlacementsForRotate =
        action === "rotate" && Array.isArray(payloadParts.placements) && payloadParts.placements.length > 0
          ? payloadParts.placements
          : undefined;
      const rotatePlacements =
        action === "rotate"
          ? payloadPlacementsForRotate ??
            authoritativeDisplayedPlacements
          : undefined;

      const body: VibodeEditRunRequest = {
        baseImageUrl,
        action,
        ...(action === "rotate"
          ? {
              xNorm: rotatePayload?.xNorm,
              yNorm: rotatePayload?.yNorm,
              rotationDegrees: rotatePayload?.rotationDegrees,
              placements: rotatePlacements,
            }
          : {
              placements: payloadParts.placements ?? scenePlacements,
              target: normalizedTarget,
              params: normalizedParams,
              eligibleSkus: payloadParts.eligibleSkus,
            }),
        modelVersion: selectedModel,
        vibodeRoomId: vibodeRoomId ?? undefined,
        stageNumber: activeStage ?? undefined,
        pasteToPlaceControl: requestOptions?.pasteToPlaceControl,
      };

      const res = await fetch("/api/vibode/edit-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: requestOptions?.signal,
      });

      const json = (await res.json().catch(() => ({}))) as Partial<VibodeEditRunResponse> & {
        error?: string;
        message?: string;
      };
      if (isIntentionalPasteToPlaceCancellation(json, requestOptions)) {
        return null;
      }

      if (!res.ok) {
        throw new Error(json.error || json.message || `Edit run failed (HTTP ${res.status})`);
      }
      if (typeof json.imageUrl !== "string" || json.imageUrl.trim().length === 0) {
        throw new Error("Edit run response missing imageUrl.");
      }

      const lifecycleBeforeCommit = lifecycle?.beforeCommit;
      const lifecycleOnImageCommitted = lifecycle?.onImageCommitted;
      const responseImageUrl = json.imageUrl.trim();
      const roomIdForCommittedImage = vibodeRoomId;
      const isPasteToPlaceCommit = Boolean(requestOptions?.pasteToPlaceControl);
      const roomImageObjectsTrigger = isPasteToPlaceCommit ? "paste-to-place" : "edit-run";

      if (lifecycleBeforeCommit && !lifecycleBeforeCommit()) {
        return null;
      }
      setWorkingImageUrl(json.imageUrl);
      setIsWorkingImageGenerated(true);
      setBaseImageUrl(json.imageUrl);
      if (Array.isArray(json.placements)) {
        setScenePlacements(json.placements);
        hydrateSceneNodesFromPlacements(json.placements);
      }
      clearLegacyPlacementNodes();
      clearTransientInteractionOverlaysAfterImageCommit();
      if (!isPasteToPlaceCommit) {
        lifecycleOnImageCommitted?.(json as VibodeEditRunResponse);
      }
      let resolvedAssetId: string | null = null;
      let resolvedImageUrl: string | null = responseImageUrl;
      if (roomIdForCommittedImage) {
        const latestVersions = await refreshRoomVersions(roomIdForCommittedImage);
        if (lifecycleBeforeCommit && !lifecycleBeforeCommit()) {
          return null;
        }
        const activeVersion = latestVersions?.find((asset) => asset.is_active) ?? null;
        const matchingVersion =
          latestVersions?.find((asset) => asset.image_url === responseImageUrl) ??
          latestVersions?.find((asset) => asset.preview_url === responseImageUrl) ??
          null;
        const resolvedVersion = matchingVersion ?? activeVersion ?? latestVersions?.[0] ?? null;
        if (resolvedVersion) {
          resolvedAssetId = resolvedVersion.id;
          resolvedImageUrl =
            resolvedVersion.image_url?.trim() ||
            resolvedVersion.preview_url?.trim() ||
            responseImageUrl;
          setActiveAssetId(resolvedVersion.id);
        }
      }
      if (!resolvedAssetId) {
        console.warn("[room-image-objects] skipped", {
          trigger: roomImageObjectsTrigger,
          reason: "unable to resolve durable asset/version identity",
          roomId: roomIdForCommittedImage,
          responseImageUrl,
        });
      } else if (!resolvedImageUrl) {
        console.warn("[room-image-objects] skipped", {
          trigger: roomImageObjectsTrigger,
          reason: "missing final committed durable image URL",
          roomId: roomIdForCommittedImage,
          assetId: resolvedAssetId,
        });
      } else {
        if (requestOptions?.onPostDurableCommit) {
          try {
            await requestOptions.onPostDurableCommit({
              action,
              roomId: roomIdForCommittedImage,
              assetId: resolvedAssetId,
              imageUrl: resolvedImageUrl,
              response: json as VibodeEditRunResponse,
            });
          } catch (err: unknown) {
            console.warn("[placement-layer] post-durable-commit persistence failed", {
              roomId: roomIdForCommittedImage,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (isPasteToPlaceCommit) {
          console.log("[room-image-objects] paste-to-place hydration requested", {
            imageUrl: resolvedImageUrl,
            roomId: roomIdForCommittedImage,
            assetId: resolvedAssetId,
          });
          await hydrateRoomImageObjects({
            trigger: roomImageObjectsTrigger,
            imageUrl: resolvedImageUrl,
            roomId: roomIdForCommittedImage,
            assetId: resolvedAssetId,
            versionId: resolvedAssetId,
            allowRoomReadOnMiss: true,
          });
        } else {
          // Auto room-object reads deprecated for ordinary edit-run commits.
        }
      }
      if (isPasteToPlaceCommit) {
        lifecycleOnImageCommitted?.(json as VibodeEditRunResponse);
      }
      const tokenUsageMessage = buildTokenUsageMessage(json);
      pushSnack(`Applied ${action}. ${tokenUsageMessage}.`);
      notifyTokenBalanceChanged();
      return json as VibodeEditRunResponse;
    } catch (err: unknown) {
      if (requestOptions?.suppressAbortError && isAbortError(err)) {
        return null;
      }
      const message = getErrorMessage(err) ?? `Failed to ${action}.`;
      setEditWarning(message);
      console.warn("[edit-run] failed", { action, message, err });
      pushSnack(message);
      return null;
    } finally {
      setIsEditRunning(false);
      if (requestOptions?.pasteToPlaceSettlingRequestId) {
        clearPasteToPlaceSettlingForRequest(
          requestOptions.pasteToPlaceSettlingRequestId,
          `run_edit_${action}:finally`
        );
      }
    }
  };

  useEffect(() => {
    const pending = getPendingFurnitureSelection();
    const pendingReturnPreviewUrl =
      typeof pending?.previewImageUrl === "string" && pending.previewImageUrl.trim().length > 0
        ? pending.previewImageUrl
        : null;
    setPendingMyFurnitureReturnPreviewUrl((prev) =>
      prev === pendingReturnPreviewUrl ? prev : pendingReturnPreviewUrl
    );
    if (!pending || isPendingFurnitureSelectionRunning) return;

    const hydrationReady = !requestedRoomId || hydratedRoomIdRef.current === requestedRoomId;
    const roomReady = isBaseImageEditReady;

    if (!hydrationReady || !roomReady || isRoomHydrating || isBusy || isEditRunning) {
      return;
    }

    let cancelled = false;
    setIsPendingFurnitureSelectionRunning(true);

    void (async () => {
      try {
        const resolved = await resolveMyFurnitureForEdit(pending.furnitureId);
        if (!resolved) throw new Error("resolve-failed");

        const preparedProduct = buildPreparedMyFurnitureProduct(resolved, pending.furnitureId);
        const fallbackPreviewUrl =
          resolved.eligibleSku.variants.find(
            (variant) => typeof variant?.imageUrl === "string" && variant.imageUrl.trim().length > 0
          )?.imageUrl ?? null;
        const previewUrl = pending.previewImageUrl ?? fallbackPreviewUrl;
        // Standalone "Use in Room" return can carry a stale provisional clipboard preview.
        // Clear + invalidate it eagerly so the selected My Furniture preview remains authoritative.
        clearPasteToPlaceMenuClipboardPreview();
        clearPasteToPlaceUrlCandidatePreview();
        activatePreparedMyFurnitureSource(preparedProduct, {
          normalizedPreviewUrl: previewUrl,
          suppressedClipboardPreviewHash: pending.suppressedClipboardPreviewHash ?? null,
        });
        setPendingMyFurnitureReturnPreviewUrl(null);

        clearPendingFurnitureSelection();
        pushSnack("Saved furniture ready. Click in your room to place it.");
      } catch {
        if (!cancelled) {
          pushSnack("Couldn’t load saved item.");
          setPendingMyFurnitureReturnPreviewUrl(null);
          clearPendingFurnitureSelection();
        }
      } finally {
        if (!cancelled) {
          setIsPendingFurnitureSelectionRunning(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activatePreparedMyFurnitureSource,
    buildPreparedMyFurnitureProduct,
    clearPasteToPlaceMenuClipboardPreview,
    clearPasteToPlaceUrlCandidatePreview,
    isBusy,
    isEditRunning,
    isPendingFurnitureSelectionRunning,
    isRoomHydrating,
    pushSnack,
    requestedRoomId,
    resolveMyFurnitureForEdit,
    isBaseImageEditReady,
  ]);

  const ingestClipboardUserSku = useCallback(
    async ({
      imageBase64,
      imageUrl,
      ingestSource = "clipboard",
      label = "Pasted Product",
    }: {
      imageBase64?: string;
      imageUrl?: string;
      ingestSource?: "clipboard" | "product_url" | "upload";
      label?: string;
    }): Promise<{
      userSku: UserSku;
      savedFurnitureId: string | null;
      savedFurniturePreviewUrl: string | null;
      savedFurnitureStoragePath: string | null;
      userSkuStoragePath: string | null;
    } | null> => {
      try {
        if (!imageBase64 && !imageUrl) return null;
        const accessToken = await tryGetSupabaseAccessToken();
        const res = await fetch("/api/vibode/user-skus/ingest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-roomprintz-ingest-source": ingestSource,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            ...(imageBase64 ? { imageBase64 } : {}),
            ...(imageUrl ? { imageUrl } : {}),
            label,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          status?: string;
          reason?: string;
          message?: string;
          error?: string;
          userSku?: Partial<UserSku> | null;
          savedFurniture?: unknown;
        };
        if (!res.ok) {
          return null;
        }

        const userSku = json.userSku;
        const ingestStatus = typeof json.status === "string" ? json.status : null;
        const failureReasonFromPayload =
          typeof json.reason === "string" && json.reason.trim().length > 0
            ? json.reason
            : typeof json.message === "string" && json.message.trim().length > 0
              ? json.message
              : null;
        const rawVariants = Array.isArray(userSku?.variants) ? userSku.variants : [];
        const variants = rawVariants.filter(
          (imageUrl): imageUrl is string =>
            typeof imageUrl === "string" && imageUrl.trim().length > 0
        );

        const failureReason =
          ingestStatus === "failed"
            ? failureReasonFromPayload ?? "ingest-status-failed"
            : !userSku
              ? "missing-userSku"
              : userSku.status === "failed"
                ? userSku.reason ?? "userSku-status-failed"
                : userSku.status !== "ready"
                  ? `invalid-userSku-status:${String(userSku.status)}`
                  : typeof userSku.skuId !== "string" || userSku.skuId.trim().length === 0
                    ? "missing-skuId"
                    : variants.length === 0
                      ? "empty-variants"
                      : null;

        if (failureReason) {
          return null;
        }

        let savedFurnitureId: string | null = null;
        let savedFurniturePreviewUrl: string | null = null;
        let savedFurnitureStoragePath: string | null = null;
        if (isRecord(json.savedFurniture)) {
          const maybeId = (json.savedFurniture as Record<string, unknown>).id;
          if (typeof maybeId === "string" && maybeId.trim().length > 0) {
            savedFurnitureId = maybeId;
          }
          savedFurniturePreviewUrl = parseSavedFurnitureDurablePreviewUrl(json.savedFurniture);
          savedFurnitureStoragePath = parseSavedFurnitureStoragePath(json.savedFurniture);
          pushSnack("Saved to My Furniture ✓");
        }
        const userSkuStoragePath = extractStorageObjectPathFromUnknown(userSku);
        const readyUserSku = userSku as UserSku;
        const normalizedUserSku: UserSku = {
          skuId: readyUserSku.skuId.trim(),
          label:
            typeof readyUserSku.label === "string" && readyUserSku.label.trim().length > 0
              ? readyUserSku.label
              : readyUserSku.skuId.trim(),
          variants,
          sourceUrl: typeof readyUserSku.sourceUrl === "string" ? readyUserSku.sourceUrl : undefined,
          status: "ready",
          reason: typeof readyUserSku.reason === "string" ? readyUserSku.reason : null,
        };
        return {
          userSku: normalizedUserSku,
          savedFurnitureId,
          savedFurniturePreviewUrl,
          savedFurnitureStoragePath,
          userSkuStoragePath,
        };
      } catch {
        return null;
      }
    },
    [pushSnack]
  );

  const preparePasteToPlaceClipboardProduct = useCallback(
    async ({
      operationId,
      trigger,
    }: PasteToPlaceClickHint & {
      operationId?: number;
      trigger?: "menu_open_refresh" | "explicit_refresh" | "explicit_paste_flow";
    }): Promise<PasteToPlaceClipboardPreparationResult> => {
      const isOperationStale = (context?: string): boolean => {
        void context;
        if (typeof operationId !== "number") return false;
        if (isPendingPasteToPlaceCommitOperationActive(operationId)) return false;
        return true;
      };

      if (isOperationStale("clipboard_prepare:start")) {
        clearAwaitingPasteToPlaceSession(operationId);
        clearPasteEventClipboardImagePayload(operationId);
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      if (!hasShownPasteToPlaceClipboardHeadsUp) {
        pushSnack(
          "Paste-to-Place needs clipboard access to read your copied product image. If your browser asks, click Allow."
        );
        markPasteToPlaceClipboardHeadsUpShown();
      }

      const requestId = safeId("ptp_req");
      const awaitingSession = awaitingPasteToPlaceSessionRef.current;
      const awaitingSessionReason = awaitingSession?.reason;
      const hasActiveAwaitingSession = Boolean(
        awaitingSession && isPasteToPlaceOperationActive(awaitingSession.operationId)
      );
      const awaitingSessionMatchesOperation =
        hasActiveAwaitingSession &&
        typeof operationId === "number" &&
        awaitingSession?.operationId === operationId;
      const pastedImagePayload = hasActiveAwaitingSession
        ? pasteEventClipboardImagePayloadRef.current
        : null;
      if (hasActiveAwaitingSession && !awaitingSessionMatchesOperation) {
        setPasteToPlaceStatus(null);
        pushSnack(
          awaitingSessionReason === "clipboard_access_unavailable"
            ? "Clipboard access is blocked. Press ⌘V to paste instead."
            : "Press ⌘V to paste furniture image."
        );
        return { status: "failed", reason: "awaiting-paste-operation-mismatch" };
      }
      if (awaitingSessionMatchesOperation && (!pastedImagePayload || pastedImagePayload.operationId !== operationId)) {
        setPasteToPlaceStatus(null);
        pushSnack(
          awaitingSessionReason === "clipboard_access_unavailable"
            ? "Clipboard access is blocked. Press ⌘V to paste instead."
            : "Press ⌘V to paste furniture image."
        );
        return { status: "no-image" };
      }

      setPasteToPlaceStatus("reading");
      let clipboardDataUrl: string | null = null;
      let clipboardDataUrlHash: string | null = null;
      if (awaitingSessionMatchesOperation && pastedImagePayload && pastedImagePayload.operationId === operationId) {
        clipboardDataUrl = pastedImagePayload.dataUrl;
        clipboardDataUrlHash = pastedImagePayload.dataUrlHash ?? hashDataUrlForLogs(pastedImagePayload.dataUrl);
      } else {
        const clipboardReadResult = await readClipboardImageWithStatus();
        if (isOperationStale("clipboard_prepare:after_read")) {
          clearAwaitingPasteToPlaceSession(operationId);
          clearPasteEventClipboardImagePayload(operationId);
          setPasteToPlaceStatus(null);
          return { status: "failed", reason: "paste-to-place-operation-stale" };
        }
        const clipboardImage = clipboardReadResult.image;
        if (!clipboardImage) {
          const now = Date.now();
          if (now - lastPasteToPlaceClipboardSnackAtRef.current > 3000) {
            pushSnack(
              clipboardReadResult.status === "access-unavailable"
                ? "Clipboard access was blocked or unavailable. Allow access and try again."
                : "Couldn't read copied image. Try copying it again."
            );
            lastPasteToPlaceClipboardSnackAtRef.current = now;
          }
          setPasteToPlaceStatus(null);
          return { status: "no-image" };
        }
        clipboardDataUrl = await blobToDataUrl(clipboardImage.blob);
        if (isOperationStale("clipboard_prepare:after_data_url")) {
          clearAwaitingPasteToPlaceSession(operationId);
          clearPasteEventClipboardImagePayload(operationId);
          setPasteToPlaceStatus(null);
          return { status: "failed", reason: "paste-to-place-operation-stale" };
        }
        clipboardDataUrlHash = hashDataUrlForLogs(clipboardDataUrl);
      }

      if (!canUseFreePasteToPlace) {
        pushSnack("Free preview used — unlock more placements to keep Viboding.");
        setPasteToPlaceStatus(null);
        return { status: "blocked" };
      }

      if (!clipboardDataUrl || !clipboardDataUrl.startsWith("data:image/")) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-data-url-unavailable" };
      }
      if (!clipboardDataUrlHash) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-hash-unavailable" };
      }

      const currentSource = activePasteSourceRef.current;
      const hasSeenClipboardHashBefore =
        lastObservedClipboardDataUrlHashRef.current === clipboardDataUrlHash;
      const shouldBypassUnchangedGuard = trigger === "explicit_refresh";
      if (
        !shouldBypassUnchangedGuard &&
        (hasSeenClipboardHashBefore ||
          (currentSource?.type === "clipboard" &&
            currentSource.clipboardDataUrlHash === clipboardDataUrlHash))
      ) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-source-unchanged" };
      }

      if (isOperationStale("clipboard_prepare:before_ingest")) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      setPasteToPlaceStatus("preparing");
      const ingested = await ingestClipboardUserSku({
        imageBase64: clipboardDataUrl,
      });
      if (isOperationStale("clipboard_prepare:after_ingest")) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      if (!ingested) {
        pushSnack(
          "Couldn't isolate the copied product clearly. Try copying a cleaner product image."
        );
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-sku-ingest-failed" };
      }

      const clipboardEligibleSku: VibodeEligibleSku = {
        skuId: ingested.userSku.skuId,
        label: ingested.userSku.label || ingested.userSku.skuId,
        source: "user",
        variants: (ingested.userSku.variants ?? []).map((imageUrl) => ({ imageUrl })),
      };
      const preparedProduct: PasteToPlacePreparedProduct = {
        source: "clipboard",
        skuId: ingested.userSku.skuId,
        eligibleSkus: [...stage3SkuItemsActive, clipboardEligibleSku],
        savedFurnitureId: ingested.savedFurnitureId,
      };
      const normalizedPreviewUrl =
        ingested.userSku.variants.find(
          (imageUrl): imageUrl is string =>
            typeof imageUrl === "string" && imageUrl.trim().length > 0
        ) ?? null;
      const source: Extract<ActivePasteSource, { type: "clipboard" }> = {
        type: "clipboard",
        skuId: preparedProduct.skuId,
        preparedProduct,
        durableSavedPreviewUrl: ingested.savedFurniturePreviewUrl ?? null,
        rawPreviewUrl: clipboardDataUrl,
        normalizedPreviewUrl,
        sourceImagePathHint:
          ingested.savedFurnitureStoragePath ??
          ingested.userSkuStoragePath ??
          extractStorageObjectPathFromUnknown(preparedProduct),
        thumbnailPathHint:
          ingested.savedFurnitureStoragePath ??
          ingested.userSkuStoragePath ??
          extractStorageObjectPathFromUnknown(preparedProduct),
        clipboardDataUrlHash,
        requestId,
        activatedAt: Date.now(),
      };
      activatePasteToPlaceSource(source, "clipboard_ingest_success", requestId);
      lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
      suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
      setPendingFurnitureClipboardSuppressionHash(null);
      clearPasteToPlaceMenuClipboardPreview();
      clearPasteToPlaceUrlCandidatePreview();
      lastObservedClipboardDataUrlHashRef.current = clipboardDataUrlHash;
      if (awaitingSessionMatchesOperation) {
        clearAwaitingPasteToPlaceSession(operationId);
        clearPasteEventClipboardImagePayload(operationId);
      }
      setPasteToPlaceStatus(null);
      return {
        status: "ready",
        source,
      };
    },
    [
      activatePasteToPlaceSource,
      canUseFreePasteToPlace,
      clearAwaitingPasteToPlaceSession,
      clearPasteEventClipboardImagePayload,
      clearPasteToPlaceMenuClipboardPreview,
      clearPasteToPlaceUrlCandidatePreview,
      hasShownPasteToPlaceClipboardHeadsUp,
      ingestClipboardUserSku,
      isPendingPasteToPlaceCommitOperationActive,
      isPasteToPlaceOperationActive,
      markPasteToPlaceClipboardHeadsUpShown,
      pushSnack,
      stage3SkuItemsActive,
    ]
  );
  const beginAwaitingPasteToPlaceSession = useCallback(
    (operationId: number, reason: AwaitingPasteToPlaceReason) => {
      setAwaitingPasteToPlaceSession({
        operationId,
        reason,
        createdAt: Date.now(),
      });
      setPasteToPlaceMenuClipboardPreviewUrl(null);
      setIsPasteToPlaceMenuClipboardPreviewLoading(false);
      setIsPasteToPlaceMenuIngesting(false);
    },
    [setAwaitingPasteToPlaceSession]
  );
  const refreshPasteToPlaceCopiedItem = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    if (isPasteToPlaceSettling) return;
    if (isPasteToPlaceRefreshInteractionLocked) return;
    if (isRefreshingCopiedItemRef.current) return;
    if (hasPendingPasteToPlaceCommit()) {
      pushSnack("Furniture is still saving. You can place it after this finishes.");
      return;
    }
    isRefreshingCopiedItemRef.current = true;
    setIsRefreshingCopiedItem(true);
    try {
      const operationId = beginPasteToPlaceOperation();
      const isOperationStale = () => !isPasteToPlaceOperationActive(operationId);
      clearAwaitingPasteToPlaceSession();
      clearPasteEventClipboardImagePayload();
      if (isLikelySafariBrowser()) {
        if (isOperationStale()) return null;
        beginAwaitingPasteToPlaceSession(operationId, "refresh_copied_item");
        return;
      }
      const clipboardReadResult = await readClipboardImageWithStatus();
      if (isOperationStale()) return;
      if (clipboardReadResult.status === "access-unavailable") {
        beginAwaitingPasteToPlaceSession(operationId, "refresh_copied_item");
        return;
      }
      if (!clipboardReadResult.image) {
        const clipboardTextResult = await readClipboardTextWithStatus();
        if (isOperationStale()) return null;
        if (clipboardTextResult.status === "ok") {
          const normalizedClipboardUrl = normalizeLikelyUrl(clipboardTextResult.text ?? "");
          if (normalizedClipboardUrl) {
            setPasteToPlaceProductUrlInput(normalizedClipboardUrl);
            clearPasteToPlaceMenuClipboardPreview();
            const urlCandidate = await requestPasteToPlaceUrlCandidatePreview({
              sourceUrl: normalizedClipboardUrl,
              operationId,
              showFailureSnack: true,
            });
            if (isOperationStale()) return;
            if (urlCandidate) {
              setPendingMyFurnitureReturnPreviewUrl(null);
              clearPasteToPlaceActiveSource("refresh_copied_item_url_preview_ready");
              pushSnack("Copied item refreshed.");
              return;
            }
            return;
          }
        }
        if (!isOperationStale()) {
          setPasteToPlaceStatus(null);
          setIsPasteToPlaceMenuIngesting(false);
        }
        pushSnack("Clipboard did not contain a furniture image or product link. Copy one and try again.");
        return;
      }
      const clipboardDataUrl = await blobToDataUrl(clipboardReadResult.image.blob);
      if (isOperationStale()) return;
      if (!clipboardDataUrl || !clipboardDataUrl.startsWith("data:image/")) {
        if (!isOperationStale()) {
          setPasteToPlaceStatus(null);
          setIsPasteToPlaceMenuIngesting(false);
        }
        pushSnack("Clipboard image could not be read. Copy the image again and try refresh.");
        return;
      }
      if (isOperationStale()) return;
      clearPasteToPlaceUrlCandidatePreview();
      setPendingMyFurnitureReturnPreviewUrl(null);
      setAwaitingPasteToPlaceSession({
        operationId,
        reason: "refresh_copied_item",
        createdAt: Date.now(),
      });
      pasteEventClipboardImagePayloadRef.current = {
        operationId,
        file: clipboardReadResult.image.blob,
        dataUrl: clipboardDataUrl,
        dataUrlHash: hashDataUrlForLogs(clipboardDataUrl),
        createdAt: Date.now(),
      };
      if (isOperationStale()) return;
      setPasteToPlaceMenuClipboardPreviewUrl(clipboardDataUrl);
      setIsPasteToPlaceMenuClipboardPreviewLoading(false);
      clearPasteToPlaceActiveSource("refresh_copied_item_preview_ready");
      pushSnack("Copied item refreshed.");
    } finally {
      isRefreshingCopiedItemRef.current = false;
      setIsRefreshingCopiedItem(false);
    }
  }, [
    beginAwaitingPasteToPlaceSession,
    beginPasteToPlaceOperation,
    clearAwaitingPasteToPlaceSession,
    clearPasteEventClipboardImagePayload,
    clearPasteToPlaceActiveSource,
    clearPasteToPlaceMenuClipboardPreview,
    clearPasteToPlaceUrlCandidatePreview,
    hasPendingPasteToPlaceCommit,
    isPasteToPlaceOperationActive,
    isPasteToPlaceRefreshInteractionLocked,
    isPasteToPlaceSettling,
    pasteToPlaceMenuState,
    pushSnack,
    readClipboardTextWithStatus,
    requestPasteToPlaceUrlCandidatePreview,
    setAwaitingPasteToPlaceSession,
  ]);
  const resolveAwaitingPasteToPlaceOperationIdForMenuAction = useCallback((): number | null => {
    const awaitingSession = awaitingPasteToPlaceSessionRef.current;
    if (!awaitingSession) return null;
    if (!isPasteToPlaceOperationActive(awaitingSession.operationId)) {
      clearAwaitingPasteToPlaceSession(awaitingSession.operationId);
      clearPasteEventClipboardImagePayload(awaitingSession.operationId);
      return null;
    }
    return awaitingSession.operationId;
  }, [
    clearAwaitingPasteToPlaceSession,
    clearPasteEventClipboardImagePayload,
    isPasteToPlaceOperationActive,
  ]);

  const preparePasteToPlaceDirectImageUrlSource = useCallback(
    async ({
      imageUrl,
      operationId: initialOperationId,
    }: {
      imageUrl: string;
      operationId?: number;
    }): Promise<Extract<ActivePasteSource, { type: "product_url" }> | null> => {
      const operationId = initialOperationId ?? beginPasteToPlaceOperation();
      const isOperationStale = () => !isPasteToPlaceOperationActive(operationId);
      const classified = classifyPasteToPlaceUrl(imageUrl);
      if (!classified || classified.kind !== "direct_image_url") {
        if (!isOperationStale()) {
          pushSnack("We couldn't load that copied image address. Try copying the product image instead.");
        }
        return null;
      }
      if (!canUseFreePasteToPlace) {
        if (!isOperationStale()) {
          pushSnack("Free preview used — unlock more placements to keep Viboding.");
        }
        return null;
      }
      setPasteToPlaceStatus("preparing");
      setIsPasteToPlaceMenuIngesting(true);
      try {
        if (isOperationStale()) return null;
        const ingested = await ingestClipboardUserSku({
          imageUrl: classified.normalizedUrl,
          ingestSource: "product_url",
          label: "Pasted Product",
        });
        if (isOperationStale()) return null;
        if (!ingested) {
          pushSnack("We couldn't load that copied image address. Try copying the product image instead.");
          return null;
        }
        const normalizedPreviewUrl =
          ingested.userSku.variants.find(
            (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
          ) ?? null;
        if (!normalizedPreviewUrl) {
          pushSnack("We couldn't load that copied image address. Try copying the product image instead.");
          return null;
        }
        const domain = getDomainFromUrl(classified.normalizedUrl);
        const displayName =
          typeof ingested.userSku.label === "string" && ingested.userSku.label.trim().length > 0
            ? ingested.userSku.label.trim()
            : "Pasted Product";
        const directImageEligibleSku: VibodeEligibleSku = {
          skuId: ingested.userSku.skuId,
          label: displayName,
          source: "user",
          variants: [{ imageUrl: normalizedPreviewUrl }],
        };
        const preparedProduct: PasteToPlacePreparedProduct = {
          source: "product_url",
          skuId: ingested.userSku.skuId,
          eligibleSkus: [...stage3SkuItemsActive, directImageEligibleSku],
          savedFurnitureId: ingested.savedFurnitureId,
          sourceMeta: {
            inputType: "url",
            domain,
            classification: "direct_image_url",
            confidence: null,
          },
        };
        const nextSource: Extract<ActivePasteSource, { type: "product_url" }> = {
          type: "product_url",
          urlKind: "direct_image_url",
          skuId: preparedProduct.skuId,
          furnitureId: ingested.savedFurnitureId,
          preparedOnly: false,
          preparedProduct,
          rawPreviewUrl: null,
          normalizedPreviewUrl,
          sourceImagePathHint:
            ingested.savedFurnitureStoragePath ??
            ingested.userSkuStoragePath ??
            extractStorageObjectPathFromUnknown([preparedProduct, normalizedPreviewUrl]),
          thumbnailPathHint:
            ingested.savedFurnitureStoragePath ??
            ingested.userSkuStoragePath ??
            extractStorageObjectPathFromUnknown([preparedProduct, normalizedPreviewUrl]),
          displayName,
          supplier: domain,
          domain,
          sourceUrl: classified.normalizedUrl,
          userSkuId: ingested.userSku.skuId,
          clipboardDataUrlHash: null,
          activatedAt: Date.now(),
        };
        activatePasteToPlaceSource(nextSource, "direct_image_url_prepare_success");
        clearPasteToPlaceMenuClipboardPreview();
        clearPasteToPlaceUrlCandidatePreview();
        setPasteToPlaceProductUrlInput("");
        pushSnack("Image link ready. Click in your room to place it.");
        return nextSource;
      } catch {
        if (!isOperationStale()) {
          pushSnack("We couldn't load that copied image address. Try copying the product image instead.");
        }
        return null;
      } finally {
        if (!isOperationStale()) {
          setPasteToPlaceStatus(null);
          setIsPasteToPlaceMenuIngesting(false);
        }
      }
    },
    [
      activatePasteToPlaceSource,
      beginPasteToPlaceOperation,
      canUseFreePasteToPlace,
      clearPasteToPlaceMenuClipboardPreview,
      clearPasteToPlaceUrlCandidatePreview,
      ingestClipboardUserSku,
      isPasteToPlaceOperationActive,
      pushSnack,
      stage3SkuItemsActive,
    ]
  );

  const preparePasteToPlaceProductUrlSource = useCallback(
    async (options?: {
      operationId?: number;
      sourceUrl?: string;
    }): Promise<Extract<ActivePasteSource, { type: "product_url" }> | null> => {
      const operationId = options?.operationId ?? beginPasteToPlaceOperation();
      const isOperationStale = () => !isPasteToPlaceOperationActive(operationId);
      const normalizedUrl = normalizeLikelyUrl(options?.sourceUrl ?? pasteToPlaceProductUrlInput);
      if (!normalizedUrl) {
        if (!isOperationStale()) {
          pushSnack("Paste a valid product URL first.");
        }
        return null;
      }
      if (!canUseFreePasteToPlace) {
        if (!isOperationStale()) {
          pushSnack("Free preview used — unlock more placements to keep Viboding.");
        }
        return null;
      }

      setPasteToPlaceStatus("preparing");
      setIsPasteToPlaceMenuIngesting(true);

      try {
        const accessToken = await tryGetSupabaseAccessToken();
        if (isOperationStale()) return null;
        const res = await fetch("/api/vibode/my-furniture/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-roomprintz-ingest-source": "product_url",
            "x-roomprintz-skip-my-furniture-autosave": "1",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            sourceType: "product_url",
            sourceUrl: normalizedUrl,
            prepareOnly: true,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as PasteToPlaceProductUrlPrepareResponse;
        if (isOperationStale()) return null;
        if (!res.ok) {
          if (!isOperationStale()) {
            pushSnack(
              "We couldn't prepare that product link. Try copying the product image instead."
            );
          }
          return null;
        }

        const prepared = isRecord(json.prepared) ? json.prepared : null;
        const userSkuId =
          prepared && typeof prepared.userSkuId === "string" && prepared.userSkuId.trim().length > 0
            ? prepared.userSkuId.trim()
            : null;
        const normalizedPreviewUrl =
          prepared &&
          typeof prepared.previewImageUrl === "string" &&
          prepared.previewImageUrl.trim().length > 0
            ? prepared.previewImageUrl.trim()
            : null;
        if (!userSkuId || !normalizedPreviewUrl) {
          if (!isOperationStale()) {
            pushSnack(
              "We couldn't prepare that product link. Try copying the product image instead."
            );
          }
          return null;
        }
        if (isOperationStale()) return null;
        // Product URL source replaces clipboard provisional previews immediately.
        lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
        suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
        setPendingFurnitureClipboardSuppressionHash(null);

        const sourceUrl =
          prepared && typeof prepared.sourceUrl === "string" && prepared.sourceUrl.trim().length > 0
            ? prepared.sourceUrl.trim()
            : normalizedUrl;
        const domain =
          prepared && typeof prepared.sourceDomain === "string" && prepared.sourceDomain.trim().length > 0
            ? prepared.sourceDomain.trim()
            : prepared &&
                typeof prepared.parsedSourceDomain === "string" &&
                prepared.parsedSourceDomain.trim().length > 0
              ? prepared.parsedSourceDomain.trim()
              : getDomainFromUrl(sourceUrl);
        const supplier =
          prepared && typeof prepared.supplierName === "string" && prepared.supplierName.trim().length > 0
            ? prepared.supplierName.trim()
            : prepared &&
                typeof prepared.parsedSupplierName === "string" &&
                prepared.parsedSupplierName.trim().length > 0
              ? prepared.parsedSupplierName.trim()
              : domain;
        const displayName =
          prepared && typeof prepared.displayName === "string" && prepared.displayName.trim().length > 0
            ? prepared.displayName.trim()
            : "Pasted Product";
        const productUrlEligibleSku: VibodeEligibleSku = {
          skuId: userSkuId,
          label: displayName,
          source: "user",
          variants: [{ imageUrl: normalizedPreviewUrl }],
        };

        const preparedProduct: PasteToPlacePreparedProduct = {
          source: "product_url",
          skuId: userSkuId,
          eligibleSkus: [...stage3SkuItemsActive, productUrlEligibleSku],
          savedFurnitureId: null,
          sourceMeta: {
            inputType: "url",
            domain,
            classification: null,
            confidence: null,
          },
        };
        const nextSource: Extract<ActivePasteSource, { type: "product_url" }> = {
          type: "product_url",
          urlKind: "product_page_url",
          skuId: preparedProduct.skuId,
          furnitureId: null,
          preparedOnly: true,
          preparedProduct,
          rawPreviewUrl: null,
          normalizedPreviewUrl,
          sourceImagePathHint:
            extractStorageObjectPathFromUnknown([prepared, preparedProduct, normalizedPreviewUrl]) ?? null,
          thumbnailPathHint:
            extractStorageObjectPathFromUnknown([prepared, preparedProduct, normalizedPreviewUrl]) ?? null,
          displayName,
          supplier,
          domain,
          sourceUrl,
          userSkuId,
          clipboardDataUrlHash: null,
          activatedAt: Date.now(),
        };

        if (isOperationStale()) return null;
        activatePasteToPlaceSource(nextSource, "product_url_prepare_success");
        clearPasteToPlaceMenuClipboardPreview();
        clearPasteToPlaceUrlCandidatePreview();
        setPasteToPlaceProductUrlInput("");
        pushSnack("Product link ready. Click in your room to place it.");
        return nextSource;
      } catch {
        if (!isOperationStale()) {
          pushSnack(
            "We couldn't prepare that product link. Try copying the product image instead."
          );
        }
        return null;
      } finally {
        if (!isOperationStale()) {
          setPasteToPlaceStatus(null);
          setIsPasteToPlaceMenuIngesting(false);
        }
      }
    },
    [
      activatePasteToPlaceSource,
      beginPasteToPlaceOperation,
      canUseFreePasteToPlace,
      clearPasteToPlaceMenuClipboardPreview,
      clearPasteToPlaceUrlCandidatePreview,
      isPasteToPlaceOperationActive,
      pasteToPlaceProductUrlInput,
      pushSnack,
      stage3SkuItemsActive,
    ]
  );

  const savePreparedProductUrlToMyFurniture = useCallback(
    async (
      source: Extract<ActivePasteSource, { type: "product_url" }>,
      options?: { operationId?: number }
    ): Promise<string | null> => {
      const saveKey = [
        source.userSkuId.trim(),
        source.preparedProduct.skuId.trim(),
        (source.sourceUrl ?? "").trim().toLowerCase(),
      ].join("::");
      const existingSavedFurnitureId =
        source.preparedProduct.savedFurnitureId ?? source.furnitureId ?? null;
      console.info("[Paste-to-Place][product_url_save] deciding autosave", {
        operationId: options?.operationId ?? null,
        saveKey,
        userSkuId: source.userSkuId,
        sourceUrl: source.sourceUrl,
        preparedOnly: source.preparedOnly,
        existingSavedFurnitureId,
      });
      if (existingSavedFurnitureId) {
        console.info("[Paste-to-Place][product_url_save] skipping save (already saved)", {
          operationId: options?.operationId ?? null,
          saveKey,
          savedFurnitureId: existingSavedFurnitureId,
        });
        return existingSavedFurnitureId;
      }
      const existingInFlight = inFlightProductUrlAutosavesRef.current.get(saveKey);
      if (existingInFlight) {
        console.info("[Paste-to-Place][product_url_save] skipping save (already in-flight)", {
          operationId: options?.operationId ?? null,
          saveKey,
        });
        return existingInFlight;
      }
      const savePromise = (async (): Promise<string | null> => {
        const accessToken = await tryGetSupabaseAccessToken();
        console.info("[Paste-to-Place][product_url_save] starting save", {
          operationId: options?.operationId ?? null,
          saveKey,
        });
        const requestBody = {
          userSkuId: source.userSkuId,
          sourceType: "product_url",
          sourceUrl: source.sourceUrl,
          displayName: source.displayName,
          previewImageUrl: source.normalizedPreviewUrl,
          prepareOnly: false,
        };
        const res = await fetch("/api/vibode/my-furniture/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-roomprintz-ingest-source": "product_url",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(requestBody),
        });
        const json = (await res.json().catch(() => ({}))) as PasteToPlaceProductUrlSaveResponse;
        if (!res.ok) {
          console.warn("[Paste-to-Place][product_url_save] save failed", {
            operationId: options?.operationId ?? null,
            saveKey,
            status: res.status,
          });
          return null;
        }
        const savedFurnitureId = parseProductUrlSaveFurnitureId(json);
        if (!savedFurnitureId) {
          console.warn("[Paste-to-Place][product_url_save] save failed", {
            operationId: options?.operationId ?? null,
            saveKey,
            reason: "missing_saved_furniture_id",
          });
          return null;
        }
        const currentSource = activePasteSourceRef.current;
        if (
          currentSource?.type === "product_url" &&
          currentSource.userSkuId === source.userSkuId &&
          currentSource.preparedProduct.skuId === source.preparedProduct.skuId &&
          !currentSource.preparedProduct.savedFurnitureId
        ) {
          activatePasteToPlaceSource(
            {
              ...currentSource,
              furnitureId: savedFurnitureId,
              preparedOnly: false,
              preparedProduct: {
                ...currentSource.preparedProduct,
                savedFurnitureId,
              },
            },
            "product_url_saved_after_placement"
          );
        }
        console.info("[Paste-to-Place][product_url_save] save success", {
          operationId: options?.operationId ?? null,
          saveKey,
          savedFurnitureId,
        });
        return savedFurnitureId;
      })()
        .catch((error) => {
          console.warn("[Paste-to-Place][product_url_save] save failed", {
            operationId: options?.operationId ?? null,
            saveKey,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
        .finally(() => {
          inFlightProductUrlAutosavesRef.current.delete(saveKey);
        });
      inFlightProductUrlAutosavesRef.current.set(saveKey, savePromise);
      return savePromise;
    },
    [activatePasteToPlaceSource]
  );

  const handlePasteToPlaceSubmitUrlInput = useCallback(() => {
    if (hasPendingPasteToPlaceCommit()) {
      pushSnack("Furniture is still saving. You can place it after this finishes.");
      return;
    }
    const classified = classifyPasteToPlaceUrl(pasteToPlaceProductUrlInput);
    if (!classified) {
      pushSnack("Paste a valid product URL first.");
      return;
    }
    if (classified.kind === "direct_image_url") {
      void preparePasteToPlaceDirectImageUrlSource({ imageUrl: classified.normalizedUrl });
      return;
    }
    void preparePasteToPlaceProductUrlSource();
  }, [
    hasPendingPasteToPlaceCommit,
    pasteToPlaceProductUrlInput,
    preparePasteToPlaceDirectImageUrlSource,
    preparePasteToPlaceProductUrlSource,
    pushSnack,
  ]);

  const createPlacementLayerNodeAfterPasteCommit = useCallback(
    async (args: {
      operationId?: number;
      roomId: string | null;
      versionId: string | null;
      furnitureId: string | null;
      sourceImageUrl: string | null;
      thumbnailUrl: string | null;
      sourceImagePath: string | null;
      thumbnailPath: string | null;
      xNorm: number;
      yNorm: number;
      dedupe?: boolean;
      metadata?: PlacementMetadata;
    }) => {
      const roomId = args.roomId?.trim() ?? null;
      const versionId = args.versionId?.trim() ?? null;
      const sourceImageUrl = args.sourceImageUrl?.trim() ?? null;
      const thumbnailUrl = args.thumbnailUrl?.trim() ?? null;
      const sourceImagePath = normalizeStorageObjectPathCandidate(args.sourceImagePath);
      const thumbnailPath = normalizeStorageObjectPathCandidate(args.thumbnailPath);
      const xRaw = Number.isFinite(args.xNorm) ? args.xNorm : null;
      const yRaw = Number.isFinite(args.yNorm) ? args.yNorm : null;
      const x = xRaw === null ? null : Math.max(0, Math.min(1, xRaw));
      const y = yRaw === null ? null : Math.max(0, Math.min(1, yRaw));
      const operationId = typeof args.operationId === "number" ? args.operationId : null;
      const dedupe = args.dedupe === true;
      const metadata = normalizePlacementMetadata(
        args.metadata,
        defaultUserDirectedPlacementMetadata()
      );

      if (operationId !== null) {
        const opState = placementNodeCreateGuardByOperationRef.current.get(operationId);
        if (opState === "in_flight" || opState === "done") {
          console.info("[placement-layer] node create skipped", {
            reason: "duplicate operation create attempt",
            operationId,
            roomId,
            versionId,
          });
          return;
        }
      }

      if (
        !roomId ||
        !versionId ||
        !sourceImageUrl ||
        !isDurablePlacementSourceImageUrl(sourceImageUrl) ||
        x === null ||
        y === null
      ) {
        console.info("[placement-layer] node create skipped", {
          reason: !roomId
            ? "missing roomId"
            : !versionId
              ? "missing versionId"
            : !sourceImageUrl
              ? "missing sourceImageUrl"
              : !isDurablePlacementSourceImageUrl(sourceImageUrl)
                ? "sourceImageUrl is transient or invalid"
                : xRaw === null || yRaw === null
                ? "missing coordinates"
                : "unknown validation failure",
          roomId: roomId ?? null,
          versionId: versionId ?? null,
          hasSourceImageUrl: Boolean(sourceImageUrl),
          hasX: xRaw !== null,
          hasY: yRaw !== null,
          operationId,
        });
        return;
      }

      try {
        if (operationId !== null) {
          placementNodeCreateGuardByOperationRef.current.set(operationId, "in_flight");
        }
        const accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          console.info("[placement-layer] node create skipped", {
            reason: "missing access token",
            roomId,
            operationId,
          });
          if (operationId !== null) {
            placementNodeCreateGuardByOperationRef.current.delete(operationId);
          }
          return;
        }
        const payload = {
          roomId,
          versionId,
          furnitureId: args.furnitureId ?? null,
          thumbnailUrl,
          thumbnailPath,
          sourceImageUrl,
          sourceImagePath,
          // Persist normalized [0,1] canvas/image coordinates.
          x,
          y,
          scale: 1,
          rotation: 0,
          isVisible: true,
          dedupe,
          metadata,
        };
        const res = await fetch("/api/vibode/room-furniture-placements", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        const json = (await res.json().catch(() => ({}))) as PlacementLayerCreateResponse;
        const createdNode = normalizePlacementLayerNode(json.node);
        if (!createdNode) {
          throw new Error("node missing from create response");
        }
        const shouldEnforceUserDirectedMetadata =
          metadata.placementIntent === "user_directed" &&
          (metadata.placementSource === "clipboard" ||
            metadata.placementSource === "product_url" ||
            metadata.placementSource === "my_furniture" ||
            metadata.placementSource === "swap");
        const localCreatedNode = shouldEnforceUserDirectedMetadata
          ? {
              ...createdNode,
              metadata: normalizePlacementMetadata(
                {
                  ...createdNode.metadata,
                  ...metadata,
                  ownership: "user",
                  placementSource: metadata.placementSource,
                },
                createdNode.metadata
              ),
            }
          : createdNode;
        const nextNodes = [
          ...placementLayerNodesRef.current.filter((node) => node.id !== localCreatedNode.id),
          localCreatedNode,
        ];
        placementLayerNodesRef.current = nextNodes;
        setPlacementLayerNodes(nextNodes);
        setIsFurnitureLayerEnabled(true);
        sceneDirtyLocallyConfirmedRef.current = true;
        await updateSceneNeedsUpdateFromPlacements(nextNodes, versionId, {
          missingRenderedHashMeansDirty: true,
        });
        placementLayerHydratedScopeKeyRef.current = `${roomId}:${versionId}`;
        console.log("[placement-layer] node created", {
          roomId,
          versionId,
          id: localCreatedNode.id,
          furnitureId: localCreatedNode.furnitureId,
          hasSourceImagePath: Boolean(localCreatedNode.sourceImagePath),
          hasThumbnailPath: Boolean(localCreatedNode.thumbnailPath),
          operationId,
        });
        if (operationId !== null) {
          placementNodeCreateGuardByOperationRef.current.set(operationId, "done");
          if (placementNodeCreateGuardByOperationRef.current.size > 200) {
            const firstKey = placementNodeCreateGuardByOperationRef.current.keys().next().value;
            if (typeof firstKey === "number") {
              placementNodeCreateGuardByOperationRef.current.delete(firstKey);
            }
          }
        }
      } catch (err: unknown) {
        if (operationId !== null) {
          placementNodeCreateGuardByOperationRef.current.delete(operationId);
        }
        console.warn("[placement-layer] node create failed", {
          roomId,
          operationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [updateSceneNeedsUpdateFromPlacements]
  );

  const updatePlacementLayerNodePositionLocal = useCallback((id: string, xNorm: number, yNorm: number) => {
    const x = Math.max(0, Math.min(1, xNorm));
    const y = Math.max(0, Math.min(1, yNorm));
    setPlacementLayerNodes((prev) =>
      prev.map((node) => (node.id === id ? { ...node, x, y } : node))
    );
  }, []);
  const handlePlacementLayerDragStateChange = useCallback((state: PlacementLayerDragState | null) => {
    setPlacementLayerDragState(state);
  }, []);

  const persistPlacementLayerNodePosition = useCallback(
    async (args: {
      id: string;
      xNorm: number;
      yNorm: number;
      previousXNorm: number;
      previousYNorm: number;
    }) => {
      const id = args.id.trim();
      if (!id) return;
      const x = Math.max(0, Math.min(1, args.xNorm));
      const y = Math.max(0, Math.min(1, args.yNorm));
      const previousX = Math.max(0, Math.min(1, args.previousXNorm));
      const previousY = Math.max(0, Math.min(1, args.previousYNorm));
      let patchAttempted = false;
      let patchFailure: { status: number; body: string } | null = null;
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          throw new Error("missing access token");
        }
        const currentNode =
          placementLayerNodesRef.current.find((node) => node.id === id) ?? null;
        const shouldClaimSuggestedMarker =
          currentNode?.metadata?.ownership === "vibode" &&
          currentNode?.metadata?.placementSource === "model_vision_inferred";
        const patchBody: Record<string, unknown> = {
          id,
          x,
          y,
        };
        if (shouldClaimSuggestedMarker) {
          patchBody.metadata = {
            placementIntent: "model_decided",
            placementSource: "user_adjusted",
            ownership: "user",
            confidence: 1,
          };
        }
        patchAttempted = true;
        const res = await fetch("/api/vibode/room-furniture-placements", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(patchBody),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          patchFailure = { status: res.status, body: text };
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        const payload = (await res.json().catch(() => ({}))) as PlacementLayerCreateResponse;
        const patchedNode = normalizePlacementLayerNode(payload.node);
        const nextNodes = placementLayerNodesRef.current.map((node) => {
          if (node.id !== id) return node;
          if (patchedNode) return patchedNode;
          if (!shouldClaimSuggestedMarker) {
            return { ...node, x, y };
          }
          return {
            ...node,
            x,
            y,
            metadata: normalizePlacementMetadata(
              {
                ...node.metadata,
                ownership: "user",
                placementSource: "user_adjusted",
              },
              node.metadata
            ),
          };
        });
        placementLayerNodesRef.current = nextNodes;
        setPlacementLayerNodes(nextNodes);
        if (shouldClaimSuggestedMarker && selectedVersionId && vibodeRoomId) {
          let baselineUpdated = false;
          try {
            const { renderedPlacementSnapshot, placementStateHash } =
              await computePlacementStateHashAndSnapshot(nextNodes);
            const sceneRenderState = {
              renderedPlacementStateHash: placementStateHash,
              renderedPlacementSnapshot,
              renderedAt: new Date().toISOString(),
              sourceVersionId: selectedVersionId,
            };
            const updatedMetadata = await persistSceneRenderStateForVersion({
              roomId: vibodeRoomId,
              assetId: selectedVersionId,
              accessToken,
              sceneRenderState,
            });
            setVersions(
              versions.map((asset) => {
                if (asset.id !== selectedVersionId) return asset;
                return {
                  ...asset,
                  metadata:
                    updatedMetadata ??
                    {
                      ...(isRecord(asset.metadata) ? asset.metadata : {}),
                      sceneRenderState,
                    },
                };
              })
            );
            sceneDirtyLocallyConfirmedRef.current = false;
            setSceneNeedsUpdate(false);
            setCanRestoreOriginalPlacementPositions(false);
            baselineUpdated = true;
          } catch (err: unknown) {
            console.warn("[placement-layer] failed to persist clean baseline for suggested marker claim", {
              id,
              versionId: selectedVersionId,
              roomId: vibodeRoomId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          if (!baselineUpdated) {
            sceneDirtyLocallyConfirmedRef.current = true;
            await updateSceneNeedsUpdateFromPlacements(nextNodes, selectedVersionId, {
              missingRenderedHashMeansDirty: true,
            });
          }
        } else {
          sceneDirtyLocallyConfirmedRef.current = true;
          await updateSceneNeedsUpdateFromPlacements(nextNodes, selectedVersionId, {
            missingRenderedHashMeansDirty: true,
          });
        }
      } catch {
        if (patchAttempted) {
          const rolledBackNodes = placementLayerNodesRef.current.map((node) =>
            node.id === id
              ? {
                  ...node,
                  x: previousX,
                  y: previousY,
                }
              : node
          );
          placementLayerNodesRef.current = rolledBackNodes;
          setPlacementLayerNodes(rolledBackNodes);
        }
        if (patchFailure) {
          console.warn("[placement-layer] node move PATCH failed", {
            id,
            status: patchFailure.status,
            body: patchFailure.body,
          });
        }
        pushSnack("Unable to save furniture marker position.");
      }
    },
    [
      computePlacementStateHashAndSnapshot,
      pushSnack,
      selectedVersionId,
      setVersions,
      updateSceneNeedsUpdateFromPlacements,
      vibodeRoomId,
      versions,
    ]
  );

  const deletePlacementLayerNode = useCallback(
    async (id: string) => {
      const trimmedId = id.trim();
      if (!trimmedId) return;
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        if (!accessToken) {
          throw new Error("missing access token");
        }
        const res = await fetch(`/api/vibode/room-furniture-placements?id=${encodeURIComponent(trimmedId)}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        const nextNodes = placementLayerNodesRef.current.filter((node) => node.id !== trimmedId);
        placementLayerNodesRef.current = nextNodes;
        setPlacementLayerNodes(nextNodes);
        sceneDirtyLocallyConfirmedRef.current = true;
        await updateSceneNeedsUpdateFromPlacements(nextNodes, selectedVersionId, {
          missingRenderedHashMeansDirty: true,
        });
      } catch (err: unknown) {
        console.warn("[placement-layer] node delete failed", {
          id: trimmedId,
          error: err instanceof Error ? err.message : String(err),
        });
        pushSnack("Unable to delete furniture marker.");
      }
    },
    [pushSnack, selectedVersionId, updateSceneNeedsUpdateFromPlacements]
  );

  const runPasteToPlaceClickTargetEdit = useCallback(
    async ({
      action,
      xNorm,
      yNorm,
      preparedResult,
      operationId,
      pasteToPlaceControl,
      placementSnapshot,
    }: PasteToPlaceClickHint & {
      action: "add" | "swap";
      preparedResult?: PasteToPlaceMenuPreparationResult;
      operationId?: number;
      pasteToPlaceControl?: PasteToPlaceJobControl;
      placementSnapshot?: PendingPasteToPlacePlacementSnapshot;
    }): Promise<boolean> => {
      const snapshotForOperation =
        placementSnapshot && placementSnapshot.operationId === operationId
          ? placementSnapshot
          : typeof operationId === "number"
            ? getPendingPasteToPlacePlacementSnapshotForOperation(operationId)
            : null;
      const resolvedOperationId = snapshotForOperation?.operationId ?? operationId;
      const resolvedPasteToPlaceControl = snapshotForOperation?.pasteToPlaceControl ?? pasteToPlaceControl;
      const placementPoint = snapshotForOperation?.point ?? { xNorm, yNorm };
      const isOperationStale = (context?: string): boolean => {
        void context;
        if (typeof resolvedOperationId !== "number") return false;
        if (isPendingPasteToPlaceCommitOperationActive(resolvedOperationId)) return false;
        return true;
      };
      if (isOperationStale("execute:start")) {
        clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
        return false;
      }
      if (isPasteToPlaceSettling) {
        console.info("[Paste-to-Place][settling] Place blocked because settling", {
          context: "run_paste_to_place_click_target_edit",
        });
        clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
        return false;
      }
      if (
        activeTool === "calibrate" ||
        activeTool === "remove" ||
        activeTool === "swap" ||
        activeTool === "rotate" ||
        isRotateMarkerTargeting
      ) {
        clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
        return false;
      }
      if (!isBaseImageEditReady) {
        pushSnack(ROOM_PREPARING_MESSAGE);
        clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
        return true;
      }
      if (isBusy || isEditRunning) {
        clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
        return false;
      }

      if (preparedResult && preparedResult.status === "no-image") {
        finalizePasteToPlaceCommitOperation({
          operationId: resolvedOperationId,
          pasteToPlaceControl: resolvedPasteToPlaceControl,
          clearUi: true,
        });
        return false;
      }
      if (preparedResult && preparedResult.status === "blocked") {
        finalizePasteToPlaceCommitOperation({
          operationId: resolvedOperationId,
          pasteToPlaceControl: resolvedPasteToPlaceControl,
          clearUi: true,
        });
        return true;
      }
      if (preparedResult && preparedResult.status === "failed") {
        finalizePasteToPlaceCommitOperation({
          operationId: resolvedOperationId,
          pasteToPlaceControl: resolvedPasteToPlaceControl,
          clearUi: true,
        });
        return true;
      }

      const resolvedSource =
        preparedResult && preparedResult.status === "ready"
          ? preparedResult.source
          : snapshotForOperation?.sourceAtCommit ?? activePasteSourceRef.current;
      if (!resolvedSource) {
        pushSnack("Copy a product image, paste a product link, or choose an item from My Furniture first.");
        finalizePasteToPlaceCommitOperation({
          operationId: resolvedOperationId,
          pasteToPlaceControl: resolvedPasteToPlaceControl,
          clearUi: true,
        });
        return true;
      }

      try {
        if (isOperationStale("execute:before_placement_persist")) {
          clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
          return false;
        }
        setPasteToPlaceStatus("placing");
        const sourceForPlacement = resolvedSource;
        const initialSavedFurnitureId =
          sourceForPlacement.preparedProduct.savedFurnitureId ??
          (sourceForPlacement.type === "product_url" ? sourceForPlacement.furnitureId : null) ??
          null;
        const durableNormalizedPreviewUrl = isDurablePlacementSourceImageUrl(
          sourceForPlacement.normalizedPreviewUrl
        )
          ? sourceForPlacement.normalizedPreviewUrl
          : null;
        const durableRawPreviewUrl = isDurablePlacementSourceImageUrl(sourceForPlacement.rawPreviewUrl)
          ? sourceForPlacement.rawPreviewUrl
          : null;
        const durableSavedPreviewUrl =
          sourceForPlacement.type === "clipboard"
            ? sourceForPlacement.durableSavedPreviewUrl
            : null;
        const placementSourceImageUrl =
          durableSavedPreviewUrl ?? durableNormalizedPreviewUrl ?? durableRawPreviewUrl ?? null;
        const sourceImagePath =
          sourceForPlacement.sourceImagePathHint ??
          extractStorageObjectPathFromUnknown([
            sourceForPlacement.preparedProduct,
            sourceForPlacement,
          ]) ??
          extractSupabaseStorageObjectPathFromUrl(placementSourceImageUrl);
        const placementThumbnailUrl = placementSourceImageUrl;
        const thumbnailPath =
          sourceForPlacement.thumbnailPathHint ??
          extractStorageObjectPathFromUnknown([
            sourceForPlacement.preparedProduct,
            sourceForPlacement,
          ]) ??
          extractSupabaseStorageObjectPathFromUrl(placementThumbnailUrl);
        const roomIdForPlacement =
          snapshotForOperation?.roomIdAtCommit ?? vibodeRoomId?.trim() ?? null;
        const versionIdForPlacement =
          snapshotForOperation?.versionIdAtCommit ?? activeAssetId?.trim() ?? null;
        const placementSource: PlacementSource =
          action === "swap"
            ? "swap"
            : sourceForPlacement.type === "product_url"
            ? "product_url"
            : sourceForPlacement.type === "my_furniture"
            ? "my_furniture"
            : "clipboard";
        const placementMetadata = defaultUserDirectedPlacementMetadata(placementSource);

        await createPlacementLayerNodeAfterPasteCommit({
          operationId: resolvedOperationId,
          roomId: roomIdForPlacement,
          versionId: versionIdForPlacement,
          furnitureId: initialSavedFurnitureId,
          sourceImageUrl: placementSourceImageUrl,
          thumbnailUrl: placementThumbnailUrl,
          sourceImagePath: sourceImagePath ?? null,
          thumbnailPath: thumbnailPath ?? null,
          xNorm: placementPoint.xNorm,
          yNorm: placementPoint.yNorm,
          dedupe: true,
          metadata: placementMetadata,
        });
        if (roomIdForPlacement && versionIdForPlacement) {
          void hydratePlacementLayerNodes({
            roomId: roomIdForPlacement,
            versionId: versionIdForPlacement,
            trigger: "paste-to-place",
          });
        }

        const isAfterEditStale = isOperationStale("execute:after_placement_persist");

        let savedFurnitureId =
          sourceForPlacement.preparedProduct.savedFurnitureId ??
          (sourceForPlacement.type === "product_url" ? sourceForPlacement.furnitureId : null) ??
          null;
        if (sourceForPlacement.type === "product_url" && !savedFurnitureId) {
          console.info("[Paste-to-Place][product_url_save] invoking post-placement autosave", {
            operationId: resolvedOperationId ?? null,
            preparedOnly: sourceForPlacement.preparedOnly,
            hasSavedFurnitureId: !!sourceForPlacement.preparedProduct.savedFurnitureId,
          });
          const persistedFurnitureId = await savePreparedProductUrlToMyFurniture(sourceForPlacement, {
            operationId: resolvedOperationId,
          });
          if (isOperationStale("execute:after_product_url_save")) {
            clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
            return false;
          }
          if (persistedFurnitureId) {
            savedFurnitureId = persistedFurnitureId;
          } else {
            pushSnack("Placed successfully, but we couldn't save it to My Furniture.");
          }
        }
        if (savedFurnitureId) {
          void trackMyFurnitureUsage(
            savedFurnitureId,
            action === "add" ? "added" : "swapped"
          );
        }
        if (!isDevUnlockPasteToPlace && !isAfterEditStale) {
          setHasUsedFreePasteToPlace(true);
        }
        return true;
      } finally {
        if (!isOperationStale("execute:finally")) {
          setPasteToPlaceStatus(null);
          clearPasteToPlaceProgressPreviewForOperation(resolvedOperationId);
          clearActivePasteToPlaceJobControlIfMatching(resolvedPasteToPlaceControl);
          clearPendingPasteToPlacePlacementSnapshot(resolvedOperationId);
        }
      }
    },
    [
      activeTool,
      activeAssetId,
      clearPendingPasteToPlacePlacementSnapshot,
      clearPasteToPlaceProgressPreviewForOperation,
      finalizePasteToPlaceCommitOperation,
      isBaseImageEditReady,
      isBusy,
      isDevUnlockPasteToPlace,
      isEditRunning,
      isPasteToPlaceSettling,
      isPendingPasteToPlaceCommitOperationActive,
      getPendingPasteToPlacePlacementSnapshotForOperation,
      isRotateMarkerTargeting,
      pushSnack,
      createPlacementLayerNodeAfterPasteCommit,
      hydratePlacementLayerNodes,
      savePreparedProductUrlToMyFurniture,
      trackMyFurnitureUsage,
      vibodeRoomId,
      clearActivePasteToPlaceJobControlIfMatching,
    ]
  );

  const handlePasteToPlaceAdd = useCallback(
    async ({
      xNorm,
      yNorm,
      preparedResult,
      operationId,
      pasteToPlaceControl,
      placementSnapshot,
    }: PasteToPlaceClickHint & {
      preparedResult?: PasteToPlaceMenuPreparationResult;
      operationId?: number;
      pasteToPlaceControl?: PasteToPlaceJobControl;
      placementSnapshot?: PendingPasteToPlacePlacementSnapshot;
    }): Promise<boolean> =>
      runPasteToPlaceClickTargetEdit({
        action: "add",
        xNorm,
        yNorm,
        preparedResult,
        operationId,
        pasteToPlaceControl,
        placementSnapshot,
      }),
    [runPasteToPlaceClickTargetEdit]
  );

  const openPasteToPlaceMenu = useCallback(
    async (state: NonNullable<PasteToPlaceMenuState>) => {
      if (isRemoveMarkerTargeting || isRotateMarkerTargeting) {
        return;
      }
      if (isDevSceneRebuildRunning) {
        pushSnack("Room update is still running. You can place furniture after this finishes.");
        return;
      }
      if (isPasteToPlaceSettling) {
        console.info("[Paste-to-Place][settling] Place blocked because settling", {
          context: "open_menu",
        });
        return;
      }
      const isCommittedOperationPending = hasPendingPasteToPlaceCommit();
      const operationId = beginPasteToPlaceOperation();
      clearAwaitingPasteToPlaceSession();
      clearPasteEventClipboardImagePayload();
      if (!isCommittedOperationPending) {
        setPasteToPlaceProgressCardState(null);
        setPasteToPlaceProgressCardPreviewUrl(null);
        setIsPasteToPlaceMenuIngesting(false);
      }
      setPasteToPlaceMenuState({
        ...state,
        anchorX: state.anchorX ?? state.xNorm,
        anchorY: state.anchorY ?? state.yNorm,
      });
      clearPasteToPlaceUrlCandidatePreview();
      const currentSource = activePasteSourceRef.current;
      if (currentSource?.type === "product_url") {
        clearPasteToPlaceMenuClipboardPreview();
        clearPasteToPlaceUrlCandidatePreview();
        return;
      }
      if (isLikelySafariBrowser()) {
        beginAwaitingPasteToPlaceSession(operationId, "safari");
        return;
      }
      const previewToken = pasteToPlaceMenuClipboardPreviewTokenRef.current + 1;
      pasteToPlaceMenuClipboardPreviewTokenRef.current = previewToken;
      setPasteToPlaceMenuClipboardPreviewUrl(null);
      setIsPasteToPlaceMenuClipboardPreviewLoading(true);
      try {
        const clipboardReadResult = await readClipboardImageWithStatus();
        if (previewToken !== pasteToPlaceMenuClipboardPreviewTokenRef.current) return;
        const clipboardImage = clipboardReadResult.image;
        if (!clipboardImage) {
          if (clipboardReadResult.status === "access-unavailable") {
            beginAwaitingPasteToPlaceSession(operationId, "clipboard_access_unavailable");
            return;
          }
          setPasteToPlaceMenuClipboardPreviewUrl(null);
          const clipboardTextResult = await readClipboardTextWithStatus();
          if (previewToken !== pasteToPlaceMenuClipboardPreviewTokenRef.current) return;
          if (!isPasteToPlaceOperationActive(operationId)) return;
          if (clipboardTextResult.status !== "ok") return;
          const normalizedClipboardUrl = normalizeLikelyUrl(clipboardTextResult.text ?? "");
          if (!normalizedClipboardUrl) return;
          setPasteToPlaceProductUrlInput(normalizedClipboardUrl);
          await requestPasteToPlaceUrlCandidatePreview({
            sourceUrl: normalizedClipboardUrl,
            operationId,
            showFailureSnack: true,
          });
          return;
        }
        clearPasteToPlaceUrlCandidatePreview();
        const clipboardPreviewDataUrl = await blobToDataUrl(clipboardImage.blob);
        if (previewToken !== pasteToPlaceMenuClipboardPreviewTokenRef.current) return;
        if (!clipboardPreviewDataUrl || !clipboardPreviewDataUrl.startsWith("data:image/")) {
          setPasteToPlaceMenuClipboardPreviewUrl(null);
          return;
        }
        const sourceAfterPreviewRead = activePasteSourceRef.current;
        const clipboardPreviewDataUrlHash = hashDataUrlForLogs(clipboardPreviewDataUrl);
        if (clipboardPreviewDataUrlHash) {
          const suppressedClipboardPreviewHash =
            suppressedPasteToPlaceMenuClipboardPreviewHashRef.current;
          if (
            sourceAfterPreviewRead?.type === "my_furniture" &&
            suppressedClipboardPreviewHash &&
            clipboardPreviewDataUrlHash === suppressedClipboardPreviewHash
          ) {
            setPasteToPlaceMenuClipboardPreviewUrl(null);
            return;
          }
          if (
            sourceAfterPreviewRead?.type === "clipboard" &&
            sourceAfterPreviewRead.clipboardDataUrlHash === clipboardPreviewDataUrlHash
          ) {
            setPasteToPlaceMenuClipboardPreviewUrl(null);
            return;
          }
          if (
            suppressedClipboardPreviewHash &&
            clipboardPreviewDataUrlHash !== suppressedClipboardPreviewHash
          ) {
            suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
          }
          lastSurfacedProvisionalClipboardPreviewHashRef.current = clipboardPreviewDataUrlHash;
          setPendingFurnitureClipboardSuppressionHash(clipboardPreviewDataUrlHash);
        }
        setPasteToPlaceMenuClipboardPreviewUrl(clipboardPreviewDataUrl);
      } finally {
        if (previewToken === pasteToPlaceMenuClipboardPreviewTokenRef.current) {
          setIsPasteToPlaceMenuClipboardPreviewLoading(false);
        }
      }
    },
    [
      beginPasteToPlaceOperation,
      clearAwaitingPasteToPlaceSession,
      clearPasteEventClipboardImagePayload,
      clearPasteToPlaceMenuClipboardPreview,
      clearPasteToPlaceUrlCandidatePreview,
      hasPendingPasteToPlaceCommit,
      isPasteToPlaceOperationActive,
      isDevSceneRebuildRunning,
      isRemoveMarkerTargeting,
      isRotateMarkerTargeting,
      isPasteToPlaceSettling,
      pushSnack,
      beginAwaitingPasteToPlaceSession,
      readClipboardTextWithStatus,
      requestPasteToPlaceUrlCandidatePreview,
    ]
  );

  const dismissPasteToPlaceMenu = useCallback(
    (options?: {
      clearPreview?: boolean;
      clearClipboardPreview?: boolean;
      preserveAwaitingPasteSession?: boolean;
    }) => {
      const isCommittedOperationPending = hasPendingPasteToPlaceCommit();
      const clearPreview = options?.clearPreview ?? !isCommittedOperationPending;
      const clearClipboardPreview = options?.clearClipboardPreview ?? true;
      const preserveAwaitingPasteSession = options?.preserveAwaitingPasteSession === true;
      setPasteToPlaceMenuState(null);
      if (!preserveAwaitingPasteSession) {
        clearAwaitingPasteToPlaceSession();
        clearPasteEventClipboardImagePayload();
      }
      if (clearClipboardPreview) {
        clearPasteToPlaceMenuClipboardPreview();
        clearPasteToPlaceUrlCandidatePreview();
      }
      if (clearPreview) {
        clearPasteToPlaceProgressPreview();
      }
    },
    [
      clearAwaitingPasteToPlaceSession,
      clearPasteEventClipboardImagePayload,
      clearPasteToPlaceMenuClipboardPreview,
      clearPasteToPlaceUrlCandidatePreview,
      clearPasteToPlaceProgressPreview,
      hasPendingPasteToPlaceCommit,
    ]
  );

  const preparePasteToPlaceProductFromMenu = useCallback(
    async ({
      xNorm,
      yNorm,
      operationId,
      placementSnapshot,
    }: PasteToPlaceClickHint & {
      operationId?: number;
      placementSnapshot?: PendingPasteToPlacePlacementSnapshot;
    }): Promise<PasteToPlaceMenuPreparationResult> => {
      const isOperationStale = (context?: string): boolean => {
        void context;
        if (typeof operationId !== "number") return false;
        if (isPendingPasteToPlaceCommitOperationActive(operationId)) return false;
        return true;
      };

      if (isOperationStale("prepare_from_menu:start")) {
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      const snapshotForOperation =
        placementSnapshot && placementSnapshot.operationId === operationId
          ? placementSnapshot
          : typeof operationId === "number"
            ? getPendingPasteToPlacePlacementSnapshotForOperation(operationId)
            : null;
      const source = snapshotForOperation?.sourceAtCommit ?? activePasteSourceRef.current;
      const hasProvisionalClipboardPreview = Boolean(
        snapshotForOperation?.provisionalClipboardPreviewUrlAtCommit ?? pasteToPlaceMenuClipboardPreviewUrl
      );
      const hasProvisionalUrlPreview = Boolean(
        snapshotForOperation?.urlCandidatePreviewAtCommit ?? pasteToPlaceUrlCandidatePreview
      );
      const classifiedProductUrlInput = classifyPasteToPlaceUrl(
        snapshotForOperation?.productUrlInputAtCommit ?? pasteToPlaceProductUrlInput
      );
      if (source && !hasProvisionalClipboardPreview && !hasProvisionalUrlPreview) {
        if (source.type === "my_furniture") {
          try {
            const sourceFurnitureIds =
              source.furnitureIds.length > 0 ? source.furnitureIds : [source.furnitureId];
            let mergedEligibleSkus: VibodeEligibleSku[] = [];
            const resolvedFurnitureIds: string[] = [];
            for (const furnitureId of sourceFurnitureIds) {
              if (isOperationStale("prepare_from_menu:before_my_furniture_resolve")) {
                return { status: "failed", reason: "paste-to-place-operation-stale" };
              }
              const resolved = await resolveMyFurnitureForEdit(furnitureId);
              if (isOperationStale("prepare_from_menu:after_my_furniture_resolve")) {
                return { status: "failed", reason: "paste-to-place-operation-stale" };
              }
              if (!resolved) continue;
              mergedEligibleSkus = mergeEligibleSkusForSavedFurniture(mergedEligibleSkus, resolved.eligibleSku);
              resolvedFurnitureIds.push(furnitureId);
            }
            if (isOperationStale("prepare_from_menu:after_my_furniture_revalidate")) {
              return { status: "failed", reason: "paste-to-place-operation-stale" };
            }
            if (resolvedFurnitureIds.length === 0 || mergedEligibleSkus.length === 0) {
              throw new Error("Saved furniture item was not found.");
            }
            const primaryFurnitureId = resolvedFurnitureIds[0];
            const preferredSku = mergedEligibleSkus.find((sku) => sku.skuId === source.skuId) ?? mergedEligibleSkus[0];
            const preparedProduct: PasteToPlacePreparedProduct = {
              source: "my_furniture",
              skuId: preferredSku.skuId,
              eligibleSkus: mergedEligibleSkus,
              savedFurnitureId: primaryFurnitureId,
            };
            const fallbackPreviewUrl =
              preferredSku.variants.find(
                (variant) => typeof variant?.imageUrl === "string" && variant.imageUrl.trim().length > 0
              )?.imageUrl ?? null;
            const refreshedSource: Extract<ActivePasteSource, { type: "my_furniture" }> = {
              ...source,
              skuId: preparedProduct.skuId,
              furnitureId: primaryFurnitureId,
              furnitureIds: resolvedFurnitureIds,
              selectionCount: resolvedFurnitureIds.length,
              preparedProduct,
              normalizedPreviewUrl: source.normalizedPreviewUrl ?? fallbackPreviewUrl,
            };
            activatePasteToPlaceSource(refreshedSource, "my_furniture_revalidated");
            return { status: "ready", source: refreshedSource };
          } catch {
            if (isOperationStale("prepare_from_menu:my_furniture_revalidate_failed")) {
              return { status: "failed", reason: "paste-to-place-operation-stale" };
            }
            clearPasteToPlaceActiveSource("my_furniture_unresolvable");
            setPasteToPlaceStatus(null);
            clearPasteToPlaceProgressPreviewForOperation(operationId);
            pushSnack("That saved furniture item is no longer available. Choose another item.");
            return { status: "failed", reason: "my-furniture-source-stale" };
          }
        }
        return { status: "ready", source };
      }
      if (!source && !hasProvisionalClipboardPreview) {
        const directImageCandidateUrl =
          (snapshotForOperation?.urlCandidatePreviewAtCommit ?? pasteToPlaceUrlCandidatePreview)?.kind ===
          "direct_image_url"
            ? (snapshotForOperation?.urlCandidatePreviewAtCommit ?? pasteToPlaceUrlCandidatePreview)?.sourceUrl
            : classifiedProductUrlInput?.kind === "direct_image_url"
              ? classifiedProductUrlInput.normalizedUrl
              : null;
        if (directImageCandidateUrl) {
          if (isPasteToPlaceMenuIngesting && pasteToPlaceStatus === "preparing") {
            return { status: "failed", reason: "product-url-prepare-in-progress" };
          }
          const preparedDirectImageSource = await preparePasteToPlaceDirectImageUrlSource({
            imageUrl: directImageCandidateUrl,
            operationId,
          });
          if (isOperationStale("prepare_from_menu:after_direct_image_prepare")) {
            return { status: "failed", reason: "paste-to-place-operation-stale" };
          }
          if (
            preparedDirectImageSource?.type === "product_url" &&
            preparedDirectImageSource.urlKind === "direct_image_url"
          ) {
            return { status: "ready", source: preparedDirectImageSource };
          }
          return { status: "failed", reason: "product-url-prepare-failed" };
        }
      }
      if (
        !source &&
        !hasProvisionalClipboardPreview &&
        classifiedProductUrlInput?.kind === "product_page_url"
      ) {
        if (isPasteToPlaceMenuIngesting && pasteToPlaceStatus === "preparing") {
          return { status: "failed", reason: "product-url-prepare-in-progress" };
        }
        const preparedUrlSource = await preparePasteToPlaceProductUrlSource({
          operationId,
          sourceUrl:
            classifiedProductUrlInput?.kind === "product_page_url"
              ? classifiedProductUrlInput.normalizedUrl
              : undefined,
        });
        if (isOperationStale("prepare_from_menu:after_product_url_prepare")) {
          return { status: "failed", reason: "paste-to-place-operation-stale" };
        }
        if (preparedUrlSource?.type === "product_url") {
          return { status: "ready", source: preparedUrlSource };
        }
        return { status: "failed", reason: "product-url-prepare-failed" };
      }

      setIsPasteToPlaceMenuIngesting(true);
      try {
        const prepared = await preparePasteToPlaceClipboardProduct({
          xNorm,
          yNorm,
          operationId,
          trigger: "explicit_paste_flow",
        });
        if (isOperationStale("prepare_from_menu:after_prepare")) {
          return { status: "failed", reason: "paste-to-place-operation-stale" };
        }
        if (prepared.status !== "ready") {
          return prepared;
        }
        return {
          status: "ready",
          source: prepared.source,
        };
      } finally {
        if (!isOperationStale("prepare_from_menu:finally")) {
          setIsPasteToPlaceMenuIngesting(false);
        }
      }
    },
    [
      activatePasteToPlaceSource,
      clearPasteToPlaceActiveSource,
      clearPasteToPlaceProgressPreviewForOperation,
      getPendingPasteToPlacePlacementSnapshotForOperation,
      isPendingPasteToPlaceCommitOperationActive,
      isPasteToPlaceMenuIngesting,
      pasteToPlaceMenuClipboardPreviewUrl,
      pasteToPlaceUrlCandidatePreview,
      pasteToPlaceProductUrlInput,
      pasteToPlaceStatus,
      preparePasteToPlaceDirectImageUrlSource,
      preparePasteToPlaceProductUrlSource,
      pushSnack,
      preparePasteToPlaceClipboardProduct,
      resolveMyFurnitureForEdit,
    ]
  );

  const handlePasteToPlacePlaceHere = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    if (isPasteToPlaceRefreshInteractionLocked || isRefreshingCopiedItemRef.current) {
      pushSnack(
        isAwaitingRefreshCopiedItem
          ? "Press ⌘V to finish refreshing copied item."
          : "Refreshing copied item. Try again in a moment."
      );
      return;
    }
    if (isPasteToPlaceSettling) {
      console.info("[Paste-to-Place][settling] Place blocked because settling", {
        context: "place_here",
      });
      dismissPasteToPlaceMenu();
      return;
    }
    const menuStateSnapshot = pasteToPlaceMenuState;
    if (isMyFurnitureMultiPreparedSource) {
      pushSnack("Place here is unavailable for multi-selected My Furniture items.");
      return;
    }
    const pendingCountAtStart = getPendingPasteToPlaceCommitCount();
    if (!canStartPasteToPlaceCommit({ mode: "place_here", pendingCount: pendingCountAtStart })) {
      pushSnack("Furniture is still saving. You can place another after this finishes.");
      return;
    }
    if (
      activeTool === "calibrate" ||
      activeTool === "remove" ||
      activeTool === "swap" ||
      activeTool === "rotate" ||
      isRotateMarkerTargeting ||
      !scene.baseImageUrl ||
      isBusy ||
      isEditRunning
    ) {
      dismissPasteToPlaceMenu();
      return;
    }

    const awaitingOperationId =
      pendingCountAtStart > 0 ? null : resolveAwaitingPasteToPlaceOperationIdForMenuAction();
    const operationId = awaitingOperationId ?? beginPasteToPlacePlacementOperation();
    const pasteToPlaceControl = createPasteToPlaceJobControl(operationId);
    setActivePasteToPlaceJobControl(pasteToPlaceControl);
    const placementSnapshot = createPendingPasteToPlacePlacementSnapshot({
      operationId,
      mode: "place_here",
      menuStateSnapshot,
      pasteToPlaceControl,
    });
    const progressPreviewUrl = getPasteToPlaceProgressCardPreviewUrlFromSnapshot(placementSnapshot);
    const isOperationStale = (): boolean => !isPendingPasteToPlaceCommitOperationActive(operationId);
    try {
      if (isOperationStale()) return;
      setPasteToPlaceProgressCardState(menuStateSnapshot);
      setPasteToPlaceProgressCardPreviewUrl(progressPreviewUrl);
      dismissPasteToPlaceMenu({
        clearPreview: false,
        clearClipboardPreview: false,
        preserveAwaitingPasteSession: true,
      });
      const { xNorm, yNorm } = menuStateSnapshot;
      if (isOperationStale()) return;
      const preparedResult = await preparePasteToPlaceProductFromMenu({
        xNorm,
        yNorm,
        operationId,
        placementSnapshot,
      });
      if (isOperationStale()) return;
      if (preparedResult.status === "ready") {
        const pendingCountAfterPrepare = getPendingPasteToPlaceCommitCount();
        if (pendingCountAfterPrepare > 2) {
          finalizePasteToPlaceCommitOperation({
            operationId,
            pasteToPlaceControl,
            clearUi: true,
          });
          pushSnack("Furniture is still saving. You can place another after this finishes.");
          return;
        }
        if (
          pendingCountAtStart > 0 &&
          !canStartPasteToPlaceCommit({
            mode: "place_here",
            pendingCount: pendingCountAtStart,
            sourceType: preparedResult.source.type,
          })
        ) {
          finalizePasteToPlaceCommitOperation({
            operationId,
            pasteToPlaceControl,
            clearUi: true,
          });
          pushSnack("Furniture is still saving. You can place another after this finishes.");
          return;
        }
      }
      await handlePasteToPlaceAdd({
        xNorm,
        yNorm,
        preparedResult,
        operationId,
        pasteToPlaceControl,
        placementSnapshot,
      });
    } finally {
      if (!isOperationStale() && pasteToPlaceStatus !== "placing") {
        clearActivePasteToPlaceJobControlIfMatching(pasteToPlaceControl);
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      } else if (isOperationStale()) {
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      }
    }
  }, [
    activeTool,
    beginPasteToPlacePlacementOperation,
    clearActivePasteToPlaceJobControlIfMatching,
    createPasteToPlaceJobControl,
    createPendingPasteToPlacePlacementSnapshot,
    canStartPasteToPlaceCommit,
    finalizePasteToPlaceCommitOperation,
    getPendingPasteToPlaceCommitCount,
    getPasteToPlaceProgressCardPreviewUrlFromSnapshot,
    clearPendingPasteToPlacePlacementSnapshot,
    dismissPasteToPlaceMenu,
    handlePasteToPlaceAdd,
    isBusy,
    isEditRunning,
    isAwaitingRefreshCopiedItem,
    isMyFurnitureMultiPreparedSource,
    isPendingPasteToPlaceCommitOperationActive,
    isPasteToPlaceRefreshInteractionLocked,
    isPasteToPlaceSettling,
    isRotateMarkerTargeting,
    pasteToPlaceMenuState,
    pasteToPlaceStatus,
    preparePasteToPlaceProductFromMenu,
    pushSnack,
    scene.baseImageUrl,
    setActivePasteToPlaceJobControl,
    resolveAwaitingPasteToPlaceOperationIdForMenuAction,
  ]);

  const handlePasteToPlaceSwap = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    if (isPasteToPlaceRefreshInteractionLocked || isRefreshingCopiedItemRef.current) {
      pushSnack(
        isAwaitingRefreshCopiedItem
          ? "Press ⌘V to finish refreshing copied item."
          : "Refreshing copied item. Try again in a moment."
      );
      return;
    }
    if (isPasteToPlaceSettling) {
      console.info("[Paste-to-Place][settling] Place blocked because settling", {
        context: "swap",
      });
      dismissPasteToPlaceMenu();
      return;
    }
    const menuStateSnapshot = pasteToPlaceMenuState;
    if (isMyFurnitureMultiPreparedSource) {
      pushSnack("Swap item is unavailable for multi-selected My Furniture items.");
      return;
    }
    if (hasPendingPasteToPlaceCommit()) {
      pushSnack("Furniture is still saving. You can place another after this finishes.");
      return;
    }
    if (
      activeTool === "calibrate" ||
      activeTool === "remove" ||
      activeTool === "swap" ||
      activeTool === "rotate" ||
      isRotateMarkerTargeting ||
      !scene.baseImageUrl ||
      isBusy ||
      isEditRunning
    ) {
      dismissPasteToPlaceMenu();
      return;
    }

    const awaitingOperationId = resolveAwaitingPasteToPlaceOperationIdForMenuAction();
    const operationId = awaitingOperationId ?? beginPasteToPlacePlacementOperation();
    const pasteToPlaceControl = createPasteToPlaceJobControl(operationId);
    setActivePasteToPlaceJobControl(pasteToPlaceControl);
    const placementSnapshot = createPendingPasteToPlacePlacementSnapshot({
      operationId,
      mode: "swap_item",
      menuStateSnapshot,
      pasteToPlaceControl,
    });
    const progressPreviewUrl = getPasteToPlaceProgressCardPreviewUrlFromSnapshot(placementSnapshot);
    const isOperationStale = (): boolean => !isPendingPasteToPlaceCommitOperationActive(operationId);
    try {
      if (isOperationStale()) return;
      setPasteToPlaceProgressCardState(menuStateSnapshot);
      setPasteToPlaceProgressCardPreviewUrl(progressPreviewUrl);
      dismissPasteToPlaceMenu({
        clearPreview: false,
        clearClipboardPreview: false,
        preserveAwaitingPasteSession: true,
      });
      const { xNorm, yNorm } = menuStateSnapshot;
      if (isOperationStale()) return;
      const preparedResult = await preparePasteToPlaceProductFromMenu({
        xNorm,
        yNorm,
        operationId,
        placementSnapshot,
      });
      if (isOperationStale()) return;
      await runPasteToPlaceClickTargetEdit({
        action: "swap",
        xNorm,
        yNorm,
        preparedResult,
        operationId,
        pasteToPlaceControl,
        placementSnapshot,
      });
    } finally {
      if (!isOperationStale() && pasteToPlaceStatus !== "placing") {
        clearActivePasteToPlaceJobControlIfMatching(pasteToPlaceControl);
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      } else if (isOperationStale()) {
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      }
    }
  }, [
    activeTool,
    beginPasteToPlacePlacementOperation,
    clearActivePasteToPlaceJobControlIfMatching,
    createPasteToPlaceJobControl,
    createPendingPasteToPlacePlacementSnapshot,
    getPasteToPlaceProgressCardPreviewUrlFromSnapshot,
    clearPendingPasteToPlacePlacementSnapshot,
    dismissPasteToPlaceMenu,
    hasPendingPasteToPlaceCommit,
    isBusy,
    isEditRunning,
    isAwaitingRefreshCopiedItem,
    isMyFurnitureMultiPreparedSource,
    isPendingPasteToPlaceCommitOperationActive,
    isPasteToPlaceRefreshInteractionLocked,
    isPasteToPlaceSettling,
    isRotateMarkerTargeting,
    pasteToPlaceMenuState,
    pasteToPlaceStatus,
    preparePasteToPlaceProductFromMenu,
    pushSnack,
    runPasteToPlaceClickTargetEdit,
    scene.baseImageUrl,
    setActivePasteToPlaceJobControl,
    resolveAwaitingPasteToPlaceOperationIdForMenuAction,
  ]);

  const buildModelDecidedFurnitureCandidates = useCallback(
    (source: Exclude<ActivePasteSource, null>): ModelDecidedFurnitureCandidatePayload[] => {
      const placementSource: ModelDecidedFurnitureCandidatePayload["placementSource"] =
        source.type === "product_url"
          ? "product_url"
          : source.type === "my_furniture"
          ? "my_furniture"
          : "clipboard";
      const fallbackSourceImageUrl =
        (isDurablePlacementSourceImageUrl(source.normalizedPreviewUrl)
          ? source.normalizedPreviewUrl
          : null) ??
        (isDurablePlacementSourceImageUrl(source.rawPreviewUrl) ? source.rawPreviewUrl : null);
      const eligibleSkus = source.preparedProduct.eligibleSkus ?? [];
      const candidates: ModelDecidedFurnitureCandidatePayload[] = [];
      for (const [index, sku] of eligibleSkus.entries()) {
        const skuImageUrl =
          sku.variants.find(
            (variant) => typeof variant?.imageUrl === "string" && variant.imageUrl.trim().length > 0
          )?.imageUrl ?? null;
        const sourceImageUrl =
          (isDurablePlacementSourceImageUrl(skuImageUrl) ? skuImageUrl : null) ??
          fallbackSourceImageUrl;
        if (!sourceImageUrl) continue;
        const furnitureId =
          source.type === "my_furniture"
            ? source.furnitureIds[index] ?? source.furnitureId
            : source.preparedProduct.savedFurnitureId ?? null;
        candidates.push({
          furnitureId: furnitureId ?? null,
          skuId: sku.skuId ?? null,
          label: sku.label ?? sku.skuId ?? null,
          sourceImageUrl,
          sourceImagePath: extractStorageObjectPathFromUnknown(sourceImageUrl),
          thumbnailUrl: sourceImageUrl,
          thumbnailPath: extractStorageObjectPathFromUnknown(sourceImageUrl),
          placementSource,
        });
      }
      if (candidates.length > 0) return candidates;
      if (!fallbackSourceImageUrl) return [];
      return [
        {
          furnitureId:
            source.type === "my_furniture"
              ? source.furnitureId
              : source.preparedProduct.savedFurnitureId ?? null,
          skuId: source.skuId,
          label: source.preparedProduct.skuId ?? source.skuId,
          sourceImageUrl: fallbackSourceImageUrl,
          sourceImagePath:
            source.sourceImagePathHint ?? extractStorageObjectPathFromUnknown(fallbackSourceImageUrl),
          thumbnailUrl: fallbackSourceImageUrl,
          thumbnailPath:
            source.thumbnailPathHint ?? extractStorageObjectPathFromUnknown(fallbackSourceImageUrl),
          placementSource,
        },
      ];
    },
    []
  );

  const handlePasteToPlaceAutoPlace = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    if (isPasteToPlaceRefreshInteractionLocked || isRefreshingCopiedItemRef.current) {
      pushSnack(
        isAwaitingRefreshCopiedItem
          ? "Press ⌘V to finish refreshing copied item."
          : "Refreshing copied item. Try again in a moment."
      );
      return;
    }
    if (isPasteToPlaceSettling) {
      console.info("[Paste-to-Place][settling] Place blocked because settling", {
        context: "auto_place",
      });
      dismissPasteToPlaceMenu();
      return;
    }
    const menuStateSnapshot = pasteToPlaceMenuState;
    const { xNorm, yNorm } = menuStateSnapshot;
    if (hasPendingPasteToPlaceCommit()) {
      pushSnack("Furniture is still saving. You can place another after this finishes.");
      return;
    }
    if (!scene.baseImageUrl || isBusy || isEditRunning) {
      dismissPasteToPlaceMenu();
      return;
    }

    const operationId =
      resolveAwaitingPasteToPlaceOperationIdForMenuAction() ?? beginPasteToPlacePlacementOperation();
    const pasteToPlaceControl = createPasteToPlaceJobControl(operationId);
    setActivePasteToPlaceJobControl(pasteToPlaceControl);
    const placementSnapshot = createPendingPasteToPlacePlacementSnapshot({
      operationId,
      mode: "auto_place",
      menuStateSnapshot,
      pasteToPlaceControl,
    });
    const progressPreviewUrl = getPasteToPlaceProgressCardPreviewUrlFromSnapshot(placementSnapshot);
    const isOperationStale = (context?: string): boolean => {
      void context;
      if (isPendingPasteToPlaceCommitOperationActive(operationId)) return false;
      return true;
    };

    let settlingRequestId: string | null = null;
    try {
      setPasteToPlaceProgressCardState(menuStateSnapshot);
      setPasteToPlaceProgressCardPreviewUrl(progressPreviewUrl);
      dismissPasteToPlaceMenu({
        clearPreview: false,
        clearClipboardPreview: false,
        preserveAwaitingPasteSession: true,
      });
      if (isOperationStale("auto_place:before_prepare")) return;
      const prepared = await preparePasteToPlaceProductFromMenu({
        xNorm,
        yNorm,
        operationId,
        placementSnapshot,
      });
      if (isOperationStale("auto_place:after_prepare")) return;
      if (prepared.status !== "ready") return;

      const sourceForExecution = prepared.source;
      const modelDecidedFurnitureCandidates =
        buildModelDecidedFurnitureCandidates(sourceForExecution);
      if (modelDecidedFurnitureCandidates.length === 0) {
        pushSnack("Couldn't prepare furniture candidates for model-decided placement.");
        return;
      }

      if (isOperationStale("auto_place:before_scene_rebuild")) return;
      settlingRequestId = beginPasteToPlaceSettlingRequest();
      setPasteToPlaceStatus("placing");
      const abortController = beginPasteToPlaceAbortController();
      await handleDevRebuildActiveVersion({
        placementIntent: "model_decided",
        modelDecidedFurnitureCandidates,
        successMessage: "Vibode decided placement.",
        signal: abortController.signal,
      });
      clearPasteToPlaceAbortController(abortController);
      if (isOperationStale("auto_place:after_scene_rebuild")) return;

      if (!isDevUnlockPasteToPlace) {
        setHasUsedFreePasteToPlace(true);
      }
    } finally {
      clearPasteToPlaceAbortController();
      clearPasteToPlaceSettlingForRequest(settlingRequestId, "auto_place:finally");
      const shouldClearUiForThisOperation = isSamePasteToPlaceJobControl(
        activePasteToPlaceJobControlRef.current,
        pasteToPlaceControl
      );
      if (!isOperationStale("auto_place:finally") || shouldClearUiForThisOperation) {
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreviewForOperation(operationId);
        clearActivePasteToPlaceJobControlIfMatching(pasteToPlaceControl);
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      } else if (pasteToPlaceStatus !== "placing") {
        clearActivePasteToPlaceJobControlIfMatching(pasteToPlaceControl);
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      } else if (isOperationStale("auto_place:finally_stale")) {
        clearPendingPasteToPlacePlacementSnapshot(operationId);
      }
    }
  }, [
    activePasteToPlaceJobControlRef,
    beginPasteToPlacePlacementOperation,
    clearActivePasteToPlaceJobControlIfMatching,
    clearPasteToPlaceProgressPreviewForOperation,
    clearPasteToPlaceSettlingForRequest,
    clearPendingPasteToPlacePlacementSnapshot,
    createPasteToPlaceJobControl,
    createPendingPasteToPlacePlacementSnapshot,
    getPasteToPlaceProgressCardPreviewUrlFromSnapshot,
    dismissPasteToPlaceMenu,
    hasPendingPasteToPlaceCommit,
    isBusy,
    isDevUnlockPasteToPlace,
    isEditRunning,
    isAwaitingRefreshCopiedItem,
    isPendingPasteToPlaceCommitOperationActive,
    isPasteToPlaceRefreshInteractionLocked,
    isPasteToPlaceSettling,
    isSamePasteToPlaceJobControl,
    pasteToPlaceMenuState,
    pasteToPlaceStatus,
    preparePasteToPlaceProductFromMenu,
    pushSnack,
    handleDevRebuildActiveVersion,
    buildModelDecidedFurnitureCandidates,
    scene.baseImageUrl,
    beginPasteToPlaceAbortController,
    beginPasteToPlaceSettlingRequest,
    clearPasteToPlaceAbortController,
    setActivePasteToPlaceJobControl,
    resolveAwaitingPasteToPlaceOperationIdForMenuAction,
  ]);

  useEffect(() => {
    return () => {
      clearPasteToPlaceCancelCooldownTimer();
      isPasteToPlaceCancelCooldownActiveRef.current = false;
      clearStageRunCancelCooldownTimer();
      isStageRunCancelCooldownActiveRef.current = false;
      pasteToPlaceAbortControllerRef.current?.abort();
      pasteToPlaceAbortControllerRef.current = null;
      activePasteToPlaceSettlingRequestIdRef.current = null;
      setIsPasteToPlaceSettling(false);
      setActivePasteToPlaceJobControl(null);
      awaitingPasteToPlaceSessionRef.current = null;
      pasteEventClipboardImagePayloadRef.current = null;
      setAwaitingPasteToPlaceSessionUiState(null);
      stageRunAbortControllerRef.current?.abort();
      stageRunAbortControllerRef.current = null;
      activeStageRunRef.current = null;
      setIsStageRunSettling(false);
      stageRunOperationIdRef.current += 1;
      clearSceneRebuildComposeTimers();
      sceneRebuildAbortControllerRef.current?.abort();
      sceneRebuildAbortControllerRef.current = null;
      sceneRebuildAbortReasonRef.current = null;
      clearPendingPasteToPlaceCommitContext();
    };
  }, [
    clearPendingPasteToPlaceCommitContext,
    clearSceneRebuildComposeTimers,
    clearPasteToPlaceCancelCooldownTimer,
    clearStageRunCancelCooldownTimer,
    setActivePasteToPlaceJobControl,
  ]);

  const warnEdit = (message: string) => {
    setEditWarning(message);
    console.warn(`[edit-run] ${message}`);
    pushSnack(message);
  };

  const closeMyFurniturePicker = useCallback(() => {
    setMyFurnitureOpen(false);
    setMyFurnitureMode(null);
    setMyFurnitureSelectingIds([]);
    setSelectedMyFurnitureItemIds([]);
  }, []);

  const prepareMyFurnitureSourceById = useCallback(
    async (itemId: string): Promise<boolean> => {
      const item = myFurnitureItems.find((candidate) => candidate.id === itemId) ?? null;
      setMyFurnitureSelectingIds([itemId]);
      try {
        const resolved = await resolveMyFurnitureForEdit(itemId);
        if (!resolved) return false;
        const preparedProduct = buildPreparedMyFurnitureProduct(resolved, itemId);
        const fallbackPreviewUrl =
          resolved.eligibleSku.variants.find(
            (variant) => typeof variant?.imageUrl === "string" && variant.imageUrl.trim().length > 0
          )?.imageUrl ?? null;
        const previewUrl = item?.previewImageUrl ?? fallbackPreviewUrl;
        activatePreparedMyFurnitureSource(preparedProduct, { normalizedPreviewUrl: previewUrl });
        return true;
      } catch (err: unknown) {
        pushSnack(getErrorMessage(err) ?? "Failed to resolve saved furniture item.");
        return false;
      } finally {
        setMyFurnitureSelectingIds([]);
      }
    },
    [
      activatePreparedMyFurnitureSource,
      buildPreparedMyFurnitureProduct,
      myFurnitureItems,
      pushSnack,
      resolveMyFurnitureForEdit,
    ]
  );

  const handleSelectMyFurnitureItem = useCallback(
    async (item: MyFurniturePickerItem) => {
      const prepared = await prepareMyFurnitureSourceById(item.id);
      if (!prepared) return;
      closeMyFurniturePicker();
      pushSnack("Saved furniture ready. Click in your room to place it.");
    },
    [closeMyFurniturePicker, prepareMyFurnitureSourceById, pushSnack]
  );

  const handleToggleSelectedMyFurnitureItem = useCallback((itemId: string) => {
    setSelectedMyFurnitureItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  }, []);

  const handleFinishMyFurnitureSelection = useCallback(
    async (selectedIds: string[]) => {
      if (myFurnitureMode !== "add") return;
      if (myFurnitureSelectingIds.length > 0) return;
      const normalizedSelectedIds = Array.from(
        new Set(selectedIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))
      );
      if (normalizedSelectedIds.length === 0) return;

      if (normalizedSelectedIds.length === 1) {
        const prepared = await prepareMyFurnitureSourceById(normalizedSelectedIds[0]);
        if (!prepared) return;
        closeMyFurniturePicker();
        pushSnack("Saved furniture ready. Click in your room to place it.");
        return;
      }

      setMyFurnitureSelectingIds(normalizedSelectedIds);
      try {
        let mergedEligibleSkus: VibodeEligibleSku[] = [];
        const resolvedFurnitureIds: string[] = [];
        for (const furnitureId of normalizedSelectedIds) {
          try {
            const resolved = await resolveMyFurnitureForEdit(furnitureId);
            if (!resolved) continue;
            mergedEligibleSkus = mergeEligibleSkusForSavedFurniture(mergedEligibleSkus, resolved.eligibleSku);
            resolvedFurnitureIds.push(furnitureId);
          } catch (err) {
            console.warn("[editor] failed resolving selected My Furniture item for multi-prepare:", err);
          }
        }

        if (resolvedFurnitureIds.length === 0 || mergedEligibleSkus.length === 0) {
          pushSnack("Selected furniture items are no longer available. Choose different items.");
          return;
        }

        const primaryFurnitureId = resolvedFurnitureIds[0];
        const primarySku = mergedEligibleSkus[0];
        if (!primarySku) {
          pushSnack("Unable to prepare selected furniture items.");
          return;
        }
        const selectedPreviewUrl =
          resolvedFurnitureIds
            .map(
              (furnitureId) =>
                myFurnitureItems.find((candidate) => candidate.id === furnitureId)?.previewImageUrl ?? null
            )
            .find((previewUrl): previewUrl is string => !!previewUrl && previewUrl.trim().length > 0) ??
          primarySku.variants.find(
            (variant) => typeof variant?.imageUrl === "string" && variant.imageUrl.trim().length > 0
          )?.imageUrl ??
          null;
        const selectedPreviewUrls = Array.from(
          new Set(
            resolvedFurnitureIds
              .map(
                (furnitureId) =>
                  myFurnitureItems.find((candidate) => candidate.id === furnitureId)?.previewImageUrl ?? null
              )
              .filter(
                (previewUrl): previewUrl is string =>
                  typeof previewUrl === "string" && previewUrl.trim().length > 0
              )
          )
        );

        const preparedProduct: PasteToPlacePreparedProduct = {
          source: "my_furniture",
          skuId: primarySku.skuId,
          eligibleSkus: mergedEligibleSkus,
          savedFurnitureId: primaryFurnitureId,
        };
        activatePreparedMyFurnitureSource(preparedProduct, {
          normalizedPreviewUrl: selectedPreviewUrl,
          selectedFurnitureIds: resolvedFurnitureIds,
          selectedPreviewUrls,
        });
        closeMyFurniturePicker();
        pushSnack(
          `${resolvedFurnitureIds.length} saved furniture items ready. Use Let Vibode decide placement.`
        );
      } finally {
        setMyFurnitureSelectingIds([]);
      }
    },
    [
      activatePreparedMyFurnitureSource,
      closeMyFurniturePicker,
      myFurnitureItems,
      myFurnitureMode,
      myFurnitureSelectingIds.length,
      prepareMyFurnitureSourceById,
      pushSnack,
      resolveMyFurnitureForEdit,
    ]
  );

  const clearRemoveMarker = useCallback(
    (notify = true) => {
      const hadMarker = Boolean(removeMarkerPosition);
      if (!hadMarker && !isRemoveMarkerTargeting) return;
      setRemoveMarkerPosition(null);
      setIsRemoveMarkerTargeting(false);
      setEditWarning(null);
      if (notify && hadMarker) {
        pushSnack("Remove marker cleared.");
      }
    },
    [isRemoveMarkerTargeting, pushSnack, removeMarkerPosition]
  );

  const handlePlaceRemoveMarker = useCallback((marker: PasteToPlaceClickHint) => {
    setRemoveMarkerPosition({
      xNorm: marker.xNorm,
      yNorm: marker.yNorm,
    });
    setIsRemoveMarkerTargeting(false);
    setEditWarning(null);
  }, []);

  const removeSelectedMarker = async () => {
    if (!removeMarkerPosition) {
      warnEdit("Place a remove marker first.");
      return;
    }
    const label =
      selectedRemoveLabel && selectedRemoveLabel !== REMOVE_LABEL_PLACEHOLDER
        ? selectedRemoveLabel
        : REMOVE_LABEL_FALLBACK;
    const removePrompt = buildRemovePromptForLabel(label);
    console.log("[editor][remove] selected remove label", { label });
    console.log("[editor][remove] final remove prompt", { prompt: removePrompt });
    const { xNorm, yNorm } = removeMarkerPosition;
    const res = await runEdit("remove", {
      target: { xNorm, yNorm },
      params: {
        x: xNorm,
        y: yNorm,
        xNorm,
        yNorm,
        removeLabel: label,
        prompt: removePrompt,
        instruction: removePrompt,
      },
    });
    if (!res) return;
    clearRemoveMarker(false);
    setEditWarning(null);
  };

  const engageRemoveMode = useCallback(async () => {
    if (isRemoveModeReadingObjects) return;
    const roomId = vibodeRoomId?.trim() ?? null;
    const assetId = activeAssetId?.trim() ?? null;
    const imageUrl = workingImageUrl?.trim() ?? null;
    if (!roomId || !assetId || !imageUrl) {
      const message = "Open a room version image before engaging Remove Mode.";
      setRemoveModeError(message);
      pushSnack(message);
      return;
    }
    if (!isRoomReadImageUrlSupported(imageUrl)) {
      const message = "Remove Mode needs a supported room image URL.";
      setRemoveModeError(message);
      pushSnack(message);
      return;
    }

    setIsRemoveModeEnabled(true);
    setRemoveMarkerPosition(null);
    setIsRemoveMarkerTargeting(false);
    setRemoveModeError(null);
    setSelectedRemoveObjectKeys([]);
    setRemoveModeObjects([]);
    setRemoveModeManualMarkers([]);
    setRemoveModeObjectTargetOverrides({});
    setRemoveModeGuidanceImageDataUrl(null);
    setRemoveModeGuidanceManifest(null);
    setRemoveModeGuidancePromptText("");
    setRemoveModeGuidancePreparedSignature("");
    setRemoveModeGuidanceError(null);
    setRemoveModeGuidanceTargetCount(0);
    try {
      const persistedObjects = await hydrateRoomImageObjects({
        trigger: "remove-mode",
        imageUrl,
        roomId,
        assetId,
        versionId: assetId,
        purpose: "remove-mode",
        mode: "geometry",
        allowRoomReadOnMiss: false,
        suppressErrors: false,
      });
      if (persistedObjects.length > 0 && hasSufficientGeometryRoomObjects(persistedObjects)) {
        setRemoveModeObjects(persistedObjects);
        return;
      }

      setIsRemoveModeReadingObjects(true);
      const objects = await hydrateRoomImageObjects({
        trigger: "remove-mode",
        imageUrl,
        roomId,
        assetId,
        versionId: assetId,
        purpose: "remove-mode",
        mode: "geometry",
        allowRoomReadOnMiss: true,
        suppressErrors: false,
      });
      setRemoveModeObjects(objects);
    } catch (err: unknown) {
      const message = getErrorMessage(err) ?? "Unable to read room objects for Remove Mode.";
      setRemoveModeError(message);
      setRemoveModeObjects([]);
      pushSnack(message);
    } finally {
      setIsRemoveModeReadingObjects(false);
    }
  }, [
    activeAssetId,
    hydrateRoomImageObjects,
    isRemoveModeReadingObjects,
    pushSnack,
    vibodeRoomId,
    workingImageUrl,
  ]);

  const exitRemoveMode = useCallback(() => {
    setIsRemoveModeEnabled(false);
    setIsRemoveModeReadingObjects(false);
    setRemoveModeError(null);
    setRemoveModeObjects([]);
    setSelectedRemoveObjectKeys([]);
    setRemoveModeManualMarkers([]);
    setRemoveModeObjectTargetOverrides({});
    setRemoveModeGuidanceImageDataUrl(null);
    setRemoveModeGuidanceManifest(null);
    setRemoveModeGuidancePromptText("");
    setRemoveModeGuidancePreparedSignature("");
    setRemoveModeGuidanceError(null);
    setRemoveModeGuidanceTargetCount(0);
  }, []);

  const toggleRemoveModeObjectSelection = useCallback((key: string) => {
    setSelectedRemoveObjectKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((existing) => existing !== key);
      }
      return [...prev, key];
    });
  }, []);

  const handlePlaceRemoveModeManualMarker = useCallback((marker: PasteToPlaceClickHint) => {
    if (!isRemoveModeEnabled) return;
    setRemoveModeManualMarkers((prev) => [
      ...prev,
      {
        id: safeId("remove_mode_manual"),
        xNorm: marker.xNorm,
        yNorm: marker.yNorm,
        createdAt: Date.now(),
      },
    ]);
  }, [isRemoveModeEnabled]);

  const removeRemoveModeManualMarker = useCallback((id: string) => {
    setRemoveModeManualMarkers((prev) => prev.filter((marker) => marker.id !== id));
  }, []);

  const moveRemoveModeManualMarker = useCallback((id: string, xNorm: number, yNorm: number) => {
    const x = clampUnit(xNorm);
    const y = clampUnit(yNorm);
    setRemoveModeManualMarkers((prev) =>
      prev.map((marker) => (marker.id === id ? { ...marker, xNorm: x, yNorm: y } : marker))
    );
  }, []);

  const updateRemoveModeObjectTargetOverride = useCallback((key: string, xNorm: number, yNorm: number) => {
    if (!key.trim()) return;
    const x = clampUnit(xNorm);
    const y = clampUnit(yNorm);
    setRemoveModeObjectTargetOverrides((prev) => ({
      ...prev,
      [key]: { xNorm: x, yNorm: y },
    }));
  }, []);

  const saveRemoveGuidanceDebugImages = useCallback(
    async (args: {
      image1Url: string;
      image2DataUrl: string;
      manifest: RemoveModeGuidanceManifest;
      promptText: string;
    }) => {
      if (process.env.NODE_ENV === "production") return;
      try {
        const res = await fetch("/api/vibode/debug-save-remove-guidance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image1Url: args.image1Url,
            image2DataUrl: args.image2DataUrl,
            roomId: vibodeRoomId ?? null,
            versionId: activeAssetId ?? null,
            targetCount: args.manifest.targetCount,
            manifest: args.manifest,
            promptText: args.promptText,
          }),
        });
        if (res.status === 403 || res.status === 404) {
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        const payload = (await res.json().catch(() => ({}))) as {
          savedFiles?: string[];
        };
        console.log("[remove-mode] debug images saved", {
          fileCount: Array.isArray(payload.savedFiles) ? payload.savedFiles.length : 0,
        });
      } catch (debugSaveErr: unknown) {
        console.warn("[remove-mode] debug save failed", {
          error: debugSaveErr instanceof Error ? debugSaveErr.message : String(debugSaveErr),
        });
      }
    },
    [activeAssetId, vibodeRoomId]
  );

  const removeSelectedWithGuidedRemoveMode = useCallback(async () => {
    if (isEditRunning || isOutOfTokens) return;
    if (!isRemoveModeEnabled) {
      await removeSelectedMarker();
      return;
    }
    if (removeModeGuidanceManifestDraft.targetCount === 0) {
      const message = "Mark at least one object or manual remove point first.";
      setRemoveModeGuidanceError(message);
      setRemoveModeError(message);
      pushSnack(message);
      return;
    }

    const sourceImageUrl = workingImageUrl?.trim() || scene.baseImageUrl?.trim() || null;
    if (!isServerFetchableImageUrl(sourceImageUrl)) {
      const message = "Open a valid room image before removing selected items.";
      setRemoveModeError(message);
      pushSnack(message);
      return;
    }
    const safeSourceImageUrl = sourceImageUrl as string;

    let guidanceImageDataUrl = removeModeGuidanceImageDataUrl;
    let guidanceManifestForRequest = removeModeGuidanceManifest;
    let guidancePromptText = removeModeGuidancePromptText;

    if (!isRemoveModeGuidanceFresh) {
      setIsPreparingRemoveGuidanceImage(true);
      setRemoveModeGuidanceError(null);
      try {
        guidanceManifestForRequest = removeModeGuidanceManifestDraft;
        guidancePromptText = buildRemoveModeGuidancePromptText(removeModeGuidanceManifestDraft);
        guidanceImageDataUrl = await prepareRemoveGuidanceImageDataUrl({
          imageUrl: safeSourceImageUrl,
          manifest: removeModeGuidanceManifestDraft,
        });
        setRemoveModeGuidanceImageDataUrl(guidanceImageDataUrl);
        setRemoveModeGuidanceManifest(removeModeGuidanceManifestDraft);
        setRemoveModeGuidancePromptText(guidancePromptText);
        setRemoveModeGuidancePreparedSignature(removeModeGuidanceDraftSignature);
        setRemoveModeGuidanceTargetCount(removeModeGuidanceManifestDraft.targetCount);
        void saveRemoveGuidanceDebugImages({
          image1Url: safeSourceImageUrl,
          image2DataUrl: guidanceImageDataUrl,
          manifest: removeModeGuidanceManifestDraft,
          promptText: guidancePromptText,
        });
      } catch (err: unknown) {
        const message = getErrorMessage(err) ?? "Unable to prepare removal guidance image.";
        setRemoveModeGuidanceError(message);
        setRemoveModeError(message);
        pushSnack(message);
        return;
      } finally {
        setIsPreparingRemoveGuidanceImage(false);
      }
    }

    if (!guidanceImageDataUrl || !guidanceManifestForRequest || !guidancePromptText) {
      const message = "Unable to prepare removal guidance image.";
      setRemoveModeGuidanceError(message);
      setRemoveModeError(message);
      pushSnack(message);
      return;
    }

    const fallbackTarget =
      guidanceManifestForRequest.detectedTargets[0] ?? guidanceManifestForRequest.manualTargets[0] ?? null;

    setRemoveModeError(null);
    setEditWarning(null);
    pushSnack("Removing selected items…");
    const res = await runEdit(
      "remove",
      {
        mode: "guidance-image",
        ...(fallbackTarget
          ? {
              target: {
                xNorm: fallbackTarget.xNorm,
                yNorm: fallbackTarget.yNorm,
                x: fallbackTarget.xNorm,
                y: fallbackTarget.yNorm,
              },
            }
          : {}),
        params: {
          mode: "guidance-image",
          sourceImageUrl: safeSourceImageUrl,
          sourceVersionId: activeAssetId ?? undefined,
          guidanceImageDataUrl,
          guidancePromptText,
          guidanceManifest: guidanceManifestForRequest,
          targetCount: guidanceManifestForRequest.targetCount,
        },
      },
      {
        onImageCommitted: () => {
          exitRemoveMode();
        },
      },
      {
        onPostDurableCommit: (args) => {
          // Intentional SET-canonical geometry prewarm for Remove Selected SET results.
          setIsSetGeometryPrewarming(true);
          void (async () => {
            try {
              await hydrateRoomImageObjects({
                trigger: "set-remove-result",
                imageUrl: args.imageUrl,
                roomId: args.roomId,
                assetId: args.assetId,
                versionId: args.assetId,
                mode: "geometry",
                allowRoomReadOnMiss: true,
              });
            } catch (err) {
              console.warn("[room-image-objects] SET geometry prewarm failed", err);
            } finally {
              setIsSetGeometryPrewarming(false);
            }
          })();
        },
      }
    );
    if (!res) {
      const message = "Vibode couldn't remove those items. Please adjust the markers and try again.";
      setRemoveModeError(message);
      setEditWarning("Remove failed");
      pushSnack(message);
      return;
    }
    pushSnack("Items removed. Your cleaned room was saved as a SET version.");
  }, [
    activeAssetId,
    exitRemoveMode,
    isEditRunning,
    isOutOfTokens,
    isRemoveModeEnabled,
    isRemoveModeGuidanceFresh,
    hydrateRoomImageObjects,
    pushSnack,
    removeModeGuidanceDraftSignature,
    removeModeGuidanceImageDataUrl,
    removeModeGuidanceManifest,
    removeModeGuidanceManifestDraft,
    removeModeGuidancePromptText,
    removeSelectedMarker,
    runEdit,
    saveRemoveGuidanceDebugImages,
    scene.baseImageUrl,
    workingImageUrl,
  ]);

  const clearRotateMarker = useCallback(
    (notify = true) => {
      const hadMarker = Boolean(rotateToolState.marker);
      if (!hadMarker && !isRotateMarkerTargeting) return;
      setRotateToolState((prev) => ({ ...prev, marker: null }));
      setIsRotateMarkerTargeting(false);
      setEditWarning(null);
      if (notify && hadMarker) {
        pushSnack("Rotate marker cleared.");
      }
    },
    [isRotateMarkerTargeting, pushSnack, rotateToolState.marker]
  );

  const handlePlaceRotateMarker = useCallback((marker: RotateMarker) => {
    setRotateToolState((prev) => ({
      ...prev,
      marker: {
        xNorm: marker.xNorm,
        yNorm: marker.yNorm,
      },
    }));
    setIsRotateMarkerTargeting(false);
    setEditWarning(null);
  }, []);

  const onGenerate = async () => {
    const localGenId = safeId("gen");

    if (!didLogFirstGenerateAttemptRef.current) {
      didLogFirstGenerateAttemptRef.current = true;

      const firstEligibleNode = nodes.find((n) => n.status !== "markedForDelete") ?? null;
      let markerPreview:
        | {
            nodeId: string;
            xPx: number;
            yPx: number;
            imageSpace: string;
          }
        | null = null;

      if (viewport && firstEligibleNode) {
        const imageSpaceTransform = toImageSpaceTransform(firstEligibleNode.transform, viewport);
        const xPx = imageSpaceTransform.x + imageSpaceTransform.width / 2;
        const yPx = imageSpaceTransform.y + imageSpaceTransform.height / 2;
        if (Number.isFinite(xPx) && Number.isFinite(yPx)) {
          markerPreview = {
            nodeId: firstEligibleNode.id,
            xPx,
            yPx,
            imageSpace: "base image pixel space (top-left origin)",
          };
        }
      }

      const logPayload = {
        ready: isImageSpaceReady,
        reason: imageSpaceReadinessReasons.length
          ? imageSpaceReadinessReasons.join(", ")
          : "all required image-space inputs ready",
        naturalDims: {
          widthPx: baseImageNaturalWidth ?? null,
          heightPx: baseImageNaturalHeight ?? null,
        },
        stageDisplay: viewport
          ? {
              imageStageX: viewport.imageStageX,
              imageStageY: viewport.imageStageY,
              imageStageW: viewport.imageStageW,
              imageStageH: viewport.imageStageH,
              scaleStagePerImagePx: viewport.scale,
            }
          : null,
        markerPreview:
          markerPreview ??
          (nodes.length === 0
            ? { reason: "no nodes in sceneSnapshotImageSpace" }
            : { reason: "missing mapping or invalid marker inputs" }),
      };

      if (isImageSpaceReady) {
        console.log("[generate][first-attempt-diagnostics]", logPayload);
      } else {
        console.warn("[generate][first-attempt-diagnostics]", logPayload);
      }
    }

    if (isBusy) return;

    if (!isImageSpaceReady) {
      console.warn("[generate] blocked: image-space transform not ready", {
        reasons: imageSpaceReadinessReasons,
        naturalWidth: baseImageNaturalWidth ?? null,
        naturalHeight: baseImageNaturalHeight ?? null,
        hasImageMapping,
      });
      return;
    }
  
    // ─────────────────────────────────────────────
    // 0) Preconditions
    // ─────────────────────────────────────────────
    const collectionId = scene.collection?.collectionId;
  
    if (!scene.baseImageUrl) {
      pushSnack("Upload a room photo first.");
      return;
    }
    const removeMarks = scene.removeMarks ?? [];
    const hasAnyActiveNodes = nodes.some((n) => n.status !== "markedForDelete");
    const hasToolMarks =
      removeMarks.length > 0 ||
      queuedSwaps > 0 ||
      rotateMarks.length > 0;
    const isVibeStage =
      (scene.vibeMode ?? "off") === "on" &&
      !hasAnyActiveNodes &&
      Boolean(collectionId) &&
      !hasToolMarks;
    const isRemoveMode = removeMarks.length > 0;
    const isRotateMode = hasRotateMarks;
    if (!collectionId && !isRemoveMode && !isRotateMode) {
      pushSnack(
        "Select a Furniture Collection first, or use Remove/Rotate tools to place marker(s)."
      );
      return;
    }
    if (!viewport) {
      pushSnack("Viewport not ready yet (image still loading). Try again in a moment.");
      return;
    }
    if (!useFreezeV2 && typeof freezeNowV1 !== "function") {
      pushSnack("Freeze writer not found (freezeNowV1). Check editorStore export.");
      return;
    }
    if (useFreezeV2 && typeof freezeNowV2 !== "function") {
      pushSnack("Freeze writer not found (freezeNowV2). Check editorStore export.");
      return;
    }
  
    const { sceneSnapshotForRecovery, markupToPersist } = useEditorStore
      .getState()
      .beginGenerate();
    savePendingLocal({
      ...sceneSnapshotForRecovery,
      stage3: buildPendingStage3Payload(stage3SkuItems, stage3ShowCatalog),
    });

    const slowTimer = setTimeout(() => useEditorStore.getState().markGeneratingSlow(), 30_000);
    const stallTimer = setTimeout(() => useEditorStore.getState().markGeneratingStall(), 60_000);

    let generationId: string | null = null;

    try {
      // ─────────────────────────────────────────────
      // 1) Calibration scaffold: compute assumption only if manual dims exist
      // ─────────────────────────────────────────────
      const calNow = useEditorStore.getState().scene.calibration;
      if (hasManualDims && (!calNow?.ppf || calNow.method === "assumed-fit-width")) {
        ensurePpfFromAssumption();
      }

      const afterCal = useEditorStore.getState().scene.calibration;
      const ppf = afterCal?.ppf;

      // ─────────────────────────────────────────────
      // 2) Choose bundle + build eligible SKUs (still mock)
      // ─────────────────────────────────────────────
      const bundleId: RoomSizeBundleId = hasManualDims ? pickBundleIdFromSqft(sqft!) : "medium";

      const col = collectionId
        ? MOCK_COLLECTIONS.find((c) => c.collectionId === collectionId)
        : null;
      if (!col && !isRemoveMode) {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { message: "Collection not found (mock data)." },
        });
        return;
      }

      const skuIds = col?.bundles[bundleId]?.skuIds ?? [];

      const eligible = skuIds
        .map((id) => (col?.catalog as Record<string, unknown>)?.[id])
        .filter(Boolean)
        .map((sku) => {
          if (!isRecord(sku)) return null;

          const skuId = safeStr(sku.skuId);
          if (!skuId) return null;
          const label = safeStr(sku.label) ?? skuId;

          const realW = typeof sku.realWidthFt === "number" ? sku.realWidthFt : undefined;
          const realD = typeof sku.realDepthFt === "number" ? sku.realDepthFt : undefined;
          const defaultPxWidth = typeof sku.defaultPxWidth === "number" ? sku.defaultPxWidth : 1;
          const defaultPxHeight = typeof sku.defaultPxHeight === "number" ? sku.defaultPxHeight : 1;

          const pxW = ppf && realW ? Math.max(1, Math.round(realW * ppf)) : defaultPxWidth;
          const pxH = ppf && realD ? Math.max(1, Math.round(realD * ppf)) : defaultPxHeight;

          const fallbackImage =
            safeStr(sku.imageUrl) ?? safeStr(sku.pngUrl) ?? safeStr(sku.url) ?? safeStr(sku.src) ?? "";
          const variantsRaw = Array.isArray(sku.variants) ? sku.variants : [];
          const variants =
            variantsRaw.length > 0
              ? variantsRaw
                  .map((variant) => {
                    if (!isRecord(variant)) return null;
                    const variantId = safeStr(variant.variantId) ?? skuId;
                    const variantLabel = safeStr(variant.label) ?? label;
                    const imageUrl =
                      safeStr(variant.imageUrl) ??
                      safeStr(variant.pngUrl) ??
                      safeStr(variant.url) ??
                      safeStr(variant.src) ??
                      fallbackImage;
                    return { variantId, label: variantLabel, imageUrl };
                  })
                  .filter((variant): variant is { variantId: string; label: string; imageUrl: string } =>
                    Boolean(variant)
                  )
              : [{ variantId: skuId, label, imageUrl: fallbackImage }];

          return {
            skuId,
            label,
            defaultPxWidth: pxW,
            defaultPxHeight: pxH,
            realWidthFt: realW,
            realDepthFt: realD,
            variants,
          };
        })
        .filter((sku): sku is NonNullable<typeof sku> => sku !== null);

      setWorkingSet({ collectionId: collectionId ?? undefined, bundleId, eligibleSkus: eligible });

      // ─────────────────────────────────────────────
      // 3) Freeze first (captures intent). BUT do NOT "commitGenerateMock" until model succeeds.
      //    This prevents UI state from lying when API/model fails.
      // ─────────────────────────────────────────────
      let payload: unknown = null;
      let record: ReturnType<typeof freezeNowV1> | null = null;

      if (useFreezeV2) {
        payload = await freezeNowV2();
        console.log("[FREEZE v2]", payload);
      } else {
        record = freezeNowV1();
        payload = record?.freeze ?? null;
        console.log("[FREEZE v1]", payload);
      }

      if (!payload) {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { message: "Freeze failed (no payload)." },
        });
        return;
      }

      const payloadAccess = getFreezePayloadAccess(payload);
      generationId = record?.generationId ?? (payloadAccess.generationId as string | null) ?? null;
      const isSwapMode = hasSwapMarksWithReplacement(payloadAccess.vibodeIntent);
      const pendingVibeMode =
        sceneSnapshotForRecovery.vibeMode === "on" || sceneSnapshotForRecovery.vibeMode === "off"
          ? sceneSnapshotForRecovery.vibeMode
          : undefined;
      if (generationId) {
        useEditorStore.setState((s) => {
          const idx = s.history.findIndex((h) => h.generationId === generationId);
          if (idx === -1) return s;
          const nextHistory = s.history.slice();
          nextHistory[idx] = {
            ...nextHistory[idx],
            pendingMarkup: markupToPersist,
            pendingVibeMode,
            pendingStatus: "pending",
          };
          return { ...s, history: nextHistory };
        });
      }

      if (!useFreezeV2) {
        // Optional: Validate (client-side) so we fail fast before network call.
        const valid = validateFreezePayloadV1(payload);
        if (!valid.ok) {
          useEditorStore.getState().endGenerateError({
            userMessage: "Something didn’t work that time. Please try generating again.",
            debug: { message: valid.reason },
          });
          return;
        }
      }

      // Helpful toast (keeps your dopamine, but no state mutation yet)
      const stageTargetLabel = col?.bundles[bundleId]?.label ?? col?.label ?? "selected collection";
      pushSnack(
        isRemoveMode
          ? `Removing objects at ${removeMarks.length} marker(s)…`
          : isRotateMode
            ? `Applying rotate at ${rotateMarks.length} marker(s)…`
            : isVibeStage
              ? `Staging room with ${stageTargetLabel}...`
          : hasManualDims
            ? `Generating: ${col?.bundles[bundleId]?.label ?? "bundle"} (${skuIds.length} items)…`
            : `Generating: ${col?.bundles[bundleId]?.label ?? "bundle"} (${skuIds.length} items) • Dimensions auto…`
      );

      // ─────────────────────────────────────────────
      // 4) Determine echo vs model mode
      //    Echo is ONLY for blob/data/file/local base urls.
      // ─────────────────────────────────────────────
      const baseImage = payloadAccess.baseImage;
      let baseKind = baseImage?.kind as string | undefined;
      let baseUrl = (baseImage?.url ?? "").toString();

      if (useFreezeV2 && baseImage && typeof baseImage === "object") {
        const storageKey = typeof baseImage.storageKey === "string" ? baseImage.storageKey : "";
        const signedUrl = typeof baseImage.signedUrl === "string" ? baseImage.signedUrl : "";
        const imageBase64 = typeof baseImage.imageBase64 === "string" ? baseImage.imageBase64 : "";

        if (storageKey) {
          baseKind = "storageKey";
          baseUrl = "";
        } else if (signedUrl) {
          baseKind = "signedUrl";
          baseUrl = signedUrl;
        } else if (imageBase64) {
          baseKind = "imageBase64";
          baseUrl = imageBase64.startsWith("data:")
            ? imageBase64
            : `data:image/jpeg;base64,${imageBase64}`;
        }
      }

      const isBlobOrLocal =
        baseKind !== "storageKey" &&
        /^(blob:|data:|file:|https?:\/\/localhost|https?:\/\/127\.0\.0\.1|https?:\/\/0\.0\.0\.0)/i.test(
          baseUrl
        );

      const forceEcho = isBlobOrLocal;

      const accessToken = await tryGetSupabaseAccessToken();
  
      // Real model calls require auth. (Echo does not.)
      if (!forceEcho && !accessToken) {
        pushSnack("No Supabase session — redirecting to login…");
        router.push(`/login?next=${encodeURIComponent("/editor")}`);
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { code: "AUTH_MISSING", message: "No Supabase session" },
        });
        return;
      }

      if (useFreezeV2) {
        const payloadRecord = payload as Record<string, unknown>;
        const payloadNodes = Array.isArray(payloadRecord.nodes) ? payloadRecord.nodes : [];
        const firstPayloadNode = payloadNodes[0];
        console.log("[V2 DEBUG before fetch]", {
          payloadVersion: payloadRecord.payloadVersion,
          sceneHash: payloadRecord.sceneHash,
          nodesLength: payloadNodes.length,
          firstNodeId: isRecord(firstPayloadNode) ? firstPayloadNode.nodeId : undefined,
        });
      }
      
      const vibodeRoute = isRemoveMode
        ? "/api/vibode/remove"
        : isSwapMode
          ? "/api/vibode/swap"
          : isRotateMode
            ? "/api/vibode/generate"
            : isVibeStage
              ? "/api/vibode/full-vibe"
            : "/api/vibode/compose";
      const res = await fetch(vibodeRoute, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          freeze: payload,
          modelVersion: selectedModel,
          vibodeRoomId: vibodeRoomId ?? undefined,
          stageNumber: activeStage,
          vibeMode: scene.vibeMode,
          markup: markupToPersist,
          vibe: isVibeStage
            ? {
                collectionId: collectionId ?? undefined,
                bundleId,
                eligibleSkus: eligible,
                targetCount: undefined,
                enhancePhoto: true,
              }
            : undefined,
        }),
      });
  
      // Always parse safely
      const j: unknown = await res
        .json()
        .catch(async () => ({ error: await res.text().catch(() => "Bad JSON response") }));
      const jRecord = isRecord(j) ? j : null;
      const outputRecord = jRecord && isRecord(jRecord.output) ? jRecord.output : null;

      // TEMP DEBUG (remove after capturing full-vibe runtime evidence)
      console.log("[VIBODE DEBUG RAW]", {
        vibodeRoute,
        status: res.status,
        keys: jRecord ? Object.keys(jRecord) : null,
        imageUrl: jRecord?.imageUrl,
        stagedImageUrl: jRecord?.stagedImageUrl,
        outputImageUrl: outputRecord?.imageUrl,
        widthPx: jRecord?.widthPx,
        heightPx: jRecord?.heightPx,
        outputWidthPx: outputRecord?.widthPx,
        outputHeightPx: outputRecord?.heightPx,
        generationIdFromResponse: jRecord?.generationId,
        generationIdLocalBeforeAdopt: generationId,
        isVibeStage,
        isRemoveMode,
        isSwapMode,
        isRotateMode,
        forceEcho,
      });
  
      console.log("[VIBODE GENERATE RESPONSE]", res.status, j);

      const jOk = jRecord?.ok;
      const jMode = jRecord?.mode;
      const jCode = safeStr(jRecord?.code) ?? undefined;
      const jMessage = safeStr(jRecord?.message) ?? safeStr(jRecord?.error) ?? undefined;
      const jGenerationId = safeStr(jRecord?.generationId);

      if (!res.ok || jOk === false) {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { code: jCode, message: jMessage, raw: j },
        });
        return;
      }
  
      if (jMode === "echo") {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { code: "ECHO_ONLY", message: "Echo mode returned no image", raw: j },
        });
        return;
      }
      
      const toFinitePosNum = (v: unknown) => {
        const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      
      // ─────────────────────────────────────────────
      // Resolve generated image URL.
      // Canonical source: j.output.imageUrl
      // Fallbacks are kept for legacy / transitional API responses.
      // ─────────────────────────────────────────────
      const imageUrl: string | null =
        safeStr(outputRecord?.imageUrl) ??
        safeStr(jRecord?.imageUrl) ??
        safeStr(jRecord?.stagedImageUrl) ??
        null;
      const outW = toFinitePosNum(outputRecord?.widthPx ?? jRecord?.widthPx);
      const outH = toFinitePosNum(outputRecord?.heightPx ?? jRecord?.heightPx);
      
      const genId = jGenerationId ?? (isVibeStage ? localGenId : null);

      // TEMP DEBUG (remove after capturing full-vibe runtime evidence)
      console.log("[VIBODE DEBUG COMPUTED]", {
        outUrl: imageUrl,
        outW,
        outH,
        generationIdFromResponse: jGenerationId,
        generationIdLocalBeforeAdopt: generationId,
        genId,
        gateWillFail: {
          missingGenId: !genId,
          missingOutUrl: !imageUrl,
        },
      });
      
      if (!genId) {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { message: "Missing generationId in response", raw: j },
        });
        return;
      }

      generationId = genId;
      
      if (!imageUrl) {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { message: "Missing imageUrl in response", raw: j },
        });
        return;
      }
      const outputStorage = outputRecord && isRecord(outputRecord.storage)
        ? outputRecord.storage
        : null;
      
      useEditorStore.getState().attachOutputAndSwapBase({
        generationId: genId,
        outputImageUrl: imageUrl,
        outputBucket: safeStr(outputRecord?.bucket) ?? safeStr(outputStorage?.bucket) ?? undefined,
        outputStorageKey: safeStr(outputRecord?.storageKey) ?? safeStr(outputStorage?.key) ?? undefined,
        outputWidthPx: outW,
        outputHeightPx: outH,
      });

      if (isRemoveMode) {
        useEditorStore.getState().clearRemoveMarks();
      }

      useEditorStore.getState().endGenerateSuccess({
        imageUrl,
        widthPx: outW,
        heightPx: outH,
      });
      setWorkingImageUrl(imageUrl);
      setIsWorkingImageGenerated(true);
      clearTransientInteractionOverlaysAfterImageCommit();
      const responseImageUrl = imageUrl.trim();
      let resolvedAssetId: string | null = null;
      let resolvedImageUrl: string | null = responseImageUrl;
      if (vibodeRoomId) {
        const latestVersions = await refreshRoomVersions(vibodeRoomId);
        const baseAsset = latestVersions?.find((asset) => asset.asset_type === "base") ?? null;
        const activeAsset = latestVersions?.find((asset) => asset.is_active) ?? null;
        const matchingVersion =
          latestVersions?.find((asset) => asset.image_url === responseImageUrl) ??
          latestVersions?.find((asset) => asset.preview_url === responseImageUrl) ??
          null;
        if (baseAsset) {
          setRoomBaseAssetId(baseAsset.id);
        }
        const resolvedVersion = matchingVersion ?? activeAsset ?? latestVersions?.[0] ?? null;
        if (resolvedVersion) {
          resolvedAssetId = resolvedVersion.id;
          resolvedImageUrl =
            resolvedVersion.image_url?.trim() ||
            resolvedVersion.preview_url?.trim() ||
            responseImageUrl;
          setActiveAssetId(resolvedVersion.id);
        }
      }
      if (!resolvedAssetId) {
        console.warn("[room-image-objects] skipped", {
          trigger: "paste-to-place",
          reason: "unable to resolve durable asset/version identity",
          roomId: vibodeRoomId,
          responseImageUrl,
        });
      } else if (!resolvedImageUrl) {
        console.warn("[room-image-objects] skipped", {
          trigger: "paste-to-place",
          reason: "missing final committed durable image URL",
          roomId: vibodeRoomId,
          assetId: resolvedAssetId,
        });
      } else {
        await hydrateRoomImageObjects({
          trigger: "paste-to-place",
          imageUrl: resolvedImageUrl,
          roomId: vibodeRoomId,
          assetId: resolvedAssetId,
          versionId: resolvedAssetId,
          allowRoomReadOnMiss: true,
        });
      }

      clearPendingLocal();

      if (generationId) {
        useEditorStore.setState((s) => {
          const idx = s.history.findIndex((h) => h.generationId === generationId);
          if (idx === -1) return s;
          const nextHistory = s.history.slice();
          nextHistory[idx] = {
            ...nextHistory[idx],
            pendingStatus: "success",
          };
          return { ...s, history: nextHistory };
        });
      }
      
      console.log("[editor][base-swap]", {
        generationId: genId,
        baseImageUrl: useEditorStore.getState().scene.baseImageUrl,
        baseImageWidthPx: useEditorStore.getState().scene.baseImageWidthPx,
        baseImageHeightPx: useEditorStore.getState().scene.baseImageHeightPx,
      });
      
      // Optional token info (nice UX)
      const tokenCost = typeof jRecord?.tokenCost === "number" ? jRecord.tokenCost : null;
      const tokenBalance = typeof jRecord?.tokenBalance === "number" ? jRecord.tokenBalance : null;
        
      pushSnack(
        `Nano Banana OK ✅ image returned${tokenCost != null ? ` • cost=${tokenCost}` : ""}${
          tokenBalance != null ? ` • balance=${tokenBalance}` : ""
        }`
      );
      notifyTokenBalanceChanged();
  
      // ─────────────────────────────────────────────
      // 6) ✅ NOW we are allowed to mutate local UI state.
      //    If you still want to keep the V0 behavior, commit AFTER success.
      // ─────────────────────────────────────────────
      if (jMode !== "nanobanana") {
        commitGenerateMock();
      }
  
      // 🚀 Plumbing (next step): append to history + swap base image:
      // - add a history tile with imageUrl (prefer storage/signed if returned)
      // - set base image to returned imageUrl (or storageKey bucket)
      //
      // Example placeholder calls (wire to your store actions):
      // useEditorStore.getState().appendHistoryFromGeneration?.({ generationId: j.generationId, imageUrl });
      // useEditorStore.getState().setBaseImageFromGeneration?.({ imageUrl, generationId: j.generationId });
  
    } catch (e: unknown) {
      console.error(e);
      useEditorStore.getState().endGenerateError({
        userMessage: "Something didn’t work that time. Please try generating again.",
        debug: { message: getErrorMessage(e) ?? "API network error", raw: e },
      });
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(stallTimer);
      if (generationId) {
        useEditorStore.setState((s) => {
          const idx = s.history.findIndex((h) => h.generationId === generationId);
          if (idx === -1) return s;
          const nextHistory = s.history.slice();
          if (nextHistory[idx].pendingStatus === "pending") {
            nextHistory[idx] = { ...nextHistory[idx], pendingStatus: "error" };
          }
          return { ...s, history: nextHistory };
        });
      }
    }
  };
  void onGenerate;

  const devSceneRebuildMissingReason = !vibodeRoomId
    ? "Room id missing."
    : !selectedVersionId
      ? "Version id missing."
      : null;
  const isDevSceneRebuildButtonDisabled =
    isDevSceneRebuildRunning || Boolean(devSceneRebuildMissingReason);
  const canCancelDevSceneRebuild =
    isDevSceneRebuildRunning && devSceneRebuildStage === "compose";
  const devSceneRebuildProgressCopy = (() => {
    if (!isDevSceneRebuildRunning || !devSceneRebuildStage) return null;
    if (devSceneRebuildStage === "compose") {
      if (isDevSceneRebuildComposeWarningVisible) {
        return {
          title: "Still updating your room...",
          helper: "This is taking longer than usual, but Vibode is still updating your room.",
        };
      }
      if (isDevSceneRebuildRenderingMessageVisible) {
        return {
          title: "Rendering your updated room...",
          helper: "Vibode is generating a new version with your latest furniture layout.",
        };
      }
      return {
        title: "Updating your room...",
        helper: "Preparing your furniture layout and rendering your updated room.",
      };
    }
    if (devSceneRebuildStage === "persist") {
      return {
        title: "Saving your room version...",
        helper: "Almost done.",
      };
    }
    return null;
  })();
  // TODO(vibode-scene-rebuild): add explicit server/compositor stage events to support true compose/generate transitions.
  const canShowRevertPlacementChangesButton =
    showDevSceneRebuildButton &&
    sceneNeedsUpdate &&
    selectedVersionRenderedPlacementSnapshot !== null;
  const isRevertPlacementChangesButtonDisabled =
    isRevertingPlacementChanges ||
    isDevSceneRebuildRunning ||
    Boolean(devSceneRebuildMissingReason);
  const canShowRestoreOriginalPlacementPositionsAction =
    !sceneNeedsUpdate && canRestoreOriginalPlacementPositions;
  const shouldSuppressSceneNeedsUpdateOverlay = Boolean(placementLayerDragState?.startedAsSuggested);
  const shouldShowSceneNeedsUpdateOverlay =
    isSceneRebuildOverlayEnabled && sceneNeedsUpdate && !shouldSuppressSceneNeedsUpdateOverlay;
  const isRestoreOriginalPlacementPositionsButtonDisabled =
    isRestoringOriginalPlacementPositions ||
    isRevertingPlacementChanges ||
    isDevSceneRebuildRunning ||
    Boolean(devSceneRebuildMissingReason);
  const activeStageTokenCost = STAGE_TOKEN_COST[activeStage] ?? DEFAULT_ACTION_TOKEN_COST;
  const activeStageTokenCostLabel = formatTokenCostLabel(activeStageTokenCost);
  const getVersionPreviewUrl = useCallback((asset: EditorVersionWithKind | null): string | null => {
    if (!asset) return null;
    if (typeof asset.preview_url === "string" && asset.preview_url.trim().length > 0) {
      return asset.preview_url;
    }
    if (typeof asset.image_url === "string" && asset.image_url.trim().length > 0) {
      return asset.image_url;
    }
    return null;
  }, []);
  const resolveShelfForVersion = useCallback((asset: EditorVersionWithKind): "style" | "stage" | "set" | "unknown" => {
    if (asset.versionKind === "style") return "style";
    if (asset.versionKind === "stage") return "stage";
    if (asset.versionKind === "set" || asset.asset_type === "base") return "set";
    return "unknown";
  }, []);
  const expandOnlyVersionShelf = useCallback((shelf: "style" | "stage" | "set" | "unknown") => {
    setVersionShelfExpanded({
      style: shelf === "style",
      stage: shelf === "stage",
      set: shelf === "set",
      unknown: shelf === "unknown",
    });
  }, []);
  const scrollToVersionRow = useCallback((versionId: string) => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const row = versionRowRefs.current[versionId];
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);
  const jumpToVersionViaAnchor = useCallback(
    (asset: EditorVersionWithKind, forcedShelf?: "style" | "stage" | "set" | "unknown") => {
      const shelf = forcedShelf ?? resolveShelfForVersion(asset);
      expandOnlyVersionShelf(shelf);
      handleSelectVersion(asset);
      scrollToVersionRow(asset.id);
    },
    [expandOnlyVersionShelf, handleSelectVersion, resolveShelfForVersion, scrollToVersionRow]
  );
  const renderVersionRow = (asset: EditorVersionWithKind) => {
    const isActive = selectedVersionId === asset.id;
    const secondaryText = getVersionSecondaryLabel(asset);
    const isBaseImage = asset.isActiveSetEligible && activeSetVersionId === asset.id;
    const canSetAsBaseImage = asset.isActiveSetEligible && !isBaseImage;
    const versionPreviewUrl = getVersionPreviewUrl(asset) ?? "";
    const isDeleting = deletingVersionId === asset.id;
    const isSettingAsBaseImage = settingBaseImageVersionId === asset.id;
    const canFavourite = isVersionEligibleForFavourite(asset);
    const isFavourite = isVersionFavourited(asset);
    const isTogglingFavourite = togglingFavouriteVersionId === asset.id;
    return (
      <div
        key={asset.id}
        ref={(node) => {
          versionRowRefs.current[asset.id] = node;
        }}
        className="flex items-center gap-1.5"
      >
        <button
          type="button"
          onClick={() => handleSelectVersion(asset)}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border p-1.5 text-left transition ${
            isActive
              ? "border-neutral-600 bg-neutral-800 ring-1 ring-neutral-600/40"
              : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900"
          }`}
        >
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic per-version preview URL and sizing must match existing editor behavior */}
            <img
              src={versionPreviewUrl}
              alt={secondaryText}
              className="h-11 w-14 flex-none rounded bg-neutral-800 object-cover"
              loading="lazy"
            />
          </>
          <div className="min-w-0">
            <div className="truncate text-xs text-neutral-100">
              {formatVersionTimestamp(asset.created_at)}
            </div>
            <div className="truncate text-[11px] text-neutral-500">{secondaryText}</div>
            {isBaseImage ? <div className="mt-0.5 text-[10px] text-sky-300">Base Image</div> : null}
          </div>
        </button>
        <div className="flex flex-none items-center gap-1">
          {canSetAsBaseImage ? (
            <button
              type="button"
              className={`w-[68px] rounded-md border px-1.5 py-1 text-[10px] leading-tight text-center whitespace-normal transition ${
                settingBaseImageVersionId
                  ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                  : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
              disabled={Boolean(settingBaseImageVersionId)}
              onClick={() => {
                void handleSetVersionAsBaseImage(asset);
              }}
              aria-label="Set as Base Image"
              title="Set as Base Image"
            >
              {isSettingAsBaseImage ? (
                "Setting..."
              ) : (
                <>
                  <span className="block">Set as</span>
                  <span className="block">Base Image</span>
                </>
              )}
            </button>
          ) : null}
          {canFavourite ? (
            <button
              type="button"
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
                isTogglingFavourite
                  ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                  : isFavourite
                    ? "border-pink-900/70 bg-pink-950/20 text-pink-200 hover:border-pink-800/80 hover:bg-pink-900/25"
                    : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
              disabled={Boolean(togglingFavouriteVersionId)}
              onClick={() => {
                void handleToggleVersionFavourite(asset);
              }}
              aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
              title={isFavourite ? "Remove from favourites" : "Add to favourites"}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill={isFavourite ? "currentColor" : "none"}
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 13.4c-.2 0-.5-.1-.6-.3C6.5 12.2 2.8 9.1 2.8 6.2c0-1.9 1.4-3.2 3.1-3.2 1 0 1.9.5 2.5 1.3.6-.8 1.5-1.3 2.5-1.3 1.7 0 3.1 1.3 3.1 3.2 0 2.9-3.7 6-4.6 6.9-.2.2-.4.3-.6.3Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          {canDeleteVersions ? (
            <button
              type="button"
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
                deletingVersionId
                  ? "cursor-not-allowed border-red-950/60 bg-red-950/20 text-red-900/70"
                  : "border-red-950/60 bg-red-950/10 text-red-300/80 hover:border-red-900/70 hover:bg-red-900/20 hover:text-red-200"
              }`}
              disabled={Boolean(deletingVersionId)}
              onClick={() => handleRequestDeleteVersion(asset)}
              aria-label="Delete version"
              title="Delete version"
            >
              {isDeleting ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 animate-spin"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
                  <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M2.5 4h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M6.2 2.5h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path
                    d="M4.2 4l.7 8.1a1.2 1.2 0 0 0 1.2 1.1h3.8a1.2 1.2 0 0 0 1.2-1.1L11.8 4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M6.6 6.3v4.9M9.4 6.3v4.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              )}
              <span className="sr-only">{isDeleting ? "Deleting version" : "Delete version"}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  };
  const renderCollapsedVersionShelf = (args: {
    keyName: "style" | "stage" | "set" | "unknown";
    label: string;
    versionsInShelf: EditorVersionWithKind[];
  }) => {
    const { keyName, label, versionsInShelf } = args;
    if (versionsInShelf.length === 0) return null;

    const isExpanded = versionShelfExpanded[keyName];

    return (
      <div key={keyName}>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-left transition hover:bg-neutral-900"
          aria-expanded={isExpanded}
          onClick={() =>
            setVersionShelfExpanded((prev) => ({
              ...prev,
              [keyName]: !prev[keyName],
            }))
          }
        >
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">
              {label} ({versionsInShelf.length})
            </div>
          </div>
          <span className="ml-2 text-xs text-neutral-400">{isExpanded ? "▾" : "▸"}</span>
        </button>
        {isExpanded ? <div className="mt-1 space-y-1">{versionsInShelf.map(renderVersionRow)}</div> : null}
      </div>
    );
  };
  const activeBasePreviewVersion =
    versionsWithKind.find((asset) => asset.id === activeSetVersionId) ?? originalVersion;
  const activeCanvasKindLabel = selectedCanvasVersion
    ? resolveShelfForVersion(selectedCanvasVersion).toUpperCase()
    : null;
  const collapseAllVersionShelves = useCallback(() => {
    setVersionShelfExpanded({
      style: false,
      stage: false,
      set: false,
      unknown: false,
    });
  }, []);
  const expandAllVersionShelves = useCallback(() => {
    setVersionShelfExpanded({
      style: true,
      stage: true,
      set: true,
      unknown: true,
    });
  }, []);
  const isSetWorkflowMode = workflowMode === "set";
  const isStageWorkflowMode = workflowMode === "stage";
  const isStyleWorkflowMode = workflowMode === "style";
  const handleWorkflowTabClick = useCallback((mode: WorkflowMode) => {
    if (workflowTabSingleClickTimeoutRef.current !== null) {
      window.clearTimeout(workflowTabSingleClickTimeoutRef.current);
    }
    workflowTabSingleClickTimeoutRef.current = window.setTimeout(() => {
      setWorkflowMode(mode);
      setPanels((prev) => (prev.workflow ? prev : { ...prev, workflow: true }));
      workflowTabSingleClickTimeoutRef.current = null;
    }, 180);
  }, []);
  const handleWorkflowTabDoubleClick = useCallback(() => {
    if (workflowTabSingleClickTimeoutRef.current !== null) {
      window.clearTimeout(workflowTabSingleClickTimeoutRef.current);
      workflowTabSingleClickTimeoutRef.current = null;
    }
    setPanels((prev) => (prev.workflow ? { ...prev, workflow: false } : prev));
  }, []);
  useEffect(
    () => () => {
      if (workflowTabSingleClickTimeoutRef.current !== null) {
        window.clearTimeout(workflowTabSingleClickTimeoutRef.current);
      }
    },
    []
  );
  const workflowPanelStage = isStyleWorkflowMode ? 4 : activeStage;
  const workflowPanelTokenCostLabel = isStyleWorkflowMode
    ? formatTokenCostLabel(STAGE_TOKEN_COST[4] ?? DEFAULT_ACTION_TOKEN_COST)
    : activeStageTokenCostLabel;
  const renderRemoveToolEntryPoint = (className = "mt-3") => (
    <div className={className}>
      <div className="text-xs text-neutral-400">Remove</div>
      <div className="mt-2">
        <button
          type="button"
          disabled={isEditRunning || isRemoveModeReadingObjects || isSetGeometryPrewarming || isRemoveModeEnabled}
          className={`w-full rounded-md border px-2 py-1.5 text-xs ${
            isEditRunning || isRemoveModeReadingObjects || isSetGeometryPrewarming
              ? "border-neutral-900 bg-neutral-950 text-neutral-500"
              : isRemoveModeEnabled
                ? "border-sky-500/50 bg-sky-950/30 text-sky-200"
                : "border-sky-500/70 bg-sky-950/40 text-sky-100 hover:bg-sky-900/50"
          }`}
          onClick={() => {
            void engageRemoveMode();
          }}
        >
          {isRemoveModeReadingObjects
            ? "Reading room objects…"
            : isSetGeometryPrewarming
              ? "Preparing Remove Mode..."
            : isRemoveModeEnabled
              ? "Remove Mode Active"
              : "Engage Remove Mode"}
        </button>
        {isSetGeometryPrewarming ? (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border border-neutral-500/30 border-t-neutral-200"
            />
            <span>Reading your room so Remove Mode is ready...</span>
          </div>
        ) : null}
        {isRemoveModeEnabled ? (
          <button
            type="button"
            disabled={isRemoveModeReadingObjects}
            className={`mt-1 w-full rounded-md border px-2 py-1 text-[11px] ${
              isRemoveModeReadingObjects
                ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            }`}
            onClick={exitRemoveMode}
          >
            Exit Remove Mode
          </button>
        ) : null}
      </div>
      <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1.5 text-[11px] text-neutral-400">
        {!isRemoveModeEnabled ? (
          <div>Use Remove Mode to identify objects before marking them for cleanup.</div>
        ) : isRemoveModeReadingObjects ? (
          <div>Reading room objects…</div>
        ) : removeModeError ? (
          <div>{removeModeError}</div>
        ) : removeModeObjects.length > 0 ? (
          <>
            <div>Detected {removeModeObjects.length} removable objects.</div>
            <div className="mt-0.5 text-neutral-500">Object selection canvas overlay coming next.</div>
          </>
        ) : (
          <div>No major objects detected. Manual remove markers will still be available in the next phase.</div>
        )}
        {isRemoveModeEnabled ? (
          <div className="mt-1 text-neutral-500">
            {formatRemoveModeMarkedCount(selectedRemoveObjectKeys.length)}
          </div>
        ) : null}
        {isRemoveModeEnabled ? (
          <div className="mt-1 text-neutral-500">
            {formatRemoveModeManualMarkerCount(removeModeManualMarkers.length)}
          </div>
        ) : null}
      </div>
      {isRemoveModeEnabled ? (
        <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1.5">
          <div className="mt-1 text-[11px] text-neutral-400">
            Click Engage Remove Mode, then select detected objects or click the room to place remove markers.
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Drag labels or markers to refine targets before removing.
          </div>
        </div>
      ) : null}
      {isRemoveModeEnabled ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={
              isEditRunning ||
              isPreparingRemoveGuidanceImage ||
              isOutOfTokens ||
              !workingImageUrl ||
              removeModeGuidanceManifestDraft.targetCount === 0
            }
            className={`col-span-2 rounded-md border px-2 py-1.5 text-xs ${
              isEditRunning ||
              isPreparingRemoveGuidanceImage ||
              isOutOfTokens ||
              !workingImageUrl ||
              removeModeGuidanceManifestDraft.targetCount === 0
                ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
            }`}
            onClick={() => {
              void removeSelectedWithGuidedRemoveMode();
            }}
          >
            {isEditRunning ? "Removing selected items…" : "Remove Selected"}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="fixed inset-0 z-0 flex min-h-0 flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 px-4">
        <div className="flex items-center gap-3">
          <Link
            href="/my-rooms"
            className="rounded-md border border-transparent px-2 py-1 text-xs text-neutral-400 transition hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-200"
          >
            ← My Rooms
          </Link>
          <Link
            href={myFurnitureHref}
            className="rounded-md border border-transparent px-2 py-1 text-xs text-neutral-400 transition hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-200"
          >
            My Furniture
          </Link>
          <div className="h-6 w-6 rounded bg-neutral-700" />
          <div className="text-sm font-medium tracking-wide">Vibode Editor</div>
          <div className="ml-2 rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
            V0
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(queuedDeletes > 0 || queuedSwaps > 0) && (
            <div className="mr-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300">
              {queuedDeletes > 0
                ? `${queuedDeletes} delete${queuedDeletes === 1 ? "" : "s"} queued`
                : ""}
              {queuedDeletes > 0 && queuedSwaps > 0 ? " • " : ""}
              {queuedSwaps > 0 ? `${queuedSwaps} swap${queuedSwaps === 1 ? "" : "s"} pending` : ""}
            </div>
          )}
          <button
            type="button"
            aria-pressed={isFurnitureLayerEnabled}
            onClick={toggleFurnitureLayer}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              isFurnitureLayerEnabled
                ? "border-blue-500/70 bg-blue-900/30 text-blue-100 hover:bg-blue-900/45"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            Furniture Layer: {isFurnitureLayerEnabled ? "On" : "Off"}
          </button>
          <TokenBalanceBadge className="border-neutral-700 bg-neutral-900 text-neutral-200" />
          <Link
            href="/billing"
            onClick={persistWorkspaceSnapshotForBillingNavigation}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-200 transition hover:bg-neutral-800"
          >
            Top up tokens
          </Link>
          <SignOutButton className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-neutral-800 disabled:opacity-50" />

          <div className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5">
            <span className="text-xs text-neutral-400">Model</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as VibodeModelVersion)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-neutral-500"
              title="Vibode model"
            >
              <option value={VIBODE_MODEL_NBP}>NBP</option>
              <option value={VIBODE_MODEL_NB2}>NB2</option>
            </select>
          </div>

          <button
            type="button"
            disabled={!previewImageUrl || isDownloading}
            onClick={handleDownloadPreview}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              !previewImageUrl || isDownloading
                ? "border-neutral-800 bg-neutral-950 text-neutral-500"
                : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
            }`}
            title={!previewImageUrl ? "No preview image available" : "Download current preview"}
          >
            {isDownloading ? "Downloading…" : "Download"}
          </button>

        </div>
      </header>

      {/* Main */}
      <div className="flex min-h-0 flex-1 w-full overflow-hidden">
        {/* Canvas area */}
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-950">
          {/* OUTER: owns glow pseudo-elements (NO overflow-hidden) */}
          <div
            className="relative h-[70vh] w-[70vw] max-w-[1200px] rounded-lg precision-ring vibe-glow vibe-aura vibe-aura-animate"
          >
            {/* INNER: clips canvas contents + keeps border/bg */}
            <div
              className={`relative h-full w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 ${
                isBusy ? "blur-[1px] brightness-90" : ""
              } ${
                isCanvasEmpty && isCanvasDragOver
                  ? "border-blue-700/70 bg-blue-950/20 ring-1 ring-inset ring-blue-400/40"
                  : ""
              }`}
              onDragEnter={handleCanvasDragEnter}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
            >
              <input
                ref={roomPhotoUploadInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={isPreparingRoomPhotoUpload}
                onChange={handleRoomPhotoInputChange}
              />

              {showSwapReplacementPicker && (
                <div className="absolute left-2 top-2 z-20 w-[340px] rounded-lg border border-blue-800/60 bg-neutral-950/95 p-3 shadow-xl backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-blue-100">Swap mark selected</div>
                      <div className="text-xs text-neutral-400">
                        Choose replacement for this mark.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                      onClick={() => selectSwapMark(null)}
                    >
                      Done
                    </button>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-blue-700/60 bg-blue-950/40 px-3 py-1.5 text-xs text-blue-100 hover:bg-blue-900/40"
                      onClick={() => setSwapPickerOpen((open) => !open)}
                    >
                      {swapPickerOpen ? "Hide options" : "Choose replacement"}
                    </button>
                    {selectedSwapMark?.replacement && (
                      <div className="text-xs text-blue-200">
                        Selected: {selectedSwapMark.replacement.skuId}
                      </div>
                    )}
                  </div>

                  {swapPickerOpen && (
                    <div className="mt-3 max-h-[44vh] space-y-2 overflow-auto pr-1">
                      {swapReplacementOptions.map((sku) => {
                        const isSelected = selectedSwapMark?.replacement?.skuId === sku.skuId;
                        return (
                          <button
                            key={sku.skuId}
                            type="button"
                            className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                              isSelected
                                ? "border-blue-400/70 bg-blue-950/50"
                                : "border-neutral-800 bg-neutral-900 hover:bg-neutral-800"
                            }`}
                            onClick={() => {
                              if (!selectedSwapMarkId) return;
                              setSwapReplacement(selectedSwapMarkId, {
                                skuId: sku.skuId,
                                imageUrl: sku.imageUrl,
                              });
                              pushSnack(`Swap replacement set: ${sku.displayName}`);
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element -- swap-option thumbnails are dynamic catalog URLs inside editor controls */}
                                <img
                                  src={sku.imageUrl}
                                  alt={sku.displayName}
                                  className="h-12 w-12 rounded-md bg-neutral-800 object-cover"
                                  loading="lazy"
                                />
                              </>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-neutral-100">
                                  {sku.displayName}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-neutral-400">
                                  {sku.skuId}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <EditorCanvas
                key={scene.sceneId}
                className={`absolute inset-0 transition-opacity duration-200 ease-out ${
                  isRoomHydrating || canvasPresentation.isHydratingRoom ? "opacity-95" : "opacity-100"
                } [&_.pointer-events-none.absolute.left-3.top-3]:hidden`}
                imageUrl={canvasImageUrl}
                frameAspectRatio={resolvedCanvasFrameAspectRatio}
                placeholderImageUrl={canvasPresentation.placeholderImageUrl}
                showPlaceholder={canvasPresentation.showPlaceholder}
                finalImageReady={canvasPresentation.finalImageReady}
                isHydratingRoom={canvasPresentation.isHydratingRoom}
                suppressEmptyCanvasHint={Boolean(requestedRoomId)}
                markupVisible={scene.markupVisible}
                visualMode="blueprint"
                pasteToPlaceStatus={pasteToPlaceStatus}
                pasteToPlaceMenuState={pasteToPlaceMenuState}
                pasteToPlaceMenuPreviewUrl={pasteToPlaceDisplayedPreviewUrl}
                isPasteToPlaceMyFurnitureMultiSelect={isMyFurnitureMultiPreparedSource}
                pasteToPlaceMyFurnitureSelectionCount={myFurniturePreparedSelectionCount}
                pasteToPlaceMyFurnitureSelectedPreviewUrls={myFurniturePreparedSelectedPreviewUrls}
                pasteToPlaceProductDisplayName={productUrlPreparedDisplayName}
                pasteToPlaceProductSupplier={productUrlPreparedSupplier}
                pasteToPlaceProductSourceUrl={productUrlPreparedSourceUrl}
                isPasteToPlaceMenuPreviewLoading={isPasteToPlaceMenuPreviewLoading}
                pasteToPlaceProgressCardState={pasteToPlaceProgressCardState}
                pasteToPlaceProgressCardPreviewUrl={pasteToPlaceProgressCardPreviewUrl}
                isPasteToPlaceProgressCardLoading={
                  isPasteToPlaceMenuIngesting || Boolean(pasteToPlaceStatus)
                }
                pasteToPlaceProgressOperations={pasteToPlaceProgressOperations}
                onCancelPasteToPlaceGeneration={
                  canShowSingletonPasteToPlaceCancel ? cancelPasteToPlaceGeneration : undefined
                }
                isPasteToPlaceCancelling={isPasteToPlaceCancelling}
                isPasteToPlaceSettling={isPasteToPlaceSettling}
                isPasteToPlaceRefreshInteractionLocked={isPasteToPlaceRefreshInteractionLocked}
                onOpenPasteToPlaceMenu={openPasteToPlaceMenu}
                onPasteToPlaceChoosePlaceHere={handlePasteToPlacePlaceHere}
                onPasteToPlaceChooseMyFurnitureAdd={() => {
                  void openMyFurniturePicker("add");
                }}
                pasteToPlaceAwaitingPasteMessage={pasteToPlaceAwaitingPasteMessage}
                pasteToPlaceProductUrlInput={pasteToPlaceProductUrlInput}
                onPasteToPlaceProductUrlInputChange={handlePasteToPlaceProductUrlInputChange}
                onPasteToPlaceSubmitProductUrl={handlePasteToPlaceSubmitUrlInput}
                isPasteToPlaceProductUrlPreparing={isPasteToPlaceProductUrlPreparing}
                onPasteToPlaceChooseSwap={handlePasteToPlaceSwap}
                onPasteToPlaceChooseAutoPlace={handlePasteToPlaceAutoPlace}
                onPasteToPlaceRefreshCopiedItem={refreshPasteToPlaceCopiedItem}
                onDismissPasteToPlaceMenu={dismissPasteToPlaceMenu}
                isMyFurnitureLoading={myFurnitureLoading}
                removeMarkerPosition={removeMarkerPosition}
                removeMarkerTargetingActive={isRemoveMarkerTargeting}
                rotateMarkerPosition={rotateToolState.marker}
                rotateMarkerTargetingActive={isRotateMarkerTargeting}
                onPlaceRemoveMarker={handlePlaceRemoveMarker}
                onClearRemoveMarker={clearRemoveMarker}
                onPlaceRotateMarker={handlePlaceRotateMarker}
                onClearRotateMarker={clearRotateMarker}
                onRequestSwap={(id) => {
                  const node = nodes.find((n) => n.id === id);
                  if (node?.status === "markedForDelete") {
                    pushSnack("This item is queued for removal. Restore it (red X) to swap.");
                    return;
                  }
                  setSwapTargetId(id);
                  setSwapOpen(true);
                }}
                furnitureLayerEnabled={isFurnitureLayerEnabled}
                onToggleFurnitureLayer={toggleFurnitureLayer}
                keyboardShortcutsBlocked={isEditorKeyboardShortcutBlocked}
                placementLayerNodes={placementLayerNodes}
                onMovePlacementLayerNodeLocal={updatePlacementLayerNodePositionLocal}
                onCommitPlacementLayerNodeMove={persistPlacementLayerNodePosition}
                onDeletePlacementLayerNode={deletePlacementLayerNode}
                onPlacementLayerDragStateChange={handlePlacementLayerDragStateChange}
                removeModeEnabled={isRemoveModeEnabled}
                removeModeTargets={removeModeOverlayTargets}
                selectedRemoveModeTargetKeys={selectedRemoveObjectKeys}
                onToggleRemoveModeTarget={toggleRemoveModeObjectSelection}
                onMoveRemoveModeTarget={updateRemoveModeObjectTargetOverride}
                removeModeManualMarkers={removeModeManualMarkers}
                onPlaceRemoveModeManualMarker={handlePlaceRemoveModeManualMarker}
                onMoveRemoveModeManualMarker={moveRemoveModeManualMarker}
                onRemoveRemoveModeManualMarker={removeRemoveModeManualMarker}
              />

              {shouldShowUploadOverlay && (
                <div
                  className={`absolute inset-0 z-10 flex items-center justify-center transition ${
                    isCanvasDragOver ? "bg-blue-950/20" : "bg-neutral-950/20"
                  }`}
                >
                  <div
                    className={`mx-4 w-full max-w-md rounded-2xl border px-6 py-7 text-center shadow-xl backdrop-blur-sm transition ${
                      isCanvasDragOver
                        ? "border-blue-500/60 bg-neutral-900/90"
                        : "border-blue-900/40 bg-neutral-900/80"
                    }`}
                  >
                    <div className="text-2xl font-semibold tracking-tight text-neutral-100">
                      Upload your room photo
                    </div>
                    <div className="mt-1 text-sm text-blue-200/90">to start Viboding</div>

                    <button
                      type="button"
                      className={`mt-6 rounded-md border px-4 py-2 text-sm font-medium transition ${
                        isPreparingRoomPhotoUpload
                          ? "cursor-not-allowed border-neutral-700 bg-neutral-800 text-neutral-500"
                          : "border-blue-600/80 bg-blue-900/50 text-blue-100 hover:bg-blue-800/60"
                      }`}
                      disabled={isPreparingRoomPhotoUpload}
                      onClick={() => roomPhotoUploadInputRef.current?.click()}
                    >
                      {isOptimizingRoomImage
                        ? "Optimizing your image..."
                        : isUploading
                          ? "Uploading…"
                          : "Upload Photo"}
                    </button>

                    <div className="mt-3 text-xs text-neutral-400">or drag & drop an image</div>
                    {roomPhotoUploadError && (
                      <div className="mt-2 text-xs text-rose-300">{roomPhotoUploadError}</div>
                    )}
                  </div>
                </div>
              )}

              {isBusy && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="h-8 w-8 rounded-full border-2 border-neutral-200 border-t-transparent animate-spin" />
                  {scene.genUi.message ? (
                    <div className="mt-3 max-w-[80%] text-center text-xs text-neutral-300">
                      {scene.genUi.message}
                    </div>
                  ) : null}
                </div>
              )}
              {canShowRestoreOriginalPlacementPositionsAction ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                  <div className="pointer-events-auto rounded-full border border-neutral-700/80 bg-neutral-950/70 px-3 py-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                    <button
                      type="button"
                      onClick={handleRestoreOriginalPlacementPositions}
                      disabled={isRestoreOriginalPlacementPositionsButtonDisabled}
                      className={`text-xs transition ${
                        isRestoreOriginalPlacementPositionsButtonDisabled
                          ? "cursor-not-allowed text-neutral-600"
                          : "text-neutral-300 hover:text-neutral-100"
                      }`}
                    >
                      {isRestoringOriginalPlacementPositions
                        ? "Restoring original placement positions..."
                        : "Restore original placement positions"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {shouldShowSceneNeedsUpdateOverlay ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3">
                <div className="pointer-events-auto w-full max-w-[min(92vw,920px)] rounded-xl border border-neutral-500/35 bg-neutral-950/70 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center sm:justify-between sm:text-left">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                      <span>Room needs update</span>
                    </div>
                    <div className="text-xs text-neutral-300">Furniture changes are ready to apply.</div>
                    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                      {canShowRevertPlacementChangesButton ? (
                        <button
                          type="button"
                          onClick={handleRevertPlacementChanges}
                          disabled={isRevertPlacementChangesButtonDisabled}
                          className={`rounded border px-2.5 py-1 text-xs ${
                            isRevertPlacementChangesButtonDisabled
                              ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                              : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                          }`}
                        >
                          {isRevertingPlacementChanges ? "Reverting..." : "Revert Changes"}
                        </button>
                      ) : null}
                      {canCancelDevSceneRebuild ? (
                        <button
                          type="button"
                          onClick={handleCancelDevSceneRebuild}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          void handleDevRebuildActiveVersion();
                        }}
                        disabled={isDevSceneRebuildButtonDisabled}
                        className={`rounded border px-2.5 py-1 text-xs transition ${
                          isDevSceneRebuildButtonDisabled
                            ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                            : "border-sky-300/40 bg-gradient-to-b from-sky-400/20 to-blue-500/20 text-sky-50 shadow-[0_0_16px_rgba(56,189,248,0.24)] hover:border-sky-200/70 hover:from-sky-300/30 hover:to-blue-500/30 hover:shadow-[0_0_22px_rgba(56,189,248,0.38)]"
                        }`}
                      >
                        {isDevSceneRebuildRunning ? "Updating..." : "Update Room"}
                      </button>
                    </div>
                  </div>
                  {devSceneRebuildProgressCopy ? (
                    <div className="mt-1.5 text-center sm:text-left">
                      <div className="flex items-center justify-center gap-1.5 text-xs text-sky-100 sm:justify-start">
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 animate-spin rounded-full border border-sky-300/30 border-t-sky-200"
                        />
                        <span>{devSceneRebuildProgressCopy.title}</span>
                      </div>
                      <div className="text-[11px] text-neutral-300">{devSceneRebuildProgressCopy.helper}</div>
                    </div>
                  ) : null}
                  {devSceneRebuildMissingReason ? (
                    <div className="mt-1 text-center text-[11px] text-neutral-500 sm:text-left">
                      {devSceneRebuildMissingReason}
                    </div>
                  ) : null}
                  {devSceneRebuildFeedback ? (
                    <div
                      className={`mt-1 text-center text-[11px] sm:text-left ${
                        devSceneRebuildFeedback.tone === "success" ? "text-emerald-300" : "text-red-300"
                      }`}
                    >
                      {devSceneRebuildFeedback.title ? (
                        <div className="text-xs">{devSceneRebuildFeedback.title}</div>
                      ) : null}
                      <div>{devSceneRebuildFeedback.helper ?? devSceneRebuildFeedback.message}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </main>

        {/* Right panel */}
        <aside className="flex h-full min-h-0 w-[340px] flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4 p-4">
            <div className="rounded-lg">
              <div className="-mb-px flex items-end gap-1 px-2">
                {(
                  [
                    { id: "set", label: "SET" },
                    { id: "stage", label: "STAGE" },
                    { id: "style", label: "STYLE" },
                  ] as const
                ).map((mode) => {
                  const isActive = workflowMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleWorkflowTabClick(mode.id)}
                      onDoubleClick={handleWorkflowTabDoubleClick}
                      aria-pressed={isActive}
                      className={`rounded-t-md border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] transition ${
                        isActive
                          ? "border-neutral-700 border-b-neutral-900 bg-neutral-900 text-neutral-100"
                          : "border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200"
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Workflow — {workflowMode.toUpperCase()}</div>
                  <button
                    type="button"
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                    aria-label={panels.workflow ? "Collapse Workflow panel" : "Expand Workflow panel"}
                    aria-expanded={panels.workflow}
                    aria-controls="workflow-panel-body"
                    onClick={() =>
                      setPanels((prev) => ({
                        ...prev,
                        workflow: !prev.workflow,
                      }))
                    }
                  >
                    {panels.workflow ? "▾" : "▸"}
                  </button>
                </div>
                {panels.workflow ? (
                  <div id="workflow-panel-body">
                    <div className="mt-2 text-[11px] text-neutral-500">{WORKFLOW_MODE_HELPER_COPY[workflowMode]}</div>

                  <div className="mt-2 text-xs text-neutral-500">
                    Status: {stageStatus[activeStage]} • Furniture pass: {hasFurniturePass ? "yes" : "no"}
                  </div>
                  {isStageRunSettling ? (
                    <div className="mt-1 text-xs text-neutral-400">Cancelling...</div>
                  ) : null}
                  {activeStageRunUiState ? (
                    <div className="mt-2 flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5">
                      <div className="text-xs text-neutral-400">
                        Generating Stage {activeStageRunUiState.stageNumber}...
                      </div>
                      <button
                        type="button"
                        onClick={cancelStageRunGeneration}
                        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-neutral-500">
                    Preview image: {getBaseImageLabel(previewImageUrl ?? scene.baseImageUrl)}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Working image: {workingImageUrl ? "ready" : "none"}
                  </div>
                  <TokenStatusNotice
                    lowThreshold={LOW_TOKEN_WARNING_THRESHOLD}
                    showGetMoreTokensCta
                    className="mt-3"
                  />
                  {isOutOfTokens ? (
                    <div className="mt-2 text-[11px] text-neutral-500">
                      Stage and edit actions are paused until you top up.{" "}
                      <Link
                        href="/billing"
                        onClick={persistWorkspaceSnapshotForBillingNavigation}
                        className="text-neutral-300 underline underline-offset-2"
                      >
                        Open billing
                      </Link>
                      .
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                    <div className="text-sm font-medium">
                      {isStyleWorkflowMode
                        ? "Style Workspace"
                        : isStageWorkflowMode
                          ? "Stage Workspace"
                          : `Stage ${activeStage}`}
                    </div>

                {isSetWorkflowMode ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Prepare Room</div>
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                        <input
                          type="checkbox"
                          checked={stage1Enhance}
                          onChange={(e) => setStage1Enhance(e.target.checked)}
                          className="h-4 w-4 accent-sky-400"
                        />
                        Enhance
                      </label>
                      <div className="mt-2">
                        <div className="text-xs text-neutral-400">Declutter</div>
                        <div className="mt-1 flex gap-2">
                          {(["off", "light", "heavy"] as DeclutterMode[]).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setStage1Declutter(mode)}
                              className={`rounded-md border px-2 py-1 text-xs ${
                                stage1Declutter === mode
                                  ? "border-neutral-600 bg-neutral-800 text-neutral-100"
                                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                              }`}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            runStageWithCancellation(1, {
                              enhance: stage1Enhance,
                              declutter: stage1Declutter,
                            })
                          }
                          disabled={stageStatus[1] === "running" || isOutOfTokens || isStageRunSettling}
                          className={`rounded-md border px-3 py-1.5 text-sm ${
                            stageStatus[1] === "running" || isOutOfTokens || isStageRunSettling
                              ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                              : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                          }`}
                        >
                          {stageStatus[1] === "running" ? "Running…" : "Run Stage"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runStageWithCancellation(1, {
                              enhance: stage1Enhance,
                              declutter: stage1Declutter,
                              emptyRoom: true,
                            })
                          }
                          disabled={stageStatus[1] === "running" || isOutOfTokens || isStageRunSettling}
                          className={`rounded-md border px-3 py-1.5 text-sm ${
                            stageStatus[1] === "running" || isOutOfTokens || isStageRunSettling
                              ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                              : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                          }`}
                        >
                          Empty Room
                        </button>
                      </div>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Modify Room</div>
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                        <input
                          type="checkbox"
                          checked={stage2Repair}
                          onChange={(e) => setStage2Repair(e.target.checked)}
                          className="h-4 w-4 accent-sky-400"
                        />
                        Repair Damage
                      </label>
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                        <input
                          type="checkbox"
                          checked={stage2Repaint}
                          onChange={(e) => setStage2Repaint(e.target.checked)}
                          className="h-4 w-4 accent-sky-400"
                        />
                        Repaint Walls
                      </label>
                      <div className="mt-2">
                        <div className="text-xs text-neutral-400">Flooring</div>
                        <select
                          className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm outline-none focus:border-neutral-600"
                          value={stage2Flooring}
                          onChange={(e) =>
                            setStage2Flooring(e.target.value as "none" | "carpet" | "hardwood" | "tile")
                          }
                        >
                          <option value="none">none</option>
                          <option value="carpet">carpet</option>
                          <option value="hardwood">hardwood</option>
                          <option value="tile">tile</option>
                        </select>
                      </div>
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => runStageWithCancellation(2)}
                          disabled={stageStatus[2] === "running" || isOutOfTokens || isStageRunSettling}
                          className={`rounded-md border px-3 py-1.5 text-sm ${
                            stageStatus[2] === "running" || isOutOfTokens || isStageRunSettling
                              ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                              : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                          }`}
                        >
                          {stageStatus[2] === "running" ? "Running…" : "Run Stage"}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Cleanup</div>
                      {renderRemoveToolEntryPoint("mt-2")}
                    </div>
                  </div>
                ) : isStyleWorkflowMode ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Style Scene</div>
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() =>
                            runStageWithCancellation(4, { stage4Action: STAGE4_PRIMARY_ACTION })
                          }
                          disabled={stageStatus[4] === "running" || isOutOfTokens || isStageRunSettling}
                          className={`w-full rounded-md border px-3 py-2 text-sm ${
                            stageStatus[4] === "running" || isOutOfTokens || isStageRunSettling
                              ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                              : "border-sky-500/60 bg-sky-950/40 text-sky-100 hover:bg-sky-900/50"
                          }`}
                        >
                          {stageStatus[4] === "running" && stage4RunningAction === STAGE4_PRIMARY_ACTION
                            ? "Styling…"
                            : "✨ Style Room"}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {STAGE4_ADVANCED_ACTIONS.map((action) => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => runStageWithCancellation(4, { stage4Action: action })}
                            disabled={stageStatus[4] === "running" || isOutOfTokens || isStageRunSettling}
                            className={`rounded-md border px-2 py-1 text-xs ${
                              stageStatus[4] === "running" || isOutOfTokens || isStageRunSettling
                                ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                                : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                            }`}
                          >
                            {stageStatus[4] === "running" && stage4RunningAction === action
                              ? "Running…"
                              : STAGE4_ACTION_LABELS[action]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Looks</div>
                      <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-2.5 py-2 text-xs text-neutral-500">
                        Preset looks and photo adjustments coming soon.
                      </div>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {stageStatus[4] === "running" && stage4RunningAction
                        ? `Running: ${STAGE4_ACTION_LABELS[stage4RunningAction]}`
                        : "Image-only styling pass; Stage 3 placements stay unchanged."}
                    </div>
                  </div>
                ) : isStageWorkflowMode ? (
                  <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5">
                    <div className="text-xs text-neutral-300">
                      Paste furniture directly into your room.
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-500">Copy → Click room → Paste</div>
                    <div className="mt-2 text-[11px] text-neutral-500">
                      Use the Furniture Layer to move, hide, or remove staged items.
                    </div>
                  </div>
                ) : null}

                {isStageWorkflowMode ? null : (
                  <>
                    <div className="mt-3 text-xs text-neutral-500">
                      Last output: {lastStageOutputs[workflowPanelStage] ? "available" : "none"}
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      This will use {workflowPanelTokenCostLabel}.
                    </div>
                  </>
                )}
                  </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Versions</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    {versions.length} version{versions.length === 1 ? "" : "s"}
                  </div>
                </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
                    onClick={collapseAllVersionShelves}
                  >
                    − Collapse All
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
                    onClick={expandAllVersionShelves}
                  >
                    + Expand All
                  </button>
                </div>
                <button
                  type="button"
                  className={`rounded-md border px-2 py-1 text-[11px] transition ${
                    isFavouritesFilterOn
                      ? "border-pink-900/70 bg-pink-950/20 text-pink-200 hover:border-pink-800/80 hover:bg-pink-900/25"
                      : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  }`}
                  aria-pressed={isFavouritesFilterOn}
                  onClick={() => setIsFavouritesFilterOn((prev) => !prev)}
                >
                  {isFavouritesFilterOn ? "Favourites On" : "Favourites Off"}
                </button>
              </div>
              </div>
              <div id="versions-panel-body" className="mt-3">
                {versions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-500">
                    No versions yet. Upload an image to create the original version.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedCanvasVersion ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-left transition hover:bg-neutral-900"
                        onClick={() => jumpToVersionViaAnchor(selectedCanvasVersion)}
                      >
                        {getVersionPreviewUrl(selectedCanvasVersion) ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- anchor card uses dynamic version preview URLs */}
                            <img
                              src={getVersionPreviewUrl(selectedCanvasVersion) ?? ""}
                              alt="Active Canvas Image"
                              className="h-9 w-12 flex-none rounded bg-neutral-800 object-cover"
                              loading="lazy"
                            />
                          </>
                        ) : (
                          <div className="h-9 w-12 flex-none rounded border border-neutral-800 bg-neutral-900" />
                        )}
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                            Active Canvas Image
                          </div>
                          {activeCanvasKindLabel ? (
                            <div className="text-[11px] text-neutral-300">{activeCanvasKindLabel}</div>
                          ) : null}
                        </div>
                      </button>
                    ) : null}
                    {isFavouritesFilterEmpty ? (
                      <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-500">
                        No favourite versions yet. Tap the heart on a STAGE or STYLE version to save it here.
                      </div>
                    ) : (
                      <>
                        {renderCollapsedVersionShelf({
                          keyName: "style",
                          label: "STYLE",
                          versionsInShelf: groupedVersionsForDisplay.style,
                        })}
                        {renderCollapsedVersionShelf({
                          keyName: "stage",
                          label: "STAGE",
                          versionsInShelf: groupedVersionsForDisplay.stage,
                        })}
                      </>
                    )}

                    <div className="my-1 border-t border-neutral-800/70 pt-1.5" />

                    <div className="rounded-lg border border-neutral-800/40 bg-neutral-800/80 p-3 ring-1 ring-inset ring-neutral-900/15">
                      <div className="space-y-2">
                        {activeBasePreviewVersion ? (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-left transition hover:bg-neutral-900"
                            onClick={() => {
                              if (isFavouritesFilterOn) {
                                handleSelectVersion(activeBasePreviewVersion);
                                return;
                              }
                              jumpToVersionViaAnchor(activeBasePreviewVersion, "set");
                            }}
                          >
                            {getVersionPreviewUrl(activeBasePreviewVersion) ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element -- anchor card uses dynamic base preview URLs */}
                                <img
                                  src={getVersionPreviewUrl(activeBasePreviewVersion) ?? ""}
                                  alt="Active Base Image"
                                  className="h-9 w-12 flex-none rounded bg-neutral-800 object-cover"
                                  loading="lazy"
                                />
                              </>
                            ) : (
                              <div className="h-9 w-12 flex-none rounded border border-neutral-800 bg-neutral-900" />
                            )}
                            <div className="min-w-0">
                              <div className="text-[10px] uppercase tracking-wide text-sky-300">
                                Active Base Image
                              </div>
                            </div>
                          </button>
                        ) : null}
                        {!isFavouritesFilterOn
                          ? renderCollapsedVersionShelf({
                              keyName: "set",
                              label: "SET",
                              versionsInShelf: groupedVersionsForDisplay.set,
                            })
                          : null}
                      </div>
                    </div>
                    {!isFavouritesFilterOn
                      ? renderCollapsedVersionShelf({
                          keyName: "unknown",
                          label: "UNKNOWN",
                          versionsInShelf: groupedVersionsForDisplay.unknown,
                        })
                      : null}
                  </div>
                )}
              </div>
            </div>

            {showObsoleteV0RightPanels ? (
              <>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Paste Product Image (MVP)</div>
                <button
                  type="button"
                  className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  aria-label={
                    isPasteProductImageCollapsed
                      ? "Expand Paste Product Image panel"
                      : "Collapse Paste Product Image panel"
                  }
                  aria-expanded={!isPasteProductImageCollapsed}
                  aria-controls="paste-product-image-panel-body"
                  onClick={() => setIsPasteProductImageCollapsed((prev) => !prev)}
                >
                  {isPasteProductImageCollapsed ? "▸" : "▾"}
                </button>
              </div>
              {!isPasteProductImageCollapsed ? (
                <div id="paste-product-image-panel-body">
                  <div className="mt-1 text-xs text-neutral-400">
                    Paste a direct product image URL or upload a local image, then add it to Stage 3
                    eligible items.
                  </div>

              <div className="mt-3 space-y-2">
                <div>
                  <div className="text-xs text-neutral-400">Image URL</div>
                  <input
                    type="url"
                    value={productImageUrl}
                    onChange={(e) => setProductImageUrl(e.target.value)}
                    placeholder="https://example.com/product.jpg"
                    className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm outline-none focus:border-neutral-600"
                  />
                </div>

                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-neutral-800" />
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">OR</div>
                  <div className="h-px flex-1 bg-neutral-800" />
                </div>

                <div>
                  <div className="text-xs text-neutral-400">Upload Image</div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onUploadedProductImageChange}
                    className="mt-1 block w-full text-xs text-neutral-300 file:mr-3 file:rounded-md file:border file:border-neutral-800 file:bg-neutral-950 file:px-2 file:py-1.5 file:text-xs file:text-neutral-200 hover:file:bg-neutral-800"
                  />
                  <div className="mt-1 text-[11px] text-neutral-500">
                    Upload a product photo/screenshot (.jpg/.png).
                  </div>
                  {uploadedImageName && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-neutral-300">
                      <div>Selected: {uploadedImageName}</div>
                      <button
                        type="button"
                        onClick={clearUploadedProductImage}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-800"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-neutral-400">Label (optional)</div>
                  <input
                    type="text"
                    value={productLabel}
                    onChange={(e) => setProductLabel(e.target.value)}
                    placeholder="User Upload"
                    className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm outline-none focus:border-neutral-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={fetchAndNormalizeProductImage}
                  disabled={isIngesting || !hasProductImageInput}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    isIngesting
                      ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                      : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                  }`}
                >
                  {isIngesting ? "Fetching…" : "Fetch + Normalize"}
                </button>

                {ingestError && <div className="text-xs text-red-300">{ingestError}</div>}
              </div>

              {ingestedUserSku?.status === "ready" && (
                <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 p-2">
                  <div className="text-xs text-neutral-400">Normalized Preview</div>

                  {ingestedUserSku.variants?.[0] ? (
                    <div className="mt-2 aspect-[4/3] w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-900">
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- normalized preview is user-generated runtime content */}
                        <img
                          src={ingestedUserSku.variants[0]}
                          alt={ingestedUserSku.label}
                          className="h-full w-full object-contain"
                        />
                      </>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-md border border-dashed border-neutral-700 px-3 py-2 text-xs text-neutral-500">
                      No normalized image variant returned.
                    </div>
                  )}

                  <div className="mt-2 text-sm text-neutral-100">{ingestedUserSku.label}</div>
                  <div className="mt-0.5 text-xs text-neutral-500">Source: {ingestedSourceHost ?? "—"}</div>

                  <button
                    type="button"
                    onClick={addIngestedSkuToRoom}
                    disabled={hasIngestedSkuBeenAdded}
                    className={`mt-2 rounded-md border px-3 py-1.5 text-sm ${
                      hasIngestedSkuBeenAdded
                        ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-300"
                        : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                    }`}
                  >
                    {hasIngestedSkuBeenAdded ? "Added ✅" : "Add to Room"}
                  </button>

                  {hasIngestedSkuBeenAdded && (
                    <div className="mt-1 text-xs text-emerald-300">
                      Added to Stage 3 eligible items ✅
                    </div>
                  )}
                </div>
              )}

              {userSkusAddedToStage3.length > 0 && (
                <div className="mt-2 text-xs text-neutral-500">
                  {userSkusAddedToStage3.length} user item
                  {userSkusAddedToStage3.length === 1 ? "" : "s"} added for Stage 3.
                </div>
              )}
                </div>
              ) : null}
            </div>

            {/* Setup */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Setup</div>
                <button
                  type="button"
                  className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  aria-label={
                    isSetupCollapsed
                      ? "Expand Setup panel"
                      : "Collapse Setup panel"
                  }
                  aria-expanded={!isSetupCollapsed}
                  aria-controls="setup-panel-body"
                  onClick={() => setIsSetupCollapsed((prev) => !prev)}
                >
                  {isSetupCollapsed ? "▸" : "▾"}
                </button>
              </div>
              {!isSetupCollapsed ? (
                <div id="setup-panel-body">
                  <div className="mt-1 text-xs text-neutral-400">
                    Upload photo + (optional) room size + pick a collection. Bundle is selected on
                    Generate.
                  </div>

              {/* Base image upload */}
              <div className="mt-3">
                <div className="text-xs text-neutral-400">Room Photo</div>
                <div className="mt-1 flex items-center gap-2">
                  <label
                    className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                      isPreparingRoomPhotoUpload
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
                    }`}
                    title={
                      isOptimizingRoomImage
                        ? "Optimizing your image..."
                        : isUploading
                          ? "Uploading..."
                          : "Upload"
                    }
                  >
                    {isOptimizingRoomImage
                      ? "Optimizing your image..."
                      : isUploading
                        ? "Uploading…"
                        : "Upload…"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={isPreparingRoomPhotoUpload}
                      onChange={handleRoomPhotoInputChange}
                    />
                  </label>

                  {scene.baseImageUrl ? (
                    <button
                      className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                      onClick={() => {
                        const prev = scene.baseImageUrl;
                        if (prev?.startsWith("blob:")) {
                          try {
                            URL.revokeObjectURL(prev);
                          } catch {}
                        }
                        setBaseImageUrl(undefined);
                        setWorkingImageUrl(null);
                        setIsWorkingImageGenerated(false);
                        clearLegacyPlacementNodes();
                        setScenePlacements([]);
                        setPendingMyFurnitureReturnPreviewUrl(null);
                        clearPasteToPlaceProgressPreview();
                        clearPasteToPlaceMenuClipboardPreview();
                        clearPasteToPlaceUrlCandidatePreview();
                        clearAwaitingPasteToPlaceSession();
                        clearPasteEventClipboardImagePayload();
                        clearPasteToPlaceActiveSource("base_image_cleared");
                        lastObservedClipboardDataUrlHashRef.current = null;
                        lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
                        suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
                        setPendingFurnitureClipboardSuppressionHash(null);
                        pushSnack("Image cleared.");
                      }}
                      title="Clear image"
                    >
                      Clear
                    </button>
                  ) : (
                    <div className="text-xs text-neutral-500">No image yet</div>
                  )}
                </div>

                <div className="mt-2 text-xs text-neutral-500">
                  {scene.baseImageUrl?.startsWith("blob:")
                    ? "Source: Local preview (blob) — upload should swap to signed URL."
                    : scene.baseImageUrl
                    ? "Source: Signed URL (storage) ✅"
                    : "Source: —"}
                </div>
                {roomPhotoUploadError && (
                  <div className="mt-2 text-xs text-rose-300">{roomPhotoUploadError}</div>
                )}
              </div>

              {/* Viewport debug */}
              <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-400">
                <div className="flex items-center justify-between">
                  <div>Viewport</div>
                  <div className="text-neutral-300">
                    {viewport ? `${viewport.imageNaturalW}×${viewport.imageNaturalH}` : "—"}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div>Scale (stage px / image px)</div>
                  <div className="text-neutral-300">
                    {viewport ? viewport.scale.toFixed(3) : "—"}
                  </div>
                </div>
              </div>

              {/* Room dims */}
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-400">Room dimensions (optional)</div>
                  <div className="text-xs text-neutral-500">
                    Dimensions:{" "}
                    <span className="text-neutral-200">
                      {hasManualDims ? "Manual" : "Auto (estimated)"}
                    </span>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <div className="text-xs text-neutral-400">Width (ft)</div>
                    <input
                      className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-600"
                      type="number"
                      step="0.1"
                      value={scene.room?.dims?.widthFt ?? ""}
                      placeholder="Auto"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRoomDims({
                          widthFt: v === "" ? undefined : Number(v),
                          lengthFt: scene.room?.dims?.lengthFt,
                          heightFt: scene.room?.dims?.heightFt,
                        });
                      }}
                    />
                  </div>

                  <div className="col-span-1">
                    <div className="text-xs text-neutral-400">Length (ft)</div>
                    <input
                      className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-600"
                      type="number"
                      step="0.1"
                      value={scene.room?.dims?.lengthFt ?? ""}
                      placeholder="Auto"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRoomDims({
                          widthFt: scene.room?.dims?.widthFt,
                          lengthFt: v === "" ? undefined : Number(v),
                          heightFt: scene.room?.dims?.heightFt,
                        });
                      }}
                    />
                  </div>

                  <div className="col-span-1">
                    <div className="text-xs text-neutral-400">Height (ft)</div>
                    <input
                      className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-600"
                      type="number"
                      step="0.1"
                      value={scene.room?.dims?.heightFt ?? ""}
                      placeholder="Auto"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRoomDims({
                          widthFt: scene.room?.dims?.widthFt,
                          lengthFt: scene.room?.dims?.lengthFt,
                          heightFt: v === "" ? undefined : Number(v),
                        });
                      }}
                    />
                  </div>
                </div>

                <div className="mt-3 text-xs text-neutral-400">
                  Sqft:{" "}
                  <span className="text-neutral-200">
                    {hasManualDims ? sqft : "Auto (estimated)"}
                  </span>
                </div>

                {!hasManualDims && (
                  <div className="mt-1 text-xs text-neutral-500">
                    Leave blank for zero friction — Nano Banana will estimate.
                  </div>
                )}
              </div>

              {/* Furniture collection */}
              <div className="mt-4">
                <div className="text-xs text-neutral-400">Furniture Collection</div>
                <select
                  className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm outline-none focus:border-neutral-600"
                  value={scene.collection?.collectionId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCollection(id);
                    const col = MOCK_COLLECTIONS.find((c) => c.collectionId === id);
                    if (!col) {
                      setWorkingSet({
                        collectionId: id,
                        bundleId: undefined,
                        eligibleSkus: [],
                      });
                      return;
                    }

                    const bundleId: RoomSizeBundleId =
                      hasManualDims && typeof sqft === "number" ? pickBundleIdFromSqft(sqft) : "medium";

                    const skuIds = col.bundles[bundleId].skuIds;
                    const ppf = calibration?.ppf;

                    const eligible = skuIds
                      .map((skuId) => (col.catalog as Record<string, unknown>)[skuId])
                      .filter(Boolean)
                      .map((sku) => {
                        if (!isRecord(sku)) return null;

                        const skuId = safeStr(sku.skuId);
                        if (!skuId) return null;
                        const label = safeStr(sku.label) ?? skuId;
                        const realW = typeof sku.realWidthFt === "number" ? sku.realWidthFt : undefined;
                        const realD = typeof sku.realDepthFt === "number" ? sku.realDepthFt : undefined;
                        const defaultPxWidth =
                          typeof sku.defaultPxWidth === "number" ? sku.defaultPxWidth : 1;
                        const defaultPxHeight =
                          typeof sku.defaultPxHeight === "number" ? sku.defaultPxHeight : 1;
                        const pxW = ppf && realW ? Math.max(1, Math.round(realW * ppf)) : defaultPxWidth;
                        const pxH = ppf && realD ? Math.max(1, Math.round(realD * ppf)) : defaultPxHeight;

                        const fallbackImage =
                          safeStr(sku.imageUrl) ??
                          safeStr(sku.pngUrl) ??
                          safeStr(sku.url) ??
                          safeStr(sku.src) ??
                          "";
                        const variantsRaw = Array.isArray(sku.variants) ? sku.variants : [];
                        const variants =
                          variantsRaw.length > 0
                            ? variantsRaw
                                .map((variant) => {
                                  if (!isRecord(variant)) return null;
                                  return {
                                    variantId: safeStr(variant.variantId) ?? skuId,
                                    label: safeStr(variant.label) ?? label,
                                    imageUrl:
                                      safeStr(variant.imageUrl) ??
                                      safeStr(variant.pngUrl) ??
                                      safeStr(variant.url) ??
                                      safeStr(variant.src) ??
                                      fallbackImage,
                                  };
                                })
                                .filter((variant): variant is { variantId: string; label: string; imageUrl: string } =>
                                  Boolean(variant)
                                )
                            : [{ variantId: skuId, label, imageUrl: fallbackImage }];

                        return {
                          skuId,
                          label,
                          defaultPxWidth: pxW,
                          defaultPxHeight: pxH,
                          realWidthFt: realW,
                          realDepthFt: realD,
                          variants,
                        };
                      })
                      .filter((sku): sku is NonNullable<typeof sku> => sku !== null);

                    setWorkingSet({ collectionId: id, bundleId, eligibleSkus: eligible });
                    pushSnack("Collection selected. Working Set loaded — drag items onto the canvas.");
                  }}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {MOCK_COLLECTIONS.map((c) => (
                    <option key={c.collectionId} value={c.collectionId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 text-xs text-neutral-500">
                Bundle auto-selected on Generate{" "}
                {hasManualDims ? "by sqft." : "(defaults to Medium when dims are auto)."}
              </div>
                </div>
              ) : null}
            </div>

            {/* Calibration Panel */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Calibration</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    Tool C • Click 2 points on the photo, enter feet, Apply.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:bg-neutral-800"
                    onClick={() => {
                      setActiveTool("calibrate");
                      beginCalibration();
                      pushSnack("Calibration mode: click point 1 then point 2.");
                    }}
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                    aria-label={
                      isCalibrationCollapsed
                        ? "Expand Calibration panel"
                        : "Collapse Calibration panel"
                    }
                    aria-expanded={!isCalibrationCollapsed}
                    aria-controls="calibration-panel-body"
                    onClick={() => setIsCalibrationCollapsed((prev) => !prev)}
                  >
                    {isCalibrationCollapsed ? "▸" : "▾"}
                  </button>
                </div>
              </div>

              {!isCalibrationCollapsed ? (
                <div id="calibration-panel-body">
                  <div className="mt-3 text-xs text-neutral-500">
                    Current:{" "}
                    <span className="text-neutral-200">
                      {calibration?.ppf ? `${calibration.ppf.toFixed(2)} px/ft` : "—"}
                    </span>
                    {calibration?.method ? (
                      <span className="text-neutral-500"> • {calibration.method}</span>
                    ) : null}
                  </div>

                  {scene.calibration?.ppf ? (
                    <div className="mt-1 text-xs text-neutral-400">Drag defaults are scale-aware ✅</div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <div className="text-xs text-neutral-400">Real distance (ft)</div>
                      <input
                        className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-600"
                        type="number"
                        step="0.1"
                        value={calibration?.draft?.realFeet ?? 10}
                        onChange={(e) => setCalibrationRealFeet(Number(e.target.value || 0))}
                      />
                    </div>

                    <div className="col-span-1 flex items-end">
                      <button
                        disabled={!canApplyCal}
                        className={`w-full rounded-md border px-3 py-2 text-sm ${
                          canApplyCal
                            ? "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
                            : "border-neutral-900 bg-neutral-950 text-neutral-500"
                        }`}
                        onClick={() => {
                          const ok = finalizeCalibrationFromLine();
                          if (ok) pushSnack("Calibration applied.");
                          else pushSnack("Need 2 points + a valid feet value.");
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:bg-neutral-800"
                      onClick={() => {
                        clearCalibrationDraft();
                        pushSnack("Calibration points cleared.");
                      }}
                    >
                      Clear points
                    </button>
                    <button
                      className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:bg-neutral-800"
                      onClick={() => {
                        clearCalibrationLine();
                        pushSnack("Calibration reset.");
                      }}
                    >
                      Reset
                    </button>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800"
                      onClick={() => {
                        ensurePpfFromAssumption();
                        pushSnack("Calibration refreshed (V0 assumption).");
                      }}
                      title="Compute ppf from V0 assumption (requires manual room width)"
                    >
                      Refresh (assume)
                    </button>
                  </div>

                  {activeTool === "calibrate" && (
                    <div className="mt-3 rounded-md border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-100/90">
                      Calibration mode active — click point 1, then point 2.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
              </>
            ) : null}

            </div>
          </div>
        </aside>
      </div>

      {deleteVersionTarget ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (deletingVersionId) return;
            setDeleteVersionTarget(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-4 shadow-xl">
            <div className="text-lg font-semibold">Delete this version?</div>
            <div className="mt-2 text-sm text-neutral-300">This can’t be undone.</div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  deletingVersionId
                    ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                    : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                }`}
                disabled={Boolean(deletingVersionId)}
                onClick={() => setDeleteVersionTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  deletingVersionId
                    ? "cursor-not-allowed border-red-950 bg-red-950/20 text-red-300/60"
                    : "border-red-800 bg-red-900/30 text-red-100 hover:bg-red-900/45"
                }`}
                disabled={Boolean(deletingVersionId)}
                onClick={() => {
                  void handleConfirmDeleteVersion();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rescale Prompt Modal */}
      {rescalePrompt && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-[520px] rounded-xl border border-neutral-800 bg-neutral-950 p-4 shadow-xl">
            <div className="text-lg font-semibold">Update existing objects to new scale?</div>
            <div className="mt-2 text-sm text-neutral-300">
              Calibration changed by{" "}
              <span className="font-medium">{(rescalePrompt.ratio * 100).toFixed(1)}%</span>. You
              can rescale placed furniture to match the new calibration (positions stay centered).
            </div>

            <div className="mt-3 text-xs text-neutral-500">
              Prev: {rescalePrompt.prevPpf.toFixed(2)} px/ft • New:{" "}
              {rescalePrompt.nextPpf.toFixed(2)} px/ft
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={!!suppressRescalePrompt}
                onChange={(e) => setSuppressRescalePrompt(e.target.checked)}
              />
              Don’t ask again
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
                onClick={() => {
                  dismissRescalePrompt();
                  pushSnack("Kept existing objects unchanged.");
                }}
              >
                Not now
              </button>

              <button
                className="rounded-md border border-neutral-700 bg-neutral-100 px-3 py-2 text-sm text-neutral-900 hover:bg-white"
                onClick={() => {
                  confirmRescalePrompt();
                  pushSnack("Existing objects rescaled to new calibration.");
                }}
              >
                Rescale existing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Swap Modal */}
      {swapOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSwap();
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Swap Furniture</div>
                <div className="text-xs text-neutral-400">
                  Choose a replacement item or a new color/material.
                </div>
              </div>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800"
                onClick={closeSwap}
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto p-4">
              {swapTargetNode && (
                <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  <div className="text-sm font-medium">Selected item</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    {swapTargetNode.label} ({swapTargetNode.skuId})
                    {swapTargetNode.variant?.label ? ` — ${swapTargetNode.variant.label}` : ""}
                  </div>

                  {swapTargetSku && swapTargetSku.variants.length > 0 ? (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-neutral-300">
                        Swap color / material
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {swapTargetSku.variants.map((v) => (
                          <button
                            key={v.variantId}
                            className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left text-sm hover:bg-neutral-800"
                            onClick={() => {
                              if (!swapTargetId || !swapTargetSku) return;
                              applySwap(swapTargetId, {
                                skuId: swapTargetSku.skuId,
                                label: swapTargetSku.label,
                                variant: { variantId: v.variantId, label: v.label },
                              });
                              closeSwap();
                              pushSnack("Variant updated.");
                            }}
                          >
                            {v.label}
                            <div className="mt-0.5 text-xs text-neutral-400">{v.variantId}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-neutral-500">
                      No variants available for this item.
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs font-medium text-neutral-300">Swap to a different item</div>
              <button
                type="button"
                className={`mt-2 rounded-md border px-3 py-1.5 text-xs ${
                  myFurnitureLoading
                    ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                    : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                }`}
                disabled={myFurnitureLoading}
                onClick={() => {
                  closeSwap();
                  void openMyFurniturePicker("swap");
                }}
              >
                {myFurnitureLoading ? "Loading My Furniture..." : "My Furniture"}
              </button>

              {(() => {
                const isIkeaSwapTarget = !!swapTargetNode && isIkeaNode(swapTargetNode);
                const targetKindBucket = swapTargetNode ? nodeSwapKind(swapTargetNode) : null;

                const swapOptions: Array<{
                  skuId: string;
                  label: string;
                  defaultPxWidth: number;
                  defaultPxHeight: number;
                  vendor?: "IKEA_CA";
                  displayName?: string;
                  articleNumber?: string;
                  imageUrl?: string;
                  productUrl?: string;
                  dimsIn?: IkeaCaSku["dimsIn"];
                }> = isIkeaSwapTarget
                  ? targetKindBucket
                    ? IKEA_CA_SKUS.filter((s) => mapIkeaKindToBucket(s.kind as IkeaKind) === targetKindBucket).map(
                        (s) => {
                          const { wIn, dIn } = skuFootprintInchesFromDims(s.dimsIn);
                          return {
                            skuId: s.skuId,
                            label: s.displayName ?? s.skuId,
                            imageUrl: s.imageUrl,
                            articleNumber: s.articleNumber,
                            productUrl: s.productUrl,
                            vendor: s.vendor,
                            displayName: s.displayName,
                            dimsIn: s.dimsIn,
                            defaultPxWidth: Math.max(24, Math.round(wIn * DEFAULT_PX_PER_IN)),
                            defaultPxHeight: Math.max(24, Math.round(dIn * DEFAULT_PX_PER_IN)),
                          };
                        }
                      )
                    : []
                  : eligibleForDrag.length
                    ? eligibleForDrag
                        .map((x) =>
                          isRecord(x) && safeStr(x.skuId) && safeStr(x.label)
                            ? {
                                skuId: safeStr(x.skuId)!,
                                label: safeStr(x.label)!,
                                defaultPxWidth:
                                  typeof x.defaultPxWidth === "number" ? x.defaultPxWidth : 1,
                                defaultPxHeight:
                                  typeof x.defaultPxHeight === "number" ? x.defaultPxHeight : 1,
                              }
                            : null
                        )
                        .filter((x): x is NonNullable<typeof x> => x !== null)
                    : Object.values((collection?.catalog as Record<string, unknown>) ?? {})
                        .map((x) =>
                          isRecord(x) && safeStr(x.skuId) && safeStr(x.label)
                            ? {
                                skuId: safeStr(x.skuId)!,
                                label: safeStr(x.label)!,
                                defaultPxWidth:
                                  typeof x.defaultPxWidth === "number" ? x.defaultPxWidth : 1,
                                defaultPxHeight:
                                  typeof x.defaultPxHeight === "number" ? x.defaultPxHeight : 1,
                              }
                            : null
                        )
                        .filter((x): x is NonNullable<typeof x> => x !== null);

                return (
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {swapOptions.map((opt) => (
                      <button
                        key={opt.skuId}
                        className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 text-left hover:bg-neutral-800"
                        onClick={() => {
                          if (!swapTargetId) return;
                          applySwap(swapTargetId, {
                            skuId: opt.skuId,
                            label: opt.label,
                            defaultPxWidth: opt.defaultPxWidth,
                            defaultPxHeight: opt.defaultPxHeight,
                            vendor: opt.vendor,
                            displayName: opt.displayName,
                            articleNumber: opt.articleNumber,
                            imageUrl: opt.imageUrl,
                            productUrl: opt.productUrl,
                            dimsIn: opt.dimsIn,
                          });
                          closeSwap();
                          pushSnack("Item swapped.");
                        }}
                      >
                        <div className="flex items-center gap-3">
                          {opt.imageUrl ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element -- swap modal uses dynamic SKU image URLs and existing sizing behavior */}
                              <img
                                src={opt.imageUrl}
                                alt=""
                                className="h-12 w-12 rounded-md bg-neutral-800 object-cover"
                              />
                            </>
                          ) : null}
                          <div>
                            <div className="text-sm font-medium">{opt.label}</div>
                            <div className="mt-0.5 text-xs text-neutral-400">{opt.skuId}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <MyFurniturePicker
        open={myFurnitureOpen}
        mode={myFurnitureMode}
        items={myFurnitureItems}
        loading={myFurnitureLoading}
        selectingIds={myFurnitureSelectingIds}
        selectedItemIds={selectedMyFurnitureItemIds}
        onClose={closeMyFurniturePicker}
        onSelect={(item) => {
          void handleSelectMyFurnitureItem(item);
        }}
        onToggleSelectedItem={handleToggleSelectedMyFurnitureItem}
        onFinishSelection={(ids) => {
          void handleFinishMyFurnitureSelection(ids);
        }}
      />

      {/* Snackbars */}
      <SnackbarHost
        items={snacks}
        onRemove={(id) => setSnacks((prev) => prev.filter((s) => s.id !== id))}
      />
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-100">
          <div className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
              Loading editor workspace...
            </div>
          </div>
        </main>
      }
    >
      <EditorPageInner />
    </Suspense>
  );
}
