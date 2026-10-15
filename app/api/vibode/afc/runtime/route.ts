import { restoreProductionAfcRoom } from "@/lib/afc-v2-production/production-adapter.server";
import {
  authorizeProductionAfcUser,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC } from "@/lib/afc-v2-production/production-original";
import { AFC_V2_PRODUCTION_STORAGE_BUCKET } from "@/lib/afc-v2-production/production-store";
import {
  createProductionAfcStoreFromEnv,
  signOwnedOriginalDisplayUrl,
} from "@/lib/afc-v2-production/production-persistence.server";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  readCertifiedFrozenCamera,
  type CertifiedFrozenCamera,
} from "@/lib/afc-v2-runtime/production-runtime-client";
import { validateProductionRuntimeAuthority } from "@/lib/afc-v2-runtime/runtime-authority";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import { trustedPathBaselineFromGeneration } from "@/lib/vibode-stage/trusted-path-authority";
import type { TrustedPathBaseline } from "@/lib/vibode-stage/trusted-path";

export const runtime = "nodejs";

function roomIdFromRequest(request: Request, body: unknown): string | null {
  const url = new URL(request.url);
  const queryRoomId = parseRoomId(url.searchParams.get("roomId"));
  if (queryRoomId) return queryRoomId;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return parseRoomId((body as Record<string, unknown>).roomId);
}

async function restoreRuntime(request: Request, body: unknown) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const roomId = roomIdFromRequest(request, body);
  if (!roomId) {
    return productionAfcJson({ error: "roomId is required." }, 400);
  }

  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!store || !service) {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }

  const room = await store.getRoom(roomId);
  if (!room || room.userId !== auth.userId) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }

  const restored = await restoreProductionAfcRoom({
    roomId,
    userId: auth.userId,
    store,
  });

  if (restored.status !== "ready" || !restored.authority) {
    return productionAfcJson({
      ...restored,
      originalImageUrl: null,
    }, 200);
  }

  const validated = validateProductionRuntimeAuthority(restored.authority);
  if (!validated.ok) {
    return productionAfcJson({
      status: "none",
      generationId: restored.generationId,
      currentGenerationId: restored.currentGenerationId,
      authority: null,
      failureReason: validated.reason,
      frame: restored.frame,
      originalImageUrl: null,
    }, 200);
  }

  const originalImageUrl = await signOwnedOriginalDisplayUrl(service, {
    userId: auth.userId,
    room,
  });
  if (!originalImageUrl) {
    return productionAfcJson({
      status: "none",
      generationId: restored.generationId,
      currentGenerationId: restored.currentGenerationId,
      authority: null,
      failureReason: "ORIGINAL image URL is unavailable.",
      frame: restored.frame,
      originalImageUrl: null,
    }, 200);
  }

  const handoff = await readRuntimeHandoff(store, {
    userId: auth.userId,
    roomId,
    generationId: restored.generationId,
  });
  const emptyImageUrl = await signOwnedEmptyDisplayUrl(service, auth.userId, handoff.emptyStoragePath);
  return productionAfcJson({
    ...restored,
    authority: validated.authority,
    originalImageUrl,
    emptyImageUrl,
    trustedPath: handoff.trustedPath,
    certifiedFrozenCamera: handoff.certifiedFrozenCamera,
  }, 200);
}

function ownedEmptyStoragePath(userId: string, path: string | null): string | null {
  if (!path || path.includes("..") || path.includes("\\") || path.includes("?") || path.startsWith("/")) {
    return null;
  }
  return path.startsWith(`users/${userId}/`) ? path : null;
}

async function signOwnedEmptyDisplayUrl(
  service: NonNullable<ReturnType<typeof getServiceRoleSupabaseClient>>,
  userId: string,
  path: string | null,
): Promise<string | null> {
  const owned = ownedEmptyStoragePath(userId, path);
  if (!owned) return null;
  const { data, error } = await service.storage
    .from(AFC_V2_PRODUCTION_STORAGE_BUCKET)
    .createSignedUrl(owned, AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC);
  if (error || typeof data?.signedUrl !== "string") return null;
  return data.signedUrl;
}

async function readRuntimeHandoff(
  store: NonNullable<ReturnType<typeof createProductionAfcStoreFromEnv>>,
  input: Readonly<{ userId: string; roomId: string; generationId: string | null }>,
): Promise<Readonly<{
  trustedPath: TrustedPathBaseline | null;
  certifiedFrozenCamera: CertifiedFrozenCamera | null;
  emptyStoragePath: string | null;
}>> {
  const empty = { trustedPath: null, certifiedFrozenCamera: null, emptyStoragePath: null };
  if (!input.generationId) return empty;
  try {
    const generation = await store.getGeneration(input.generationId);
    const authority = generation?.productionAuthority;
    if (
      !generation ||
      !authority ||
      generation.userId !== input.userId ||
      generation.roomId !== input.roomId
    ) {
      return empty;
    }
    const trustedPath = trustedPathBaselineFromGeneration({
      metricDecision: generation.metricDecision,
      originalWidth: authority.original.decodedWidth,
      originalHeight: authority.original.decodedHeight,
      emptyWidth: authority.empty.decodedWidth,
      emptyHeight: authority.empty.decodedHeight,
    });
    if (trustedPath) assertProductionPayloadPrivacy(trustedPath);
    return {
      trustedPath,
      certifiedFrozenCamera: readCertifiedFrozenCamera(authority.frozenCamera),
      emptyStoragePath: generation.emptyStoragePath,
    };
  } catch {
    return empty;
  }
}

export async function GET(request: Request) {
  return restoreRuntime(request, null);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return restoreRuntime(request, body);
}
