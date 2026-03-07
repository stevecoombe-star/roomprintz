// app/editor/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { SnackbarHost, type Snackbar } from "@/components/ui/SnackbarHost";
import { toImageSpaceTransform, useEditorStore, type FurnitureNode } from "@/stores/editorStore";
import { computeOverlappingNodeIds } from "@/lib/collisionV1";
import { MOCK_COLLECTIONS, type RoomSizeBundleId } from "@/data/mockCollections";
import { IKEA_CA_SKUS, type IkeaCaSku } from "@/data/mockIkeaCaSkus";
import { clearPendingLocal, loadPendingLocal, savePendingLocal } from "@/lib/pendingGeneration";
import { DEFAULT_PX_PER_IN, skuFootprintInchesFromDims } from "@/lib/ikeaSizing";

// ✅ FIX: import path (avoid "@/src/..." which commonly causes alias/circular issues)
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const DND_MIME = "application/x-roomprintz-furniture";
const USER_SKU_MAX_INPUT_BYTES = 12 * 1024 * 1024;

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

function formatInches(n?: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function skuDimsLabel(sku: IkeaCaSku) {
  const { width, depth, height, diameter } = sku.dimsIn;
  if (diameter) {
    return `Ø ${formatInches(diameter)}" × H ${formatInches(height)}"`;
  }
  const d = depth ?? width;
  return `W ${formatInches(width)}" × D ${formatInches(d)}" × H ${formatInches(height)}"`;
}

function formatSignedDegrees(angleDeg: number) {
  if (!Number.isFinite(angleDeg)) return "0°";
  const rounded = Math.round(angleDeg);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}°`;
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

function MoveIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2v20" />
      <path d="M2 12h20" />
      <path d="m8 6 4-4 4 4" />
      <path d="m8 18 4 4 4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m18 8 4 4-4 4" />
    </svg>
  );
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

function isRemoveMarkerNode(node: FurnitureNode | null): boolean {
  return !!node && node.skuId === "__remove_marker__";
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
type EditAction = "add" | "remove" | "swap" | "rotate" | "move";
type VibodeEligibleSku = {
  skuId: string;
  label: string;
  source?: "catalog" | "user";
  variants: Array<{ imageUrl: string }>;
};
type VibodeEditRunTarget = {
  placementId?: string;
  skuId?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  [key: string]: unknown;
};
type VibodeEditRunRequest = {
  baseImageUrl: string;
  action: EditAction;
  placements: ScenePlacement[];
  target?: VibodeEditRunTarget;
  params?: Record<string, unknown>;
  eligibleSkus?: VibodeEligibleSku[];
};
type VibodeEditRunResponse = {
  imageUrl: string;
  placements?: ScenePlacement[];
};
type PendingStage3Payload = {
  skuItems?: unknown;
  showCatalog?: unknown;
};
type PendingLocalPayload = {
  sceneId?: unknown;
  stage3?: PendingStage3Payload;
  [key: string]: unknown;
};

const WORKFLOW_STAGES: WorkflowStage[] = [1, 2, 3, 4, 5];
const INITIAL_STAGE_STATUS: StageStatusMap = {
  1: "idle",
  2: "idle",
  3: "idle",
  4: "idle",
  5: "idle",
};

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
    const supa = supabaseBrowser();
    const { data, error } = await supa.auth.getSession();
    if (error) console.warn("[supabase] getSession error:", error);
    return data?.session?.access_token ?? null;
  } catch (err) {
    console.warn("[supabase] getSession threw:", err);
    return null;
  }
}

// ✅ upload helper (blob preview -> storage signed URL)
// ✅ CHANGE: include Authorization header when available (upload route may be protected)
async function uploadBaseImageToStorage(opts: {
  file: File;
  sceneId: string;
}): Promise<{ storageKey: string; signedUrl: string; widthPx?: number; heightPx?: number }> {
  const fd = new FormData();
  fd.set("file", opts.file);
  fd.set("sceneId", opts.sceneId);

  const accessToken = await tryGetSupabaseAccessToken();

  const res = await fetch("/api/vibode/upload-base", {
    method: "POST",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
  };

  if (!json?.storageKey || !json?.signedUrl) {
    throw new Error("Upload succeeded but missing storageKey/signedUrl");
  }

  return {
    storageKey: json.storageKey,
    signedUrl: json.signedUrl,
    widthPx: json.widthPx,
    heightPx: json.heightPx,
  };
}

export default function EditorPage() {
  const router = useRouter();

  const scene = useEditorStore((s) => s.scene);
  const nodes = useEditorStore((s) => s.scene.nodes);
  const viewport = useEditorStore((s) => s.viewport);

  const activeTool = useEditorStore((s) => s.ui.activeTool);
  const selectedNodeId = useEditorStore((s) => s.ui.selectedNodeId);
  const selectedSwapMarkId = useEditorStore((s) => s.ui.selectedSwapMarkId);
  const selectedRotateMarkId = useEditorStore((s) => s.ui.selectedRotateMarkId);

  const workingSet = useEditorStore((s) => s.workingSet);
  const history = useEditorStore((s) => s.history);

  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setRoomDims = useEditorStore((s) => s.setRoomDims);
  const setCollection = useEditorStore((s) => s.setCollection);
  const setWorkingSet = useEditorStore((s) => s.setWorkingSet);
  const setVibeMode = useEditorStore((s) => s.setVibeMode);

  // legacy mock boundary (keeps UI behavior today)
  const commitGenerateMock = useEditorStore((s) => s.commitGenerateMock);

  // canonical freeze payload writer
  const freezeNowV1 = useEditorStore((s) => s.freezeNowV1);
  const freezeNowV2 = useEditorStore((s) => s.freezeNowV2);

  const setBaseImageFromFile = useEditorStore((s) => s.setBaseImageFromFile);
  const setBaseImageUrl = useEditorStore((s) => s.setBaseImageUrl);
  const loadHistoryImage = useEditorStore((s) => s.loadHistoryImage);
  const loadHistoryMarkup = useEditorStore((s) => s.loadHistoryMarkup);
  const loadHistoryBoth = useEditorStore((s) => s.loadHistoryBoth);
  const branchFromHistory = useEditorStore((s) => s.branchFromHistory);
  const toggleMarkupVisible = useEditorStore((s) => s.toggleMarkupVisible);
  const recallLastMarkup = useEditorStore((s) => s.recallLastMarkup);

  const applySwap = useEditorStore((s) => s.applySwap);
  const setPendingSwap = useEditorStore((s) => s.setPendingSwap);
  const addFurnitureNodeFromSku = useEditorStore((s) => s.addFurnitureNodeFromSku);
  const addNode = useEditorStore((s) => s.addNode);
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const selectNode = useEditorStore((s) => s.selectNode);
  const selectSwapMark = useEditorStore((s) => s.selectSwapMark);
  const setSwapReplacement = useEditorStore((s) => s.setSwapReplacement);
  const updateRotateMark = useEditorStore((s) => s.updateRotateMark);
  const removeRotateMark = useEditorStore((s) => s.removeRotateMark);

  const lastAction = useEditorStore((s) => s.lastAction);
  const undoLastAction = useEditorStore((s) => s.undoLastAction);

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
  const [recallConfirmOpen, setRecallConfirmOpen] = useState(false);
  const [branchConfirmFor, setBranchConfirmFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [visualMode, setVisualMode] = useState<"blueprint" | "thumbnails">("blueprint");
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);

  const [snacks, setSnacks] = useState<Snackbar[]>([]);
  const pushSnack = (message: string) => {
    setSnacks((prev) => [...prev, { id: safeId("sn"), message }]);
  };
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

  const [fullVibeEnabled, setFullVibeEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [enhancePhotoEnabled, setEnhancePhotoEnabled] = useState(true);
  const [heavyDeclutterEnabled, setHeavyDeclutterEnabled] = useState(false);
  const [lastFreezePayload, setLastFreezePayload] = useState<any>(null);
  const didLogFirstGenerateAttemptRef = useRef(false);

  const [isUploading, setIsUploading] = useState(false);
  const [historyPickerFor, setHistoryPickerFor] = useState<string | null>(null);
  const useFreezeV2 = process.env.NEXT_PUBLIC_VIBODE_FREEZE_V2 === "1";

  const [activeStage, setActiveStage] = useState<WorkflowStage>(1);
  const [stageStatus, setStageStatus] = useState<StageStatusMap>(INITIAL_STAGE_STATUS);
  const [hasFurniturePass, setHasFurniturePass] = useState(false);
  const [lastStageOutputs, setLastStageOutputs] = useState<StageOutputMap>({});
  const [workingImageUrl, setWorkingImageUrl] = useState<string | null>(null);
  const [scenePlacements, setScenePlacements] = useState<ScenePlacement[]>([]);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedEditSkuId, setSelectedEditSkuId] = useState<string>("");
  // Ghost Add is a client-only draft placement; commit will call edit-run later.
  const [ghostAddPlacementId, setGhostAddPlacementId] = useState<string | null>(null);
  const [ghostAddActive, setGhostAddActive] = useState(false);
  const [editRotationDeg, setEditRotationDeg] = useState(0);
  const [editMoveStep, setEditMoveStep] = useState(0.05);
  const [editWarning, setEditWarning] = useState<string | null>(null);
  const [isEditRunning, setIsEditRunning] = useState(false);
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
  const [stage3SkuItems, setStage3SkuItems] = useState<Stage3SkuItem[]>([]);
  const [stage3ShowCatalog, setStage3ShowCatalog] = useState(false);
  const didRestorePendingRef = useRef(false);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
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
  }, [scene.baseImageUrl, workingImageUrl]);

  const activeStageOutputImageUrl = useMemo(
    () => getImageUrlFromUnknown(lastStageOutputs[activeStage]),
    [activeStage, lastStageOutputs]
  );
  const previewImageUrl =
    workingImageUrl ?? activeStageOutputImageUrl ?? scene.baseImageUrl ?? null;

  useEffect(() => {
    if (!selectedPlacementId) return;
    const stillExists = scenePlacements.some((placement) => placement.placementId === selectedPlacementId);
    if (!stillExists) {
      setSelectedPlacementId(null);
    }
  }, [scenePlacements, selectedPlacementId]);

  useEffect(() => {
    if (!stage3SkuItemsActive.length) {
      if (selectedEditSkuId) setSelectedEditSkuId("");
      return;
    }
    if (!selectedEditSkuId) {
      setSelectedEditSkuId(stage3SkuItemsActive[0].skuId);
      return;
    }
    const stillExists = stage3SkuItemsActive.some((sku) => sku.skuId === selectedEditSkuId);
    if (!stillExists) {
      setSelectedEditSkuId(stage3SkuItemsActive[0].skuId);
    }
  }, [selectedEditSkuId, stage3SkuItemsActive]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);
  const selectedRemoveMarkerNode = useMemo(() => {
    if (!selectedNode) return null;
    return isRemoveMarkerNode(selectedNode) ? selectedNode : null;
  }, [selectedNode]);
  const removeMarkerNodes = useMemo(
    () => nodes.filter((node) => node.skuId === "__remove_marker__"),
    [nodes]
  );

  const queuedDeletes = useMemo(
    () => nodes.filter((n) => n.status === "markedForDelete").length,
    [nodes]
  );

  const overlappingNodeIds = useMemo(() => {
    if (!viewport || nodes.length < 2) return new Set<string>();
    return computeOverlappingNodeIds(nodes, viewport);
  }, [nodes, viewport]);

  const hasOverlaps = overlappingNodeIds.size > 0;
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
      const res = await fetch("/api/vibode/user-skus/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(imageBase64 ? { imageBase64 } : { imageUrl }),
          label: productLabel.trim() || "User Upload",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { userSku?: UserSku; error?: string };

      if (!res.ok) {
        throw new Error(json.error || "Failed to normalize image.");
      }

      if (!json.userSku) {
        throw new Error("Ingest response missing userSku.");
      }

      setIngestedUserSku(json.userSku);
      if (json.userSku.status === "failed") {
        setIngestError(json.userSku.reason ?? "Normalization failed.");
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
    pushSnack("Added to Stage 3 eligible items ✅");
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
  const selectedRotateMark = useMemo(() => {
    if (!selectedRotateMarkId) return null;
    return rotateMarks.find((m) => m.id === selectedRotateMarkId) ?? null;
  }, [rotateMarks, selectedRotateMarkId]);
  const hasRotateMarks = rotateMarks.length > 0;
  const canApplyRotate = Boolean(selectedRotateMark && hasRotateMarks);
  const showSwapReplacementPicker = activeTool === "swap" && !!selectedSwapMarkId;
  const swapReplacementOptions = useMemo(() => {
    const eligibleIds = new Set((eligibleForDrag ?? []).map((item: any) => item.skuId));
    const preferred = IKEA_CA_SKUS.filter((sku) => eligibleIds.has(sku.skuId));
    const source = preferred.length > 0 ? preferred : IKEA_CA_SKUS;
    return source.slice(0, 12);
  }, [eligibleForDrag]);
  const latestFreeze = history[0]?.freeze ?? null;

  const canApplyCal =
    !!calibration?.draft?.p1 &&
    !!calibration?.draft?.p2 &&
    (calibration?.draft?.realFeet ?? 0) > 0;

  // Real-time ft size math: nodes are in STAGE px, calibration ppf is in IMAGE px/ft.
  // Convert to stage px/ft using viewport.scale (stage_px per image_px).
  const stagePpf = useMemo(() => {
    const ppf = calibration?.ppf;
    if (!ppf || !viewport) return null;
    return ppf * viewport.scale;
  }, [calibration?.ppf, viewport]);

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
  const hasDraftMarkup =
    Array.isArray(scene.draftMarkup?.items) && scene.draftMarkup.items.length > 0;
  const vibeMode = scene.vibeMode ?? "off";

  const runBranchFromHistory = (record: any) => {
    const ok = branchFromHistory(record);
    if (!ok) {
      pushSnack("History record missing image or markup.");
      return;
    }
    setHistoryPickerFor(null);
    setBranchConfirmFor(null);
    const nextScene = useEditorStore.getState().scene;
    savePendingLocal({
      sceneId: nextScene.sceneId,
      baseImageUrl: nextScene.baseImageUrl,
      baseImageWidthPx: nextScene.baseImageWidthPx,
      baseImageHeightPx: nextScene.baseImageHeightPx,
      vibeMode: nextScene.vibeMode,
      draftMarkup: nextScene.draftMarkup,
      stage3: buildPendingStage3Payload(stage3SkuItems, stage3ShowCatalog),
    });
    setWorkingImageUrl(nextScene.baseImageUrl ?? null);
    setScenePlacements([]);
    setSelectedPlacementId(null);
    pushSnack("Branched from history.");
  };

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

  const STAGE5_DEV_BYPASS = process.env.NODE_ENV !== "production";

  const runStage = async (stageNumber: WorkflowStage, options: Record<string, unknown> = {}) => {
    if (stageNumber === 5 && !hasFurniturePass && !STAGE5_DEV_BYPASS) {
      pushSnack("Stage 5 is locked until Stage 3 furniture pass succeeds.");
      return null;
    }

    setStageStatus((prev) => ({ ...prev, [stageNumber]: "running" }));

    try {
      const payload: Record<string, unknown> = {
        stage: stageNumber,
      };
      const candidateUrl = workingImageUrl ?? scene.baseImageUrl ?? null;
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
          payload.eligibleSkus = activeItems.map((item) => ({
            skuId: item.skuId,
            label: item.label || item.skuId,
            variants: (item.variants ?? [])
              .filter(
                (variant): variant is { imageUrl: string } =>
                  !!variant && typeof variant.imageUrl === "string"
              )
              .map((variant) => ({ imageUrl: variant.imageUrl })),
          }));
          payload.targetCount = 8;
        } else if (stageNumber === 4) {
          payload.eligibleSkus = IKEA_CA_SKUS.map((s) => ({
            skuId: s.skuId,
            label: s.displayName ?? s.skuId,
            variants: s.imageUrl ? [{ imageUrl: s.imageUrl }] : [],
          }));
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
        console.log("[stage3][pre-post][payload-json]", JSON.stringify(payload, null, 2));
      }

      console.log("stage-run payload", payload);
      const res = await fetch("/api/vibode/stage-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      setStageStatus((prev) => ({ ...prev, [stageNumber]: "success" }));
      setLastStageOutputs((prev) => ({ ...prev, [stageNumber]: json }));
      setWorkingImageUrl(nextImageUrl);
      setBaseImageUrl(nextImageUrl);

      if (stageNumber === 3) {
        setHasFurniturePass(true);
      }

      pushSnack(`Stage ${stageNumber} complete.`);
      return json;
    } catch (err: any) {
      setStageStatus((prev) => ({ ...prev, [stageNumber]: "error" }));
      pushSnack(err?.message ?? `Stage ${stageNumber} failed.`);
      return null;
    }
  };

  const runEdit = async (
    action: EditAction,
    payloadParts: Partial<VibodeEditRunRequest> = {}
  ): Promise<VibodeEditRunResponse | null> => {
    const baseImageUrl = workingImageUrl;
    if (!baseImageUrl) {
      const message = "No working image yet. Run a stage or upload a room photo first.";
      setEditWarning(message);
      console.warn("[edit-run] blocked: workingImageUrl missing");
      pushSnack(message);
      return null;
    }

    setIsEditRunning(true);
    setEditWarning(null);

    try {
      const body: VibodeEditRunRequest = {
        baseImageUrl,
        action,
        placements: payloadParts.placements ?? scenePlacements,
        target: payloadParts.target,
        params: payloadParts.params,
        eligibleSkus: payloadParts.eligibleSkus,
      };

      const res = await fetch("/api/vibode/edit-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      setWorkingImageUrl(json.imageUrl);
      setBaseImageUrl(json.imageUrl);
      if (Array.isArray(json.placements)) {
        setScenePlacements(json.placements);
      }
      pushSnack(`Applied ${action}.`);
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

  const warnEdit = (message: string) => {
    setEditWarning(message);
    console.warn(`[edit-run] ${message}`);
    pushSnack(message);
  };

  const requireSelectedPlacement = () => {
    if (!selectedPlacementId) {
      warnEdit("Select a placement first.");
      return null;
    }
    return selectedPlacementId;
  };

  const requireSelectedSku = () => {
    if (!selectedEditSkuId) {
      warnEdit("Choose an active Stage 3 SKU first.");
      return null;
    }
    return selectedEditSkuId;
  };

  const ghostPlacementToNodeId = (placementId: string | null): string | null => {
    if (!placementId) return null;
    if (!placementId.startsWith("pl_")) return null;
    return placementId.slice(3);
  };

  const toNormalizedPlacementBbox = (
    transform: FurnitureNode["transform"]
  ): ScenePlacement["bbox"] | undefined => {
    if (
      !viewport ||
      typeof baseImageNaturalWidth !== "number" ||
      !Number.isFinite(baseImageNaturalWidth) ||
      baseImageNaturalWidth <= 0 ||
      typeof baseImageNaturalHeight !== "number" ||
      !Number.isFinite(baseImageNaturalHeight) ||
      baseImageNaturalHeight <= 0
    ) {
      return undefined;
    }

    const imageTransform = toImageSpaceTransform(transform, viewport);
    const values = [
      imageTransform.x,
      imageTransform.y,
      imageTransform.width,
      imageTransform.height,
      baseImageNaturalWidth,
      baseImageNaturalHeight,
    ];
    if (!values.every((value) => Number.isFinite(value))) return undefined;

    return {
      x: imageTransform.x / baseImageNaturalWidth,
      y: imageTransform.y / baseImageNaturalHeight,
      w: imageTransform.width / baseImageNaturalWidth,
      h: imageTransform.height / baseImageNaturalHeight,
    };
  };

  const clearGhostAddDraft = (notify = true) => {
    const placementId = ghostAddPlacementId;
    const nodeId = ghostPlacementToNodeId(placementId);
    if (nodeId) {
      if (selectedNodeId === nodeId) {
        selectNode(null);
      }
      deleteNode(nodeId);
    }
    if (placementId) {
      setScenePlacements((prev) => prev.filter((placement) => placement.placementId !== placementId));
      if (selectedPlacementId === placementId) {
        setSelectedPlacementId(null);
      }
    }
    if (ghostAddPlacementId || ghostAddActive) {
      setGhostAddPlacementId(null);
      setGhostAddActive(false);
      if (notify) pushSnack("Ghost add cancelled.");
    }
  };

  const addRemoveMarker = () => {
    const markerNodeId = `remove_mark_${Date.now()}`;
    const markerSize = 56;
    const centerX = viewport ? viewport.imageStageX + viewport.imageStageW / 2 : markerSize * 2;
    const centerY = viewport ? viewport.imageStageY + viewport.imageStageH / 2 : markerSize * 2;
    const transform: FurnitureNode["transform"] = {
      x: centerX - markerSize / 2,
      y: centerY - markerSize / 2,
      width: markerSize,
      height: markerSize,
      rotation: 0,
    };
    const zIndex = nodes.length ? Math.max(...nodes.map((node) => node.zIndex ?? 0)) + 1 : 10;

    addNode({
      id: markerNodeId,
      skuId: "__remove_marker__",
      label: "❌ Remove Marker",
      status: "active",
      zIndex,
      transform,
    });
    selectNode(markerNodeId);
    setEditWarning(null);
    pushSnack("Remove marker added. Drag it to target area, then click Remove Selected.");
  };

  const removeSelectedMarker = async () => {
    if (!selectedRemoveMarkerNode) {
      warnEdit("Select a remove marker first.");
      return;
    }
    const bbox = toNormalizedPlacementBbox(selectedRemoveMarkerNode.transform);
    if (!bbox) {
      warnEdit("Remove marker missing bbox; try dragging after image loads.");
      return;
    }

    const targetPlacement: ScenePlacement = {
      placementId: selectedRemoveMarkerNode.id,
      skuId: selectedRemoveMarkerNode.skuId || "__remove_marker__",
      label: selectedRemoveMarkerNode.label || "Remove Marker",
      bbox,
      rotationDeg: selectedRemoveMarkerNode.transform.rotation,
      stageAdded: activeStage || 3,
      locked: false,
    };

    const placementsForRemove = [...scenePlacements, targetPlacement];
    const res = await runEdit("remove", {
      target: { placementId: targetPlacement.placementId },
      placements: placementsForRemove,
    });
    if (!res) return;
    deleteNode(selectedRemoveMarkerNode.id);
    setEditWarning(null);
  };

  const removeAllMarkersSinglePass = async () => {
    if (!removeMarkerNodes.length) {
      warnEdit("Add at least one remove marker first.");
      return;
    }

    const syntheticTargets: ScenePlacement[] = [];
    for (const marker of removeMarkerNodes) {
      const bbox = toNormalizedPlacementBbox(marker.transform);
      if (!bbox) {
        warnEdit("A remove marker is missing bbox; try dragging after image loads.");
        return;
      }
      syntheticTargets.push({
        placementId: marker.id,
        skuId: "__remove_marker__",
        label: "Remove Marker",
        bbox,
        rotationDeg: marker.transform.rotation,
        stageAdded: activeStage || 3,
        locked: false,
      });
    }

    const removeTargets = syntheticTargets.map((t) => ({
      placementId: t.placementId,
      bbox: t.bbox,
    }));

    const res = await runEdit("remove", {
      target: { placementId: syntheticTargets[0].placementId },
      placements: [...scenePlacements, ...syntheticTargets],
      params: { removeTargets },
    });
    if (!res) return;

    removeMarkerNodes.forEach((marker) => {
      deleteNode(marker.id);
    });
    setEditWarning(null);
  };

  const startGhostAdd = () => {
    const skuId = requireSelectedSku();
    if (!skuId) return;

    const selectedSku = stage3SkuItemsActive.find((sku) => sku.skuId === skuId);
    if (!selectedSku) {
      warnEdit("Choose an active Stage 3 SKU first.");
      return;
    }

    if (ghostAddActive || ghostAddPlacementId) {
      clearGhostAddDraft(false);
    }

    const now = Date.now();
    const ghostNodeId = `ghost_${now}`;
    const placementId = `pl_ghost_${now}`;
    const fallbackSize = { width: 180, height: 120 };
    const eligibleSku = eligibleForDrag.find((item) => item.skuId === skuId);
    const ikeaSku = findIkeaSkuById(skuId);
    const ikeaFootprint = ikeaSku ? skuFootprintInchesFromDims(ikeaSku.dimsIn) : null;
    const widthPx =
      eligibleSku?.defaultPxWidth ??
      (ikeaFootprint ? Math.max(24, Math.round(ikeaFootprint.wIn * DEFAULT_PX_PER_IN)) : fallbackSize.width);
    const heightPx =
      eligibleSku?.defaultPxHeight ??
      (ikeaFootprint ? Math.max(24, Math.round(ikeaFootprint.dIn * DEFAULT_PX_PER_IN)) : fallbackSize.height);
    const centerX = viewport ? viewport.imageStageX + viewport.imageStageW / 2 : widthPx * 1.5;
    const centerY = viewport ? viewport.imageStageY + viewport.imageStageH * 0.58 : heightPx * 1.8;
    const transform: FurnitureNode["transform"] = {
      x: centerX - widthPx / 2,
      y: centerY - heightPx / 2,
      width: widthPx,
      height: heightPx,
      rotation: 0,
    };

    addNode({
      id: ghostNodeId,
      skuId,
      label: selectedSku.label || skuId,
      status: "active",
      zIndex: nodes.length ? Math.max(...nodes.map((node) => node.zIndex ?? 0)) + 1 : 10,
      transform,
    });
    selectNode(ghostNodeId);

    const placementDraft: ScenePlacement = {
      placementId,
      skuId,
      label: selectedSku.label || skuId,
      source: selectedSku.source,
      bbox: toNormalizedPlacementBbox(transform),
      rotationDeg: 0,
      stageAdded: activeStage || 3,
      locked: false,
    };

    setScenePlacements((prev) => [...prev.filter((placement) => placement.placementId !== placementId), placementDraft]);
    setSelectedPlacementId(placementId);
    setGhostAddPlacementId(placementId);
    setGhostAddActive(true);
    setEditWarning(null);
    pushSnack("Ghost add started. Drag/rotate, then commit in the next step.");
  };

  const commitGhostAdd = async () => {
    if (!ghostAddActive || !ghostAddPlacementId) return;

    const placement = scenePlacements.find((item) => item.placementId === ghostAddPlacementId);
    if (!placement) {
      warnEdit("Ghost placement not found.");
      return;
    }
    if (!placement.bbox) {
      warnEdit("Ghost placement missing bbox; try dragging after image loads.");
      return;
    }

    const x = placement.bbox.x + placement.bbox.w / 2;
    const y = placement.bbox.y + placement.bbox.h / 2;
    const placementsForCommit = scenePlacements.filter(
      (item) => item.placementId !== ghostAddPlacementId
    );

    console.log("[commit-add] payload", {
      x,
      y,
      skuId: placement.skuId,
      baseImageUrl: workingImageUrl,
      placementCount: placementsForCommit.length,
    });

    const previousSelectedPlacementId = selectedPlacementId;
    const res = await runEdit("add", {
      target: { skuId: placement.skuId },
      params: { x, y },
      eligibleSkus: stage3SkuItemsActive,
      placements: placementsForCommit,
    });
    console.log("[commit-add] response", res);

    if (!res) return;

    const responsePlacements = Array.isArray(res.placements) ? res.placements : null;
    clearGhostAddDraft(false);

    if (responsePlacements) {
      setScenePlacements(responsePlacements);
      if (responsePlacements.length > 0) {
        const nextSelectedPlacementId =
          previousSelectedPlacementId &&
          responsePlacements.some((item) => item.placementId === previousSelectedPlacementId)
            ? previousSelectedPlacementId
            : responsePlacements[responsePlacements.length - 1]?.placementId ?? null;
        if (nextSelectedPlacementId) {
          setSelectedPlacementId(nextSelectedPlacementId);
        }
      }
    }
  };

  useEffect(() => {
    if (!ghostAddActive || !ghostAddPlacementId) return;
    const ghostNodeId = ghostPlacementToNodeId(ghostAddPlacementId);
    if (!ghostNodeId) return;
    const ghostNode = nodes.find((node) => node.id === ghostNodeId);
    if (!ghostNode) {
      setScenePlacements((prev) =>
        prev.filter((placement) => placement.placementId !== ghostAddPlacementId)
      );
      if (selectedPlacementId === ghostAddPlacementId) {
        setSelectedPlacementId(null);
      }
      setGhostAddPlacementId(null);
      setGhostAddActive(false);
      return;
    }
    setScenePlacements((prev) =>
      prev.map((placement) =>
        placement.placementId === ghostAddPlacementId
          ? {
              ...placement,
              skuId: ghostNode.skuId,
              label: placement.label || ghostNode.label || ghostNode.skuId,
              bbox: toNormalizedPlacementBbox(ghostNode.transform),
              rotationDeg: ghostNode.transform.rotation,
              stageAdded: placement.stageAdded ?? activeStage,
              locked: false,
            }
          : placement
      )
    );
  }, [
    activeStage,
    baseImageNaturalHeight,
    baseImageNaturalWidth,
    ghostAddActive,
    ghostAddPlacementId,
    nodes,
    selectedPlacementId,
    viewport,
  ]);

  useEffect(() => {
    if (!ghostAddPlacementId && !ghostAddActive) return;
    if (!ghostAddPlacementId) {
      setGhostAddActive(false);
      return;
    }
    const ghostNodeId = ghostPlacementToNodeId(ghostAddPlacementId);
    const hasPlacement = scenePlacements.some((placement) => placement.placementId === ghostAddPlacementId);
    const hasNode = ghostNodeId ? nodes.some((node) => node.id === ghostNodeId) : false;
    if (!hasPlacement || !hasNode) {
      setGhostAddPlacementId(null);
      setGhostAddActive(false);
    }
  }, [ghostAddActive, ghostAddPlacementId, nodes, scenePlacements]);

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
    const moveMarks = scene.moveMarks ?? [];
    const hasAnyActiveNodes = nodes.some((n) => n.status !== "markedForDelete");
    const hasToolMarks =
      removeMarks.length > 0 ||
      queuedSwaps > 0 ||
      rotateMarks.length > 0 ||
      moveMarks.length > 0;
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

      setLastFreezePayload(payload);

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
      
      const useFullVibe = isVibeStage && fullVibeEnabled;
      const freezePayloadForRequest =
        isVibeStage && isRecord(payload)
          ? {
              ...payload,
              vibodeIntent: {
                ...(isRecord(payload.vibodeIntent) ? payload.vibodeIntent : {}),
                enhancePhoto: enhancePhotoEnabled,
                heavyDeclutter: heavyDeclutterEnabled,
              },
            }
          : payload;
      const vibodeRoute = isRemoveMode
        ? "/api/vibode/remove"
        : isSwapMode
          ? "/api/vibode/swap"
          : isRotateMode
            ? "/api/vibode/generate"
            : isVibeStage
              ? useFullVibe
                ? "/api/vibode/full-vibe"
                : "/api/vibode/vibe"
            : "/api/vibode/compose";
      const res = await fetch(vibodeRoute, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          freeze: freezePayloadForRequest,
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
        useFullVibe,
        fullVibeEnabled,
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
      
      const genId = typeof j?.generationId === "string" ? j.generationId : useFullVibe ? localGenId : null;

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

  return (
    <div className="h-dvh w-full bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex h-12 items-center justify-between border-b border-neutral-800 px-4">
        <div className="flex items-center gap-3">
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
            disabled={!lastAction}
            onClick={() => {
              undoLastAction();
              pushSnack("Undid last action.");
            }}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              lastAction
                ? "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                : "border-neutral-800 bg-neutral-950 text-neutral-500"
            }`}
            title={lastAction ? "Undo last action" : "Nothing to undo"}
          >
            Undo
          </button>

          <div className="flex flex-col items-end gap-0.5">
            <label className="mb-1 flex cursor-pointer items-center gap-1 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={fullVibeEnabled}
                onChange={(e) => setFullVibeEnabled(e.target.checked)}
                className="h-3.5 w-3.5 accent-sky-400"
              />
              ✨ Full Vibe
            </label>
            <div className="relative mb-1">
              <button
                type="button"
                onClick={() => setAdvancedOpen((prev) => !prev)}
                className="text-xs text-neutral-400 transition-colors hover:text-neutral-200"
              >
                {advancedOpen ? "Advanced ▾" : "Advanced ▸"}
              </button>
              {advancedOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-neutral-700 bg-neutral-900/95 p-2 shadow-lg">
                  <div className="flex flex-col items-end gap-1 text-xs text-neutral-300">
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={enhancePhotoEnabled}
                        onChange={(e) => setEnhancePhotoEnabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-sky-400"
                      />
                      Enhance Photo
                    </label>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={heavyDeclutterEnabled}
                        onChange={(e) => setHeavyDeclutterEnabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-sky-400"
                      />
                      Heavy Declutter
                    </label>
                  </div>
                </div>
              )}
            </div>
            <button
              className={`rounded-md border px-3 py-1.5 text-sm ${
                isBusy || !isImageSpaceReady
                  ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                  : vibeMode === "on"
                  ? "border-sky-600/60 bg-sky-950/40 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.25)] hover:bg-sky-900/40"
                  : "border-[rgba(148,163,184,0.50)] bg-neutral-900 text-slate-200 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)] hover:bg-neutral-800"
              }`}
              onClick={onGenerate}
              disabled={isBusy || !isImageSpaceReady}
              title={
                isBusy ? "Generating…" : !isImageSpaceReady ? "Initializing image…" : "Generate"
              }
            >
              {isBusy ? "Generating…" : "Generate"}
            </button>
            {!isBusy && !isImageSpaceReady && (
              <div className="text-xs text-neutral-400" aria-live="polite">
                Initializing image...
              </div>
            )}
            {!isBusy && hasOverlaps && (
              <div className="text-xs text-amber-400" aria-live="polite">
                ⚠ Possible overlap detected. Vibode will attempt to stage items naturally in the
                available space — results may vary.
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex h-[calc(100dvh-3rem)] w-full">
        {/* Left tool rail */}
        <aside className="flex w-14 flex-col items-center gap-2 border-r border-neutral-800 bg-neutral-950 py-3">
          {[
            { label: "V", tool: "select" as const, title: "Select/Move" },
            { label: "F", tool: "furniture" as const, title: "Furniture" },
            { label: "M", tool: "mask" as const, title: "Mask" },
            { label: "R", tool: "remove" as const, title: "Remove (red X marks)" },
            { label: "S", tool: "swap" as const, title: "Swap (blue replacement marks)" },
            { label: "⟳", tool: "rotate" as const, title: "Rotate (purple rotate markers)" },
            {
              label: <MoveIcon className="mx-auto h-4 w-4" />,
              tool: "move" as const,
              title: "Move (direction + distance markers)",
            },
            { label: "C", tool: "calibrate" as const, title: "Calibrate (User line)" },
          ].map((t) => {
            const isActive = activeTool === t.tool;
            return (
              <button
                key={t.tool}
                onClick={() => {
                  setActiveTool(t.tool);
                  if (t.tool === "calibrate") {
                    beginCalibration();
                    pushSnack("Calibration mode: click point 1 then point 2.");
                  } else if (t.tool === "remove") {
                    pushSnack("Remove mode: click on the image to place red X markers.");
                  } else if (t.tool === "swap") {
                    pushSnack("Swap mode: click to place blue marks, then choose a replacement.");
                  } else if (t.tool === "rotate") {
                    pushSnack("Rotate mode: click to place a marker, then adjust angle in the panel.");
                  } else if (t.tool === "move") {
                    pushSnack("Move mode: click an object, then drag to set direction and distance.");
                  }
                }}
                className={`h-10 w-10 rounded-md border text-sm ${
                  isActive
                    ? "border-neutral-600 bg-neutral-800"
                    : "border-neutral-800 bg-neutral-900 hover:bg-neutral-800"
                }`}
                title={t.title}
                aria-label={t.title}
              >
                {t.label}
              </button>
            );
          })}
        </aside>

        {/* Canvas area */}
        <main className="flex flex-1 items-center justify-center bg-neutral-950">
          {/* OUTER: owns glow pseudo-elements (NO overflow-hidden) */}
          <div
            className={`relative h-[70vh] w-[70vw] max-w-[1200px] rounded-lg precision-ring ${
              vibeMode === "on" ? "vibe-glow vibe-aura vibe-aura-animate" : ""
            }`}
          >
            {/* INNER: clips canvas contents + keeps border/bg */}
            <div
              className={`relative h-full w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 ${
                isBusy ? "blur-[1px] brightness-90" : ""
              }`}
            >
              <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                <div
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    vibeMode === "on"
                      ? "border-sky-500/70 bg-sky-950/70 text-sky-100"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300"
                  }`}
                  title={
                    vibeMode === "on"
                      ? "Vibode may style the room more broadly for a cohesive result."
                      : "Changes should be limited to your markup placements."
                  }
                >
                  {vibeMode === "on" ? "Vibe Mode" : "Precision Mode"}
                </div>

                <button
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    vibeMode === "on"
                      ? "border-sky-700/60 bg-sky-950/50 text-sky-100 hover:bg-sky-900/40"
                      : "border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800"
                  }`}
                  onClick={() => setVibeMode(vibeMode === "on" ? "off" : "on")}
                  title={vibeMode === "on" ? "Switch to Precision Mode" : "Switch to Vibe Mode"}
                >
                  Vibe: {vibeMode === "on" ? "On" : "Off"}
                </button>

                <button
                  type="button"
                  className="rounded-full border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800"
                  onClick={() =>
                    setVisualMode((cur) => (cur === "blueprint" ? "thumbnails" : "blueprint"))
                  }
                  title={
                    visualMode === "blueprint"
                      ? "Switch to thumbnail mode"
                      : "Switch to blueprint mode"
                  }
                >
                  {visualMode === "blueprint" ? "Blueprint" : "Thumbs"}
                </button>

                <button
                  type="button"
                  className="rounded-full border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800"
                  onClick={() => setAddOpen(true)}
                  title="Add furniture"
                >
                  ➕ Add
                </button>
              </div>

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
                className="absolute inset-0"
                markupVisible={scene.markupVisible}
                visualMode={visualMode}
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
        <aside className="w-[340px] border-l border-neutral-800 bg-neutral-950">
          <div className="border-b border-neutral-800 px-4 py-3">
            <div className="text-sm font-medium">Panels</div>
            <div className="mt-1 text-xs text-neutral-400">
              Setup → Working Set → Edit → Generate (V0)
            </div>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Workflow</div>
              <div className="mt-1 text-xs text-neutral-400">Five-stage editor workflow skeleton.</div>

              <div className="mt-3 grid grid-cols-5 gap-1">
                {WORKFLOW_STAGES.map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setActiveStage(stage)}
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
                        disabled={stageStatus[1] === "running"}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          stageStatus[1] === "running"
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
                        disabled={stageStatus[1] === "running"}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          stageStatus[1] === "running"
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
                        disabled={stageStatus[2] === "running"}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          stageStatus[2] === "running"
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                        }`}
                      >
                        {stageStatus[2] === "running" ? "Running…" : "Run Stage"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => runStage(activeStage)}
                      disabled={
                        stageStatus[activeStage] === "running" ||
                        stage5Locked
                      }
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        stageStatus[activeStage] === "running" ||
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
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Edit Tools (All Stages)</div>
              <div className="mt-1 text-xs text-neutral-400">
                Calls `/api/vibode/edit-run` using the canonical working image.
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                Placements: {scenePlacements.length} • Selected: {selectedPlacementId ?? "none"}
              </div>
              {editWarning && (
                <div className="mt-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-xs text-amber-200">
                  {editWarning}
                </div>
              )}

              <div className="mt-3">
                <div className="text-xs text-neutral-400">Choose placement</div>
                {scenePlacements.length === 0 ? (
                  <div className="mt-1 rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-2 py-2 text-xs text-neutral-500">
                    No placements yet. Run Add first, or wait for placements from edit-run response.
                  </div>
                ) : (
                  <div className="mt-1 max-h-28 space-y-1 overflow-auto pr-1">
                    {scenePlacements.map((placement) => {
                      const isSelected = placement.placementId === selectedPlacementId;
                      return (
                        <button
                          key={placement.placementId}
                          type="button"
                          onClick={() => {
                            setSelectedPlacementId(placement.placementId);
                            setEditWarning(null);
                          }}
                          className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                            isSelected
                              ? "border-sky-500/60 bg-sky-950/30 text-sky-100"
                              : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-800"
                          }`}
                        >
                          <div className="truncate">
                            {placement.label || placement.skuId || placement.placementId}
                          </div>
                          <div className="truncate text-[10px] text-neutral-500">
                            {placement.placementId}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <div className="text-xs text-neutral-400">SKU for Add / Swap</div>
                <select
                  value={selectedEditSkuId}
                  onChange={(e) => {
                    setSelectedEditSkuId(e.target.value);
                    setEditWarning(null);
                  }}
                  className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-neutral-600"
                >
                  <option value="">Select SKU</option>
                  {stage3SkuItemsActive.map((sku) => (
                    <option key={sku.skuId} value={sku.skuId}>
                      {sku.label} ({sku.skuId})
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3">
                <div className="text-xs text-neutral-400">Furniture</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isEditRunning}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      isEditRunning
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    }`}
                    onClick={startGhostAdd}
                  >
                    Start Add (ghost)
                  </button>
                  <button
                    type="button"
                    disabled={isEditRunning || !workingImageUrl}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      isEditRunning || !workingImageUrl
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    }`}
                    onClick={() => {
                      const placementId = requireSelectedPlacement();
                      const newSkuId = requireSelectedSku();
                      if (!placementId || !newSkuId) return;
                      void runEdit("swap", {
                        target: { placementId },
                        params: { newSkuId },
                        eligibleSkus: stage3SkuItemsActive,
                      });
                    }}
                  >
                    Swap Selected
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {ghostAddActive ? (
                  <button
                    type="button"
                    onClick={() => clearGhostAddDraft(true)}
                    className="rounded-md border border-rose-800/60 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-100 hover:bg-rose-900/40"
                  >
                    Cancel ghost
                  </button>
                ) : (
                  <div />
                )}
                <button
                  type="button"
                  disabled={isEditRunning || !ghostAddActive || !ghostAddPlacementId}
                  title="Commit will generate into image (next step)"
                  onClick={() => {
                    void commitGhostAdd();
                  }}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    !isEditRunning && ghostAddActive && ghostAddPlacementId
                      ? "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                      : "border-neutral-900 bg-neutral-950 text-neutral-500"
                  }`}
                >
                  Commit Add (next)
                </button>
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Commit will generate into image (next step)
              </div>

              <div className="mt-4">
                <div className="text-xs text-neutral-400">Remove</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isEditRunning}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      isEditRunning
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    }`}
                    onClick={addRemoveMarker}
                  >
                    Add Remove Marker
                  </button>
                  <button
                    type="button"
                    disabled={isEditRunning || !workingImageUrl || !selectedRemoveMarkerNode}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      isEditRunning || !workingImageUrl || !selectedRemoveMarkerNode
                        ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    }`}
                    onClick={() => {
                      void removeSelectedMarker();
                    }}
                  >
                    Remove Selected
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isEditRunning || removeMarkerNodes.length === 0}
                  className={`mt-2 w-full rounded-md border px-2 py-1.5 text-xs ${
                    isEditRunning || removeMarkerNodes.length === 0
                      ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                      : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                  }`}
                  onClick={() => {
                    void removeAllMarkersSinglePass();
                  }}
                >
                  Remove All Markers
                </button>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {`Remove markers: ${removeMarkerNodes.length}`}
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-neutral-400">Rotate ({Math.round(editRotationDeg)}°)</div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={editRotationDeg}
                  onChange={(e) => {
                    setEditRotationDeg(Number(e.target.value));
                    setEditWarning(null);
                  }}
                  className="mt-1 w-full accent-violet-400"
                />
                <button
                  type="button"
                  disabled={isEditRunning || !workingImageUrl}
                  className={`mt-2 w-full rounded-md border px-2 py-1.5 text-xs ${
                    isEditRunning || !workingImageUrl
                      ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                      : "border-violet-800/60 bg-violet-950/30 text-violet-100 hover:bg-violet-900/40"
                  }`}
                  onClick={() => {
                    const placementId = requireSelectedPlacement();
                    if (!placementId) return;
                    void runEdit("rotate", {
                      target: { placementId },
                      params: { rotationDeg: editRotationDeg },
                    });
                  }}
                >
                  Apply rotate
                </button>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Move step</span>
                  <input
                    type="number"
                    min={0.01}
                    max={0.3}
                    step={0.01}
                    value={editMoveStep}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (Number.isFinite(next) && next > 0) {
                        setEditMoveStep(next);
                      }
                    }}
                    className="w-16 rounded border border-neutral-800 bg-neutral-950 px-1 py-0.5 text-right text-xs outline-none focus:border-neutral-600"
                  />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <div />
                  <button
                    type="button"
                    disabled={isEditRunning || !workingImageUrl}
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 hover:bg-neutral-800 disabled:border-neutral-900 disabled:text-neutral-600"
                    onClick={() => {
                      const placementId = requireSelectedPlacement();
                      if (!placementId) return;
                      void runEdit("move", { target: { placementId }, params: { dx: 0, dy: -editMoveStep } });
                    }}
                  >
                    Up
                  </button>
                  <div />
                  <button
                    type="button"
                    disabled={isEditRunning || !workingImageUrl}
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 hover:bg-neutral-800 disabled:border-neutral-900 disabled:text-neutral-600"
                    onClick={() => {
                      const placementId = requireSelectedPlacement();
                      if (!placementId) return;
                      void runEdit("move", { target: { placementId }, params: { dx: -editMoveStep, dy: 0 } });
                    }}
                  >
                    Left
                  </button>
                  <div />
                  <button
                    type="button"
                    disabled={isEditRunning || !workingImageUrl}
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 hover:bg-neutral-800 disabled:border-neutral-900 disabled:text-neutral-600"
                    onClick={() => {
                      const placementId = requireSelectedPlacement();
                      if (!placementId) return;
                      void runEdit("move", { target: { placementId }, params: { dx: editMoveStep, dy: 0 } });
                    }}
                  >
                    Right
                  </button>
                  <div />
                  <div />
                  <button
                    type="button"
                    disabled={isEditRunning || !workingImageUrl}
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 hover:bg-neutral-800 disabled:border-neutral-900 disabled:text-neutral-600"
                    onClick={() => {
                      const placementId = requireSelectedPlacement();
                      if (!placementId) return;
                      void runEdit("move", { target: { placementId }, params: { dx: 0, dy: editMoveStep } });
                    }}
                  >
                    Down
                  </button>
                  <div />
                </div>
              </div>
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
              <div className="text-sm font-medium">Paste Product Image (MVP)</div>
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

            {/* Setup */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Setup</div>
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
                      onChange={async (e) => {
                        const inputEl = e.currentTarget;
                        const file = inputEl.files?.[0];
                        if (!file) return;

                        // allow re-pick same file
                        inputEl.value = "";

                        setHasFurniturePass(false);
                        setStageStatus(INITIAL_STAGE_STATUS);
                        setLastStageOutputs({});
                        setWorkingImageUrl(null);
                        setScenePlacements([]);
                        setSelectedPlacementId(null);
                        setActiveStage(1);
                        clearPendingLocal();

                        // 1) Instant preview (blob)
                        setBaseImageFromFile(file);
                        pushSnack("Image loaded (local preview). Uploading to storage…");

                        // 2) Upload to storage + swap to signed URL (kills blob in payload)
                        setIsUploading(true);
                        try {
                          const sceneId = useEditorStore.getState().scene.sceneId;
                          const up = await uploadBaseImageToStorage({ file, sceneId });

                          setBaseImageUrl(up.signedUrl);
                          setWorkingImageUrl(up.signedUrl);
                          pushSnack("Image uploaded ✅ (signed URL set; blob removed).");
                        } catch (err: any) {
                          console.error(err);
                          pushSnack(
                            `Upload failed — keeping local preview. (${err?.message ?? "error"})`
                          );
                        } finally {
                          setIsUploading(false);
                        }
                      }}
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
                        setScenePlacements([]);
                        setSelectedPlacementId(null);
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

            {/* Calibration Panel */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Calibration</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    Tool C • Click 2 points on the photo, enter feet, Apply.
                  </div>
                </div>

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
              </div>

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

            {/* Selection inspector */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Selection</div>

              {selectedNode ? (
                <div className="mt-2">
                  <div className="text-sm">{selectedNode.label}</div>
                  <div className="mt-0.5 text-xs text-neutral-400">{selectedNode.skuId}</div>

                  {stagePpf ? (
                    <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                      <div className="text-xs text-neutral-400">Size (ft, live)</div>
                      <div className="mt-0.5">
                        {(selectedNode.transform.width / stagePpf).toFixed(2)} ft W •{" "}
                        {(selectedNode.transform.height / stagePpf).toFixed(2)} ft D
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-md border border-neutral-900 bg-neutral-950 px-3 py-2 text-xs text-neutral-500">
                      Size (ft) unavailable — apply calibration to enable.
                    </div>
                  )}

                  {selectedNode.variant?.label && (
                    <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                      <div className="text-xs text-neutral-400">Variant</div>
                      <div>{selectedNode.variant.label}</div>
                    </div>
                  )}

                  {selectedNode.status === "markedForDelete" && (
                    <div className="mt-2 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm">
                      <div className="text-xs text-red-200/80">Status</div>
                      <div className="text-red-100">Queued for removal</div>
                    </div>
                  )}

                  {selectedNode.status === "pendingSwap" && (
                    <div className="mt-2 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm">
                      <div className="text-xs text-red-200/80">Status</div>
                      <div className="text-red-100">Swap pending</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-sm text-neutral-400">No selection</div>
              )}
            </div>

            {/* Rotate tool inspector */}
            {activeTool === "rotate" && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="text-sm font-medium">Rotate</div>
                <div className="mt-1 text-xs text-neutral-400">
                  Click the image to place a rotate marker, then select it.
                </div>

                {!selectedRotateMark ? (
                  <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-400">
                    Click the image to place a rotate marker, then select it.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-md border border-violet-900/40 bg-violet-950/20 px-3 py-2">
                      <div className="text-xs text-violet-200/80">Angle</div>
                      <div className="mt-1 text-base font-medium text-violet-100">
                        {formatSignedDegrees(selectedRotateMark.angleDeg)}
                      </div>
                    </div>

                    <div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={Math.round(selectedRotateMark.angleDeg)}
                        onChange={(e) =>
                          updateRotateMark(selectedRotateMark.id, {
                            angleDeg: Number(e.target.value),
                          })
                        }
                        className="w-full accent-violet-400"
                      />
                      <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                        <span>-180°</span>
                        <span>0°</span>
                        <span>+180°</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:bg-neutral-800"
                        onClick={() => removeRotateMark(selectedRotateMark.id)}
                      >
                        Delete marker
                      </button>
                      <button
                        type="button"
                        disabled={!canApplyRotate || isBusy || !isImageSpaceReady}
                        title={!canApplyRotate ? "Select a rotate marker to apply." : undefined}
                        onClick={onGenerate}
                        className={`rounded-md border px-3 py-1.5 text-sm ${
                          !canApplyRotate || isBusy || !isImageSpaceReady
                            ? "border-neutral-900 bg-neutral-950 text-neutral-500"
                            : "border-violet-700 bg-violet-900/30 text-violet-100 hover:bg-violet-900/50"
                        }`}
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Working Set */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Working Set</div>
              <div className="mt-1 text-xs text-neutral-400">
                Collection → Room Size Bundle → Eligible SKUs
              </div>

              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <div className="text-neutral-300">Collection</div>
                  <div className="text-neutral-400">{workingSet.collectionId ?? "—"}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-neutral-300">Bundle</div>
                  <div className="text-neutral-400">{workingSet.bundleId ?? "—"}</div>
                </div>

                <div className="pt-2">
                  <div className="text-xs font-medium text-neutral-300">Eligible SKUs</div>
                  {workingSet.eligibleSkus?.length ? (
                    <div className="mt-2 text-xs text-neutral-500">
                      {workingSet.eligibleSkus.length} items eligible (drag from Furniture panel).
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-neutral-400">
                      Not loaded yet — click Generate to load a bundle.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Furniture panel */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">Furniture</div>
              <div className="mt-2 text-xs text-neutral-400">Drag eligible items onto the canvas.</div>

              <div className="mt-3 flex flex-col gap-2">
                {eligibleForDrag.map((item: any) => (
                  <div
                    key={item.skuId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        DND_MIME,
                        JSON.stringify({
                          skuId: item.skuId,
                          label: item.label,
                        })
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="cursor-grab rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm hover:bg-neutral-800 active:cursor-grabbing"
                    title="Drag onto canvas"
                  >
                    {item.label}
                    <div className="mt-0.5 text-xs text-neutral-400">{item.skuId}</div>
                  </div>
                ))}

                {!eligibleForDrag.length && (
                  <div className="rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-3 text-sm text-neutral-400">
                    Generate to load a Working Set (bundle) for this collection.
                  </div>
                )}
              </div>
            </div>

            {/* History */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">History</div>
              <div className="mt-1 text-xs text-neutral-400">Freeze payloads (v1) per Generate</div>

              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] hover:bg-neutral-800"
                    onClick={() => toggleMarkupVisible()}
                    aria-pressed={scene.markupVisible}
                  >
                    Markup: {scene.markupVisible ? "On" : "Off"}
                  </button>
                  <button
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] hover:bg-neutral-800"
                    onClick={() => {
                      if (hasDraftMarkup) {
                        setRecallConfirmOpen(true);
                        return;
                      }
                      const ok = recallLastMarkup({ mode: "replace" });
                      if (!ok) pushSnack("No markup to recall yet.");
                    }}
                  >
                    Recall last markup
                  </button>
                </div>
                {recallConfirmOpen && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-300">
                    <span>Replace current markup?</span>
                    <button
                      className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
                      onClick={() => {
                        const ok = recallLastMarkup({ mode: "replace" });
                        setRecallConfirmOpen(false);
                        if (!ok) pushSnack("No markup to recall yet.");
                      }}
                    >
                      Replace
                    </button>
                    <button
                      className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
                      onClick={() => setRecallConfirmOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:bg-neutral-800"
                    onClick={async () => {
                      const payload = lastFreezePayload ?? latestFreeze;
                      if (!payload) {
                        pushSnack("No history yet.");
                        return;
                      }
                      try {
                        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                        pushSnack("Latest freeze JSON copied.");
                      } catch {
                        pushSnack("Clipboard blocked — use Download instead.");
                      }
                    }}
                  >
                    Copy latest JSON
                  </button>

                  <button
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:bg-neutral-800"
                    onClick={() => {
                      const payload = lastFreezePayload ?? latestFreeze;
                      if (!payload) {
                        pushSnack("No history yet.");
                        return;
                      }
                      const blob = new Blob([JSON.stringify(payload, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      const rawGenId = getFreezePayloadAccess(payload).generationId;
                      const downloadGenId =
                        typeof rawGenId === "string" && rawGenId.trim() ? rawGenId : "unknown";
                      a.download = `vibode_freeze_${downloadGenId}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 500);
                      pushSnack("Downloaded freeze JSON.");
                    }}
                  >
                    Download latest
                  </button>
                </div>

                {history.length === 0 ? (
                  <div className="rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-3 text-sm text-neutral-400">
                    No generations yet.
                  </div>
                ) : (
                  history.slice(0, 6).map((h: any) => {
                    const thumbUrl =
                      h.outputImageUrl ||
                      h.compositeImageUrl ||
                      h.freeze?.baseImage?.url ||
                      h.freeze?.sceneSnapshot?.baseImageUrl ||
                      h.freeze?.sceneSnapshotImageSpace?.baseImageUrl ||
                      null;
                    const isPickerOpen = historyPickerFor === h.generationId;

                    return (
                      <div
                        key={`${h.generationId}_${h.createdAtIso ?? ""}`}
                        className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2"
                      >
                        <div className="text-sm">Generation</div>
                        <div className="mt-0.5 text-xs text-neutral-400">
                          {h.createdAtIso ? new Date(h.createdAtIso).toLocaleString() : "—"}
                        </div>

                        {thumbUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setHistoryPickerFor((prev) => {
                                const next = prev === h.generationId ? null : h.generationId;
                                setBranchConfirmFor(null);
                                return next;
                              })
                            }
                            className="mt-2 aspect-[4/3] w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 text-left"
                            aria-label="Choose history load option"
                            aria-expanded={isPickerOpen}
                          >
                            <img
                              src={thumbUrl}
                              alt="Generation thumbnail"
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="mt-2 aspect-[4/3] w-full rounded-md border border-neutral-800 bg-neutral-950 text-xs text-neutral-500 flex items-center justify-center">
                            No preview
                          </div>
                        )}

                        {thumbUrl && isPickerOpen && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                loadHistoryImage(h);
                                setWorkingImageUrl(null);
                                setScenePlacements([]);
                                setSelectedPlacementId(null);
                                setHistoryPickerFor(null);
                                setBranchConfirmFor(null);
                              }}
                              className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] hover:bg-neutral-800"
                            >
                              Image
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                loadHistoryMarkup(h);
                                setHistoryPickerFor(null);
                                setBranchConfirmFor(null);
                              }}
                              className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] hover:bg-neutral-800"
                            >
                              Markup
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                loadHistoryBoth(h);
                                setWorkingImageUrl(null);
                                setScenePlacements([]);
                                setSelectedPlacementId(null);
                                setHistoryPickerFor(null);
                                setBranchConfirmFor(null);
                              }}
                              className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] hover:bg-neutral-800"
                            >
                              Both
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (hasDraftMarkup) {
                                  setBranchConfirmFor(h.generationId ?? null);
                                  return;
                                }
                                runBranchFromHistory(h);
                              }}
                              className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] hover:bg-neutral-800"
                            >
                              Branch
                            </button>
                          </div>
                        )}
                        {branchConfirmFor === h.generationId && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-300">
                            <span>Replace current markup?</span>
                            <button
                              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
                              onClick={() => runBranchFromHistory(h)}
                            >
                              Replace
                            </button>
                            <button
                              className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
                              onClick={() => setBranchConfirmFor(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        )}

                        {/* ✅ FIX: correct v1 fields */}
                        <div className="mt-2 text-xs text-neutral-500">
                          Nodes: {h.freeze?.sceneSnapshotImageSpace?.nodes?.length ?? 0} • SKU IDs:{" "}
                          {h.freeze?.workingSetSnapshot?.skuIdsInPlay?.length ?? 0}
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">
                          Image-space: {h.freeze?.sceneSnapshotImageSpace ? "yes" : "no"} • v:{" "}
                          {h.freeze?.payloadVersion ?? "—"}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* AI actions */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-sm font-medium">AI Actions</div>
              <div className="mt-2 flex flex-col gap-2">
                {["Cleanup Room", "Restage (Coming soon)"].map((txt) => (
                  <button
                    key={txt}
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-left text-sm hover:bg-neutral-800"
                    onClick={() => pushSnack("Coming soon.")}
                  >
                    {txt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>

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

      {/* Add Furniture Panel */}
      {addOpen && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-end bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div
            className="w-full max-w-[560px] rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Add Furniture</div>
                <div className="text-xs text-neutral-400">IKEA Canada catalog (v0)</div>
              </div>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800"
                onClick={() => setAddOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                {IKEA_CA_SKUS.map((sku) => (
                  <button
                    key={sku.skuId}
                    className="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left hover:bg-neutral-800"
                    onClick={() => {
                      addFurnitureNodeFromSku(sku);
                      setAddOpen(false);
                    }}
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-neutral-950">
                      <img
                        src={sku.imageUrl}
                        alt={sku.displayName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-medium text-neutral-100">{sku.displayName}</div>
                      <div className="mt-0.5 text-xs text-neutral-400">Article {sku.articleNumber}</div>
                      <div className="mt-1 text-xs text-neutral-300">{skuDimsLabel(sku)}</div>
                    </div>
                  </button>
                ))}
              </div>
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

      {/* Snackbars */}
      <SnackbarHost
        items={snacks}
        onRemove={(id) => setSnacks((prev) => prev.filter((s) => s.id !== id))}
      />
    </div>
  );
}
