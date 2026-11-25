import { NextResponse } from "next/server";

import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import {
  createProviderBalanceReader,
  meshyBalanceApiKeyFromEnv,
  providerBalanceAdminResponse,
} from "@/lib/vibode-furniture/generation/provider-balance";

import { furnitureGenerationDenied } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reader = createProviderBalanceReader({
  fetchImpl: fetch,
  apiKey: () => meshyBalanceApiKeyFromEnv(process.env),
  now: () => Date.now(),
});

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const result = await providerBalanceAdminResponse({
    getAdmin: getAuthenticatedAdminUser,
    refresh,
    read: (force) => reader.read(force),
  });
  if (result.status !== 200) return furnitureGenerationDenied();
  return NextResponse.json(result.body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
