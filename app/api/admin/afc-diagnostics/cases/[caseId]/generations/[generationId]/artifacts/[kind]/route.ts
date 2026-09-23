import { handleAfcDiagnosticsAdminVisualArtifactGet } from "@/lib/afc-v2-diagnostics/admin-visual-evidence.server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      caseId: string;
      generationId: string;
      kind: string;
    }>;
  },
) {
  const { caseId, generationId, kind } = await context.params;
  return handleAfcDiagnosticsAdminVisualArtifactGet({
    request,
    caseId,
    generationId,
    kind,
  });
}
