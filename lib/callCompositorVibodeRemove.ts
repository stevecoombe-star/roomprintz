// lib/callCompositorVibodeRemove.ts
// Vibode Remove v1 request client.
// Compositor owns overlay rendering + canonical grounding + model call.

import type { RemoveMarkV2 } from "./freezePayloadV2Types";

export type VibodeRemoveResponse = {
  imageUrl: string;
};

export async function callCompositorVibodeRemove(args: {
  cleanBase64: string;
  marks: RemoveMarkV2[];
  modelVersion?: string | null;
}): Promise<VibodeRemoveResponse> {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();

  if (!endpointBase) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }

  const endpointBaseNormalized = endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/vibode\/compose\/?$/, "")
    .replace(/\/$/, "");
  const endpoint = `${endpointBaseNormalized}/vibode/remove`;

  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;

  const payload = {
    cleanBase64: args.cleanBase64,
    marks: args.marks,
    modelVersion: args.modelVersion ?? null,
  };

  console.log("[callCompositorVibodeRemove] request", {
    endpoint,
    marks: args.marks.length,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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
    throw new Error(
      `Compositor backend error (remove): ${res.status} ${text}`.trim()
    );
  }

  const data = (await res.json()) as VibodeRemoveResponse;

  if (!data?.imageUrl) {
    throw new Error("Compositor remove did not return imageUrl");
  }

  return {
    imageUrl: data.imageUrl,
  };
}
