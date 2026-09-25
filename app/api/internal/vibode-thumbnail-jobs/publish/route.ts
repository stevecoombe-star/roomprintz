import { NextResponse } from "next/server";

import {
  loadRunningThumbnailJobIdentity,
} from "@/lib/vibode-thumbnail-jobs/jobs.server";
import { publishVibodeThumbnailBytes } from "@/lib/vibode-thumbnail-jobs/publish.server";
import { thumbnailWorkerAuthorization } from "@/lib/vibode-thumbnail-jobs/worker-auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;

export async function POST(request: Request) {
  const auth = thumbnailWorkerAuthorization(request);
  if (auth === "unconfigured") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (auth === "rejected") {
    return NextResponse.json({ error: "Not found." }, { status: 401 });
  }
  const jobId = request.headers.get("x-vibode-thumbnail-job-id")?.trim() ?? "";
  const claimNonce = request.headers.get("x-vibode-thumbnail-claim-nonce")?.trim() ?? "";
  const contentToken = request.headers.get("x-vibode-thumbnail-content-token")?.trim() ?? "";
  if (!jobId || !claimNonce || !contentToken) {
    return json({ ok: false, code: "not_claimed", pointerChanged: false }, 400);
  }
  const identity = await loadRunningThumbnailJobIdentity(jobId, claimNonce);
  if (!identity || identity.contentToken !== contentToken) {
    return json({ ok: false, code: "stale_publish", pointerChanged: false }, 409);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return json({ ok: false, code: "encode_failed", pointerChanged: false }, 422);
  }
  const published = await publishVibodeThumbnailBytes({
    jobId,
    claimNonce,
    roomId: identity.roomId,
    versionId: identity.versionId,
    claimedContentToken: identity.contentToken,
    bytes,
  });
  return json(published, published.ok ? 200 : 409);
}

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
