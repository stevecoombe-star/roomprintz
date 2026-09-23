import { handleAfcDiagnosticsAdminCasesGet } from "@/lib/afc-v2-diagnostics/admin-read-model.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAfcDiagnosticsAdminCasesGet({ request });
}
