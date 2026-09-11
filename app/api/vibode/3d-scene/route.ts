import {
  authorizeProductionAfcUser,
  parseAfcGenerationId,
  parseRoomId,
  parseVersionId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { AFC_V2_RUNTIME_COORDINATE_SPACE } from "@/lib/afc-v2-runtime/types";
import {
  validatePersistedSceneObjects,
} from "@/lib/afc-v2-runtime/persisted-scene";
import {
  loadOwnedVersionScene,
  saveOwnedVersionScene,
} from "@/lib/afc-v2-runtime/scene-persistence.server";

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

  const loaded = await loadOwnedVersionScene({
    userId: auth.userId,
    roomId: query.roomId,
    versionId: query.versionId,
    afcGenerationId: query.afcGenerationId,
  });
  if (!loaded.ok) {
    return productionAfcJson({ error: loaded.error }, loaded.status);
  }
  if (!loaded.found) {
    return productionAfcJson({
      status: "none",
      scene: null,
      currentAfcGenerationId: query.afcGenerationId,
    }, 200);
  }
  if ("malformed" in loaded) {
    return productionAfcJson({
      status: "malformed",
      scene: null,
      reason: "Stored 3D scene is malformed.",
      currentAfcGenerationId: query.afcGenerationId,
    }, 200);
  }

  const compatible = loaded.scene.afcGenerationId === query.afcGenerationId;
  if (!compatible) {
    return productionAfcJson({
      status: "incompatible",
      scene: null,
      reason: "Stored 3D scene belongs to a different AFC generation.",
      storedAfcGenerationId: loaded.scene.afcGenerationId,
      currentAfcGenerationId: query.afcGenerationId,
    }, 200);
  }

  return productionAfcJson({
    status: "ready",
    scene: loaded.scene,
    currentAfcGenerationId: query.afcGenerationId,
  }, 200);
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

  const saved = await saveOwnedVersionScene({
    userId: auth.userId,
    scene: {
      roomId: query.roomId,
      versionId: query.versionId,
      afcGenerationId: query.afcGenerationId,
      coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
      objects: objects.objects,
    },
  });
  if (!saved.ok) {
    return productionAfcJson({ error: saved.error }, saved.status);
  }
  return productionAfcJson({
    status: "saved",
    scene: saved.scene,
  }, 200);
}
