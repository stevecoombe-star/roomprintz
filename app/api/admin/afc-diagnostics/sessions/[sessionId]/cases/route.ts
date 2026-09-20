import { handleAfcDiagnosticsAdminCapturePost } from "@/lib/afc-v2-diagnostics/admin-capture.server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  return handleAfcDiagnosticsAdminCapturePost({ request, sessionId });
}
