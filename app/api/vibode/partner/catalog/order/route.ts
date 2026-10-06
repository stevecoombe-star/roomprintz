import { NextResponse } from "next/server";

import { partnerPortalCatalogOrderResponse } from "@/lib/vibode-stage/partner-catalog-order.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    body = null;
  }
  const result = await partnerPortalCatalogOrderResponse(body);
  return json(result.body, result.status);
}
