import { handleAfcDiagnosticsAdminCaseDetailGet } from "@/lib/afc-v2-diagnostics/admin-read-model.server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  return handleAfcDiagnosticsAdminCaseDetailGet({ request, caseId });
}
