import { NextResponse } from "next/server";

import { failVibodeThumbnailJob } from "@/lib/vibode-thumbnail-jobs/jobs.server";
import { boundThumbnailJobErrorMessage } from "@/lib/vibode-thumbnail-jobs/policy";
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
  const body = await request.json().catch(() => null);
  const jobId = text(body, "jobId");
  const claimNonce = text(body, "claimNonce");
  const code = text(body, "code");
  const message = text(body, "message");
  if (!jobId || !claimNonce || !code) {
    return json({ ok: false, code: "not_claimed" }, 400);
  }
  const failed = await failVibodeThumbnailJob({
    jobId,
    claimNonce,
    code,
    message: boundThumbnailJobErrorMessage(message || code),
  });
  if (!failed.ok) return json(failed, 409);
  return json(failed, 200);
}

function text(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
