import { NextResponse } from "next/server";

import { partnerAssetActivateResponse } from "@/lib/vibode-stage/partner-runtime-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function activateAssetId(assetPath: string[] | undefined): string | null {
  if (!assetPath || assetPath.length < 2) return null;
  if (assetPath[assetPath.length - 1] !== "activate") return null;
  const assetId = assetPath.slice(0, -1).join("/");
  return assetId.length > 0 ? assetId : null;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ assetPath: string[] }> },
) {
  const { assetPath } = await context.params;
  const assetId = activateAssetId(assetPath);
  if (!assetId) {
    return json({ ok: false, error: "Not found.", errorCode: "ASSET_NOT_FOUND" }, 404);
  }
  let body: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await req.text();
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return json({ ok: false, error: "Invalid JSON.", errorCode: "INVALID_REQUEST" }, 400);
      }
    }
  }
  const result = await partnerAssetActivateResponse(assetId, body);
  return json(result.body, result.status);
}
