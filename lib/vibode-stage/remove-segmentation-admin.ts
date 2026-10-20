/**
 * Admin REMOVE object segmentation.
 *
 * The browser sends a room id and a generation id. This handler loads the
 * authoritative ORIGINAL only after the same ownership and readiness checks
 * as REMOVE alignment. It does not write History, the scene, or the database.
 */

import { isAfcV2ArtifactLineageRecorded } from "@/lib/afc-v2-production/artifact-lineage-diagnostic";
import { durableArtifactBytesMatch } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  parseAfcGenerationId,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import type {
  AfcGenerationRecord,
  AfcProductionStore,
  AfcRoomPointer,
} from "@/lib/afc-v2-production/production-store";
import { selectHarmonizeEmptyBytes } from "@/lib/vibode-stage/harmonize-empty";
import type { HarmonizeExportAuthority } from "@/lib/vibode-stage/harmonize-export";
import {
  assessRemoveAlignment,
  type RemoveAlignmentFacts,
  type RemoveImageDescriptor,
} from "@/lib/vibode-stage/remove-alignment";
import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_MAX_EDGE,
  REMOVE_SEGMENTATION_MAX_IMAGE_BYTES,
  REMOVE_SEGMENTATION_MAX_PIXELS,
  REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES,
  type RemoveSegmentationFailure,
  type RemoveSegmentationProvider,
  type RemoveSegmentationResult,
  type RemoveSegmentationSuccess,
} from "@/lib/vibode-stage/remove-segmentation";
import type {
  RemoveObjectRecord,
  RemovePackedMask,
  RemoveSuppressedDuplicate,
} from "@/lib/vibode-stage/remove-objects";

export type RemoveObjectsAdminStore = Pick<
  AfcProductionStore,
  "getRoom" | "getGeneration" | "getArtifact"
>;

export type RemoveObjectsOriginalLoad =
  | Readonly<{ ok: true; bytes: Uint8Array }>
  | Readonly<{ ok: false }>;

export type RemoveObjectsAdminDeps = Readonly<{
  getAdmin: () => Promise<{ id: string } | null>;
  createStore: () => RemoveObjectsAdminStore | null;
  createService: () => unknown;
  loadOriginal: (
    service: unknown,
    input: Readonly<{ userId: string; room: AfcRoomPointer }>,
  ) => Promise<RemoveObjectsOriginalLoad>;
  provider: RemoveSegmentationProvider;
}>;

const BODY_BYTES = 4096;

export async function handleRemoveObjectsAdmin(
  request: Request,
  deps: RemoveObjectsAdminDeps,
): Promise<Response> {
  const parsed = await readRequest(request);
  if (parsed === "too-large" || parsed === "invalid") {
    return jsonError("Request body is invalid.", 400);
  }

  const admin = await deps.getAdmin();
  if (!admin) return jsonError("Admin access required.", 403);

  const store = deps.createStore();
  const service = deps.createService();
  if (!store || !service) return jsonError("Server misconfigured.", 500);

  const room = await store.getRoom(parsed.roomId);
  if (!room || room.userId !== admin.id) return jsonError("Room not found.", 404);
  const generation = room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  if (!generation || generation.userId !== admin.id || generation.roomId !== parsed.roomId) {
    return refusal("This room has no production-ready AFC generation.");
  }
  if (generation.id !== parsed.generationId) {
    return jsonError("Authoritative images are unavailable.", 404);
  }
  if (generation.status !== "ready") {
    return refusal(notReadyReason(generation));
  }

  const originalLoaded = generation.original
    ? await deps.loadOriginal(service, { userId: admin.id, room })
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
    callerIsAdmin: true,
    callerUserId: admin.id,
    roomId: parsed.roomId,
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
  if (!assessment.usable) return refusal(assessment.reason);
  if (!original || !originalBytes) {
    return jsonError("Authoritative ORIGINAL image is unavailable.", 404);
  }
  if (
    originalBytes.byteLength > REMOVE_SEGMENTATION_MAX_IMAGE_BYTES
    || original.decodedWidth > REMOVE_SEGMENTATION_MAX_EDGE
    || original.decodedHeight > REMOVE_SEGMENTATION_MAX_EDGE
    || original.decodedWidth * original.decodedHeight > REMOVE_SEGMENTATION_MAX_PIXELS
  ) {
    return jsonError("ORIGINAL image exceeds the segmentation limit.", 422);
  }

  let result: RemoveSegmentationResult;
  try {
    result = await deps.provider.segment({
      bytes: originalBytes,
      width: original.decodedWidth,
      height: original.decodedHeight,
      sha256: original.sha256,
      mimeType: original.mimeType,
    }, REMOVE_SEGMENTATION_CONCEPTS_V1);
  } catch {
    return jsonError("Segmentation provider did not respond.", 502);
  }
  if (!result.ok) return jsonError(failureReason(result), failureStatus(result));
  return successResponse({
    result,
    roomId: parsed.roomId,
    generationId: generation.id,
    original,
  });
}

function notReadyReason(generation: AfcGenerationRecord): string {
  const assessment = assessRemoveAlignment({
    generationId: generation.id,
    status: generation.status,
    original: null,
    originalBytesMatch: false,
    empty: null,
    emptyBytesMatch: false,
    emptyFailure: null,
    emptyArtifactSource: null,
    lineageSource: null,
    reusedFromGenerationId: null,
    lineageSha256: null,
    frame: null,
    frozenCameraFrame: null,
  });
  return assessment.usable
    ? "This room has no production-ready AFC generation."
    : assessment.reason;
}

function successResponse(input: Readonly<{
  result: RemoveSegmentationSuccess;
  roomId: string;
  generationId: string;
  original: RemoveImageDescriptor;
}>): Response {
  const body = {
    usable: true as const,
    provider: input.result.provider,
    modelId: input.result.modelId,
    conceptSet: input.result.conceptSet,
    schema: input.result.schema,
    maskEncoding: input.result.maskEncoding,
    unverifiedEncodings: input.result.unverifiedEncodings,
    outputProbThresh: input.result.outputProbThresh,
    providerNms: input.result.providerNms,
    roomId: input.roomId,
    generationId: input.generationId,
    original: {
      sha256: input.original.sha256,
      decodedWidth: input.original.decodedWidth,
      decodedHeight: input.original.decodedHeight,
    },
    providerTimeSec: input.result.providerTimeSec,
    objects: input.result.preparation.eligible.map(compactRecord),
    rejected: input.result.preparation.rejected.map(compactRecord),
    suppressed: input.result.preparation.suppressed.map(compactSuppressed),
    nested: input.result.preparation.nested,
  };
  const serialized = JSON.stringify(body);
  if (serialized.length > REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES) {
    return jsonError("Segmentation provider returned an unbounded payload.", 502);
  }
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, 200);
}

function compactRecord(record: RemoveObjectRecord) {
  return {
    id: record.id,
    concept: record.concept,
    confidence: record.confidence,
    mask: compactMask(record.mask),
    eligibility: record.eligibility,
  };
}

function compactSuppressed(item: RemoveSuppressedDuplicate) {
  return {
    suppressedId: item.suppressedId,
    suppressedConcept: item.suppressedConcept,
    suppressedConfidence: item.suppressedConfidence,
    retainedId: item.retainedId,
    retainedConcept: item.retainedConcept,
    retainedConfidence: item.retainedConfidence,
    iou: item.iou,
    containment: item.containment,
    reason: item.reason,
    mask: compactMask(item.object.mask),
  };
}

function compactMask(mask: RemovePackedMask) {
  return {
    width: mask.width,
    height: mask.height,
    areaPx: mask.areaPx,
    bounds: mask.bounds,
    bits: Buffer.from(mask.bits).toString("base64"),
  };
}

function failureStatus(failure: RemoveSegmentationFailure): number {
  switch (failure.error) {
    case "credentials_missing":
      return 500;
    case "request_rejected":
      return failure.detail === "concepts" ? 500 : 422;
    case "provider_timeout":
      return 504;
    default:
      return 502;
  }
}

function failureReason(failure: RemoveSegmentationFailure): string {
  switch (failure.error) {
    case "credentials_missing":
      return "Segmentation provider is not configured.";
    case "request_rejected":
      if (failure.detail === "concepts") return "Server misconfigured.";
      if (
        failure.detail === "image_bytes"
        || failure.detail === "image_pixels"
        || failure.detail === "image_edge"
      ) {
        return "ORIGINAL image exceeds the segmentation limit.";
      }
      return "Authoritative ORIGINAL image is unavailable.";
    case "provider_timeout":
      return "Segmentation provider timed out.";
    case "provider_unauthorized":
      return "Segmentation provider rejected the credentials.";
    case "provider_http": {
      const status = failure.providerStatus;
      const known = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599;
      return known
        ? `Segmentation provider returned HTTP ${status}.`
        : "Segmentation provider returned an error.";
    }
    case "provider_network":
      return "Segmentation provider did not respond.";
    case "response_unbounded":
      return "Segmentation provider returned an unbounded payload.";
    case "rle_contract_unverified":
      return "Segmentation provider returned an unverified mask encoding.";
    case "mask_dimensions":
      return "Segmentation masks do not match the ORIGINAL image.";
    default:
      return "Segmentation provider returned an unusable mask payload.";
  }
}

function jsonError(reason: string, status: number) {
  const body = { usable: false as const, reason };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, status);
}

function refusal(reason: string) {
  return jsonError(reason, 200);
}

async function readRequest(
  request: Request,
): Promise<{ roomId: string; generationId: string } | "invalid" | "too-large"> {
  const bytes = await readBoundedBody(request, BODY_BYTES);
  if (bytes === "too-large") return "too-large";
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return "invalid";
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "invalid";
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes("roomId") || !keys.includes("generationId")) {
    return "invalid";
  }
  const record = payload as { roomId: unknown; generationId: unknown };
  const roomId = parseRoomId(record.roomId);
  const generationId = parseAfcGenerationId(record.generationId);
  if (!roomId || !generationId) return "invalid";
  return { roomId, generationId };
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  if (!request.body) {
    const text = await request.text();
    if (text.length > maxBytes) return "too-large";
    return new TextEncoder().encode(text);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
