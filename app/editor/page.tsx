// app/editor/page.tsx
"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { EditorCanvas } from "@/components/editor/EditorCanvas";
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

import { getSupabaseBrowserAccessToken, supabaseBrowser } from "@/lib/supabaseBrowser";
import { useTokenBalance } from "@/hooks/useTokenBalance";

const DND_MIME = "application/x-roomprintz-furniture";
const USER_SKU_MAX_INPUT_BYTES = 12 * 1024 * 1024;
const VIBODE_MODEL_STORAGE_KEY = "vibode:modelVersion";
const FREE_PASTE_TO_PLACE_SESSION_KEY = "vibode:hasUsedFreePasteToPlace";
const PASTE_TO_PLACE_CLIPBOARD_HEADS_UP_SESSION_KEY = "vibode:pasteToPlaceClipboardHeadsUpShown";
const VIBODE_MODEL_NBP = "NBP";
const VIBODE_MODEL_NB2 = "NB2";
const ROOM_PREPARING_MESSAGE = "Your room is still preparing. Try again in a moment.";
const LOW_TOKEN_WARNING_THRESHOLD = 10;
const DEFAULT_ACTION_TOKEN_COST = 1;
const STAGE_TOKEN_COST = {
  1: 2,
  2: 2,
  3: 2,
  4: 4,
  5: 5,
} as const;
const EDIT_TOKEN_COST = {
  EDIT_SWAP: 1,
  EDIT_ROTATE: 1,
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

function isFiniteNumber(n: any) {
  return typeof n === "number" && Number.isFinite(n);
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeStr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isServerFetchableImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed);
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
type StageRunStatus = "idle" | "running" | "success" | "error";
type DeclutterMode = "off" | "light" | "heavy";
type VibodeModelVersion = typeof VIBODE_MODEL_NBP | typeof VIBODE_MODEL_NB2;
type VibodeAspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";
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
type PasteToPlacePreparedProduct = {
  source: "clipboard" | "my_furniture" | "product_url";
  skuId: string;
  eligibleSkus: VibodeEligibleSku[];
  savedFurnitureId?: string | null;
  sourceMeta?: {
    inputType: "url";
    domain: string | null;
    classification: null;
    confidence: null;
  };
};
type PreparedProductLike = PasteToPlacePreparedProduct;
type ActivePasteSource =
  | {
      type: "clipboard";
      skuId: string;
      preparedProduct: PreparedProductLike;
      rawPreviewUrl: string | null;
      normalizedPreviewUrl: string | null;
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
      clipboardDataUrlHash: null;
      activatedAt: number;
    }
  | {
      type: "product_url";
      skuId: string;
      furnitureId: string | null;
      preparedProduct: PreparedProductLike;
      rawPreviewUrl: string | null;
      normalizedPreviewUrl: string | null;
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

function getDomainFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const hostname = new URL(rawUrl).hostname.trim();
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}
type PasteToPlaceClipboardPreparationResult =
  | {
      status: "ready";
      source: Extract<ActivePasteSource, { type: "clipboard" }>;
    }
  | { status: "no-image" }
  | { status: "blocked" }
  | { status: "failed"; reason?: string };
type PasteToPlaceProductUrlIngestResponse = {
  status?: string;
  reason?: string;
  message?: string;
  error?: string;
  userSku?: Partial<UserSku> | null;
  savedFurniture?: unknown;
};
type PasteToPlaceProductUrlSaveResponse = {
  item?: {
    id?: unknown;
    user_sku_id?: unknown;
  } | null;
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
type PasteToPlaceMenuState = {
  xNorm: number;
  yNorm: number;
  anchorCssX: number;
  anchorCssY: number;
  anchorX?: number;
  anchorY?: number;
} | null;
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

const WORKFLOW_STAGES: WorkflowStage[] = [1, 2, 3, 4, 5];
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
    nodes?: Array<{ id?: unknown; skuId?: unknown; transform?: any }>;
  };
  if (!snap || typeof snap !== "object")
    return { ok: false, reason: "sceneSnapshotImageSpace missing" };
  if (!Array.isArray(snap.nodes))
    return { ok: false, reason: "sceneSnapshotImageSpace.nodes missing" };

  for (const n of snap.nodes) {
    if (!n?.id || !n?.skuId) return { ok: false, reason: "node missing id/skuId" };
    const t = n.transform;
    if (!t) return { ok: false, reason: `node ${n.id} missing transform` };
    const fields = ["x", "y", "width", "height", "rotation"];
    for (const f of fields) {
      if (!isFiniteNumber(t[f]))
        return { ok: false, reason: `node ${n.id} transform.${f} invalid` };
    }
    if (t.width <= 0 || t.height <= 0)
      return { ok: false, reason: `node ${n.id} width/height must be > 0` };
  }

  return { ok: true };
}

async function tryGetSupabaseAccessToken(): Promise<string | null> {
  try {
    return await getSupabaseBrowserAccessToken();
  } catch (err) {
    console.warn("[supabase] access token lookup threw:", err);
    return null;
  }
}

type VibodeRoomHydrationRow = {
  id: string;
  selected_model: string | null;
  current_stage: number | null;
  active_asset_id: string | null;
  base_asset_id: string | null;
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

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

async function loadRoomHydrationData(
  roomId: string,
  accessToken: string
): Promise<{ room: VibodeRoomHydrationRow; imageUrl: string | null; versions: VibodeRoomAsset[] }> {
  const client = supabaseBrowser();

  const { data: roomData, error: roomErr } = await client
    .from("vibode_rooms")
    .select("id,selected_model,current_stage,active_asset_id,base_asset_id")
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
  const requestedRoomPreviewUrl = parseRoomPreviewUrlFromSearch(
    searchParams.get("roomPreview") ?? searchParams.get("previewUrl")
  );
  const requestedRoomAspectRatio = parseRequestedRoomAspectRatioFromSearch(searchParams);
  const requestedPreviewAspectRatio = parseRequestedPreviewAspectRatioFromSearch(searchParams);
  const requestedInitialFrameAspectRatio = requestedRoomAspectRatio ?? requestedPreviewAspectRatio;
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
  const selectedNodeId = useEditorStore((s) => s.ui.selectedNodeId);
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
  const addNode = useEditorStore((s) => s.addNode);
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const selectNode = useEditorStore((s) => s.selectNode);
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
  const [isEditToolsCollapsed, setIsEditToolsCollapsed] = useState(false);
  const [isVersionsCollapsed, setIsVersionsCollapsed] = useState(false);
  const [isPasteProductImageCollapsed, setIsPasteProductImageCollapsed] = useState(false);
  const [isSetupCollapsed, setIsSetupCollapsed] = useState(false);
  const [isCalibrationCollapsed, setIsCalibrationCollapsed] = useState(false);
  const showObsoleteV0RightPanels = false;
  const [selectedModel, setSelectedModel] = useState<VibodeModelVersion>(VIBODE_MODEL_NBP);
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<VibodeRoomAsset | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const collapseAllRightPanels = () => {
    setIsVersionsCollapsed(true);
    setIsSetupCollapsed(true);
    setIsEditToolsCollapsed(true);
    setIsPasteProductImageCollapsed(true);
    setIsCalibrationCollapsed(true);
  };
  const expandAllRightPanels = () => {
    setIsVersionsCollapsed(false);
    setIsSetupCollapsed(false);
    setIsEditToolsCollapsed(false);
    setIsPasteProductImageCollapsed(false);
    setIsCalibrationCollapsed(false);
  };

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
  const [pasteToPlaceProductUrlInput, setPasteToPlaceProductUrlInput] = useState("");
  const [pasteToPlaceProgressCardState, setPasteToPlaceProgressCardState] =
    useState<PasteToPlaceMenuState>(null);
  const pasteToPlaceOperationIdRef = useRef(0);
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
  const [pendingMyFurnitureReturnPreviewUrl, setPendingMyFurnitureReturnPreviewUrl] = useState<
    string | null
  >(null);
  const [rotateToolState, setRotateToolState] = useState<RotateToolState>({
    marker: null,
    direction: "cw",
    amountDegrees: 15,
  });
  const [isRotateMarkerTargeting, setIsRotateMarkerTargeting] = useState(false);
  const [editWarning, setEditWarning] = useState<string | null>(null);
  const [isEditRunning, setIsEditRunning] = useState(false);
  const [removeMarkerPosition, setRemoveMarkerPosition] = useState<PasteToPlaceClickHint | null>(null);
  const [isRemoveMarkerTargeting, setIsRemoveMarkerTargeting] = useState(false);
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
  useEffect(() => {
    requestedRoomIdRef.current = requestedRoomId;
  }, [requestedRoomId]);
  useEffect(() => {
    vibodeRoomIdRef.current = vibodeRoomId;
  }, [vibodeRoomId]);
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
    setIsPasteToPlaceMenuIngesting(false);
  }, [invalidatePasteToPlaceOperation]);
  const clearPasteToPlaceMenuClipboardPreview = useCallback(() => {
    pasteToPlaceMenuClipboardPreviewTokenRef.current += 1;
    setPasteToPlaceMenuClipboardPreviewUrl(null);
    setIsPasteToPlaceMenuClipboardPreviewLoading(false);
  }, []);

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
    clearPasteToPlaceActiveSource("workflow_reset");
    lastObservedClipboardDataUrlHashRef.current = null;
    lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
    suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
    setPendingFurnitureClipboardSuppressionHash(null);
    setActiveStage(1);
    setVibodeRoomId(null);
    setRoomBaseAssetId(null);
    clearPendingLocal();
  }, [
    clearPasteToPlaceActiveSource,
    clearPasteToPlaceMenuClipboardPreview,
    clearPasteToPlaceProgressPreview,
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
      } catch (err: any) {
        setMyFurnitureItems([]);
        const message =
          err?.message === "No Supabase session."
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
    if (!requestedRoomId) {
      if (!hasAppliedBlankEditorResetRef.current) {
        resetEditorToBlankState();
        hasAppliedBlankEditorResetRef.current = true;
      }
      return;
    }
    hasAppliedBlankEditorResetRef.current = false;
    shouldSkipPendingRestoreRef.current = true;
    if (hydratedRoomIdRef.current === requestedRoomId) {
      setIsRoomHydrating(false);
      return;
    }

    if (inFlightRoomHydrationRoomIdRef.current === requestedRoomId) {
      return;
    }

    inFlightRoomHydrationRoomIdRef.current = requestedRoomId;
    const roomOpenSessionId = roomOpenSessionRef.current + 1;
    roomOpenSessionRef.current = roomOpenSessionId;
    let cancelled = false;
    const isRoomOpenSessionActive = () =>
      !cancelled && roomOpenSessionRef.current === roomOpenSessionId;
    const clearInFlightHydrationFlag = () => {
      if (
        roomOpenSessionRef.current === roomOpenSessionId &&
        inFlightRoomHydrationRoomIdRef.current === requestedRoomId
      ) {
        inFlightRoomHydrationRoomIdRef.current = null;
      }
    };

    const hydrateFromRoom = async () => {
      let didApplyHydratedRoom = false;
      const roomOpenPreviewUrl = requestedRoomPreviewUrl;
      const initialFrameAspectRatio = requestedInitialFrameAspectRatio;
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
      logEditorRoomOpen("roomHydration:start", { requestedRoomId });
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
            requestedRoomId,
            error: "no-access-token",
          });
          hydratedRoomIdRef.current = null;
          pushSnack("Your session expired. Redirecting to sign in...");
          router.push(`/login?next=${encodeURIComponent(`/editor?roomId=${requestedRoomId}`)}`);
          return;
        }

        const hydrated = await loadRoomHydrationData(requestedRoomId, accessToken);
        if (!isRoomOpenSessionActive()) {
          return;
        }

        const hydratedActiveVersion =
          hydrated.versions.find((asset) => asset.id === hydrated.room.active_asset_id) ??
          hydrated.versions.find((asset) => asset.is_active) ??
          hydrated.versions[0] ??
          null;
        const hydratedImageUrl = hydrated.imageUrl ?? hydratedActiveVersion?.image_url ?? null;

        if (!hydratedImageUrl) {
          logEditorRoomOpen("roomHydration:failed", {
            requestedRoomId,
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
        setVersions(hydrated.versions);
        setActiveAssetId(hydrated.room.active_asset_id ?? null);
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
        hydratedRoomIdRef.current = requestedRoomId;
        didApplyHydratedRoom = true;
        setIsRoomHydrating(false);
        logEditorRoomOpen("roomHydration:finish", {
          requestedRoomId,
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
      } catch (err: any) {
        if (!isRoomOpenSessionActive()) {
          return;
        }
        logEditorRoomOpen("roomHydration:failed", {
          requestedRoomId,
          error: err?.message ?? "error",
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
    pushSnack,
    requestedInitialFrameAspectRatio,
    requestedRoomId,
    requestedRoomPreviewUrl,
    resetEditorToBlankState,
    resetWorkflowForIncomingImage,
    router,
    setActiveAssetId,
    setBaseImageUrl,
    setVersions,
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
        clipboardDataUrlHash: null,
        activatedAt: Date.now(),
      }, "my_furniture_selected");
    },
    [
      activatePasteToPlaceSource,
      clearPasteToPlaceMenuClipboardPreview,
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
  const currentImageWinner = !isRequestedRoomSessionActive
    ? "sessionInactive"
    : workingImageUrl
      ? "workingImageUrl"
      : activeStageOutputImageUrl
        ? "activeStageOutputImageUrl"
        : scene.baseImageUrl
          ? "scene.baseImageUrl"
          : "none";
  const currentImageUrl =
    isRequestedRoomSessionActive
      ? workingImageUrl ?? activeStageOutputImageUrl ?? scene.baseImageUrl ?? null
      : null;
  const previewImageWinner = shouldPreferRoomOpenBridge
    ? "roomOpenBridgeImageUrl"
    : currentImageUrl
      ? currentImageWinner
      : roomOpenBridgeImageUrl
        ? "roomOpenBridgeImageUrl:fallback"
        : "none";
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
  const isOpeningExistingRoom = Boolean(requestedRoomId);
  const shouldShowUploadOverlay = isCanvasEmpty && !isOpeningExistingRoom;
  const activePasteSourcePreviewUrl = activePasteSource
    ? activePasteSource.type === "my_furniture"
      ? activePasteSource.rawPreviewUrl ?? activePasteSource.normalizedPreviewUrl
      : activePasteSource.normalizedPreviewUrl ?? activePasteSource.rawPreviewUrl
    : null;
  const shouldHideAuthoritativeMyFurniturePreviewDuringClipboardProbe =
    activePasteSource?.type === "my_furniture" &&
    !pasteToPlaceMenuClipboardPreviewUrl &&
    isPasteToPlaceMenuClipboardPreviewLoading;
  const pasteToPlaceDisplayedPreviewUrl =
    pendingMyFurnitureReturnPreviewUrl ??
    (shouldHideAuthoritativeMyFurniturePreviewDuringClipboardProbe
      ? null
      : (pasteToPlaceMenuClipboardPreviewUrl ?? activePasteSourcePreviewUrl));
  const isMyFurnitureMultiPreparedSource =
    activePasteSource?.type === "my_furniture" && activePasteSource.selectionCount > 1;
  const myFurniturePreparedSelectionCount =
    activePasteSource?.type === "my_furniture" ? activePasteSource.selectionCount : 0;
  const myFurniturePreparedSelectedPreviewUrls =
    activePasteSource?.type === "my_furniture" ? activePasteSource.selectedPreviewUrls : [];
  const productUrlPreparedDisplayName =
    activePasteSource?.type === "product_url" ? activePasteSource.displayName : null;
  const productUrlPreparedSupplier =
    activePasteSource?.type === "product_url" ? activePasteSource.supplier : null;
  const productUrlPreparedSourceUrl =
    activePasteSource?.type === "product_url" ? activePasteSource.sourceUrl : null;
  const selectedVersionId =
    activeAssetId ?? versions.find((asset) => asset.is_active)?.id ?? null;
  const selectedVersion = useMemo(
    () => versions.find((asset) => asset.id === selectedVersionId) ?? null,
    [selectedVersionId, versions]
  );
  const activeVersionMetadataPlacements = useMemo(
    () => extractScenePlacementsFromUnknown(selectedVersion?.metadata),
    [selectedVersion?.id, selectedVersion?.metadata]
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
    (_placements: ScenePlacement[]) => {
      // Legacy placement->node hydration is intentionally disabled.
      clearLegacyPlacementNodes();
    },
    [clearLegacyPlacementNodes]
  );
  const originalVersion = useMemo(() => {
    if (roomBaseAssetId) {
      const byRoomBaseId = versions.find((asset) => asset.id === roomBaseAssetId);
      if (byRoomBaseId) return byRoomBaseId;
    }
    return versions.find((asset) => asset.asset_type !== "stage_output") ?? null;
  }, [roomBaseAssetId, versions]);
  const nonOriginalVersions = useMemo(() => {
    const originalId = originalVersion?.id ?? null;
    const sorted = versions
      .filter((asset) => asset.id !== originalId)
      .slice()
      .sort((a, b) => {
        const aMs = Date.parse(a.created_at);
        const bMs = Date.parse(b.created_at);
        const safeA = Number.isFinite(aMs) ? aMs : 0;
        const safeB = Number.isFinite(bMs) ? bMs : 0;
        return safeB - safeA;
      });
    return sorted;
  }, [originalVersion?.id, versions]);
  const groupedVersions = useMemo(() => {
    const today: VibodeRoomAsset[] = [];
    const thisMonth: VibodeRoomAsset[] = [];
    const earlier: VibodeRoomAsset[] = [];
    const now = new Date();

    for (const version of nonOriginalVersions) {
      const created = new Date(version.created_at);
      if (Number.isNaN(created.getTime())) {
        earlier.push(version);
        continue;
      }
      if (isSameLocalDay(created, now)) {
        today.push(version);
      } else if (isSameLocalMonth(created, now)) {
        thisMonth.push(version);
      } else {
        earlier.push(version);
      }
    }

    return { today, thisMonth, earlier };
  }, [nonOriginalVersions]);
  const canDeleteVersions = versions.length > 1;

  const applyVersionToEditorState = useCallback(
    (asset: VibodeRoomAsset, sourceVersions: VibodeRoomAsset[]) => {
      const nextUrl = typeof asset.image_url === "string" ? asset.image_url.trim() : "";
      if (!nextUrl) return false;
      const versionPlacements = extractScenePlacementsFromUnknown(asset.metadata);

      clearPasteToPlaceProgressPreview();
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

  const isImageFile = (file: File | null | undefined) =>
    !!file && typeof file.type === "string" && file.type.startsWith("image/");

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
      pushSnack("Please choose an image file.");
      return;
    }

    resetWorkflowForIncomingImage();

    // 1) Instant preview (blob)
    setBaseImageFromFile(file);
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
        file,
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
      if (up.vibodeRoomId) {
        const latestVersions = await refreshRoomVersions(up.vibodeRoomId);
        const baseAsset = latestVersions?.find((asset) => asset.asset_type === "base") ?? null;
        const activeAsset = latestVersions?.find((asset) => asset.is_active) ?? null;
        setRoomBaseAssetId(baseAsset?.id ?? null);
        setActiveAssetId(activeAsset?.id ?? baseAsset?.id ?? null);
      }
      pushSnack("Room photo uploaded.");
    } catch (err: any) {
      console.error(err);
      setVibodeRoomId(null);
      setRoomBaseAssetId(null);
      pushSnack("Upload didn't finish. Keeping your local preview for now.");
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

  const handleCanvasDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
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
    } catch (err: any) {
      const message =
        typeof err?.message === "string" && err.message.trim().length > 0
          ? `Download failed. ${err.message}`
          : "Download failed. Please try again.";
      console.warn("[download-preview] failed", err);
      pushSnack(message);
    } finally {
      setIsDownloading(false);
    }
  };

  const hasActiveRemoveMarker = Boolean(removeMarkerPosition);
  const hasActiveRotateMarker = Boolean(rotateToolState.marker);

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
    return (collection.catalog as any)[swapTargetNode.skuId] ?? null;
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
  const {
    totalCount,
    activeCount,
    userCount,
    activeUserCount,
    catalogCount,
    activeCatalogCount,
  } = useMemo(() => {
    let active = 0;
    let user = 0;
    let activeUser = 0;
    let catalog = 0;
    let activeCatalog = 0;
    for (const item of stage3SkuItems) {
      if (item.active) active += 1;
      if (item.source === "user") {
        user += 1;
        if (item.active) activeUser += 1;
      } else {
        catalog += 1;
        if (item.active) activeCatalog += 1;
      }
    }
    return {
      totalCount: stage3SkuItems.length,
      activeCount: active,
      userCount: user,
      activeUserCount: activeUser,
      catalogCount: catalog,
      activeCatalogCount: activeCatalog,
    };
  }, [stage3SkuItems]);

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
    } catch (err: any) {
      setIngestError(err?.message ?? "Failed to normalize image.");
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

  const toggleStage3SkuItemActive = (skuId: string, active: boolean) => {
    setStage3SkuItems((prev) =>
      prev.map((item) => (item.skuId === skuId ? { ...item, active } : item))
    );
  };

  const moveStage3SkuItem = (index: number, direction: "up" | "down") => {
    setStage3SkuItems((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
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
    } catch (err: any) {
      setUploadedImageDataUrl(null);
      setUploadedImageName(null);
      setIngestedUserSku(null);
      setIngestError(err?.message ?? "Failed to read uploaded image.");
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
    const eligibleIds = new Set((eligibleForDrag ?? []).map((item: any) => item.skuId));
    const preferred = IKEA_CA_SKUS.filter((sku) => eligibleIds.has(sku.skuId));
    const source = preferred.length > 0 ? preferred : IKEA_CA_SKUS;
    return source.slice(0, 12);
  }, [eligibleForDrag]);
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
  const vibeMode = scene.vibeMode ?? "off";

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
    }
  ) => {
    if (isOutOfTokens) {
      pushSnack("You're out of tokens.");
      return null;
    }
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
      });

      const json: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          json?.error || json?.message || json?.detail || `Stage ${stageNumber} failed.`
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
      lifecycle?.onImageCommitted?.(nextImageUrl);
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
        setActiveAssetId(activeAsset?.id ?? latestVersions?.[0]?.id ?? null);
      }

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
    } catch (err: any) {
      setStageStatus((prev) => ({ ...prev, [stageNumber]: "error" }));
      if (err?.message) {
        pushSnack(err.message);
      } else if (stageNumber === 4) {
        pushSnack(`Stage 4 ${STAGE4_ACTION_LABELS[stage4ActionForRun]} failed.`);
      } else {
        pushSnack(`Stage ${stageNumber} failed.`);
      }
      return null;
    } finally {
      if (stageNumber === 4) {
        setStage4RunningAction(null);
      }
    }
  };

  const runEdit = async (
    action: EditAction,
    payloadParts: Partial<VibodeEditRunRequest> = {},
    lifecycle?: {
      onImageCommitted?: (response: VibodeEditRunResponse) => void;
      beforeCommit?: () => boolean;
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
        normalizedParams = { xNorm, yNorm, x: xNorm, y: yNorm };
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
      };

      const res = await fetch("/api/vibode/edit-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => ({}))) as Partial<VibodeEditRunResponse> & {
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(json.error || json.message || `Edit run failed (HTTP ${res.status})`);
      }
      if (typeof json.imageUrl !== "string" || json.imageUrl.trim().length === 0) {
        throw new Error("Edit run response missing imageUrl.");
      }

      if (lifecycle?.beforeCommit && !lifecycle.beforeCommit()) {
        return null;
      }
      setWorkingImageUrl(json.imageUrl);
      setIsWorkingImageGenerated(true);
      setBaseImageUrl(json.imageUrl);
      if (Array.isArray(json.placements)) {
        setScenePlacements(json.placements);
        hydrateSceneNodesFromPlacements(json.placements);
      }
      if (vibodeRoomId) {
        const latestVersions = await refreshRoomVersions(vibodeRoomId);
        if (lifecycle?.beforeCommit && !lifecycle.beforeCommit()) {
          return null;
        }
        const responseImageUrl = json.imageUrl.trim();
        const matchingVersion =
          latestVersions?.find((asset) => asset.image_url === responseImageUrl) ??
          latestVersions?.find((asset) => asset.preview_url === responseImageUrl) ??
          null;
        if (matchingVersion) {
          setActiveAssetId(matchingVersion.id);
        }
      }
      clearLegacyPlacementNodes();
      lifecycle?.onImageCommitted?.(json as VibodeEditRunResponse);
      const tokenUsageMessage = buildTokenUsageMessage(json);
      pushSnack(`Applied ${action}. ${tokenUsageMessage}.`);
      notifyTokenBalanceChanged();
      return json as VibodeEditRunResponse;
    } catch (err: any) {
      const message = err?.message ?? `Failed to ${action}.`;
      setEditWarning(message);
      console.warn("[edit-run] failed", { action, message, err });
      pushSnack(message);
      return null;
    } finally {
      setIsEditRunning(false);
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
      ingestSource = "clipboard",
    }: {
      imageBase64: string;
      ingestSource?: "clipboard" | "product_url" | "upload";
    }): Promise<{ userSku: UserSku; savedFurnitureId: string | null } | null> => {
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        const res = await fetch("/api/vibode/user-skus/ingest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-roomprintz-ingest-source": ingestSource,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            imageBase64,
            label: "Pasted Product",
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
        if (isRecord(json.savedFurniture)) {
          const maybeId = (json.savedFurniture as Record<string, unknown>).id;
          if (typeof maybeId === "string" && maybeId.trim().length > 0) {
            savedFurnitureId = maybeId;
          }
          pushSnack("Saved to My Furniture ✓");
        }
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
    }: PasteToPlaceClickHint & {
      operationId?: number;
      trigger?: "menu_open_refresh" | "explicit_refresh" | "explicit_paste_flow";
    }): Promise<PasteToPlaceClipboardPreparationResult> => {
      const isOperationStale = (context: string): boolean => {
        if (typeof operationId !== "number") return false;
        if (isPasteToPlaceOperationActive(operationId)) return false;
        return true;
      };

      if (isOperationStale("clipboard_prepare:start")) {
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      if (!hasShownPasteToPlaceClipboardHeadsUp) {
        pushSnack(
          "Paste-to-Place needs clipboard access to read your copied product image. If your browser asks, click Allow."
        );
        markPasteToPlaceClipboardHeadsUpShown();
      }

      const requestId = safeId("ptp_req");
      setPasteToPlaceStatus("reading");
      const clipboardReadResult = await readClipboardImageWithStatus();
      if (isOperationStale("clipboard_prepare:after_read")) {
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

      if (!canUseFreePasteToPlace) {
        pushSnack("Free preview used — unlock more placements to keep Viboding.");
        setPasteToPlaceStatus(null);
        return { status: "blocked" };
      }

      const clipboardDataUrl = await blobToDataUrl(clipboardImage.blob);
      if (isOperationStale("clipboard_prepare:after_data_url")) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      if (!clipboardDataUrl || !clipboardDataUrl.startsWith("data:image/")) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-data-url-unavailable" };
      }
      const clipboardDataUrlHash = hashDataUrlForLogs(clipboardDataUrl);
      if (!clipboardDataUrlHash) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-hash-unavailable" };
      }

      const currentSource = activePasteSourceRef.current;
      const hasSeenClipboardHashBefore =
        lastObservedClipboardDataUrlHashRef.current === clipboardDataUrlHash;
      if (
        hasSeenClipboardHashBefore ||
        (currentSource?.type === "clipboard" &&
          currentSource.clipboardDataUrlHash === clipboardDataUrlHash)
      ) {
        setPasteToPlaceStatus(null);
        return { status: "failed", reason: "clipboard-source-unchanged" };
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
        rawPreviewUrl: clipboardDataUrl,
        normalizedPreviewUrl,
        clipboardDataUrlHash,
        requestId,
        activatedAt: Date.now(),
      };
      activatePasteToPlaceSource(source, "clipboard_ingest_success", requestId);
      lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
      suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
      setPendingFurnitureClipboardSuppressionHash(null);
      clearPasteToPlaceMenuClipboardPreview();
      lastObservedClipboardDataUrlHashRef.current = clipboardDataUrlHash;
      setPasteToPlaceStatus(null);
      return {
        status: "ready",
        source,
      };
    },
    [
      activatePasteToPlaceSource,
      canUseFreePasteToPlace,
      clearPasteToPlaceMenuClipboardPreview,
      hasShownPasteToPlaceClipboardHeadsUp,
      ingestClipboardUserSku,
      isPasteToPlaceOperationActive,
      markPasteToPlaceClipboardHeadsUpShown,
      pushSnack,
      stage3SkuItemsActive,
    ]
  );

  const preparePasteToPlaceProductUrlSource = useCallback(async (): Promise<void> => {
    const normalizedUrl = normalizeLikelyUrl(pasteToPlaceProductUrlInput);
    if (!normalizedUrl) {
      pushSnack("Paste a valid product URL first.");
      return;
    }
    if (!canUseFreePasteToPlace) {
      pushSnack("Free preview used — unlock more placements to keep Viboding.");
      return;
    }

    setPasteToPlaceStatus("preparing");
    setIsPasteToPlaceMenuIngesting(true);

    try {
      const accessToken = await tryGetSupabaseAccessToken();
      const res = await fetch("/api/vibode/user-skus/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-roomprintz-ingest-source": "product_url",
          "x-roomprintz-skip-my-furniture-autosave": "1",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          imageUrl: normalizedUrl,
          sourceType: "product_url",
          label: "Pasted Product",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as PasteToPlaceProductUrlIngestResponse;
      if (!res.ok) {
        pushSnack(
          "We couldn't prepare that product link. Try copying the product image instead."
        );
        return;
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
      const variants = rawVariants
        .map((variant) => {
          if (typeof variant === "string" && variant.trim().length > 0) return variant;
          if (isRecord(variant) && typeof variant.imageUrl === "string" && variant.imageUrl.trim().length > 0) {
            return variant.imageUrl;
          }
          return null;
        })
        .filter((variant): variant is string => Boolean(variant));
      const userSkuId =
        typeof userSku?.skuId === "string" && userSku.skuId.trim().length > 0
          ? userSku.skuId.trim()
          : null;
      const failureReason =
        ingestStatus === "failed"
          ? failureReasonFromPayload ?? "ingest-status-failed"
          : !userSku
            ? "missing-userSku"
            : userSku.status === "failed"
              ? userSku.reason ?? "userSku-status-failed"
              : userSku.status !== "ready"
                ? `invalid-userSku-status:${String(userSku.status)}`
                : !userSkuId
                  ? "missing-skuId"
                  : variants.length === 0
                    ? "empty-variants"
                    : null;
      if (failureReason || !userSkuId) {
        pushSnack(
          "We couldn't prepare that product link. Try copying the product image instead."
        );
        return;
      }
      const readyUserSku = userSku as UserSku;
      // Product URL source replaces clipboard provisional previews immediately.
      lastSurfacedProvisionalClipboardPreviewHashRef.current = null;
      suppressedPasteToPlaceMenuClipboardPreviewHashRef.current = null;
      setPendingFurnitureClipboardSuppressionHash(null);

      const normalizedPreviewUrl =
        variants.find(
          (imageUrl): imageUrl is string =>
            typeof imageUrl === "string" && imageUrl.trim().length > 0
        ) ??
        null;
      if (!normalizedPreviewUrl) {
        pushSnack(
          "We couldn't prepare that product link. Try copying the product image instead."
        );
        return;
      }

      const sourceUrl =
        typeof readyUserSku.sourceUrl === "string" && readyUserSku.sourceUrl.trim().length > 0
          ? readyUserSku.sourceUrl
          : normalizedUrl;
      const domain = getDomainFromUrl(sourceUrl);
      const supplier = domain;
      const displayName =
        typeof readyUserSku.label === "string" && readyUserSku.label.trim().length > 0
          ? readyUserSku.label.trim()
          : "Pasted Product";
      const productUrlEligibleSku: VibodeEligibleSku = {
        skuId: userSkuId,
        label: displayName,
        source: "user",
        variants: variants.map((imageUrl) => ({ imageUrl })),
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
        skuId: preparedProduct.skuId,
        furnitureId: null,
        preparedProduct,
        rawPreviewUrl: null,
        normalizedPreviewUrl,
        displayName,
        supplier,
        domain,
        sourceUrl,
        userSkuId,
        clipboardDataUrlHash: null,
        activatedAt: Date.now(),
      };

      activatePasteToPlaceSource(nextSource, "product_url_prepare_success");
      clearPasteToPlaceMenuClipboardPreview();
      setPasteToPlaceProductUrlInput("");
      pushSnack("Product link ready. Click in your room to place it.");
    } catch {
      pushSnack(
        "We couldn't prepare that product link. Try copying the product image instead."
      );
    } finally {
      setPasteToPlaceStatus(null);
      setIsPasteToPlaceMenuIngesting(false);
    }
  }, [
    activatePasteToPlaceSource,
    canUseFreePasteToPlace,
    clearPasteToPlaceMenuClipboardPreview,
    pasteToPlaceProductUrlInput,
    pushSnack,
    stage3SkuItemsActive,
  ]);

  const savePreparedProductUrlToMyFurniture = useCallback(
    async (source: Extract<ActivePasteSource, { type: "product_url" }>): Promise<string | null> => {
      if (source.preparedProduct.savedFurnitureId) {
        return source.preparedProduct.savedFurnitureId;
      }
      try {
        const accessToken = await tryGetSupabaseAccessToken();
        const res = await fetch("/api/vibode/my-furniture/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-roomprintz-ingest-source": "product_url",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            userSkuId: source.userSkuId,
            sourceType: "product_url",
            sourceUrl: source.sourceUrl,
            displayName: source.displayName,
            previewImageUrl: source.normalizedPreviewUrl,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as PasteToPlaceProductUrlSaveResponse;
        if (!res.ok) {
          return null;
        }
        const item = isRecord(json.item) ? json.item : null;
        const savedFurnitureId =
          item && typeof item.id === "string" && item.id.trim().length > 0 ? item.id : null;
        if (!savedFurnitureId) {
          return null;
        }
        const currentSource = activePasteSourceRef.current;
        if (
          currentSource?.type === "product_url" &&
          currentSource.userSkuId === source.userSkuId &&
          !currentSource.preparedProduct.savedFurnitureId
        ) {
          activatePasteToPlaceSource(
            {
              ...currentSource,
              furnitureId: savedFurnitureId,
              preparedProduct: {
                ...currentSource.preparedProduct,
                savedFurnitureId,
              },
            },
            "product_url_saved_after_placement"
          );
        }
        return savedFurnitureId;
      } catch {
        return null;
      }
    },
    [activatePasteToPlaceSource]
  );

  const runPasteToPlaceClickTargetEdit = useCallback(
    async ({
      action,
      xNorm,
      yNorm,
      preparedResult,
      operationId,
    }: PasteToPlaceClickHint & {
      action: "add" | "swap";
      preparedResult?: PasteToPlaceMenuPreparationResult;
      operationId?: number;
    }): Promise<boolean> => {
      const isOperationStale = (context: string): boolean => {
        if (typeof operationId !== "number") return false;
        if (isPasteToPlaceOperationActive(operationId)) return false;
        return true;
      };
      if (isOperationStale("execute:start")) return false;
      if (
        activeTool === "calibrate" ||
        activeTool === "remove" ||
        activeTool === "swap" ||
        activeTool === "rotate" ||
        isRotateMarkerTargeting
      ) {
        return false;
      }
      if (!isBaseImageEditReady) {
        pushSnack(ROOM_PREPARING_MESSAGE);
        return true;
      }
      if (isBusy || isEditRunning) return false;

      if (preparedResult && preparedResult.status === "no-image") {
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreview();
        return false;
      }
      if (preparedResult && preparedResult.status === "blocked") {
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreview();
        return true;
      }
      if (preparedResult && preparedResult.status === "failed") {
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreview();
        return true;
      }

      const resolvedSource =
        preparedResult && preparedResult.status === "ready"
          ? preparedResult.source
          : activePasteSourceRef.current;
      if (!resolvedSource) {
        pushSnack("Copy a product image, paste a product link, or choose an item from My Furniture first.");
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreview();
        return true;
      }

      try {
        if (isOperationStale("execute:before_edit_run")) return false;
        setPasteToPlaceStatus("placing");
        const res = await runEdit(
          action,
          {
            target: { skuId: resolvedSource.skuId },
            params: { x: xNorm, y: yNorm },
            eligibleSkus: resolvedSource.preparedProduct.eligibleSkus,
            placements: scenePlacements,
          },
          {
            beforeCommit: () => !isOperationStale("execute:before_commit"),
            onImageCommitted: () => {
              if (isOperationStale("execute:on_image_committed")) return;
              setPasteToPlaceStatus(null);
              clearPasteToPlaceProgressPreview();
            },
          }
        );
        if (isOperationStale("execute:after_edit_run")) return false;
        if (!res) {
          return true;
        }

        let savedFurnitureId = resolvedSource.preparedProduct.savedFurnitureId ?? null;
        if (resolvedSource.type === "product_url" && !savedFurnitureId) {
          const persistedFurnitureId = await savePreparedProductUrlToMyFurniture(resolvedSource);
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
        if (!isDevUnlockPasteToPlace) {
          setHasUsedFreePasteToPlace(true);
        }
        return true;
      } finally {
        if (!isOperationStale("execute:finally")) {
          setPasteToPlaceStatus(null);
          clearPasteToPlaceProgressPreview();
        }
      }
    },
    [
      activeTool,
      clearPasteToPlaceProgressPreview,
      isBaseImageEditReady,
      isBusy,
      isDevUnlockPasteToPlace,
      isEditRunning,
      isPasteToPlaceOperationActive,
      isRotateMarkerTargeting,
      pushSnack,
      runEdit,
      savePreparedProductUrlToMyFurniture,
      scenePlacements,
      trackMyFurnitureUsage,
    ]
  );

  const handlePasteToPlaceAdd = useCallback(
    async ({
      xNorm,
      yNorm,
      preparedResult,
      operationId,
    }: PasteToPlaceClickHint & {
      preparedResult?: PasteToPlaceMenuPreparationResult;
      operationId?: number;
    }): Promise<boolean> =>
      runPasteToPlaceClickTargetEdit({
        action: "add",
        xNorm,
        yNorm,
        preparedResult,
        operationId,
      }),
    [runPasteToPlaceClickTargetEdit]
  );

  const openPasteToPlaceMenu = useCallback(
    async (state: NonNullable<PasteToPlaceMenuState>) => {
      if (isRemoveMarkerTargeting || isRotateMarkerTargeting) {
        return;
      }
      if (pasteToPlaceStatus || isPasteToPlaceMenuIngesting || pasteToPlaceProgressCardState) {
        return;
      }
      beginPasteToPlaceOperation();
      setPasteToPlaceProgressCardState(null);
      setPasteToPlaceMenuState({
        ...state,
        anchorX: state.anchorX ?? state.xNorm,
        anchorY: state.anchorY ?? state.yNorm,
      });
      setIsPasteToPlaceMenuIngesting(false);
      const currentSource = activePasteSourceRef.current;
      if (currentSource?.type === "product_url") {
        clearPasteToPlaceMenuClipboardPreview();
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
          setPasteToPlaceMenuClipboardPreviewUrl(null);
          return;
        }
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
      clearPasteToPlaceMenuClipboardPreview,
      isRemoveMarkerTargeting,
      isRotateMarkerTargeting,
      isPasteToPlaceMenuIngesting,
      pasteToPlaceStatus,
      pasteToPlaceProgressCardState,
    ]
  );

  const dismissPasteToPlaceMenu = useCallback(
    (options?: { clearPreview?: boolean; clearClipboardPreview?: boolean }) => {
      const clearPreview = options?.clearPreview ?? true;
      const clearClipboardPreview = options?.clearClipboardPreview ?? true;
      setPasteToPlaceMenuState(null);
      if (clearClipboardPreview) {
        clearPasteToPlaceMenuClipboardPreview();
      }
      if (clearPreview) {
        clearPasteToPlaceProgressPreview();
      }
    },
    [clearPasteToPlaceMenuClipboardPreview, clearPasteToPlaceProgressPreview]
  );

  const preparePasteToPlaceProductFromMenu = useCallback(
    async ({
      xNorm,
      yNorm,
      operationId,
    }: PasteToPlaceClickHint & {
      operationId: number;
    }): Promise<PasteToPlaceMenuPreparationResult> => {
      const isOperationStale = (context: string): boolean => {
        if (isPasteToPlaceOperationActive(operationId)) return false;
        return true;
      };

      if (isOperationStale("prepare_from_menu:start")) {
        return { status: "failed", reason: "paste-to-place-operation-stale" };
      }
      const source = activePasteSourceRef.current;
      const hasProvisionalClipboardPreview = Boolean(pasteToPlaceMenuClipboardPreviewUrl);
      if (source && !hasProvisionalClipboardPreview) {
        if (source.type === "my_furniture") {
          try {
            const sourceFurnitureIds =
              source.furnitureIds.length > 0 ? source.furnitureIds : [source.furnitureId];
            let mergedEligibleSkus: VibodeEligibleSku[] = [];
            const resolvedFurnitureIds: string[] = [];
            for (const furnitureId of sourceFurnitureIds) {
              const resolved = await resolveMyFurnitureForEdit(furnitureId);
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
            clearPasteToPlaceProgressPreview();
            pushSnack("That saved furniture item is no longer available. Choose another item.");
            return { status: "failed", reason: "my-furniture-source-stale" };
          }
        }
        return { status: "ready", source };
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
      buildPreparedMyFurnitureProduct,
      clearPasteToPlaceActiveSource,
      clearPasteToPlaceProgressPreview,
      isPasteToPlaceOperationActive,
      pasteToPlaceMenuClipboardPreviewUrl,
      pushSnack,
      preparePasteToPlaceClipboardProduct,
      resolveMyFurnitureForEdit,
    ]
  );

  const handlePasteToPlacePlaceHere = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    const menuStateSnapshot = pasteToPlaceMenuState;
    if (isMyFurnitureMultiPreparedSource) {
      pushSnack("Place here is unavailable for multi-selected My Furniture items.");
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

    const operationId = beginPasteToPlaceOperation();
    setPasteToPlaceProgressCardState(menuStateSnapshot);
    dismissPasteToPlaceMenu({ clearPreview: false, clearClipboardPreview: false });
    const { xNorm, yNorm } = menuStateSnapshot;
    const preparedResult = await preparePasteToPlaceProductFromMenu({ xNorm, yNorm, operationId });

    await handlePasteToPlaceAdd({ xNorm, yNorm, preparedResult, operationId });
  }, [
    activeTool,
    beginPasteToPlaceOperation,
    dismissPasteToPlaceMenu,
    handlePasteToPlaceAdd,
    isBusy,
    isEditRunning,
    isMyFurnitureMultiPreparedSource,
    isRotateMarkerTargeting,
    pasteToPlaceMenuState,
    preparePasteToPlaceProductFromMenu,
    pushSnack,
    scene.baseImageUrl,
  ]);

  const handlePasteToPlaceSwap = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    const menuStateSnapshot = pasteToPlaceMenuState;
    if (isMyFurnitureMultiPreparedSource) {
      pushSnack("Swap item is unavailable for multi-selected My Furniture items.");
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

    const operationId = beginPasteToPlaceOperation();
    setPasteToPlaceProgressCardState(menuStateSnapshot);
    dismissPasteToPlaceMenu({ clearPreview: false, clearClipboardPreview: false });
    const { xNorm, yNorm } = menuStateSnapshot;
    const preparedResult = await preparePasteToPlaceProductFromMenu({ xNorm, yNorm, operationId });
    await runPasteToPlaceClickTargetEdit({
      action: "swap",
      xNorm,
      yNorm,
      preparedResult,
      operationId,
    });
  }, [
    activeTool,
    beginPasteToPlaceOperation,
    dismissPasteToPlaceMenu,
    isBusy,
    isEditRunning,
    isMyFurnitureMultiPreparedSource,
    isRotateMarkerTargeting,
    pasteToPlaceMenuState,
    preparePasteToPlaceProductFromMenu,
    pushSnack,
    runPasteToPlaceClickTargetEdit,
    scene.baseImageUrl,
  ]);

  const handlePasteToPlaceAutoPlace = useCallback(async () => {
    if (!pasteToPlaceMenuState) return;
    const menuStateSnapshot = pasteToPlaceMenuState;
    const { xNorm, yNorm } = menuStateSnapshot;
    if (!scene.baseImageUrl || isBusy || isEditRunning) {
      dismissPasteToPlaceMenu();
      return;
    }

    const operationId = beginPasteToPlaceOperation();
    const isOperationStale = (context: string): boolean => {
      if (isPasteToPlaceOperationActive(operationId)) return false;
      return true;
    };

    try {
      setPasteToPlaceProgressCardState(menuStateSnapshot);
      dismissPasteToPlaceMenu({ clearPreview: false, clearClipboardPreview: false });
      const prepared = await preparePasteToPlaceProductFromMenu({ xNorm, yNorm, operationId });
      if (isOperationStale("auto_place:after_prepare")) return;
      if (prepared.status !== "ready") return;

      const sourceForExecution = prepared.source;
      const targetCount =
        sourceForExecution.type === "my_furniture" && sourceForExecution.selectionCount > 1
          ? sourceForExecution.selectionCount
          : 1;

      if (isOperationStale("auto_place:before_stage_run")) return;
      setPasteToPlaceStatus("placing");
      const res = await runStage(
        3,
        {
          eligibleSkus: sourceForExecution.preparedProduct.eligibleSkus,
          targetCount,
        },
        {
          beforeCommit: () => !isOperationStale("auto_place:before_commit"),
          onImageCommitted: () => {
            if (isOperationStale("auto_place:on_image_committed")) return;
            setPasteToPlaceStatus(null);
            clearPasteToPlaceProgressPreview();
          },
        }
      );
      if (isOperationStale("auto_place:after_stage_run")) return;
      if (!res) {
        return;
      }

      if (!isDevUnlockPasteToPlace) {
        setHasUsedFreePasteToPlace(true);
      }
    } finally {
      if (!isOperationStale("auto_place:finally")) {
        setPasteToPlaceStatus(null);
        clearPasteToPlaceProgressPreview();
      }
    }
  }, [
    beginPasteToPlaceOperation,
    clearPasteToPlaceProgressPreview,
    dismissPasteToPlaceMenu,
    isBusy,
    isDevUnlockPasteToPlace,
    isEditRunning,
    isPasteToPlaceOperationActive,
    pasteToPlaceMenuState,
    preparePasteToPlaceProductFromMenu,
    runStage,
    scene.baseImageUrl,
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
      } catch (err: any) {
        pushSnack(err?.message ?? "Failed to resolve saved furniture item.");
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

  const addRemoveMarker = () => {
    clearLegacyPlacementNodes();
    setIsRotateMarkerTargeting(false);
    setIsRemoveMarkerTargeting(true);
    setEditWarning(null);
    pushSnack("Remove marker armed. Click anywhere on the image.");
  };

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
    const { xNorm, yNorm } = removeMarkerPosition;
    const res = await runEdit("remove", {
      target: { xNorm, yNorm },
      params: { x: xNorm, y: yNorm, xNorm, yNorm },
    });
    if (!res) return;
    clearRemoveMarker(false);
    setEditWarning(null);
  };

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

  const addRotateMarker = useCallback(() => {
    clearLegacyPlacementNodes();
    setIsRemoveMarkerTargeting(false);
    setIsRotateMarkerTargeting(true);
    setEditWarning(null);
    pushSnack("Rotate marker armed. Click anywhere on the image.");
  }, [clearLegacyPlacementNodes, pushSnack]);

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

  const rotateSelected = async () => {
    const marker = rotateToolState.marker;
    if (!marker) {
      warnEdit("Place a rotate marker first.");
      return;
    }
    const rotationDegrees =
      rotateToolState.direction === "cw"
        ? rotateToolState.amountDegrees
        : -rotateToolState.amountDegrees;
    const res = await runEdit("rotate", {
      xNorm: marker.xNorm,
      yNorm: marker.yNorm,
      rotationDegrees,
    });
    if (!res) return;
    setEditWarning(null);
  };

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
        .map((id) => (col?.catalog as any)?.[id])
        .filter(Boolean)
        .map((sku: any) => {
          const realW = typeof sku.realWidthFt === "number" ? (sku.realWidthFt as number) : undefined;
          const realD = typeof sku.realDepthFt === "number" ? (sku.realDepthFt as number) : undefined;

          const pxW = ppf && realW ? Math.max(1, Math.round(realW * ppf)) : (sku.defaultPxWidth as number);
          const pxH = ppf && realD ? Math.max(1, Math.round(realD * ppf)) : (sku.defaultPxHeight as number);

          return {
            skuId: sku.skuId,
            label: sku.label,
            defaultPxWidth: pxW,
            defaultPxHeight: pxH,
            realWidthFt: realW,
            realDepthFt: realD,
            variants:
              sku.variants?.length > 0
                ? sku.variants.map((v: any) => ({
                    variantId: v.variantId,
                    label: v.label,
                    imageUrl: v.imageUrl || v.pngUrl || v.url || v.src || sku.imageUrl || sku.pngUrl || sku.url || sku.src,
                  }))
                : [
                    {
                      variantId: sku.skuId,
                      label: sku.label,
                      imageUrl: sku.imageUrl || sku.pngUrl || sku.url || sku.src,
                    },
                  ],
          };
        });

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
      if (generationId) {
        useEditorStore.setState((s) => {
          const idx = s.history.findIndex((h) => h.generationId === generationId);
          if (idx === -1) return s;
          const nextHistory = s.history.slice();
          nextHistory[idx] = {
            ...nextHistory[idx],
            pendingMarkup: markupToPersist,
            pendingVibeMode: sceneSnapshotForRecovery.vibeMode,
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
        console.log("[V2 DEBUG before fetch]", {
          payloadVersion: (payload as any)?.payloadVersion,
          sceneHash: (payload as any)?.sceneHash,
          nodesLength: (payload as any)?.nodes?.length,
          firstNodeId: (payload as any)?.nodes?.[0]?.nodeId,
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
      const j: any = await res
        .json()
        .catch(async () => ({ error: await res.text().catch(() => "Bad JSON response") }));

      // TEMP DEBUG (remove after capturing full-vibe runtime evidence)
      console.log("[VIBODE DEBUG RAW]", {
        vibodeRoute,
        status: res.status,
        keys: j && typeof j === "object" ? Object.keys(j) : null,
        imageUrl: j?.imageUrl,
        stagedImageUrl: j?.stagedImageUrl,
        outputImageUrl: j?.output?.imageUrl,
        widthPx: j?.widthPx,
        heightPx: j?.heightPx,
        outputWidthPx: j?.output?.widthPx,
        outputHeightPx: j?.output?.heightPx,
        generationIdFromResponse: j?.generationId,
        generationIdLocalBeforeAdopt: generationId,
        isVibeStage,
        isRemoveMode,
        isSwapMode,
        isRotateMode,
        forceEcho,
      });
  
      console.log("[VIBODE GENERATE RESPONSE]", res.status, j);
  
      if (!res.ok || j?.ok === false) {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { code: j?.code, message: j?.message ?? j?.error, raw: j },
        });
        return;
      }
  
      // Debug / ops summary
      const ops = j?.debug?.ops;
      const nodesTotal = j?.debug?.counts?.nodesTotal ?? 0;
      const add = ops?.add?.length ?? 0;
      const rm = ops?.remove?.length ?? 0;
      const sw = ops?.swap?.length ?? 0;
  
      if (j?.mode === "echo") {
        useEditorStore.getState().endGenerateError({
          userMessage: "Something didn’t work that time. Please try generating again.",
          debug: { code: "ECHO_ONLY", message: "Echo mode returned no image", raw: j },
        });
        return;
      }
      
      const toFinitePosNum = (v: any) => {
        const n = typeof v === "string" ? Number(v) : v;
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      
      // ─────────────────────────────────────────────
      // Resolve generated image URL.
      // Canonical source: j.output.imageUrl
      // Fallbacks are kept for legacy / transitional API responses.
      // ─────────────────────────────────────────────
      const imageUrl: string | null = j?.output?.imageUrl || j?.imageUrl || j?.stagedImageUrl || null;
      const outW = toFinitePosNum(j?.output?.widthPx ?? j?.widthPx);
      const outH = toFinitePosNum(j?.output?.heightPx ?? j?.heightPx);
      
      const genId = typeof j?.generationId === "string" ? j.generationId : isVibeStage ? localGenId : null;

      // TEMP DEBUG (remove after capturing full-vibe runtime evidence)
      console.log("[VIBODE DEBUG COMPUTED]", {
        outUrl: imageUrl,
        outW,
        outH,
        generationIdFromResponse: j?.generationId,
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
      
      useEditorStore.getState().attachOutputAndSwapBase({
        generationId: genId,
        outputImageUrl: imageUrl,
        outputBucket: j?.output?.bucket ?? j?.output?.storage?.bucket,
        outputStorageKey: j?.output?.storageKey ?? j?.output?.storage?.key,
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
      if (vibodeRoomId) {
        const latestVersions = await refreshRoomVersions(vibodeRoomId);
        const baseAsset = latestVersions?.find((asset) => asset.asset_type === "base") ?? null;
        const activeAsset = latestVersions?.find((asset) => asset.is_active) ?? null;
        if (baseAsset) {
          setRoomBaseAssetId(baseAsset.id);
        }
        setActiveAssetId(activeAsset?.id ?? latestVersions?.[0]?.id ?? null);
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
      const tokenCost = typeof j?.tokenCost === "number" ? j.tokenCost : null;
      const tokenBalance = typeof j?.tokenBalance === "number" ? j.tokenBalance : null;
        
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
      if (j?.mode !== "nanobanana") {
        commitGenerateMock();
      }
  
      // 🚀 Plumbing (next step): append to history + swap base image:
      // - add a history tile with imageUrl (prefer storage/signed if returned)
      // - set base image to returned imageUrl (or storageKey bucket)
      //
      // Example placeholder calls (wire to your store actions):
      // useEditorStore.getState().appendHistoryFromGeneration?.({ generationId: j.generationId, imageUrl });
      // useEditorStore.getState().setBaseImageFromGeneration?.({ imageUrl, generationId: j.generationId });
  
    } catch (e: any) {
      console.error(e);
      useEditorStore.getState().endGenerateError({
        userMessage: "Something didn’t work that time. Please try generating again.",
        debug: { message: e?.message ?? "API network error", raw: e },
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

  const stage5Locked = activeStage === 5 && !hasFurniturePass && !STAGE5_DEV_BYPASS;
  const activeStageTokenCost = STAGE_TOKEN_COST[activeStage] ?? DEFAULT_ACTION_TOKEN_COST;
  const activeStageTokenCostLabel = formatTokenCostLabel(activeStageTokenCost);
  const activeEditTokenCost =
    activeTool === "swap"
      ? EDIT_TOKEN_COST.EDIT_SWAP
      : activeTool === "rotate"
        ? EDIT_TOKEN_COST.EDIT_ROTATE
        : DEFAULT_ACTION_TOKEN_COST;
  const activeEditTokenCostLabel = formatTokenCostLabel(activeEditTokenCost);
  const renderVersionRow = (asset: VibodeRoomAsset) => {
    const isActive = selectedVersionId === asset.id;
    const secondaryText = getVersionSecondaryLabel(asset);
    const versionPreviewUrl =
      typeof asset.preview_url === "string" && asset.preview_url.trim().length > 0
        ? asset.preview_url
        : asset.image_url;
    const isDeleting = deletingVersionId === asset.id;
    return (
      <div key={asset.id} className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleSelectVersion(asset)}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border p-1.5 text-left transition ${
            isActive
              ? "border-neutral-600 bg-neutral-800 ring-1 ring-neutral-600/40"
              : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900"
          }`}
        >
          <img
            src={versionPreviewUrl}
            alt={secondaryText}
            className="h-11 w-14 flex-none rounded bg-neutral-800 object-cover"
            loading="lazy"
          />
          <div className="min-w-0">
            <div className="truncate text-xs text-neutral-100">
              {formatVersionTimestamp(asset.created_at)}
            </div>
            <div className="truncate text-[11px] text-neutral-500">{secondaryText}</div>
          </div>
        </button>
        {canDeleteVersions ? (
          <button
            type="button"
            className={`rounded-md border px-2 py-1 text-[11px] transition ${
              deletingVersionId
                ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
            disabled={Boolean(deletingVersionId)}
            onClick={() => handleRequestDeleteVersion(asset)}
            aria-label="Delete version"
            title="Delete version"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="h-dvh w-full overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex h-12 items-center justify-between border-b border-neutral-800 px-4">
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
          <TokenBalanceBadge className="border-neutral-700 bg-neutral-900 text-neutral-200" />
          <Link
            href="/billing"
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
      <div className="flex h-[calc(100dvh-3rem)] w-full min-h-0">
        {/* Canvas area */}
        <main className="flex flex-1 items-center justify-center bg-neutral-950">
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
                accept="image/*"
                className="hidden"
                disabled={isUploading}
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
                              <img
                                src={sku.imageUrl}
                                alt={sku.displayName}
                                className="h-12 w-12 rounded-md bg-neutral-800 object-cover"
                                loading="lazy"
                              />
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
                isPasteToPlaceMenuPreviewLoading={
                  isPasteToPlaceMenuIngesting || isPasteToPlaceMenuClipboardPreviewLoading
                }
                pasteToPlaceProgressCardState={pasteToPlaceProgressCardState}
                pasteToPlaceProgressCardPreviewUrl={pasteToPlaceDisplayedPreviewUrl}
                isPasteToPlaceProgressCardLoading={
                  isPasteToPlaceMenuIngesting || Boolean(pasteToPlaceStatus)
                }
                onOpenPasteToPlaceMenu={openPasteToPlaceMenu}
                onPasteToPlaceChoosePlaceHere={handlePasteToPlacePlaceHere}
                onPasteToPlaceChooseMyFurnitureAdd={() => {
                  void openMyFurniturePicker("add");
                }}
                pasteToPlaceProductUrlInput={pasteToPlaceProductUrlInput}
                onPasteToPlaceProductUrlInputChange={setPasteToPlaceProductUrlInput}
                onPasteToPlaceSubmitProductUrl={() => {
                  void preparePasteToPlaceProductUrlSource();
                }}
                isPasteToPlaceProductUrlPreparing={isPasteToPlaceMenuIngesting && pasteToPlaceStatus === "preparing"}
                onPasteToPlaceChooseSwap={handlePasteToPlaceSwap}
                onPasteToPlaceChooseAutoPlace={handlePasteToPlaceAutoPlace}
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
                        isUploading
                          ? "cursor-not-allowed border-neutral-700 bg-neutral-800 text-neutral-500"
                          : "border-blue-600/80 bg-blue-900/50 text-blue-100 hover:bg-blue-800/60"
                      }`}
                      disabled={isUploading}
                      onClick={() => roomPhotoUploadInputRef.current?.click()}
                    >
                      {isUploading ? "Uploading…" : "Upload Photo"}
                    </button>

                    <div className="mt-3 text-xs text-neutral-400">or drag & drop an image</div>
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
            </div>
          </div>
        </main>

        {/* Right panel */}
        <aside className="h-full w-[340px] border-l border-neutral-800 bg-neutral-950">
          <div className="h-full overflow-y-auto">
            <div className="space-y-4 p-4">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Workflow</div>
              <div className="mt-1 text-xs text-neutral-400">Five-stage editor workflow skeleton.</div>

              <div className="mt-3 grid grid-cols-5 gap-1">
                {WORKFLOW_STAGES.map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => {
                      setActiveStage(stage);
                    }}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      activeStage === stage
                        ? "border-neutral-600 bg-neutral-800 text-neutral-100"
                        : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {stage}
                  </button>
                ))}
              </div>

              <div className="mt-2 text-xs text-neutral-500">
                Status: {stageStatus[activeStage]} • Furniture pass: {hasFurniturePass ? "yes" : "no"}
              </div>
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
                  <Link href="/billing" className="text-neutral-300 underline underline-offset-2">
                    Open billing
                  </Link>
                  .
                </div>
              ) : null}

              <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-sm font-medium">Stage {activeStage}</div>

                {activeStage === 1 ? (
                  <>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={stage1Enhance}
                        onChange={(e) => setStage1Enhance(e.target.checked)}
                        className="h-4 w-4 accent-sky-400"
                      />
                      Enhance
                    </label>

                    <div className="mt-3">
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

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          runStage(1, { enhance: stage1Enhance, declutter: stage1Declutter })
                        }
                        disabled={stageStatus[1] === "running" || isOutOfTokens}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          stageStatus[1] === "running" || isOutOfTokens
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                        }`}
                      >
                        {stageStatus[1] === "running" ? "Running…" : "Run Stage"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runStage(1, {
                            enhance: stage1Enhance,
                            declutter: stage1Declutter,
                            emptyRoom: true,
                          })
                        }
                        disabled={stageStatus[1] === "running" || isOutOfTokens}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          stageStatus[1] === "running" || isOutOfTokens
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                        }`}
                      >
                        Empty Room
                      </button>
                    </div>
                  </>
                ) : activeStage === 2 ? (
                  <>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={stage2Repair}
                        onChange={(e) => setStage2Repair(e.target.checked)}
                        className="h-4 w-4 accent-sky-400"
                      />
                      Repair Damage
                    </label>

                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={stage2Repaint}
                        onChange={(e) => setStage2Repaint(e.target.checked)}
                        className="h-4 w-4 accent-sky-400"
                      />
                      Repaint Walls
                    </label>

                    <div className="mt-3">
                      <div className="text-xs text-neutral-400">Flooring</div>
                      <select
                        className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm outline-none focus:border-neutral-600"
                        value={stage2Flooring}
                        onChange={(e) =>
                          setStage2Flooring(
                            e.target.value as "none" | "carpet" | "hardwood" | "tile"
                          )
                        }
                      >
                        <option value="none">none</option>
                        <option value="carpet">carpet</option>
                        <option value="hardwood">hardwood</option>
                        <option value="tile">tile</option>
                      </select>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => runStage(2)}
                        disabled={stageStatus[2] === "running" || isOutOfTokens}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          stageStatus[2] === "running" || isOutOfTokens
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                        }`}
                      >
                        {stageStatus[2] === "running" ? "Running…" : "Run Stage"}
                      </button>
                    </div>
                  </>
                ) : activeStage === 4 ? (
                  <>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => runStage(4, { stage4Action: STAGE4_PRIMARY_ACTION })}
                        disabled={stageStatus[4] === "running" || isOutOfTokens}
                        className={`w-full rounded-md border px-3 py-2 text-sm ${
                          stageStatus[4] === "running" || isOutOfTokens
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-sky-500/60 bg-sky-950/40 text-sky-100 hover:bg-sky-900/50"
                        }`}
                      >
                        {stageStatus[4] === "running" && stage4RunningAction === STAGE4_PRIMARY_ACTION
                          ? "Styling…"
                          : "✨ Style Room"}
                      </button>
                    </div>

                    <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 p-2">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                        Advanced Stage 4
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {STAGE4_ADVANCED_ACTIONS.map((action) => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => runStage(4, { stage4Action: action })}
                            disabled={stageStatus[4] === "running" || isOutOfTokens}
                            className={`rounded-md border px-2 py-1 text-xs ${
                              stageStatus[4] === "running" || isOutOfTokens
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

                    <div className="mt-2 text-xs text-neutral-500">
                      {stageStatus[4] === "running" && stage4RunningAction
                        ? `Running: ${STAGE4_ACTION_LABELS[stage4RunningAction]}`
                        : "Image-only styling pass; Stage 3 placements stay unchanged."}
                    </div>
                  </>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => runStage(activeStage)}
                      disabled={
                        stageStatus[activeStage] === "running" ||
                        isOutOfTokens ||
                        stage5Locked
                      }
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        stageStatus[activeStage] === "running" ||
                        isOutOfTokens ||
                        stage5Locked
                          ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                          : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                      }`}
                    >
                      {stageStatus[activeStage] === "running" ? "Running…" : "Run Stage"}
                    </button>
                    {activeStage === 5 && !hasFurniturePass && (
                      <div className="mt-2 text-xs text-neutral-500">
                        Stage 5 is locked until Stage 3 succeeds.
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 text-xs text-neutral-500">
                  Last output: {lastStageOutputs[activeStage] ? "available" : "none"}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  This will use {activeStageTokenCostLabel}.
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={collapseAllRightPanels}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Collapse All
              </button>
              <button
                type="button"
                onClick={expandAllRightPanels}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Expand All
              </button>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Edit Tools (All Stages)</div>
                <button
                  type="button"
                  className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  aria-label={
                    isEditToolsCollapsed
                      ? "Expand Edit Tools panel"
                      : "Collapse Edit Tools panel"
                  }
                  aria-expanded={!isEditToolsCollapsed}
                  aria-controls="edit-tools-panel-body"
                  onClick={() => setIsEditToolsCollapsed((prev) => !prev)}
                >
                  {isEditToolsCollapsed ? "▸" : "▾"}
                </button>
              </div>
              {!isEditToolsCollapsed ? (
                <div id="edit-tools-panel-body">
                  {editWarning && (
                    <div className="mt-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-xs text-amber-200">
                      {editWarning}
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-neutral-500">
                    This action uses {activeEditTokenCostLabel}.
                  </div>

              <div className="mt-3">
                <div className="text-xs text-neutral-400">Remove</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {!hasActiveRemoveMarker ? (
                    <button
                      type="button"
                      disabled={isEditRunning}
                      className={`col-span-2 rounded-md border px-2 py-1.5 text-xs ${
                        isEditRunning
                          ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                          : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                      }`}
                      onClick={addRemoveMarker}
                    >
                      Add Remove Marker
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={isEditRunning}
                        className={`rounded-md border px-2 py-1.5 text-xs ${
                          isEditRunning
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                        }`}
                        onClick={() => clearRemoveMarker()}
                      >
                        Clear Marker
                      </button>
                      <button
                        type="button"
                        disabled={isEditRunning || isOutOfTokens || !workingImageUrl || !hasActiveRemoveMarker}
                        className={`rounded-md border px-2 py-1.5 text-xs ${
                          isEditRunning || isOutOfTokens || !workingImageUrl || !hasActiveRemoveMarker
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                        }`}
                        onClick={() => {
                          void removeSelectedMarker();
                        }}
                      >
                        Remove Selected
                      </button>
                    </>
                  )}
                </div>
                {isRemoveMarkerTargeting && !hasActiveRemoveMarker ? (
                  <div className="mt-1 text-[11px] text-neutral-500">
                    Click anywhere on the image to place the marker.
                  </div>
                ) : null}
              </div>

              <div className="mt-3">
                <div className="text-xs text-neutral-400">Rotate</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isEditRunning}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      isEditRunning
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    }`}
                    onClick={addRotateMarker}
                  >
                    Add Rotate Marker
                  </button>
                  <button
                    type="button"
                    disabled={isEditRunning || (!hasActiveRotateMarker && !isRotateMarkerTargeting)}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      isEditRunning || (!hasActiveRotateMarker && !isRotateMarkerTargeting)
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    }`}
                    onClick={() => clearRotateMarker()}
                  >
                    Clear Marker
                  </button>
                </div>
                {isRotateMarkerTargeting ? (
                  <div className="mt-1 text-[11px] text-neutral-500">
                    Click anywhere on the image to place the marker.
                  </div>
                ) : null}

                <div className="mt-3">
                  <div className="text-xs text-neutral-400">Direction</div>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isEditRunning}
                      className={`rounded-md border px-2 py-1.5 text-xs ${
                        rotateToolState.direction === "cw"
                          ? "border-violet-600/70 bg-violet-950/40 text-violet-100"
                          : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                      }`}
                      onClick={() => {
                        setRotateToolState((prev) => ({ ...prev, direction: "cw" }));
                        setEditWarning(null);
                      }}
                    >
                      Clockwise
                    </button>
                    <button
                      type="button"
                      disabled={isEditRunning}
                      className={`rounded-md border px-2 py-1.5 text-xs ${
                        rotateToolState.direction === "ccw"
                          ? "border-violet-600/70 bg-violet-950/40 text-violet-100"
                          : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                      }`}
                      onClick={() => {
                        setRotateToolState((prev) => ({ ...prev, direction: "ccw" }));
                        setEditWarning(null);
                      }}
                    >
                      Counterclockwise
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs text-neutral-400">Amount</div>
                  <div className="mt-1 grid grid-cols-5 gap-1">
                    {([5, 15, 30, 45, 90] as RotateAmount[]).map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        disabled={isEditRunning}
                        className={`rounded-md border px-1 py-1 text-xs ${
                          rotateToolState.amountDegrees === amount
                            ? "border-violet-600/70 bg-violet-950/40 text-violet-100"
                            : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                        }`}
                        onClick={() => {
                          setRotateToolState((prev) => ({ ...prev, amountDegrees: amount }));
                          setEditWarning(null);
                        }}
                      >
                        {amount}°
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isEditRunning || isOutOfTokens || !workingImageUrl || !hasActiveRotateMarker}
                  className={`mt-2 w-full rounded-md border px-2 py-1.5 text-xs ${
                    isEditRunning || isOutOfTokens || !workingImageUrl || !hasActiveRotateMarker
                      ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                      : "border-violet-800/60 bg-violet-950/30 text-violet-100 hover:bg-violet-900/40"
                  }`}
                  onClick={() => {
                    void rotateSelected();
                  }}
                >
                  Rotate Selected
                </button>
              </div>

              </div>
              ) : null}
            </div>

            {activeStage === 3 && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Stage 3 Items</div>
                  <label className="flex items-center gap-1 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={stage3ShowCatalog}
                      onChange={(e) => setStage3ShowCatalog(e.target.checked)}
                      className="h-4 w-4 accent-sky-400"
                    />
                    Show catalog
                  </label>
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  Active: {activeCount}/{totalCount} • User: {activeUserCount}/{userCount} • Catalog:{" "}
                  {activeCatalogCount}/{catalogCount}
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  Choose which SKUs are included for this generation and set order.
                </div>

                <div className="mt-3 space-y-2">
                  {stage3SkuItems.map((item, index) => {
                    if (item.source !== "user" && !(item.active || stage3ShowCatalog)) {
                      return null;
                    }
                    return (
                      <div
                        key={item.skuId}
                        className="rounded-md border border-neutral-800 bg-neutral-950 p-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-neutral-100">
                              {item.label || item.skuId}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[11px]">
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  item.source === "user"
                                    ? "border border-emerald-900/50 bg-emerald-950/30 text-emerald-300"
                                    : "border border-neutral-700 bg-neutral-900 text-neutral-300"
                                }`}
                              >
                                {item.source === "user" ? "User" : "Catalog"}
                              </span>
                              <span className="truncate text-neutral-500">{item.skuId}</span>
                            </div>
                          </div>

                          <label className="flex items-center gap-1 text-xs text-neutral-300">
                            <input
                              type="checkbox"
                              checked={item.active}
                              onChange={(e) =>
                                toggleStage3SkuItemActive(item.skuId, e.target.checked)
                              }
                              className="h-4 w-4 accent-sky-400"
                            />
                            Include
                          </label>

                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => moveStage3SkuItem(index, "up")}
                              disabled={index === 0}
                              className={`rounded border px-2 py-1 text-xs ${
                                index === 0
                                  ? "border-neutral-900 bg-neutral-950 text-neutral-600"
                                  : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                              }`}
                              aria-label={`Move ${item.skuId} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStage3SkuItem(index, "down")}
                              disabled={index === stage3SkuItems.length - 1}
                              className={`rounded border px-2 py-1 text-xs ${
                                index === stage3SkuItems.length - 1
                                  ? "border-neutral-900 bg-neutral-950 text-neutral-600"
                                  : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                              }`}
                              aria-label={`Move ${item.skuId} down`}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Versions</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    {versions.length} version{versions.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  aria-label={isVersionsCollapsed ? "Expand Versions panel" : "Collapse Versions panel"}
                  aria-expanded={!isVersionsCollapsed}
                  aria-controls="versions-panel-body"
                  onClick={() => setIsVersionsCollapsed((prev) => !prev)}
                >
                  {isVersionsCollapsed ? "▸" : "▾"}
                </button>
              </div>
              {!isVersionsCollapsed ? (
                <div id="versions-panel-body" className="mt-3">
                  {versions.length === 0 ? (
                    <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-500">
                      No versions yet. Upload an image to create the original version.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {groupedVersions.today.length > 0 ? (
                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Today</div>
                          <div className="space-y-1">{groupedVersions.today.map(renderVersionRow)}</div>
                        </div>
                      ) : null}
                      {groupedVersions.thisMonth.length > 0 ? (
                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                            This month
                          </div>
                          <div className="space-y-1">{groupedVersions.thisMonth.map(renderVersionRow)}</div>
                        </div>
                      ) : null}
                      {groupedVersions.earlier.length > 0 ? (
                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Earlier</div>
                          <div className="space-y-1">{groupedVersions.earlier.map(renderVersionRow)}</div>
                        </div>
                      ) : null}
                      {originalVersion ? (
                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Original</div>
                          <div className="space-y-1">{renderVersionRow(originalVersion)}</div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
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
                    accept="image/*"
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
                      <img
                        src={ingestedUserSku.variants[0]}
                        alt={ingestedUserSku.label}
                        className="h-full w-full object-contain"
                      />
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
                      isUploading
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
                    }`}
                    title={isUploading ? "Uploading…" : "Upload"}
                  >
                    {isUploading ? "Uploading…" : "Upload…"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploading}
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
                      .map((skuId) => (col.catalog as any)[skuId])
                      .filter(Boolean)
                      .map((sku: any) => {
                        const realW =
                          typeof sku.realWidthFt === "number" ? (sku.realWidthFt as number) : undefined;
                        const realD =
                          typeof sku.realDepthFt === "number" ? (sku.realDepthFt as number) : undefined;

                        const pxW = ppf && realW ? Math.max(1, Math.round(realW * ppf)) : sku.defaultPxWidth;
                        const pxH = ppf && realD ? Math.max(1, Math.round(realD * ppf)) : sku.defaultPxHeight;

                        return {
                          skuId: sku.skuId,
                          label: sku.label,
                          defaultPxWidth: pxW,
                          defaultPxHeight: pxH,
                          realWidthFt: realW,
                          realDepthFt: realD,
                          variants:
                            sku.variants?.length > 0
                              ? sku.variants.map((v: any) => ({
                                  variantId: v.variantId,
                                  label: v.label,
                                  imageUrl:
                                    v.imageUrl ||
                                    v.pngUrl ||
                                    v.url ||
                                    v.src ||
                                    sku.imageUrl ||
                                    sku.pngUrl ||
                                    sku.url ||
                                    sku.src,
                                }))
                              : [
                                  {
                                    variantId: sku.skuId,
                                    label: sku.label,
                                    imageUrl: sku.imageUrl || sku.pngUrl || sku.url || sku.src,
                                  },
                                ],
                        };
                      });

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

                  {swapTargetSku?.variants?.length ? (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-neutral-300">
                        Swap color / material
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {swapTargetSku.variants.map((v: any) => (
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
                    ? eligibleForDrag.map((x: any) => ({
                        skuId: x.skuId,
                        label: x.label,
                        defaultPxWidth: x.defaultPxWidth,
                        defaultPxHeight: x.defaultPxHeight,
                      }))
                    : Object.values((collection?.catalog as any) ?? {}).map((x: any) => ({
                        skuId: x.skuId,
                        label: x.label,
                        defaultPxWidth: x.defaultPxWidth,
                        defaultPxHeight: x.defaultPxHeight,
                      }));

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
                            <img
                              src={opt.imageUrl}
                              alt=""
                              className="h-12 w-12 rounded-md bg-neutral-800 object-cover"
                            />
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
