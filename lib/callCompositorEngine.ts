// lib/callCompositorEngine.ts
import { GoogleAuth } from "google-auth-library";

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

/**
 * IMPORTANT ENV SETUP
 *
 * ✅ For Cloud Run (authenticated):
 *   ROOMPRINTZ_COMPOSITOR_BASE_URL = https://roomprintz-compositor-979735612708.us-west1.run.app
 *   ROOMPRINTZ_COMPOSITOR_SA_KEY   = <full JSON of service account key>
 *
 *   (We will call `${BASE_URL}/stage-room` with an ID token.)
 *
 * ✅ For local / legacy (unauth):
 *   ROOMPRINTZ_COMPOSITOR_URL      = http://localhost:8000/stage-room
 *   ROOMPRINTZ_COMPOSITOR_API_KEY  = optional, if your FastAPI honors it
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
  roomType = null, // NEW
}: CallCompositorArgs): Promise<{
  imageUrl: string;
  originalImageUrl?: string;
}> {
  const baseUrl = process.env.ROOMPRINTZ_COMPOSITOR_BASE_URL?.trim() || null;
  const saKeyJson = process.env.ROOMPRINTZ_COMPOSITOR_SA_KEY;
  const legacyEndpoint = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim() || null;
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

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
    roomType, // NEW
  };

  console.log("[callCompositorEngine] Payload summary:", {
    hasBaseUrl: !!baseUrl,
    hasServiceAccountKey: !!saKeyJson,
    legacyEndpoint,
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
  });

  let data: CompositorResponse | null = null;

  // --------- PREFERRED: Authenticated Cloud Run path ---------
  if (baseUrl && saKeyJson) {
    try {
      const cleanedBaseUrl = baseUrl.replace(/\/$/, "");
      const targetUrl = `${cleanedBaseUrl}/stage-room`;

      const credentials = JSON.parse(saKeyJson);

      const auth = new GoogleAuth({
        credentials,
        scopes: "https://www.googleapis.com/auth/cloud-platform",
      });

      // This client automatically attaches an ID token for the Cloud Run URL
      const client = await auth.getIdTokenClient(cleanedBaseUrl);

      const response = await client.request<CompositorResponse>({
        url: targetUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        data: payload,
      });

      data = response.data;
    } catch (err) {
      console.error(
        "[callCompositorEngine] Authenticated Cloud Run call failed, error:",
        err
      );
      throw new Error("Failed to call authenticated compositor backend");
    }
  } else {
    // --------- FALLBACK: Legacy unauthenticated HTTP path ---------
    if (!legacyEndpoint) {
      throw new Error(
        "No authenticated Cloud Run config (BASE_URL + SA_KEY) and no ROOMPRINTZ_COMPOSITOR_URL fallback set."
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    try {
      const res = await fetch(legacyEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          "[callCompositorEngine] legacy backend error:",
          res.status,
          text
        );
        throw new Error(`Compositor backend error: ${res.status}`);
      }

      data = (await res.json()) as CompositorResponse;
    } catch (err) {
      console.error(
        "[callCompositorEngine] legacy HTTP call failed, error:",
        err
      );
      throw new Error("Failed to call compositor backend (legacy mode)");
    }
  }

  if (!data) {
    throw new Error("Compositor returned no data");
  }

  if (data.error || !data.imageUrl) {
    console.error("[callCompositorEngine] logical error response:", data);
    throw new Error(data.error || "Compositor did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
    originalImageUrl: data.originalImageUrl,
  };
}
