import { NextResponse } from "next/server";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  ADMIN_REQUIRED,
  adminReadGateway,
  type AdminReadClient,
  type AdminReadResult,
} from "@/lib/vibode-furniture/generation/admin-dashboard";

export function furnitureGenerationServiceClient(): AdminReadClient | null {
  const client = getServiceRoleSupabaseClient();
  if (!client) return null;
  return adminReadGateway({
    async rpc(fn, args) {
      const result = await client.rpc(fn, args);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
  });
}

export function furnitureGenerationJson(result: AdminReadResult): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function furnitureGenerationDenied(): NextResponse {
  return furnitureGenerationJson({ status: 403, body: { error: ADMIN_REQUIRED } });
}
