import { NextResponse } from "next/server";

import {
  loadP2S2DFloorContactReviewImage,
  type P2S2DFloorContactReviewImageLoadResult,
} from "@/app/admin/3d-room-lab/research/p2-s2d-floor-contact-overlay-review-server";
import {
  isP2S2DFloorContactReviewRoomId,
  type P2S2DFloorContactReviewRoomId,
} from "@/app/admin/3d-room-lab/research/p2-s2d-floor-contact-overlay-review";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type Dependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  loadImage: (
    roomId: P2S2DFloorContactReviewRoomId
  ) => Promise<P2S2DFloorContactReviewImageLoadResult>;
  nodeEnv: string | undefined;
}>;

export function createP2S2DFloorContactReviewImageGetHandler(
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
    if (!isP2S2DFloorContactReviewRoomId(roomId)) {
      return NextResponse.json(
        { error: "Invalid P2-S2D review room." },
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
        "X-P2-S2D-Empty-Sha256": result.sha256,
      },
    });
  };
}

export const GET = createP2S2DFloorContactReviewImageGetHandler({
  getAuthenticatedAdminUser,
  loadImage: loadP2S2DFloorContactReviewImage,
  nodeEnv: process.env.NODE_ENV,
});
