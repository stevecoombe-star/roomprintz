import { createHash } from "node:crypto";

export function staticModelThumbnailSha(assetId: string, glbUrl: string): string | null {
  const id = assetId.trim();
  const url = glbUrl.trim();
  if (!id || !url || id.includes("..") || url.includes("..")) return null;
  return createHash("sha256").update(`${id}\n${url}`).digest("hex");
}
