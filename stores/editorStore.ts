// stores/editorStore.ts
import { create } from "zustand";
import { loadPendingLocal } from "../lib/pendingGeneration";
import type { IkeaCaSku } from "../data/mockIkeaCaSkus";
import { DEFAULT_PX_PER_IN, skuFootprintInchesFromDims } from "@/lib/ikeaSizing";
import { buildFreezePayloadV2, type EditorNodeForV2 } from "../lib/buildFreezePayloadV2";
import type {
  FreezePayloadV2,
  IntentRole,
  NodeCategory,
  RemoveMarkV2,
  SwapMarkV2,
  VibodeIntentV2,
  VibodeRotateMark,
} from "../lib/freezePayloadV2Types";
import {
  type LayerKind,
  inferLayerKindFromSkuKind,
  inferLayerKindFromCategory,
  ensureZIndex,
  getNextZIndexForLayer,
} from "../lib/layerKind";

/* =========================
   Types
========================= */

export type RoomDims = {
  widthFt?: number;
  lengthFt?: number;
  heightFt?: number;
};

export type Phase = "IDLE" | "MARKUP" | "GENERATING" | "SUCCESS" | "ERROR" | "STALL";

export type VibeMode = "on" | "off";

export type MarkupLayer = { version: "v1"; items: any[] };

export type GenerationUi = {
  startedAtMs?: number;
  slowHintShown?: boolean;
  stallHintShown?: boolean;
  message?: string;
  lastErrorUserMessage?: string;
  lastErrorDebug?: { code?: string; message?: string; raw?: any };
};

export type FurnitureVariant = {
  variantId: string;
  label?: string;
};

export type NodeTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  skewX?: number;
  skewY?: number;
};

export type FurnitureNodeStatus = "active" | "markedForDelete" | "pendingSwap";

export type FurnitureNode = {
  id: string;
  kind: "furniture";

  // product identity
  skuId: string;
  label: string;
  vendor?: "IKEA_CA";
  displayName?: string;
  articleNumber?: string;
  imageUrl?: string;
  productUrl?: string;
  dimsIn?: {
    width: number;
    depth?: number;
    height?: number;
    diameter?: number;
  };
  variant?: FurnitureVariant;

  // render + manipulate (z-order + occlusion contract for Vibode)
  layerKind?: LayerKind;
  zIndex: number;
  transform: NodeTransform;

  // workflow flags
  status: FurnitureNodeStatus;

  // provenance scaffolding (expand later)
  provenance?: {
    introducedInGenerationId?: string;
    fromBundleId?: string;
    fromCollectionId?: string;
  };

  /**
   * Swap intent (v1)
   * When status==="pendingSwap", this holds what we want to swap TO.
   * (The compositor/prompt can use it deterministically.)
   */
  pendingSwap?: {
    replacementSkuId: string;
    replacementLabel?: string;
    replacementVariantId?: string;
  };
};

export type WorkingSet = {
  collectionId?: string;
  bundleId?: string;
  eligibleSkus?: Array<{
    skuId: string;
    label: string;
    defaultPxWidth: number;
    defaultPxHeight: number;

    // scale-aware payload fields
    realWidthFt?: number;
    realDepthFt?: number;

    variants?: FurnitureVariant[];
  }>;
};

/**
 * Viewport mapping used to convert Stage (canvas) coords -> Image pixel coords.
 * scale = stage_px_per_image_px
 */
export type ViewportMapping = {
  imageStageX: number;
  imageStageY: number;
  imageStageW: number;
  imageStageH: number;
  scale: number;

  imageNaturalW: number;
  imageNaturalH: number;
};

/* ===== Calibration (PPF scaffold + user-line) ===== */

export type Calibration = {
  // pixels per foot in image-space coordinates
  ppf?: number;

  // previous ppf (for optional rescale of existing nodes)
  prevPpf?: number;

  // how we got it
  method?: "assumed-fit-width" | "user-line" | "ai-infer" | "manual";
  notes?: string;

  // persisted user-line (image space)
  userLine?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    realFeet: number;
  };

  // draft clicks (image space)
  draft?: {
    p1?: { x: number; y: number };
    p2?: { x: number; y: number };
    realFeet?: number;
  };
};

export type SceneGraph = {
  sceneId: string;
  baseImageUrl?: string;
  baseImageWidthPx?: number;
  baseImageHeightPx?: number;
  phase: Phase;
  vibeMode: VibeMode;
  draftMarkup: MarkupLayer;
  markupVisible: boolean;
  genUi: GenerationUi;
  room?: {
    dims?: RoomDims;
    sqft?: number;
    dimsMode?: "auto" | "manual";
  };
  collection?: {
    collectionId?: string;
    bundleId?: string;
  };

  // scale correctness scaffold
  calibration?: Calibration;

  nodes: FurnitureNode[];

  /** Remove marks (red X) in image-space pixels. Used when activeTool === "remove". */
  removeMarks: RemoveMarkV2[];
  /** Swap marks in image-space pixels. Used when activeTool === "swap". */
  swapMarks: SwapMarkV2[];
  /** Rotate marks in normalized image-space coordinates (0..1). Used when activeTool === "rotate". */
  rotateMarks: VibodeRotateMark[];
}

export type RequestedOps = {
  add: string[]; // ids newly introduced since last freeze
  remove: string[]; // ids markedForDelete
  swap: string[]; // ids pendingSwap
  transformChanged: string[]; // ids with transform changed since last freeze
};

export type RequestedActionBlock = {
  type: "generate";
  ops: RequestedOps;
};

export type FreezePayloadV1 = {
  payloadVersion: "v1";

  generationId: string;
  createdAtIso: string;

  baseImage: {
    kind: "publicUrl" | "signedUrl" | "storageKey";
    url?: string;
    storageKey?: string;
    widthPx?: number;
    heightPx?: number;
  };

  viewport?: ViewportMapping;

  // The compositor should ONLY trust this.
  sceneSnapshotImageSpace: SceneGraph;

  // Still useful for debugging UI issues
  sceneSnapshot: SceneGraph;

  workingSetSnapshot: WorkingSet;

  calibration?: Calibration;

  requestedAction: RequestedActionBlock;

  diffFromPrevious?: {
    previousGenerationId?: string;
    summary: string;
  };
};

export type FreezeRecord = {
  generationId: string;
  createdAtIso: string;

  // A: composite image (mock: equals current baseImageUrl for now)
  compositeImageUrl?: string;

  // If present, this freeze has a realized output image (from Nano Banana Pro).
  outputImageUrl?: string;
  outputStorageKey?: string;
  outputBucket?: string;
  outputWidthPx?: number;
  outputHeightPx?: number;

  // B: canonical freeze payload (v1)
  freeze: FreezePayloadV1;

  // Pending generate metadata (UI recovery)
  pendingMarkup?: MarkupLayer;
  pendingVibeMode?: VibeMode;
  pendingStatus?: "pending" | "success" | "error";
};

/* ===== Rescale prompt (when calibration changes) ===== */

export type RescalePrompt = {
  prevPpf: number;
  nextPpf: number;
  ratio: number;
};

type UIState = {
  activeTool: "select" | "furniture" | "mask" | "remove" | "swap" | "rotate" | "calibrate";
  selectedNodeId: string | null;
  selectedRemoveMarkId: string | null;
  selectedSwapMarkId: string | null;
  selectedRotateMarkId: string | null;

  // calibration-change UX
  rescalePrompt?: RescalePrompt;
  suppressRescalePrompt?: boolean;
};

type LastAction =
  | {
      kind: "toggleDelete";
      id: string;
      prevStatus: FurnitureNodeStatus;
      nextStatus: FurnitureNodeStatus;
    }
  | {
      kind: "setPendingSwap";
      id: string;
      prevStatus: FurnitureNodeStatus;
      nextStatus: FurnitureNodeStatus;
    }
  | null;

type EditorState = {
  scene: SceneGraph;
  workingSet: WorkingSet;
  ui: UIState;

  // viewport mapping for stage<->image coordinate conversion
  viewport?: ViewportMapping;
  setViewport: (vp?: ViewportMapping) => void;

  // generation lineage (local mock)
  history: FreezeRecord[];

  freezeNowV1: () => FreezeRecord | null;
  freezeNowV2: () => Promise<FreezePayloadV2 | null>;

  /**
   * Legacy/compat alias used by the Editor UI Generate handler.
   * Returns the FreezePayloadV1 directly (not the wrapper record).
   */
  freezeAndAppendHistory: () => FreezePayloadV1 | null;

  /**
   * NEW (Model plumbing):
   * Attach the returned staged image to the most recent freeze record,
   * and (optionally) set it as the current base image.
   */
  attachOutputToLatestFreeze: (output: {
    generationId: string;
    imageUrl: string;
    storageKey?: string;
    bucket?: string;
  }) => void;

  attachOutputAndSwapBase: (args: {
    generationId: string;
    outputImageUrl: string;
    outputBucket?: string;
    outputStorageKey?: string;
    outputWidthPx?: number;
    outputHeightPx?: number;
  }) => void;

  /**
   * NEW (History UX):
   * Set the current base image to a specific history record’s output image (or composite if no output).
   */
  setBaseImageFromHistory: (generationId: string) => boolean;

  loadHistoryImage: (record: FreezeRecord) => void;
  loadHistoryMarkup: (record: FreezeRecord) => void;
  loadHistoryBoth: (record: FreezeRecord) => void;
  branchFromHistory: (record: FreezeRecord) => boolean;

  // last-action undo (V0)
  lastAction: LastAction;
  undoLastAction: () => void;

  // UI + selection
  setActiveTool: (tool: UIState["activeTool"]) => void;
  selectNode: (id: string | null) => void;

  // node ops
  addNode: (node: Omit<FurnitureNode, "id" | "kind"> & { id?: string }) => string;
  addFurnitureNodeFromSku: (sku: IkeaCaSku) => void;
  updateNodeTransform: (id: string, patch: Partial<NodeTransform>) => void;
  setNodeStatus: (id: string, status: FurnitureNodeStatus) => void;
  deleteNode: (id: string) => void;

  // Vibode UX state machine
  setPhase: (p: Phase) => void;
  setVibeMode: (m: VibeMode) => void;
  beginMarkup: () => void;
  clearDraftMarkup: () => void;
  setDraftMarkup: (layer: MarkupLayer) => void;
  setMarkupVisible: (visible: boolean) => void;
  toggleMarkupVisible: () => void;
  recallLastMarkup: (opts?: { mode: "replace" | "append" }) => boolean;
  tryRestorePendingFromLocalStorage: () => void;
  beginGenerate: () => { sceneSnapshotForRecovery: any; markupToPersist: MarkupLayer };
  markGeneratingSlow: () => void;
  markGeneratingStall: () => void;
  endGenerateSuccess: (args: { imageUrl: string; widthPx?: number; heightPx?: number }) => void;
  endGenerateError: (args: {
    userMessage: string;
    debug?: { code?: string; message?: string; raw?: any };
  }) => void;

  // Vibode vibe-flow flags
  toggleDelete: (id: string) => void;
  setPendingSwap: (
    id: string,
    pending: boolean,
    replacement?: { skuId: string; label?: string; variantId?: string }
  ) => void;

  applySwap: (
    id: string,
    next: {
      skuId: string;
      label: string;
      variant?: FurnitureVariant;
      defaultPxWidth?: number;
      defaultPxHeight?: number;
      vendor?: FurnitureNode["vendor"];
      displayName?: string;
      articleNumber?: string;
      imageUrl?: string;
      productUrl?: string;
      dimsIn?: FurnitureNode["dimsIn"];
    }
  ) => void;

  // z-order + dev helpers
  deleteSelectedHard: () => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  duplicateNode: (id: string) => string | null;

  // scene setup
  setBaseImageUrl: (url?: string) => void;
  setBaseImageFromFile: (file: File) => void;
  setRoomDims: (dims?: RoomDims) => void;
  setCollection: (collectionId: string) => void;
  setWorkingSet: (ws: WorkingSet) => void;

  // Calibration actions (assumption + user-line)
  setCalibration: (cal: Calibration) => void;
  ensurePpfFromAssumption: () => void;

  beginCalibration: () => void;
  clearCalibrationDraft: () => void;
  setCalibrationPoint: (idx: 1 | 2, ptImage: { x: number; y: number }) => void;

  // Vibode Remove v1
  selectRemoveMark: (id: string | null) => void;
  addRemoveMark: (ptImage: { x: number; y: number }, rImage: number) => void;
  updateRemoveMark: (id: string, ptImage: { x: number; y: number }) => void;
  removeRemoveMark: (id: string) => void;
  clearRemoveMarks: () => void;
  selectSwapMark: (id: string | null) => void;
  addSwapMark: (ptImage: { x: number; y: number }) => void;
  updateSwapMark: (id: string, ptImage: { x: number; y: number }) => void;
  removeSwapMark: (id: string) => void;
  setSwapReplacement: (id: string, replacement: { skuId: string; imageUrl: string }) => void;
  clearSwapMarks: () => void;
  getSwapMarksSorted: () => SwapMarkV2[];
  selectRotateMark: (id: string | null) => void;
  addRotateMark: (ptImage: { x: number; y: number }, angleDeg?: number) => void;
  updateRotateMark: (
    id: string,
    patch: { ptImage?: { x: number; y: number }; angleDeg?: number }
  ) => void;
  removeRotateMark: (id: string) => void;
  clearRotateMarks: () => void;
  setCalibrationRealFeet: (feet: number) => void;
  finalizeCalibrationFromLine: () => boolean;
  clearCalibrationLine: () => void;

  // Optional helper: rescale existing nodes based on (prevPpf -> ppf)
  rescaleNodesToCalibration: () => boolean;

  // Rescale prompt actions
  setSuppressRescalePrompt: (v: boolean) => void;
  dismissRescalePrompt: () => void;
  triggerRescalePromptIfNeeded: (prevPpf: number | undefined, nextPpf: number) => void;
  confirmRescalePrompt: () => void;

  // Generate boundary (mock)
  commitGenerateMock: () => void;
};

/* =========================
   Helpers
========================= */

function safeUUID() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function computeSqft(dims?: RoomDims) {
  const w = dims?.widthFt ?? 0;
  const l = dims?.lengthFt ?? 0;
  if (w <= 0 || l <= 0) return undefined;
  return Math.round(w * l * 10) / 10;
}

function computeDimsMode(dims?: RoomDims): "auto" | "manual" {
  const w = dims?.widthFt ?? 0;
  const l = dims?.lengthFt ?? 0;
  return w > 0 && l > 0 ? "manual" : "auto";
}

/**
 * ✅ Safe deep clone for JSON-ish values used in freeze payloads.
 * Fixes: JSON.parse(JSON.stringify(undefined)) crash when room dims are left blank.
 */
function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value;

  // Prefer structuredClone when available (browser runtime)
  try {
    // @ts-ignore
    if (typeof structuredClone === "function") {
      // @ts-ignore
      return structuredClone(value);
    }
  } catch {
    // fall through
  }

  try {
    const json = JSON.stringify(value);
    if (json === undefined) return value; // critical: prevents JSON.parse(undefined)
    return JSON.parse(json) as T;
  } catch {
    // defensive: don't crash generate if something non-serializable sneaks in
    return value;
  }
}

function normalizeMarkupLayer(layer?: MarkupLayer | null): MarkupLayer {
  if (!layer || layer.version !== "v1" || !Array.isArray(layer.items)) {
    return { version: "v1", items: [] };
  }
  return layer;
}

function hasMarkupItems(layer?: MarkupLayer | null): boolean {
  return !!layer && Array.isArray(layer.items) && layer.items.length > 0;
}

function getHistoryImageUrl(record: FreezeRecord): string | undefined {
  return (
    record.outputImageUrl ||
    record.compositeImageUrl ||
    record.freeze?.baseImage?.url ||
    record.freeze?.sceneSnapshot?.baseImageUrl ||
    record.freeze?.sceneSnapshotImageSpace?.baseImageUrl ||
    undefined
  );
}

function getHistoryMarkupLayer(record: FreezeRecord): MarkupLayer {
  const layer =
    record.pendingMarkup ??
    record.freeze?.sceneSnapshotImageSpace?.draftMarkup ??
    record.freeze?.sceneSnapshot?.draftMarkup;
  return normalizeMarkupLayer(layer);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeRotateAngleDeg(angleDeg: number) {
  if (!Number.isFinite(angleDeg)) return 0;
  return clamp(angleDeg, -180, 180);
}

function scheduleMicrotask(cb: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(cb);
  } else {
    Promise.resolve().then(cb);
  }
}

function sortSwapMarksStable(marks: SwapMarkV2[]): SwapMarkV2[] {
  return marks
    .map((mark, index) => ({ mark, index }))
    .sort((a, b) => {
      const zA = a.mark.zIndex ?? 0;
      const zB = b.mark.zIndex ?? 0;
      if (zA !== zB) return zA - zB;
      if (a.mark.createdAt !== b.mark.createdAt) return a.mark.createdAt - b.mark.createdAt;
      if (a.mark.id !== b.mark.id) return a.mark.id < b.mark.id ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ mark }) => mark);
}

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

function hasEligibleSwapReplacement(
  mark: SwapMarkV2
): mark is SwapMarkV2 & { replacement: { skuId: string; imageUrl: string } } {
  const skuId = mark.replacement?.skuId;
  const imageUrl = mark.replacement?.imageUrl;
  return (
    typeof skuId === "string" &&
    skuId.trim().length > 0 &&
    typeof imageUrl === "string" &&
    imageUrl.trim().length > 0
  );
}

function getViewportCenter(vp?: ViewportMapping) {
  if (!vp) return { x: 200, y: 200 };
  const x = vp.imageStageX + vp.imageStageW / 2;
  const y = vp.imageStageY + vp.imageStageH / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 200, y: 200 };
  return { x, y };
}

/**
 * Convert a transform from Stage (canvas) pixels to Image pixel coordinates.
 * Uses viewport.scale = stage_px_per_image_px
 */
export function toImageSpaceTransform(t: NodeTransform, vp: ViewportMapping): NodeTransform {
  const x = (t.x - vp.imageStageX) / vp.scale;
  const y = (t.y - vp.imageStageY) / vp.scale;
  const w = t.width / vp.scale;
  const h = t.height / vp.scale;

  const cx = clamp(x, -vp.imageNaturalW, vp.imageNaturalW * 2);
  const cy = clamp(y, -vp.imageNaturalH, vp.imageNaturalH * 2);

  return {
    x: cx,
    y: cy,
    width: Math.max(1, w),
    height: Math.max(1, h),
    rotation: t.rotation,
    skewX: t.skewX,
    skewY: t.skewY,
  };
}

export function nodeBboxFromTransform(t: NodeTransform) {
  return { x: t.x, y: t.y, w: t.width, h: t.height };
}

export function toImageSpaceScene(scene: SceneGraph, vp: ViewportMapping): SceneGraph {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => ({
      ...n,
      transform: toImageSpaceTransform(n.transform, vp),
    })),
  };
}

function epsilonEqual(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

function transformEqual(a: NodeTransform, b: NodeTransform) {
  return (
    epsilonEqual(a.x, b.x) &&
    epsilonEqual(a.y, b.y) &&
    epsilonEqual(a.width, b.width) &&
    epsilonEqual(a.height, b.height) &&
    epsilonEqual(a.rotation, b.rotation) &&
    epsilonEqual(a.skewX ?? 0, b.skewX ?? 0) &&
    epsilonEqual(a.skewY ?? 0, b.skewY ?? 0)
  );
}

function computeRequestedOps(
  current: SceneGraph,
  previous?: SceneGraph,
  generationId?: string
): RequestedOps {
  const add: string[] = [];
  const remove: string[] = [];
  const swap: string[] = [];
  const transformChanged: string[] = [];

  const prevById = new Map<string, FurnitureNode>();
  (previous?.nodes ?? []).forEach((n) => prevById.set(n.id, n));

  for (const n of current.nodes) {
    if (n.status === "markedForDelete") remove.push(n.id);
    if (n.status === "pendingSwap") swap.push(n.id);

    const intro = n.provenance?.introducedInGenerationId;
    const prev = prevById.get(n.id);

    if (generationId) {
      if (intro === generationId) add.push(n.id);
    } else {
      if (!prev) add.push(n.id);
    }

    if (prev && !transformEqual(n.transform, prev.transform)) {
      transformChanged.push(n.id);
    }
  }

  add.sort();
  remove.sort();
  swap.sort();
  transformChanged.sort();

  return { add, remove, swap, transformChanged };
}

function mapVariantToRecord(
  variant?: FurnitureVariant
): Record<string, string | undefined> | undefined {
  if (!variant) return undefined;
  return {
    variantId: typeof variant.variantId === "string" ? variant.variantId : String(variant.variantId),
    label: typeof variant.label === "string" ? variant.label : undefined,
  };
}

function deriveCategoryFromHint(hint?: string): NodeCategory | undefined {
  if (!hint) return undefined;
  const normalized = hint.toLowerCase();
  if (/\bsofa\b|\bcouch\b|\bsectional\b/.test(normalized)) return "sofa";
  if (/\brug\b/.test(normalized)) return "rug";
  if (/\bbed\b/.test(normalized)) return "bed";
  if (/\bchair\b/.test(normalized)) return "chair";
  if (/\bcoffee\b/.test(normalized) && /\btable\b/.test(normalized)) return "table_coffee";
  if (/\bside\b/.test(normalized) && /\btable\b/.test(normalized)) return "table_side";
  if (/\bdining\b/.test(normalized) && /\btable\b/.test(normalized)) return "table_dining";
  if (/\bfloor\b/.test(normalized) && /\blamp\b/.test(normalized)) return "lamp_floor";
  if (/\btable\b/.test(normalized) && /\blamp\b/.test(normalized)) return "lamp_table";
  if (/\btv\b/.test(normalized) || /\bmedia\b/.test(normalized)) return "tv_stand";
  if (/\bdesk\b/.test(normalized)) return "desk";
  if (/\bstorage\b|\bwardrobe\b|\bdresser\b|\bconsole\b|\bcabinet\b|\bshelf\b/.test(normalized))
    return "storage";
  return undefined;
}

function deriveNodeCategory(node: FurnitureNode): NodeCategory {
  const typedNode = node as FurnitureNode & { type?: string; nodeType?: string };
  const primaryHint = node.kind ?? typedNode.type ?? typedNode.nodeType;
  const fromPrimary = deriveCategoryFromHint(primaryHint);
  if (fromPrimary) return fromPrimary;
  const fromLabel = deriveCategoryFromHint(node.label) ?? deriveCategoryFromHint(node.skuId);
  return fromLabel ?? "decor";
}

function deriveNodeRole(category: NodeCategory): IntentRole {
  if (category === "sofa" || category === "rug" || category === "bed") return "primary";
  if (category === "decor") return "decor";
  return "secondary";
}

function mapNodeToEditorNodeV2(node: FurnitureNode, viewport: ViewportMapping): EditorNodeForV2 {
  const imageSpace = toImageSpaceTransform(node.transform, viewport);
  const category = deriveNodeCategory(node);

  // Backfill layerKind/zIndex for nodes missing them (e.g. from old payloads)
  const layerKind =
    node.layerKind ?? inferLayerKindFromCategory(category);
  const zIndex = ensureZIndex(layerKind, node.zIndex);

  return {
    nodeId: node.id,
    skuId: node.skuId,
    vendor: node.vendor,
    // TODO: Map productKey/imageKey from existing fields like `productUrl`/`imageUrl` if needed.
    variant: mapVariantToRecord(node.variant),
    // TODO: Replace heuristics when a real taxonomy field exists on nodes.
    category,
    role: deriveNodeRole(category),
    // TODO: Derive lockLevel/swapGroup from existing node fields (e.g. `status`, `pendingSwap`).
    lockLevel: undefined,
    swapGroup: undefined,
    xPx: imageSpace.x,
    yPx: imageSpace.y,
    widthPx: imageSpace.width,
    heightPx: imageSpace.height,
    rotationDeg: imageSpace.rotation,
    zIndex,
    footprintIn: {
      widthIn: node.dimsIn?.width,
      depthIn: node.dimsIn?.depth,
      diameterIn: node.dimsIn?.diameter,
      heightIn: node.dimsIn?.height,
    },
  };
}

/* =========================
   Store
========================= */

export const useEditorStore = create<EditorState>((set, get) => ({
  /* ---------- initial state ---------- */

  scene: {
    sceneId: safeUUID(),
    baseImageUrl: undefined,
    baseImageWidthPx: undefined,
    baseImageHeightPx: undefined,
    phase: "IDLE",
    vibeMode: "on",
    draftMarkup: { version: "v1", items: [] },
    markupVisible: true,
    genUi: {},
    room: { dims: undefined, sqft: undefined, dimsMode: "auto" },
    collection: { collectionId: undefined, bundleId: undefined },
    calibration: undefined,
    nodes: [],
    removeMarks: [],
    swapMarks: [],
    rotateMarks: [],
  },

  workingSet: {},

  ui: {
    activeTool: "select",
    selectedNodeId: null,
    selectedRemoveMarkId: null,
    selectedSwapMarkId: null,
    selectedRotateMarkId: null,
    rescalePrompt: undefined,
    suppressRescalePrompt: false,
  },

  viewport: undefined,

  history: [],

  lastAction: null,

  /* ---------- viewport ---------- */

  setViewport: (vp) => set(() => ({ viewport: vp })),

  /* ---------- canonical freeze (v1) ---------- */

  freezeNowV1: () => {
    const { scene, workingSet, viewport, history } = get();

    if (!viewport) return null;

    const createdAtIso = new Date().toISOString();
    const generationId = safeUUID();

    const sceneSnapshot = deepClone(scene);
    const workingSetSnapshot = deepClone(workingSet);

    sceneSnapshot.nodes = sceneSnapshot.nodes.map((n) => {
      if (n.provenance?.introducedInGenerationId) return n;
      return {
        ...n,
        provenance: {
          ...n.provenance,
          introducedInGenerationId: generationId,
          fromBundleId: n.provenance?.fromBundleId ?? sceneSnapshot.collection?.bundleId,
          fromCollectionId: n.provenance?.fromCollectionId ?? sceneSnapshot.collection?.collectionId,
        },
      };
    });

    const sceneSnapshotImageSpace = toImageSpaceScene(sceneSnapshot, viewport);

    const previous = history[0]?.freeze?.sceneSnapshotImageSpace;
    const ops = computeRequestedOps(sceneSnapshotImageSpace, previous, generationId);

    const baseImageWidthPx =
      (isFiniteNumber(scene.baseImageWidthPx) ? scene.baseImageWidthPx : undefined) ??
      (isFiniteNumber(viewport.imageNaturalW) ? viewport.imageNaturalW : undefined);

    const baseImageHeightPx =
      (isFiniteNumber(scene.baseImageHeightPx) ? scene.baseImageHeightPx : undefined) ??
      (isFiniteNumber(viewport.imageNaturalH) ? viewport.imageNaturalH : undefined);

    if (!isFiniteNumber(baseImageWidthPx) || !isFiniteNumber(baseImageHeightPx)) {
      console.warn("[freezeNowV1] Missing base image natural dimensions", {
        sceneBaseW: scene.baseImageWidthPx,
        sceneBaseH: scene.baseImageHeightPx,
        vpW: viewport.imageNaturalW,
        vpH: viewport.imageNaturalH,
      });
      return null;
    }

    const freeze: FreezePayloadV1 = {
      payloadVersion: "v1",
      generationId,
      createdAtIso,

      baseImage: {
        kind: "publicUrl",
        url: scene.baseImageUrl,
        widthPx: baseImageWidthPx,
        heightPx: baseImageHeightPx,
      },

      viewport,

      sceneSnapshotImageSpace,
      sceneSnapshot,
      workingSetSnapshot,

      // ✅ safe now even when calibration is undefined
      calibration: deepClone(scene.calibration),

      requestedAction: {
        type: "generate",
        ops,
      },

      diffFromPrevious: {
        previousGenerationId: history[0]?.generationId,
        summary: `ops(add=${ops.add.length}, remove=${ops.remove.length}, swap=${ops.swap.length}, transformChanged=${ops.transformChanged.length})`,
      },
    };

    const record: FreezeRecord = {
      generationId,
      createdAtIso,
      compositeImageUrl: scene.baseImageUrl,
      freeze,
    };

    set((s) => ({
      history: [record, ...s.history],
    }));

    return record;
  },

  freezeNowV2: async () => {
    const { scene, viewport } = get();
    if (!viewport) return null;

    const baseImageWidthPx =
      (isFiniteNumber(scene.baseImageWidthPx) ? scene.baseImageWidthPx : undefined) ??
      (isFiniteNumber(viewport.imageNaturalW) ? viewport.imageNaturalW : undefined);

    const baseImageHeightPx =
      (isFiniteNumber(scene.baseImageHeightPx) ? scene.baseImageHeightPx : undefined) ??
      (isFiniteNumber(viewport.imageNaturalH) ? viewport.imageNaturalH : undefined);

    if (!isFiniteNumber(baseImageWidthPx) || !isFiniteNumber(baseImageHeightPx)) {
      console.warn("[freezeNowV2] Missing base image natural dimensions", {
        sceneBaseW: scene.baseImageWidthPx,
        sceneBaseH: scene.baseImageHeightPx,
        vpW: viewport.imageNaturalW,
        vpH: viewport.imageNaturalH,
      });
      return null;
    }

    if (!scene.baseImageUrl) {
      console.warn("[freezeNowV2] Missing base image URL");
      return null;
    }

    const ppf = scene.calibration?.ppf;
    const hasCalibration = Boolean(scene.calibration);
    const hasValidPpf = isFiniteNumber(ppf) && ppf > 0;
    
    // Warn only if user attempted calibration but it failed
    if (hasCalibration && !hasValidPpf) {
      console.warn("[freezeNowV2] Invalid calibration ppf", { ppf });
    }

    const pxPerIn = hasValidPpf ? ppf / 12 : DEFAULT_PX_PER_IN;
    if (!isFiniteNumber(pxPerIn) || pxPerIn <= 0) return null;

    const canvasNodes = scene.nodes;
    if (process.env.NODE_ENV !== "production") {
      console.log("[freezeNowV2] nodesLength", canvasNodes.length);
    }
    const nodes = canvasNodes.map((node) => mapNodeToEditorNodeV2(node, viewport));

    const removeMarks = scene.removeMarks ?? [];
    const swapMarks = scene.swapMarks ?? [];
    const rotateMarks = (scene.rotateMarks ?? []).map((m) => ({
      id: m.id,
      x: clamp(m.x, 0, 1),
      y: clamp(m.y, 0, 1),
      angleDeg: normalizeRotateAngleDeg(m.angleDeg),
    }));
    const hasRotateMarks = rotateMarks.length > 0;
    const sortedSwapMarks = swapMarks.length > 0 ? get().getSwapMarksSorted() : [];
    const eligibleSwapMarks = sortedSwapMarks.filter(hasEligibleSwapReplacement);

    const vibodeIntent: VibodeIntentV2 =
      eligibleSwapMarks.length > 0
        ? {
            mode: "tools",
            swap: {
              marks: eligibleSwapMarks.map((m) => ({
                id: m.id,
                x: m.ptImage.x,
                y: m.ptImage.y,
                zIndex: m.zIndex,
                replacement: {
                  kind: "sku",
                  skuId: m.replacement.skuId,
                  imageUrl: m.replacement.imageUrl,
                },
              })),
            },
            rotate: hasRotateMarks ? { marks: rotateMarks } : undefined,
          }
        : removeMarks.length > 0
          ? {
              mode: "remove",
              marks: removeMarks.map((m) => ({ ...m, labelIndex: m.labelIndex ?? 0 })),
              rotate: hasRotateMarks ? { marks: rotateMarks } : undefined,
            }
          : { mode: "place", rotate: hasRotateMarks ? { marks: rotateMarks } : undefined };

    // Assign labelIndex 1..N deterministically when missing
    if (vibodeIntent.mode === "remove") {
      vibodeIntent.marks = vibodeIntent.marks.map((m, i) => ({
        ...m,
        labelIndex: m.labelIndex ?? i + 1,
      }));
    }

    return buildFreezePayloadV2({
      baseImage: {
        signedUrl: scene.baseImageUrl,
        widthPx: baseImageWidthPx,
        heightPx: baseImageHeightPx,
      },
      calibration: {
        pxPerIn,
        method: hasValidPpf ? "user_line" : "auto_fit",
      },
      stagingBands: {
        roomType: "living_room",
        styleBand: "modern_scandi_neutral",
        lightingBand: "soft_daylight",
        cameraBand: "wide_eye_level_natural",
        decorAllowance: "minimal",
      },
      nodes,
      vibodeIntent,
    });
  },

  freezeAndAppendHistory: () => {
    const rec = get().freezeNowV1();
    return rec?.freeze ?? null;
  },

  /* ---------- NEW: attach output to latest freeze ---------- */

  attachOutputToLatestFreeze: (output) =>
    set((s) => {
      const idx = s.history.findIndex((r) => r.generationId === output.generationId);
      if (idx === -1) return s;

      const nextHistory = [...s.history];
      const rec = nextHistory[idx];

      nextHistory[idx] = {
        ...rec,
        outputImageUrl: output.imageUrl,
        outputStorageKey: output.storageKey,
        outputBucket: output.bucket,
      };

      // Auto-advance base image to the newly generated output for “vibe flow”.
      return {
        ...s,
        history: nextHistory,
        scene: {
          ...s.scene,
          baseImageUrl: output.imageUrl,
        },
      };
    }),

  /* ---------- NEW: attach output + swap base (with dimension persistence) ---------- */

  attachOutputAndSwapBase: (args) =>
    set((s) => {
      const hist = Array.isArray(s.history) ? s.history : [];

      // ✅ Correct: history is newest-first, so findIndex() naturally searches newest -> oldest
      const idx = hist.findIndex(
        (r) => r?.generationId === args.generationId || r?.freeze?.generationId === args.generationId
      );

      const hasW = isFiniteNumber(args.outputWidthPx) && args.outputWidthPx > 0;
      const hasH = isFiniteNumber(args.outputHeightPx) && args.outputHeightPx > 0;

      const nextScene: SceneGraph = {
        ...s.scene,
        baseImageUrl: args.outputImageUrl,
        ...(hasW ? { baseImageWidthPx: args.outputWidthPx } : {}),
        ...(hasH ? { baseImageHeightPx: args.outputHeightPx } : {}),
      };

      // Always swap base image, even if there is no matching history record
      if (idx === -1) {
        return {
          ...s,
          scene: nextScene,
        };
      }

      const nextHistory = hist.slice();
      const rec = nextHistory[idx];

      nextHistory[idx] = {
        ...rec,
        outputImageUrl: args.outputImageUrl,
        outputBucket: args.outputBucket ?? rec.outputBucket,
        outputStorageKey: args.outputStorageKey ?? rec.outputStorageKey,
        outputWidthPx: hasW ? args.outputWidthPx : rec.outputWidthPx,
        outputHeightPx: hasH ? args.outputHeightPx : rec.outputHeightPx,
      };

      return {
        ...s,
        history: nextHistory,
        scene: nextScene,
      };
    }),

  /* ---------- NEW: set base image from history ---------- */

  setBaseImageFromHistory: (generationId) => {
    const rec = get().history.find((r) => r.generationId === generationId);
    if (!rec) return false;

    const url = rec.outputImageUrl || rec.compositeImageUrl;
    if (!url) return false;

    // ✅ Clear stored base dims; they’ll be re-derived by viewport when image loads
    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: url,
        baseImageWidthPx: undefined,
        baseImageHeightPx: undefined,
      },
      ui: { ...s.ui, selectedNodeId: null },
    }));
    return true;
  },

  loadHistoryImage: (record) => {
    const url = getHistoryImageUrl(record);
    if (!url) return;
    const baseImageWidthPx =
      isFiniteNumber(record.outputWidthPx) && record.outputWidthPx > 0
        ? record.outputWidthPx
        : undefined;
    const baseImageHeightPx =
      isFiniteNumber(record.outputHeightPx) && record.outputHeightPx > 0
        ? record.outputHeightPx
        : undefined;
    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: url,
        baseImageWidthPx,
        baseImageHeightPx,
        draftMarkup: { version: "v1", items: [] },
        phase: "IDLE",
      },
    }));
  },

  loadHistoryMarkup: (record) => {
    const markup = deepClone(getHistoryMarkupLayer(record));
    set((s) => ({
      scene: {
        ...s.scene,
        draftMarkup: markup,
        phase: "MARKUP",
      },
    }));
  },

  loadHistoryBoth: (record) => {
    const url = getHistoryImageUrl(record);
    if (!url) return;
    const markup = deepClone(getHistoryMarkupLayer(record));
    const baseImageWidthPx =
      isFiniteNumber(record.outputWidthPx) && record.outputWidthPx > 0
        ? record.outputWidthPx
        : undefined;
    const baseImageHeightPx =
      isFiniteNumber(record.outputHeightPx) && record.outputHeightPx > 0
        ? record.outputHeightPx
        : undefined;
    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: url,
        baseImageWidthPx,
        baseImageHeightPx,
        draftMarkup: markup,
        phase: "MARKUP",
      },
    }));
  },

  branchFromHistory: (record) => {
    const url = getHistoryImageUrl(record);
    if (!url) return false;
    const markup = deepClone(getHistoryMarkupLayer(record));
    if (!hasMarkupItems(markup)) return false;
    const baseImageWidthPx =
      isFiniteNumber(record.outputWidthPx) && record.outputWidthPx > 0
        ? record.outputWidthPx
        : undefined;
    const baseImageHeightPx =
      isFiniteNumber(record.outputHeightPx) && record.outputHeightPx > 0
        ? record.outputHeightPx
        : undefined;

    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: url,
        baseImageWidthPx,
        baseImageHeightPx,
        draftMarkup: markup,
        phase: "MARKUP",
      },
    }));
    return true;
  },

  /* ---------- undo ---------- */

  undoLastAction: () =>
    set((s) => {
      if (!s.lastAction) return s;

      const { id, prevStatus } = s.lastAction;
      const exists = s.scene.nodes.some((n) => n.id === id);
      if (!exists) return { ...s, lastAction: null };

      return {
        ...s,
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) => (n.id === id ? { ...n, status: prevStatus } : n)),
        },
        lastAction: null,
      };
    }),

  /* ---------- UI ---------- */

  setActiveTool: (tool) => set((s) => ({ ui: { ...s.ui, activeTool: tool } })),

  selectNode: (id) =>
    set((s) => ({
      ui: {
        ...s.ui,
        selectedNodeId: id,
        selectedRemoveMarkId: null,
        selectedSwapMarkId: null,
        selectedRotateMarkId: null,
      },
    })),

  /* ---------- node creation / transform ---------- */

  addNode: (node) => {
    const id = node.id ?? safeUUID();
    const layerKind: LayerKind =
      (node as { layerKind?: LayerKind }).layerKind ?? "floor_furniture";
    const zIndex =
      typeof (node as { zIndex?: number }).zIndex === "number" &&
      Number.isFinite((node as { zIndex?: number }).zIndex)
        ? (node as { zIndex: number }).zIndex
        : getNextZIndexForLayer(get().scene.nodes, layerKind);

    const newNode: FurnitureNode = {
      id,
      kind: "furniture",
      skuId: node.skuId,
      label: node.label,
      variant: node.variant,
      layerKind,
      zIndex,
      status: (node as any).status ?? "active",
      transform: node.transform,
      provenance: node.provenance,
      pendingSwap: node.pendingSwap,
    };

    set((s) => ({
      scene: { ...s.scene, nodes: [...s.scene.nodes, newNode] },
      ui: { ...s.ui, selectedNodeId: id },
      lastAction: null,
    }));

    return id;
  },

  addFurnitureNodeFromSku: (sku) => {
    const id = safeUUID();
    const { viewport, scene } = get();

    const { wIn, dIn } = skuFootprintInchesFromDims(sku.dimsIn);
    const wPx = Math.max(24, Math.round(wIn * DEFAULT_PX_PER_IN));
    const hPx = Math.max(24, Math.round(dIn * DEFAULT_PX_PER_IN));

    const center = getViewportCenter(viewport);
    const x = center.x - wPx / 2;
    const y = center.y - hPx / 2;

    const layerKind = inferLayerKindFromSkuKind(sku.kind);
    const zIndex = getNextZIndexForLayer(scene.nodes, layerKind);

    const node: FurnitureNode = {
      id,
      kind: "furniture",
      skuId: sku.skuId,
      vendor: "IKEA_CA",
      displayName: sku.displayName,
      label: sku.displayName,
      articleNumber: sku.articleNumber,
      imageUrl: sku.imageUrl,
      productUrl: sku.productUrl,
      dimsIn: { ...sku.dimsIn },
      layerKind,
      zIndex,
      status: "active",
      transform: {
        x,
        y,
        width: wPx,
        height: hPx,
        rotation: 0,
      },
    };

    set((s) => ({
      scene: { ...s.scene, nodes: [...s.scene.nodes, node] },
      ui: { ...s.ui, selectedNodeId: id },
      lastAction: null,
    }));
  },

  updateNodeTransform: (id, patch) =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) =>
          n.id === id ? { ...n, transform: { ...n.transform, ...patch } } : n
        ),
      },
    })),

  setNodeStatus: (id, status) =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) => (n.id === id ? { ...n, status } : n)),
      },
    })),

  deleteNode: (id) =>
    set((s) => ({
      scene: { ...s.scene, nodes: s.scene.nodes.filter((n) => n.id !== id) },
      ui: {
        ...s.ui,
        selectedNodeId: s.ui.selectedNodeId === id ? null : s.ui.selectedNodeId,
      },
      lastAction: null,
    })),

  /* ---------- Vibode UX state machine ---------- */

  setPhase: (p) => set((s) => ({ scene: { ...s.scene, phase: p } })),

  setVibeMode: (m) => set((s) => ({ scene: { ...s.scene, vibeMode: m } })),

  beginMarkup: () => set((s) => ({ scene: { ...s.scene, phase: "MARKUP" } })),

  clearDraftMarkup: () =>
    set((s) => ({
      scene: { ...s.scene, draftMarkup: { version: "v1", items: [] } },
    })),

  setDraftMarkup: (layer) =>
    set((s) => ({
      scene: {
        ...s.scene,
        draftMarkup: layer,
        phase: Array.isArray(layer.items) && layer.items.length > 0 ? "MARKUP" : "IDLE",
      },
    })),

  setMarkupVisible: (visible) =>
    set((s) => ({
      scene: { ...s.scene, markupVisible: visible },
    })),

  toggleMarkupVisible: () =>
    set((s) => ({
      scene: { ...s.scene, markupVisible: !s.scene.markupVisible },
    })),

  recallLastMarkup: (opts) => {
    const mode = opts?.mode ?? "replace";
    const history = get().history ?? [];
    let successRecord: FreezeRecord | undefined;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const record = history[i];
      if (
        record?.pendingStatus === "success" &&
        hasMarkupItems(getHistoryMarkupLayer(record))
      ) {
        successRecord = record;
        break;
      }
    }
    let pendingRecord: FreezeRecord | undefined;
    if (!successRecord) {
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const record = history[i];
        if (record?.pendingMarkup && hasMarkupItems(getHistoryMarkupLayer(record))) {
          pendingRecord = record;
          break;
        }
      }
    }
    const record = successRecord ?? pendingRecord;
    if (!record) return false;

    const recalled = deepClone(getHistoryMarkupLayer(record));
    if (!hasMarkupItems(recalled)) return false;

    set((s) => {
      const current = normalizeMarkupLayer(s.scene.draftMarkup);
      const next: MarkupLayer =
        mode === "append"
          ? { version: "v1", items: [...current.items, ...recalled.items] }
          : recalled;
      return {
        scene: {
          ...s.scene,
          draftMarkup: next,
          phase: "MARKUP",
        },
      };
    });

    return true;
  },

  tryRestorePendingFromLocalStorage: () => {
    const pending = loadPendingLocal();
    if (!pending) return;

    const draftMarkup: MarkupLayer = pending.draftMarkup ?? { version: "v1", items: [] };
    const hasItems = Array.isArray(draftMarkup.items) && draftMarkup.items.length > 0;
    const removeMarks = Array.isArray(pending.removeMarks) ? pending.removeMarks : [];
    const rotateMarks = Array.isArray(pending.rotateMarks) ? pending.rotateMarks : [];

    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: pending.baseImageUrl ?? s.scene.baseImageUrl,
        baseImageWidthPx: pending.baseImageWidthPx ?? s.scene.baseImageWidthPx,
        baseImageHeightPx: pending.baseImageHeightPx ?? s.scene.baseImageHeightPx,
        vibeMode: pending.vibeMode ?? s.scene.vibeMode,
        draftMarkup,
        removeMarks,
        rotateMarks,
        phase: hasItems ? "MARKUP" : "IDLE",
        genUi: {},
      },
    }));
  },

  beginGenerate: () => {
    const { scene } = get();
    const now = Date.now();
    const sceneSnapshotForRecovery = {
      sceneId: scene.sceneId,
      baseImageUrl: scene.baseImageUrl,
      removeMarks: scene.removeMarks ?? [],
      rotateMarks: scene.rotateMarks ?? [],
      baseImageWidthPx: scene.baseImageWidthPx,
      baseImageHeightPx: scene.baseImageHeightPx,
      vibeMode: scene.vibeMode,
      draftMarkup: deepClone(scene.draftMarkup),
    };
    const markupToPersist = deepClone(scene.draftMarkup);

    set((s) => ({
      scene: {
        ...s.scene,
        phase: "GENERATING",
        draftMarkup: { version: "v1", items: [] },
        genUi: { ...s.scene.genUi, startedAtMs: now },
      },
    }));

    return { sceneSnapshotForRecovery, markupToPersist };
  },

  markGeneratingSlow: () =>
    set((s) => {
      if (s.scene.phase !== "GENERATING" || s.scene.genUi.slowHintShown) return s;
      return {
        scene: {
          ...s.scene,
          genUi: {
            ...s.scene.genUi,
            slowHintShown: true,
            message: "This is taking longer than usual.",
          },
        },
      };
    }),

  markGeneratingStall: () =>
    set((s) => {
      if (s.scene.phase !== "GENERATING") return s;
      return {
        scene: {
          ...s.scene,
          phase: "STALL",
          genUi: {
            ...s.scene.genUi,
            stallHintShown: true,
            message: "Generation seems stalled.",
          },
        },
      };
    }),

  endGenerateSuccess: ({ imageUrl, widthPx, heightPx }) => {
    const hasW = isFiniteNumber(widthPx) && widthPx > 0;
    const hasH = isFiniteNumber(heightPx) && heightPx > 0;

    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: imageUrl,
        ...(hasW ? { baseImageWidthPx: widthPx } : {}),
        ...(hasH ? { baseImageHeightPx: heightPx } : {}),
        phase: "SUCCESS",
      },
    }));

    scheduleMicrotask(() => get().setPhase("IDLE"));
  },

  endGenerateError: ({ userMessage, debug }) => {
    const pending = loadPendingLocal();
    const restored: MarkupLayer = pending?.draftMarkup ?? { version: "v1", items: [] };
    set((s) => ({
      scene: {
        ...s.scene,
        phase: "ERROR",
        draftMarkup: restored,
        genUi: {
          ...s.scene.genUi,
          message: userMessage,
          lastErrorUserMessage: userMessage,
          lastErrorDebug: debug,
        },
      },
    }));

    const pushSnack = (get() as { pushSnack?: (message: string) => void }).pushSnack;
    if (typeof pushSnack === "function") pushSnack(userMessage);

    scheduleMicrotask(() => get().setPhase("MARKUP"));
  },

  /* ---------- Vibode vibe-flow ---------- */

  toggleDelete: (id) =>
    set((s) => {
      const node = s.scene.nodes.find((n) => n.id === id);
      if (!node) return s;

      const prevStatus = node.status;
      const nextStatus: FurnitureNodeStatus =
        prevStatus === "markedForDelete" ? "active" : "markedForDelete";

      const nextPendingSwap = nextStatus === "markedForDelete" ? undefined : node.pendingSwap;

      return {
        ...s,
        lastAction: { kind: "toggleDelete", id, prevStatus, nextStatus },
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) =>
            n.id === id ? { ...n, status: nextStatus, pendingSwap: nextPendingSwap } : n
          ),
        },
      };
    }),

  setPendingSwap: (id, pending, replacement) =>
    set((s) => {
      const node = s.scene.nodes.find((n) => n.id === id);
      if (!node || node.status === "markedForDelete") return s;

      const prevStatus = node.status;
      const nextStatus: FurnitureNodeStatus = pending ? "pendingSwap" : "active";

      const nextPendingSwap =
        pending && replacement?.skuId
          ? {
              replacementSkuId: replacement.skuId,
              replacementLabel: replacement.label,
              replacementVariantId: replacement.variantId,
            }
          : undefined;

      return {
        ...s,
        lastAction: { kind: "setPendingSwap", id, prevStatus, nextStatus },
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) =>
            n.id === id ? { ...n, status: nextStatus, pendingSwap: nextPendingSwap } : n
          ),
        },
      };
    }),

  applySwap: (id, next) =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) => {
          if (n.id !== id) return n;

          const t = n.transform;
          const cx = t.x + t.width / 2;
          const cy = t.y + t.height / 2;

          const newW = next.defaultPxWidth ?? t.width;
          const newH = next.defaultPxHeight ?? t.height;

          const base: FurnitureNode = {
            ...n,
            skuId: next.skuId,
            label: next.label,
            variant: next.variant,
            status: "active",
            pendingSwap: undefined,
            transform: {
              ...t,
              width: newW,
              height: newH,
              x: cx - newW / 2,
              y: cy - newH / 2,
            },
          };

          return {
            ...base,
            ...(next.vendor !== undefined ? { vendor: next.vendor } : {}),
            ...(next.displayName !== undefined ? { displayName: next.displayName } : {}),
            ...(next.articleNumber !== undefined ? { articleNumber: next.articleNumber } : {}),
            ...(next.imageUrl !== undefined ? { imageUrl: next.imageUrl } : {}),
            ...(next.productUrl !== undefined ? { productUrl: next.productUrl } : {}),
            ...(next.dimsIn !== undefined ? { dimsIn: next.dimsIn } : {}),
          };
        }),
      },
      lastAction: null,
    })),

  /* ---------- helpers ---------- */

  deleteSelectedHard: () => {
    const selected = get().ui.selectedNodeId;
    if (!selected) return;

    set((s) => ({
      scene: { ...s.scene, nodes: s.scene.nodes.filter((n) => n.id !== selected) },
      ui: { ...s.ui, selectedNodeId: null },
      lastAction: null,
    }));
  },

  bringToFront: (id) =>
    set((s) => {
      const maxZ = s.scene.nodes.reduce((m, n) => Math.max(m, n.zIndex), 0);
      return {
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) => (n.id === id ? { ...n, zIndex: maxZ + 1 } : n)),
        },
      };
    }),

  sendToBack: (id) =>
    set((s) => {
      const minZ = s.scene.nodes.reduce((m, n) => Math.min(m, n.zIndex), Infinity);
      return {
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) => (n.id === id ? { ...n, zIndex: minZ - 1 } : n)),
        },
      };
    }),

  duplicateNode: (id) => {
    const src = get().scene.nodes.find((n) => n.id === id);
    if (!src) return null;

    const newId = safeUUID();
    const maxZ = get().scene.nodes.reduce((m, n) => Math.max(m, n.zIndex), 0);

    const dup: FurnitureNode = {
      ...src,
      id: newId,
      layerKind: src.layerKind ?? "floor_furniture",
      zIndex: maxZ + 1,
      transform: { ...src.transform, x: src.transform.x + 18, y: src.transform.y + 18 },
      status: "active",
      pendingSwap: undefined,
    };

    set((s) => ({
      scene: { ...s.scene, nodes: [...s.scene.nodes, dup] },
      ui: { ...s.ui, selectedNodeId: newId },
      lastAction: null,
    }));

    return newId;
  },

  /* ---------- scene setup ---------- */

  setBaseImageUrl: (url) =>
    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: url,
        baseImageWidthPx: undefined,
        baseImageHeightPx: undefined,
      },
    })),

  setBaseImageFromFile: (file) => {
    const prev = get().scene.baseImageUrl;
    const url = URL.createObjectURL(file);

    if (prev?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(prev);
      } catch {}
    }

    set((s) => ({
      scene: {
        ...s.scene,
        baseImageUrl: url,
        baseImageWidthPx: undefined,
        baseImageHeightPx: undefined,
      },
    }));
  },

  setRoomDims: (dims) =>
    set((s) => ({
      scene: {
        ...s.scene,
        room: {
          ...s.scene.room,
          dims,
          sqft: computeSqft(dims),
          dimsMode: computeDimsMode(dims),
        },
      },
    })),

  setCollection: (collectionId) =>
    set((s) => ({
      scene: { ...s.scene, collection: { ...s.scene.collection, collectionId } },
      workingSet: { ...s.workingSet, collectionId },
    })),

  setWorkingSet: (ws) =>
    set((s) => ({
      workingSet: { ...s.workingSet, ...ws },
      scene: {
        ...s.scene,
        collection: {
          collectionId: ws.collectionId ?? s.scene.collection?.collectionId,
          bundleId: ws.bundleId ?? s.scene.collection?.bundleId,
        },
      },
    })),

  /* ---------- Calibration (assumption + user-line) ---------- */

  setCalibration: (cal) =>
    set((s) => ({
      scene: { ...s.scene, calibration: { ...s.scene.calibration, ...cal } },
    })),

  ensurePpfFromAssumption: () => {
    const { scene, viewport } = get();
    const dims = scene.room?.dims;
    if (!viewport || !(dims?.widthFt && dims?.lengthFt)) return;

    const assumedFeet = dims.widthFt;
    if (!assumedFeet || assumedFeet <= 0) return;

    const ppf = viewport.imageNaturalW / assumedFeet;

    set((s) => {
      const prevPpf = s.scene.calibration?.ppf;
      return {
        scene: {
          ...s.scene,
          calibration: {
            ...s.scene.calibration,
            prevPpf,
            ppf,
            method: "assumed-fit-width",
            notes: "V0 assumption: room width spans image width. Replace with user-line calibration.",
          },
        },
      };
    });
  },

  beginCalibration: () =>
    set((s) => ({
      ui: { ...s.ui, activeTool: "calibrate", selectedNodeId: null },
      scene: {
        ...s.scene,
        calibration: {
          ...s.scene.calibration,
          method: "user-line",
          draft: {
            p1: undefined,
            p2: undefined,
            realFeet: s.scene.calibration?.draft?.realFeet ?? 10,
          },
        },
      },
      lastAction: null,
    })),

  clearCalibrationDraft: () =>
    set((s) => ({
      scene: {
        ...s.scene,
        calibration: {
          ...s.scene.calibration,
          draft: {
            p1: undefined,
            p2: undefined,
            realFeet: s.scene.calibration?.draft?.realFeet ?? 10,
          },
        },
      },
    })),

  setCalibrationPoint: (idx, ptImage) =>
    set((s) => {
      const draft = s.scene.calibration?.draft ?? {};
      const nextDraft = idx === 1 ? { ...draft, p1: ptImage, p2: undefined } : { ...draft, p2: ptImage };
      return {
        scene: {
          ...s.scene,
          calibration: { ...s.scene.calibration, method: "user-line", draft: nextDraft },
        },
      };
    }),

  selectRemoveMark: (id) =>
    set((s) => ({
      ui: {
        ...s.ui,
        selectedNodeId: null,
        selectedRemoveMarkId: id,
        selectedSwapMarkId: null,
        selectedRotateMarkId: null,
      },
    })),

  addRemoveMark: (ptImage, rImage) =>
    set((s) => {
      const existing = s.scene.removeMarks ?? [];
      const labelIndex = existing.length + 1; // 1..N deterministic
      const mark: RemoveMarkV2 = {
        id: safeUUID(),
        x: ptImage.x,
        y: ptImage.y,
        r: rImage,
        labelIndex,
      };
      return {
        scene: {
          ...s.scene,
          removeMarks: [...existing, mark],
        },
        ui: {
          ...s.ui,
          selectedRemoveMarkId: mark.id,
        },
      };
    }),

  updateRemoveMark: (id, ptImage) =>
    set((s) => ({
      scene: {
        ...s.scene,
        removeMarks: (s.scene.removeMarks ?? []).map((m) =>
          m.id === id ? { ...m, x: ptImage.x, y: ptImage.y } : m
        ),
      },
    })),

  removeRemoveMark: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        removeMarks: (s.scene.removeMarks ?? []).filter((m) => m.id !== id),
      },
      ui: {
        ...s.ui,
        selectedRemoveMarkId:
          s.ui.selectedRemoveMarkId === id ? null : s.ui.selectedRemoveMarkId,
      },
    })),

  clearRemoveMarks: () =>
    set((s) => ({
      scene: {
        ...s.scene,
        removeMarks: [],
      },
      ui: {
        ...s.ui,
        selectedRemoveMarkId: null,
      },
    })),

  selectSwapMark: (id) =>
    set((s) => ({
      ui: {
        ...s.ui,
        selectedNodeId: null,
        selectedRemoveMarkId: null,
        selectedSwapMarkId: id,
        selectedRotateMarkId: null,
      },
    })),

  addSwapMark: (ptImage) =>
    set((s) => {
      const existing = s.scene.swapMarks ?? [];
      const nextZIndex = existing.reduce((maxZ, mark) => Math.max(maxZ, mark.zIndex ?? 0), 0) + 1;
      const mark: SwapMarkV2 = {
        id: safeUUID(),
        ptImage: { x: ptImage.x, y: ptImage.y },
        createdAt: Date.now(),
        zIndex: nextZIndex,
      };
      return {
        scene: {
          ...s.scene,
          swapMarks: [...existing, mark],
        },
        ui: {
          ...s.ui,
          selectedSwapMarkId: mark.id,
        },
      };
    }),

  updateSwapMark: (id, ptImage) =>
    set((s) => ({
      scene: {
        ...s.scene,
        swapMarks: (s.scene.swapMarks ?? []).map((m) =>
          m.id === id ? { ...m, ptImage: { x: ptImage.x, y: ptImage.y } } : m
        ),
      },
    })),

  removeSwapMark: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        swapMarks: (s.scene.swapMarks ?? []).filter((m) => m.id !== id),
      },
      ui: {
        ...s.ui,
        selectedSwapMarkId: s.ui.selectedSwapMarkId === id ? null : s.ui.selectedSwapMarkId,
      },
    })),

  setSwapReplacement: (id, replacement) =>
    set((s) => ({
      scene: {
        ...s.scene,
        swapMarks: (s.scene.swapMarks ?? []).map((m) =>
          m.id === id ? { ...m, replacement } : m
        ),
      },
    })),

  clearSwapMarks: () =>
    set((s) => ({
      scene: {
        ...s.scene,
        swapMarks: [],
      },
      ui: {
        ...s.ui,
        selectedSwapMarkId: null,
      },
    })),

  selectRotateMark: (id) =>
    set((s) => ({
      ui: {
        ...s.ui,
        selectedNodeId: null,
        selectedRemoveMarkId: null,
        selectedSwapMarkId: null,
        selectedRotateMarkId: id,
      },
    })),

  addRotateMark: (ptImage, angleDeg = 0) =>
    set((s) => {
      const mark: VibodeRotateMark = {
        id: safeUUID(),
        x: ptImage.x,
        y: ptImage.y,
        angleDeg: normalizeRotateAngleDeg(angleDeg),
      };
      return {
        scene: {
          ...s.scene,
          rotateMarks: [...(s.scene.rotateMarks ?? []), mark],
        },
        ui: {
          ...s.ui,
          selectedRotateMarkId: mark.id,
        },
      };
    }),

  updateRotateMark: (id, patch) =>
    set((s) => ({
      scene: {
        ...s.scene,
        rotateMarks: (s.scene.rotateMarks ?? []).map((m) => {
          if (m.id !== id) return m;
          return {
            ...m,
            x: patch.ptImage?.x ?? m.x,
            y: patch.ptImage?.y ?? m.y,
            angleDeg:
              patch.angleDeg === undefined ? m.angleDeg : normalizeRotateAngleDeg(patch.angleDeg),
          };
        }),
      },
    })),

  removeRotateMark: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        rotateMarks: (s.scene.rotateMarks ?? []).filter((m) => m.id !== id),
      },
      ui: {
        ...s.ui,
        selectedRotateMarkId:
          s.ui.selectedRotateMarkId === id ? null : s.ui.selectedRotateMarkId,
      },
    })),

  clearRotateMarks: () =>
    set((s) => ({
      scene: {
        ...s.scene,
        rotateMarks: [],
      },
      ui: {
        ...s.ui,
        selectedRotateMarkId: null,
      },
    })),

  getSwapMarksSorted: () => sortSwapMarksStable(get().scene.swapMarks ?? []),

  setCalibrationRealFeet: (feet) =>
    set((s) => ({
      scene: {
        ...s.scene,
        calibration: {
          ...s.scene.calibration,
          method: "user-line",
          draft: { ...(s.scene.calibration?.draft ?? {}), realFeet: feet },
        },
      },
    })),

  finalizeCalibrationFromLine: () => {
    const { viewport, scene } = get();
    const draft = scene.calibration?.draft;

    if (!viewport || !draft?.p1 || !draft?.p2) return false;

    const realFeet = Number(draft.realFeet);
    if (!isFinite(realFeet) || realFeet <= 0) return false;

    const dx = draft.p2.x - draft.p1.x;
    const dy = draft.p2.y - draft.p1.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    if (!isFinite(distPx) || distPx < 5) return false;

    const nextPpf = distPx / realFeet;
    const prevPpf = get().scene.calibration?.ppf;

    set((s) => ({
      scene: {
        ...s.scene,
        calibration: {
          ...s.scene.calibration,
          prevPpf,
          ppf: nextPpf,
          method: "user-line",
          notes: "Computed from user calibration line.",
          userLine: {
            x1: draft.p1!.x,
            y1: draft.p1!.y,
            x2: draft.p2!.x,
            y2: draft.p2!.y,
            realFeet,
          },
          draft: { ...draft, realFeet },
        },
      },
    }));

    get().triggerRescalePromptIfNeeded(prevPpf, nextPpf);

    return true;
  },

  clearCalibrationLine: () =>
    set((s) => ({
      ui: { ...s.ui, rescalePrompt: undefined },
      scene: {
        ...s.scene,
        calibration: {
          ...s.scene.calibration,
          ppf: undefined,
          prevPpf: undefined,
          userLine: undefined,
          notes: undefined,
          method: undefined,
          draft: {
            p1: undefined,
            p2: undefined,
            realFeet: s.scene.calibration?.draft?.realFeet ?? 10,
          },
        },
      },
    })),

  /* ---------- Optional: rescale existing nodes to current calibration ---------- */

  rescaleNodesToCalibration: () => {
    const { scene } = get();
    const ppf = scene.calibration?.ppf;
    const prev = scene.calibration?.prevPpf;

    if (!ppf || !prev || prev <= 0) return false;

    const ratio = ppf / prev;

    set((s) => ({
      scene: {
        ...s.scene,
        calibration: {
          ...s.scene.calibration,
          prevPpf: ppf,
        },
        nodes: s.scene.nodes.map((n) => {
          if (n.status === "markedForDelete") return n;

          const t = n.transform;
          const cx = t.x + t.width / 2;
          const cy = t.y + t.height / 2;

          const newW = Math.max(20, t.width * ratio);
          const newH = Math.max(20, t.height * ratio);

          return {
            ...n,
            transform: {
              ...t,
              width: newW,
              height: newH,
              x: cx - newW / 2,
              y: cy - newH / 2,
            },
          };
        }),
      },
    }));

    return true;
  },

  /* ---------- Rescale prompt actions ---------- */

  setSuppressRescalePrompt: (v) => set((s) => ({ ui: { ...s.ui, suppressRescalePrompt: v } })),

  dismissRescalePrompt: () => set((s) => ({ ui: { ...s.ui, rescalePrompt: undefined } })),

  triggerRescalePromptIfNeeded: (prevPpf, nextPpf) => {
    const { ui, scene } = get();
    if (ui.suppressRescalePrompt) return;

    if (!prevPpf || !isFinite(prevPpf) || prevPpf <= 0) return;
    if (!isFinite(nextPpf) || nextPpf <= 0) return;

    const activeNodes = scene.nodes.filter((n) => n.status !== "markedForDelete").length;
    if (activeNodes === 0) return;

    const ratio = nextPpf / prevPpf;
    if (!isFinite(ratio) || Math.abs(ratio - 1) < 0.01) return;

    set((s) => ({
      ui: { ...s.ui, rescalePrompt: { prevPpf, nextPpf, ratio } },
    }));
  },

  confirmRescalePrompt: () => {
    get().rescaleNodesToCalibration();
    set((s) => ({ ui: { ...s.ui, rescalePrompt: undefined } }));
  },

  /* ---------- Generate boundary (mock) ---------- */

  commitGenerateMock: () =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes
          .filter((n) => n.status !== "markedForDelete")
          .map((n) =>
            n.status === "pendingSwap" ? { ...n, status: "active", pendingSwap: undefined } : n
          ),
      },
      ui: { ...s.ui, selectedNodeId: null },
      lastAction: null,
    })),
}));
