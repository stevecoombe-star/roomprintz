import { NextResponse } from "next/server";

import { partnerAssetRegisterResponse } from "@/lib/vibode-stage/partner-asset-register.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  const { intakeId } = await context.params;
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
  const result = await partnerAssetRegisterResponse(intakeId, body);
  return json(result.body, result.status);
}
