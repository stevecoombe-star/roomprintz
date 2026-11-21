import "server-only";

import { validateFurnitureAsset } from "@/lib/afc-v2-runtime/furniture-asset-validate";

import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "./asset-id";
import { GENERATION_OUTPUT_MAX_BYTES } from "./generation/policy";
import type { PersonalGlbValidator } from "./store";

export const validatePersonalFurnitureGlb: PersonalGlbValidator = async (input) => {
  return validateGlb(input, PERSONAL_FURNITURE_GLB_MAX_BYTES, "personal-upload.glb");
};

export const validateGeneratedFurnitureGlb: PersonalGlbValidator = async (input) => {
  return validateGlb(input, GENERATION_OUTPUT_MAX_BYTES, "generated-furniture.glb");
};

async function validateGlb(
  input: Parameters<PersonalGlbValidator>[0],
  maxBytes: number,
  glbPath: string,
) {
  const result = await validateFurnitureAsset({
    bytes: input.bytes,
    glbPath,
    assetId: input.assetId,
    dimensionAuthority: "measured",
    maxBytes,
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
}
