import { NextResponse } from "next/server";

import { thumbnailRenderRouteEnabled } from "@/lib/vibode-thumbnail-render/access.server";
import {
  mintVibodeThumbnailRenderAccess,
} from "@/lib/vibode-thumbnail-render/payload.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local mint for the thumbnail proof harness.
 * Production workers claim a durable job instead of posting room ids.
 */
export async function POST(request: Request) {
  if (!thumbnailRenderRouteEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const roomId = readId(body, "roomId");
  const versionId = readId(body, "versionId");
  if (!roomId || !versionId) {
    return json({
      ok: false,
      code: "render_access_denied",
      message: "Render access denied.",
      retryable: false,
    }, 401);
  }
  const minted = await mintVibodeThumbnailRenderAccess({ roomId, versionId });
  if (!minted.ok) {
    return json(minted, statusForCode(minted.code));
  }
  return json({
    ok: true,
    accessToken: minted.accessToken,
    jobId: minted.jobId,
    expiresAt: minted.expiresAt,
    frame: minted.frame,
    objectCount: minted.objectCount,
  }, 200);
}

function readId(body: unknown, key: "roomId" | "versionId"): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusForCode(code: string): number {
  if (code === "scene_missing") return 404;
  if (code === "scene_empty" || code === "generation_mismatch") return 409;
  if (code === "signed_url_failed") return 503;
  if (code === "render_access_denied") return 401;
  return 422;
}

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
