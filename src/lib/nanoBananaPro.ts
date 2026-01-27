// src/lib/nanoBananaPro.ts
export type NanoBananaResult =
  | { kind: "url"; url: string }
  | { kind: "base64"; base64: string; mime?: string };

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * Calls Nano Banana Pro with:
 * - base image (public URL) OR base64
 * - prompt (string)
 *
 * Supports common response shapes:
 * - { imageUrl: "https://..." }
 * - { url: "https://..." }
 * - { image_base64: "..." } or { base64: "..." }
 * - raw image bytes (content-type image/*)
 */
export async function callNanoBananaPro(args: {
  baseImageUrl: string;
  prompt: string;
  // Optional knobs if your endpoint supports them
  aspectRatio?: string;
  seed?: number;
}): Promise<NanoBananaResult> {
  const endpoint = requireEnv("NANOBANANA_PRO_URL");
  const apiKey = requireEnv("NANOBANANA_PRO_API_KEY");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      base_image_url: args.baseImageUrl,
      prompt: args.prompt,
      aspect_ratio: args.aspectRatio,
      seed: args.seed,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NanoBananaPro ${res.status}: ${text || "Request failed"}`);
  }

  const contentType = res.headers.get("content-type") || "";

  // If it literally returns image bytes
  if (contentType.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { kind: "base64", base64: buf.toString("base64"), mime: contentType };
  }

  // Otherwise assume JSON
  const j: any = await res.json().catch(() => ({}));

  const url = j?.imageUrl || j?.image_url || j?.url;
  if (typeof url === "string" && url.startsWith("http")) {
    return { kind: "url", url };
  }

  const b64 = j?.image_base64 || j?.base64 || j?.imageBase64;
  if (typeof b64 === "string" && b64.length > 100) {
    return { kind: "base64", base64: b64, mime: j?.mime || j?.contentType };
  }

  throw new Error(`NanoBananaPro: Unrecognized response shape`);
}
