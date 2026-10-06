import { NextResponse } from "next/server";

import { claimNextVibodeThumbnailJob } from "@/lib/vibode-thumbnail-jobs/jobs.server";
import { thumbnailWorkerAuthorization } from "@/lib/vibode-thumbnail-jobs/worker-auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = thumbnailWorkerAuthorization(request);
  if (auth === "unconfigured") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (auth === "rejected") {
    return NextResponse.json({ error: "Not found." }, { status: 401 });
  }
  const claimed = await claimNextVibodeThumbnailJob();
  if (!claimed.ok) {
    return json({ ok: false, code: claimed.code }, 503);
  }
  if (!claimed.job) return json({ ok: true, job: null }, 200);
  return json({ ok: true, job: claimed.job }, 200);
}

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
