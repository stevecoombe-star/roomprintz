import { handleManualPerspectiveGet, handleManualPerspectivePost } from "@/lib/afc-v2-diagnostics/manual-perspective.server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; generationId: string }> },
) {
  const { caseId, generationId } = await context.params;
  return handleManualPerspectiveGet({ request, caseId, generationId });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string; generationId: string }> },
) {
  const { caseId, generationId } = await context.params;
  return handleManualPerspectivePost({ request, caseId, generationId });
}
