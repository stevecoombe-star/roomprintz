import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { furnitureGenerationUpdateResponse } from "@/lib/vibode-furniture/generation/admin-tester";

import {
  furnitureGenerationDenied,
  furnitureGenerationJson,
  furnitureGenerationWriteClient,
} from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  const { userId } = await context.params;
  return furnitureGenerationJson(await furnitureGenerationUpdateResponse({
    getAdmin: async () => adminUser,
    getServiceClient: furnitureGenerationWriteClient,
  }, request, userId));
}
