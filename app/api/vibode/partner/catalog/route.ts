import { NextResponse } from "next/server";

import { partnerPortalCatalogResponse } from "@/lib/vibode-stage/partner-catalog-preview.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const result = await partnerPortalCatalogResponse();
  return json(result.body, result.status);
}
