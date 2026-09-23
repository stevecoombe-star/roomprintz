import { handleAfcQaTesterCasePost } from "@/lib/afc-v2-diagnostics/submit-tester-case.server";
import { authorizeProductionAfcUser } from "@/lib/afc-v2-production/production-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAfcQaTesterCasePost({
    request,
    authorize: authorizeProductionAfcUser,
  });
}
