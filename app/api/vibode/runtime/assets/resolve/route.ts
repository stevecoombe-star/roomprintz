import {
  authorizeProductionAfcUser,
  parseAfcGenerationId,
  parseRoomId,
  parseVersionId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { resolveOwnedVersionScene } from "@/lib/afc-v2-runtime/scene-persistence.server";
import {
  lookupPartnerRuntimeAssets,
  mintPartnerRuntimeSignedGet,
} from "@/lib/vibode-stage/partner-runtime-assets.server";
import {
  intersectRequestedSceneAssetIds,
  parseRuntimeAssetResolveBody,
  resolveSceneRuntimeAssets,
} from "@/lib/vibode-stage/partner-runtime-assets";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = parseRuntimeAssetResolveBody(body);
  if (!parsed.ok) {
    return productionAfcJson({ error: parsed.error }, 400);
  }
  const roomId = parseRoomId(parsed.roomId);
  const versionId = parseVersionId(parsed.versionId);
  const afcGenerationId = parseAfcGenerationId(parsed.afcGenerationId);
  if (!roomId || !versionId || !afcGenerationId) {
    return productionAfcJson({
      error: "roomId, versionId, and afcGenerationId are required.",
    }, 400);
  }

  const loaded = await resolveOwnedVersionScene({
    userId: auth.userId,
    roomId,
    versionId,
    afcGenerationId,
  });
  if (!loaded.ok) {
    return productionAfcJson({ error: loaded.error }, loaded.status);
  }
  const resolved = loaded.resolved;
  if (resolved.status !== "ready" || !resolved.scene) {
    return productionAfcJson({
      error: "3D scene is not ready.",
    }, 400);
  }

  const sceneAssetIds = resolved.scene.objects.map((object) => object.assetId);
  const allowedIds = intersectRequestedSceneAssetIds({
    requestedAssetIds: parsed.assetIds,
    sceneAssetIds,
  });
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }
  const runtime = await resolveSceneRuntimeAssets({
    assetIds: allowedIds,
    lookupDynamicAssets: (ids) => lookupPartnerRuntimeAssets(supabase, ids),
    mintSignedGet: (row) => mintPartnerRuntimeSignedGet(supabase, row),
  });
  return productionAfcJson({
    assetDefinitions: runtime.assetDefinitions,
    assetIssues: runtime.assetIssues.length > 0 ? runtime.assetIssues : undefined,
  }, 200);
}
