import { handleAfcDiagnosticsAdminSessionDetailGet } from "@/lib/afc-v2-diagnostics/admin-read-model.server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  return handleAfcDiagnosticsAdminSessionDetailGet({ request, sessionId });
}
