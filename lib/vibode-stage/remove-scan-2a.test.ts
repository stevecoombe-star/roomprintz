import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import type { RemoveImageDescriptor } from "@/lib/vibode-stage/remove-alignment";
import {
  hiddenRemoveCleanupObjects,
  snapshotRemoveCleanupObjects,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  decodeRemoveMaskTransport,
  encodeRemoveMaskTransport,
  REMOVE_MASK_TRANSPORT_ENCODING,
  REMOVE_MASK_TRANSPORT_MAX_BYTES,
  REMOVE_MASK_TRANSPORT_MAX_EDGE,
  REMOVE_MASK_TRANSPORT_MAX_PIXELS,
} from "@/lib/vibode-stage/remove-mask-transport";
import {
  hideAllRemoveObjectUi,
  highlightRemoveObject,
  initialRemoveObjectUiState,
  paintRemoveObjectProtection,
  readRemoveObjectUiPayload,
  reduceRemoveObjectSession,
  removeObjectBoundaryPixels,
  showAllRemoveObjectUi,
  syncRemoveInspectionCoverage,
  formatRemovePredictionRejections,
  formatRemoveScanStatus,
  REMOVE_SCAN_IMAGE_LIMIT,
  REMOVE_SCAN_NO_OBJECTS,
  REMOVE_SCAN_NONE_USABLE,
  REMOVE_SCAN_NOT_READY,
  REMOVE_SCAN_PAYLOAD_CEILING,
  type RemoveObjectUiIdentity,
} from "@/lib/vibode-stage/remove-object-ui";
import {
  hideAllRemoveObjects,
  hitTestRemoveObjects,
  removeMaskOverlap,
  showAllRemoveObjects,
  type RemoveObjectRecord,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";
import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";
import { assembleRemoveSegmentationPayload } from "@/lib/vibode-stage/remove-segmentation-admin";
import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_MAX_PACKED_BYTES,
  REMOVE_SEGMENTATION_MAX_PREDICTIONS,
  REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES,
  REMOVE_SEGMENTATION_TIMEOUT_MS,
  ROBOFLOW_CONCEPT_SEGMENT_URL,
  buildRoboflowConceptSegmentRequest,
  normalizeRoboflowConceptSegment,
  type RemoveSegmentationSuccess,
} from "@/lib/vibode-stage/remove-segmentation";

const SHA = "ab".repeat(32);
const ROOM = "00000000-0000-4000-8000-000000000001";
const GENERATION = "00000000-0000-4000-8000-000000000002";

function identity(width: number, height: number): RemoveObjectUiIdentity {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: width,
    originalHeight: height,
    sessionSerial: 1,
  };
}

function descriptor(width: number, height: number): RemoveImageDescriptor {
  return {
    sha256: SHA,
    decodedWidth: width,
    decodedHeight: height,
    byteCount: 8,
    mimeType: "image/png",
    orientation: 1,
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function polygon(confidence: number, ring: number[][]) {
  return { format: "polygon", confidence, masks: [ring] };
}

function documented(input: Readonly<{
  concepts: readonly string[];
  predictions?: Readonly<Record<string, readonly unknown[]>>;
}>) {
  return {
    time: 0.2,
    prompt_results: input.concepts.map((text, promptIndex) => ({
      prompt_index: promptIndex,
      echo: { prompt_index: promptIndex, type: "text", text, num_boxes: 0 },
      predictions: input.predictions?.[text] ?? [],
    })),
  };
}

function normalize(input: Readonly<{
  payload: unknown;
  concepts?: readonly string[];
  width: number;
  height: number;
}>): RemoveSegmentationSuccess {
  const result = normalizeRoboflowConceptSegment({
    payload: input.payload,
    concepts: input.concepts ?? REMOVE_SEGMENTATION_CONCEPTS_V1,
    originalWidth: input.width,
    originalHeight: input.height,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("normalize");
  return result;
}

function publish(result: RemoveSegmentationSuccess, width: number, height: number) {
  const assembled = assembleRemoveSegmentationPayload({
    result,
    roomId: ROOM,
    generationId: GENERATION,
    original: descriptor(width, height),
  });
  assert.equal(assembled.ok, true);
  if (!assembled.ok) throw new Error("assemble");
  assertProductionPayloadPrivacy(assembled.payload);
  return assembled;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function legacyBitsChars(mask: RemovePackedMask): number {
  return Buffer.from(mask.bits).toString("base64").length;
}

test("transport ceilings stay aligned with the segmentation safeguards", () => {
  assert.equal(REMOVE_SEGMENTATION_CONCEPTS_V1.length, 16);
  assert.equal(REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES, 8_000_000);
  assert.equal(REMOVE_SEGMENTATION_MAX_PACKED_BYTES, 3_000_000);
  assert.equal(REMOVE_SEGMENTATION_MAX_PREDICTIONS, 48);
  assert.equal(REMOVE_SEGMENTATION_TIMEOUT_MS, 20_000);
  assert.equal(ROBOFLOW_CONCEPT_SEGMENT_URL, "https://serverless.roboflow.com/sam3/concept_segment");
  assert.equal(REMOVE_MASK_TRANSPORT_MAX_EDGE, 8192);
  assert.equal(REMOVE_MASK_TRANSPORT_MAX_PIXELS, 16_000_000);
  assert.equal(REMOVE_MASK_TRANSPORT_MAX_BYTES, REMOVE_SEGMENTATION_MAX_PACKED_BYTES);
  const built = buildRoboflowConceptSegmentRequest({
    image: {
      bytes: Uint8Array.from([1]),
      width: 32,
      height: 32,
      sha256: SHA,
      mimeType: "image/png",
    },
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    requestId: "request-1",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const body = JSON.parse(built.body) as { format: string; prompts: unknown[] };
  assert.equal(body.format, "polygon");
  assert.equal(body.prompts.length, 16);
});

test("A. known-good 960×640 fixture keeps ten masks, one duplicate, and exact pixels", () => {
  const payload = JSON.parse(readFileSync(
    new URL("./fixtures/roboflow-sam3-polygon-live.json", import.meta.url),
    "utf8",
  ));
  const result = normalize({ payload, width: 960, height: 640 });
  assert.equal(result.preparation.eligible.length, 10);
  assert.equal(result.preparation.rejected.length, 0);
  assert.equal(result.preparation.suppressed.length, 1);
  assert.equal(result.predictionRejections.length, 0);
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.concept),
    ["chair", "sofa", "table", "table", "table", "lamp", "lamp", "lamp", "rug", "pillow"],
  );
  const published = publish(result, 960, 640);
  const wire = published.payload as {
    objects: Array<{ id: string; mask: { encoding: string; bounds: { width: number; height: number } } }>;
    predictionRejections: unknown[];
  };
  assert.equal(wire.predictionRejections.length, 0);
  assert.equal(wire.objects.length, 10);
  const read = readRemoveObjectUiPayload(published.payload, identity(960, 640));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.objects.map((item) => item.id), result.preparation.eligible.map((item) => item.id));
  for (const object of read.objects) {
    const source = result.preparation.eligible.find((item) => item.id === object.id);
    assert.ok(source);
    if (!source) return;
    assert.equal(sameBytes(object.mask.bits, source.mask.bits), true);
    assert.deepEqual(object.mask.bounds, source.mask.bounds);
    assert.equal(object.mask.width, 960);
    assert.equal(object.mask.height, 640);
  }
  const duplicate = result.preparation.suppressed[0];
  assert.ok(duplicate);
  if (!duplicate) return;
  const duplicateWire = encodeRemoveMaskTransport(duplicate.object.mask);
  assert.ok(duplicateWire);
  if (!duplicateWire) return;
  const duplicateDecoded = decodeRemoveMaskTransport(duplicateWire, { width: 960, height: 640 });
  assert.ok(duplicateDecoded);
  if (!duplicateDecoded) return;
  assert.equal(sameBytes(duplicateDecoded.bits, duplicate.object.mask.bits), true);
  const chair = read.objects.find((item) => item.concept === "chair");
  assert.ok(chair);
  if (!chair) return;
  assert.equal(hitTestRemoveObjects({
    objects: read.objects,
    selectedIds: new Set(),
    x: 750.2,
    y: 450.2,
  }), chair.id);
  assert.equal(hideAllRemoveObjects(read.objects).size, 10);
  assert.equal(showAllRemoveObjects().size, 0);
  const overlap = removeMaskOverlap(chair.mask, duplicateDecoded);
  assert.ok(overlap && overlap.iou > 0.99);
  const legacy = result.preparation.eligible.reduce((sum, item) => sum + legacyBitsChars(item.mask), 0)
    + legacyBitsChars(duplicate.object.mask);
  assert.ok(published.serialized.length < legacy);
  assert.ok(published.serialized.length < REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES);
  for (const item of wire.objects) {
    assert.equal(item.mask.encoding, REMOVE_MASK_TRANSPORT_ENCODING);
    assert.ok(item.mask.bounds.width < 960 || item.mask.bounds.height < 640);
  }
});

test("B. eight modest objects on a 4032×3024 frame stay under the response ceiling", { timeout: 120_000 }, () => {
  const width = 4032;
  const height = 3024;
  const concepts = REMOVE_SEGMENTATION_CONCEPTS_V1.slice(0, 8);
  const predictions: Record<string, unknown[]> = {};
  concepts.forEach((concept, index) => {
    const x = 80 + (index % 4) * 180;
    const y = 90 + Math.floor(index / 4) * 220;
    predictions[concept] = [polygon(0.9, rect(x, y, x + 48, y + 36))];
  });
  const result = normalize({
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    width,
    height,
    payload: documented({ concepts: REMOVE_SEGMENTATION_CONCEPTS_V1, predictions }),
  });
  assert.equal(result.preparation.eligible.length, 8);
  assert.equal(result.preparation.suppressed.length, 0);
  assert.equal(result.predictionRejections.length, 0);
  const fullFrameBytes = result.preparation.eligible.reduce((sum, item) => sum + item.mask.bits.byteLength, 0);
  assert.ok(fullFrameBytes > REMOVE_SEGMENTATION_MAX_PACKED_BYTES);
  const published = publish(result, width, height);
  const legacy = result.preparation.eligible.reduce((sum, item) => sum + legacyBitsChars(item.mask), 0);
  assert.ok(legacy > REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES);
  assert.ok(published.serialized.length < REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES);
  assert.ok(published.serialized.length < legacy / 4);
  const read = readRemoveObjectUiPayload(published.payload, identity(width, height));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.objects.length, 8);
  for (const object of read.objects) {
    const source = result.preparation.eligible.find((item) => item.id === object.id);
    assert.ok(source);
    if (!source) return;
    assert.equal(sameBytes(object.mask.bits, source.mask.bits), true);
    assert.equal(object.mask.bounds.width, 48);
    assert.equal(object.mask.bounds.height, 36);
    assert.equal(hitTestRemoveObjects({
      objects: read.objects,
      selectedIds: new Set(),
      x: object.mask.bounds.x + 10.2,
      y: object.mask.bounds.y + 8.2,
    }), object.id);
  }
});

test("C. 2528×1696 objects keep tight bounds and full-frame bits", { timeout: 60_000 }, () => {
  const width = 2528;
  const height = 1696;
  const specs = [
    ["chair", rect(0, 0, 30, 21)],
    ["sofa", rect(width - 28, height - 16, width, height)],
    ["table", rect(400, 500, 460, 560)],
    ["lamp", rect(900, 200, 961, 251)],
  ] as const;
  const predictions: Record<string, unknown[]> = {};
  for (const [concept, ring] of specs) predictions[concept] = [polygon(0.91, ring)];
  const result = normalize({
    width,
    height,
    payload: documented({ concepts: REMOVE_SEGMENTATION_CONCEPTS_V1, predictions }),
  });
  assert.equal(result.preparation.eligible.length, 4);
  const published = publish(result, width, height);
  const wire = published.payload as {
    objects: Array<{ id: string; mask: { bounds: { x: number; y: number; width: number; height: number }; bits: string } }>;
  };
  const read = readRemoveObjectUiPayload(published.payload, identity(width, height));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const expected = [
    { x: 0, y: 0, width: 30, height: 21 },
    { x: width - 28, y: height - 16, width: 28, height: 16 },
    { x: 400, y: 500, width: 60, height: 60 },
    { x: 900, y: 200, width: 61, height: 51 },
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const bounds = expected[index];
    const source: RemoveObjectRecord | undefined = result.preparation.eligible[index];
    const clientObject: RemoveObjectRecord | undefined = read.objects[index];
    const transported = wire.objects[index];
    assert.ok(bounds && source && clientObject && transported);
    if (!bounds || !source || !clientObject || !transported) return;
    assert.deepEqual(source.mask.bounds, bounds);
    assert.deepEqual(transported.mask.bounds, bounds);
    assert.equal(sameBytes(clientObject.mask.bits, source.mask.bits), true);
    const cropPixels = bounds.width * bounds.height;
    assert.ok(transported.mask.bits.length < Math.ceil((width * height) / 8));
    assert.equal(transported.mask.bits.length, 4 * Math.ceil(Math.ceil(cropPixels / 8) / 3));
  }
  assert.ok(published.serialized.length < REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES);
});

test("D. one invalid polygon does not drop seven valid objects or trigger another provider call", async () => {
  const concepts = ["chair", "sofa"] as const;
  const valid = Array.from({ length: 7 }, (_, index) => polygon(0.9 - index * 0.01, rect(2 + index * 24, 2, 22 + index * 24, 22)));
  const control = normalize({
    concepts,
    width: 220,
    height: 40,
    payload: documented({ concepts, predictions: { chair: valid } }),
  });
  const mixed = normalize({
    concepts,
    width: 220,
    height: 40,
    payload: documented({
      concepts,
      predictions: {
        chair: [
          valid[0],
          valid[1],
          valid[2],
          { format: "polygon", confidence: 0.88, masks: [[[4, 4], [8, 4]]] },
          valid[3],
          valid[4],
          valid[5],
          valid[6],
        ],
      },
    }),
  });
  assert.equal(mixed.preparation.eligible.length, 7);
  assert.equal(mixed.predictionRejections.length, 1);
  assert.equal(mixed.predictionRejections[0]?.reason, "degenerate_polygon");
  assert.equal(mixed.predictionRejections[0]?.concept, "chair");
  assert.equal(mixed.predictionRejections[0]?.ordinal, 3);
  assert.deepEqual(
    mixed.preparation.eligible.map((item) => item.id),
    control.preparation.eligible.map((item) => item.id),
  );
  for (const object of mixed.preparation.eligible) {
    const source = control.preparation.eligible.find((item) => item.id === object.id);
    assert.ok(source);
    if (!source) return;
    assert.equal(sameBytes(object.mask.bits, source.mask.bits), true);
  }

  let calls = 0;
  const provider = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async () => {
      calls += 1;
      return Response.json(documented({
        concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
        predictions: {
          chair: [
            ...valid,
            { format: "polygon", confidence: 0.5, masks: [[[1, 1], [2, 2]]] },
          ],
        },
      }));
    },
  });
  const served = await provider.segment({
    bytes: Uint8Array.from([7, 7, 7, 7]),
    width: 220,
    height: 40,
    sha256: SHA,
    mimeType: "image/png",
  }, REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(calls, 1);
  assert.equal(served.ok, true);
  if (!served.ok) return;
  assert.equal(served.preparation.eligible.length, 7);
  assert.equal(served.predictionRejections.length, 1);
  assert.equal(served.predictionRejections[0]?.reason, "degenerate_polygon");
});

test("E. response-level integrity failures stay hard failures", async () => {
  const missing = normalizeRoboflowConceptSegment({
    payload: { prompt_results: [{ prompt_index: 0, predictions: [] }] },
    concepts: ["chair", "lamp"],
    originalWidth: 32,
    originalHeight: 32,
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error, "response_invalid");

  const duplicate = normalizeRoboflowConceptSegment({
    payload: {
      prompt_results: [
        { prompt_index: 0, echo: { text: "chair" }, predictions: [polygon(0.9, rect(1, 1, 21, 21))] },
        { prompt_index: 0, predictions: [] },
      ],
    },
    concepts: ["chair", "lamp"],
    originalWidth: 32,
    originalHeight: 32,
  });
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.error, "response_invalid");

  const association = normalizeRoboflowConceptSegment({
    payload: documented({
      concepts: ["chair"],
      predictions: { chair: [polygon(0.9, rect(1, 1, 21, 21))] },
    }),
    concepts: ["chair"],
    originalWidth: 32,
    originalHeight: 32,
  });
  assert.equal(association.ok, true);
  const mismatched = normalizeRoboflowConceptSegment({
    payload: {
      prompt_results: [{
        prompt_index: 0,
        echo: { prompt_index: 1, type: "text", text: "chair" },
        predictions: [polygon(0.9, rect(1, 1, 21, 21))],
      }],
    },
    concepts: ["chair"],
    originalWidth: 32,
    originalHeight: 32,
  });
  assert.equal(mismatched.ok, false);
  if (mismatched.ok) return;
  assert.equal(mismatched.error, "response_invalid");

  const capped = normalize({
    concepts: ["chair"],
    width: 64,
    height: 64,
    payload: documented({
      concepts: ["chair"],
      predictions: {
        chair: Array.from({ length: REMOVE_SEGMENTATION_MAX_PREDICTIONS }, () => (
          polygon(0.8, rect(1, 1, 22, 22))
        )),
      },
    }),
  });
  assert.equal(capped.predictionRejections.length, 0);
  const tooMany = normalizeRoboflowConceptSegment({
    payload: documented({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: Array.from({ length: 40 }, () => polygon(0.8, rect(1, 1, 22, 22))),
        lamp: Array.from({ length: 9 }, () => polygon(0.8, rect(24, 1, 46, 22))),
      },
    }),
    concepts: ["chair", "lamp"],
    originalWidth: 64,
    originalHeight: 64,
  });
  assert.equal(tooMany.ok, false);
  if (tooMany.ok) return;
  assert.equal(tooMany.error, "response_unbounded");

  let fetches = 0;
  const provider = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async () => {
      fetches += 1;
      return new Response("{}", { status: 200, headers: { "content-length": "9000000" } });
    },
  });
  const oversized = await provider.segment({
    bytes: Uint8Array.from([1]),
    width: 32,
    height: 32,
    sha256: SHA,
    mimeType: "image/png",
  }, REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(fetches, 1);
  assert.equal(oversized.ok, false);
  if (oversized.ok) return;
  assert.equal(oversized.error, "response_unbounded");

  const seed = normalize({
    concepts: ["chair"],
    width: 32,
    height: 32,
    payload: documented({ concepts: ["chair"], predictions: { chair: [polygon(0.9, rect(1, 1, 21, 21))] } }),
  });
  const eligibility = seed.preparation.eligible[0]?.eligibility;
  assert.ok(eligibility);
  if (!eligibility) return;
  const swollen = assembleRemoveSegmentationPayload({
    result: {
      ...seed,
      predictionRejections: [],
      preparation: {
        eligible: Array.from({ length: 12 }, (_, index) => ({
          id: `v1-chair-${index}-abcd1234`,
          concept: "chair",
          confidence: 0.9,
          mask: solidMask(2000, 2000),
          eligibility,
        })),
        rejected: [],
        suppressed: [],
        nested: [],
      },
    },
    roomId: ROOM,
    generationId: GENERATION,
    original: descriptor(2000, 2000),
  });
  assert.equal(swollen.ok, false);
  if (swollen.ok) return;
  assert.equal(swollen.failure.error, "response_unbounded");
});

test("F. bounded masks round-trip edge cases and reject corrupt metadata", () => {
  const edge = normalize({
    concepts: ["chair", "sofa", "table", "lamp"],
    width: 41,
    height: 27,
    payload: documented({
      concepts: ["chair", "sofa", "table", "lamp"],
      predictions: {
        chair: [polygon(0.95, rect(0, 0, 13, 22))],
        sofa: [polygon(0.94, rect(41 - 9, 27 - 7, 41, 27))],
        table: [polygon(0.93, rect(5, 4, 6, 5))],
        lamp: [polygon(0.92, rect(0, 0, 41, 27))],
      },
    }),
  });
  const byConcept = new Map(edge.preparation.eligible.concat(edge.preparation.rejected).map((item) => [item.concept, item]));
  const origin = byConcept.get("chair");
  const far = byConcept.get("sofa");
  const pixel = edge.preparation.rejected.find((item) => item.concept === "table") ?? byConcept.get("table");
  const full = byConcept.get("lamp");
  assert.ok(origin && far && pixel && full);
  if (!origin || !far || !pixel || !full) return;
  assert.equal(origin.mask.bounds.x, 0);
  assert.equal(origin.mask.bounds.y, 0);
  assert.equal(origin.mask.bounds.width % 8 === 0, false);
  assert.equal(far.mask.bounds.x + far.mask.bounds.width, 41);
  assert.equal(far.mask.bounds.y + far.mask.bounds.height, 27);
  assert.equal(pixel.mask.areaPx, 1);
  assert.deepEqual(pixel.mask.bounds, { x: 5, y: 4, width: 1, height: 1 });
  assert.deepEqual(full.mask.bounds, { x: 0, y: 0, width: 41, height: 27 });
  for (const item of [origin, far, pixel, full]) {
    const wire = encodeRemoveMaskTransport(item.mask);
    assert.ok(wire);
    if (!wire) return;
    if (item.mask.areaPx === 1) assert.equal(wire.bits.length, 4);
    const decoded = decodeRemoveMaskTransport(wire, { width: 41, height: 27 });
    assert.ok(decoded);
    if (!decoded) return;
    assert.equal(sameBytes(decoded.bits, item.mask.bits), true);
    assert.deepEqual(decoded.bounds, item.mask.bounds);
  }

  const nested = normalize({
    concepts: ["chair", "lamp"],
    width: 100,
    height: 100,
    payload: documented({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [polygon(0.9, rect(5, 5, 85, 85))],
        lamp: [polygon(0.86, rect(20, 20, 40, 40))],
      },
    }),
  });
  assert.equal(nested.preparation.nested.length, 1);
  assert.equal(nested.preparation.suppressed.length, 0);
  for (const item of nested.preparation.eligible) {
    const decoded = decodeRemoveMaskTransport(
      encodeRemoveMaskTransport(item.mask),
      { width: 100, height: 100 },
    );
    assert.ok(decoded);
    if (!decoded) return;
    assert.equal(sameBytes(decoded.bits, item.mask.bits), true);
  }

  const duplicate = normalize({
    concepts: ["chair", "sofa"],
    width: 80,
    height: 80,
    payload: documented({
      concepts: ["chair", "sofa"],
      predictions: {
        chair: [polygon(0.91, rect(4, 4, 44, 44))],
        sofa: [polygon(0.62, rect(4, 4, 44, 44))],
      },
    }),
  });
  assert.equal(duplicate.preparation.suppressed.length, 1);
  const suppressed = duplicate.preparation.suppressed[0];
  assert.ok(suppressed && suppressed.iou >= 0.7);
  if (!suppressed) return;
  const kept = duplicate.preparation.eligible[0];
  assert.ok(kept);
  if (!kept) return;
  const decodedKept = decodeRemoveMaskTransport(encodeRemoveMaskTransport(kept.mask), { width: 80, height: 80 });
  const decodedDropped = decodeRemoveMaskTransport(
    encodeRemoveMaskTransport(suppressed.object.mask),
    { width: 80, height: 80 },
  );
  assert.ok(decodedKept && decodedDropped);
  if (!decodedKept || !decodedDropped) return;
  const overlap = removeMaskOverlap(decodedKept, decodedDropped);
  assert.ok(overlap && overlap.iou >= 0.7);

  const empty = normalize({
    concepts: ["chair"],
    width: 16,
    height: 16,
    payload: documented({
      concepts: ["chair"],
      predictions: { chair: [{ format: "polygon", confidence: 0.9, masks: [] }] },
    }),
  });
  const emptyMask = empty.preparation.rejected[0]?.mask;
  assert.ok(emptyMask);
  if (!emptyMask) return;
  assert.equal(emptyMask.areaPx, 0);
  assert.equal(empty.predictionRejections.length, 0);
  const emptyWire = encodeRemoveMaskTransport(emptyMask);
  assert.ok(emptyWire);
  if (!emptyWire) return;
  assert.equal(emptyWire.bits, "");
  assert.deepEqual(emptyWire.bounds, { x: 0, y: 0, width: 0, height: 0 });
  const emptyDecoded = decodeRemoveMaskTransport(emptyWire, { width: 16, height: 16 });
  assert.ok(emptyDecoded);
  if (!emptyDecoded) return;
  assert.equal(sameBytes(emptyDecoded.bits, emptyMask.bits), true);
  publish(empty, 16, 16);

  const wire = encodeRemoveMaskTransport(origin.mask);
  assert.ok(wire);
  if (!wire) return;
  const frame = { width: 41, height: 27 };
  assert.equal(decodeRemoveMaskTransport({ ...wire, encoding: "gzip" }, frame), null);
  assert.equal(decodeRemoveMaskTransport({ ...wire, bits: { codec: "gzip", data: wire.bits } }, frame), null);
  assert.equal(decodeRemoveMaskTransport({ ...wire, areaPx: wire.areaPx + 1 }, frame), null);
  assert.equal(decodeRemoveMaskTransport({ ...wire, width: 40 }, frame), null);
  assert.equal(decodeRemoveMaskTransport({
    ...wire,
    bounds: { x: -1, y: 0, width: wire.bounds.width, height: wire.bounds.height },
  }, frame), null);
  assert.equal(decodeRemoveMaskTransport({
    ...wire,
    bounds: { x: 0, y: 0, width: wire.bounds.width + 1, height: wire.bounds.height },
    bits: wire.bits,
  }, frame), null);
  assert.equal(decodeRemoveMaskTransport({ ...wire, bits: `${wire.bits}AAAA` }, frame), null);
  assert.equal(decodeRemoveMaskTransport({
    ...wire,
    bounds: { x: 0, y: 0, width: 1_000_000_000, height: 1_000_000_000 },
    bits: "A".repeat(5_000_000),
  }, frame), null);
  assert.equal(decodeRemoveMaskTransport({
    encoding: REMOVE_MASK_TRANSPORT_ENCODING,
    width: 41,
    height: 27,
    areaPx: 1,
    bounds: { x: 1.5, y: 0, width: 1, height: 1 },
    bits: "AQ==",
  }, frame), null);

  const isolated = normalize({
    concepts: ["chair", "lamp"],
    width: 32,
    height: 32,
    payload: documented({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [polygon(0.9, rect(1, 1, 22, 22))],
        lamp: [
          { format: "rle", confidence: 0.8, masks: { size: [32, 32], counts: "synthetic" } },
          { format: "json", confidence: 0.8, masks: [rect(1, 1, 22, 22)] },
          { format: "polygon", confidence: 0.8, masks: [rect(0, 0, 80, 10)] },
          { format: "polygon", confidence: 4, masks: [rect(1, 1, 22, 22)] },
          { format: "polygon", confidence: 0.8, masks: [[[1, 1, 1], [2, 2], [3, 3]]] },
          { format: "polygon", confidence: 0.8, masks: [[[1, 1], [2, 2]]] },
        ],
      },
    }),
  });
  assert.equal(isolated.preparation.eligible.length, 1);
  assert.equal(isolated.preparation.eligible[0]?.concept, "chair");
  assert.deepEqual(
    isolated.predictionRejections.map((item) => item.reason),
    [
      "unsupported_rle",
      "unsupported_encoding",
      "invalid_rasterization",
      "invalid_prediction",
      "invalid_polygon",
      "degenerate_polygon",
    ],
  );
  const crowded = Array.from({ length: 65 }, () => rect(1, 1, 8, 8));
  const rings = normalize({
    concepts: ["chair", "lamp"],
    width: 32,
    height: 32,
    payload: documented({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [polygon(0.9, rect(1, 1, 22, 22))],
        lamp: [{ format: "polygon", confidence: 0.8, masks: crowded }],
      },
    }),
  });
  assert.equal(rings.preparation.eligible.length, 1);
  assert.equal(rings.predictionRejections[0]?.reason, "polygon_ring_ceiling");
  const dense = [[0, 0], [2, 0]];
  for (let index = 0; index < 4000; index += 1) dense.push([2, index % 5]);
  const points = normalize({
    concepts: ["chair", "lamp"],
    width: 32,
    height: 32,
    payload: documented({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [polygon(0.9, rect(1, 1, 22, 22))],
        lamp: [{ format: "polygon", confidence: 0.8, masks: [dense] }],
      },
    }),
  });
  assert.equal(points.preparation.eligible.length, 1);
  assert.equal(points.predictionRejections[0]?.reason, "polygon_point_ceiling");
});

test("G. decoded masks match outline, hit, selection, protection, brush, and cleanup bits", () => {
  const width = 64;
  const height = 48;
  const result = normalize({
    concepts: ["chair", "lamp"],
    width,
    height,
    payload: documented({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [polygon(0.93, rect(0, 2, 24, 24))],
        lamp: [polygon(0.9, rect(30, 8, 52, 30))],
      },
    }),
  });
  assert.equal(result.preparation.eligible.length, 2);
  const published = publish(result, width, height);
  const loading = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity: identity(width, height),
  });
  const read = readRemoveObjectUiPayload(published.payload, identity(width, height));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.objects.length, 2);
  for (const object of read.objects) {
    const source = result.preparation.eligible.find((item) => item.id === object.id);
    assert.ok(source);
    if (!source) return;
    assert.equal(sameBytes(object.mask.bits, source.mask.bits), true);
    assert.deepEqual(removeObjectBoundaryPixels(object.mask), removeObjectBoundaryPixels(source.mask));
  }
  const chair = read.objects.find((item) => item.concept === "chair");
  assert.ok(chair);
  if (!chair) return;
  assert.equal(highlightRemoveObject({
    ...loading.state,
    phase: "ready",
    objects: read.objects,
    diagnostics: { ...read.diagnostics, elapsedMs: 1 },
  }, 4.2, 6.2), chair.id);
  const hidden = hideAllRemoveObjectUi({
    ...loading.state,
    phase: "ready",
    objects: read.objects,
    diagnostics: { ...read.diagnostics, elapsedMs: 1 },
  });
  assert.equal(hidden.selectedIds.size, 2);
  const shown = showAllRemoveObjectUi(hidden);
  assert.equal(shown.selectedIds.size, 0);
  const selected = hideAllRemoveObjects(read.objects);
  const directSelected = hideAllRemoveObjects(result.preparation.eligible);
  assert.deepEqual([...selected].sort(), [...directSelected].sort());
  const pixels = width * height;
  const bounds = { x: 0, y: 0, width, height };
  const brush = new Uint8Array(pixels);
  brush[40 * width + 4] = 200;
  const compared = [
    paintRemoveObjectProtection({
      destination: new Uint8Array(pixels),
      width,
      height,
      objects: read.objects,
      bounds,
    }),
    paintRemoveObjectProtection({
      destination: new Uint8Array(pixels),
      width,
      height,
      objects: result.preparation.eligible,
      bounds,
    }),
  ];
  assert.equal(compared[0], true);
  assert.equal(compared[1], true);
  const protectedDecoded = new Uint8Array(pixels);
  const protectedSource = new Uint8Array(pixels);
  paintRemoveObjectProtection({ destination: protectedDecoded, width, height, objects: read.objects, bounds });
  paintRemoveObjectProtection({
    destination: protectedSource,
    width,
    height,
    objects: result.preparation.eligible,
    bounds,
  });
  assert.equal(sameBytes(protectedDecoded, protectedSource), true);
  const decodedCoverage = new Uint8Array(pixels);
  const sourceCoverage = new Uint8Array(pixels);
  const decodedDilated = new Uint8Array(pixels);
  const sourceDilated = new Uint8Array(pixels);
  const decodedUnion = new Uint8Array(pixels);
  const sourceUnion = new Uint8Array(pixels);
  const writtenDecoded = syncRemoveInspectionCoverage({
    brush,
    objectUnion: decodedUnion,
    dilated: decodedDilated,
    destination: decodedCoverage,
    width,
    height,
    objects: read.objects,
    selectedIds: selected,
    bounds,
    expansionPx: 2,
  });
  const writtenSource = syncRemoveInspectionCoverage({
    brush,
    objectUnion: sourceUnion,
    dilated: sourceDilated,
    destination: sourceCoverage,
    width,
    height,
    objects: result.preparation.eligible,
    selectedIds: directSelected,
    bounds,
    expansionPx: 2,
  });
  assert.deepEqual(writtenDecoded, writtenSource);
  assert.equal(sameBytes(decodedCoverage, sourceCoverage), true);
  const cleanupDecoded = snapshotRemoveCleanupObjects(hiddenRemoveCleanupObjects(read.objects, selected));
  const cleanupSource = snapshotRemoveCleanupObjects(
    hiddenRemoveCleanupObjects(result.preparation.eligible, directSelected),
  );
  assert.equal(cleanupDecoded.length, cleanupSource.length);
  for (const item of cleanupDecoded) {
    const source = cleanupSource.find((candidate) => candidate.id === item.id);
    assert.ok(source);
    if (!source) return;
    assert.equal(sameBytes(item.bits, source.bits), true);
    assert.equal(item.bits.byteLength, Math.ceil((width * height) / 8));
  }
});

test("scan diagnostics distinguish empty, filtered, partial, failed, and blocked results", () => {
  assert.equal(formatRemoveScanStatus({
    phase: "ready",
    error: null,
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 0,
  }), REMOVE_SCAN_NO_OBJECTS);
  assert.equal(formatRemoveScanStatus({
    phase: "ready",
    error: null,
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 2,
    suppressedCount: 0,
    predictionRejectionCount: 0,
  }), REMOVE_SCAN_NONE_USABLE);
  assert.equal(formatRemoveScanStatus({
    phase: "ready",
    error: null,
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 1,
  }), REMOVE_SCAN_NONE_USABLE);
  assert.equal(formatRemoveScanStatus({
    phase: "ready",
    error: null,
    eligibleCount: 10,
    hiddenCount: 2,
    rejectedCount: 0,
    suppressedCount: 1,
    predictionRejectionCount: 0,
  }), "10 objects, 2 hidden (1 suppressed)");
  assert.equal(formatRemoveScanStatus({
    phase: "ready",
    error: null,
    eligibleCount: 7,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 1,
  }), "7 objects (1 rejected)");
  assert.equal(formatRemoveScanStatus({
    phase: "error",
    error: "Segmentation provider timed out.",
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 0,
  }), "Segmentation provider timed out.");
  assert.equal(formatRemoveScanStatus({
    phase: "error",
    error: REMOVE_SCAN_PAYLOAD_CEILING,
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 0,
  }), REMOVE_SCAN_PAYLOAD_CEILING);
  assert.equal(formatRemoveScanStatus({
    phase: "error",
    error: REMOVE_SCAN_NOT_READY,
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 0,
  }), REMOVE_SCAN_NOT_READY);
  assert.equal(formatRemoveScanStatus({
    phase: "error",
    error: REMOVE_SCAN_IMAGE_LIMIT,
    eligibleCount: 0,
    hiddenCount: 0,
    rejectedCount: 0,
    suppressedCount: 0,
    predictionRejectionCount: 0,
  }), REMOVE_SCAN_IMAGE_LIMIT);
  assert.notEqual(REMOVE_SCAN_NO_OBJECTS, REMOVE_SCAN_NONE_USABLE);
  assert.notEqual(REMOVE_SCAN_NONE_USABLE, REMOVE_SCAN_PAYLOAD_CEILING);
  assert.notEqual(REMOVE_SCAN_PAYLOAD_CEILING, REMOVE_SCAN_NOT_READY);
  assert.notEqual(REMOVE_SCAN_NOT_READY, REMOVE_SCAN_IMAGE_LIMIT);
  assert.equal(formatRemovePredictionRejections([
    { concept: "lamp", ordinal: 1, reason: "unsupported_rle" },
  ]), "lamp #1: unsupported_rle");

  const filtered = normalize({
    concepts: ["chair"],
    width: 32,
    height: 32,
    payload: documented({
      concepts: ["chair"],
      predictions: { chair: [polygon(0.2, rect(1, 1, 24, 24))] },
    }),
  });
  assert.equal(filtered.preparation.eligible.length, 0);
  assert.equal(filtered.preparation.rejected.length, 1);
  const published = publish(filtered, 32, 32);
  const read = readRemoveObjectUiPayload(published.payload, identity(32, 32));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.objects.length, 0);
  assert.equal(read.diagnostics.rejected.length, 1);
  assert.equal(formatRemoveScanStatus({
    phase: "ready",
    error: null,
    eligibleCount: read.objects.length,
    hiddenCount: 0,
    rejectedCount: read.diagnostics.rejected.length,
    suppressedCount: read.diagnostics.suppressed.length,
    predictionRejectionCount: read.diagnostics.predictionRejections.length,
  }), REMOVE_SCAN_NONE_USABLE);
});

function solidMask(width: number, height: number): RemovePackedMask {
  const pixels = width * height;
  const bits = new Uint8Array(Math.ceil(pixels / 8));
  bits.fill(0xff);
  const leftover = pixels % 8;
  if (leftover !== 0) bits[bits.length - 1] = (1 << leftover) - 1;
  return {
    width,
    height,
    areaPx: pixels,
    bounds: { x: 0, y: 0, width, height },
    bits,
  };
}
