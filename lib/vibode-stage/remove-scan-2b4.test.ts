import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { REMOVE_CLEANUP_CONCEPT_SET } from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  parseRemoveCleanupExportRequest,
  removeCleanupIdDigest,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";
import { REMOVE_MASK_TRANSPORT_ENCODING, encodeRemoveMaskTransport } from "@/lib/vibode-stage/remove-mask-transport";
import {
  initialRemoveObjectUiState,
  reduceRemoveObjectSession,
  removeObjectUiRequestBody,
  type RemoveObjectUiState,
} from "@/lib/vibode-stage/remove-object-ui";
import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";
import {
  REMOVE_SEGMENTATION_CONCEPT_SET,
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_CONCEPTS_V2,
  REMOVE_SEGMENTATION_MAX_CONCEPTS,
  REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH,
  ROBOFLOW_CONCEPT_SEGMENT_URL,
  ROBOFLOW_SAM3_POLYGON_SCHEMA,
  buildRoboflowConceptSegmentRequest,
  isRecognizedRemoveSegmentationConcept,
  isRemoveSegmentationVocabulary,
  normalizeRoboflowConceptSegment,
  type RemoveSegmentationImage,
  type RemoveSegmentationSuccess,
} from "@/lib/vibode-stage/remove-segmentation";

const SHA = "ab".repeat(32);
const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const V2 = [
  "chair",
  "sofa",
  "table",
  "lamp",
  "rug",
  "curtain",
  "plant",
  "framed picture",
  "bed",
  "pillow",
  "decoration",
  "cabinet",
  "television",
  "mirror",
  "stool",
  "bookcase",
] as const;

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function image(): RemoveSegmentationImage {
  return {
    bytes: Uint8Array.from([1, 2, 3, 4]),
    width: 64,
    height: 64,
    sha256: SHA,
    mimeType: "image/png",
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function promptsOf(concepts: readonly string[], predictions: Readonly<Record<string, readonly unknown[]>> = {}) {
  return {
    time: 0.2,
    prompt_results: concepts.map((text, promptIndex) => ({
      prompt_index: promptIndex,
      echo: { prompt_index: promptIndex, type: "text", text, num_boxes: 0 },
      predictions: predictions[text] ?? [],
    })),
  };
}

function polygon(confidence: number, ring: number[][]) {
  return { format: "polygon", confidence, masks: [ring] };
}

function requireSuccess(
  concepts: readonly string[],
  predictions: Readonly<Record<string, readonly unknown[]>>,
  width = 64,
  height = 64,
): RemoveSegmentationSuccess {
  const result = normalizeRoboflowConceptSegment({
    payload: promptsOf(concepts, predictions),
    concepts,
    originalWidth: width,
    originalHeight: height,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("normalize");
  return result;
}

test("vocabulary v2 is the same 16 concepts with two in-place replacements", () => {
  assert.deepEqual([...REMOVE_SEGMENTATION_CONCEPTS_V2], [...V2]);
  assert.equal(REMOVE_SEGMENTATION_CONCEPTS_V2.length, REMOVE_SEGMENTATION_MAX_CONCEPTS);
  assert.equal(REMOVE_SEGMENTATION_CONCEPTS_V1.length, REMOVE_SEGMENTATION_CONCEPTS_V2.length);
  assert.deepEqual(
    REMOVE_SEGMENTATION_CONCEPTS_V1.map((previous, index) => [previous, REMOVE_SEGMENTATION_CONCEPTS_V2[index]]),
    [
      ["chair", "chair"],
      ["sofa", "sofa"],
      ["table", "table"],
      ["lamp", "lamp"],
      ["rug", "rug"],
      ["curtain", "curtain"],
      ["plant", "plant"],
      ["wall art", "framed picture"],
      ["bed", "bed"],
      ["pillow", "pillow"],
      ["decoration", "decoration"],
      ["cabinet", "cabinet"],
      ["television", "television"],
      ["mirror", "mirror"],
      ["stool", "stool"],
      ["bookshelf", "bookcase"],
    ],
  );
  assert.equal(isRemoveSegmentationVocabulary(REMOVE_SEGMENTATION_CONCEPTS_V2), true);
  assert.equal(isRemoveSegmentationVocabulary(REMOVE_SEGMENTATION_CONCEPTS_V1), false);
  assert.equal(REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH, 0.5);
  assert.equal(REMOVE_SEGMENTATION_CONCEPT_SET, "remove-segmentation-concepts/v1");
  assert.equal(REMOVE_CLEANUP_CONCEPT_SET, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(ROBOFLOW_SAM3_POLYGON_SCHEMA, "roboflow-serverless-concept-segment-polygon/0.64.4");
});

test("the provider request sends bookcase and framed picture once and omits the old terms", async () => {
  const built = buildRoboflowConceptSegmentRequest({
    image: image(),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V2,
    requestId: "request-v2",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const builtBody = JSON.parse(built.body) as {
    format: string;
    output_prob_thresh: number;
    prompts: Array<{ type: string; text: string }>;
  };
  assert.equal(builtBody.format, "polygon");
  assert.equal(builtBody.output_prob_thresh, 0.5);
  assert.deepEqual(builtBody.prompts.map((prompt) => prompt.text), [...V2]);
  assert.equal(built.body.includes("bookshelf"), false);
  assert.equal(built.body.includes("wall art"), false);

  const retired = buildRoboflowConceptSegmentRequest({
    image: image(),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    requestId: "request-v1",
  });
  assert.deepEqual(retired, { ok: false, error: "request_rejected", detail: "concepts" });

  const calls: string[] = [];
  const provider = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async (url, init) => {
      calls.push(String(init?.body));
      assert.equal(String(url), ROBOFLOW_CONCEPT_SEGMENT_URL);
      assert.equal(init?.method, "POST");
      assert.equal(init?.cache, "no-store");
      return Response.json(promptsOf(REMOVE_SEGMENTATION_CONCEPTS_V2));
    },
  });
  const sent = await provider.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V2);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(sent.schema, ROBOFLOW_SAM3_POLYGON_SCHEMA);
  assert.equal(sent.outputProbThresh, 0.5);
  assert.equal(sent.providerNms, "disabled");
  assert.equal(calls.length, 1);
  const wire = JSON.parse(calls[0] ?? "{}") as { prompts: Array<{ text: string }> };
  assert.deepEqual(wire.prompts.map((prompt) => prompt.text), [...V2]);
  assert.equal(wire.prompts.some((prompt) => prompt.text === "bookshelf" || prompt.text === "wall art"), false);

  const blocked = await provider.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V1);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.detail, "concepts");
  assert.equal(calls.length, 1);
});

test("new labels keep object ids, bounded-bits transport, and short-ring salvage", () => {
  const result = requireSuccess(REMOVE_SEGMENTATION_CONCEPTS_V2, {
    chair: [polygon(0.93, rect(2, 2, 28, 28))],
    "framed picture": [polygon(0.957, rect(2, 34, 28, 60))],
    bookcase: [polygon(0.531, rect(34, 2, 60, 28))],
  });
  assert.equal(result.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(result.predictionRejections.length, 0);
  assert.equal(result.preparation.suppressed.length, 0);
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.concept),
    ["chair", "framed picture", "bookcase"],
  );
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.id.slice(0, item.id.lastIndexOf("-"))),
    ["v1-chair-0", "v1-framed-picture-0", "v1-bookcase-0"],
  );
  for (const item of result.preparation.eligible) {
    const wire = encodeRemoveMaskTransport(item.mask);
    assert.ok(wire);
    if (!wire) return;
    assert.equal(wire.encoding, REMOVE_MASK_TRANSPORT_ENCODING);
    assert.equal(wire.encoding, "bounded-bits/v1");
    assert.equal(wire.width, 64);
    assert.equal(wire.height, 64);
    assert.ok(item.mask.areaPx >= 400);
  }

  const salvaged = requireSuccess(
    ["bookcase"],
    { bookcase: [{ format: "polygon", confidence: 0.91, masks: [[[0, 0], [63, 63]], rect(4, 4, 40, 36)] }] },
  );
  const control = requireSuccess(
    ["bookcase"],
    { bookcase: [polygon(0.91, rect(4, 4, 40, 36))] },
  );
  assert.equal(salvaged.predictionRejections.length, 0);
  assert.equal(salvaged.preparation.eligible.length, 1);
  assert.equal(salvaged.preparation.eligible[0]?.concept, "bookcase");
  assert.equal(salvaged.preparation.eligible[0]?.id, control.preparation.eligible[0]?.id);
  assert.deepEqual(
    salvaged.preparation.eligible[0]?.mask.bits,
    control.preparation.eligible[0]?.mask.bits,
  );
});

test("cleanup still accepts previous labels and the two replacements", () => {
  for (const concept of ["chair", "bookshelf", "wall art", "bookcase", "framed picture"]) {
    assert.equal(isRecognizedRemoveSegmentationConcept(concept), true);
    const parsed = parseRemoveCleanupExportRequest(cleanupBody(concept));
    assert.equal(parsed.ok, true, concept);
    if (!parsed.ok) return;
    assert.equal(parsed.request.objects[0]?.concept, concept);
    assert.match(parsed.request.objects[0]?.id ?? "", new RegExp(`^v1-${concept.replaceAll(" ", "-")}-0-[0-9a-f]{8}$`));
  }
  assert.equal(isRecognizedRemoveSegmentationConcept("ottoman"), false);
  const rejected = parseRemoveCleanupExportRequest(cleanupBody("ottoman"));
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.reason, "Segmentation concept is not supported.");
});

test("an open Remove session does not start another scan when the vocabulary changes underneath it", () => {
  const identity = {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: 64,
    originalHeight: 64,
    sessionSerial: 4,
    vocabularyRevision: 0,
  };
  const ready: RemoveObjectUiState = {
    phase: "ready",
    identity,
    requestSerial: 2,
    objects: [],
    selectedIds: new Set(),
    error: null,
    diagnostics: null,
  };
  const held = reduceRemoveObjectSession({
    state: ready,
    active: true,
    identity,
  });
  assert.equal(held.command, "none");
  assert.equal(held.state, ready);
  const entered = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity,
  });
  assert.equal(entered.command, "fetch");
  assert.deepEqual(JSON.parse(removeObjectUiRequestBody(identity)), {
    roomId: ROOM,
    generationId: GENERATION,
  });

  const handler = source("lib/vibode-stage/remove-segmentation-admin.ts");
  const client = source("lib/vibode-stage/remove-segmentation-roboflow.server.ts");
  const quota = source("lib/vibode-stage/remove-segmentation-quota.server.ts");
  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const worker = source("cleanup-worker/src/index.ts");
  assert.equal(handler.match(/\.segment\(/g)?.length, 1);
  assert.match(handler, /selectRemoveScanVocabulary/);
  assert.doesNotMatch(handler, /REMOVE_SEGMENTATION_CONCEPTS_V1|bookshelf|wall art|retry/);
  assert.equal(client.match(/fetchImpl\(/g)?.length, 1);
  assert.doesNotMatch(client, /retry|fallback|visual_segment/);
  assert.match(quota, /reserve_vibode_remove_segmentation/);
  assert.doesNotMatch(quota, /bookcase|framed picture|bookshelf|wall art/);
  assert.equal(session.match(/loadBringForwardScan\(/g)?.length, 1);
  assert.equal(session.match(/requestRemoveObjects\(/g)?.length ?? 0, 0);
  assert.doesNotMatch(session, /REMOVE_SEGMENTATION_CONCEPTS|serverless\.roboflow/);
  assert.doesNotMatch(worker, /bookcase|framed picture|concept_segment/);
});

function cleanupBody(concept: string): Uint8Array {
  const bits = new Uint8Array(8);
  bits[0] = 0b0000_0111;
  const confidence = 0.93;
  const slug = concept.replaceAll(" ", "-");
  const body = {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalDecodedWidth: 8,
    originalDecodedHeight: 8,
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    conceptSet: REMOVE_CLEANUP_CONCEPT_SET,
    schema: ROBOFLOW_SAM3_POLYGON_SCHEMA,
    coordinateBasis: "original-decoded-pixels-v1",
    referenceExpansionPx: 0,
    selectedObjects: [{
      id: `v1-${slug}-0-${removeCleanupIdDigest(bits, confidence)}`,
      concept,
      confidence,
      maskSha256: sha256Hex(bits),
      bits: Buffer.from(bits).toString("base64"),
    }],
  };
  return new TextEncoder().encode(JSON.stringify(body));
}
