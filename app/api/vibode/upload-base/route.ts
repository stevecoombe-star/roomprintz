// app/api/vibode/upload-base/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignVibodeRoomBaseImageIfMissing,
  createVibodeRoom,
  createVibodeRoomAsset,
  updateVibodeRoomAsset,
  updateVibodeRoom,
} from "@/lib/vibodePersistence";
import { createVibodeAssetThumbnail } from "@/lib/vibodeAssetThumbnails";
import { stampVibodeVersionKindMetadata } from "@/lib/vibode/version-kind";
import { convertHeicBufferToJpeg, HeicConversionError } from "@/lib/heicServerConversion";
import {
  getFileExtensionFromName,
  isHeicLikeFile,
  isLivePhotoMovCompanion,
  isSupportedStillImageFile,
} from "@/lib/uploadImageFileTypes";

export const runtime = "nodejs";

function mustEnv(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var (tried: ${names.join(", ")})`);
}

const SUPABASE_URL = mustEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = mustEnv("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");

const BUCKET = "vibode-base-images";
type AnySupabaseClient = SupabaseClient;

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
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

function getOptionalFormText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const url = typeof args.candidateUrl === "string" ? args.candidateUrl.trim() : "";
  if (!url) return null;
  const bucket = typeof args.storageBucket === "string" ? args.storageBucket.trim() : "";
  const isPrivateBucket = bucket === "vibode-base-images" || bucket === BUCKET;
  if (isPrivateBucket && isLikelyExpiringSignedUrl(url)) return null;
  return url;
}

export async function POST(req: NextRequest) {
  try {
    const { supabase: userSupabase, token } = getUserSupabaseClient(req);
    if (!token || !userSupabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const authenticatedUserId = userData.user.id;

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const fileName =
      typeof (file as File).name === "string" && (file as File).name.trim().length > 0
        ? (file as File).name.trim()
        : "upload";
    const fileType = typeof file.type === "string" ? file.type : "";
    const detectedExtension = getFileExtensionFromName(fileName);
    const heicLike = isHeicLikeFile({ name: fileName, type: fileType });

    if (isLivePhotoMovCompanion({ name: fileName, type: fileType })) {
      return NextResponse.json(
        {
          error: "Live Photo video detected. Vibode needs the still image, not the video clip.",
        },
        { status: 400 }
      );
    }

    if (!isSupportedStillImageFile({ name: fileName, type: fileType })) {
      return NextResponse.json(
        {
          error:
            "Unsupported image format. Please upload JPG, PNG, WebP, or HEIC/HEIF still images.",
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    let bytes = Buffer.from(arrayBuffer);
    let mime = fileType.toLowerCase();
    let ext = getFileExtensionFromName(fileName) ?? "jpg";

    if (heicLike) {
      console.info("[upload-base][heic] normalization-start", {
        route: "/api/vibode/upload-base",
        fileName,
        fileType,
        fileSize: file.size,
        detectedExtension,
      });

      try {
        const converted = await convertHeicBufferToJpeg({ inputBuffer: bytes });
        bytes = Buffer.from(converted.outputBuffer);
        mime = "image/jpeg";
        ext = "jpg";
      } catch (error) {
        const conversionCode = error instanceof HeicConversionError ? error.code : "UNKNOWN";
        const conversionCauseMessage =
          error instanceof HeicConversionError ? error.causeMessage : error instanceof Error ? error.message : String(error);
        const conversionCauseName = error instanceof HeicConversionError ? error.causeName : null;
        const conversionCauseCode = error instanceof HeicConversionError ? error.causeCode : null;
        console.error("[upload-base][heic] conversion-failed", {
          route: "/api/vibode/upload-base",
          fileName,
          fileType,
          fileSize: file.size,
          detectedExtension,
          conversionCode,
          conversionCauseMessage,
          conversionCauseName,
          conversionCauseCode,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCode:
            error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : null,
        });
        return NextResponse.json(
          {
            error:
              "This iPhone photo format could not be converted. Please try exporting it as JPEG and upload again.",
          },
          { status: 422 }
        );
      }
    } else if (mime === "image/png" || ext === "png") {
      mime = "image/png";
      ext = "png";
    } else if (mime === "image/webp" || ext === "webp") {
      mime = "image/webp";
      ext = "webp";
    } else {
      mime = "image/jpeg";
      ext = "jpg";
    }

    const sceneId = formData.get("sceneId") || "unknown";
    const ts = Date.now();

    const storageKey = `users/${authenticatedUserId}/scene_${sceneId}/base_${ts}.${ext}`;

    const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, bytes, {
        contentType: mime,
        upsert: false,
      });

    if (uploadErr) {
      console.error("[upload-base] upload error:", uploadErr);
      return NextResponse.json(
        { error: "Upload failed", details: uploadErr },
        { status: 500 }
      );
    }

    // Create a signed URL (24h)
    const { data: signed, error: signErr } =
      await supabase.storage.from(BUCKET).createSignedUrl(storageKey, 60 * 60 * 24);

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: "Failed to create signed URL" },
        { status: 500 }
      );
    }

    // Extract image dimensions (Node-friendly)
    let widthPx: number | undefined;
    let heightPx: number | undefined;

    try {
      const sharp = await import("sharp");
      const meta = await sharp.default(bytes).metadata();
      widthPx = meta.width;
      heightPx = meta.height;
    } catch {
      // Non-fatal — editor already has viewport info
    }

    let vibodeRoomId: string | undefined;
    try {
      const aspectRatio = getOptionalFormText(formData.get("aspectRatio"));
      const selectedModel = getOptionalFormText(formData.get("selectedModel"));
      const room = await createVibodeRoom(userSupabase, {
        user_id: authenticatedUserId,
        title: "Untitled Room",
        source_type: "upload",
        aspect_ratio: aspectRatio,
        selected_model: selectedModel,
        status: "draft",
      });
      const baseVersionMetadata = stampVibodeVersionKindMetadata(null, "set");

      const baseAsset = await createVibodeRoomAsset(userSupabase, {
        room_id: room.id,
        user_id: authenticatedUserId,
        asset_type: "base",
        stage_number: 0,
        storage_bucket: BUCKET,
        storage_path: storageKey,
        image_url: getDurableImageUrl({ candidateUrl: signed.signedUrl, storageBucket: BUCKET }) ?? "",
        width: widthPx ?? null,
        height: heightPx ?? null,
        is_active: true,
        ...(baseVersionMetadata ? { metadata: baseVersionMetadata } : {}),
      });

      await assignVibodeRoomBaseImageIfMissing(userSupabase, {
        roomId: room.id,
        userId: authenticatedUserId,
        baseImageUrl: getDurableImageUrl({ candidateUrl: signed.signedUrl, storageBucket: BUCKET }) ?? signed.signedUrl,
        baseStoragePath: storageKey,
        baseVersionId: baseAsset.id,
      });

      try {
        const thumbnailLocation = await createVibodeAssetThumbnail({
          adminSupabase: supabase,
          roomId: room.id,
          assetId: baseAsset.id,
          sourceStorageBucket: BUCKET,
          sourceStoragePath: storageKey,
          sourceImageUrl: signed.signedUrl,
        });
        if (thumbnailLocation) {
          await updateVibodeRoomAsset(userSupabase, baseAsset.id, thumbnailLocation);
        }
      } catch (thumbnailErr) {
        console.warn("[upload-base] thumbnail generation failed (non-blocking):", thumbnailErr);
      }

      await updateVibodeRoom(userSupabase, room.id, {
        base_asset_id: baseAsset.id,
        active_asset_id: baseAsset.id,
        cover_image_url: getDurableImageUrl({
          candidateUrl: signed.signedUrl,
          storageBucket: BUCKET,
        }),
        sort_key: new Date().toISOString(),
      });
      vibodeRoomId = room.id;
    } catch (persistErr) {
      console.error("[upload-base] vibode persistence failed:", persistErr);
      const { error: cleanupErr } = await supabase.storage.from(BUCKET).remove([storageKey]);
      if (cleanupErr) {
        console.error("[upload-base] failed to cleanup orphaned upload:", cleanupErr);
      }
      return NextResponse.json(
        { error: "Failed to persist uploaded asset" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      storageKey,
      signedUrl: signed.signedUrl,
      widthPx,
      heightPx,
      vibodeRoomId,
    });
  } catch (err) {
    console.error("[upload-base] unexpected error:", err);
    return NextResponse.json(
      { error: "Unexpected upload error" },
      { status: 500 }
    );
  }
}
