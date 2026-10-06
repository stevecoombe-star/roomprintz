import { handleStageTransformGizmosGet } from "@/lib/vibode-stage/stage-gizmo-capability.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleStageTransformGizmosGet(request);
}
