import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { furnitureGenerationJobsResponse } from "@/lib/vibode-furniture/generation/admin-dashboard";

import {
  furnitureGenerationDenied,
  furnitureGenerationJson,
  furnitureGenerationServiceClient,
} from "../../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  const { userId } = await context.params;
  return furnitureGenerationJson(await furnitureGenerationJobsResponse({
    getAdmin: async () => adminUser,
    getServiceClient: furnitureGenerationServiceClient,
  }, userId, new URL(request.url).searchParams));
}
