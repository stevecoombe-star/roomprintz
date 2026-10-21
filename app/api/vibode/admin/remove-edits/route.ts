import { createRemoveEditRouteDeps } from "@/lib/vibode-stage/remove-edit-route.server";
import { handleRemoveEditPost } from "@/lib/vibode-stage/remove-edit-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const deps = createRemoveEditRouteDeps();
  if (!deps) {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  return handleRemoveEditPost(request, deps);
}
