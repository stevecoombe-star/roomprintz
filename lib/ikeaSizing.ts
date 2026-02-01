// lib/ikeaSizing.ts
export const DEFAULT_PX_PER_IN = 6; // v0 constant

export type IkeaDimsIn = {
  width: number;
  depth?: number;
  height?: number;
  diameter?: number;
};

export function skuFootprintInchesFromDims(dimsIn: IkeaDimsIn): { wIn: number; dIn: number } {
  const wIn = dimsIn.diameter ?? dimsIn.width;
  const dIn = dimsIn.depth ?? dimsIn.width;
  return { wIn, dIn };
}
