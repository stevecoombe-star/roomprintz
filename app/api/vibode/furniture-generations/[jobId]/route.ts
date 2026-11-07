import { productionAfcJson } from "@/lib/afc-v2-production/production-http";
import { getFurnitureGeneration } from "@/lib/vibode-furniture/generation/http";
import { productionFurnitureGenerationDeps } from "@/lib/vibode-furniture/generation/production.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const deps = productionFurnitureGenerationDeps();
  if (!deps) return productionAfcJson({ ok: false, error: "Server misconfigured." }, 500);
  const { jobId } = await context.params;
  const result = await getFurnitureGeneration(request, deps, jobId);
  return productionAfcJson(result.body, result.status);
}
