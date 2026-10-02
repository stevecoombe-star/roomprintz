import { NextResponse } from "next/server";

import {
  authorizePartnerModelThumbnail,
  savePartnerModelThumbnail,
} from "@/lib/vibode-model-thumbnail/persist.server";
import {
  VIBODE_MODEL_THUMBNAIL_ASSET_HEADER,
  VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES,
} from "@/lib/vibode-model-thumbnail/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function readLimitedImage(request: Request): Promise<Uint8Array | null> {
  const header = request.headers.get("content-length");
  if (header != null) {
    const declared = Number(header);
    if (!Number.isFinite(declared) || declared <= 0 || declared > VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES) {
      return null;
    }
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const image = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return image;
}

export async function POST(request: Request) {
  const assetId = request.headers.get(VIBODE_MODEL_THUMBNAIL_ASSET_HEADER)?.trim() ?? "";
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader != null) {
    const declared = Number(declaredHeader);
    if (!Number.isFinite(declared) || declared <= 0 || declared > VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES) {
      return json({ ok: false, error: "Thumbnail image is too large.", errorCode: "IMAGE_TOO_LARGE" }, 413);
    }
  }
  const access = await authorizePartnerModelThumbnail(assetId);
  if (!access.ok) {
    return json({ ok: false, error: access.error, errorCode: access.errorCode }, access.status);
  }
  const image = await readLimitedImage(request);
  if (!image) {
    return json({ ok: false, error: "Thumbnail image is too large.", errorCode: "IMAGE_TOO_LARGE" }, 413);
  }
  const saved = await savePartnerModelThumbnail(access.supabase, access.assetId, image);
  if (!saved.ok) {
    return json({ ok: false, error: saved.error, errorCode: saved.errorCode }, saved.status);
  }
  return json({ ok: true, thumbnailUrl: saved.thumbnailUrl }, 200);
}
