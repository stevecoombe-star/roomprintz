import { NextResponse } from "next/server";

import { lookupDurableThumbnailRenderClaim } from "@/lib/vibode-thumbnail-jobs/jobs.server";
import { thumbnailRenderRouteEnabled } from "@/lib/vibode-thumbnail-render/access.server";
import { readVibodeThumbnailRenderAccess } from "@/lib/vibode-thumbnail-render/payload.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!thumbnailRenderRouteEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const token = request.headers.get("x-vibode-thumbnail-access")?.trim() ?? "";
  if (!token) {
    return json({
      ok: false,
      code: "render_access_denied",
      message: "Render access denied.",
      retryable: false,
    }, 401);
  }
  const read = await readVibodeThumbnailRenderAccess(token, undefined, {
    lookupClaim: lookupDurableThumbnailRenderClaim,
  });
  if (!read.ok) {
    return json(read, statusForCode(read.code));
  }
  return json(read.payload, 200);
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
