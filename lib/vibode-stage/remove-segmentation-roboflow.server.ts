/**
 * Roboflow serverless SAM 3 client.
 *
 * One POST. A failed response is returned as classified. This file does not
 * schedule another request. The API key is read from `ROBOFLOW_API_KEY` or
 * from the explicit server option, and it is sent only as a Bearer header.
 *
 * The first approved live call should be a single polygon request for one
 * admin-owned ORIGINAL. Save the response JSON, with the image bytes left
 * out of the fixture, and check `prompt_results[].predictions[].masks`
 * against `ROBOFLOW_SAM3_POLYGON_SCHEMA`. Do not add an RLE request in that
 * same call. RLE stays `unverified` until a separate captured payload shows
 * `size` order and the `counts` encoding.
 */

import { randomUUID } from "node:crypto";

import {
  REMOVE_SEGMENTATION_MODEL_ID,
  REMOVE_SEGMENTATION_PROVIDER_ID,
  REMOVE_SEGMENTATION_TIMEOUT_MS,
  ROBOFLOW_CONCEPT_SEGMENT_URL,
  buildRoboflowConceptSegmentRequest,
  isRemoveSegmentationVocabulary,
  normalizeRoboflowConceptSegment,
  segmentationImageRejection,
  type RemoveSegmentationProvider,
  type RemoveSegmentationResult,
} from "@/lib/vibode-stage/remove-segmentation";

const MAX_RESPONSE_BYTES = 8_000_000;

export type RoboflowRemoveSegmentationOptions = Readonly<{
  fetch?: typeof fetch;
  apiKey?: string | null;
  timeoutMs?: number;
}>;

export function createRoboflowRemoveSegmentationProvider(
  options: RoboflowRemoveSegmentationOptions = {},
): RemoveSegmentationProvider {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0
    ? options.timeoutMs
    : REMOVE_SEGMENTATION_TIMEOUT_MS;

  return {
    id: REMOVE_SEGMENTATION_PROVIDER_ID,
    modelId: REMOVE_SEGMENTATION_MODEL_ID,
    async segment(image, concepts): Promise<RemoveSegmentationResult> {
      const apiKey = resolveApiKey(options.apiKey);
      if (!apiKey) return { ok: false, error: "credentials_missing" };
      const rejected = segmentationImageRejection(image);
      if (rejected) return { ok: false, error: "request_rejected", detail: rejected };
      if (!isRemoveSegmentationVocabulary(concepts)) {
        return { ok: false, error: "request_rejected", detail: "concepts" };
      }
      const built = buildRoboflowConceptSegmentRequest({
        image,
        concepts,
        requestId: randomUUID(),
      });
      if (!built.ok) return built;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(ROBOFLOW_CONCEPT_SEGMENT_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: built.body,
          signal: controller.signal,
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) {
          await cancelBody(response);
          return httpFailure(response.status);
        }
        const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
        if (text === "unbounded") return { ok: false, error: "response_unbounded" };
        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          return { ok: false, error: "response_invalid" };
        }
        return normalizeRoboflowConceptSegment({
          payload,
          concepts,
          originalWidth: image.width,
          originalHeight: image.height,
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return { ok: false, error: "provider_timeout" };
        }
        return { ok: false, error: "provider_network" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function resolveApiKey(explicit: string | null | undefined): string | null {
  const value = explicit === undefined ? process.env.ROBOFLOW_API_KEY : explicit;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function httpFailure(status: number): RemoveSegmentationResult {
  if (status === 401 || status === 403) {
    return { ok: false, error: "provider_unauthorized", providerStatus: status };
  }
  if (status === 408 || status === 504) {
    return { ok: false, error: "provider_timeout", providerStatus: status };
  }
  return { ok: false, error: "provider_http", providerStatus: status };
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status is already known. The discarded body is not an error value.
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | "unbounded"> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response);
    return "unbounded";
  }
  if (!response.body) {
    const text = await response.text();
    return text.length > maxBytes ? "unbounded" : text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return "unbounded";
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
