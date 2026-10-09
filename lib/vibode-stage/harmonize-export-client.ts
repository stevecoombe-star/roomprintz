import {
  HARMONIZE_EMPTY_PATH,
  HarmonizeExportError,
  buildHarmonizeZip,
  classifyHarmonizeBackground,
  decideHarmonizeExportFrame,
  decodePngRgba,
  harmonizeBackgroundFileName,
  harmonizeBackgroundMediaType,
  readPngSize,
  requireHarmonizePixelFrame,
  sha256HexBytes,
  type HarmonizeBackgroundMediaType,
  type HarmonizeExportAuthority,
  type HarmonizeFurnitureCapturer,
} from "@/lib/vibode-stage/harmonize-export";

export type DecodedHarmonizeBackground = Readonly<{
  rgba: Uint8Array;
  width: number;
  height: number;
  mediaType: HarmonizeBackgroundMediaType;
}>;

export async function fetchHarmonizeEmptyPng(roomId: string): Promise<Uint8Array> {
  const response = await fetch(
    `${HARMONIZE_EMPTY_PATH}?roomId=${encodeURIComponent(roomId)}`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = payload && typeof payload.error === "string" && payload.error.trim()
      ? payload.error
      : "Authoritative EMPTY image is unavailable.";
    throw new HarmonizeExportError(message);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("image/png")) {
    throw new HarmonizeExportError("Authoritative EMPTY image is unavailable.");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function saveHarmonizeZip(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    { type: "application/zip" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function displayedHarmonizeBackgroundUrl(input: Readonly<{
  image: { currentSrc?: string; getAttribute?: (name: string) => string | null } | null;
  fallbackUrl: string | null;
}>): string {
  const current = input.image?.currentSrc?.trim() ?? "";
  if (current) return current;
  const attr = input.image?.getAttribute?.("src")?.trim() ?? "";
  if (attr) return attr;
  return input.fallbackUrl?.trim() ?? "";
}

export async function fetchHarmonizeViewportBackground(url: string): Promise<Uint8Array> {
  const target = url.trim();
  if (!target) {
    throw new HarmonizeExportError("Viewport background image is unavailable.");
  }
  let response: Response;
  try {
    response = await fetch(target, { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new HarmonizeExportError("Viewport background image is unavailable.");
  }
  if (!response.ok) {
    throw new HarmonizeExportError("Viewport background image is unavailable.");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function decodeHarmonizeBackground(
  bytes: Uint8Array,
): Promise<DecodedHarmonizeBackground> {
  const mediaType = harmonizeBackgroundMediaType(bytes);
  if (mediaType === "image/png") {
    const decoded = await decodePngRgba(bytes);
    return {
      rgba: decoded.rgba,
      width: decoded.width,
      height: decoded.height,
      mediaType,
    };
  }
  if (mediaType === "image/jpeg") return decodeJpegDisplayRgba(bytes);
  throw new HarmonizeExportError(
    "Viewport background image cannot be read. Export stopped instead of scaling.",
  );
}

export async function executeHarmonizeExport(input: Readonly<{
  roomId: string;
  authority: HarmonizeExportAuthority;
  backgroundUrl: string;
  originalImageUrl?: string | null;
  captureFurniture: HarmonizeFurnitureCapturer;
  now?: () => Date;
  fetchBackground?: (url: string) => Promise<Uint8Array>;
  decodeBackground?: (bytes: Uint8Array) => Promise<DecodedHarmonizeBackground>;
  fetchEmpty?: (roomId: string) => Promise<Uint8Array>;
  save?: (fileName: string, bytes: Uint8Array) => void;
}>): Promise<void> {
  const fetchBackground = input.fetchBackground ?? fetchHarmonizeViewportBackground;
  const decodeBackground = input.decodeBackground ?? decodeHarmonizeBackground;
  const fetchEmpty = input.fetchEmpty ?? fetchHarmonizeEmptyPng;
  const save = input.save ?? saveHarmonizeZip;
  const backgroundBytes = await fetchBackground(input.backgroundUrl);
  const mediaType = harmonizeBackgroundMediaType(backgroundBytes);
  if (!mediaType) {
    throw new HarmonizeExportError(
      "Viewport background image cannot be read. Export stopped instead of scaling.",
    );
  }
  const sha = await sha256HexBytes(backgroundBytes);
  const identity = classifyHarmonizeBackground({
    sha256: sha,
    emptySha256: input.authority.empty.sha256,
    originalSha256: input.authority.original?.sha256,
    backgroundUrl: input.backgroundUrl,
    originalImageUrl: input.originalImageUrl,
  });
  const room = await decodeBackground(backgroundBytes);
  if (room.mediaType !== mediaType || room.rgba.length !== room.width * room.height * 4) {
    throw new HarmonizeExportError(
      "Viewport background image cannot be read. Export stopped instead of scaling.",
    );
  }
  const imageOrientation = viewportImageOrientation(identity, input.authority, mediaType);
  const frozenFrame = requireHarmonizePixelFrame(
    input.authority.frozenCamera == null ? undefined : input.authority.frozenCamera.frame,
    "Certified camera frame is missing from the room authority. Export stopped instead of scaling.",
  );
  const authorityFrame = requireHarmonizePixelFrame(
    input.authority.frame,
    "Certified camera frame is missing from the room authority. Export stopped instead of scaling.",
  );
  const frame = decideHarmonizeExportFrame({
    imageWidth: room.width,
    imageHeight: room.height,
    imageOrientation,
    subject: "viewport-background",
    frameWidth: frozenFrame.width,
    frameHeight: frozenFrame.height,
    authorityFrameWidth: authorityFrame.width,
    authorityFrameHeight: authorityFrame.height,
  });
  if (!frame.ok) throw new HarmonizeExportError(frame.reason);
  const capture = input.captureFurniture({
    width: frame.width,
    height: frame.height,
    orientation: imageOrientation,
  });
  if (capture == null) {
    throw new HarmonizeExportError("Harmonize export did not produce an image.");
  }
  if (
    capture.width !== frame.width
    || capture.height !== frame.height
    || capture.rgba.length !== room.rgba.length
    || capture.generationId !== input.authority.generationId
  ) {
    throw new HarmonizeExportError(
      "Furniture render size does not match the viewport background. Export stopped instead of scaling.",
    );
  }
  const referenceEmptyBytes = identity.source === "empty"
    ? null
    : await readOptionalEmptyReference(input.roomId, input.authority, fetchEmpty);
  const packed = await buildHarmonizeZip({
    roomId: input.roomId,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    generationId: input.authority.generationId,
    background: {
      bytes: backgroundBytes,
      fileName: harmonizeBackgroundFileName({ source: identity.source, mediaType }),
      role: identity.source === "empty" ? "authoritative-empty" : "viewport-background",
      source: identity.source,
      matchesEmpty: identity.matchesEmpty,
      matchesOriginal: identity.matchesOriginal,
    },
    roomRgba: room.rgba,
    capture,
    alignment: frame,
    referenceEmptyBytes,
  });
  save(packed.fileName, packed.bytes);
}

function viewportImageOrientation(
  identity: Readonly<{ matchesEmpty: boolean; matchesOriginal: boolean }>,
  authority: HarmonizeExportAuthority,
  mediaType: HarmonizeBackgroundMediaType,
): number {
  if (mediaType === "image/jpeg") return 1;
  if (identity.matchesEmpty) return authority.empty.orientation ?? 1;
  if (identity.matchesOriginal) return authority.original?.orientation ?? 1;
  return 1;
}

async function readOptionalEmptyReference(
  roomId: string,
  authority: HarmonizeExportAuthority,
  fetchEmpty: (roomId: string) => Promise<Uint8Array>,
): Promise<Uint8Array | null> {
  try {
    const bytes = await fetchEmpty(roomId);
    const sha = await sha256HexBytes(bytes);
    const size = readPngSize(bytes);
    if (
      !/^[0-9a-f]{64}$/i.test(authority.empty.sha256)
      || sha !== authority.empty.sha256.toLowerCase()
      || !size
      || size.width !== authority.empty.decodedWidth
      || size.height !== authority.empty.decodedHeight
    ) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

async function decodeJpegDisplayRgba(bytes: Uint8Array): Promise<DecodedHarmonizeBackground> {
  try {
    const createImageBitmap = globalThis.createImageBitmap;
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
      throw new HarmonizeExportError(
        "Viewport background image cannot be read. Export stopped instead of scaling.",
      );
    }
    const blob = new Blob([
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ], { type: "image/jpeg" });
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new HarmonizeExportError(
          "Viewport background image cannot be read. Export stopped instead of scaling.",
        );
      }
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      return {
        rgba: new Uint8Array(image.data),
        width: bitmap.width,
        height: bitmap.height,
        mediaType: "image/jpeg",
      };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (error instanceof HarmonizeExportError) throw error;
    throw new HarmonizeExportError(
      "Viewport background image cannot be read. Export stopped instead of scaling.",
    );
  }
}
