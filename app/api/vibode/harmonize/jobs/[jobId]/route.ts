import { readHarmonizeActor } from "@/lib/vibode-stage/harmonize-jobs/access.server";
import { readHarmonizeGenerationStatus } from "@/lib/vibode-stage/harmonize-jobs/jobs.server";
import { harmonizeError, harmonizeJson } from "@/lib/vibode-stage/harmonize-jobs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  const { jobId } = await context.params;
  const job = await readHarmonizeGenerationStatus({ userId: actor.userId, jobId });
  if (!job) return harmonizeError("not_found");
  return harmonizeJson({ job }, 200);
}
