import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSceneRebuildPayload, type SceneRebuildPayload } from "@/lib/vibodeSceneState";
import { finalizeVibodeOutputAsset } from "@/lib/vibodeAssetFinalization";
import { callCompositorVibodeCompose, type VibodeComposePlacement } from "@/lib/callCompositorVibodeCompose";
import {
  createVibodeGenerationRun,
  getVibodeRoomById,
  updateVibodeRoomAsset,
} from "@/lib/vibodePersistence";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const VIBODE_ENABLE_SCENE_REBUILD =
  (process.env.VIBODE_ENABLE_SCENE_REBUILD ?? "false").trim().toLowerCase() === "true";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";

type AnySupabaseClient = SupabaseClient;

type SceneRebuildRequest = {
  roomId?: unknown;
  versionId?: unknown;
  modelVersion?: unknown;
  aspectRatio?: unknown;
  activate?: unknown;
  triggerMode?: unknown;
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
};

type SceneRebuildReferenceImageResult = {
  imageUrl: string;
  usedPlacementCount: number;
};

type SceneRebuildTriggerMode = "manual_test";

type RequestedVersionAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
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
      allowedTriggerModes: ["manual_test"],
    });
  }
  if (mode !== "manual_test") {
    throw new SceneRebuildError(`Unsupported triggerMode: '${mode}'.`, 400, {
      allowedTriggerModes: ["manual_test"],
    });
  }
  return mode;
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

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new SceneRebuildError("Failed to fetch base image for rebuild generation.", 502, {
      upstreamStatus: res.status,
    });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

async function fetchImageAsBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
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

  const roomImageBytes = await fetchImageAsBytes(args.baseImageUrl);
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
      const skuImageBytes = await fetchImageAsBytes(sourceUrl);
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

function buildSceneRebuildPrompt(payload: SceneRebuildPayload): string {
  const lines: string[] = [];
  lines.push("Rebuild this room image from the original base room photo.");
  lines.push(
    "Preserve room architecture, camera, lighting, colors, and background details as closely as possible."
  );
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
}): Promise<string> {
  const endpoint = process.env.NANOBANANA_PRO_URL;
  const apiKey = process.env.NANOBANANA_PRO_API_KEY;
  if (!endpoint || !apiKey) {
    throw new SceneRebuildError(
      "Scene rebuild model is not configured (missing NANOBANANA_PRO_URL or NANOBANANA_PRO_API_KEY).",
      500
    );
  }

  const imageBase64 = await fetchImageAsBase64(args.baseImageUrl);
  const body: StageRoomRequest = {
    imageBase64,
    styleId: null,
    enhancePhoto: true,
    modelVersion: args.modelVersion,
    aspectRatio: args.aspectRatio,
    isContinuation: false,
    prompt: args.prompt,
    instruction: args.prompt,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
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
    const roomId = safeStr(body.roomId);
    const versionId = safeStr(body.versionId);
    const modelVersion = safeStr(body.modelVersion) ?? VIBODE_DEFAULT_MODEL_VERSION;
    const aspectRatio = parseAspectRatio(body.aspectRatio);
    const activate = parseOptionalBoolean(body.activate) ?? false;
    const triggerMode = parseTriggerMode(body.triggerMode);

    if (!roomId) {
      return NextResponse.json({ error: "Missing required field: roomId." }, { status: 400 });
    }
    if (!versionId) {
      return NextResponse.json({ error: "Missing required field: versionId." }, { status: 400 });
    }
    if (activate) {
      return NextResponse.json(
        {
          error:
            "activate=true is not yet supported for scene-rebuild. Activation is blocked until placement snapshot inheritance is wired for rebuild output versions.",
        },
        { status: 409 }
      );
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
      roomId,
      userId,
      versionId,
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
    if (payload.placementCount === 0) {
      return NextResponse.json(
        { error: "No resolved placements found for requested version." },
        { status: 400 }
      );
    }

    const prompt = buildSceneRebuildPrompt(payload);
    const referenceImage = await buildSceneRebuildReferenceImage({
      baseImageUrl: payload.room.baseImageUrl,
      payload,
      modelVersion,
      aspectRatio,
    });
    const modelInputImageUrl = referenceImage.imageUrl;
    const referencePlacementCountUsed = referenceImage.usedPlacementCount;
    if (referencePlacementCountUsed <= 0) {
      throw new SceneRebuildError(
        "Scene rebuild reference composition must include at least one placement.",
        422
      );
    }

    const generatedImageUrl = await callSceneRebuildModel({
      baseImageUrl: modelInputImageUrl,
      prompt,
      modelVersion,
      aspectRatio,
    });

    const outputFinalization = await finalizeVibodeOutputAsset({
      logPrefix: "[vibode/scene-rebuild]",
      adminSupabase: getAdminSupabaseClient(),
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
      markAssetActive: activate,
      updateRoomCurrentStage: activate ? (room.current_stage ?? 0) : null,
      updateRoomSortKey: activate ? new Date().toISOString() : null,
    });

    if (outputFinalization.assetFinalizationError || !outputFinalization.outputAssetId) {
      throw new SceneRebuildError("Rebuild image generated but failed to persist room asset.", 500, {
        finalizationError:
          outputFinalization.assetFinalizationError instanceof Error
            ? outputFinalization.assetFinalizationError.message
            : outputFinalization.assetFinalizationError ?? null,
      });
    }

    const rebuildMetadata = {
      generation_mode: "scene_rebuild",
      trigger_mode: triggerMode,
      source_version_id: versionId,
      base_version_id: payload.room.baseVersionId,
      placement_count: payload.placementCount,
      reference_image_mode: referencePlacementCountUsed > 0 ? "composite" : "base_only",
      reference_placement_count: referencePlacementCountUsed,
      fallback_image_url_used: payload.room.fallbackImageUrlUsed,
    };

    await updateVibodeRoomAsset(supabase, outputFinalization.outputAssetId, {
      metadata: rebuildMetadata,
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
        base_image_url: payload.room.baseImageUrl,
        model_input_image_url: modelInputImageUrl,
        base_version_id: payload.room.baseVersionId,
        lineage_version_ids: payload.lineageVersionIds,
        placement_count: payload.placementCount,
        reference_placement_count: referencePlacementCountUsed,
        fallback_image_url_used: payload.room.fallbackImageUrlUsed,
        prompt_preview: prompt.slice(0, 1000),
      },
      response_payload: {
        imageUrl: outputFinalization.imageUrl ?? generatedImageUrl,
        storageBucket: outputFinalization.storageBucket,
        storagePath: outputFinalization.storagePath,
        generation_mode: "scene_rebuild",
      },
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      generationMode: "scene_rebuild",
      triggerMode,
      roomId: room.id,
      sourceVersionId: versionId,
      outputVersionId: outputFinalization.outputAssetId,
      generationRunId: generationRun.id,
      activated: activate,
      placementCount: payload.placementCount,
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

    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("missing base image url for rebuild payload")) {
      return NextResponse.json({ error: "Missing base image for rebuild." }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected scene rebuild error.", message }, { status: 500 });
  }
}
