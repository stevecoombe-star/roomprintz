import { NextResponse } from "next/server";

import { partnerRegisteredAssetListResponse } from "@/lib/vibode-stage/partner-asset-register.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const result = await partnerRegisteredAssetListResponse();
  return json(result.body, result.status);
}
