import assert from "node:assert/strict";
import test from "node:test";

import { mapAfcDiagnosticAdminEngineFingerprint } from "@/lib/afc-v2-diagnostics/admin-read-model";
import { parseAfcDiagnosticInspectorGenerationEvidence } from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";

import {
  buildAfcV2EngineFingerprint,
  cloneAfcV2EngineFingerprint,
  inheritAfcImageGenerationProvenance,
  isAfcV2EngineFingerprintV1,
  withAfcImageGenerationProvenance,
} from "./engine-fingerprint";

test("historical fingerprints stay valid without image generation provenance", () => {
  const fingerprint = buildAfcV2EngineFingerprint({ env: {} });
  assert.equal(fingerprint.imageGeneration, undefined);
  assert.equal(isAfcV2EngineFingerprintV1(fingerprint), true);
  const mapped = mapAfcDiagnosticAdminEngineFingerprint(fingerprint);
  assert.ok(mapped);
  assert.equal("imageGeneration" in mapped, false);
  assert.equal(isAfcV2EngineFingerprintV1({
    ...fingerprint,
    extraSecret: "do-not-keep",
  }), true);
});

test("new fingerprints record exact EMPTY and TILED provider, model, and quality", () => {
  const fingerprint = withAfcImageGenerationProvenance(
    buildAfcV2EngineFingerprint({ env: {} }),
    {
      empty: "gpt-image-2.5-sunburst-high",
      tiled: "nano-banana-pro",
    },
  );
  assert.equal(fingerprint.tiled.requestedModelId, "NBP");
  assert.equal(fingerprint.imageGeneration?.empty.provider, "openai");
  assert.equal(
    fingerprint.imageGeneration?.empty.modelId,
    "gpt-image-2.5-sunburst-2026-09-08",
  );
  assert.equal(fingerprint.imageGeneration?.empty.quality, "high");
  assert.equal(fingerprint.imageGeneration?.empty.stage, "empty");
  assert.equal(fingerprint.imageGeneration?.tiled.provider, "nanobanana-pro");
  assert.equal(fingerprint.imageGeneration?.tiled.modelId, "NBP");
  assert.equal(fingerprint.imageGeneration?.tiled.quality, null);
  const cloned = cloneAfcV2EngineFingerprint(fingerprint);
  assert.equal(cloned.imageGeneration?.empty.modelId, fingerprint.imageGeneration?.empty.modelId);
  const mapped = mapAfcDiagnosticAdminEngineFingerprint({
    ...fingerprint,
    extraSecret: "nope",
  });
  assert.equal(mapped?.imageGeneration?.empty.provider, "openai");
  assert.equal("extraSecret" in (mapped ?? {}), false);

  const parsed = parseAfcDiagnosticInspectorGenerationEvidence({
    generationId: "11111111-1111-4111-8111-111111111111",
    roomId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
    parentGenerationId: null,
    lineageSeq: 1,
    runId: "44444444-4444-4444-8444-444444444444",
    intent: "analyze",
    status: "ready",
    createdAt: "2026-09-30T00:00:00.000Z",
    completedAt: "2026-09-30T00:00:01.000Z",
    frame: { width: 1264, height: 848 },
    failureReason: null,
    metricStatus: null,
    collisionStatus: null,
    analysisStatus: null,
    analysisReason: null,
    recoverySafeFailureState: null,
    engineFingerprint: fingerprint,
    original: null,
    empty: { present: false, sha256: null, artifactSource: null },
    tiled: { present: false, sha256: null, artifactSource: null },
  });
  assert.equal(
    parsed?.engineFingerprint?.imageGeneration?.tiled.modelId,
    "NBP",
  );
  assert.equal(
    parsed?.engineFingerprint?.imageGeneration?.empty.quality,
    "high",
  );
});

test("recovery inherits stored Sunburst identity and leaves historical NBP unchanged", () => {
  const fresh = buildAfcV2EngineFingerprint({ env: {} });
  assert.equal(fresh.tiled.requestedModelId, "NBP");
  assert.equal(inheritAfcImageGenerationProvenance(fresh, undefined), null);
  const source = withAfcImageGenerationProvenance(fresh, {
    empty: "gpt-image-2.5-sunburst-high",
    tiled: "gpt-image-2.5-sunburst-high",
  });
  const recovered = inheritAfcImageGenerationProvenance(
    buildAfcV2EngineFingerprint({ env: {} }),
    source.imageGeneration,
  );
  assert.ok(recovered);
  assert.equal(recovered.tiled.requestedModelId, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(recovered.imageGeneration?.tiled.provider, "openai");
  assert.equal(recovered.imageGeneration?.tiled.quality, "high");
  assert.equal(recovered.imageGeneration?.tiled.stage, "tiled");
  assert.equal(fresh.tiled.requestedModelId, "NBP");
});
