export type ClipboardImageResult = {
  blob: Blob;
  mimeType: string;
};

export type ClipboardReadStatus =
  | "ok"
  | "no-image"
  | "access-unavailable"
  | "read-failed";

export type ReadClipboardImageWithStatusResult = {
  image: ClipboardImageResult | null;
  status: ClipboardReadStatus;
};

function pickClipboardImageType(types: readonly string[]): string | null {
  for (const type of types) {
    if (typeof type === "string" && type.startsWith("image/")) return type;
  }
  return null;
}

function isClipboardAccessUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybeError = err as { name?: unknown; message?: unknown };
  const name = typeof maybeError.name === "string" ? maybeError.name : "";
  const message = typeof maybeError.message === "string" ? maybeError.message.toLowerCase() : "";
  if (name === "NotAllowedError" || name === "SecurityError") return true;
  return (
    message.includes("permission") ||
    message.includes("not allowed") ||
    message.includes("denied") ||
    message.includes("secure context")
  );
}

export async function readClipboardImageWithStatus(): Promise<ReadClipboardImageWithStatusResult> {
  if (typeof navigator === "undefined") return { image: null, status: "access-unavailable" };
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
    return { image: null, status: "access-unavailable" };
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = pickClipboardImageType(item.types ?? []);
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      if (!blob || blob.size <= 0) continue;
      return { image: { blob, mimeType: imageType }, status: "ok" };
    }
    return { image: null, status: "no-image" };
  } catch (err) {
    if (isClipboardAccessUnavailableError(err)) {
      return { image: null, status: "access-unavailable" };
    }
    return { image: null, status: "read-failed" };
  }
}

export async function readClipboardImage(): Promise<ClipboardImageResult | null> {
  const result = await readClipboardImageWithStatus();
  return result.image;
}

export async function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (!blob || blob.size <= 0) return null;
  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      resolve(dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}
