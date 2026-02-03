// lib/freezePayloadV2SceneHash.ts
// ==============================
// Build a deterministic sceneHash for FreezePayloadV2
// - Stable node ordering
// - Hash only "truth" subset fields
// ==============================

import type { FreezePayloadV2, NodePayloadV2 } from "./freezePayloadV2Types";
import { canonicalStringify, sha256Hex } from "./sceneHash";

export function stableNodeSort(a: NodePayloadV2, b: NodePayloadV2): number {
  // Deterministic ordering: zIndex then nodeId
  if (a.transform.zIndex !== b.transform.zIndex) {
    return a.transform.zIndex - b.transform.zIndex;
  }
  return a.nodeId.localeCompare(b.nodeId);
}

/**
 * Build a stable hash of the "truth" of a V2 scene.
 * We intentionally hash only:
 * - base image reference (storageKey + dims)
 * - calibration.pxPerIn (+ method)
 * - staging spec (including locks)
 * - nodes: identity + footprint + transform + intent
 *
 * We do NOT hash ephemeral things like signed URLs or debug metadata.
 */
export async function buildFreezePayloadV2SceneHash(
  payload: Omit<FreezePayloadV2, "sceneHash" | "seed">
): Promise<string> {
  const nodesSorted = [...payload.nodes].sort(stableNodeSort);

  const hashSubset = {
    payloadVersion: payload.payloadVersion,

    baseImage: {
      storageKey: payload.baseImage.storageKey ?? null,
      widthPx: payload.baseImage.widthPx ?? null,
      heightPx: payload.baseImage.heightPx ?? null,
    },

    calibration: {
      pxPerIn: payload.calibration.pxPerIn,
      method: payload.calibration.method ?? null,
    },

    staging: payload.staging,

    nodes: nodesSorted.map((n) => ({
      nodeId: n.nodeId,
      sku: {
        skuId: n.sku.skuId,
        vendor: n.sku.vendor ?? null,
        productKey: n.sku.productKey ?? null,
        variant: n.sku.variant ?? null,
        imageKey: n.sku.imageKey ?? null,
      },
      footprintIn: n.footprintIn,
      transform: n.transform,
      intent: n.intent,
    })),
  } as const;

  const s = canonicalStringify(hashSubset as any);
  return sha256Hex(s);
}
