import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { furnitureGenerationTestersResponse } from "@/lib/vibode-furniture/generation/admin-dashboard";

import {
  furnitureGenerationDenied,
  furnitureGenerationJson,
  furnitureGenerationServiceClient,
} from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  return furnitureGenerationJson(await furnitureGenerationTestersResponse({
    getAdmin: async () => adminUser,
    getServiceClient: furnitureGenerationServiceClient,
  }, new URL(request.url).searchParams));
}
