import { readHarmonizeActor } from "@/lib/vibode-stage/harmonize-jobs/access.server";
import { createHarmonizeCompositeUpload } from "@/lib/vibode-stage/harmonize-jobs/jobs.server";
import { harmonizeError, harmonizeJson } from "@/lib/vibode-stage/harmonize-jobs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return harmonizeError("invalid_submission");
  }
  if (!body || typeof body !== "object") return harmonizeError("invalid_submission");
  const record = body as Record<string, unknown>;
  const uploaded = await createHarmonizeCompositeUpload({
    userId: actor.userId,
    email: actor.email,
    roomId: typeof record.roomId === "string" ? record.roomId : "",
    sourceVersionId: typeof record.sourceVersionId === "string" ? record.sourceVersionId : "",
    idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey : "",
    byteLength: typeof record.byteLength === "number" ? record.byteLength : 0,
  });
  if (!uploaded.ok) return harmonizeError(uploaded.code);
  return harmonizeJson({ signedUrl: uploaded.signedUrl }, 200);
}
