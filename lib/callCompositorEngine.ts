// lib/callCompositorEngine.ts

type CallCompositorArgs = {
  imageBytes: Buffer;
  styleId?: string | null;
  enhancePhoto?: boolean;
  cleanupRoom?: boolean;
  repairDamage?: boolean;
  emptyRoom?: boolean;
  renovateRoom?: boolean;
  repaintWalls?: boolean;
  flooringPreset?: string | null;
  roomType?: string | null; // NEW
};

type CompositorResponse = {
  imageUrl?: string;
  originalImageUrl?: string;
  error?: string;
};

export async function callCompositorEngine({
  imageBytes,
  styleId = null,
  enhancePhoto = false,
  cleanupRoom = false,
  repairDamage = false,
  emptyRoom = false,
  renovateRoom = false,
  repaintWalls = false,
  flooringPreset = null,
  roomType = null, // NEW
}: CallCompositorArgs): Promise<{
  imageUrl: string;
  originalImageUrl?: string;
}> {
  const endpoint = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  if (!endpoint) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in .env.local (RoomPrintz compositor endpoint)."
    );
  }

  const imageBase64 = imageBytes.toString("base64");

  console.log("[callCompositorEngine] Calling compositor at:", endpoint, {
    styleId: styleId ?? "(none)",
    payloadSize: imageBase64.length,
    enhancePhoto,
    cleanupRoom,
    repairDamage,
    emptyRoom,
    renovateRoom,
    repaintWalls,
    flooringPreset,
    roomType, // NEW
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body = JSON.stringify({
    imageBase64,
    styleId,
    enhancePhoto,
    cleanupRoom,
    repairDamage,
    emptyRoom,
    renovateRoom,
    repaintWalls,
    flooringPreset,
    roomType, // NEW
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[callCompositorEngine] backend error:", res.status, text);
    throw new Error(`Compositor backend error: ${res.status}`);
  }

  const data = (await res.json()) as CompositorResponse;

  if (data.error || !data.imageUrl) {
    throw new Error(data.error || "Compositor did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
    originalImageUrl: data.originalImageUrl,
  };
}
