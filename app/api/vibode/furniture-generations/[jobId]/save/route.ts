import { productionAfcJson } from "@/lib/afc-v2-production/production-http";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { productionFurnitureGenerationDeps } from "@/lib/vibode-furniture/generation/production.server";
import { postCalibratedFurnitureSave } from "@/lib/vibode-furniture/generation/save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const deps = productionFurnitureGenerationDeps();
  const library = personalFurnitureServices();
  if (!deps || !library.ok) return productionAfcJson({ ok: false, error: "Server misconfigured." }, 500);
  const { jobId } = await context.params;
  const result = await postCalibratedFurnitureSave(request, {
    authorize: deps.authorize,
    commands: deps.commands,
    objects: deps.objects,
    library: library.records,
    libraryObjects: library.objects,
    nowMs: deps.nowMs,
  }, jobId);
  return productionAfcJson(result.body, result.status);
}
