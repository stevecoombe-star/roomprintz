import { durableArtifactBytesMatch } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  HarmonizeExportError,
  decideHarmonizeExportFrame,
  readPngSize,
  requireHarmonizePixelFrame,
  type HarmonizeExportAuthority,
} from "@/lib/vibode-stage/harmonize-export";

export type HarmonizeEmptyRoom = Readonly<{
  userId: string;
  currentAfcGenerationId: string | null;
}>;

export type HarmonizeEmptyGeneration = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  status: string;
  empty: Readonly<{
    sha256: string;
    byteCount: number;
    decodedWidth: number;
    decodedHeight: number;
    mimeType: string;
  }> | null;
  emptyStoragePath: string | null;
}>;

export type HarmonizeEmptySelection =
  | Readonly<{
    ok: true;
    bytes: Uint8Array;
    width: number;
    height: number;
    sha256: string;
  }>
  | Readonly<{
    ok: false;
    status: 400 | 403 | 404 | 409;
    error: string;
  }>;

const UNAVAILABLE = "Authoritative EMPTY image is unavailable.";
const INTEGRITY = "Authoritative EMPTY image failed integrity checks.";

export function selectHarmonizeEmptyBytes(input: Readonly<{
  callerIsAdmin: boolean;
  callerUserId: string | null;
  roomId: string;
  room: HarmonizeEmptyRoom | null;
  generation: HarmonizeEmptyGeneration | null;
  authority: HarmonizeExportAuthority | null;
  bytes: Uint8Array | null;
}>): HarmonizeEmptySelection {
  if (!input.callerIsAdmin || !input.callerUserId) {
    return { ok: false, status: 403, error: "Admin access required." };
  }
  if (!input.room || input.room.userId !== input.callerUserId) {
    return { ok: false, status: 404, error: "Room not found." };
  }
  const generation = input.generation;
  const empty = generation?.empty ?? null;
  if (
    !generation
    || !input.room.currentAfcGenerationId
    || generation.id !== input.room.currentAfcGenerationId
    || generation.userId !== input.callerUserId
    || generation.roomId !== input.roomId
    || generation.status !== "ready"
    || !input.authority
    || !empty
    || empty.mimeType !== "image/png"
    || !generation.emptyStoragePath
    || !input.bytes
    || input.bytes.byteLength === 0
  ) {
    return { ok: false, status: 404, error: UNAVAILABLE };
  }
  if (
    !durableArtifactBytesMatch({
      bytes: input.bytes,
      sha256: empty.sha256,
      byteCount: empty.byteCount,
    })
    || empty.sha256.toLowerCase() !== input.authority.empty.sha256.toLowerCase()
    || empty.decodedWidth !== input.authority.empty.decodedWidth
    || empty.decodedHeight !== input.authority.empty.decodedHeight
  ) {
    return { ok: false, status: 409, error: INTEGRITY };
  }
  const size = readPngSize(input.bytes);
  if (!size || size.width !== empty.decodedWidth || size.height !== empty.decodedHeight) {
    return { ok: false, status: 409, error: INTEGRITY };
  }
  let frozenFrame: Readonly<{ width: number; height: number }>;
  let authorityFrame: Readonly<{ width: number; height: number }>;
  try {
    frozenFrame = requireHarmonizePixelFrame(
      input.authority.frozenCamera == null ? undefined : input.authority.frozenCamera.frame,
      "Certified camera frame is missing from the room authority. Export stopped instead of scaling.",
    );
    authorityFrame = requireHarmonizePixelFrame(
      input.authority.frame,
      "Certified camera frame is missing from the room authority. Export stopped instead of scaling.",
    );
  } catch (error) {
    if (error instanceof HarmonizeExportError) {
      return { ok: false, status: 409, error: error.message };
    }
    throw error;
  }
  const frame = decideHarmonizeExportFrame({
    imageWidth: size.width,
    imageHeight: size.height,
    frameWidth: frozenFrame.width,
    frameHeight: frozenFrame.height,
    authorityFrameWidth: authorityFrame.width,
    authorityFrameHeight: authorityFrame.height,
    imageOrientation: input.authority.empty.orientation,
    originalOrientation: input.authority.original?.orientation,
    subject: "empty",
  });
  if (!frame.ok) return { ok: false, status: 409, error: frame.reason };
  return {
    ok: true,
    bytes: Uint8Array.from(input.bytes),
    width: size.width,
    height: size.height,
    sha256: empty.sha256.toLowerCase(),
  };
}
