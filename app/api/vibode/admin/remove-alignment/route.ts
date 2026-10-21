import { NextResponse } from "next/server";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";
import { isAfcV2ArtifactLineageRecorded } from "@/lib/afc-v2-production/artifact-lineage-diagnostic";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import { durableArtifactBytesMatch } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  parseAfcGenerationId,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import type { AfcGenerationRecord } from "@/lib/afc-v2-production/production-store";
import { selectHarmonizeEmptyBytes } from "@/lib/vibode-stage/harmonize-empty";
import type { HarmonizeExportAuthority } from "@/lib/vibode-stage/harmonize-export";
import {
  assessRemoveAlignment,
  type RemoveAlignmentFacts,
  type RemoveImageDescriptor,
} from "@/lib/vibode-stage/remove-alignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINAL_UNAVAILABLE = "Authoritative ORIGINAL image is unavailable.";

function jsonError(error: string, status: number) {
  const body = { usable: false, reason: error };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, status);
}

function refusal(reason: string) {
  const body = { usable: false as const, reason };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, 200);
}

function imageIdentity(value: AfcGenerationRecord["original"]): RemoveImageDescriptor | null {
  if (!value || value.orientation !== 1) return null;
  if (value.mimeType !== "image/jpeg" && value.mimeType !== "image/png" && value.mimeType !== "image/webp") {
    return null;
  }
  return {
    sha256: value.sha256.toLowerCase(),
    decodedWidth: value.decodedWidth,
    decodedHeight: value.decodedHeight,
    byteCount: value.byteCount,
    mimeType: value.mimeType,
    orientation: 1,
  };
}

function harmonizeAuthority(generation: AfcGenerationRecord): HarmonizeExportAuthority | null {
  const authority = generation.productionAuthority;
  const empty = generation.empty;
  if (!authority || !empty || authority.status !== "ready" || authority.generationId !== generation.id) {
    return null;
  }
  return {
    generationId: generation.id,
    empty: {
      sha256: empty.sha256,
      decodedWidth: empty.decodedWidth,
      decodedHeight: empty.decodedHeight,
      orientation: empty.orientation,
    },
    original: generation.original
      ? { sha256: generation.original.sha256, orientation: generation.original.orientation }
      : undefined,
    frame: authority.frame,
    frozenCamera: { frame: authority.frozenCamera.frame },
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = parseRoomId(url.searchParams.get("roomId"));
  if (!roomId) return jsonError("roomId is required.", 400);
  const artifact = url.searchParams.get("artifact");
  if (artifact !== null && artifact !== "original" && artifact !== "empty") {
    return jsonError("artifact is invalid.", 400);
  }
  const requestedGenerationId = url.searchParams.get("generationId");
  if (requestedGenerationId !== null && !parseAfcGenerationId(requestedGenerationId)) {
    return jsonError("generationId is invalid.", 400);
  }

  const admin = await readRemoveActor();
  if (!admin) return jsonError("Sign in required.", 403);

  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!store || !service) return jsonError("Server misconfigured.", 500);

  const room = await store.getRoom(roomId);
  if (!room || room.userId !== admin.id) return jsonError("Room not found.", 404);
  const generation = room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  if (!generation || generation.userId !== admin.id || generation.roomId !== roomId) {
    return artifact
      ? jsonError("Authoritative images are unavailable.", 404)
      : refusal("This room has no production-ready AFC generation.");
  }
  if (requestedGenerationId !== null && generation.id !== requestedGenerationId) {
    return jsonError("Authoritative images are unavailable.", 404);
  }

  const originalLoaded = generation.original
    ? await loadOwnedOriginalForProductionAnalysis(service, { userId: admin.id, room })
    : { ok: false as const };
  const original = imageIdentity(generation.original);
  const originalBytes = originalLoaded.ok ? originalLoaded.bytes : null;
  const originalBytesMatch = Boolean(
    original
    && originalBytes
    && durableArtifactBytesMatch({
      bytes: originalBytes,
      sha256: original.sha256,
      byteCount: original.byteCount,
    }),
  );
  const emptyBytes = generation.emptyStoragePath
    ? await store.getArtifact(generation.emptyStoragePath)
    : null;
  const selected = selectHarmonizeEmptyBytes({
    callerIsAdmin: false,
    roomOwnerAccess: true,
    callerUserId: admin.id,
    roomId,
    room,
    generation: {
      id: generation.id,
      roomId: generation.roomId,
      userId: generation.userId,
      status: generation.status,
      empty: generation.empty,
      emptyStoragePath: generation.emptyStoragePath,
    },
    authority: harmonizeAuthority(generation),
    bytes: emptyBytes,
  });
  const lineage = isAfcV2ArtifactLineageRecorded(generation.artifactLineage)
    ? generation.artifactLineage.empty
    : null;
  const facts: RemoveAlignmentFacts = {
    generationId: generation.id,
    status: generation.status,
    original,
    originalBytesMatch,
    empty: imageIdentity(generation.empty),
    emptyBytesMatch: selected.ok,
    emptyFailure: selected.ok ? null : selected.error,
    emptyArtifactSource: generation.emptyArtifactSource,
    lineageSource: lineage?.source ?? null,
    reusedFromGenerationId: lineage?.reusedFromGenerationId ?? null,
    lineageSha256: lineage?.sha256 ?? null,
    frame: generation.productionAuthority?.frame ?? generation.frame,
    frozenCameraFrame: generation.productionAuthority?.frozenCamera.frame ?? null,
  };
  const assessment = assessRemoveAlignment(facts);
  if (!assessment.usable) {
    return artifact ? jsonError(assessment.reason, 404) : refusal(assessment.reason);
  }

  if (artifact === "original") {
    if (!originalBytes) return jsonError(ORIGINAL_UNAVAILABLE, 404);
    return imageResponse(originalBytes, assessment.report.original.mimeType);
  }
  if (artifact === "empty") {
    if (!selected.ok) return jsonError("Authoritative EMPTY image is unavailable.", 404);
    return imageResponse(selected.bytes, "image/png");
  }

  const body = { usable: true as const, report: assessment.report };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, 200);
}

function imageResponse(bytes: Uint8Array, mimeType: string) {
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
