import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { furnitureGenerationJobResponse } from "@/lib/vibode-furniture/generation/admin-dashboard";

import {
  furnitureGenerationDenied,
  furnitureGenerationJson,
  furnitureGenerationServiceClient,
} from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  const { jobId } = await context.params;
  return furnitureGenerationJson(await furnitureGenerationJobResponse({
    getAdmin: async () => adminUser,
    getServiceClient: furnitureGenerationServiceClient,
  }, jobId));
}
