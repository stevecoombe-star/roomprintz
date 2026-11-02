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
import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";
import {
  REMOVE_SEGMENTATION_CONCEPT_SET,
  REMOVE_SEGMENTATION_CONCEPTS_BEDROOM,
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_CONCEPTS_V2,
  REMOVE_SEGMENTATION_MAX_CONCEPTS,
  REMOVE_SEGMENTATION_MODEL_ID,
  REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH,
  REMOVE_VOCABULARY_PROFILE_IDS,
  REMOVE_VOCABULARY_PROFILES,
  ROBOFLOW_CONCEPT_SEGMENT_URL,
  ROBOFLOW_SAM3_POLYGON_SCHEMA,
  buildRoboflowConceptSegmentRequest,
  isRecognizedRemoveSegmentationConcept,
  isRemoveSegmentationVocabulary,
  normalizeRoboflowConceptSegment,
  removeVocabularyForProfile,
  resolveRemoveVocabularyProfile,
  type RemoveSegmentationImage,
  type RemoveSegmentationSuccess,
} from "@/lib/vibode-stage/remove-segmentation";

const SHA = "ab".repeat(32);
const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";

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

function polygon(confidence: number, ring: number[][], extraRings: number[][][] = []) {
  return { format: "polygon", confidence, masks: [...extraRings, ring] };
}

function requireSuccess(
  concepts: readonly string[],
  predictions: Readonly<Record<string, readonly unknown[]>> = {},
): RemoveSegmentationSuccess {
  const result = normalizeRoboflowConceptSegment({
    payload: promptsOf(concepts, predictions),
    concepts,
    originalWidth: 64,
    originalHeight: 64,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("normalize");
  return result;
}

test("registered profiles are two 16-concept lists and the bedroom list changes two slots", () => {
  assert.deepEqual([...REMOVE_VOCABULARY_PROFILE_IDS], ["default", "bedroom"]);
  assert.equal(REMOVE_VOCABULARY_PROFILES.default, REMOVE_SEGMENTATION_CONCEPTS_V2);
  assert.equal(REMOVE_VOCABULARY_PROFILES.bedroom, REMOVE_SEGMENTATION_CONCEPTS_BEDROOM);
  for (const concepts of Object.values(REMOVE_VOCABULARY_PROFILES)) {
    assert.equal(concepts.length, REMOVE_SEGMENTATION_MAX_CONCEPTS);
    assert.equal(new Set(concepts).size, concepts.length);
    assert.equal(concepts.every((concept) => concept.trim() === concept && concept.length > 0), true);
  }
  const changed = REMOVE_SEGMENTATION_CONCEPTS_V2
    .map((concept, index) => [concept, REMOVE_SEGMENTATION_CONCEPTS_BEDROOM[index]] as const)
    .filter(([previous, next]) => previous !== next);
  assert.deepEqual(changed, [
    ["table", "nightstand"],
    ["cabinet", "dresser"],
  ]);
});

test("unknown and invalid profiles resolve to V2 and only bedroom selects the bedroom list", () => {
  assert.equal(resolveRemoveVocabularyProfile("default"), "default");
  assert.equal(resolveRemoveVocabularyProfile("living"), "default");
  assert.equal(resolveRemoveVocabularyProfile("bedroom"), "bedroom");
  assert.deepEqual([...removeVocabularyForProfile("living")], [...REMOVE_SEGMENTATION_CONCEPTS_V2]);
  assert.deepEqual([...removeVocabularyForProfile("bedroom")], [...REMOVE_SEGMENTATION_CONCEPTS_BEDROOM]);

  const fallbacks = [
    undefined,
    null,
    "",
    "unknown",
    "missing",
    "stale",
    "mixed",
    "mixed-use",
    "dining",
    "office",
    "kitchen",
    "bathroom",
    "family",
    "other",
    "auto",
    "living-room",
    "living_room",
    "Bedroom",
    "bedroom ",
    "Living Room",
  ];
  for (const profile of fallbacks) {
    assert.equal(resolveRemoveVocabularyProfile(profile), "default", String(profile));
    assert.deepEqual([...removeVocabularyForProfile(profile)], [...REMOVE_SEGMENTATION_CONCEPTS_V2]);
  }
});

test("the scan handler still sends V2 and unregistered lists never reach Roboflow", async () => {
  const handler = source("lib/vibode-stage/remove-segmentation-admin.ts");
  const client = source("lib/vibode-stage/remove-segmentation-roboflow.server.ts");
  const worker = source("cleanup-worker/src/index.ts");
  assert.equal(handler.match(/\.segment\(/g)?.length, 1);
  assert.match(handler, /REMOVE_SEGMENTATION_CONCEPTS_V2/);
  assert.doesNotMatch(handler, /REMOVE_SEGMENTATION_CONCEPTS_BEDROOM|nightstand|dresser|removeVocabularyForProfile/);
  assert.equal(client.match(/fetchImpl\(/g)?.length, 1);
  assert.doesNotMatch(worker, /nightstand|dresser|concept_segment/);

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

  const live = await provider.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_V2);
  assert.equal(live.ok, true);
  if (!live.ok) return;
  assert.equal(calls.length, 1);
  assert.equal(live.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(live.modelId, REMOVE_SEGMENTATION_MODEL_ID);
  assert.equal(live.outputProbThresh, REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH);
  assert.equal(live.providerNms, "disabled");
  const wire = JSON.parse(calls[0] ?? "{}") as {
    model_id: string;
    format: string;
    output_prob_thresh: number;
    prompts: Array<{ text: string }>;
  };
  assert.equal(wire.model_id, REMOVE_SEGMENTATION_MODEL_ID);
  assert.equal(wire.format, "polygon");
  assert.equal(wire.output_prob_thresh, 0.5);
  assert.deepEqual(wire.prompts.map((prompt) => prompt.text), [...REMOVE_SEGMENTATION_CONCEPTS_V2]);

  const blocked = [
    REMOVE_SEGMENTATION_CONCEPTS_V1,
    [...REMOVE_SEGMENTATION_CONCEPTS_V2, "ottoman"],
    ["ottoman", "floor", "wall", "window"],
    [...REMOVE_SEGMENTATION_CONCEPTS_V2].reverse(),
    REMOVE_SEGMENTATION_CONCEPTS_V2.map((concept) => (concept === "table" ? "nightstand" : concept)),
    Array.from({ length: 16 }, () => "chair"),
  ];
  for (const concepts of blocked) {
    const built = buildRoboflowConceptSegmentRequest({
      image: image(),
      concepts,
      requestId: "blocked",
    });
    assert.deepEqual(built, { ok: false, error: "request_rejected", detail: "concepts" });
    const result = await provider.segment(image(), concepts);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.detail, "concepts");
  }
  assert.equal(calls.length, 1);
  assert.equal(isRemoveSegmentationVocabulary(REMOVE_SEGMENTATION_CONCEPTS_V2), true);
  assert.equal(isRemoveSegmentationVocabulary(REMOVE_SEGMENTATION_CONCEPTS_BEDROOM), true);
  assert.equal(isRemoveSegmentationVocabulary(REMOVE_SEGMENTATION_CONCEPTS_V1), false);
});

test("a registered bedroom request keeps one polygon call and the shared concept-set id", async () => {
  const built = buildRoboflowConceptSegmentRequest({
    image: image(),
    concepts: REMOVE_SEGMENTATION_CONCEPTS_BEDROOM,
    requestId: "bedroom-request",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const body = JSON.parse(built.body) as {
    model_id: string;
    format: string;
    output_prob_thresh: number;
    nms_iou_threshold?: number;
    prompts: Array<{ type: string; text: string }>;
  };
  assert.equal(body.model_id, REMOVE_SEGMENTATION_MODEL_ID);
  assert.equal(body.format, "polygon");
  assert.equal(body.output_prob_thresh, 0.5);
  assert.equal(body.nms_iou_threshold, undefined);
  assert.deepEqual(body.prompts.map((prompt) => prompt.text), [...REMOVE_SEGMENTATION_CONCEPTS_BEDROOM]);
  assert.equal(body.prompts.some((prompt) => prompt.text === "table" || prompt.text === "cabinet"), false);

  const calls: string[] = [];
  const provider = createRoboflowRemoveSegmentationProvider({
    apiKey: "roboflow-test-key",
    fetch: async (_url, init) => {
      calls.push(String(init?.body));
      return Response.json(promptsOf(REMOVE_SEGMENTATION_CONCEPTS_BEDROOM));
    },
  });
  const sent = await provider.segment(image(), REMOVE_SEGMENTATION_CONCEPTS_BEDROOM);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(calls.length, 1);
  assert.equal(sent.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(sent.conceptSet, REMOVE_CLEANUP_CONCEPT_SET);
  assert.equal(sent.schema, ROBOFLOW_SAM3_POLYGON_SCHEMA);
  assert.equal(sent.maskEncoding, "polygon");
  assert.equal(sent.providerNms, "disabled");
});

test("synthetic bedroom predictions keep two nightstands, one dresser, and suppress the duplicate pillow", () => {
  const nightstand = rect(2, 2, 28, 28);
  const otherNightstand = rect(36, 2, 62, 30);
  const dresser = rect(2, 36, 40, 62);
  const pillow = rect(42, 36, 62, 62);
  const result = requireSuccess(REMOVE_SEGMENTATION_CONCEPTS_BEDROOM, {
    nightstand: [
      polygon(0.937, otherNightstand),
      polygon(0.859, nightstand),
    ],
    dresser: [polygon(0.957, dresser, [[[0, 0], [63, 63]]])],
    pillow: [
      polygon(0.914, pillow),
      polygon(0.625, pillow),
    ],
  });
  assert.equal(result.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(result.predictionRejections.length, 0);
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.concept),
    ["nightstand", "nightstand", "pillow", "dresser"],
  );
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.id.slice(0, item.id.lastIndexOf("-"))),
    ["v1-nightstand-0", "v1-nightstand-1", "v1-pillow-0", "v1-dresser-0"],
  );
  assert.deepEqual(
    result.preparation.eligible.map((item) => item.confidence),
    [0.937, 0.859, 0.914, 0.957],
  );
  for (const item of result.preparation.eligible) {
    assert.ok(item.mask.areaPx >= 400);
    const wire = encodeRemoveMaskTransport(item.mask);
    assert.ok(wire);
    if (!wire) return;
    assert.equal(wire.encoding, REMOVE_MASK_TRANSPORT_ENCODING);
    assert.equal(wire.encoding, "bounded-bits/v1");
    assert.equal(wire.width, 64);
    assert.equal(wire.height, 64);
  }

  assert.equal(result.preparation.suppressed.length, 1);
  const suppressed = result.preparation.suppressed[0];
  assert.ok(suppressed);
  if (!suppressed) return;
  assert.equal(suppressed.suppressedConcept, "pillow");
  assert.equal(suppressed.retainedConcept, "pillow");
  assert.equal(suppressed.suppressedConfidence, 0.625);
  assert.equal(suppressed.retainedConfidence, 0.914);
  assert.equal(suppressed.reason, "higher_confidence");
  assert.ok(suppressed.iou >= 0.7);
  assert.match(suppressed.suppressedId, /^v1-pillow-1-[0-9a-f]{8}$/);

  const control = requireSuccess(["dresser"], {
    dresser: [polygon(0.957, dresser)],
  });
  assert.equal(result.preparation.eligible[3]?.id, control.preparation.eligible[0]?.id);
  assert.deepEqual(result.preparation.eligible[3]?.mask.bits, control.preparation.eligible[0]?.mask.bits);
  assert.equal(control.conceptSet, "remove-segmentation-concepts/unversioned");
});

test("historical V1 fixtures and living-room labels stay on the Clean Up concept set", () => {
  const payload = JSON.parse(readFileSync(
    new URL("./fixtures/roboflow-sam3-polygon-live.json", import.meta.url),
    "utf8",
  ));
  const historical = normalizeRoboflowConceptSegment({
    payload,
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    originalWidth: 960,
    originalHeight: 640,
  });
  assert.equal(historical.ok, true);
  if (!historical.ok) return;
  assert.equal(historical.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(historical.preparation.eligible.length, 10);
  assert.equal(historical.preparation.suppressed.length, 1);
  assert.equal(historical.preparation.eligible.some((item) => item.concept === "table"), true);
  assert.equal(historical.preparation.eligible.some((item) => item.concept === "nightstand"), false);

  const living = requireSuccess(REMOVE_SEGMENTATION_CONCEPTS_V2, {
    chair: [polygon(0.93, rect(2, 2, 28, 28))],
    "framed picture": [polygon(0.957, rect(2, 34, 28, 60))],
    bookcase: [polygon(0.531, rect(34, 2, 60, 28))],
  });
  assert.equal(living.conceptSet, REMOVE_CLEANUP_CONCEPT_SET);
  assert.deepEqual(
    living.preparation.eligible.map((item) => item.id.slice(0, item.id.lastIndexOf("-"))),
    ["v1-chair-0", "v1-framed-picture-0", "v1-bookcase-0"],
  );

  const arbitrary = requireSuccess(Array.from({ length: 16 }, (_unused, index) => `concept-${index}`));
  assert.equal(arbitrary.conceptSet, "remove-segmentation-concepts/unversioned");
  assert.equal(isRemoveSegmentationVocabulary(Array.from({ length: 16 }, (_unused, index) => `concept-${index}`)), false);
});

test("Clean Up accepts bedroom labels and every previously accepted label", () => {
  const accepted = [
    ...REMOVE_SEGMENTATION_CONCEPTS_V1,
    ...REMOVE_SEGMENTATION_CONCEPTS_V2,
    "nightstand",
    "dresser",
  ];
  for (const concept of accepted) {
    assert.equal(isRecognizedRemoveSegmentationConcept(concept), true, concept);
    const parsed = parseRemoveCleanupExportRequest(cleanupBody(concept));
    assert.equal(parsed.ok, true, concept);
    if (!parsed.ok) return;
    assert.equal(parsed.request.objects[0]?.concept, concept);
  }
  assert.equal(isRecognizedRemoveSegmentationConcept("ottoman"), false);
  assert.equal(isRecognizedRemoveSegmentationConcept("bedside table"), false);
  assert.equal(isRecognizedRemoveSegmentationConcept("chest of drawers"), false);
  const rejected = parseRemoveCleanupExportRequest(cleanupBody("ottoman"));
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.reason, "Segmentation concept is not supported.");
  const bumped = JSON.parse(new TextDecoder().decode(cleanupBody("nightstand"))) as { conceptSet: string };
  bumped.conceptSet = "remove-segmentation-concepts/v2";
  const bumpedResult = parseRemoveCleanupExportRequest(new TextEncoder().encode(JSON.stringify(bumped)));
  assert.equal(bumpedResult.ok, false);
  if (bumpedResult.ok) return;
  assert.equal(bumpedResult.reason, "Segmentation provider is not supported.");
  const contract = source("lib/vibode-stage/remove-cleanup-contract.ts");
  const worker = source("cleanup-worker/src/index.ts");
  assert.equal(contract.includes("nightstand"), false);
  assert.equal(worker.includes("nightstand"), false);
  assert.equal(REMOVE_CLEANUP_CONCEPT_SET, "remove-segmentation-concepts/v1");
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
