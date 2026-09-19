import { handleAfcQaBrowserStateGet } from "@/lib/afc-v2-diagnostics/browser-qa-state.server";
import { authorizeProductionAfcUser } from "@/lib/afc-v2-production/production-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAfcQaBrowserStateGet({
    request,
    authorize: authorizeProductionAfcUser,
  });
}
