import { NextResponse } from "next/server";

import {
  captureAfcR3cFixedEmptyRoom,
  type AfcR3cFixedEmptyRoomCaptureResult,
} from "@/app/admin/3d-room-lab/research/afc-r3c-fixed-empty-room-capture";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

function unavailable(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  capture: (rawRequest: unknown) => Promise<AfcR3cFixedEmptyRoomCaptureResult>;
}>;

/**
 * Exported solely as an offline route-test seam. Production POST binds the
 * established admin helper and the core service; parsing remains core-owned.
 */
export function createFixedEmptyRoomCapturePostHandler(dependencies: RouteDependencies) {
  return async function POST(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    if (process.env.NODE_ENV === "production") return unavailable("This development-only endpoint is unavailable.");
    if (process.env.AFC_R3C_FIXED_CAPTURE_ENABLED !== "true") {
      return unavailable("Fixed Empty-Room capture is disabled.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ status: "failure", failureCode: "invalid_request" }, { status: 400 });
    }

    const result = await dependencies.capture(body);
    return NextResponse.json(result, { status: result.status === "failure" ? 400 : 200 });
  };
}

export const POST = createFixedEmptyRoomCapturePostHandler({
  getAuthenticatedAdminUser,
  capture: captureAfcR3cFixedEmptyRoom,
});
