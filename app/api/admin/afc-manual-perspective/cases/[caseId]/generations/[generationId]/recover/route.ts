import {
  handleManualPerspectiveRecoveryGet,
  handleManualPerspectiveRecoveryPost,
} from "@/lib/afc-v2-diagnostics/manual-perspective-recovery.server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; generationId: string }> },
) {
  const { caseId, generationId } = await context.params;
  return handleManualPerspectiveRecoveryGet({ request, caseId, generationId });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string; generationId: string }> },
) {
  const { caseId, generationId } = await context.params;
  return handleManualPerspectiveRecoveryPost({ request, caseId, generationId });
}
