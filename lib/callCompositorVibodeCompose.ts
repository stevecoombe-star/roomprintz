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
  telemetry?: {
    requestId?: string | null;
    imageCount?: number | null;
    skuCount?: number | null;
    promptChars?: number | null;
    promptHash?: string | null;
    placementsCount?: number | null;
    cleanSize?: string | null;
    markedSize?: string | null;
    sizesMatch?: boolean | null;
    route?: string | null;
  };
  signal?: AbortSignal;
  headers?: Record<string, string>;
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
  const { roomImageBytes, placements, enhancePhoto, modelVersion, aspectRatio, signal } = args;
  const requestId =
    args.telemetry?.requestId ??
    args.headers?.["x-vibode-request-id"] ??
    args.headers?.["X-Vibode-Request-Id"] ??
    null;
  const modelName = modelVersion ?? null;
  const imageCount = args.telemetry?.imageCount ?? null;
  const skuCount = args.telemetry?.skuCount ?? null;
  const placementsCount = args.telemetry?.placementsCount ?? placements.length;
  const route = args.telemetry?.route ?? "/vibode/compose";
  const startedAt = Date.now();

  console.info("[vibode/compose]", {
    event: "model_call_start",
    request_id: requestId,
    route,
    model_name: modelName,
    image_count: imageCount,
    sku_count: skuCount,
    placements_count: placementsCount,
    clean_size: args.telemetry?.cleanSize ?? null,
    marked_size: args.telemetry?.markedSize ?? null,
    sizes_match: args.telemetry?.sizesMatch ?? null,
    prompt_chars: args.telemetry?.promptChars ?? null,
    prompt_hash: args.telemetry?.promptHash ?? null,
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
      ...(args.headers ?? {}),
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[vibode/compose]", {
      event: "model_call_error",
      request_id: requestId,
      route,
      model_name: modelName,
      image_count: imageCount,
      sku_count: skuCount,
      status: res.status,
      elapsed_ms: Date.now() - startedAt,
    });
    throw new Error(
      `Compositor backend error: ${res.status} ${text}`.trim()
    );
  }

  const data = (await res.json()) as VibodeComposeResponse;

  console.info("[vibode/compose]", {
    event: "model_call_success",
    request_id: requestId,
    route,
    model_name: modelName,
    image_count: imageCount,
    sku_count: skuCount,
    status: res.status,
    elapsed_ms: Date.now() - startedAt,
  });

  return {
    imageUrl: data.imageUrl,
    appliedAspectRatio: data.appliedAspectRatio ?? null,
  };
}
