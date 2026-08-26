import { NextResponse } from "next/server";

import {
  getAfcSr1LiveAttemptEvidence,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getAuthenticatedAdminUser())) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  if (!attemptId || !/^[A-Za-z0-9._-]{1,180}$/.test(attemptId)) {
    return NextResponse.json(
      { error: "Attempt id was invalid." },
      { status: 400 },
    );
  }
  const evidence = getAfcSr1LiveAttemptEvidence(attemptId);
  if (!evidence?.tiledPerspective) {
    return NextResponse.json(
      { error: "TILED evidence is unavailable." },
      { status: 404 },
    );
  }
  return new NextResponse(
    Buffer.from(evidence.tiledPerspective.tiledBytes),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": evidence.tiledPerspective.tiledBasis.mimeType,
        "Content-Length": String(
          evidence.tiledPerspective.tiledBytes.byteLength,
        ),
        "X-AFC-V2-Representation": "TILED",
        "X-AFC-V2-Evidence-SHA256":
          evidence.tiledPerspective.tiledBasis.sha256,
        "X-AFC-V2-Generated-From": "EMPTY",
        "X-AFC-V2-Parent-EMPTY-SHA256":
          evidence.binding?.emptyBasis.sha256 ?? "",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
