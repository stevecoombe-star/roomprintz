import { NextResponse } from "next/server";

import {
  authorizePartnerModelThumbnail,
  readPartnerModelGlb,
} from "@/lib/vibode-model-thumbnail/persist.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON.", errorCode: "INVALID_REQUEST" }, 400);
  }
  const assetId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { assetId?: unknown }).assetId
    : null;
  if (typeof assetId !== "string") {
    return json({ ok: false, error: "Model not found.", errorCode: "ASSET_NOT_FOUND" }, 404);
  }
  const access = await authorizePartnerModelThumbnail(assetId);
  if (!access.ok) {
    return json({ ok: false, error: access.error, errorCode: access.errorCode }, access.status);
  }
  const bytes = await readPartnerModelGlb(access.supabase, access.assetId);
  if (!bytes) {
    return json({ ok: false, error: "Model file could not be loaded.", errorCode: "GLB_UNAVAILABLE" }, 404);
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
