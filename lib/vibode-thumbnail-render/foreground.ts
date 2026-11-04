/**
 * Saved Bring Forward cutouts for the existing thumbnail still.
 *
 * The content token gains a foreground identity only after a committed
 * selection. Draft edits are not an input. A missing persistence table keeps
 * the legacy token. A corrupt snapshot refuses a new still instead of
 * publishing furniture with the photographed objects left out.
 */

import {
  assessBringForwardDisplay,
  bringForwardImageIdentity,
  type BringForwardBackgroundClaim,
  type BringForwardBackgroundKind,
} from "@/lib/vibode-stage/bring-forward-cutout";
import { readRemoveObjectUiPayload } from "@/lib/vibode-stage/remove-object-ui";
import type { RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i;

export const THUMBNAIL_FOREGROUND_DATA_URL_MAX_CHARS = 16_000_000;

export const THUMBNAIL_FOREGROUND_UNRESTORED =
  "Saved foreground objects could not be loaded. The room is unchanged.";

export type ThumbnailForegroundToken = Readonly<{
  snapshotId: string;
  payloadSha256: string;
  selectedIds: readonly string[];
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
}>;

export type ThumbnailForegroundClaim = Readonly<{
  kind: BringForwardBackgroundKind;
  roomId: string;
  generationId: string;
  originalSha256: string | null;
}>;

export type ThumbnailForegroundPaint = Readonly<{
  imageUrl: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  backgroundIsOriginal: boolean;
  backgroundClaim: ThumbnailForegroundClaim | null;
  scan: unknown;
}>;

export type ThumbnailForegroundVersion = Readonly<{
  roomId: string;
  imageUrl: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  metadata?: unknown;
  cleanupJobId?: string | null;
}>;

export type ThumbnailForegroundLoad =
  | Readonly<{ state: "none" | "missing" }>
  | Readonly<{ state: "invalid" | "unavailable" }>
  | Readonly<{
    state: "committed";
    token: ThumbnailForegroundToken;
    paint: ThumbnailForegroundPaint | null;
  }>;

export function thumbnailForegroundTokenField(
  token: ThumbnailForegroundToken | null | undefined,
): ThumbnailForegroundToken | null {
  if (!token) return null;
  if (!UUID.test(token.snapshotId) || !SHA256.test(token.payloadSha256) || !SHA256.test(token.originalSha256)) {
    return null;
  }
  if (!positive(token.originalWidth) || !positive(token.originalHeight)) return null;
  const selectedIds = [...token.selectedIds].sort();
  if (selectedIds.length === 0 || selectedIds.length > 48) return null;
  if (selectedIds.some((id) => id.length === 0 || id.length > 80)) return null;
  return {
    snapshotId: token.snapshotId,
    payloadSha256: token.payloadSha256,
    selectedIds,
    originalSha256: token.originalSha256,
    originalWidth: token.originalWidth,
    originalHeight: token.originalHeight,
  };
}

/**
 * Straight-alpha source-over. Covered pixels take the photograph.
 * Uncovered pixels keep the furniture still. This is the pixel rule the
 * thumbnail frame gets from stacking the cutout canvas above the WebGL mount.
 */
export function placeBringForwardCutoutOver(
  scene: Uint8ClampedArray,
  cutout: Uint8ClampedArray,
): Uint8ClampedArray | null {
  if (scene.length === 0 || scene.length !== cutout.length || scene.length % 4 !== 0) return null;
  const output = new Uint8ClampedArray(scene);
  for (let index = 0; index < scene.length; index += 4) {
    const alpha = cutout[index + 3] ?? 0;
    if (alpha <= 0) continue;
    if (alpha >= 255) {
      output[index] = cutout[index] ?? 0;
      output[index + 1] = cutout[index + 1] ?? 0;
      output[index + 2] = cutout[index + 2] ?? 0;
      output[index + 3] = 255;
      continue;
    }
    const src = alpha / 255;
    const dst = 1 - src;
    output[index] = Math.round((cutout[index] ?? 0) * src + (scene[index] ?? 0) * dst);
    output[index + 1] = Math.round((cutout[index + 1] ?? 0) * src + (scene[index + 1] ?? 0) * dst);
    output[index + 2] = Math.round((cutout[index + 2] ?? 0) * src + (scene[index + 2] ?? 0) * dst);
    output[index + 3] = 255;
  }
  return output;
}

export function decideThumbnailForegroundPaint(input: Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  displayedWidth: number;
  displayedHeight: number;
  backgroundIsOriginal: boolean;
  backgroundClaim: ThumbnailForegroundClaim | null;
}>): "paint" | "omit" | "unmeasured" {
  const original = bringForwardImageIdentity({
    sha256: input.originalSha256,
    width: input.originalWidth,
    height: input.originalHeight,
  });
  const displayed = bringForwardImageIdentity({
    sha256: input.backgroundIsOriginal ? input.originalSha256 : "0".repeat(64),
    width: input.displayedWidth,
    height: input.displayedHeight,
  });
  if (!original || !displayed) return "unmeasured";
  const claim = backgroundClaim(input.backgroundClaim);
  const phase = assessBringForwardDisplay({
    snapshot: { roomId: input.roomId, generationId: input.generationId, original, objects: [] },
    roomId: input.roomId,
    generationId: input.generationId,
    displayed,
    source: original,
    removeActive: false,
    background: input.backgroundIsOriginal ? null : claim,
  });
  return phase === "show" ? "paint" : "omit";
}

export function validateThumbnailForegroundPaint(
  value: unknown,
  room: Readonly<{ roomId: string; versionId: string; afcGenerationId: string }>,
): Readonly<{ ok: true; paint: ThumbnailForegroundPaint; objects: readonly RemoveObjectRecord[] }>
  | Readonly<{ ok: false; reason: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "foreground is invalid." };
  }
  const record = value as Record<string, unknown>;
  const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl : "";
  if (
    imageUrl.length === 0
    || imageUrl.length > THUMBNAIL_FOREGROUND_DATA_URL_MAX_CHARS
    || !DATA_URL.test(imageUrl)
  ) {
    return { ok: false, reason: "foreground image is not a private data URL." };
  }
  const originalSha256 = typeof record.originalSha256 === "string" ? record.originalSha256 : "";
  const originalWidth = record.originalWidth;
  const originalHeight = record.originalHeight;
  if (!SHA256.test(originalSha256) || !positive(originalWidth) || !positive(originalHeight)) {
    return { ok: false, reason: "foreground ORIGINAL identity is invalid." };
  }
  if (typeof record.backgroundIsOriginal !== "boolean") {
    return { ok: false, reason: "foreground background identity is invalid." };
  }
  const claim = readClaim(record.backgroundClaim, room);
  if (!claim.ok) return claim;
  const read = readRemoveObjectUiPayload(record.scan, {
    roomId: room.roomId,
    generationId: room.afcGenerationId,
    originalSha256,
    originalWidth,
    originalHeight,
    sessionSerial: 0,
    vocabularyRevision: 0,
  });
  if (!read.ok || read.objects.length === 0) {
    return { ok: false, reason: "foreground masks are invalid." };
  }
  return {
    ok: true,
    objects: read.objects,
    paint: {
      imageUrl,
      originalSha256,
      originalWidth,
      originalHeight,
      backgroundIsOriginal: record.backgroundIsOriginal,
      backgroundClaim: claim.claim,
      scan: record.scan,
    },
  };
}

function backgroundClaim(claim: ThumbnailForegroundClaim | null): BringForwardBackgroundClaim | null {
  if (!claim) return null;
  return {
    imageUrl: "https://thumbnail.invalid/background",
    roomId: claim.roomId,
    generationId: claim.generationId,
    kind: claim.kind,
    originalSha256: claim.originalSha256,
  };
}

function readClaim(
  value: unknown,
  room: Readonly<{ roomId: string; afcGenerationId: string }>,
): Readonly<{ ok: true; claim: ThumbnailForegroundClaim | null }> | Readonly<{ ok: false; reason: string }> {
  if (value == null) return { ok: true, claim: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "foreground background claim is invalid." };
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "remove" && kind !== "cleanup" && kind !== "history") {
    return { ok: false, reason: "foreground background claim is invalid." };
  }
  if (record.roomId !== room.roomId || record.generationId !== room.afcGenerationId) {
    return { ok: false, reason: "foreground background claim is for a different room." };
  }
  const originalSha256 = record.originalSha256;
  if (originalSha256 != null && (typeof originalSha256 !== "string" || !SHA256.test(originalSha256))) {
    return { ok: false, reason: "foreground background claim is invalid." };
  }
  if ((kind === "remove" || kind === "cleanup") && originalSha256 == null) {
    return { ok: false, reason: "foreground background claim is invalid." };
  }
  return {
    ok: true,
    claim: {
      kind,
      roomId: room.roomId,
      generationId: room.afcGenerationId,
      originalSha256: typeof originalSha256 === "string" ? originalSha256 : null,
    },
  };
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
