type VibodeStageRunResponse = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
};

export async function callCompositorVibodeStageRun(args: {
  payload: unknown;
}): Promise<VibodeStageRunResponse> {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();

  if (!endpointBase) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }

  const endpointBaseNormalized = endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/api\/vibode\/stage-run\/?$/, "")
    .replace(/\/vibode\/stage-run\/?$/, "")
    .replace(/\/vibode\/compose\/?$/, "")
    .replace(/\/vibode\/remove\/?$/, "")
    .replace(/\/vibode\/swap\/?$/, "")
    .replace(/\/vibode\/rotate\/?$/, "")
    .replace(/\/vibode\/full_vibe\/?$/, "")
    .replace(/\/$/, "");
  const endpoint = `${endpointBaseNormalized}/api/vibode/stage-run`;
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
    throw new Error(`Compositor backend error (stage-run): ${res.status} ${text}`.trim());
  }

  const data = (await res.json()) as VibodeStageRunResponse;
  if (!data?.imageUrl) {
    throw new Error("Compositor stage-run did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
    appliedAspectRatio: data.appliedAspectRatio ?? null,
  };
}
