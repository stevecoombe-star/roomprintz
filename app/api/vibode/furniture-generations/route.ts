import { productionAfcJson } from "@/lib/afc-v2-production/production-http";
import { postFurnitureGeneration } from "@/lib/vibode-furniture/generation/http";
import { productionFurnitureGenerationDeps } from "@/lib/vibode-furniture/generation/production.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rejected bodies stop here. Reservation, not this route, is the spending boundary.
export async function POST(request: Request) {
  const deps = productionFurnitureGenerationDeps();
  if (!deps) return productionAfcJson({ ok: false, error: "Server misconfigured." }, 500);
  const result = await postFurnitureGeneration(request, deps);
  return productionAfcJson(result.body, result.status);
}
