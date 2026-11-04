import "server-only";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import { resolveOwnedOriginalStorage } from "@/lib/afc-v2-production/production-original";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  acceptBringForwardSnapshot,
  bringForwardSelectionBinds,
  canonicalBringForwardSnapshot,
} from "@/lib/vibode-stage/bring-forward-store";
import {
  authorizeBringForwardIdentity,
  SupabaseBringForwardRepository,
} from "@/lib/vibode-stage/bring-forward-store.server";
import { readBringForwardBackgroundClaim } from "@/lib/vibode-stage/bring-forward-cutout";
import { REMOVE_SEGMENTATION_MAX_IMAGE_BYTES } from "@/lib/vibode-stage/remove-segmentation";

import type {
  ThumbnailForegroundClaim,
  ThumbnailForegroundLoad,
  ThumbnailForegroundVersion,
} from "./foreground";

/**
 * Read the committed selection for one owned room.
 * Does not call a segmentation provider and does not reserve a quota.
 * A missing table is an empty result so thumbnails keep working before the
 * persistence migration. Any other read failure stays invalid.
 */
export async function loadProductionThumbnailForeground(input: Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
  version: ThumbnailForegroundVersion;
  includeImage: boolean;
}>): Promise<ThumbnailForegroundLoad> {
  const authority = await authorizeBringForwardIdentity({
    userId: input.userId,
    roomId: input.roomId,
    generationId: input.generationId,
  });
  if (!authority.ok) {
    return authority.status === 404 ? { state: "none" } : { state: "unavailable" };
  }
  const service = getServiceRoleSupabaseClient();
  if (!service) return { state: "unavailable" };
  const read = await new SupabaseBringForwardRepository(service).read({
    userId: input.userId,
    identity: authority.identity,
  });
  if (!read.ok) return read.code === "missing" ? { state: "missing" } : { state: "unavailable" };
  if (read.recovery === "empty") return { state: "none" };
  if (read.recovery !== "ready") return { state: "invalid" };
  if (read.selectedIds.length === 0) return { state: "none" };
  if (sha256Hex(new TextEncoder().encode(read.payload)) !== read.payloadSha256) return { state: "invalid" };
  const accepted = acceptBringForwardSnapshot(read.payload, authority.identity);
  if (!accepted.ok || !bringForwardSelectionBinds(accepted.objects, read.selectedIds)) {
    return { state: "invalid" };
  }
  const token = {
    snapshotId: read.snapshotId,
    payloadSha256: read.payloadSha256,
    selectedIds: read.selectedIds.slice().sort(),
    originalSha256: authority.identity.originalSha256,
    originalWidth: authority.identity.originalWidth,
    originalHeight: authority.identity.originalHeight,
  };
  if (!input.includeImage) return { state: "committed", token, paint: null };
  const store = createProductionAfcStoreFromEnv();
  const room = store ? await store.getRoom(input.roomId) : null;
  if (!room || room.userId !== input.userId) return { state: "unavailable" };
  const loaded = await loadOwnedOriginalForProductionAnalysis(service, { userId: input.userId, room });
  if (!loaded.ok || loaded.bytes.byteLength === 0 || loaded.bytes.byteLength > REMOVE_SEGMENTATION_MAX_IMAGE_BYTES) {
    return { state: "unavailable" };
  }
  if (sha256Hex(loaded.bytes) !== authority.identity.originalSha256) return { state: "invalid" };
  const imageUrl = originalDataUrl(loaded.bytes);
  if (!imageUrl) return { state: "invalid" };
  const selected = new Set(read.selectedIds);
  const objects = accepted.objects.filter((object) => selected.has(object.id));
  const scan = canonicalBringForwardSnapshot({
    identity: authority.identity,
    conceptSet: accepted.conceptSet,
    provider: accepted.provider,
    modelId: accepted.modelId,
    objects,
  });
  if (!scan) return { state: "invalid" };
  const resolved = resolveOwnedOriginalStorage({
    authenticatedUserId: input.userId,
    roomId: input.roomId,
    room,
  });
  const backgroundIsOriginal = resolved.ok
    && input.version.storageBucket === resolved.ref.bucket
    && input.version.storagePath === resolved.ref.path;
  return {
    state: "committed",
    token,
    paint: {
      imageUrl,
      originalSha256: token.originalSha256,
      originalWidth: token.originalWidth,
      originalHeight: token.originalHeight,
      backgroundIsOriginal,
      backgroundClaim: backgroundIsOriginal ? null : claimFor(input.version, input.roomId, input.generationId),
      scan: JSON.parse(scan) as unknown,
    },
  };
}

function claimFor(
  version: ThumbnailForegroundVersion,
  roomId: string,
  generationId: string,
): ThumbnailForegroundClaim | null {
  const claim = readBringForwardBackgroundClaim({
    asset: {
      room_id: version.roomId,
      image_url: version.imageUrl?.trim() || "https://thumbnail.invalid/background",
      metadata: version.metadata ?? {},
      cleanup_job_id: version.cleanupJobId ?? null,
    },
    roomId,
    generationId,
  });
  if (!claim) return null;
  return {
    kind: claim.kind,
    roomId: claim.roomId,
    generationId: claim.generationId,
    originalSha256: claim.originalSha256,
  };
}

function originalDataUrl(bytes: Uint8Array): string | null {
  const mime = imageMime(bytes);
  if (!mime) return null;
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function imageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) return "image/png";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}
