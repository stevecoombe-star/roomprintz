import { NextResponse } from "next/server";

import {
  reconstructP2S2BFrozenReviewMask,
  type P2S2BFrozenMaskReconstruction,
} from "@/app/admin/3d-room-lab/research/p2-s2b-frozen-prediction-review-server";
import {
  isP2S2BFrozenReviewRoomId,
  type P2S2BFrozenReviewRoomId,
} from "@/app/admin/3d-room-lab/research/p2-s2b-frozen-prediction-review";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type Dependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  reconstructMask: (
    roomId: P2S2BFrozenReviewRoomId
  ) => Promise<P2S2BFrozenMaskReconstruction>;
  nodeEnv: string | undefined;
}>;

export function createP2S2BFrozenPredictionReviewMaskGetHandler(
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
    if (!isP2S2BFrozenReviewRoomId(roomId)) {
      return NextResponse.json(
        { error: "Invalid frozen review room." },
        { status: 400 }
      );
    }
    const result = await dependencies.reconstructMask(roomId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code },
        { status: 409 }
      );
    }
    return new Response(Buffer.from(result.pngBytes), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
        "X-P2-S2B-Component-Mask-Sha256": result.componentMaskSha256,
        "X-P2-S2B-Region-Module-Blob":
          result.moduleBlobs.regionModuleBlob,
        "X-P2-S2B-Fragment-Module-Blob":
          result.moduleBlobs.fragmentModuleBlob,
      },
    });
  };
}

export const GET = createP2S2BFrozenPredictionReviewMaskGetHandler({
  getAuthenticatedAdminUser,
  reconstructMask: reconstructP2S2BFrozenReviewMask,
  nodeEnv: process.env.NODE_ENV,
});
