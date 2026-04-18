import type { FreezePayloadV2 } from "./freezePayloadV2Types";

type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";

export type VibodeRotateRequest = {
  freezePayload: FreezePayloadV2;
  baseImageUrl: string;
  aspectRatio?: AspectRatio;
  modelVersion?: string | null;
};

type VibodeRotateResponse = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
};

export async function callCompositorVibodeRotate(
  args: VibodeRotateRequest
): Promise<VibodeRotateResponse> {
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
    .replace(/\/vibode\/rotate\/?$/, "")
    .replace(/\/$/, "");
  const endpoint = `${endpointBaseNormalized}/vibode/rotate`;
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  console.log("[callCompositorVibodeRotate] request", {
    endpoint,
    marks: args.freezePayload?.vibodeIntent?.rotate?.marks?.length ?? 0,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      freezePayload: args.freezePayload,
      baseImageUrl: args.baseImageUrl,
      aspectRatio: args.aspectRatio,
      modelVersion: args.modelVersion ?? null,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Compositor backend error (rotate): ${res.status} ${text}`.trim());
  }

  const data = (await res.json()) as VibodeRotateResponse;
  if (!data?.imageUrl) {
    throw new Error("Compositor rotate did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
    appliedAspectRatio: data.appliedAspectRatio ?? null,
  };
}
