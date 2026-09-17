import { NextResponse } from "next/server";

import { partnerPortalDraftGetOrCreateResponse } from "@/lib/vibode-stage/partner-portal-drafts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST() {
  const result = await partnerPortalDraftGetOrCreateResponse();
  return json(result.body, result.status);
}
