import { VIBODE_MODEL_THUMBNAIL_ASSET_HEADER } from "./policy";

export const PARTNER_MODEL_THUMBNAIL_SOURCE_ROUTE = "/api/vibode/partner/model-thumbnails/source";

export const PARTNER_MODEL_THUMBNAIL_ROUTE = "/api/vibode/partner/model-thumbnails";

export type GenerateModelThumbnailResult =
  | Readonly<{ ok: true; thumbnailUrl: string | null }>
  | Readonly<{ ok: false; message: string }>;

export type MissingThumbnailProgress = Readonly<{
  index: number;
  total: number;
  assetId: string;
}>;

let tail: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run);
  tail = result.then(() => undefined, () => undefined);
  return result;
}

async function fetchOwnedModelGlb(assetId: string): Promise<ArrayBuffer> {
  const response = await fetch(PARTNER_MODEL_THUMBNAIL_SOURCE_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId }),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("model/gltf-binary")) {
    throw new Error("Model file could not be loaded.");
  }
  return response.arrayBuffer();
}

async function saveThumbnail(assetId: string, png: Blob): Promise<GenerateModelThumbnailResult> {
  const response = await fetch(PARTNER_MODEL_THUMBNAIL_ROUTE, {
    method: "POST",
    headers: {
      "content-type": png.type || "image/png",
      [VIBODE_MODEL_THUMBNAIL_ASSET_HEADER]: assetId,
    },
    body: png,
  });
  let body: { ok?: unknown; thumbnailUrl?: unknown } = {};
  try {
    body = await response.json() as { ok?: unknown; thumbnailUrl?: unknown };
  } catch {
    body = {};
  }
  if (!response.ok || body.ok !== true) {
    return { ok: false, message: "Thumbnail could not be saved." };
  }
  return {
    ok: true,
    thumbnailUrl: typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : null,
  };
}

async function generateOne(input: Readonly<{
  assetId: string;
  glbBytes?: ArrayBuffer;
}>): Promise<GenerateModelThumbnailResult> {
  const assetId = input.assetId.trim();
  if (!assetId) return { ok: false, message: "Thumbnail could not be created." };
  try {
    const glb = input.glbBytes ?? await fetchOwnedModelGlb(assetId);
    const { renderModelThumbnailPng } = await import("./render-browser");
    const png = await renderModelThumbnailPng(glb);
    return await saveThumbnail(assetId, png);
  } catch {
    return { ok: false, message: "Thumbnail could not be created." };
  }
}

export function generatePartnerModelThumbnail(input: Readonly<{
  assetId: string;
  glbBytes?: ArrayBuffer;
}>): Promise<GenerateModelThumbnailResult> {
  return enqueue(() => generateOne(input));
}

export function generateMissingPartnerModelThumbnails(input: Readonly<{
  assetIds: readonly string[];
  onProgress?: (progress: MissingThumbnailProgress) => void;
}>): Promise<Readonly<{
  completed: number;
  failed: number;
  urls: Readonly<Record<string, string>>;
}>> {
  return enqueue(async () => {
    const urls: Record<string, string> = {};
    let completed = 0;
    let failed = 0;
    const assetIds = input.assetIds.filter((assetId) => assetId.trim().length > 0);
    for (let index = 0; index < assetIds.length; index += 1) {
      const assetId = assetIds[index]!;
      input.onProgress?.({ index: index + 1, total: assetIds.length, assetId });
      const result = await generateOne({ assetId });
      if (result.ok) {
        completed += 1;
        if (result.thumbnailUrl) urls[assetId] = result.thumbnailUrl;
      } else {
        failed += 1;
      }
    }
    return { completed, failed, urls };
  });
}
