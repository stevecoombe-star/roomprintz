import { NextResponse } from "next/server";

import {
  getAfcSr1LiveAttemptEvidence,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getAuthenticatedAdminUser())) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  if (!attemptId || !/^[A-Za-z0-9._-]{1,180}$/.test(attemptId)) {
    return NextResponse.json({ error: "Attempt id was invalid." }, { status: 400 });
  }
  const evidence = getAfcSr1LiveAttemptEvidence(attemptId);
  if (!evidence?.floorRead) {
    return NextResponse.json({ error: "EMPTY evidence is unavailable." }, { status: 404 });
  }
  return new NextResponse(Buffer.from(evidence.floorRead.emptyBytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": evidence.floorRead.emptyBasis.mimeType,
    },
  });
}
