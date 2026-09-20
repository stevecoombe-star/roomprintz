import { handleAfcDiagnosticsAdminCaseReviewPatch } from "@/lib/afc-v2-diagnostics/admin-review.server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  return handleAfcDiagnosticsAdminCaseReviewPatch({ request, caseId });
}
