import { NextResponse } from "next/server";

import { partnerPortalDraftPreviewResponse } from "@/lib/vibode-stage/partner-portal-drafts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;
  let body: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON." }, 400);
    }
  }
  const result = await partnerPortalDraftPreviewResponse(draftId, body);
  return json(result.body, result.status);
}
