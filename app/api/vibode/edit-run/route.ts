import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVibodeRoomById } from "@/lib/vibodePersistence";
import {
  finalizeVibodeOutputAsset,
  resolveVibodeOutputDimensions,
  resolveVibodeOutputStorage,
} from "@/lib/vibodeAssetFinalization";

export const runtime = "nodejs";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type EditRunCompositorResult = {
  imageUrl?: string;
} & Record<string, unknown>;

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseOptionalStageNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 0 || n > 32767) return null;
  return n;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isUuidLike(value: string | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return { supabase: null, token: null };

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const bodyRaw = (await req.json()) as unknown;
    const body =
      bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const vibodeRoomId = safeStr(body.vibodeRoomId);
    const requestedStageNumber =
      parseOptionalStageNumber(body.stageNumber) ?? parseOptionalStageNumber(body.stage);
    const modelVersion =
      typeof body.modelVersion === "string" && body.modelVersion.trim().length > 0
        ? body.modelVersion
        : VIBODE_DEFAULT_MODEL_VERSION;

    const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
    if (!endpointBase) {
      throw new Error(
        "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
      );
    }

    const endpointBaseNormalized = endpointBase
      .replace(/\/stage-room\/?$/, "")
      .replace(/\/api\/vibode\/stage-run\/?$/, "")
      .replace(/\/vibode\/stage-run\/?$/, "")
      .replace(/\/vibode\/compose\/?$/, "")
      .replace(/\/vibode\/remove\/?$/, "")
      .replace(/\/vibode\/swap\/?$/, "")
      .replace(/\/vibode\/rotate\/?$/, "")
      .replace(/\/vibode\/full_vibe\/?$/, "")
      .replace(/\/$/, "");
    const endpoint = `${endpointBaseNormalized}/api/vibode/edit-run`;
    const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    const payloadForCompositor = { ...body };
    delete payloadForCompositor.vibodeRoomId;
    delete payloadForCompositor.stageNumber;

    const action =
      typeof payloadForCompositor.action === "string"
        ? payloadForCompositor.action.trim().toLowerCase()
        : null;
    if (action === "remove") {
      const targetRecord = isRecord(payloadForCompositor.target)
        ? ({ ...payloadForCompositor.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadForCompositor.params)
        ? ({ ...payloadForCompositor.params } as Record<string, unknown>)
        : {};
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
        return Response.json(
          { message: "remove requires finite target.xNorm and target.yNorm." },
          { status: 400 }
        );
      }

      const xNorm = clampUnit(xNormRaw);
      const yNorm = clampUnit(yNormRaw);

      payloadForCompositor.target = {
        xNorm,
        yNorm,
        x: xNorm,
        y: yNorm,
      };
      payloadForCompositor.params = {
        ...paramsRecord,
        xNorm,
        yNorm,
        x: xNorm,
        y: yNorm,
      };
    } else if (action === "rotate") {
      const targetRecord = isRecord(payloadForCompositor.target)
        ? ({ ...payloadForCompositor.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadForCompositor.params)
        ? ({ ...payloadForCompositor.params } as Record<string, unknown>)
        : {};
      const xNormRaw =
        parseFiniteNumber(payloadForCompositor.xNorm) ??
        parseFiniteNumber(targetRecord.xNorm) ??
        parseFiniteNumber(targetRecord.x) ??
        parseFiniteNumber(paramsRecord.xNorm) ??
        parseFiniteNumber(paramsRecord.x);
      const yNormRaw =
        parseFiniteNumber(payloadForCompositor.yNorm) ??
        parseFiniteNumber(targetRecord.yNorm) ??
        parseFiniteNumber(targetRecord.y) ??
        parseFiniteNumber(paramsRecord.yNorm) ??
        parseFiniteNumber(paramsRecord.y);
      const rotationDegreesRaw =
        parseFiniteNumber(payloadForCompositor.rotationDegrees) ??
        parseFiniteNumber(targetRecord.rotationDegrees) ??
        parseFiniteNumber(paramsRecord.rotationDegrees) ??
        parseFiniteNumber(paramsRecord.rotationDeg);
      if (xNormRaw === null || yNormRaw === null || rotationDegreesRaw === null) {
        return Response.json(
          { message: "rotate requires finite xNorm, yNorm, and rotationDegrees." },
          { status: 400 }
        );
      }

      payloadForCompositor.xNorm = clampUnit(xNormRaw);
      payloadForCompositor.yNorm = clampUnit(yNormRaw);
      payloadForCompositor.rotationDegrees = rotationDegreesRaw;
      delete payloadForCompositor.target;
      delete payloadForCompositor.params;
      delete payloadForCompositor.placementId;
    } else if (action === "add" || action === "swap") {
      const targetRecord = isRecord(payloadForCompositor.target)
        ? ({ ...payloadForCompositor.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadForCompositor.params)
        ? ({ ...payloadForCompositor.params } as Record<string, unknown>)
        : {};
      const x = parseFiniteNumber(paramsRecord.x);
      const y = parseFiniteNumber(paramsRecord.y);

      if (x === null || y === null) {
        return Response.json(
          { message: `${action} requires finite params.x and params.y.` },
          { status: 400 }
        );
      }

      const targetSkuId =
        safeStr(targetRecord.skuId) ?? (action === "swap" ? safeStr(paramsRecord.newSkuId) : null);
      if (!targetSkuId) {
        return Response.json({ message: `${action} requires target.skuId.` }, { status: 400 });
      }

      targetRecord.skuId = targetSkuId;
      if (Object.prototype.hasOwnProperty.call(targetRecord, "placementId")) {
        delete targetRecord.placementId;
      }
      paramsRecord.x = x;
      paramsRecord.y = y;
      if (action === "swap") {
        paramsRecord.newSkuId = targetSkuId;
      }
      payloadForCompositor.target = targetRecord;
      payloadForCompositor.params = paramsRecord;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const upstreamRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payloadForCompositor,
        modelVersion,
      }),
    });

    const upstreamStatus = upstreamRes.status;
    const upstreamResult = (await upstreamRes.json().catch(() => ({}))) as unknown;
    const responseRecord = isRecord(upstreamResult)
      ? ({ ...upstreamResult } as EditRunCompositorResult)
      : ({} as EditRunCompositorResult);
    if (!upstreamRes.ok) {
      return Response.json(responseRecord, { status: upstreamStatus });
    }
    const responseImageUrl = safeStr(responseRecord.imageUrl);
    if (!responseImageUrl) {
      console.warn("[vibode/edit-run] persistence skipped: successful response missing imageUrl");
      return Response.json(responseRecord, { status: upstreamStatus });
    }

    let persistenceSupabase: AnySupabaseClient | null = null;
    let persistenceRoomId: string | null = null;
    let persistenceUserId: string | null = null;
    let roomStageForPersistence: number | null = null;

    if (!vibodeRoomId) {
      console.info("[vibode/edit-run] persistence skipped: missing vibodeRoomId");
    } else if (!isUuidLike(vibodeRoomId)) {
      console.warn("[vibode/edit-run] persistence skipped: invalid vibodeRoomId");
    } else {
      const { supabase, token } = getUserSupabaseClient(req);
      if (!token || !supabase) {
        console.warn("[vibode/edit-run] persistence skipped: missing bearer token");
      } else {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData?.user) {
          console.warn("[vibode/edit-run] persistence skipped: unauthorized user");
        } else {
          const room = await getVibodeRoomById(supabase, vibodeRoomId);
          if (!room) {
            console.warn("[vibode/edit-run] persistence skipped: room not found", { vibodeRoomId });
          } else if (room.user_id !== userData.user.id) {
            console.warn("[vibode/edit-run] persistence skipped: room does not belong to user", {
              vibodeRoomId,
            });
          } else {
            persistenceSupabase = supabase;
            persistenceRoomId = room.id;
            persistenceUserId = userData.user.id;
            roomStageForPersistence = room.current_stage ?? null;
          }
        }
      }
    }

    const hintedStorage = resolveVibodeOutputStorage(responseRecord);
    const hintedDimensions = resolveVibodeOutputDimensions(responseRecord);
    const finalization = await finalizeVibodeOutputAsset({
      logPrefix: "[vibode/edit-run]",
      adminSupabase: getAdminSupabaseClient(),
      persistenceSupabase,
      roomId: persistenceRoomId ?? vibodeRoomId,
      userId: persistenceUserId,
      assetType: "stage_output",
      stageNumber: requestedStageNumber ?? roomStageForPersistence,
      modelVersion,
      responseImageUrl,
      responseStorageBucket: hintedStorage.storageBucket,
      responseStoragePath: hintedStorage.storagePath,
      responseWidth: hintedDimensions.width,
      responseHeight: hintedDimensions.height,
      sourceImageUrlForThumbnail: responseImageUrl,
      markAssetActive: Boolean(persistenceSupabase && persistenceRoomId && persistenceUserId),
      updateRoomCurrentStage: requestedStageNumber ?? roomStageForPersistence,
      updateRoomSortKey: new Date().toISOString(),
    });
    if (finalization.assetFinalizationError) {
      console.error("[vibode/edit-run] persistence failed (non-blocking):", finalization.assetFinalizationError);
    }

    const responsePayload = {
      ...responseRecord,
      ...(finalization.imageUrl ? { imageUrl: finalization.imageUrl } : {}),
      ...(finalization.storageBucket ? { storageBucket: finalization.storageBucket } : {}),
      ...(finalization.storagePath ? { storagePath: finalization.storagePath } : {}),
    };

    return Response.json(responsePayload, { status: upstreamStatus });
  } catch (err: any) {
    const message = String(err?.message || err);
    const status = message.includes(" 400 ")
      ? 400
      : message.includes(" 401 ")
      ? 401
      : message.includes(" 403 ")
      ? 403
      : 500;
    return Response.json({ error: message }, { status });
  }
}
