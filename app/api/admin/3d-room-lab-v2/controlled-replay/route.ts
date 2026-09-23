import { NextResponse } from "next/server";

import {
  executeAfcV2ControlledReplay,
  type AfcV2AnalyzeInput,
  type AfcV2ControlledReplayEvidence,
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

function parseInput(value: Record<string, unknown>): AfcV2AnalyzeInput | null {
  const identity = value.sourceImageIdentity;
  const frame = value.frame;
  if (
    typeof value.attemptId !== "string" ||
    !/^[A-Za-z0-9._-]{1,180}$/.test(value.attemptId) ||
    typeof value.sourceImageUrl !== "string" ||
    !Number.isSafeInteger(value.loadGeneration) ||
    !isRecord(identity) ||
    typeof identity.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(identity.sha256) ||
    typeof identity.decodedWidth !== "number" ||
    !Number.isSafeInteger(identity.decodedWidth) ||
    typeof identity.decodedHeight !== "number" ||
    !Number.isSafeInteger(identity.decodedHeight) ||
    identity.orientation !== 1 ||
    !isRecord(frame) ||
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
    loadGeneration: value.loadGeneration as number,
    frame: { width: frame.width, height: frame.height },
    referenceDepthM: value.referenceDepthM,
  };
}

function parseEvidence(value: unknown): AfcV2ControlledReplayEvidence | null {
  if (
    !isRecord(value) ||
    value.kind !== "afc-v2-controlled-replay/v1" ||
    !isRecord(value.original) ||
    !isRecord(value.empty) ||
    !isRecord(value.floorOnlyTiled) ||
    !isRecord(value.lineage) ||
    typeof value.original.base64 !== "string" ||
    typeof value.empty.base64 !== "string" ||
    typeof value.floorOnlyTiled.base64 !== "string"
  ) {
    return null;
  }
  // The analysis service performs the complete exact identity, byte, and
  // lineage binding check. This route only refuses malformed replay envelopes.
  return value as unknown as AfcV2ControlledReplayEvidence;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return json({ error: "Controlled replay is unavailable in production." }, 404);
  }
  if (!(await getAuthenticatedAdminUser())) {
    return json({ error: "Admin access required." }, 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body was not valid JSON." }, 400);
  }
  if (!isRecord(body) || body.mode !== "controlled_replay") {
    return json({ error: "Controlled replay mode was required." }, 400);
  }
  const input = parseInput(body);
  const evidence = parseEvidence(body.evidence);
  if (!input || !evidence) {
    return json({ error: "Controlled replay request was invalid." }, 400);
  }
  return json(await executeAfcV2ControlledReplay(input, evidence), 200);
}
