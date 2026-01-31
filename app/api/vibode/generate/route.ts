// app/api/vibode/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

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

type BaseImageKind = "publicUrl" | "signedUrl" | "storageKey";

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

      zIndex: number;
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

// Kickstart style (temporary): force staging style so legacy stage-room always does work.
const VIBODE_NB_KICKSTART_STYLE_ID = (
  process.env.VIBODE_NB_KICKSTART_STYLE_ID || "modern-luxury"
).trim();

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
  if (!bi || (bi.kind !== "publicUrl" && bi.kind !== "signedUrl" && bi.kind !== "storageKey")) {
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

/**
 * Legacy /stage-room contract:
 * - expects top-level { imageBase64, styleId, ... }
 * - returns { imageUrl }
 */
async function callNanoBananaPro(args: {
  payload: FreezePayloadV1;
  baseImageUrlForModel: string;
  notes: string[];
}) {
  const url = process.env.NANOBANANA_PRO_URL;
  const apiKey = process.env.NANOBANANA_PRO_API_KEY;

  if (!url || !apiKey) {
    throw new Error(
      "Nano Banana Pro is not configured (missing NANOBANANA_PRO_URL or NANOBANANA_PRO_API_KEY)."
    );
  }

  const { base64: imageBase64 } = await fetchImageAsBase64(args.baseImageUrlForModel);

  const styleId = VIBODE_NB_KICKSTART_STYLE_ID || "modern-luxury";
  const modelVersion = safeStr((args.payload as any)?.modelVersion) ?? "gemini-3";
  const aspectRatio = pickLegacyAspectRatioFromFreeze(args.payload);

  const body: LegacyStageRoomRequest = {
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

  args.notes.push(`Kickstart styleId='${styleId}' applied for legacy /stage-room.`);

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

export async function POST(req: NextRequest) {
  try {
    const xVibodeEchoRaw = req.headers.get("x-vibode-echo");
    const xForceModelRaw = req.headers.get("x-vibode-force-model");

    const forceEchoRequested = headerTruth(req, "x-vibode-echo");
    const forceModel = headerTruth(req, "x-vibode-force-model");

    const vibodeEchoOnlyRaw = process.env.VIBODE_ECHO_ONLY ?? null;
    const echoOnly = (process.env.VIBODE_ECHO_ONLY ?? "false").toLowerCase() === "true";

    // Body shape: { freeze: FreezePayloadV1 }
    const body = (await req.json()) as { freeze?: FreezePayloadV1 };
    const payload = body?.freeze as FreezePayloadV1;

    // Determine if echo is even allowed (only for blob/local base image URLs)
    const baseUrl = payload?.baseImage?.url ?? "";
    const forceEchoAllowed =
      payload?.baseImage?.kind !== "storageKey" &&
      typeof baseUrl === "string" &&
      baseUrl.length > 0 &&
      isProbablyBlobOrLocalUrl(baseUrl);

    // Only respect x-vibode-echo if it's actually necessary
    const forceEcho = forceEchoRequested && forceEchoAllowed;

    // Determine action type and ops (ops must be computed BEFORE validate options)
    const requestedActionType =
      typeof (payload as any)?.requestedAction?.type === "string"
        ? ((payload as any).requestedAction.type as string)
        : null;

    const isGenerateAction = requestedActionType ? requestedActionType === "generate" : true;

    const requestedOps = normalizeRequestedOps((payload as any)?.requestedAction?.ops ?? null);

    // ✅ Correct: non-generate + empty ops => echo-safe no-op
    const isNonGenerateNoop = !isGenerateAction && opsIsEmpty(requestedOps);

    // If you're trying to debug, x-vibode-force-model=true can override echo.
    const willEcho = !forceModel && (forceEcho || echoOnly || isNonGenerateNoop);

    const v = validateFreezePayloadV1(payload, { allowBlobOrLocalBaseUrl: willEcho });
    if (!v.ok) {
      return json(400, { error: v.error, details: v.details });
    }

    const generationId = payload.generationId.trim();
    const notes: string[] = [];

    const hasNanoBananaUrl = Boolean(process.env.NANOBANANA_PRO_URL);
    const hasNanoBananaKey = Boolean(process.env.NANOBANANA_PRO_API_KEY);

    const payloadForModel = ensureNonEmptyRequestedActionForModel(payload, notes);

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
      kickstartStyleId: VIBODE_NB_KICKSTART_STYLE_ID,
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
      const result = await callNanoBananaPro({
        payload: payloadForModel,
        baseImageUrlForModel,
        notes,
      });
      modelImageUrl = result.imageUrl;
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
  } catch (err: unknown) {
    console.error("[vibode/generate] unexpected error:", err);
    const message = err instanceof Error ? err.message : "Unexpected error in /api/vibode/generate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
