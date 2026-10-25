import { mergeVibodeCompositorAuth } from "./vibodeCompositorAuth";

type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";

export type VibodeEligibleSku = {
  skuId: string;
  label?: string | null;
  defaultPxWidth?: number | null;
  defaultPxHeight?: number | null;
  realWidthFt?: number | null;
  realDepthFt?: number | null;
  variants?: Array<Record<string, unknown>> | null;
};

export async function callCompositorVibodeVibe(args: {
  roomImageBase64: string;
  collectionId?: string | null;
  bundleId?: string | null; // allow "small"/"medium"/"large" or any string
  eligibleSkus: VibodeEligibleSku[];
  targetCount?: number;
  enhancePhoto?: boolean;
  modelVersion?: string | null;
  aspectRatio?: AspectRatio | string | null;
}) {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
  if (!endpointBase) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }

  const endpointBaseNormalized = endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/vibode\/compose\/?$/, "")
    .replace(/\/vibode\/remove\/?$/, "")
    .replace(/\/vibode\/swap\/?$/, "")
    .replace(/\/vibode\/vibe\/?$/, "")
    .replace(/\/vibode\/rotate\/?$/, "")
    .replace(/\/vibode\/full_vibe\/?$/, "")
    .replace(/\/$/, "");
  const endpoint = `${endpointBaseNormalized}/vibode/vibe`;
  const headers = mergeVibodeCompositorAuth({ "Content-Type": "application/json" });

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      roomImageBase64: args.roomImageBase64,
      collectionId: args.collectionId ?? undefined,
      bundleId: args.bundleId ?? undefined,
      eligibleSkus: args.eligibleSkus,
      targetCount: Number.isFinite(args.targetCount) ? args.targetCount : undefined,
      enhancePhoto: args.enhancePhoto ?? true,
      modelVersion: args.modelVersion ?? undefined,
      aspectRatio: args.aspectRatio ?? "auto",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vibode vibe failed: ${res.status} ${text}`);
  }

  return res.json();
}
