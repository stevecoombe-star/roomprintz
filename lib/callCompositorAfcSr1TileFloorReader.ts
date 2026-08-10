import "server-only";

export const AFC_SR1_TR2_TILE_FLOOR_READER_PATH =
  "/api/research/afc-sr1/tile-floor-vanishing-line" as const;

function compositorBaseUrl(): string {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
  if (!endpointBase) {
    throw new Error("ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint).");
  }
  return endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/api\/vibode\/stage-run\/?$/, "")
    .replace(/\/vibode\/stage-run\/?$/, "")
    .replace(/\/vibode\/compose\/?$/, "")
    .replace(/\/$/, "");
}

export async function callCompositorAfcSr1TileFloorReader(args: {
  payload: unknown;
  signal?: AbortSignal;
}): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${compositorBaseUrl()}${AFC_SR1_TR2_TILE_FLOOR_READER_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args.payload),
    signal: args.signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Compositor backend error (AFC-SR1 TR2 reader): ${response.status} ${text}`.trim());
  }
  return response.json();
}
