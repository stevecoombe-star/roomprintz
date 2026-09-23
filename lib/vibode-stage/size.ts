import {
  AFC_V2_USER_SIZE_DEFAULT,
  AFC_V2_USER_SIZE_MAX,
  AFC_V2_USER_SIZE_MIN,
  clampUserSizeMultiplier,
} from "@/lib/afc-v2-runtime/types";

export const STAGE_SIZE_MIN = AFC_V2_USER_SIZE_MIN;
export const STAGE_SIZE_MAX = AFC_V2_USER_SIZE_MAX;
export const STAGE_SIZE_DEFAULT = AFC_V2_USER_SIZE_DEFAULT;

export function formatSizePercent(multiplier: number): string {
  return `${Math.round(clampUserSizeMultiplier(multiplier) * 100)}%`;
}

export function sizeSliderValue(multiplier: number): number {
  return clampUserSizeMultiplier(multiplier);
}

export function isAuthoredSize(multiplier: number): boolean {
  return Math.abs(clampUserSizeMultiplier(multiplier) - STAGE_SIZE_DEFAULT) < 1e-4;
}
