import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";

const STATIC_GLB_PATH = /^\/afc-v2-runtime\/[A-Za-z0-9._/-]+\.glb$/;

export function isStaticModelGlbUrl(value: string): boolean {
  return STATIC_GLB_PATH.test(value) && !value.includes("..");
}

export function staticGlbUrlForAsset(assetId: string): string | null {
  const glbUrl = furnitureAssetDefinition(assetId)?.glbUrl ?? "";
  return isStaticModelGlbUrl(glbUrl) ? glbUrl : null;
}

export function isGlbBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46;
}
