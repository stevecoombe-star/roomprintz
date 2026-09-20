import { handleAfcDiagnosticsAdminVisualOverlayGet } from "@/lib/afc-v2-diagnostics/admin-visual-overlay.server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      caseId: string;
      generationId: string;
    }>;
  },
) {
  const { caseId, generationId } = await context.params;
  return handleAfcDiagnosticsAdminVisualOverlayGet({
    request,
    caseId,
    generationId,
  });
}
