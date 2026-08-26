import { NextResponse } from "next/server";

import {
  AFC_V2_REFERENCE_DEPTH_M,
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parse(value: unknown): AfcV2AnalyzeInput | null {
  if (!isRecord(value) || !isRecord(value.sourceImageIdentity) || !isRecord(value.frame)) {
    return null;
  }
  const identity = value.sourceImageIdentity;
  const frame = value.frame;
  if (
    typeof value.attemptId !== "string" ||
    !/^[A-Za-z0-9._-]{1,180}$/.test(value.attemptId) ||
    typeof value.sourceImageUrl !== "string" ||
    value.sourceImageUrl.length === 0 ||
    value.sourceImageUrl.length > 4096 ||
    typeof value.loadGeneration !== "number" ||
    !Number.isSafeInteger(value.loadGeneration) ||
    value.loadGeneration < 0 ||
    typeof identity.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(identity.sha256) ||
    typeof identity.decodedWidth !== "number" ||
    !Number.isSafeInteger(identity.decodedWidth) ||
    identity.decodedWidth <= 0 ||
    typeof identity.decodedHeight !== "number" ||
    !Number.isSafeInteger(identity.decodedHeight) ||
    identity.decodedHeight <= 0 ||
    identity.orientation !== 1 ||
    typeof frame.width !== "number" ||
    !Number.isFinite(frame.width) ||
    frame.width <= 0 ||
    typeof frame.height !== "number" ||
    !Number.isFinite(frame.height) ||
    frame.height <= 0 ||
    typeof value.referenceDepthM !== "number" ||
    !Number.isFinite(value.referenceDepthM) ||
    value.referenceDepthM <= 0
  ) {
    return null;
  }
  return {
    attemptId: value.attemptId,
    sourceImageUrl: value.sourceImageUrl,
    sourceImageIdentity: {
      sha256: identity.sha256,
      decodedWidth: identity.decodedWidth,
      decodedHeight: identity.decodedHeight,
      orientation: 1,
    },
    loadGeneration: value.loadGeneration,
    frame: {
      width: frame.width,
      height: frame.height,
    },
    referenceDepthM: value.referenceDepthM || AFC_V2_REFERENCE_DEPTH_M,
  };
}

export async function POST(request: Request) {
  if (!(await getAuthenticatedAdminUser())) {
    return json({ error: "Admin access required." }, 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body was not valid JSON." }, 400);
  }
  const input = parse(body);
  if (!input) return json({ error: "AFC V2 analysis request was invalid." }, 400);
  return json(await executeAfcV2Analysis(input), 200);
}
