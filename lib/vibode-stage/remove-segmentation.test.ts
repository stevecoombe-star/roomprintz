import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  hideAllRemoveObjects,
  hitTestRemoveObjects,
  removePackedBit,
  toggleRemoveObjectSelection,
} from "@/lib/vibode-stage/remove-objects";

import { createRoboflowRemoveSegmentationProvider } from "./remove-segmentation-roboflow.server";
import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_CONCEPT_SET,
  REMOVE_SEGMENTATION_MAX_CONCEPTS,
  REMOVE_SEGMENTATION_MAX_EDGE,
  REMOVE_SEGMENTATION_MAX_IMAGE_BYTES,
  REMOVE_SEGMENTATION_MAX_PIXELS,
  REMOVE_SEGMENTATION_MAX_PREDICTIONS,
  REMOVE_SEGMENTATION_MODEL_ID,
  REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH,
  ROBOFLOW_CONCEPT_SEGMENT_URL,
  ROBOFLOW_SAM3_POLYGON_SCHEMA,
  ROBOFLOW_SAM3_RLE_CONTRACT,
  buildRoboflowConceptSegmentRequest,
  decodeRoboflowRleMask,
  isRemoveSegmentationVocabulary,
  normalizeRoboflowConceptSegment,
  packSegmentationCoverageAtOriginal,
  type RemoveSegmentationImage,
} from "./remove-segmentation";

const SHA = "ab".repeat(32);

/**
 * Polygon rings shaped like the serverless OpenAPI 0.64.4 example:
 * an array of rings, each ring an array of [x, y] pixel pairs.
 * This is a contract fixture, not a captured provider response.
 */
function documentedPolygonResponse(input: Readonly<{
  concepts: readonly string[];
  predictions?: Readonly<Record<string, readonly unknown[]>>;
  time?: number;
  omitEcho?: boolean;
}>) {
  return {
    time: input.time ?? 0.25,
    prompt_results: input.concepts.map((text, promptIndex) => ({
      prompt_index: promptIndex,
      ...(input.omitEcho ? {} : {
        echo: { prompt_index: promptIndex, type: "text", text, num_boxes: 0 },
      }),
      predictions: input.predictions?.[text] ?? [],
    })),
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function polygon(confidence: number, ring: number[][]) {
  return { format: "polygon", confidence, masks: [ring] };
}

function image(patch: Partial<RemoveSegmentationImage> = {}): RemoveSegmentationImage {
  return {
    bytes: Uint8Array.from([1, 2, 3, 4]),
    width: 32,
    height: 32,
    sha256: SHA,
    mimeType: "image/png",
    ...patch,
  };
}

function normalize(input: Readonly<{
  concepts?: readonly string[];
  width?: number;
  height?: number;
  payload: unknown;
}>) {
  const concepts = input.concepts ?? ["chair"];
  return normalizeRoboflowConceptSegment({
    payload: input.payload,
    concepts,
    originalWidth: input.width ?? 32,
    originalHeight: input.height ?? 32,
  });
}

test("the versioned vocabulary is the 16-concept serverless maximum", () => {
  assert.equal(REMOVE_SEGMENTATION_CONCEPTS_V1.length, 16);
  assert.equal(REMOVE_SEGMENTATION_CONCEPTS_V1.length, REMOVE_SEGMENTATION_MAX_CONCEPTS);
  assert.equal(isRemoveSegmentationVocabulary(REMOVE_SEGMENTATION_CONCEPTS_V1), true);
  assert.equal(isRemoveSegmentationVocabulary(["chair"]), false);
  assert.equal(ROBOFLOW_SAM3_RLE_CONTRACT, "unverified");
  assert.equal(decodeRoboflowRleMask({ size: [4, 4], counts: "not-a-captured-fixture" }).error, "rle_contract_unverified");
});

test("the request is one bounded polygon call without provider NMS or a query key", () => {
  const built = buildRoboflowConceptSegmentRequest({
    image: image(),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    requestId: "request-1",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const body = JSON.parse(built.body) as {
    model_id: string;
    format: string;
    output_prob_thresh: number;
    nms_iou_threshold?: number;
    api_key?: string;
    image: { type: string; value: string };
    prompts: Array<{ type: string; text: string }>;
  };
  assert.equal(body.model_id, REMOVE_SEGMENTATION_MODEL_ID);
  assert.equal(body.format, "polygon");
  assert.equal(body.output_prob_thresh, REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH);
  assert.equal(body.nms_iou_threshold, undefined);
  assert.equal(body.api_key, undefined);
  assert.equal(body.image.type, "base64");
  assert.equal(body.image.value, Buffer.from([1, 2, 3, 4]).toString("base64"));
  assert.deepEqual(body.prompts.map((prompt) => prompt.text), [...REMOVE_SEGMENTATION_CONCEPTS_V1]);
  assert.equal(built.body.includes("roboflow-test-key"), false);
  assert.equal(ROBOFLOW_CONCEPT_SEGMENT_URL.includes("?"), false);
});

test("oversized images and foreign concept lists are rejected before a request body exists", () => {
  const wide = buildRoboflowConceptSegmentRequest({
    image: image({ width: REMOVE_SEGMENTATION_MAX_EDGE + 1, height: 1 }),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    requestId: "request-1",
  });
  assert.deepEqual(wide, { ok: false, error: "request_rejected", detail: "image_edge" });
  const pixels = buildRoboflowConceptSegmentRequest({
    image: image({ width: 8000, height: 2001 }),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    requestId: "request-1",
  });
  assert.equal(pixels.ok, false);
  if (pixels.ok) return;
  assert.equal(pixels.detail, "image_pixels");
  assert.ok(8000 * 2001 > REMOVE_SEGMENTATION_MAX_PIXELS);
  const bytes = buildRoboflowConceptSegmentRequest({
    image: image({ bytes: new Uint8Array(REMOVE_SEGMENTATION_MAX_IMAGE_BYTES + 1) }),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    requestId: "request-1",
  });
  assert.equal(bytes.ok, false);
  if (bytes.ok) return;
  assert.equal(bytes.detail, "image_bytes");
  const concepts = buildRoboflowConceptSegmentRequest({
    image: image(),
    concepts: ["floor", "wall"],
    requestId: "request-1",
  });
  assert.equal(concepts.ok, false);
  if (concepts.ok) return;
  assert.equal(concepts.detail, "concepts");
});

test("documented polygon rings rasterize in ORIGINAL coordinates with the top-left origin", () => {
  const result = normalize({
    width: 4,
    height: 2,
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: { chair: [polygon(0.91, rect(2, 0, 4, 2))] },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.schema, ROBOFLOW_SAM3_POLYGON_SCHEMA);
  assert.equal(result.maskEncoding, "polygon");
  assert.deepEqual(result.unverifiedEncodings, ["rle"]);
  assert.equal(result.providerTimeSec, 0.25);
  assert.equal(result.preparation.eligible.length, 0);
  assert.equal(result.preparation.rejected.length, 1);
  assert.equal(result.preparation.rejected[0]?.eligibility.reasons.includes("min_area"), true);
  const mask = result.preparation.rejected[0]?.mask;
  assert.ok(mask);
  if (!mask) return;
  assert.equal(mask.width, 4);
  assert.equal(mask.height, 2);
  assert.equal(mask.areaPx, 4);
  assert.deepEqual(mask.bounds, { x: 2, y: 0, width: 2, height: 2 });
  assert.equal(removePackedBit(mask, 0, 0), false);
  assert.equal(removePackedBit(mask, 2, 0), true);
  assert.equal(removePackedBit(mask, 3, 1), true);
  assert.equal(removePackedBit(mask, 2, 1), true);
});

test("a provider grid that is not the ORIGINAL grid is resampled by the existing mapper", () => {
  const mask = packSegmentationCoverageAtOriginal({
    source: Uint8Array.from([0, 255]),
    sourceWidth: 2,
    sourceHeight: 1,
    originalWidth: 4,
    originalHeight: 1,
  });
  assert.ok(mask);
  if (!mask) return;
  assert.equal(mask.width, 4);
  assert.equal(mask.height, 1);
  assert.equal(removePackedBit(mask, 0, 0), false);
  assert.equal(removePackedBit(mask, 1, 0), false);
  assert.equal(removePackedBit(mask, 2, 0), true);
  assert.equal(removePackedBit(mask, 3, 0), true);

  const threshold = packSegmentationCoverageAtOriginal({
    source: Uint8Array.from([127, 128]),
    sourceWidth: 2,
    sourceHeight: 1,
    originalWidth: 2,
    originalHeight: 1,
  });
  assert.ok(threshold);
  if (!threshold) return;
  assert.equal(removePackedBit(threshold, 0, 0), false);
  assert.equal(removePackedBit(threshold, 1, 0), true);
});

test("an even-odd hole stays empty and ids stay stable when prompt results are reordered", () => {
  const holed = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: {
        chair: [{
          format: "polygon",
          confidence: 0.9,
          masks: [rect(1, 1, 31, 21), rect(8, 8, 14, 14)],
        }],
      },
    }),
  });
  assert.equal(holed.ok, true);
  if (!holed.ok) return;
  const holedMask = holed.preparation.eligible[0]?.mask;
  assert.ok(holedMask);
  if (!holedMask) return;
  assert.equal(removePackedBit(holedMask, 2, 2), true);
  assert.equal(removePackedBit(holedMask, 10, 10), false);

  const concepts = ["chair", "lamp"] as const;
  const payload = documentedPolygonResponse({
    concepts,
    predictions: {
      chair: [polygon(0.9, rect(1, 1, 31, 21))],
      lamp: [polygon(0.88, rect(33, 1, 63, 21))],
    },
  });
  const forward = normalize({ concepts, width: 64, height: 32, payload });
  const reversed = normalize({
    concepts,
    width: 64,
    height: 32,
    payload: { time: payload.time, prompt_results: [...payload.prompt_results].reverse() },
  });
  assert.equal(forward.ok, true);
  assert.equal(reversed.ok, true);
  if (!forward.ok || !reversed.ok) return;
  assert.deepEqual(
    forward.preparation.eligible.map((item) => item.id),
    reversed.preparation.eligible.map((item) => item.id),
  );
  assert.equal(forward.preparation.eligible.length, 2);
  assert.deepEqual(forward.preparation.suppressed, reversed.preparation.suppressed);
});

test("eligibility, duplicate reports, and nested selection run on normalized masks", () => {
  const concepts = ["chair", "sofa", "lamp"] as const;
  const shared = rect(1, 1, 31, 21);
  const result = normalize({
    concepts,
    width: 48,
    height: 48,
    payload: documentedPolygonResponse({
      concepts,
      predictions: {
        chair: [
          polygon(0.92, shared),
          polygon(0.61, shared),
          polygon(0.4, rect(1, 1, 47, 47)),
        ],
        sofa: [polygon(0.92, shared)],
        lamp: [polygon(0.87, rect(10, 10, 30, 30))],
      },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const eligibleConcepts = result.preparation.eligible.map((item) => item.concept).sort();
  assert.deepEqual(eligibleConcepts, ["chair", "lamp"]);
  const low = result.preparation.rejected.find((item) => item.confidence === 0.4);
  assert.equal(low?.eligibility.reasons.includes("confidence"), true);
  const duplicate = result.preparation.suppressed.find((item) => item.suppressedConfidence === 0.61);
  assert.ok(duplicate);
  if (!duplicate) return;
  assert.equal(duplicate.reason, "higher_confidence");
  assert.equal(duplicate.retainedConcept, "chair");
  assert.equal(duplicate.suppressedConcept, "chair");
  assert.equal(duplicate.retainedConfidence, 0.92);
  assert.equal(duplicate.duplicateOf, duplicate.retainedId);
  const sofa = result.preparation.suppressed.find((item) => item.suppressedConcept === "sofa");
  assert.equal(sofa?.reason, "equal_confidence_lesser_id");
  assert.equal(sofa?.retainedConcept, "chair");
  const equal = normalize({
    concepts: ["chair", "sofa"],
    payload: documentedPolygonResponse({
      concepts: ["chair", "sofa"],
      predictions: {
        chair: [polygon(0.8, shared)],
        sofa: [polygon(0.8, shared)],
      },
    }),
  });
  assert.equal(equal.ok, true);
  if (!equal.ok) return;
  assert.equal(equal.preparation.suppressed[0]?.reason, "equal_confidence_lesser_id");
  assert.equal(equal.preparation.suppressed[0]?.retainedConcept, "chair");
  assert.equal(equal.preparation.suppressed[0]?.suppressedConcept, "sofa");

  const nested = normalize({
    concepts: ["chair", "lamp"],
    width: 48,
    height: 48,
    payload: documentedPolygonResponse({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [polygon(0.9, rect(1, 1, 47, 47))],
        lamp: [polygon(0.86, rect(10, 10, 30, 30))],
      },
    }),
  });
  assert.equal(nested.ok, true);
  if (!nested.ok) return;
  assert.equal(nested.preparation.suppressed.length, 0);
  assert.equal(nested.preparation.nested.length, 1);
  const selected = hideAllRemoveObjects(nested.preparation.eligible);
  assert.equal(selected.size, 2);
  const lampOnly = toggleRemoveObjectSelection(
    selected,
    nested.preparation.eligible,
    nested.preparation.eligible.find((item) => item.concept === "chair")?.id ?? "",
  );
  assert.equal(lampOnly.size, 1);
  assert.equal(
    hitTestRemoveObjects({
      objects: nested.preparation.eligible,
      selectedIds: new Set(),
      x: 15.5,
      y: 15.5,
    }),
    nested.preparation.eligible.find((item) => item.concept === "lamp")?.id,
  );
});

test("malformed, contradictory, and unverified payloads do not become an empty object list", () => {
  const missing = normalize({ payload: { time: 0.1 } });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error, "response_invalid");

  const shortRing = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: { chair: [{ format: "polygon", confidence: 0.9, masks: [[[1, 1], [2, 2]]] }] },
    }),
  });
  assert.equal(shortRing.ok, false);
  if (shortRing.ok) return;
  assert.equal(shortRing.error, "response_invalid");

  const echo = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: { chair: [polygon(0.9, rect(1, 1, 21, 21))] },
    }),
  });
  assert.equal(echo.ok, true);
  const mismatched = normalize({
    payload: {
      prompt_results: [{
        prompt_index: 0,
        echo: { text: "floor" },
        predictions: [polygon(0.9, rect(1, 1, 21, 21))],
      }],
    },
  });
  assert.equal(mismatched.ok, false);

  const outside = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: { chair: [polygon(0.9, rect(0, 0, 80, 10))] },
    }),
  });
  assert.equal(outside.ok, false);
  if (outside.ok) return;
  assert.equal(outside.error, "mask_dimensions");

  const jsonFormat = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: {
        chair: [{ format: "json", confidence: 0.9, masks: [rect(1, 1, 21, 21)] }],
      },
    }),
  });
  assert.equal(jsonFormat.ok, false);
  if (jsonFormat.ok) return;
  assert.equal(jsonFormat.error, "response_invalid");

  /**
   * Not a captured serverless response. The public inference server names
   * `size` and `counts`; this checkpoint refuses that object.
   */
  const rle = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: {
        chair: [{ format: "rle", confidence: 0.9, masks: { size: [32, 32], counts: "synthetic" } }],
      },
    }),
  });
  assert.equal(rle.ok, false);
  if (rle.ok) return;
  assert.equal(rle.error, "rle_contract_unverified");

  const unlabeledObject = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: {
        chair: [{ confidence: 0.9, masks: { size: [32, 32], counts: [4, 8] } }],
      },
    }),
  });
  assert.equal(unlabeledObject.ok, false);
  if (unlabeledObject.ok) return;
  assert.equal(unlabeledObject.error, "rle_contract_unverified");

  const tooMany = normalize({
    payload: documentedPolygonResponse({
      concepts: ["chair"],
      predictions: {
        chair: Array.from({ length: REMOVE_SEGMENTATION_MAX_PREDICTIONS + 1 }, () => ({
          format: "polygon",
          confidence: 0.9,
          masks: [],
        })),
      },
    }),
  });
  assert.equal(tooMany.ok, false);
  if (tooMany.ok) return;
  assert.equal(tooMany.error, "response_unbounded");

  const none = normalize({
    payload: documentedPolygonResponse({ concepts: ["chair"], predictions: { chair: [] } }),
  });
  assert.equal(none.ok, true);
  if (!none.ok) return;
  assert.equal(none.preparation.eligible.length, 0);
  assert.equal(none.conceptSet, "remove-segmentation-concepts/unversioned");
});

test("the Roboflow client sends one authenticated request and does not repeat it", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const provider = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const concepts = REMOVE_SEGMENTATION_CONCEPTS_V1;
      return Response.json(documentedPolygonResponse({
        concepts,
        predictions: {
          chair: [polygon(0.93, rect(2, 2, 28, 22))],
        },
      }));
    },
  });
  const result = await provider.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, ROBOFLOW_CONCEPT_SEGMENT_URL);
  assert.equal(calls[0]?.init?.method, "POST");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer roboflow-test-key");
  const body = JSON.parse(String(calls[0]?.init?.body)) as { api_key?: string; image: { value: string } };
  assert.equal(body.api_key, undefined);
  assert.equal(JSON.stringify(body).includes("roboflow-test-key"), false);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(result.providerNms, "disabled");
  assert.equal(result.preparation.eligible.length, 1);
  assert.equal(result.preparation.eligible[0]?.concept, "chair");
  assert.equal(result.preparation.eligible[0]?.mask.areaPx, 520);
  assert.equal(result.preparation.eligible[0]?.mask.width, 32);
});

test("missing credentials, HTTP failures, timeouts, and bad bodies do not send a second request", async () => {
  let fetches = 0;
  const counting = async () => {
    fetches += 1;
    return new Response("upstream", { status: 500 });
  };
  const missing = createRoboflowRemoveSegmentationProvider({
    apiKey: "  ",
    fetch: counting,
  });
  assert.deepEqual(
    await missing.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1),
    { ok: false, error: "credentials_missing" },
  );
  assert.equal(fetches, 0);

  const unauthorized = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async () => {
      fetches += 1;
      return new Response("", { status: 401 });
    },
  });
  const denied = await unauthorized.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.error, "provider_unauthorized");
  assert.equal(denied.providerStatus, 401);

  const failing = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: counting,
  });
  const http = await failing.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(http.ok, false);
  if (http.ok) return;
  assert.equal(http.error, "provider_http");
  assert.equal(http.providerStatus, 500);

  const stalled = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    timeoutMs: 20,
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      fetches += 1;
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  const timedOut = await stalled.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(timedOut.ok, false);
  if (timedOut.ok) return;
  assert.equal(timedOut.error, "provider_timeout");

  const offline = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async () => {
      fetches += 1;
      throw new TypeError("socket closed");
    },
  });
  const network = await offline.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(network.ok, false);
  if (network.ok) return;
  assert.equal(network.error, "provider_network");

  const huge = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async () => {
      fetches += 1;
      return new Response("{}", {
        status: 200,
        headers: { "content-length": "9000000" },
      });
    },
  });
  const unbounded = await huge.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(unbounded.ok, false);
  if (unbounded.ok) return;
  assert.equal(unbounded.error, "response_unbounded");

  const garbage = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async () => {
      fetches += 1;
      return new Response("not-json", { status: 200 });
    },
  });
  const invalid = await garbage.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.error, "response_invalid");

  const foreign = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: counting,
  });
  const rejected = await foreign.segment(image(), ["floor"]);
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.detail, "concepts");
  assert.equal(fetches, 6);
});

test("captured serverless polygon response normalizes onto the ORIGINAL grid", () => {
  const fixturePath = path.join(
    process.cwd(),
    "lib/vibode-stage/fixtures/roboflow-sam3-polygon-live.json",
  );
  const serialized = readFileSync(fixturePath, "utf8");
  assert.doesNotMatch(serialized, /077ef88b|44b6bbd2|eb3a6292|Bearer|api_key|storage\/|https?:\/\/|ROBOFLOW/i);
  const payload = JSON.parse(serialized) as {
    frame_id: null;
    inference_id: null;
    time: number;
    resolved_model: { model_id: string };
    prompt_results: Array<{ predictions: Array<{ format?: string }> }>;
  };
  assert.equal(payload.frame_id, null);
  assert.equal(payload.inference_id, null);
  assert.equal(payload.resolved_model.model_id, REMOVE_SEGMENTATION_MODEL_ID);
  assert.equal(payload.prompt_results.length, 16);
  assert.equal(payload.prompt_results.reduce((sum, prompt) => sum + prompt.predictions.length, 0), 11);
  for (const prompt of payload.prompt_results) {
    for (const prediction of prompt.predictions) {
      assert.equal(prediction.format, "polygon");
    }
  }

  const result = normalizeRoboflowConceptSegment({
    payload,
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    originalWidth: 960,
    originalHeight: 640,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.schema, ROBOFLOW_SAM3_POLYGON_SCHEMA);
  assert.equal(result.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(result.providerTimeSec, payload.time);
  assert.deepEqual(result.unverifiedEncodings, ["rle"]);
  assert.equal(ROBOFLOW_SAM3_RLE_CONTRACT, "unverified");
  assert.equal(result.preparation.eligible.length, 10);
  assert.equal(result.preparation.rejected.length, 0);
  assert.equal(result.preparation.nested.length, 0);
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.concept),
    ["chair", "sofa", "table", "table", "table", "lamp", "lamp", "lamp", "rug", "pillow"],
  );
  for (const item of result.preparation.eligible) {
    assert.equal(item.mask.width, 960);
    assert.equal(item.mask.height, 640);
  }
  const chair = result.preparation.eligible[0];
  const sofa = result.preparation.eligible[1];
  const coffeeTable = result.preparation.eligible[3];
  const leftLamp = result.preparation.eligible[5];
  const rug = result.preparation.eligible[8];
  const pillow = result.preparation.eligible[9];
  assert.ok(chair && sofa && coffeeTable && leftLamp && rug && pillow);
  if (!chair || !sofa || !coffeeTable || !leftLamp || !rug || !pillow) return;
  assert.equal(removePackedBit(chair.mask, 750, 450), true);
  assert.equal(removePackedBit(chair.mask, 10, 10), false);
  assert.equal(removePackedBit(sofa.mask, 200, 450), true);
  assert.equal(removePackedBit(coffeeTable.mask, 450, 470), true);
  assert.equal(removePackedBit(leftLamp.mask, 140, 400), true);
  assert.equal(removePackedBit(rug.mask, 500, 520), true);
  assert.equal(removePackedBit(pillow.mask, 230, 400), true);
  assert.equal(result.preparation.suppressed.length, 1);
  const duplicate = result.preparation.suppressed[0];
  assert.ok(duplicate);
  if (!duplicate) return;
  assert.equal(duplicate.reason, "higher_confidence");
  assert.equal(duplicate.suppressedConcept, "sofa");
  assert.equal(duplicate.suppressedConfidence, 0.68359375);
  assert.equal(duplicate.retainedConcept, "chair");
  assert.equal(duplicate.retainedConfidence, 0.734375);
  assert.equal(duplicate.retainedId, chair.id);
  assert.ok(duplicate.iou > 0.99);
});
