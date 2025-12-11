// lib/callCompositorEngine.ts

type ModelVersion = "gemini-3" | "gemini-2.5";

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
  roomType?: string | null;
  modelVersion?: ModelVersion; // NEW
};

type CompositorResponse = {
  imageUrl?: string;
  originalImageUrl?: string;
  error?: string;
};

/**
 * CURRENT ENV EXPECTATIONS (Railway / FastAPI)
 *
 * ROOMPRINTZ_COMPOSITOR_URL     = https://roomprintz-compositor-production.up.railway.app/stage-room
 * ROOMPRINTZ_COMPOSITOR_API_KEY = <shared secret, optional>
 *
 * We send a JSON payload with the base64 image + all flags
 * directly to that URL using a simple Bearer token if provided.
 */

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
  roomType = null,
  modelVersion = "gemini-3", // NEW: default to Gemini 3 (Nano Banana Pro)
}: CallCompositorArgs): Promise<{
  imageUrl: string;
  originalImageUrl?: string;
}> {
  const endpoint = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  if (!endpoint) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }

  const imageBase64 = imageBytes.toString("base64");

  const payload = {
    imageBase64,
    styleId,
    enhancePhoto,
    cleanupRoom,
    repairDamage,
    emptyRoom,
    renovateRoom,
    repaintWalls,
    flooringPreset,
    roomType,
    modelVersion, // NEW
  };

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
    roomType,
    modelVersion, // NEW
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Optional shared secret for Railway / FastAPI
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[callCompositorEngine] backend error:", res.status, text);
    throw new Error(`Compositor backend error: ${res.status}`);
  }

  const data = (await res.json()) as CompositorResponse;

  if (data.error || !data.imageUrl) {
    console.error("[callCompositorEngine] logical error response:", data);
    throw new Error(data.error || "Compositor did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
    originalImageUrl: data.originalImageUrl,
  };
}
