import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_IMAGE_MODEL_DEFAULT,
  AFC_IMAGE_MODEL_OPTION_LIST,
  AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID,
  AFC_SUNBURST_PROVIDER_MODEL_ID,
  AFC_SUNBURST_QUALITY,
  afcImageGenerationProvenance,
  defaultAfcImageModelSettings,
  isAfcImageModelChoice,
  normalizeAfcSunburstOutputSize,
  afcTiledCertificationFromStoredEvidence,
  certifyAfcTiledModelIdentity,
  parseAfcImageGenerationProvenance,
  resolveAfcImageModel,
  resolveApprovedAfcImageModelById,
} from "./afc-image-models";

test("default EMPTY and TILED choices are Nano Banana Pro", () => {
  const settings = defaultAfcImageModelSettings();
  assert.equal(settings.empty, AFC_IMAGE_MODEL_DEFAULT);
  assert.equal(settings.tiled, AFC_IMAGE_MODEL_DEFAULT);
  assert.equal(AFC_IMAGE_MODEL_DEFAULT, "nano-banana-pro");
  const resolved = resolveAfcImageModel(AFC_IMAGE_MODEL_DEFAULT);
  assert.equal(resolved.provider, "nanobanana-pro");
  assert.equal(resolved.modelId, AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID);
  assert.equal(resolved.modelId, "NBP");
  assert.equal(resolved.quality, null);
  assert.equal(resolved.displayName, "Nano Banana Pro");
});

test("EMPTY and TILED can select Sunburst independently", () => {
  const emptyOnly = afcImageGenerationProvenance({
    empty: "gpt-image-2.5-sunburst-high",
    tiled: "nano-banana-pro",
  });
  assert.equal(emptyOnly.empty.provider, "openai");
  assert.equal(emptyOnly.empty.modelId, AFC_SUNBURST_PROVIDER_MODEL_ID);
  assert.equal(emptyOnly.empty.quality, AFC_SUNBURST_QUALITY);
  assert.equal(emptyOnly.tiled.provider, "nanobanana-pro");
  assert.equal(emptyOnly.tiled.modelId, "NBP");

  const tiledOnly = afcImageGenerationProvenance({
    empty: "nano-banana-pro",
    tiled: "gpt-image-2.5-sunburst-high",
  });
  assert.equal(tiledOnly.empty.modelId, "NBP");
  assert.equal(tiledOnly.tiled.provider, "openai");
  assert.equal(tiledOnly.tiled.modelId, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(tiledOnly.tiled.quality, "high");
  assert.equal(tiledOnly.tiled.displayName, "GPT Image 2.5 Sunburst High");
});

test("admin options are exactly Nano Banana Pro and GPT Image 2.5 Sunburst High", () => {
  assert.deepEqual(
    AFC_IMAGE_MODEL_OPTION_LIST.map((option) => option.displayName),
    ["Nano Banana Pro", "GPT Image 2.5 Sunburst High"],
  );
  assert.equal(isAfcImageModelChoice("nano-banana-2"), false);
  assert.equal(isAfcImageModelChoice("nb2"), false);
  assert.equal(isAfcImageModelChoice("gpt-image-2.5-sunburst-high"), true);
});

test("Sunburst size uses the Nano Banana Pro 1K grid and refuses to crop", () => {
  const exact = normalizeAfcSunburstOutputSize(1264, 848);
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.strategy, "source-dimensions");
  assert.equal(exact.size, "1264x848");

  const liveEmpty = normalizeAfcSunburstOutputSize(2048, 1536);
  assert.equal(liveEmpty.ok, true);
  if (!liveEmpty.ok) return;
  assert.equal(liveEmpty.strategy, "nano-banana-pro-1k-grid");
  assert.equal(liveEmpty.size, "1200x896");

  const portrait = normalizeAfcSunburstOutputSize(1144, 1534);
  assert.equal(portrait.ok, true);
  if (!portrait.ok) return;
  assert.equal(portrait.size, "896x1200");

  const square = normalizeAfcSunburstOutputSize(100, 100);
  assert.equal(square.ok, true);
  if (!square.ok) return;
  assert.equal(square.strategy, "nano-banana-pro-1k-grid");
  assert.equal(square.size, "1024x1024");

  const wide = normalizeAfcSunburstOutputSize(100, 400);
  assert.equal(wide.ok, false);
  if (wide.ok) return;
  assert.match(wide.reason, /Refusing to crop/);

  const betweenPresets = normalizeAfcSunburstOutputSize(1800, 1600);
  assert.equal(betweenPresets.ok, false);
  if (betweenPresets.ok) return;
  assert.match(betweenPresets.reason, /Refusing to crop/);
});

test("certified TILED identity accepts only the catalog pair", () => {
  assert.equal(resolveApprovedAfcImageModelById("NBP")?.choice, "nano-banana-pro");
  assert.equal(
    resolveApprovedAfcImageModelById("gpt-image-2.5-sunburst-2026-09-08")?.quality,
    "high",
  );
  assert.equal(resolveApprovedAfcImageModelById("gpt-image-2"), null);
  assert.equal(resolveApprovedAfcImageModelById("gemini-3-pro-image-preview"), null);
  assert.ok(certifyAfcTiledModelIdentity({ requestedModelId: "NBP" }));
  assert.equal(
    certifyAfcTiledModelIdentity({
      requestedModelId: "NBP",
      imageProvider: "nanobanana-pro",
      imageQuality: null,
      imageChoice: "nano-banana-pro",
    }),
    null,
  );
  const sunburst = {
    requestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
    imageChoice: "gpt-image-2.5-sunburst-high",
    imageProvider: "openai",
    imageQuality: "high",
  };
  assert.equal(certifyAfcTiledModelIdentity(sunburst)?.provider, "openai");
  assert.equal(certifyAfcTiledModelIdentity({ ...sunburst, imageQuality: "low" }), null);
  assert.equal(certifyAfcTiledModelIdentity({ ...sunburst, imageQuality: null }), null);
  assert.equal(
    certifyAfcTiledModelIdentity({ ...sunburst, imageProvider: "nanobanana-pro" }),
    null,
  );
  assert.equal(
    certifyAfcTiledModelIdentity({ ...sunburst, requestedModelId: "gpt-image-2" }),
    null,
  );
  assert.equal(
    certifyAfcTiledModelIdentity({
      requestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
    }),
    null,
  );
});

test("stored TILED certification follows the artifact, not a later model selection", () => {
  const sunburst = afcImageGenerationProvenance({
    empty: "gpt-image-2.5-sunburst-high",
    tiled: "gpt-image-2.5-sunburst-high",
  });
  const nbp = afcImageGenerationProvenance({
    empty: "nano-banana-pro",
    tiled: "nano-banana-pro",
  });
  assert.deepEqual(
    afcTiledCertificationFromStoredEvidence({
      imageGeneration: null,
      lineageRequestedModelId: "NBP",
      fingerprintRequestedModelId: "NBP",
    }),
    { requestedModelId: "NBP" },
  );
  assert.deepEqual(
    afcTiledCertificationFromStoredEvidence({
      imageGeneration: nbp,
      lineageRequestedModelId: "NBP",
      fingerprintRequestedModelId: "NBP",
    }),
    { requestedModelId: "NBP" },
  );
  const recoveredSunburst = afcTiledCertificationFromStoredEvidence({
    imageGeneration: sunburst,
    lineageRequestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
    fingerprintRequestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
  });
  assert.equal(recoveredSunburst?.imageProvider, "openai");
  assert.equal(recoveredSunburst?.imageQuality, "high");
  assert.equal(
    afcTiledCertificationFromStoredEvidence({
      imageGeneration: sunburst,
      lineageRequestedModelId: "NBP",
      fingerprintRequestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
    }),
    null,
  );
  assert.equal(
    afcTiledCertificationFromStoredEvidence({
      imageGeneration: null,
      lineageRequestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
      fingerprintRequestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
    }),
    null,
  );
  assert.equal(
    afcTiledCertificationFromStoredEvidence({
      imageGeneration: { schemaVersion: "afc-image-generation-provenance/v1", tiled: { quality: "low" } },
      lineageRequestedModelId: null,
      fingerprintRequestedModelId: "gpt-image-2.5-sunburst-2026-09-08",
    }),
    null,
  );
});

test("historical and invalid image provenance parses as absent", () => {
  assert.equal(parseAfcImageGenerationProvenance(undefined), null);
  assert.equal(parseAfcImageGenerationProvenance(null), null);
  assert.equal(parseAfcImageGenerationProvenance({ schemaVersion: "other" }), null);
  const parsed = parseAfcImageGenerationProvenance(
    afcImageGenerationProvenance({
      empty: "nano-banana-pro",
      tiled: "gpt-image-2.5-sunburst-high",
    }),
  );
  assert.equal(parsed?.tiled.quality, "high");
  assert.equal(parsed?.empty.quality, null);
});
