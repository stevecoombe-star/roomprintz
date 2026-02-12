type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";

export type VibodeComposePlacement = {
  nodeId: string;
  skuId?: string | null;
  skuImageBytes: Buffer;
  cxPx: number;
  cyPx: number;
  rPx?: number | null;
  /** z-order: higher = in front. Required for compositor stacking. */
  zIndex: number;
  /** Optional layer kind for debugging. */
  layerKind?: string;
};

type VibodeComposeResponse = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
};

export async function callCompositorVibodeCompose(args: {
  roomImageBytes: Buffer;
  placements: VibodeComposePlacement[];
  enhancePhoto?: boolean;
  modelVersion?: string | null;
  aspectRatio?: AspectRatio;
}): Promise<{ imageUrl: string; appliedAspectRatio?: string | null }> {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();

  if (!endpointBase) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }

  const endpointBaseNormalized = endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/$/, "");
  const endpoint = `${endpointBaseNormalized}/vibode/compose`;
  const { roomImageBytes, placements, enhancePhoto, modelVersion, aspectRatio } =
    args;

  console.log("[callCompositorVibodeCompose] request", {
    placements: placements.length,
  });

  const payload = {
    roomImageBase64: roomImageBytes.toString("base64"),
    placements: placements.map((placement) => ({
      nodeId: placement.nodeId,
      skuId: placement.skuId ?? null,
      skuImageBase64: placement.skuImageBytes.toString("base64"),
      cxPx: placement.cxPx,
      cyPx: placement.cyPx,
      rPx: placement.rPx ?? null,
      zIndex: placement.zIndex,
      ...(placement.layerKind ? { layerKind: placement.layerKind } : {}),
    })),
    enhancePhoto: enhancePhoto ?? false,
    modelVersion,
    aspectRatio,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log("[callCompositorVibodeCompose] response", {
    status: res.status,
    placements: placements.length,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Compositor backend error: ${res.status} ${text}`.trim()
    );
  }

  const data = (await res.json()) as VibodeComposeResponse;

  return {
    imageUrl: data.imageUrl,
    appliedAspectRatio: data.appliedAspectRatio ?? null,
  };
}
