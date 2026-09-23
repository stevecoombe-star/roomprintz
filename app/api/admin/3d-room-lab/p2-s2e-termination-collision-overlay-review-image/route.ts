import { NextResponse } from "next/server";

import {
  isP2S2ETerminationCollisionReviewRoomId,
  type P2S2ETerminationCollisionReviewRoomId,
} from "@/app/admin/3d-room-lab/research/p2-s2e-termination-collision-overlay-review";
import {
  loadP2S2ETerminationCollisionReviewImage,
  type P2S2ETerminationCollisionReviewImageLoadResult,
} from "@/app/admin/3d-room-lab/research/p2-s2e-termination-collision-overlay-review-server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type Dependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  loadImage: (
    roomId: P2S2ETerminationCollisionReviewRoomId
  ) => Promise<P2S2ETerminationCollisionReviewImageLoadResult>;
  nodeEnv: string | undefined;
}>;

export function createP2S2ETerminationCollisionReviewImageGetHandler(
  dependencies: Dependencies
) {
  return async function GET(request: Request): Promise<Response> {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) {
      return NextResponse.json(
        { error: "Admin access required." },
        { status: 403 }
      );
    }
    if (dependencies.nodeEnv === "production") {
      return NextResponse.json(
        { error: "This research-only endpoint is unavailable." },
        { status: 404 }
      );
    }
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (!isP2S2ETerminationCollisionReviewRoomId(roomId)) {
      return NextResponse.json(
        { error: "Invalid P2-S2E review room." },
        { status: 400 }
      );
    }
    const result = await dependencies.loadImage(roomId);
    if (!result.ok) {
      return NextResponse.json({ error: result.code }, { status: 404 });
    }
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": result.contentType,
        "X-Content-Type-Options": "nosniff",
        "X-P2-S2E-Empty-Sha256": result.sha256,
      },
    });
  };
}

export const GET = createP2S2ETerminationCollisionReviewImageGetHandler({
  getAuthenticatedAdminUser,
  loadImage: loadP2S2ETerminationCollisionReviewImage,
  nodeEnv: process.env.NODE_ENV,
});
