import { readHarmonizeActor } from "@/lib/vibode-stage/harmonize-jobs/access.server";
import { enqueueHarmonizeGeneration } from "@/lib/vibode-stage/harmonize-jobs/jobs.server";
import { harmonizeError, harmonizeJson } from "@/lib/vibode-stage/harmonize-jobs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 256_000) {
    return harmonizeError("invalid_submission");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return harmonizeError("invalid_submission");
  }
  const enqueued = await enqueueHarmonizeGeneration({
    userId: actor.userId,
    email: actor.email,
    submission: body,
  });
  if (!enqueued.ok) return harmonizeError(enqueued.code);
  return harmonizeJson({
    jobId: enqueued.jobId,
    status: enqueued.status,
    created: enqueued.created,
  }, 202);
}

