import { NextResponse } from "next/server";

import {
  getRetainedFullyTiledEvidence,
} from "@/app/admin/3d-room-lab-v2/fully-tiled-generation.server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

const SAFE_ID = /^[A-Za-z0-9._-]{1,180}$/;

/**
 * Historical S3B evidence endpoint. Live Analyze & Apply no longer generates
 * or links this representation.
 */
export async function GET(request: Request) {
  if (!(await getAuthenticatedAdminUser())) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }
  const search = new URL(request.url).searchParams;
  const attemptId = search.get("attemptId");
  const resultId = search.get("resultId");
  if (
    !attemptId ||
    !resultId ||
    !SAFE_ID.test(attemptId) ||
    !SAFE_ID.test(resultId)
  ) {
    return NextResponse.json(
      { error: "FULLY_TILED evidence identity was invalid." },
      { status: 400 },
    );
  }
  const evidence = getRetainedFullyTiledEvidence(attemptId);
  if (!evidence || evidence.resultId !== resultId) {
    return NextResponse.json(
      { error: "FULLY_TILED evidence is unavailable." },
      { status: 404 },
    );
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": evidence.identity.mimeType,
    "X-AFC-V2-Representation": "FULLY_TILED",
    "X-AFC-V2-Evidence-SHA256": evidence.identity.sha256,
    "X-AFC-V2-Floor-Result": evidence.binding.floorResultId,
    "X-AFC-V2-Floor-Observation-Source":
      evidence.binding.floorObservationSource,
  });
  if (evidence.binding.floorAuthorityKey) {
    headers.set(
      "X-AFC-V2-Floor-Authority",
      evidence.binding.floorAuthorityKey,
    );
  }
  return new NextResponse(Buffer.from(evidence.bytes), { headers });
}
