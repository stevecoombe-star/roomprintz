import { NextResponse } from "next/server";

import { loadStageCatalogFromEnv } from "@/lib/vibode-stage/catalog-persistence.server";
import { serializeStageCatalogPayload } from "@/lib/vibode-stage/catalog-store";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  try {
    const loaded = await loadStageCatalogFromEnv();
    return json(serializeStageCatalogPayload(loaded), 200);
  } catch {
    return json({ ok: false, error: "Failed to load STAGE catalog." }, 500);
  }
}
