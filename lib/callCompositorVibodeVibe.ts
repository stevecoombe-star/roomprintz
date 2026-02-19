type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";

export type VibodeEligibleSku = {
  skuId: string;
  label?: string | null;
  defaultPxWidth?: number | null;
  defaultPxHeight?: number | null;
  realWidthFt?: number | null;
  realDepthFt?: number | null;
  variants?: Array<Record<string, any>> | null;
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
  const compositorBaseUrl =
    process.env.COMPOSITOR_URL ||
    process.env.NEXT_PUBLIC_COMPOSITOR_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:8000" : "");

  if (!compositorBaseUrl) {
    throw new Error("Missing COMPOSITOR_URL (or NEXT_PUBLIC_COMPOSITOR_URL) for Vibode compositor.");
  }

  const res = await fetch(`${compositorBaseUrl}/vibode/vibe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
