/**
 * REMOVE-2B admin export of Clean Up Room inputs.
 *
 * Authorization, ORIGINAL verification, overlay construction, and the prompt
 * come from the shared preparation snapshot. This module only packages the
 * five-file ZIP. It does not call a provider, write History, or persist
 * the ZIP.
 */

import { NextResponse } from "next/server";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { productionAfcJson } from "@/lib/afc-v2-production/production-http";
import { zipStore } from "@/lib/vibode-stage/harmonize-export";
import {
  REMOVE_CLEANUP_DIAGNOSTIC_FILE,
  REMOVE_CLEANUP_EXPORT_VERSION,
  REMOVE_CLEANUP_MANIFEST_FILE,
  REMOVE_CLEANUP_OVERLAY_FILE,
  REMOVE_CLEANUP_PROMPT_FILE,
  REMOVE_CLEANUP_ZIP_NAME,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  REMOVE_CLEANUP_MAX_ZIP_BYTES,
  prepareAuthorizedRemoveCleanupInput,
  type RemoveCleanupExportDeps,
  type RemoveCleanupGenerationInputSnapshot,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

export {
  REMOVE_CLEANUP_MAX_BODY_BYTES,
  REMOVE_CLEANUP_MAX_PACKED_BYTES,
  REMOVE_CLEANUP_MAX_ZIP_BYTES,
  parseRemoveCleanupExportRequest,
  removeCleanupIdDigest,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

export type {
  RemoveCleanupExportDeps,
  RemoveCleanupExportStore,
  RemoveCleanupOriginalLoad,
  RemoveCleanupParsedRequest,
  RemoveCleanupSelectedObject,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

export async function handleRemoveCleanupExport(
  request: Request,
  deps: RemoveCleanupExportDeps,
): Promise<Response> {
  const prepared = await prepareAuthorizedRemoveCleanupInput(request, deps);
  if (!prepared.ok) return jsonError(prepared.reason, prepared.status);
  const snapshot = prepared.snapshot;
  const originalBytes = snapshot.artifacts.originalBytes();
  const overlayPng = snapshot.artifacts.overlayPng();
  const diagnosticPng = prepared.copyDiagnosticPng();
  const promptBytes = new TextEncoder().encode(snapshot.prompt.text);
  if (sha256Hex(originalBytes) !== snapshot.original.sha256) {
    return jsonError("ORIGINAL SHA-256 does not match.", 422);
  }
  if (sha256Hex(overlayPng) !== snapshot.overlay.sha256 || sha256Hex(promptBytes) !== snapshot.prompt.sha256) {
    return jsonError("Server misconfigured.", 500);
  }
  const originalFile = `01-original.${extensionForMime(snapshot.original.mimeType)}`;
  const createdAt = deps.now?.() ?? new Date().toISOString();
  const manifest = {
    schemaVersion: REMOVE_CLEANUP_EXPORT_VERSION,
    createdAt,
    roomId: snapshot.roomId,
    generationId: snapshot.generationId,
    original: {
      sha256: snapshot.original.sha256,
      decodedWidth: snapshot.original.decodedWidth,
      decodedHeight: snapshot.original.decodedHeight,
      mimeType: snapshot.original.mimeType,
      orientation: snapshot.original.orientation,
      fileName: originalFile,
      byteCount: snapshot.original.byteCount,
      sha256MatchesExport: true,
    },
    segmentation: {
      provider: snapshot.segmentation.provider,
      modelId: snapshot.segmentation.modelId,
      conceptSet: snapshot.segmentation.conceptSet,
      schema: snapshot.segmentation.schema,
      coordinateBasis: snapshot.segmentation.coordinateBasis,
      maskProvenance: snapshot.segmentation.maskProvenance,
      maskProvenanceLimitation: snapshot.segmentation.maskProvenanceLimitation,
    },
    selection: {
      count: snapshot.selection.count,
      objects: snapshot.selection.objects.map((object) => ({
        id: object.id,
        concept: object.concept,
        confidence: object.confidence,
        bounds: object.bounds,
        areaPx: object.areaPx,
        maskSha256: object.maskSha256,
      })),
      unionPixels: snapshot.selection.unionPixels,
      unionCoveragePercent: snapshot.selection.unionCoveragePercent,
    },
    overlay: {
      color: snapshot.overlay.color,
      opacity: snapshot.overlay.opacity,
      outline: snapshot.overlay.outline,
      referenceExpansionPx: snapshot.overlay.referenceExpansionPx,
      width: snapshot.overlay.decodedWidth,
      height: snapshot.overlay.decodedHeight,
      sha256: snapshot.overlay.sha256,
      fileName: REMOVE_CLEANUP_OVERLAY_FILE,
      mimeType: snapshot.overlay.format,
    },
    diagnosticMask: {
      fileName: REMOVE_CLEANUP_DIAGNOSTIC_FILE,
      sha256: sha256Hex(diagnosticPng),
      width: snapshot.original.decodedWidth,
      height: snapshot.original.decodedHeight,
      role: "internal-diagnostic",
      modelInput: false,
    },
    prompt: {
      version: snapshot.prompt.version,
      fileName: REMOVE_CLEANUP_PROMPT_FILE,
      sha256: snapshot.prompt.sha256,
    },
    exclusions: {
      brushReveal: snapshot.exclusions.brushReveal,
      brushRestore: snapshot.exclusions.brushRestore,
      protectObjects: snapshot.exclusions.protectObjects,
      interactiveMaskExpansion: snapshot.exclusions.interactiveMaskExpansion,
      instantComposite: snapshot.exclusions.instantComposite,
      emptyImage: snapshot.exclusions.emptyImage,
      modelInputs: [originalFile, REMOVE_CLEANUP_OVERLAY_FILE],
    },
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const zip = zipStore([
    { name: originalFile, data: originalBytes },
    { name: REMOVE_CLEANUP_OVERLAY_FILE, data: overlayPng },
    { name: REMOVE_CLEANUP_DIAGNOSTIC_FILE, data: diagnosticPng },
    { name: REMOVE_CLEANUP_MANIFEST_FILE, data: manifestBytes },
    { name: REMOVE_CLEANUP_PROMPT_FILE, data: promptBytes },
  ]);
  if (zip.byteLength > REMOVE_CLEANUP_MAX_ZIP_BYTES) {
    return jsonError("Clean Up export is too large.", 422);
  }
  if (sha256Hex(originalBytes) !== manifest.original.sha256) {
    return jsonError("ORIGINAL SHA-256 does not match.", 422);
  }
  return new NextResponse(Buffer.from(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${REMOVE_CLEANUP_ZIP_NAME}"`,
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function extensionForMime(mime: RemoveCleanupGenerationInputSnapshot["original"]["mimeType"]): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function jsonError(reason: string, status: number) {
  const body = { usable: false as const, reason };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, status);
}
