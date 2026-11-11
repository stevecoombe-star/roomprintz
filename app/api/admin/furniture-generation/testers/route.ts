import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { furnitureGenerationTestersResponse } from "@/lib/vibode-furniture/generation/admin-dashboard";
import { furnitureGenerationApproveResponse } from "@/lib/vibode-furniture/generation/admin-tester";

import {
  furnitureGenerationDenied,
  furnitureGenerationJson,
  furnitureGenerationServiceClient,
  furnitureGenerationWriteClient,
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

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  return furnitureGenerationJson(await furnitureGenerationApproveResponse({
    getAdmin: async () => adminUser,
    getServiceClient: furnitureGenerationWriteClient,
  }, request));
}
