type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function safeStr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function pickImageUrl(data: unknown): string | null {
  if (!isRecord(data)) return null;

  const direct = safeStr(data.imageUrl);
  if (direct) return direct;

  const staged = safeStr(data.stagedImageUrl);
  if (staged) return staged;

  if (!isRecord(data.output)) return null;
  return safeStr(data.output.imageUrl);
}

export async function callCompositorVibodeFullVibe(args: {
  payload: unknown;
}): Promise<{ imageUrl: string }> {
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
  const endpoint = `${endpointBaseNormalized}/vibode/full_vibe`;
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(args.payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Compositor backend error (full_vibe): ${res.status} ${text}`.trim());
  }

  const data = (await res.json()) as unknown;
  const imageUrl = pickImageUrl(data);
  if (!imageUrl) {
    throw new Error("Compositor full_vibe did not return imageUrl");
  }

  return { imageUrl };
}
