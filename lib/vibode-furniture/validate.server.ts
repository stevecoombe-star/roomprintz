import "server-only";

import { validateFurnitureAsset } from "@/lib/afc-v2-runtime/furniture-asset-validate";

import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "./asset-id";
import type { PersonalGlbValidator } from "./store";

export const validatePersonalFurnitureGlb: PersonalGlbValidator = async (input) => {
  const result = await validateFurnitureAsset({
    bytes: input.bytes,
    glbPath: "personal-upload.glb",
    assetId: input.assetId,
    dimensionAuthority: "measured",
    maxBytes: PERSONAL_FURNITURE_GLB_MAX_BYTES,
  });
  return {
    accepted: result.accepted,
    sha256: result.sha256,
    byteSize: result.fileSizeBytes,
    widthM: result.measured?.widthM ?? null,
    heightM: result.measured?.heightM ?? null,
    depthM: result.measured?.depthM ?? null,
    errors: result.errors,
  };
};
