export type ClipboardImageResult = {
  blob: Blob;
  mimeType: string;
};

function pickClipboardImageType(types: readonly string[]): string | null {
  for (const type of types) {
    if (typeof type === "string" && type.startsWith("image/")) return type;
  }
  return null;
}

export async function readClipboardImage(): Promise<ClipboardImageResult | null> {
  if (typeof navigator === "undefined") return null;
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") return null;

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = pickClipboardImageType(item.types ?? []);
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      if (!blob || blob.size <= 0) continue;
      return { blob, mimeType: imageType };
    }
    return null;
  } catch {
    return null;
  }
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
