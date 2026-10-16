import { readHarmonizeActor } from "@/lib/vibode-stage/harmonize-jobs/access.server";
import { readHarmonizeGenerationOutput } from "@/lib/vibode-stage/harmonize-jobs/jobs.server";
import { harmonizeError } from "@/lib/vibode-stage/harmonize-jobs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  const { jobId } = await context.params;
  const output = await readHarmonizeGenerationOutput({ userId: actor.userId, jobId });
  if (!output) return harmonizeError("not_found");
  const body = new Uint8Array(output.byteLength);
  body.set(output);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
    },
  });
}
