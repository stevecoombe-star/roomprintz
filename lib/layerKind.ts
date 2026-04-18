// lib/layerKind.ts
// ==============================
// Layer kind + z-order contract for Vibode multi-node placement.
// Higher zIndex = in front. Defaults ensure deterministic stacking (rug under furniture, etc.).
// ==============================

export type LayerKind =
  | "rug"
  | "floor_furniture"
  | "decor_floor"
  | "lighting_floor"
  | "wall_art"
  | "lighting_ceiling";

/**
 * Default zIndex by layer kind. Higher = in front.
 * Used when backfilling nodes missing zIndex.
 */
export const DEFAULT_ZINDEX_BY_LAYER_KIND: Record<LayerKind, number> = {
  rug: 0,
  floor_furniture: 10,
  decor_floor: 20,
  lighting_floor: 20,
  wall_art: 30,
  lighting_ceiling: 30,
} as const;

/**
 * zIndex bands: [base, max] per band. Semantic layering with predictable stacking.
 * rug: 0-9
 * floor_furniture: 10-19
 * decor_floor + lighting_floor: 20-29
 * wall_art + lighting_ceiling: 30-39
 */
export const ZINDEX_BAND_BY_LAYER_KIND: Record<LayerKind, { base: number; max: number }> = {
  rug: { base: 0, max: 9 },
  floor_furniture: { base: 10, max: 19 },
  decor_floor: { base: 20, max: 29 },
  lighting_floor: { base: 20, max: 29 },
  wall_art: { base: 30, max: 39 },
  lighting_ceiling: { base: 30, max: 39 },
} as const;

/**
 * Infer LayerKind from SKU metadata. If unavailable, returns "floor_furniture".
 */
export function inferLayerKindFromSkuKind(skuKind?: string | null): LayerKind {
  if (!skuKind) return "floor_furniture";
  const k = skuKind.toLowerCase();
  if (k === "rug") return "rug";
  if (k === "floor_lamp") return "lighting_floor";
  if (
    [
      "sofa",
      "loveseat",
      "armchair",
      "dining_table",
      "dining_chair",
      "coffee_table",
      "side_table",
      "bed",
    ].includes(k)
  ) {
    return "floor_furniture";
  }
  // Fallback heuristics from label/skuId (used when SKU not in catalog)
  if (/\brug\b/.test(k)) return "rug";
  if (/\bceiling\b|\bpendant\b/.test(k)) return "lighting_ceiling";
  if (/\bwall\b|\bart\b|\bposter\b|\bmirror\b/.test(k)) return "wall_art";
  if (/\blamp\b|\blighting\b/.test(k)) return "lighting_floor";
  if (/\bdecor\b|\bvase\b|\bplant\b/.test(k)) return "decor_floor";
  return "floor_furniture";
}

/**
 * Infer LayerKind from free text (label, skuId, etc.) using regex heuristics.
 * Use this for label/skuId fallback; use inferLayerKindFromSkuKind for structured SKU-kind strings.
 */
export function inferLayerKindFromText(text?: string | null): LayerKind {
  if (!text) return "floor_furniture";
  const t = text.toLowerCase();
  if (/\brug\b/.test(t)) return "rug";
  if (/\bceiling\b|\bpendant\b/.test(t)) return "lighting_ceiling";
  if (/\bwall\b|\bart\b|\bposter\b|\bmirror\b/.test(t)) return "wall_art";
  if (/\bfloor_lamp\b|\bfloor lamp\b/.test(t)) return "lighting_floor";
  if (/\blamp\b|\blighting\b/.test(t)) return "lighting_floor";
  if (/\bdecor\b|\bvase\b|\bplant\b/.test(t)) return "decor_floor";
  return "floor_furniture";
}

/**
 * Get zIndex for a node, backfilling from layerKind if missing.
 */
export function ensureZIndex(
  layerKind: LayerKind,
  existingZIndex?: number | null
): number {
  if (typeof existingZIndex === "number" && Number.isFinite(existingZIndex)) {
    return existingZIndex;
  }
  return DEFAULT_ZINDEX_BY_LAYER_KIND[layerKind];
}

/**
 * Infer LayerKind from node category (for backfill when layerKind is missing).
 */
export function inferLayerKindFromCategory(
  category: string | undefined
): LayerKind {
  if (!category) return "floor_furniture";
  const c = category.toLowerCase();
  if (c === "rug") return "rug";
  if (c === "lamp_floor") return "lighting_floor";
  if (c === "lamp_table") return "decor_floor";
  return "floor_furniture";
}

/**
 * Infer LayerKind from node fields when layerKind is missing.
 */
export function inferLayerKindFromNode(node: {
  layerKind?: LayerKind;
  label?: string;
  skuId?: string;
}): LayerKind {
  if (node.layerKind) return node.layerKind;
  return inferLayerKindFromText(node.label ?? node.skuId ?? null);
}

export type NodeWithZIndex = {
  layerKind?: LayerKind;
  zIndex: number;
  label?: string;
  skuId?: string;
};

/**
 * Get next zIndex in band for given layerKind.
 * Preserves semantic layering; new nodes stack in front of existing nodes in same band.
 */
export function getNextZIndexForLayer(
  nodes: NodeWithZIndex[],
  layerKind: LayerKind
): number {
  const { base } = ZINDEX_BAND_BY_LAYER_KIND[layerKind];
  let maxInBand = base - 1;
  for (const n of nodes) {
    const nodeLayerKind = inferLayerKindFromNode(n);
    const nodeBand = ZINDEX_BAND_BY_LAYER_KIND[nodeLayerKind];
    if (nodeBand.base === base && n.zIndex > maxInBand) {
      maxInBand = n.zIndex;
    }
  }
  return Math.max(base, maxInBand + 1);
}
