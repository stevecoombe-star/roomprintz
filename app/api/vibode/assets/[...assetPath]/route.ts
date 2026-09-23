import { NextResponse } from "next/server";

import {
  parseGlbPlaceholderAssetPath,
  partnerAssetGlbPlaceholderResponse,
} from "@/lib/vibode-stage/partner-asset-register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ assetPath: string[] }> },
) {
  const { assetPath } = await context.params;
  const parsed = parseGlbPlaceholderAssetPath(assetPath ?? []);
  if (!parsed.ok) {
    return json({ ok: false, error: "Not found.", errorCode: "INTAKE_NOT_FOUND" }, 404);
  }
  const result = partnerAssetGlbPlaceholderResponse();
  return json(result.body, result.status);
}
