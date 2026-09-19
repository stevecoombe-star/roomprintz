import { handleAfcQaCapabilityGet } from "@/lib/afc-v2-diagnostics/qa-capability.server";
import { authorizeProductionAfcUser } from "@/lib/afc-v2-production/production-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAfcQaCapabilityGet({
    request,
    authorize: authorizeProductionAfcUser,
  });
}
