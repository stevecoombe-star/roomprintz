// app/api/vibode/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FreezePayloadV2, StyleBand } from "@/lib/freezePayloadV2Types";
import { callCompositorVibodeCompose } from "@/lib/callCompositorVibodeCompose";
import { callCompositorVibodeMove } from "@/lib/callCompositorVibodeMove";
import { callCompositorVibodeRemove } from "@/lib/callCompositorVibodeRemove";
import { callCompositorVibodeRotate } from "@/lib/callCompositorVibodeRotate";
import {
  inferLayerKindFromSkuKind,
  ensureZIndex,
  type LayerKind,
} from "@/lib/layerKind";
import { IKEA_CA_SKUS } from "@/data/mockIkeaCaSkus";

// Ensure we run on the Node.js runtime (needed for Buffer, larger payloads, etc.)
export const runtime = "nodejs";

/* =========================
   Types (Vibode v1)
========================= */

type SpendRow = {
  success: boolean;
  balance: number | null;
};

type TokenLedgerInsert = {
  user_id: string;
  delta: number;
  kind: string;
  external_id: string;
  reason: string;
  job_id: string;
};

/**
 * Minimal Supabase Database type for this route.
 * This avoids "never" typing for rpc()/insert() without using `any`.
 */
type Database = {
  public: {
    Tables: {
      token_ledger: {
        Row: Record<string, unknown>;
        Insert: TokenLedgerInsert;
        Update: Record<string, unknown>;
        Relationships: never[];
      };
    };
    Views: Record<string, never>;
    Functions: {
      try_spend_tokens: {
        Args: { p_cost: number; p_external_id: string; p_reason: string };
        Returns: SpendRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type BaseImageKind = "publicUrl" | "signedUrl" | "storageKey" | "url";

type RequestedOps = {
  add: string[];
  remove: string[];
  swap: string[];
  transformChanged: string[];
};

type FreezePayloadV1 = {
  payloadVersion: "v1";
  generationId: string;
  createdAtIso?: string;

  baseImage: {
    kind: BaseImageKind;
    url?: string;
    storageKey?: string;
    widthPx: number;
    heightPx: number;
  };

  viewport?: {
    stageScale: number;
    stageX: number;
    stageY: number;
    canvasWidthPx: number;
    canvasHeightPx: number;
  };

  sceneSnapshotImageSpace: {
    sceneId: string;
    nodes: Array<{
      id: string;
      skuId: string;
      label: string;
      variantId?: string;

      transform: {
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        skewX?: number;
        skewY?: number;
      };

      zIndex?: number;
      layerKind?: LayerKind;
      status: "active" | "markedForDelete" | "pendingSwap";

      provenance?: {
        introducedInGenerationId?: string;
      };

      pendingSwap?: {
        replacementSkuId: string;
        replacementVariantId?: string;
      };
    }>;
  };

  workingSetSnapshot?: {
    collectionId?: string;
    bundleId?: "small" | "medium" | "large";
    skuIdsInPlay: string[];
  };

  calibration?: {
    ppf: number; // pixels per foot
    method: "user" | "auto";
  };

  room?: {
    dimsFt?: { widthFt: number; lengthFt: number; heightFt?: number };
    sqft?: number;
  };

  requestedAction?: {
    type: "generate";
    ops?: RequestedOps;
  };
};

type VibodeGenerateOk =
  | {
      ok: true;
      generationId: string;
      mode: "echo";
      output?: never; // echo must never include output
      tokenCost: number;
      tokenBalance: number;
      debug: {
        payloadVersion: "v1";
        baseImage: { kind: BaseImageKind; url?: string; storageKey?: string };
        counts: {
          nodesTotal: number;
          active: number;
          markedForDelete: number;
          pendingSwap: number;
        };
        ops: RequestedOps;
        notes: string[];
        echo: {
          xVibodeEchoRaw: string | null;
          forceEchoRequested: boolean;
          forceEchoAllowed: boolean;
          forceEcho: boolean;
          echoOnly: boolean;
          willEcho: boolean;
          xVibodeForceModelRaw: string | null;
          forceModel: boolean;
          hasNanoBananaUrl: boolean;
          hasNanoBananaKey: boolean;
          vibodeEchoOnlyRaw: string | null;
        };
      };
    }
  | {
      ok: true;
      generationId: string;
      mode: "nanobanana";
      output: {
        imageUrl: string; // required when nanobanana
        storageKey?: string;
        bucket?: string;
        signedUrlExpiresInSec?: number;
        widthPx?: number;
        heightPx?: number;
      };
      tokenCost: number;
      tokenBalance: number;
      debug: {
        payloadVersion: "v1";
        baseImage: { kind: BaseImageKind; url?: string; storageKey?: string };
        counts: {
          nodesTotal: number;
          active: number;
          markedForDelete: number;
          pendingSwap: number;
        };
        ops: RequestedOps;
        notes: string[];
        echo: {
          xVibodeEchoRaw: string | null;
          forceEchoRequested: boolean;
          forceEchoAllowed: boolean;
          forceEcho: boolean;
          echoOnly: boolean;
          willEcho: boolean;
          xVibodeForceModelRaw: string | null;
          forceModel: boolean;
          hasNanoBananaUrl: boolean;
          hasNanoBananaKey: boolean;
          vibodeEchoOnlyRaw: string | null;
        };
      };
    };

type VibodeGenerateErr = {
  error: string;
  details?: unknown;
};

/* =========================
   Helpers
========================= */

function json(status: number, body: VibodeGenerateOk | VibodeGenerateErr) {
  return NextResponse.json(body, { status });
}

function mustEnv(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var (tried: ${names.join(", ")})`);
}

const SUPABASE_URL = mustEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = mustEnv("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const VIBODE_IMAGES_BUCKET = (process.env.VIBODE_IMAGES_BUCKET || "vibode").trim();
const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();

// Model request size safety (base64 expands by ~33%).
const VIBODE_MAX_MODEL_IMAGE_BASE64_LEN = Math.max(
  1_000_000,
  Number(process.env.VIBODE_MAX_MODEL_IMAGE_BASE64_LEN ?? 12_000_000)
);

const VIBODE_MAX_MODEL_IMAGE_BYTES = Math.max(
  1_000_000,
  Math.min(12_000_000, Math.floor(VIBODE_MAX_MODEL_IMAGE_BASE64_LEN * 0.75))
);

const VIBODE_PLACEMENT_TEST_MODE =
  (process.env.VIBODE_PLACEMENT_TEST_MODE ?? "false").toLowerCase() === "true";

const VIBODE_STRICT = (process.env.VIBODE_STRICT ?? "0").trim() === "1";
const VIBODE_ALLOW_LEGACY_STAGE =
  (process.env.VIBODE_ALLOW_LEGACY_STAGE ?? "0").trim() === "1";

const useCompose =
  (process.env.VIBODE_USE_COMPOSITOR_VIBODE_COMPOSE ?? "false").toLowerCase() === "true";

const DEFAULT_NB_STYLE_ID = "modern_scandi_neutral";
const STYLE_BAND_TO_NB_STYLE_ID: Partial<Record<StyleBand, string>> = {
  modern_scandi_neutral: "modern_scandi_neutral",
  cozy_neutral: "cozy_neutral",
  modern_minimal: "modern_minimal",
  warm_modern: "warm_modern",
  eclectic_soft: "eclectic_soft",
};

function getUserSupabaseClient(
  req: NextRequest
): { supabase: ReturnType<typeof createClient<Database>> | null; token: string | null } {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  if (!token) return { supabase: null, token: null };

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return { supabase, token };
}

function getAdminSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function finiteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isProbablyBlobOrLocalUrl(url: string) {
  const u = url.trim().toLowerCase();
  return (
    u.startsWith("blob:") ||
    u.startsWith("data:") ||
    u.startsWith("file:") ||
    u.startsWith("http://localhost") ||
    u.startsWith("http://127.0.0.1") ||
    u.startsWith("http://0.0.0.0")
  );
}

function safeUrlForLogs(url?: string | null) {
  if (!url) return null;
  if (url.trim().toLowerCase().startsWith("data:")) {
    return "[data-url]";
  }
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().slice(0, 120);
  } catch {
    return url.slice(0, 80);
  }
}

function normalizeRequestedOps(raw: any): RequestedOps {
  return {
    add: Array.isArray(raw?.add) ? raw.add : [],
    remove: Array.isArray(raw?.remove) ? raw.remove : [],
    swap: Array.isArray(raw?.swap) ? raw.swap : [],
    transformChanged: Array.isArray(raw?.transformChanged) ? raw.transformChanged : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function collectLegacyFreezeKeys(raw: Record<string, unknown>) {
  const legacyKeys = new Set<string>();

  const legacyTopLevel = [
    "generationId",
    "sceneSnapshotImageSpace",
    "requestedAction",
    "workingSetSnapshot",
    "viewport",
    "room",
    "styleId",
    "aspectRatio",
    "modelVersion",
  ];

  for (const key of legacyTopLevel) {
    if (key in raw) legacyKeys.add(key);
  }

  const baseImage = isRecord(raw.baseImage) ? raw.baseImage : null;
  if (baseImage) {
    if ("kind" in baseImage) legacyKeys.add("baseImage.kind");
    if ("url" in baseImage) legacyKeys.add("baseImage.url");
    if ("publicUrl" in baseImage) legacyKeys.add("baseImage.publicUrl");
  }

  const requestedAction = isRecord(raw.requestedAction) ? raw.requestedAction : null;
  if (requestedAction) {
    if ("styleId" in requestedAction) legacyKeys.add("requestedAction.styleId");
    if ("aspectRatio" in requestedAction) legacyKeys.add("requestedAction.aspectRatio");
  }

  return [...legacyKeys];
}

export function validateFreezePayloadV2Strict(
  freeze: unknown
): { ok: true; payload: FreezePayloadV2 } | { ok: false; error: string; legacyFields?: string[] } {
  if (!isRecord(freeze)) {
    return {
      ok: false,
      error: "VIBODE_STRICT=1 requires body.freeze to be a valid FreezePayloadV2 object.",
    };
  }

  const legacyFields = collectLegacyFreezeKeys(freeze);
  if (legacyFields.length > 0) {
    return {
      ok: false,
      error:
        "VIBODE_STRICT=1 rejected legacy Vibode payload fields. Send FreezePayloadV2 only (no V1/legacy fields).",
      legacyFields,
    };
  }

  if (freeze.payloadVersion !== "v2") {
    return {
      ok: false,
      error: "VIBODE_STRICT=1 requires freeze.payloadVersion to be 'v2'.",
    };
  }

  if (!isRecord(freeze.baseImage)) {
    return {
      ok: false,
      error: "VIBODE_STRICT=1 requires freeze.baseImage to be an object (FreezePayloadV2).",
    };
  }

  if (!isRecord(freeze.calibration) || !finiteNumber(freeze.calibration.pxPerIn)) {
    return {
      ok: false,
      error:
        "VIBODE_STRICT=1 requires freeze.calibration.pxPerIn to be a finite number (FreezePayloadV2).",
    };
  }

  if (!isRecord(freeze.staging)) {
    return {
      ok: false,
      error: "VIBODE_STRICT=1 requires freeze.staging to be an object (FreezePayloadV2).",
    };
  }

  if (!Array.isArray(freeze.nodes)) {
    return {
      ok: false,
      error: "VIBODE_STRICT=1 requires freeze.nodes to be an array (FreezePayloadV2).",
    };
  }

  if (typeof freeze.sceneHash !== "string" || freeze.sceneHash.trim().length === 0) {
    return {
      ok: false,
      error: "VIBODE_STRICT=1 requires freeze.sceneHash to be a non-empty string.",
    };
  }

  return { ok: true, payload: freeze as unknown as FreezePayloadV2 };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function translateFreezeV2ToV1(freezeV2: FreezePayloadV2): FreezePayloadV1 {
  const base = freezeV2.baseImage ?? {};
  const widthPx = finiteNumber(base.widthPx) && base.widthPx > 0 ? base.widthPx : 1;
  const heightPx = finiteNumber(base.heightPx) && base.heightPx > 0 ? base.heightPx : 1;

  const storageKey = typeof base.storageKey === "string" ? base.storageKey.trim() : "";
  const signedUrl = typeof base.signedUrl === "string" ? base.signedUrl.trim() : "";
  const imageBase64 = typeof base.imageBase64 === "string" ? base.imageBase64.trim() : "";

  let baseImage: FreezePayloadV1["baseImage"];

  if (storageKey) {
    baseImage = { kind: "storageKey", storageKey, widthPx, heightPx };
  } else if (imageBase64) {
    const dataUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;
    baseImage = { kind: "url", url: dataUrl, widthPx, heightPx };
  } else if (signedUrl) {
    baseImage = { kind: "url", url: signedUrl, widthPx, heightPx };
  } else {
    baseImage = { kind: "url", url: "", widthPx, heightPx };
  }

  const pxPerIn =
    finiteNumber(freezeV2.calibration?.pxPerIn) && freezeV2.calibration.pxPerIn > 0
      ? freezeV2.calibration.pxPerIn
      : 6;

  const v2Nodes = Array.isArray(freezeV2.nodes) ? freezeV2.nodes : [];
  const v1Nodes: FreezePayloadV1["sceneSnapshotImageSpace"]["nodes"] = v2Nodes.map(
    (node, index) => {
      const nodeId =
        typeof node.nodeId === "string" && node.nodeId.trim() ? node.nodeId.trim() : `${index}`;
      const skuId =
        typeof node.sku?.skuId === "string" && node.sku.skuId.trim()
          ? node.sku.skuId.trim()
          : "";

      const footprint = node.footprintIn ?? {};
      const widthIn =
        (finiteNumber(footprint.widthIn) && footprint.widthIn > 0
          ? footprint.widthIn
          : null) ??
        (finiteNumber(footprint.diameterIn) && footprint.diameterIn > 0
          ? footprint.diameterIn
          : null) ??
        (finiteNumber(footprint.lengthIn) && footprint.lengthIn > 0
          ? footprint.lengthIn
          : null);
      const heightIn =
        (finiteNumber(footprint.depthIn) && footprint.depthIn > 0
          ? footprint.depthIn
          : null) ??
        (finiteNumber(footprint.diameterIn) && footprint.diameterIn > 0
          ? footprint.diameterIn
          : null) ??
        (finiteNumber(footprint.lengthIn) && footprint.lengthIn > 0
          ? footprint.lengthIn
          : null);

      const widthPx = Math.max(1, (widthIn ?? 1) * pxPerIn);
      const heightPx = Math.max(1, (heightIn ?? 1) * pxPerIn);

      const cxPx = finiteNumber(node.transform?.cxPx) ? node.transform.cxPx : 0;
      const cyPx = finiteNumber(node.transform?.cyPx) ? node.transform.cyPx : 0;
      const rotation = finiteNumber(node.transform?.rotationDeg) ? node.transform.rotationDeg : 0;
      const zIndex = finiteNumber(node.transform?.zIndex) ? node.transform.zIndex : index;

      return {
        id: nodeId,
        skuId,
        label: skuId || nodeId,
        variantId: undefined,
        transform: {
          x: cxPx - widthPx / 2,
          y: cyPx - heightPx / 2,
          width: widthPx,
          height: heightPx,
          rotation,
        },
        zIndex,
        status: "active",
      };
    }
  );

  const addSkuIds = uniqueStrings(v2Nodes.map((node) => node.sku?.skuId));
  const transformChanged = uniqueStrings(v2Nodes.map((node) => node.nodeId));

  const payload: FreezePayloadV1 & { debug?: { v2SceneHash?: string } } = {
    payloadVersion: "v1",
    generationId: freezeV2.sceneHash,
    baseImage,
    sceneSnapshotImageSpace: {
      sceneId: freezeV2.sceneHash,
      nodes: v1Nodes,
    },
    requestedAction: {
      type: "generate",
      ops: { add: addSkuIds, remove: [], swap: [], transformChanged },
    },
    debug: { v2SceneHash: freezeV2.sceneHash },
  };

  return payload;
}

function validateFreezePayloadV1(
  payload: FreezePayloadV1,
  opts?: { allowBlobOrLocalBaseUrl?: boolean }
): { ok: true } | { ok: false; error: string; details?: unknown } {
  if (!payload || payload.payloadVersion !== "v1") {
    return { ok: false, error: "Invalid payloadVersion (expected 'v1')." };
  }

  if (!payload.generationId || typeof payload.generationId !== "string") {
    return { ok: false, error: "Missing or invalid generationId." };
  }

  const bi = payload.baseImage;
  if (
    !bi ||
    (bi.kind !== "publicUrl" &&
      bi.kind !== "signedUrl" &&
      bi.kind !== "storageKey" &&
      bi.kind !== "url")
  ) {
    return { ok: false, error: "Missing or invalid baseImage.kind." };
  }

  if (
    !finiteNumber(bi.widthPx) ||
    !finiteNumber(bi.heightPx) ||
    bi.widthPx <= 0 ||
    bi.heightPx <= 0
  ) {
    return { ok: false, error: "Missing or invalid baseImage.widthPx/heightPx." };
  }

  if (bi.kind === "storageKey") {
    if (!bi.storageKey || typeof bi.storageKey !== "string") {
      return { ok: false, error: "baseImage.kind='storageKey' requires baseImage.storageKey." };
    }
  } else {
    if (!bi.url || typeof bi.url !== "string") {
      return { ok: false, error: `baseImage.kind='${bi.kind}' requires baseImage.url.` };
    }
    if (!opts?.allowBlobOrLocalBaseUrl && isProbablyBlobOrLocalUrl(bi.url)) {
      return {
        ok: false,
        error: "Invalid baseImage.url (blob/data/file/local URLs are not allowed in v1).",
      };
    }
  }

  const snap = payload.sceneSnapshotImageSpace;
  if (!snap || typeof snap.sceneId !== "string" || !Array.isArray(snap.nodes)) {
    return { ok: false, error: "Missing or invalid sceneSnapshotImageSpace." };
  }

  for (const node of snap.nodes) {
    if (!node || typeof node.id !== "string" || typeof node.skuId !== "string") {
      return {
        ok: false,
        error: "Invalid node shape in sceneSnapshotImageSpace.nodes[].",
        details: node,
      };
    }
    const t = node.transform;
    if (
      !t ||
      !finiteNumber(t.x) ||
      !finiteNumber(t.y) ||
      !finiteNumber(t.width) ||
      !finiteNumber(t.height) ||
      !finiteNumber(t.rotation)
    ) {
      return { ok: false, error: `Invalid transform for id=${node.id}.`, details: t };
    }
    if (t.width <= 0 || t.height <= 0) {
      return {
        ok: false,
        error: `Invalid transform dimensions for id=${node.id} (width/height must be > 0).`,
        details: t,
      };
    }
  }

  if (payload.calibration) {
    if (!finiteNumber(payload.calibration.ppf) || payload.calibration.ppf <= 0) {
      return { ok: false, error: "Invalid calibration.ppf (must be > 0 if provided)." };
    }
  }

  return { ok: true };
}

function deriveOps(payload: FreezePayloadV1): RequestedOps {
  const ops = payload.requestedAction?.ops;
  if (ops) return ops;

  const add: string[] = [];
  const remove: string[] = [];
  const swap: string[] = [];
  const transformChanged: string[] = [];

  for (const n of payload.sceneSnapshotImageSpace.nodes) {
    if (n.status === "markedForDelete") remove.push(n.id);
    if (n.status === "pendingSwap") swap.push(n.id);
    if (n.provenance?.introducedInGenerationId === payload.generationId) add.push(n.id);
  }

  return { add, remove, swap, transformChanged };
}

function countNodeStatuses(payload: FreezePayloadV1) {
  let active = 0;
  let markedForDelete = 0;
  let pendingSwap = 0;

  for (const n of payload.sceneSnapshotImageSpace.nodes) {
    if (n.status === "active") active++;
    if (n.status === "markedForDelete") markedForDelete++;
    if (n.status === "pendingSwap") pendingSwap++;
  }

  return {
    nodesTotal: payload.sceneSnapshotImageSpace.nodes.length,
    active,
    markedForDelete,
    pendingSwap,
  };
}

function headerTruth(req: NextRequest, name: string) {
  const raw = req.headers.get(name);
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

async function mintSignedUrl(args: {
  admin: SupabaseClient;
  bucket: string;
  key: string;
  expiresInSec: number;
}) {
  const { data, error } = await args.admin.storage
    .from(args.bucket)
    .createSignedUrl(args.key, args.expiresInSec);

  if (error || !data?.signedUrl) {
    console.error("[vibode/generate] createSignedUrl error:", error);
    throw new Error(`Failed to create signed URL (bucket=${args.bucket}).`);
  }
  return data.signedUrl;
}

async function resolveBaseImageUrlForModel(
  payload: FreezePayloadV1,
  notes: string[]
): Promise<string> {
  const bi = payload.baseImage;

  if (bi.kind === "storageKey") {
    const admin = getAdminSupabaseClient();
    if (!admin) {
      throw new Error(
        "baseImage.kind='storageKey' requires SUPABASE_SERVICE_ROLE_KEY (server) to mint a signed URL."
      );
    }

    const expiresIn = Math.max(60, Number(process.env.VIBODE_SIGNED_URL_EXPIRES_IN ?? 3600));
    const signedUrl = await mintSignedUrl({
      admin,
      bucket: VIBODE_IMAGES_BUCKET,
      key: bi.storageKey!,
      expiresInSec: expiresIn,
    });

    notes.push(
      `Resolved storageKey -> signedUrl (bucket=${VIBODE_IMAGES_BUCKET}, exp=${expiresIn}s).`
    );
    return signedUrl;
  }

  const url = bi.url?.trim() ?? "";
  if (!url) throw new Error("Missing baseImage.url for model mode.");
  return url;
}

async function fetchImageAsBase64(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch base image for base64: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const base64 = buf.toString("base64");

  if (base64.length > VIBODE_MAX_MODEL_IMAGE_BASE64_LEN) {
    throw new Error(
      `Base image too large for Nano Banana request (base64Len=${base64.length}, max=${VIBODE_MAX_MODEL_IMAGE_BASE64_LEN}).`
    );
  }

  return { base64 };
}

const IKEA_CA_SKU_BY_ID = new Map(IKEA_CA_SKUS.map((sku) => [sku.skuId, sku]));

function resolveIkeaSkuImageUrl(skuId: string): string | null {
  const found = IKEA_CA_SKU_BY_ID.get(skuId);
  const url = typeof found?.imageUrl === "string" ? found.imageUrl.trim() : "";
  return url.length > 0 ? url : null;
}

/* =========================
   Auto-stage: avoid NB "Nothing to do."
========================= */

function opsIsEmpty(ops: RequestedOps) {
  return (
    (ops.add?.length ?? 0) === 0 &&
    (ops.remove?.length ?? 0) === 0 &&
    (ops.swap?.length ?? 0) === 0 &&
    (ops.transformChanged?.length ?? 0) === 0
  );
}

function pickAutoAddCount(bundleId?: "small" | "medium" | "large") {
  if (bundleId === "small") return 6;
  if (bundleId === "large") return 8;
  return 7;
}

/**
 * If the canvas has zero nodes AND ops are empty, interpret Generate as:
 * "Auto-stage from the selected bundle / skuIdsInPlay".
 */
function ensureNonEmptyRequestedActionForModel(payload: FreezePayloadV1, notes: string[]) {
  const cloned: FreezePayloadV1 = structuredClone(payload);

  const ws = cloned.workingSetSnapshot;
  const skuIds = Array.isArray(ws?.skuIdsInPlay)
    ? ws!.skuIdsInPlay.filter((s) => typeof s === "string" && s.trim())
    : [];

  const nodesTotal = Array.isArray(cloned.sceneSnapshotImageSpace?.nodes)
    ? cloned.sceneSnapshotImageSpace.nodes.length
    : 0;

  const existingOps = normalizeRequestedOps(cloned.requestedAction?.ops ?? null);

  // Only auto-stage on the first generate (0 nodes) and no ops provided.
  if (nodesTotal > 0) return cloned;
  if (!opsIsEmpty(existingOps)) return cloned;

  if (skuIds.length === 0) {
    notes.push(
      "Model action was empty and no skuIdsInPlay available; model would normally return 'Nothing to do.'"
    );
    return cloned;
  }

  const targetCount = Math.min(skuIds.length, pickAutoAddCount(ws?.bundleId));
  const autoAdds = skuIds.slice(0, targetCount);

  cloned.requestedAction = {
    type: "generate",
    ops: {
      add: autoAdds,
      remove: [],
      swap: [],
      transformChanged: [],
    },
  };

  notes.push(
    `Auto-stage enabled: ops were empty and canvas had 0 nodes, so we set ops.add to ${autoAdds.length} skuIds from skuIdsInPlay (bundle=${ws?.bundleId ?? "?"}).`
  );

  return cloned;
}

/* =========================
   Nano Banana Pro (legacy /stage-room)
========================= */

class NanoBananaError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string) {
    super(`Nano Banana Pro error (${status}): ${bodyText || "Unknown error"}`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

type LegacyStageRoomRequest = {
  imageBase64: string;
  styleId?: string | null;
  enhancePhoto?: boolean;
  cleanupRoom?: boolean;
  repairDamage?: boolean;
  emptyRoom?: boolean;
  renovateRoom?: boolean;
  repaintWalls?: boolean;
  flooringPreset?: string | null;
  roomType?: string | null;
  modelVersion?: string | null;
  aspectRatio?: "auto" | "4:3" | "3:2" | "16:9" | "1:1";
  isContinuation?: boolean;
};

function safeStr(x: unknown): string | null {
  return typeof x === "string" && x.trim().length > 0 ? x.trim() : null;
}

function resolveStyleId(args: {
  payloadVersion: string | null;
  freezeRaw: unknown;
  payloadV1Translated: FreezePayloadV1;
}) {
  const envKickstart = (process.env.VIBODE_NB_KICKSTART_STYLE_ID || "").trim();
  let styleId: string | null = null;

  if (args.payloadVersion === "v2" && isRecord(args.freezeRaw)) {
    const staging = isRecord((args.freezeRaw as any).staging) ? (args.freezeRaw as any).staging : null;
    const styleBandRaw = typeof staging?.styleBand === "string" ? staging.styleBand.trim() : "";
    if (styleBandRaw && styleBandRaw !== "custom") {
      styleId = STYLE_BAND_TO_NB_STYLE_ID[styleBandRaw as StyleBand] ?? styleBandRaw;
    }
  }

  if (!styleId) {
    styleId =
      safeStr((args.payloadV1Translated as any)?.requestedAction?.styleId) ??
      safeStr((args.payloadV1Translated as any)?.styleId);
  }

  if (!styleId) {
    styleId = envKickstart || DEFAULT_NB_STYLE_ID;
  }

  return styleId;
}

function pickLegacyAspectRatioFromFreeze(
  payload: FreezePayloadV1
): LegacyStageRoomRequest["aspectRatio"] {
  const a =
    safeStr((payload as any)?.requestedAction?.aspectRatio) ??
    safeStr((payload as any)?.aspectRatio);
  if (!a) return "auto";
  const v = a.toLowerCase().replace("x", ":");
  if (v === "auto" || v === "4:3" || v === "3:2" || v === "16:9" || v === "1:1") return v;
  return "auto";
}

function toPromptSafeToken(value: unknown, fallback: string) {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 ? v : fallback;
}

function buildVibodePrompt(args: {
  payload: FreezePayloadV1;
  payloadVersion: string | null;
  freezeRaw: unknown;
  resolvedStyleId: string;
}) {
  const staging =
    args.payloadVersion === "v2" && isRecord(args.freezeRaw)
      ? (isRecord((args.freezeRaw as any).staging) ? (args.freezeRaw as any).staging : null)
      : null;

  const roomType = toPromptSafeToken(staging?.roomType, "other");
  const styleBand = toPromptSafeToken(staging?.styleBand, "custom");
  const lightingBand = toPromptSafeToken(staging?.lightingBand, "unspecified");
  const cameraBand = toPromptSafeToken(staging?.cameraBand, "unspecified");
  const decorAllowance = toPromptSafeToken(staging?.decorAllowance, "unspecified");

  const vendorById = new Map<string, string>();
  const categoryById = new Map<string, string>();

  if (args.payloadVersion === "v2" && isRecord(args.freezeRaw)) {
    const nodesRaw = Array.isArray((args.freezeRaw as any).nodes) ? (args.freezeRaw as any).nodes : [];
    for (const node of nodesRaw) {
      if (!isRecord(node)) continue;
      const nodeId = typeof (node as any).nodeId === "string" ? (node as any).nodeId : "";
      if (!nodeId) continue;
      const vendor =
        typeof (node as any)?.sku?.vendor === "string" ? (node as any).sku.vendor.trim() : "";
      const category =
        typeof (node as any)?.intent?.category === "string"
          ? (node as any).intent.category.trim()
          : "";
      if (vendor) vendorById.set(nodeId, vendor);
      if (category) categoryById.set(nodeId, category);
    }
  }

  const nodes = [...args.payload.sceneSnapshotImageSpace.nodes]
    .filter((n) => n.status !== "markedForDelete")
    .sort((a, b) => {
      const za = finiteNumber(a.zIndex) ? a.zIndex : 0;
      const zb = finiteNumber(b.zIndex) ? b.zIndex : 0;
      if (za !== zb) return za - zb;
      return (a.id || "").localeCompare(b.id || "");
    });

  const maxNodes = 50;
  const clipped = nodes.slice(0, maxNodes);
  const overflow = Math.max(0, nodes.length - clipped.length);

  const lines: string[] = [];
  lines.push(
    `roomType=${roomType} styleBand=${styleBand} styleId=${args.resolvedStyleId} lightingBand=${lightingBand} cameraBand=${cameraBand} decorAllowance=${decorAllowance}`
  );
  lines.push(
    "Preserve the original room exactly (architecture, existing furniture, materials, colors)."
  );
  lines.push("Do not restyle or redecorate.");
  lines.push("Only add/place the listed items at the exact boxes (x,y,w,h,rot).");
  lines.push("Do not move, resize, or rotate any listed boxes.");
  lines.push("Do not invent any other furniture or decor.");
  lines.push("Coordinates are image-space px on the base image.");
  lines.push("Respect zIndex ordering for overlaps.");
  lines.push("Keep the camera angle and lighting unchanged.");
  lines.push("Placed furniture (image-space px):");

  if (clipped.length === 0) {
    lines.push("- none");
  } else {
    for (const node of clipped) {
      const skuId = toPromptSafeToken(node.skuId, node.id || "unknown");
      const vendor = vendorById.get(node.id) ?? "";
      const category = categoryById.get(node.id) ?? "furniture";
      const t = node.transform;
      const x = finiteNumber(t?.x) ? Math.round(t.x) : 0;
      const y = finiteNumber(t?.y) ? Math.round(t.y) : 0;
      const w = finiteNumber(t?.width) ? Math.round(t.width) : 0;
      const h = finiteNumber(t?.height) ? Math.round(t.height) : 0;
      const rot = finiteNumber(t?.rotation) ? Math.round(t.rotation) : 0;
      const vendorPart = vendor ? ` vendor=${vendor}` : "";
      lines.push(
        `- skuId=${skuId}${vendorPart} category=${category || "furniture"} x=${x} y=${y} w=${w} h=${h} rot=${rot}`
      );
    }
  }

  if (overflow > 0) {
    lines.push(`- ... ${overflow} more omitted`);
  }

  return lines.join("\n");
}

/**
 * Legacy /stage-room contract:
 * - expects top-level { imageBase64, styleId, ... }
 * - returns { imageUrl }
 */
async function callNanoBananaPro(args: {
  payload: FreezePayloadV1;
  baseImageUrlForModel: string;
  notes: string[];
  styleId: string;
  vibodePrompt?: string;
  placementTestMode?: boolean;
}) {
  const url = process.env.NANOBANANA_PRO_URL;
  const apiKey = process.env.NANOBANANA_PRO_API_KEY;

  if (!url || !apiKey) {
    throw new Error(
      "Nano Banana Pro is not configured (missing NANOBANANA_PRO_URL or NANOBANANA_PRO_API_KEY)."
    );
  }

  const { base64: imageBase64 } = await fetchImageAsBase64(args.baseImageUrlForModel);

  const styleId = args.styleId;
  const modelVersion = safeStr((args.payload as any)?.modelVersion) ?? "gemini-3";
  const aspectRatio = pickLegacyAspectRatioFromFreeze(args.payload);
  const vibodePrompt = safeStr(args.vibodePrompt);
  const vibodePromptTriggersWork =
    (process.env.VIBODE_NB_VIBODEPROMPT_TRIGGERS_WORK ?? "true").toLowerCase() !== "false";
  const placementTestModeActive = Boolean(args.placementTestMode && vibodePrompt);

  const body: LegacyStageRoomRequest = placementTestModeActive
    ? {
        imageBase64,
        styleId: null,
        enhancePhoto: true,
        modelVersion,
        aspectRatio,
        isContinuation: false,
      }
    : {
        imageBase64,
        styleId,
        enhancePhoto: false,
        cleanupRoom: false,
        repairDamage: false,
        emptyRoom: false,
        renovateRoom: false,
        repaintWalls: false,
        flooringPreset: null,
        roomType: null,
        modelVersion,
        aspectRatio,
        isContinuation: false,
      };

  if (placementTestModeActive) {
    args.notes.push(
      "Placement test mode active: forcing enhancePhoto=true and styleId=null for legacy /stage-room."
    );
  } else {
    args.notes.push(`Resolved styleId='${styleId}' applied for legacy /stage-room.`);
  }
  if (vibodePrompt) {
    (body as LegacyStageRoomRequest & { prompt?: string; instruction?: string }).prompt =
      vibodePrompt;
    (body as LegacyStageRoomRequest & { prompt?: string; instruction?: string }).instruction =
      vibodePrompt;
    args.notes.push("Injected Vibode prompt into legacy /stage-room request.");
    if (vibodePromptTriggersWork && !placementTestModeActive) {
      if ("enhancePhoto" in body) {
        body.enhancePhoto = true;
      } else if ("cleanupRoom" in body) {
        body.cleanupRoom = true;
      }
    } else {
      args.notes.push("Vibode prompt triggers disabled; skipping enhance/cleanup toggles.");
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new NanoBananaError(res.status, text || res.statusText);
  }

  const data = (await res.json()) as { imageUrl?: string };
  if (!data?.imageUrl) throw new Error("Nano Banana Pro did not return imageUrl.");
  return { imageUrl: data.imageUrl };
}

async function callNanoBananaProPrompt(args: {
  baseImageUrlForModel: string;
  prompt: string;
  aspectRatio?: string;
  seed?: number;
}) {
  const url = process.env.NANOBANANA_PRO_URL;
  const apiKey = process.env.NANOBANANA_PRO_API_KEY;

  if (!url || !apiKey) {
    throw new Error(
      "Nano Banana Pro is not configured (missing NANOBANANA_PRO_URL or NANOBANANA_PRO_API_KEY)."
    );
  }

  const { base64: imageBase64 } = await fetchImageAsBase64(args.baseImageUrlForModel);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      imageBase64,
      prompt: args.prompt,
      aspect_ratio: args.aspectRatio,
      seed: args.seed,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new NanoBananaError(res.status, text || res.statusText);
  }

  const contentType = res.headers.get("content-type") || "";

  if (contentType.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");
    return { imageUrl: `data:${contentType};base64,${base64}` };
  }

  const data = (await res.json().catch(() => ({}))) as {
    imageUrl?: string;
    image_url?: string;
    url?: string;
    image_base64?: string;
    base64?: string;
    imageBase64?: string;
    mime?: string;
    contentType?: string;
  };

  const directUrl = data?.imageUrl || data?.image_url || data?.url;
  if (typeof directUrl === "string" && directUrl.length > 0) {
    return { imageUrl: directUrl };
  }

  const base64 = data?.image_base64 || data?.base64 || data?.imageBase64;
  if (typeof base64 === "string" && base64.length > 0) {
    const mime = typeof data?.mime === "string" ? data.mime : data?.contentType || "image/png";
    return { imageUrl: `data:${mime};base64,${base64}` };
  }

  throw new Error("Nano Banana Pro did not return a usable image.");
}

/* =========================
   Output download (supports http(s) AND data:image/*;base64,...)
========================= */

function isDataUrl(s: string) {
  return typeof s === "string" && s.startsWith("data:");
}

function parseDataUrlImage(dataUrl: string): { mime: string; buf: Buffer } {
  const m = dataUrl.trim().match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid data URL");
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

async function fetchImageAsBytes(url: string): Promise<Buffer> {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) throw new Error("Missing image URL for bytes fetch.");

  if (isDataUrl(trimmed)) {
    const { buf } = parseDataUrlImage(trimmed);
    if (buf.length > VIBODE_MAX_MODEL_IMAGE_BYTES) {
      throw new Error(
        `Image too large for compositor request (bytes=${buf.length}, max=${VIBODE_MAX_MODEL_IMAGE_BYTES}).`
      );
    }
    return buf;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Image URL must be http(s) or data URL.");
  }

  const res = await fetch(trimmed);
  if (!res.ok) throw new Error(`Failed to fetch image bytes: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length > VIBODE_MAX_MODEL_IMAGE_BYTES) {
    throw new Error(
      `Image too large for compositor request (bytes=${buf.length}, max=${VIBODE_MAX_MODEL_IMAGE_BYTES}).`
    );
  }

  return buf;
}

type VibodeSwapReplacement = {
  kind: "sku";
  skuId: string;
  imageUrl: string;
};

type VibodeSwapMark = {
  id: string;
  x: number;
  y: number;
  replacement: VibodeSwapReplacement;
};

type VibodeRotateMark = {
  id: string;
  x: number;
  y: number;
  angleDeg: number;
};

function clampUnit(n: number) {
  return Math.max(0, Math.min(1, n));
}

function clampRotateAngle(n: number) {
  return Math.max(-180, Math.min(180, n));
}

function parseVibodeSwapMarks(vibodeIntent: unknown): VibodeSwapMark[] {
  if (!isRecord(vibodeIntent)) return [];
  if (vibodeIntent.mode !== "tools") return [];
  if (!isRecord(vibodeIntent.swap)) return [];
  if (!Array.isArray(vibodeIntent.swap.marks) || vibodeIntent.swap.marks.length === 0) return [];

  const marks: VibodeSwapMark[] = [];
  for (const markRaw of vibodeIntent.swap.marks) {
    if (!isRecord(markRaw)) return [];
    const id = safeStr(markRaw.id);
    const x = markRaw.x;
    const y = markRaw.y;
    const replacement = markRaw.replacement;
    if (!id || !finiteNumber(x) || !finiteNumber(y) || !isRecord(replacement)) return [];

    if (replacement.kind !== "sku") return [];
    const skuId = safeStr(replacement.skuId);
    const imageUrl = safeStr(replacement.imageUrl);
    if (!skuId || !imageUrl) return [];

    marks.push({
      id,
      x,
      y,
      replacement: {
        kind: "sku",
        skuId,
        imageUrl,
      },
    });
  }

  return marks;
}

function parseVibodeRotateMarks(vibodeIntent: unknown): VibodeRotateMark[] {
  if (!isRecord(vibodeIntent)) return [];

  const mode = vibodeIntent.mode;
  if (mode !== "tools" && mode !== "place" && mode !== "remove") return [];
  if (!isRecord(vibodeIntent.rotate)) return [];
  if (!Array.isArray(vibodeIntent.rotate.marks) || vibodeIntent.rotate.marks.length === 0) return [];

  const marks: VibodeRotateMark[] = [];
  for (const markRaw of vibodeIntent.rotate.marks) {
    if (!isRecord(markRaw)) return [];

    const id = safeStr(markRaw.id);
    const x = markRaw.x;
    const y = markRaw.y;
    const angleDeg = markRaw.angleDeg;
    if (!id || !finiteNumber(x) || !finiteNumber(y) || !finiteNumber(angleDeg)) return [];

    marks.push({
      id,
      x: clampUnit(x),
      y: clampUnit(y),
      angleDeg: clampRotateAngle(angleDeg),
    });
  }

  return marks;
}

function buildVibodeSwapReplacementAssets(marks: VibodeSwapMark[]) {
  const assets: VibodeSwapReplacement[] = [];
  const seen = new Set<string>();

  // Preserve deterministic order by scanning marks in-order.
  for (const mark of marks) {
    const replacement = mark.replacement;
    const key = `${replacement.kind}:${replacement.skuId}:${replacement.imageUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assets.push(replacement);
  }

  return assets;
}

async function callCompositorVibodeSwap(args: {
  cleanBase64: string;
  marks: VibodeSwapMark[];
  replacementAssets: VibodeSwapReplacement[];
  modelVersion?: string | null;
}): Promise<{ imageUrl: string }> {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();

  if (!endpointBase) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }

  const endpointBaseNormalized = endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/vibode\/compose\/?$/, "")
    .replace(/\/vibode\/remove\/?$/, "")
    .replace(/\/vibode\/swap\/?$/, "")
    .replace(/\/$/, "");
  const endpoint = `${endpointBaseNormalized}/vibode/swap`;
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  console.log("[callCompositorVibodeSwap] request", {
    endpoint,
    marks: args.marks.length,
    replacementAssets: args.replacementAssets.length,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      cleanBase64: args.cleanBase64,
      marks: args.marks,
      replacementAssets: args.replacementAssets,
      modelVersion: args.modelVersion ?? null,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Compositor backend error (swap): ${res.status} ${text}`.trim());
  }

  const data = (await res.json()) as { imageUrl?: string };
  if (!data?.imageUrl) {
    throw new Error("Compositor swap did not return imageUrl");
  }

  return { imageUrl: data.imageUrl };
}

function inferExtFromContentType(ct: string) {
  const c = (ct || "").toLowerCase();
  if (c.includes("jpeg") || c.includes("jpg")) return { ext: "jpg", contentType: "image/jpeg" };
  if (c.includes("webp")) return { ext: "webp", contentType: "image/webp" };
  if (c.includes("png")) return { ext: "png", contentType: "image/png" };
  return { ext: "png", contentType: "image/png" };
}

async function downloadModelImageToBuffer(modelImageUrl: string) {
  if (isDataUrl(modelImageUrl)) {
    const { mime, buf } = parseDataUrlImage(modelImageUrl);
    return { buf, contentType: mime };
  }

  const res = await fetch(modelImageUrl);
  if (!res.ok) throw new Error(`Failed to fetch model image (${res.status}).`);
  const contentType = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType };
}

/**
 * Persist model output to Supabase Storage.
 * Storage key:
 *   {userId}/{sceneId}/{generationId}/staged.{ext}
 */
async function persistModelImageToStorage(args: {
  admin: SupabaseClient | null;
  userId: string;
  sceneId: string;
  generationId: string;
  modelImageUrl: string;
  notes: string[];
}) {
  if (!args.admin) {
    args.notes.push(
      "No SUPABASE_SERVICE_ROLE_KEY available; returning raw model imageUrl (not persisted)."
    );
    return {
      imageUrl: args.modelImageUrl,
      storageKey: undefined as string | undefined,
      bucket: undefined as string | undefined,
      signedUrlExpiresInSec: undefined as number | undefined,
      widthPx: undefined as number | undefined,
      heightPx: undefined as number | undefined,
    };
  }

  const { buf, contentType } = await downloadModelImageToBuffer(args.modelImageUrl);
  const inferred = inferExtFromContentType(contentType);

  const storageKey = `${args.userId}/${args.sceneId}/${args.generationId}/staged.${inferred.ext}`;

  const { error: upErr } = await args.admin.storage
    .from(VIBODE_STAGED_BUCKET)
    .upload(storageKey, buf, { contentType: inferred.contentType, upsert: true });

  if (upErr) {
    console.error("[vibode/generate] staged upload error:", upErr);
    throw new Error("Failed to upload staged image.");
  }

  const expiresInSec = Math.max(
    60,
    Number(process.env.VIBODE_STAGED_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 24 * 7)
  );

  const signedUrl = await mintSignedUrl({
    admin: args.admin,
    bucket: VIBODE_STAGED_BUCKET,
    key: storageKey,
    expiresInSec,
  });

  args.notes.push(`Staged image persisted to Storage (bucket=${VIBODE_STAGED_BUCKET}).`);

  return {
    imageUrl: signedUrl,
    storageKey,
    bucket: VIBODE_STAGED_BUCKET,
    signedUrlExpiresInSec: expiresInSec,
    widthPx: undefined as number | undefined,
    heightPx: undefined as number | undefined,
  };
}

/* =========================
   Route
========================= */

type ModeResponse = ReturnType<typeof json>;
export type VibodeRouteMode = "compose" | "remove" | "swap" | "vibe";

async function handleSwap(args: {
  vibodeIntent: any;
  swapMarks: VibodeSwapMark[];
  baseImageUrlForModel: string;
  payloadForModel: FreezePayloadV1;
  notes: string[];
}): Promise<string> {
  const replacementAssets = buildVibodeSwapReplacementAssets(args.swapMarks);
  console.log("[vibode/generate] vibode swap mode detected", {
    mode: args.vibodeIntent?.mode ?? null,
    marks: args.swapMarks.length,
    replacementAssets: replacementAssets.length,
  });

  const cleanBytes = await fetchImageAsBytes(args.baseImageUrlForModel);
  const cleanBase64 = cleanBytes.toString("base64");
  const swapResult = await callCompositorVibodeSwap({
    cleanBase64,
    marks: args.swapMarks,
    replacementAssets,
    modelVersion: safeStr((args.payloadForModel as any)?.modelVersion),
  });
  args.notes.push(
    `Vibode Swap tools mode: compositor /vibode/swap used (marks=${args.swapMarks.length}, assets=${replacementAssets.length}).`
  );
  return swapResult.imageUrl;
}

async function handleRemove(args: {
  vibodeIntent: any;
  baseImageUrlForModel: string;
  payloadForModel: FreezePayloadV1;
  notes: string[];
}): Promise<{ modelImageUrl?: string; response?: ReturnType<typeof json> }> {
  const marks = args.vibodeIntent.marks as Array<{
    id: string;
    x: number;
    y: number;
    r: number;
    labelIndex?: number;
  }>;

  const cleanBytes = await fetchImageAsBytes(args.baseImageUrlForModel);
  const cleanBase64 = cleanBytes.toString("base64");

  try {
    const removeResult = await callCompositorVibodeRemove({
      cleanBase64,
      marks,
      modelVersion: safeStr((args.payloadForModel as any)?.modelVersion),
    });
    args.notes.push(`Vibode Remove v1: compositor /vibode/remove used (marks=${marks.length}).`);
    return { modelImageUrl: removeResult.imageUrl };
  } catch (removeErr: any) {
    const is404 = removeErr?.message?.includes("404");
    if (is404) {
      return {
        response: json(501, {
          error:
            "Remove mode requires compositor support. Compositor /vibode/remove is not available (404).",
        }),
      };
    }
    throw removeErr;
  }
}

async function handleCompose(args: {
  payloadVersion: string | null;
  payloadForModel: FreezePayloadV1;
  baseImageUrlForModel: string;
  notes: string[];
  resolvedStyleId: string;
  shouldUseVibodePrompt: boolean;
  vibodePrompt: string | null;
  placementTestModeActive: boolean;
}): Promise<{ modelImageUrl?: string; response?: ReturnType<typeof json> }> {
  const composeEligible =
    args.payloadVersion === "v2" || args.payloadForModel.sceneSnapshotImageSpace.nodes.length > 0;
  const placements: Array<{
    nodeId: string;
    skuId?: string | null;
    skuImageBytes: Buffer;
    cxPx: number;
    cyPx: number;
    rPx?: number | null;
    zIndex: number;
    layerKind?: string;
  }> = [];

  if (useCompose && composeEligible) {
    const nodes = args.payloadForModel.sceneSnapshotImageSpace.nodes.filter(
      (n) => n.status !== "markedForDelete"
    );
    const skuBytesById = new Map<string, Buffer>();
    let skippedMissingSku = 0;
    let skippedInvalid = 0;
    let skippedFetch = 0;

    for (const node of nodes) {
      const nodeId = typeof node.id === "string" ? node.id.trim() : "";
      const skuId = typeof node.skuId === "string" ? node.skuId.trim() : "";
      if (!nodeId || !skuId) {
        skippedInvalid += 1;
        continue;
      }

      const t = node.transform;
      const x = finiteNumber(t?.x) ? t.x : 0;
      const y = finiteNumber(t?.y) ? t.y : 0;
      const w = finiteNumber(t?.width) ? t.width : 0;
      const h = finiteNumber(t?.height) ? t.height : 0;

      if (w <= 0 || h <= 0) {
        skippedInvalid += 1;
        continue;
      }

      const skuImageUrl = resolveIkeaSkuImageUrl(skuId);
      if (!skuImageUrl) {
        skippedMissingSku += 1;
        continue;
      }

      let skuImageBytes = skuBytesById.get(skuId);
      if (!skuImageBytes) {
        try {
          skuImageBytes = await fetchImageAsBytes(skuImageUrl);
          skuBytesById.set(skuId, skuImageBytes);
        } catch (e) {
          console.warn("[vibode/generate] sku image fetch failed", {
            skuId,
            nodeId,
            error: e instanceof Error ? e.message : String(e),
          });
          skippedFetch += 1;
          continue;
        }
      }

      const minDim = Math.min(w, h);
      const rRaw = Math.round(minDim * 0.35);
      const rMax = Math.max(20, Math.floor(minDim / 4));
      const rPx = Math.min(Math.max(rRaw, 20), rMax);

      // z-order + layer backfill for nodes missing layerKind/zIndex
      const sku = IKEA_CA_SKU_BY_ID.get(skuId);
      const layerKind: LayerKind = node.layerKind ?? inferLayerKindFromSkuKind(sku?.kind);
      const zIndex = ensureZIndex(layerKind, node.zIndex);

      placements.push({
        nodeId,
        skuId,
        skuImageBytes,
        cxPx: x + w / 2,
        cyPx: y + h / 2,
        rPx,
        zIndex,
        layerKind,
      });
    }

    if (process.env.NODE_ENV !== "production" && placements.length > 0) {
      const sorted = [...placements].sort((a, b) => a.zIndex - b.zIndex);
      console.log(
        "[vibode/generate] placements (z-order)",
        sorted.map((p) => ({ nodeId: p.nodeId, layerKind: p.layerKind, zIndex: p.zIndex }))
      );
    }

    args.notes.push(
      `Compose placements built=${placements.length}, nodes=${nodes.length}, skippedMissingSku=${skippedMissingSku}, skippedInvalid=${skippedInvalid}, skippedFetch=${skippedFetch}.`
    );
  } else {
    args.notes.push(`Compose path disabled or ineligible (useCompose=${useCompose}).`);
  }

  if (useCompose && placements.length > 0) {
    const roomImageBytes = await fetchImageAsBytes(args.baseImageUrlForModel);
    const composeResult = await callCompositorVibodeCompose({
      roomImageBytes,
      placements,
      enhancePhoto: true,
      modelVersion: safeStr((args.payloadForModel as any)?.modelVersion),
      aspectRatio: pickLegacyAspectRatioFromFreeze(args.payloadForModel),
    });
    args.notes.push(`Compositor /vibode/compose used (placements=${placements.length}).`);
    return { modelImageUrl: composeResult.imageUrl };
  }

  if (!VIBODE_ALLOW_LEGACY_STAGE) {
    args.notes.push(
      "Blocked legacy /stage-room Nano Banana fallback because VIBODE_ALLOW_LEGACY_STAGE=0."
    );
    return {
      response: json(501, {
        error:
          "Legacy stage-room Nano Banana fallback is disabled (VIBODE_ALLOW_LEGACY_STAGE=0).",
      }),
    };
  }

  const result = await callNanoBananaPro({
    payload: args.payloadForModel,
    baseImageUrlForModel: args.baseImageUrlForModel,
    notes: args.notes,
    styleId: args.resolvedStyleId,
    vibodePrompt: args.shouldUseVibodePrompt ? args.vibodePrompt ?? undefined : undefined,
    placementTestMode: args.placementTestModeActive,
  });
  args.notes.push(
    `Legacy /stage-room Nano Banana used (useCompose=${useCompose}, placements=${placements.length}).`
  );
  return { modelImageUrl: result.imageUrl };
}

export async function handleGenerateRequest(args: {
  req: NextRequest;
  freeze: unknown;
  payloadVersion: string | null;
  payload: FreezePayloadV1;
}): Promise<ModeResponse> {
  const { req, freeze, payloadVersion, payload } = args;
  const xVibodeEchoRaw = req.headers.get("x-vibode-echo");
  const xForceModelRaw = req.headers.get("x-vibode-force-model");

  const forceEchoRequested = headerTruth(req, "x-vibode-echo");
  const forceModel = headerTruth(req, "x-vibode-force-model");

  const vibodeEchoOnlyRaw = process.env.VIBODE_ECHO_ONLY ?? null;
  const echoOnly = (process.env.VIBODE_ECHO_ONLY ?? "false").toLowerCase() === "true";

  // Determine if echo is even allowed (only for blob/local base image URLs)
  const baseImage = isRecord(payload) && isRecord(payload.baseImage) ? payload.baseImage : null;
  const baseUrl = typeof baseImage?.url === "string" ? baseImage.url : "";
  const baseImageKind = typeof baseImage?.kind === "string" ? baseImage.kind : null;
  const forceEchoAllowed =
    baseImageKind !== "storageKey" &&
    typeof baseUrl === "string" &&
    baseUrl.length > 0 &&
    isProbablyBlobOrLocalUrl(baseUrl);

  // Only respect x-vibode-echo if it's actually necessary
  const forceEcho = forceEchoRequested && forceEchoAllowed;

  // Determine action type and ops (ops must be computed BEFORE validate options)
  const requestedAction = isRecord(payload) ? payload.requestedAction : null;
  const requestedActionType =
    isRecord(requestedAction) && typeof requestedAction.type === "string"
      ? requestedAction.type
      : null;

  const isGenerateAction = requestedActionType ? requestedActionType === "generate" : true;

  const requestedOps = normalizeRequestedOps(isRecord(requestedAction) ? requestedAction.ops : null);

  // ✅ Correct: non-generate + empty ops => echo-safe no-op
  const isNonGenerateNoop = !isGenerateAction && opsIsEmpty(requestedOps);

  // If you're trying to debug, x-vibode-force-model=true can override echo.
  const willEcho = !forceModel && (forceEcho || echoOnly || isNonGenerateNoop);

  const v = validateFreezePayloadV1(payload, {
    allowBlobOrLocalBaseUrl: willEcho,
  });
  if (!v.ok) {
    return json(400, { error: v.error, details: v.details });
  }

  const generationId = payload.generationId.trim();
  const notes: string[] = [];

  const hasNanoBananaUrl = Boolean(process.env.NANOBANANA_PRO_URL);
  const hasNanoBananaKey = Boolean(process.env.NANOBANANA_PRO_API_KEY);
  const vibodePromptEndpointEnabled =
    (process.env.VIBODE_NB_USE_PROMPT_ENDPOINT ?? "false").toLowerCase() === "true";
  const VIBODE_ALLOW_VIBE_STAGE =
    (process.env.VIBODE_ALLOW_VIBE_STAGE ?? "true").toLowerCase() !== "false";

  const payloadForModel = ensureNonEmptyRequestedActionForModel(payload, notes);
  const resolvedStyleId = resolveStyleId({
    payloadVersion,
    freezeRaw: freeze,
    payloadV1Translated: payloadForModel,
  });
  const shouldUseVibodePrompt =
    payloadVersion === "v2" || payloadForModel.sceneSnapshotImageSpace.nodes.length > 0;
  const vibodePrompt = shouldUseVibodePrompt
    ? buildVibodePrompt({
        payload: payloadForModel,
        payloadVersion,
        freezeRaw: freeze,
        resolvedStyleId,
      })
    : null;
  const placementTestModeActive =
    VIBODE_PLACEMENT_TEST_MODE && shouldUseVibodePrompt && Boolean(vibodePrompt);
  const usePromptEndpoint = false;
  notes.push(`Prompt endpoint enabled=${vibodePromptEndpointEnabled}.`);
  notes.push(`Vibode prompt generated=${Boolean(vibodePrompt)}.`);

  const ops = deriveOps(payloadForModel);
  const counts = countNodeStatuses(payloadForModel);

  console.log("[vibode/generate] freeze_v1", {
    generationId,
    auth: req.headers.get("authorization") ? "[present]" : null,
    baseImageKind: payload.baseImage.kind,
    baseImageUrl: safeUrlForLogs(payload.baseImage.url) ?? null,
    baseImageStorageKey: payload.baseImage.storageKey ?? null,
    counts,
    ops,
    hasCalibration: Boolean(payload.calibration),
    willEcho,
    forceEchoRequested,
    forceEchoAllowed,
    forceEcho,
    echoOnly,
    forceModel,
    xVibodeEchoRaw,
    xForceModelRaw,
    vibodeEchoOnlyRaw,
    hasNanoBananaUrl,
    hasNanoBananaKey,
    stagedBucket: VIBODE_STAGED_BUCKET,
    resolvedStyleId,
    shouldUseVibodePrompt,
    vibodePromptEndpointEnabled,
    usePromptEndpoint,
  });

  if (willEcho) {
    notes.push(
      forceEcho
        ? "DEV ECHO: x-vibode-echo=true AND base image is blob/local. Auth + token spend bypassed. No model call performed."
        : echoOnly
        ? "Echo mode enabled (VIBODE_ECHO_ONLY=true). Auth + token spend bypassed. No model call performed."
        : "Echo mode enabled (non-generate no-op). Auth + token spend bypassed. No model call performed."
    );

    if (forceEchoRequested && !forceEchoAllowed) {
      notes.push(
        "NOTE: x-vibode-echo=true was received but ignored because base image is not blob/local."
      );
    }

    if (payload.baseImage.kind === "storageKey") {
      notes.push(
        "Base image uses storageKey. In model mode, server will mint a signed URL (requires SUPABASE_SERVICE_ROLE_KEY)."
      );
    }

    return json(200, {
      ok: true,
      generationId,
      mode: "echo",
      tokenCost: 0,
      tokenBalance: 0,
      debug: {
        payloadVersion: "v1",
        baseImage: {
          kind: payload.baseImage.kind,
          url: payload.baseImage.url,
          storageKey: payload.baseImage.storageKey,
        },
        counts,
        ops,
        notes,
        echo: {
          xVibodeEchoRaw,
          forceEchoRequested,
          forceEchoAllowed,
          forceEcho,
          echoOnly,
          willEcho,
          xVibodeForceModelRaw: xForceModelRaw,
          forceModel,
          hasNanoBananaUrl,
          hasNanoBananaKey,
          vibodeEchoOnlyRaw,
        },
      },
    });
  }

  // --- Model mode below this line requires auth + token spend ---

  const { supabase, token } = getUserSupabaseClient(req);

  if (!token || !supabase) {
    return json(401, {
      error:
        "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
    });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { error: "Unauthorized" });
  }
  const user = userData.user;

  const tokenCost = 1;

  const { data: spendData, error: spendErr } = await supabase.rpc("try_spend_tokens", {
    p_cost: tokenCost,
    p_external_id: generationId,
    p_reason: "vibode_generate:v1",
  });

  if (spendErr) {
    console.error("[vibode/generate] try_spend_tokens error:", spendErr);
    return json(500, { error: "Token spend failed" });
  }

  const spendRow = Array.isArray(spendData) ? spendData[0] : null;
  const spentOk = Boolean(spendRow?.success);
  const balanceAfterSpend = typeof spendRow?.balance === "number" ? spendRow.balance : null;

  if (!spentOk) {
    return json(402, {
      error: "Insufficient tokens",
      details: { required: tokenCost, tokenBalance: balanceAfterSpend ?? 0 },
    });
  }

  // Resolve a model-ready base image URL (supports storageKey -> signedUrl)
  let baseImageUrlForModel = "";
  try {
    baseImageUrlForModel = await resolveBaseImageUrlForModel(payloadForModel, notes);
    if (isProbablyBlobOrLocalUrl(baseImageUrlForModel)) {
      throw new Error("Resolved base image URL is not valid for model mode (blob/local).");
    }
  } catch (e: any) {
    const { error: refundErr } = await supabase.from("token_ledger").insert({
      user_id: user.id,
      delta: tokenCost,
      kind: "refund",
      external_id: generationId,
      reason: "vibode_generation_failed_refund",
      job_id: generationId,
    });
    if (refundErr) console.error("[vibode/generate] refund insert error:", refundErr);

    return json(500, {
      error: e instanceof Error ? e.message : "Failed to prepare base image for model mode.",
    });
  }

  // Real model call
  let modelImageUrl: string | null = null;

  try {
    const freezeV2Raw =
      payloadVersion === "v2" && isRecord(freeze) ? (freeze as unknown as FreezePayloadV2) : null;
    const vibodeIntent =
      isRecord(freeze) && isRecord((freeze as any).vibodeIntent)
        ? (freeze as any).vibodeIntent
        : isRecord((payloadForModel as any).vibodeIntent)
        ? (payloadForModel as any).vibodeIntent
        : null;
    const rotateMarks = parseVibodeRotateMarks(vibodeIntent);
    const isRotateMode = Boolean(freezeV2Raw && rotateMarks.length > 0);
    const isMoveMode = Boolean(vibodeIntent?.move?.marks?.length);
    const swapMarks = parseVibodeSwapMarks(vibodeIntent);
    const isSwapMode = swapMarks.length > 0;
    const isVibeStage = isRecord(vibodeIntent) && vibodeIntent.mode === "vibe";
    const isRemoveMode =
      isRecord(vibodeIntent) &&
      vibodeIntent.mode === "remove" &&
      Array.isArray(vibodeIntent.marks) &&
      vibodeIntent.marks.length > 0;

    if (isVibeStage) {
      if (!VIBODE_ALLOW_VIBE_STAGE) {
        return json(501, {
          error: "Vibe stage is disabled (VIBODE_ALLOW_VIBE_STAGE=false).",
        });
      }

      const vibeStageResult = await callNanoBananaPro({
        payload: payloadForModel,
        baseImageUrlForModel,
        notes,
        styleId: resolvedStyleId,
        vibodePrompt: vibodePrompt ?? undefined,
        placementTestMode: false,
      });
      modelImageUrl = vibeStageResult.imageUrl;
      notes.push("Vibe Stage mode used legacy stage-room intentionally.");
    } else if (isRotateMode && freezeV2Raw) {
      console.log("[vibode/generate] vibode rotate mode detected", {
        mode: vibodeIntent.mode,
        marks: rotateMarks.length,
      });

      try {
        const rotateResult = await callCompositorVibodeRotate({
          freezePayload: freezeV2Raw,
          baseImageUrl: baseImageUrlForModel,
          modelVersion: safeStr((payloadForModel as any)?.modelVersion),
          aspectRatio: pickLegacyAspectRatioFromFreeze(payloadForModel),
        });
        modelImageUrl = rotateResult.imageUrl;
        notes.push(`Vibode Rotate mode: compositor /vibode/rotate used (marks=${rotateMarks.length}).`);
      } catch (rotateErr: any) {
        const is404 = rotateErr?.message?.includes("404");
        if (is404) {
          return json(501, {
            error:
              "Rotate mode requires compositor support. Compositor /vibode/rotate is not available (404).",
          });
        }
        throw rotateErr;
      }
    } else if (isSwapMode) {
      modelImageUrl = await handleSwap({
        vibodeIntent,
        swapMarks,
        baseImageUrlForModel,
        payloadForModel,
        notes,
      });
    } else if (isMoveMode) {
      const originalImageUrl = baseImageUrlForModel;
      const freezePayload = freeze as any;
      try {
        const moveResult = await callCompositorVibodeMove({
          imageUrl: originalImageUrl,
          imageBase64: undefined,
          marks: vibodeIntent.move.marks,
          modelVersion: safeStr((payloadForModel as any)?.modelVersion),
          aspectRatio: freezePayload.aspectRatio ?? "auto",
        });
        modelImageUrl = moveResult.imageUrl;
        notes.push(
          `Vibode Move tools mode: compositor /vibode/move used (marks=${vibodeIntent.move.marks.length}).`
        );
      } catch (moveErr: any) {
        throw moveErr;
      }
    } else if (isRemoveMode) {
      const removeResult = await handleRemove({
        vibodeIntent,
        baseImageUrlForModel,
        payloadForModel,
        notes,
      });
      if (removeResult.response) {
        return removeResult.response;
      }
      modelImageUrl = removeResult.modelImageUrl ?? null;
    } else {
      const composeResult = await handleCompose({
        payloadVersion,
        payloadForModel,
        baseImageUrlForModel,
        notes,
        resolvedStyleId,
        shouldUseVibodePrompt,
        vibodePrompt,
        placementTestModeActive,
      });
      if (composeResult.response) {
        return composeResult.response;
      }
      modelImageUrl = composeResult.modelImageUrl ?? null;
    }
  } catch (modelErr: unknown) {
    console.error("[vibode/generate] model call failed:", modelErr);

    const { error: refundErr } = await supabase.from("token_ledger").insert({
      user_id: user.id,
      delta: tokenCost,
      kind: "refund",
      external_id: generationId,
      reason: "vibode_generation_failed_refund",
      job_id: generationId,
    });

    if (refundErr) console.error("[vibode/generate] refund insert error:", refundErr);

    if (modelErr instanceof NanoBananaError) {
      return json(modelErr.status, { error: modelErr.message });
    }

    const msg = modelErr instanceof Error ? modelErr.message : "Model call failed";
    return json(500, { error: msg });
  }

  if (!modelImageUrl) {
    return json(500, { error: "Model did not return an imageUrl." });
  }

  notes.push("Model call succeeded.");

  // Persist staged output to Supabase Storage (preferred for editor history)
  const admin = getAdminSupabaseClient();
  const sceneId = payloadForModel.sceneSnapshotImageSpace.sceneId;

  try {
    const persisted = await persistModelImageToStorage({
      admin,
      userId: user.id,
      sceneId,
      generationId,
      modelImageUrl,
      notes,
    });

    if (admin && isDataUrl(persisted.imageUrl)) {
      throw new Error("Persistence failed; refusing to return data URL with admin client.");
    }

    return json(200, {
      ok: true,
      generationId,
      mode: "nanobanana",
      output: {
        imageUrl: persisted.imageUrl,
        storageKey: persisted.storageKey,
        bucket: persisted.bucket,
        signedUrlExpiresInSec: persisted.signedUrlExpiresInSec,
        widthPx: persisted.widthPx ?? payloadForModel.baseImage.widthPx,
        heightPx: persisted.heightPx ?? payloadForModel.baseImage.heightPx,
      },
      tokenCost,
      tokenBalance: balanceAfterSpend ?? 0,
      debug: {
        payloadVersion: "v1",
        baseImage: {
          kind: payloadForModel.baseImage.kind,
          url: payloadForModel.baseImage.url,
          storageKey: payloadForModel.baseImage.storageKey,
        },
        counts,
        ops,
        notes,
        echo: {
          xVibodeEchoRaw,
          forceEchoRequested,
          forceEchoAllowed,
          forceEcho,
          echoOnly,
          willEcho,
          xVibodeForceModelRaw: xForceModelRaw,
          forceModel,
          hasNanoBananaUrl,
          hasNanoBananaKey,
          vibodeEchoOnlyRaw,
        },
      },
    });
  } catch (persistErr: unknown) {
    console.error("[vibode/generate] persist staged image failed:", persistErr);
    if (admin) {
      return json(500, { error: "Failed to persist staged image." });
    }

    notes.push("Persist staged image failed; returning raw model imageUrl.");
    return json(200, {
      ok: true,
      generationId,
      mode: "nanobanana",
      output: {
        imageUrl: modelImageUrl,
        storageKey: undefined,
        bucket: undefined,
        signedUrlExpiresInSec: undefined,
        widthPx: payloadForModel.baseImage.widthPx,
        heightPx: payloadForModel.baseImage.heightPx,
      },
      tokenCost,
      tokenBalance: balanceAfterSpend ?? 0,
      debug: {
        payloadVersion: "v1",
        baseImage: {
          kind: payloadForModel.baseImage.kind,
          url: payloadForModel.baseImage.url,
          storageKey: payloadForModel.baseImage.storageKey,
        },
        counts,
        ops,
        notes,
        echo: {
          xVibodeEchoRaw,
          forceEchoRequested,
          forceEchoAllowed,
          forceEcho,
          echoOnly,
          willEcho,
          xVibodeForceModelRaw: xForceModelRaw,
          forceModel,
          hasNanoBananaUrl,
          hasNanoBananaKey,
          vibodeEchoOnlyRaw,
        },
      },
    });
  }
}

function applyVibodeRouteModeOverride(freeze: unknown, routeMode?: VibodeRouteMode): unknown {
  if (!routeMode || !isRecord(freeze)) return freeze;

  const nextFreeze = structuredClone(freeze) as Record<string, unknown>;
  const vibodeIntent = isRecord(nextFreeze.vibodeIntent)
    ? ({ ...nextFreeze.vibodeIntent } as Record<string, unknown>)
    : ({} as Record<string, unknown>);

  if (routeMode === "compose") {
    vibodeIntent.mode = "place";
  } else if (routeMode === "remove") {
    vibodeIntent.mode = "remove";
    if (!Array.isArray(vibodeIntent.marks) && isRecord(vibodeIntent.remove)) {
      const removeIntent = vibodeIntent.remove as Record<string, unknown>;
      if (Array.isArray(removeIntent.marks)) {
        vibodeIntent.marks = removeIntent.marks;
      }
    }
  } else if (routeMode === "swap") {
    vibodeIntent.mode = "tools";
    if (!isRecord(vibodeIntent.swap) && Array.isArray(vibodeIntent.marks)) {
      const swapMarks = vibodeIntent.marks.filter(
        (mark): mark is Record<string, unknown> => isRecord(mark) && isRecord(mark.replacement)
      );
      if (swapMarks.length > 0) {
        vibodeIntent.swap = { marks: swapMarks };
      }
    }
  } else if (routeMode === "vibe") {
    vibodeIntent.mode = "vibe";
  }

  nextFreeze.vibodeIntent = vibodeIntent;
  return nextFreeze;
}

export async function handleVibodeGeneratePost(
  req: NextRequest,
  opts?: { routeMode?: VibodeRouteMode }
) {
  try {
    // Body shape: { freeze: FreezePayloadV1 | FreezePayloadV2 }.
    // In strict mode, only FreezePayloadV2 is accepted.
    const body = (await req.json()) as unknown;
    const freeze = applyVibodeRouteModeOverride(
      isRecord(body) ? body.freeze : undefined,
      opts?.routeMode
    );

    if (isRecord(freeze)) {
      console.log("[API] freeze received", {
        payloadVersion: freeze.payloadVersion,
        sceneHash: typeof freeze.sceneHash === "string" ? freeze.sceneHash : null,
        nodesLength: Array.isArray(freeze.nodes) ? freeze.nodes.length : null,
        firstNodeId: Array.isArray(freeze.nodes) ? (freeze.nodes[0] as any)?.nodeId : null,
      });
    }

    let payloadVersion: string | null;
    let payload: FreezePayloadV1;

    if (VIBODE_STRICT) {
      const strictValidation = validateFreezePayloadV2Strict(freeze);
      if (!strictValidation.ok) {
        if (strictValidation.legacyFields && strictValidation.legacyFields.length > 0) {
          console.warn("[vibode/generate] strict reject legacy payload", {
            reason: strictValidation.error,
            payloadVersion: isRecord(freeze) ? safeStr(freeze.payloadVersion) : null,
            legacyFields: strictValidation.legacyFields,
          });
        }
        return json(400, {
          error: strictValidation.error,
          details:
            strictValidation.legacyFields && strictValidation.legacyFields.length > 0
              ? { legacyFields: strictValidation.legacyFields }
              : undefined,
        });
      }
      payloadVersion = "v2";
      payload = translateFreezeV2ToV1(strictValidation.payload);
    } else {
      payloadVersion = isRecord(freeze) ? safeStr(freeze.payloadVersion) : null;
      payload =
        payloadVersion === "v2"
          ? translateFreezeV2ToV1(freeze as FreezePayloadV2)
          : (freeze as FreezePayloadV1);
    }

    return await handleGenerateRequest({
      req,
      freeze,
      payloadVersion,
      payload,
    });
  } catch (err: unknown) {
    console.error("[vibode/generate] unexpected error:", err);
    const message = err instanceof Error ? err.message : "Unexpected error in /api/vibode/generate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[vibode/generate] /api/vibode/generate is a legacy compat endpoint", {
      pathname: req.nextUrl.pathname,
      referer: req.headers.get("referer"),
      userAgent: req.headers.get("user-agent"),
    });
  }
  return handleVibodeGeneratePost(req);
}
