import {
  authorizeProductionAfcUser,
  parseAfcGenerationId,
  parseRoomId,
  parseVersionId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { createProductionAfcStoreFromEnv } from "@/lib/afc-v2-production/production-persistence.server";
import { mapSceneObjectsBetweenCameras } from "@/lib/afc-v2-runtime/effective-floor-remap";
import { resolveEffectiveProductionAuthority } from "@/lib/afc-v2-runtime/effective-production-authority";
import { validateProductionRuntimeAuthority } from "@/lib/afc-v2-runtime/runtime-authority";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import {
  validatePersistedSceneObjects,
} from "@/lib/afc-v2-runtime/persisted-scene";
import {
  resolveOwnedVersionScene,
  saveOwnedVersionScene,
} from "@/lib/afc-v2-runtime/scene-persistence.server";
import { scheduleVibodeThumbnailAfterSceneSave } from "@/lib/vibode-thumbnail-jobs/jobs.server";
import { enrichOwnedSceneRuntimeAssets } from "@/lib/vibode-stage/partner-runtime-assets.server";

export const runtime = "nodejs";

function sceneQueryFromRequest(request: Request, body: unknown): {
  roomId: string | null;
  versionId: string | null;
  afcGenerationId: string | null;
} {
  const url = new URL(request.url);
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  return {
    roomId: parseRoomId(url.searchParams.get("roomId")) ??
      parseRoomId(record?.roomId),
    versionId: parseVersionId(url.searchParams.get("versionId")) ??
      parseVersionId(record?.versionId),
    afcGenerationId: parseAfcGenerationId(url.searchParams.get("afcGenerationId")) ??
      parseAfcGenerationId(record?.afcGenerationId),
  };
}

export async function GET(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const query = sceneQueryFromRequest(request, null);
  if (!query.roomId || !query.versionId || !query.afcGenerationId) {
    return productionAfcJson({
      error: "roomId, versionId, and afcGenerationId are required.",
    }, 400);
  }

  const loaded = await resolveOwnedVersionScene({
    userId: auth.userId,
    roomId: query.roomId,
    versionId: query.versionId,
    afcGenerationId: query.afcGenerationId,
  });
  if (!loaded.ok) {
    return productionAfcJson({ error: loaded.error }, loaded.status);
  }
  const resolved = loaded.resolved;
  if (resolved.status === "none") {
    return productionAfcJson({
      status: "none",
      scene: null,
      currentAfcGenerationId: query.afcGenerationId,
    }, 200);
  }
  if (resolved.status === "malformed") {
    return productionAfcJson({
      status: "malformed",
      scene: null,
      reason: resolved.reason,
      currentAfcGenerationId: query.afcGenerationId,
    }, 200);
  }
  if (resolved.status === "incompatible") {
    return productionAfcJson({
      status: "incompatible",
      scene: null,
      reason: resolved.reason,
      storedAfcGenerationId: resolved.storedAfcGenerationId,
      currentAfcGenerationId: query.afcGenerationId,
    }, 200);
  }

  const placed = await sceneObjectsForEditor(
    query.afcGenerationId,
    resolved.scene.objects,
    "to-effective",
  );
  if (!placed.ok) {
    return productionAfcJson({ error: placed.error }, placed.status);
  }
  const readyBody: Record<string, unknown> = {
    status: "ready",
    scene: { ...resolved.scene, objects: placed.objects },
    origin: resolved.origin,
    currentAfcGenerationId: query.afcGenerationId,
  };
  const runtime = await enrichOwnedSceneRuntimeAssets(resolved.scene.objects);
  if (runtime.assetDefinitions.length > 0) {
    readyBody.assetDefinitions = runtime.assetDefinitions;
  }
  if (runtime.assetIssues.length > 0) {
    readyBody.assetIssues = runtime.assetIssues;
  }
  return productionAfcJson(readyBody, 200);
}

export async function PUT(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const query = sceneQueryFromRequest(request, body);
  if (!query.roomId || !query.versionId || !query.afcGenerationId) {
    return productionAfcJson({
      error: "roomId, versionId, and afcGenerationId are required.",
    }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return productionAfcJson({ error: "Scene payload is required." }, 400);
  }
  const record = body as Record<string, unknown>;
  if (
    record.coordinateSpace != null &&
    record.coordinateSpace !== AFC_V2_RUNTIME_COORDINATE_SPACE
  ) {
    return productionAfcJson({ error: "unexpected scene coordinate space." }, 400);
  }
  const objects = validatePersistedSceneObjects(record.objects);
  if (!objects.ok) {
    return productionAfcJson({ error: objects.reason }, 400);
  }

  const placed = await sceneObjectsForEditor(
    query.afcGenerationId,
    objects.objects,
    "to-automatic",
  );
  if (!placed.ok) {
    return productionAfcJson({ error: placed.error }, placed.status);
  }
  const saved = await saveOwnedVersionScene({
    userId: auth.userId,
    scene: {
      roomId: query.roomId,
      versionId: query.versionId,
      afcGenerationId: query.afcGenerationId,
      coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
      objects: placed.objects,
    },
  });
  if (!saved.ok) {
    return productionAfcJson({ error: saved.error }, saved.status);
  }
  // Thumbnail enqueue is durable bookkeeping only. A failure here must not
  // fail the editor save; the next save can coalesce the same derivative.
  await scheduleVibodeThumbnailAfterSceneSave(saved.scene);
  return productionAfcJson({
    status: "saved",
    scene: { ...saved.scene, objects: objects.objects },
  }, 200);
}

async function sceneObjectsForEditor(
  generationId: string,
  objects: readonly SceneObjectDefinition[],
  direction: "to-effective" | "to-automatic",
): Promise<
  | { ok: true; objects: readonly SceneObjectDefinition[] }
  | { ok: false; status: 409 | 500; error: string }
> {
  const store = createProductionAfcStoreFromEnv();
  if (!store) return { ok: false, status: 500, error: "Server misconfigured." };
  const generation = await store.getGeneration(generationId);
  const validated = validateProductionRuntimeAuthority(generation?.productionAuthority);
  if (!generation || !validated.ok) return { ok: true, objects };
  const effective = resolveEffectiveProductionAuthority(
    validated.authority,
    generation.manualPerspective,
  );
  if (effective.kind !== "manual") return { ok: true, objects };
  const from = direction === "to-effective"
    ? validated.authority.frozenCamera
    : effective.authority.frozenCamera;
  const to = direction === "to-effective"
    ? effective.authority.frozenCamera
    : validated.authority.frozenCamera;
  const mapped = mapSceneObjectsBetweenCameras(objects, from, to);
  if (!mapped) {
    return {
      ok: false,
      status: 409,
      error: "Saved furniture cannot be placed in the manual perspective.",
    };
  }
  return { ok: true, objects: mapped };
}
