import { handleRemoveCleanupDiscard } from "@/lib/vibode-stage/remove-cleanup-jobs/http";
import { createRemoveCleanupRouteDeps } from "@/lib/vibode-stage/remove-cleanup-jobs/route-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const deps = createRemoveCleanupRouteDeps();
  if (!deps) {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const { jobId } = await context.params;
  return handleRemoveCleanupDiscard(deps, jobId);
}
