import {
  callCompositorJson,
  CompositorTransportError,
  resolveCompositorEndpoint,
} from "./compositorTransportError";

type VibodeStageRunResponse = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
};

export async function callCompositorVibodeStageRun(args: {
  payload: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<VibodeStageRunResponse> {
  const data = await callCompositorJson({
    seam: "stage-run",
    path: "/api/vibode/stage-run",
    method: "POST",
    payload: args.payload,
    headers: args.headers,
    signal: args.signal,
  });
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new CompositorTransportError({
      seam: "stage-run",
      classification: "malformed_response",
      httpStatus: 200,
      endpoint: resolveCompositorEndpoint("/api/vibode/stage-run").endpoint,
    });
  }
  const response = data as Record<string, unknown>;
  if (typeof response.imageUrl !== "string" || response.imageUrl.trim() === "") {
    throw new CompositorTransportError({
      seam: "stage-run",
      classification: "missing_image_artifact",
      httpStatus: 200,
      endpoint: resolveCompositorEndpoint("/api/vibode/stage-run").endpoint,
    });
  }
  if (
    response.appliedAspectRatio !== undefined &&
    response.appliedAspectRatio !== null &&
    typeof response.appliedAspectRatio !== "string"
  ) {
    throw new CompositorTransportError({
      seam: "stage-run",
      classification: "malformed_response",
      httpStatus: 200,
      endpoint: resolveCompositorEndpoint("/api/vibode/stage-run").endpoint,
    });
  }

  return {
    imageUrl: response.imageUrl,
    appliedAspectRatio: response.appliedAspectRatio ?? null,
  };
}
