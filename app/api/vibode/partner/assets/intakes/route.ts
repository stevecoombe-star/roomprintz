import { NextResponse } from "next/server";

import {
  partnerAssetIntakeCreateResponse,
  partnerAssetIntakeListResponse,
} from "@/lib/vibode-stage/partner-asset-intake.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const result = await partnerAssetIntakeListResponse();
  return json(result.body, result.status);
}

export async function POST(req: Request) {
  let body: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON.", errorCode: "INVALID_REQUEST" }, 400);
    }
  } else {
    return json({ ok: false, error: "Invalid request.", errorCode: "INVALID_REQUEST" }, 400);
  }
  const result = await partnerAssetIntakeCreateResponse(body);
  return json(result.body, result.status);
}
