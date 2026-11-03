/**
 * Load a room image and its SHA-256 without resampling.
 * Pixel reads stay at the decoded bitmap size.
 */

export type LoadedBringForwardImage = Readonly<{
  sha256: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray | null;
}>;

export async function loadBringForwardImage(
  url: string,
  signal: AbortSignal,
  readPixels: boolean,
): Promise<LoadedBringForwardImage | null> {
  if (signal.aborted || url.trim().length === 0) return null;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return null;
  }
  if (!response.ok || signal.aborted) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type && !type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted || bytes.byteLength === 0) return null;
  let sha256: string;
  try {
    sha256 = await sha256Hex(bytes);
  } catch {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: type || "image/jpeg" }));
  } catch {
    return null;
  }
  try {
    if (signal.aborted || bitmap.width < 1 || bitmap.height < 1) return null;
    const rgba = readPixels ? imageRgba(bitmap) : null;
    if (readPixels && !rgba) return null;
    return { sha256, width: bitmap.width, height: bitmap.height, rgba };
  } finally {
    bitmap.close();
  }
}

function imageRgba(bitmap: ImageBitmap): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  let rgba: Uint8ClampedArray | null = null;
  try {
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    rgba = new Uint8ClampedArray(data);
  } catch {
    rgba = null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  return rgba;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  let hex = "";
  for (const value of new Uint8Array(digest)) {
    hex += value.toString(16).padStart(2, "0");
  }
  return hex;
}
