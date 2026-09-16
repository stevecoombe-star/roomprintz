import { NextResponse } from "next/server";

import { partnerPortalPreviewResponse } from "@/lib/vibode-stage/partner-catalog-preview.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(req: Request) {
  let body: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON." }, 400);
    }
  }
  const result = await partnerPortalPreviewResponse(body);
  return json(result.body, result.status);
}
