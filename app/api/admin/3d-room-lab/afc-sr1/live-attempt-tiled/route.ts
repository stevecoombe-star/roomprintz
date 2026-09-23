import { NextResponse } from "next/server";

import {
  getAfcSr1LiveAttemptEvidence,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

const ATTEMPT_ID = /^[A-Za-z0-9._-]{1,180}$/;

type Dependencies = Readonly<{
  authenticateAdmin?: typeof getAuthenticatedAdminUser;
  getEvidence?: typeof getAfcSr1LiveAttemptEvidence;
}>;

function missing(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Serves only the exact TILED bytes retained for this in-memory live attempt.
 * It never calls a provider, regenerates an image, or falls back to another
 * attempt's artifact.
 */
export function createAfcSr1LiveAttemptTiledGetHandler(
  dependencies: Dependencies = {}
) {
  return async function get(request: Request): Promise<NextResponse> {
    const admin = await (
      dependencies.authenticateAdmin ?? getAuthenticatedAdminUser
    )();
    if (!admin) {
      return new NextResponse(null, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const attemptId = new URL(request.url).searchParams.get("attemptId");
    if (!attemptId || !ATTEMPT_ID.test(attemptId)) return missing();
    const evidence = (
      dependencies.getEvidence ?? getAfcSr1LiveAttemptEvidence
    )(attemptId);
    const tiled = evidence?.tiledPerspective;
    if (!tiled) return missing();

    return new NextResponse(Buffer.from(tiled.tiledBytes), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": tiled.tiledBasis.mimeType,
        "Content-Length": String(tiled.tiledBytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

export const GET = createAfcSr1LiveAttemptTiledGetHandler();
