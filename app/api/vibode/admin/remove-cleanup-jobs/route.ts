import { handleRemoveCleanupEnqueue, handleRemoveCleanupRoomStatus } from "@/lib/vibode-stage/remove-cleanup-jobs/http";
import { createRemoveCleanupRouteDeps } from "@/lib/vibode-stage/remove-cleanup-jobs/route-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const deps = createRemoveCleanupRouteDeps();
  if (!deps) return unavailable();
  return handleRemoveCleanupEnqueue(request, deps);
}

export async function GET(request: Request) {
  const deps = createRemoveCleanupRouteDeps();
  if (!deps) return unavailable();
  return handleRemoveCleanupRoomStatus(request, deps);
}

function unavailable(): Response {
  return new Response(JSON.stringify({ error: "Clean Up could not be started." }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
