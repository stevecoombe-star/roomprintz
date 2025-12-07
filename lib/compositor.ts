// lib/compositor.ts

/**
 * Shape of what we expect back from the compositor.
 * You can expand this later with metadata, timings, etc.
 */
export type CompositorResponse = {
  imageUrl: string; // public or relative URL to the staged result
};

/**
 * Call your PetPrintz / RoomPrintz Compositor Engine (Nano Banana pipeline).
 *
 * For now, this is written as a generic HTTP call that:
 *  - takes a Blob (image file)
 *  - encodes it as base64
 *  - sends it plus the styleId to your compositor API
 *  - returns a URL to the staged image
 *
 * You will replace the FETCH URL + BODY SHAPE with your real pipeline details.
 */
export async function callCompositorEngine(
  file: Blob,
  styleId: string
): Promise<CompositorResponse> {
  // 1️⃣ Read the file into an ArrayBuffer and then to base64
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64Image = buffer.toString("base64");

  // 2️⃣ Read endpoint + API key from env (set these in .env.local)
  const endpoint = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  // 🔍 TEMP debug logs
  console.log("[compositor] endpoint:", endpoint);
  console.log("[compositor] apiKey present:", !!apiKey);

  if (!endpoint) {
    throw new Error("Missing ROOMPRINTZ_COMPOSITOR_URL in environment");
  }

  if (!apiKey) {
    throw new Error("Missing ROOMPRINTZ_COMPOSITOR_API_KEY in environment");
  }

  // 3️⃣ Build the request payload
  //    THIS is where you'll align with whatever your Nano Banana pipeline expects.
  //    For example, if your pipeline expects:
  //      { imageBase64: string, styleId: string }
  //    This structure is perfect; otherwise, adjust keys/shape.
  const payload = {
    imageBase64: base64Image,
    styleId,
  };

  // 4️⃣ Make the HTTP call to your compositor backend (Node / Colab / Cloud Run / etc.)
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`, // adjust if your pipeline uses a different auth scheme
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[callCompositorEngine] Non-OK response:", response.status, text);
    throw new Error(`Compositor API error: ${response.status}`);
  }

  // 5️⃣ Expect a JSON response with { imageUrl: string }
  //    If your pipeline returns raw bytes instead, we’ll handle that differently later.
  const data = (await response.json()) as { imageUrl?: string };

  if (!data.imageUrl) {
    throw new Error("Compositor API did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
  };
}
