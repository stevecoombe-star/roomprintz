import { NextResponse } from "next/server";

import {
  isP2S2BHoldoutOracleRoomId,
} from "@/app/admin/3d-room-lab/research/p2-s2b-holdout-oracle-authoring";
import {
  loadP2S2BHoldoutOracleEmptyImage,
  type P2S2BHoldoutOracleImageLoadResult,
} from "@/app/admin/3d-room-lab/research/p2-s2b-holdout-oracle-image";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type Dependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  loadImage: (
    roomId: "room-b" | "room-d"
  ) => Promise<P2S2BHoldoutOracleImageLoadResult>;
  nodeEnv: string | undefined;
}>;

export function createP2S2BHoldoutOracleImageGetHandler(
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
    if (!isP2S2BHoldoutOracleRoomId(roomId)) {
      return NextResponse.json({ error: "Invalid holdout room." }, { status: 400 });
    }
    const result = await dependencies.loadImage(roomId);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Certified EMPTY image unavailable.", code: result.code },
        { status: 404 }
      );
    }
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": result.contentType,
        "X-Content-Type-Options": "nosniff",
        "X-P2-S2B-Empty-Sha256": result.sha256,
      },
    });
  };
}

export const GET = createP2S2BHoldoutOracleImageGetHandler({
  getAuthenticatedAdminUser,
  loadImage: loadP2S2BHoldoutOracleEmptyImage,
  nodeEnv: process.env.NODE_ENV,
});
