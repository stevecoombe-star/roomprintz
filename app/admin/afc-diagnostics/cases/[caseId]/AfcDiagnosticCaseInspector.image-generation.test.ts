import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afcImageGenerationProvenance } from "@/lib/afc-image-models";
import { parseAfcDiagnosticInspectorGenerationEvidence } from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";

import { EngineDetails } from "./AfcDiagnosticCaseInspector";

const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function fingerprint(imageGeneration?: ReturnType<typeof afcImageGenerationProvenance>) {
  return {
    fingerprintSchemaVersion: "afc-v2-engine-fingerprint/v1",
    productionSchemaVersion: "afc-v2-production-room-authority/v1",
    gitSha: "abc123def456",
    observationModelId: "obs-model",
    engineVersions: {
      liveProduct: "lp",
      autoMetric: "am",
      cameraCalibration: "cc",
      cameraAuthority: "ca",
      collision: "col",
      emptyAuthoritativeCollision: "eac",
    },
    tiled: {
      generatorId: "gen",
      profileId: "prof",
      researchPreset: "preset",
      requestedModelId: "NBP",
      readerVersion: null,
    },
    ...(imageGeneration ? { imageGeneration } : {}),
  };
}

test("failed Sunburst provenance renders in the diagnostic inspector", () => {
  const imageGeneration = afcImageGenerationProvenance({
    empty: "gpt-image-2.5-sunburst-high",
    tiled: "nano-banana-pro",
  });
  const parsed = parseAfcDiagnosticInspectorGenerationEvidence({
    generationId: GENERATION_ID,
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: null,
    lineageSeq: 1,
    runId: "44444444-4444-4444-8444-444444444444",
    intent: "analyze",
    status: "failed",
    createdAt: "2026-10-01T04:06:23.297Z",
    completedAt: "2026-10-01T04:07:18.811Z",
    frame: { width: 1200, height: 896 },
    failureReason: "tiled_lineage_not_exact_grid",
    metricStatus: null,
    collisionStatus: null,
    analysisStatus: "failed",
    analysisReason: "tiled_lineage_not_exact_grid",
    recoverySafeFailureState: null,
    engineFingerprint: fingerprint(imageGeneration),
    original: null,
    empty: { present: true, sha256: "a".repeat(64), artifactSource: "generated" },
    tiled: { present: true, sha256: "b".repeat(64), artifactSource: "generated" },
  });
  assert.ok(parsed?.engineFingerprint);
  assert.equal(parsed.engineFingerprint.imageGeneration?.empty.provider, "openai");
  assert.equal(
    parsed.engineFingerprint.imageGeneration?.empty.modelId,
    "gpt-image-2.5-sunburst-2026-09-08",
  );
  assert.equal(parsed.engineFingerprint.imageGeneration?.empty.quality, "high");
  assert.equal(parsed.engineFingerprint.imageGeneration?.empty.stage, "empty");

  const html = renderToStaticMarkup(
    createElement(EngineDetails, { fingerprint: parsed.engineFingerprint }),
  );
  assert.match(html, /EMPTY image model/);
  assert.match(html, /GPT Image 2\.5 Sunburst High/);
  assert.match(html, /gpt-image-2\.5-sunburst-2026-09-08/);
  assert.match(html, /TILED image model/);
  assert.match(html, /Nano Banana Pro/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|Bearer |sk-/);

  const historical = parseAfcDiagnosticInspectorGenerationEvidence({
    generationId: GENERATION_ID,
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: null,
    lineageSeq: 1,
    runId: "44444444-4444-4444-8444-444444444444",
    intent: "analyze",
    status: "ready",
    createdAt: "2026-09-18T12:00:00.000Z",
    completedAt: "2026-09-18T12:00:01.000Z",
    frame: { width: 1200, height: 896 },
    failureReason: null,
    metricStatus: null,
    collisionStatus: null,
    analysisStatus: null,
    analysisReason: null,
    recoverySafeFailureState: null,
    engineFingerprint: fingerprint(),
    original: null,
    empty: { present: false, sha256: null, artifactSource: null },
    tiled: { present: false, sha256: null, artifactSource: null },
  });
  assert.equal(historical?.engineFingerprint?.imageGeneration, undefined);
  const historicalHtml = renderToStaticMarkup(
    createElement(EngineDetails, { fingerprint: historical?.engineFingerprint ?? null }),
  );
  assert.doesNotMatch(historicalHtml, /EMPTY image model/);
});
