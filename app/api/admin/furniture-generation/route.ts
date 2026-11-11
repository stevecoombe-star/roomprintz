import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { furnitureGenerationOverviewResponse } from "@/lib/vibode-furniture/generation/admin-dashboard";
import { generationEnabledFromEnv } from "@/lib/vibode-furniture/generation/policy";

import {
  furnitureGenerationDenied,
  furnitureGenerationJson,
  furnitureGenerationServiceClient,
} from "./http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  return furnitureGenerationJson(await furnitureGenerationOverviewResponse({
    getAdmin: async () => adminUser,
    getServiceClient: furnitureGenerationServiceClient,
    generationAdmissionEnabled: generationEnabledFromEnv(process.env),
  }));
}
