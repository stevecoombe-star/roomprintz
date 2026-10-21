import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  REMOVE_CLEANUP_CONCEPT_SET,
  REMOVE_CLEANUP_COORDINATE_BASIS,
  REMOVE_CLEANUP_FILL_OPACITY,
  REMOVE_CLEANUP_MASK_PROVENANCE,
  REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION,
  REMOVE_CLEANUP_MODEL_ID,
  REMOVE_CLEANUP_OUTLINE,
  REMOVE_CLEANUP_PROMPT_VERSION,
  REMOVE_CLEANUP_PROVIDER_ID,
  REMOVE_CLEANUP_SCHEMA,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  REMOVE_CLEANUP_NBP_MODEL_ID,
  REMOVE_CLEANUP_NBP_OUTPUT_MIME,
  REMOVE_CLEANUP_NBP_PROVIDER_ID,
  removeCleanupNbpOutputConfig,
} from "@/lib/vibode-stage/remove-cleanup-nbp.server";
import {
  REMOVE_CLEANUP_ASPECT_CLASSIFIER,
  REMOVE_CLEANUP_OVERLAY_VERSION,
  REMOVE_CLEANUP_SNAPSHOT_VERSION,
  REMOVE_CLEANUP_STAGE_REGISTRATION,
  removeCleanupPaidRequestFingerprint,
  type RemoveCleanupGenerationInputSnapshot,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

import {
  cleanupMasksPath,
  cleanupOriginalPath,
  cleanupOverlayPath,
  cleanupPromptPath,
} from "./policy";
import type { CleanupClaim, CleanupJobInsert, CleanupSelectionItem } from "./types";

const MASK_SCHEMA = "remove-cleanup-masks/v1";

export function cleanupMaskManifest(snapshot: RemoveCleanupGenerationInputSnapshot): Uint8Array {
  const objects = snapshot.artifacts.selectedMasks().map((mask) => ({
    id: mask.id,
    concept: snapshot.selection.objects.find((object) => object.id === mask.id)?.concept ?? "",
    confidence: snapshot.selection.objects.find((object) => object.id === mask.id)?.confidence ?? 0,
    maskSha256: mask.maskSha256,
    bits: Buffer.from(mask.bits).toString("base64"),
  }));
  return new TextEncoder().encode(JSON.stringify({ schemaVersion: MASK_SCHEMA, objects }));
}

export function cleanupJobInsertFromSnapshot(
  snapshot: RemoveCleanupGenerationInputSnapshot,
  input: Readonly<{ userId: string; roomUserId: string; currentGenerationId: string; jobId: string }>,
): CleanupJobInsert | null {
  const family = snapshot.aspect.providerFamily;
  if (!family.admissible) return null;
  const output = removeCleanupNbpOutputConfig(snapshot, "2K");
  if (!output || output.resolutionClass !== "2K" || output.mimeType !== REMOVE_CLEANUP_NBP_OUTPUT_MIME) return null;
  if (output.providerId !== REMOVE_CLEANUP_NBP_PROVIDER_ID || output.modelId !== REMOVE_CLEANUP_NBP_MODEL_ID) return null;
  const paid = removeCleanupPaidRequestFingerprint(snapshot.inputFingerprint, output);
  if (!paid) return null;
  const selection: CleanupSelectionItem[] = snapshot.selection.objects.map((object) => ({
    id: object.id,
    concept: object.concept,
    maskSha256: object.maskSha256,
  }));
  const concepts = [...new Set(selection.map((object) => object.concept))].sort();
  return {
    id: input.jobId,
    userId: input.userId,
    roomUserId: input.roomUserId,
    roomId: snapshot.roomId,
    afcGenerationId: snapshot.generationId,
    currentGenerationId: input.currentGenerationId,
    paidRequestFingerprint: paid,
    inputFingerprint: snapshot.inputFingerprint,
    hiddenConcepts: concepts,
    selection,
    originalSha256: snapshot.original.sha256,
    originalMime: snapshot.original.mimeType,
    originalByteCount: snapshot.original.byteCount,
    originalWidth: snapshot.original.decodedWidth,
    originalHeight: snapshot.original.decodedHeight,
    overlaySha256: snapshot.overlay.sha256,
    promptSha256: snapshot.prompt.sha256,
    promptVersion: snapshot.prompt.version,
    maskManifestSha256: sha256Hex(cleanupMaskManifest(snapshot)),
    aspectRatioFamily: family.family,
    documented1kGridWidth: family.documented1kGridWidth,
    documented1kGridHeight: family.documented1kGridHeight,
    originalPath: cleanupOriginalPath(snapshot.roomId, input.jobId, snapshot.original.mimeType),
    overlayPath: cleanupOverlayPath(snapshot.roomId, input.jobId),
    promptPath: cleanupPromptPath(snapshot.roomId, input.jobId),
    masksPath: cleanupMasksPath(snapshot.roomId, input.jobId),
  };
}

export function rehydrateCleanupSnapshot(
  claim: CleanupClaim,
  files: Readonly<{ original: Uint8Array; overlay: Uint8Array; prompt: string; masks: Uint8Array }>,
): RemoveCleanupGenerationInputSnapshot {
  const parsed = parseMasks(files.masks);
  return {
    schemaVersion: REMOVE_CLEANUP_SNAPSHOT_VERSION,
    userId: claim.userId,
    roomId: claim.roomId,
    generationId: claim.afcGenerationId,
    original: {
      sha256: claim.originalSha256,
      byteCount: files.original.byteLength,
      decodedWidth: claim.originalWidth,
      decodedHeight: claim.originalHeight,
      mimeType: claim.originalMime,
      orientation: 1,
    },
    segmentation: {
      provider: REMOVE_CLEANUP_PROVIDER_ID,
      modelId: REMOVE_CLEANUP_MODEL_ID,
      conceptSet: REMOVE_CLEANUP_CONCEPT_SET,
      schema: REMOVE_CLEANUP_SCHEMA,
      coordinateBasis: REMOVE_CLEANUP_COORDINATE_BASIS,
      maskProvenance: REMOVE_CLEANUP_MASK_PROVENANCE,
      maskProvenanceLimitation: REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION,
    },
    selection: {
      count: claim.selection.length,
      objects: claim.selection.map((object) => ({
        id: object.id,
        concept: object.concept,
        confidence: parsed.get(object.id)?.confidence ?? 0,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        areaPx: 1,
        maskSha256: object.maskSha256,
      })),
      unionPixels: 1,
      unionCoveragePercent: 0,
      unionSha256: claim.maskManifestSha256,
    },
    overlay: {
      constructionVersion: REMOVE_CLEANUP_OVERLAY_VERSION,
      format: "image/png",
      sha256: claim.overlaySha256,
      decodedWidth: claim.originalWidth,
      decodedHeight: claim.originalHeight,
      color: "#FF00FF",
      opacity: REMOVE_CLEANUP_FILL_OPACITY,
      referenceExpansionPx: 0,
      outline: REMOVE_CLEANUP_OUTLINE,
    },
    prompt: {
      version: REMOVE_CLEANUP_PROMPT_VERSION,
      text: files.prompt,
      sha256: claim.promptSha256,
      phrases: [],
    },
    exclusions: {
      brushReveal: "excluded",
      brushRestore: "excluded",
      protectObjects: "excluded",
      interactiveMaskExpansion: "excluded",
      instantComposite: "excluded",
      emptyImage: "excluded",
    },
    aspect: {
      sourceWidth: claim.originalWidth,
      sourceHeight: claim.originalHeight,
      orientation: 1,
      providerFamily: {
        admissible: true,
        classifier: REMOVE_CLEANUP_ASPECT_CLASSIFIER,
        family: claim.aspectRatioFamily,
        documented1kGridWidth: claim.documented1kGridWidth,
        documented1kGridHeight: claim.documented1kGridHeight,
      },
      stageRegistration: REMOVE_CLEANUP_STAGE_REGISTRATION,
    },
    providerOutput: null,
    inputFingerprint: claim.inputFingerprint,
    artifacts: {
      originalBytes: () => Uint8Array.from(files.original),
      overlayPng: () => Uint8Array.from(files.overlay),
      selectedMasks: () => claim.selection.map((object) => ({
        id: object.id,
        maskSha256: object.maskSha256,
        bits: parsed.get(object.id)?.bits ?? new Uint8Array(),
      })),
    },
  };
}

function parseMasks(bytes: Uint8Array): Map<string, { confidence: number; bits: Uint8Array }> {
  const found = new Map<string, { confidence: number; bits: Uint8Array }>();
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      objects?: Array<{ id?: string; confidence?: number; bits?: string; maskSha256?: string }>;
    };
    for (const object of payload.objects ?? []) {
      if (!object.id || typeof object.bits !== "string") continue;
      const bits = Buffer.from(object.bits, "base64");
      if (object.maskSha256 && sha256Hex(bits) !== object.maskSha256) continue;
      found.set(object.id, { confidence: typeof object.confidence === "number" ? object.confidence : 0, bits: new Uint8Array(bits) });
    }
  } catch {
    return found;
  }
  return found;
}
