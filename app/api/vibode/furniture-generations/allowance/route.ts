import { productionAfcJson } from "@/lib/afc-v2-production/production-http";
import { getFurnitureGenerationAllowance } from "@/lib/vibode-furniture/generation/http";
import { productionFurnitureGenerationDeps } from "@/lib/vibode-furniture/generation/production.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const deps = productionFurnitureGenerationDeps();
  if (!deps) return productionAfcJson({ ok: false, error: "Server misconfigured." }, 500);
  const result = await getFurnitureGenerationAllowance(request, deps);
  return productionAfcJson(result.body, result.status);
}
