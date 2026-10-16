import { readHarmonizeActor } from "@/lib/vibode-stage/harmonize-jobs/access.server";
import { enqueueHarmonizeGeneration, readHarmonizeRoomJob } from "@/lib/vibode-stage/harmonize-jobs/jobs.server";
import { harmonizeError, harmonizeJson } from "@/lib/vibode-stage/harmonize-jobs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  if (!ROOM_ID_RE.test(roomId)) return harmonizeError("invalid_submission");
  const job = await readHarmonizeRoomJob({ userId: actor.userId, roomId });
  return harmonizeJson({ job }, 200);
}

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

