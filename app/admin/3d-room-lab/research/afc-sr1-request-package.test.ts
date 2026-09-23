import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { AFC_SR1_DEFAULT_OVERLAY_STYLE_V1 } from "./afc-sr1-overlay-evidence";
import {
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1OverlayDescriptor,
  buildAfcSr1SemanticPriorBinding,
} from "./afc-sr1-semantic-prior";
import {
  buildAfcSr1RequestPackage,
  validateAfcSr1RequestPackageReplay,
} from "./afc-sr1-request-package";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function packageFixture(style = AFC_SR1_DEFAULT_OVERLAY_STYLE_V1) {
  const originalBytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 45, b: 60 } },
  }).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: false, palette: false }).toBuffer();
  const originalBasis = {
    fingerprint: hash(originalBytes), decodedWidth: 64, decodedHeight: 48, orientation: 1 as const,
  };
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: {
      schemaVersion: "afc-sr1-replay-evidence-identity/v1",
      receiptContractVersion: "afc-r3c-proposal-run-receipt/v1",
      receiptFileName: "fixture.json",
      receiptSha256: "b".repeat(64),
      requestId: "fixture-request",
      imageRole: "empty_room_boundary_specialist",
      r3bCandidateId: "afc-r3:fixture",
      r3cCandidateId: "afc-r3c:empty:afc-r3:fixture",
      inputImageFingerprint: originalBasis.fingerprint,
      originalImageFingerprint: originalBasis.fingerprint,
      emptyRoomAssistFingerprint: originalBasis.fingerprint,
      replayVerificationVersion: "fixture/v1",
      replayEvidenceFingerprint: "c".repeat(64),
    },
    placement: buildAfcSr1OriginalBasisPlacement({
      schemaVersion: "afc-sr1-original-basis-placement/v1",
      status: "placed_on_original_basis",
      method: "already_original_basis",
      sourceEmptyBasis: originalBasis,
      targetOriginalBasis: originalBasis,
      compatibilityTier: "exact_grid_compatible",
      transferRecordFingerprint: "d".repeat(64),
    }),
    rawSourcePolygon: [
      { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.86 }, { x: 0.68, y: 0.34 }, { x: 0.28, y: 0.42 },
    ],
    overlayGenerationId: "fixture-overlay",
    requestGenerationId: "fixture-request-generation",
  });
  const overlayDescriptor = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: originalBasis,
    rawSourcePolygon: binding.rawSourcePolygon,
    overlayGenerationId: binding.overlayGenerationId,
  });
  return buildAfcSr1RequestPackage({
    packageGenerationId: "fixture-package",
    semanticPriorBinding: binding,
    overlayDescriptor,
    originalBytes,
    style,
  });
}

test("P1 packages exactly one composite provider image deterministically", async () => {
  const first = await packageFixture();
  const second = await packageFixture();
  assert.equal(first.requestPackage.packageDigest, second.requestPackage.packageDigest);
  assert.deepEqual(first.evidenceBytes.svgUtf8, second.evidenceBytes.svgUtf8);
  assert.deepEqual(first.evidenceBytes.overlayPngBytes, second.evidenceBytes.overlayPngBytes);
  assert.deepEqual(first.evidenceBytes.compositePngBytes, second.evidenceBytes.compositePngBytes);
  assert.equal(first.requestPackage.artifact.providerImagePolicy, "composite_only/v1");
  assert.equal("modelId" in first.requestPackage.artifact, false);
  const replay = await validateAfcSr1RequestPackageReplay({
    requestPackage: first.requestPackage,
    evidenceBytes: first.evidenceBytes,
    rerenderedEvidence: {
      svgUtf8Sha256: second.requestPackage.artifact.canonicalSvg.svgUtf8Sha256,
      overlayPngSha256: second.requestPackage.artifact.renderedOverlay.overlayPngSha256,
      compositePngSha256: second.requestPackage.artifact.compositeImage.compositePngSha256,
    },
  });
  assert.deepEqual(replay, { ok: true, packageDigest: first.requestPackage.packageDigest });
});

test("P1 replay fails closed for substituted evidence and stale contract identities", async () => {
  const fixture = await packageFixture();
  const expectStale = async (requestPackage: any) => {
    const result = await validateAfcSr1RequestPackageReplay({
      requestPackage, evidenceBytes: fixture.evidenceBytes,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failureClass, "stale");
  };
  const staleOriginal = await validateAfcSr1RequestPackageReplay({
    requestPackage: fixture.requestPackage,
    evidenceBytes: { ...fixture.evidenceBytes, originalBytes: Buffer.from(fixture.evidenceBytes.originalBytes).fill(0) },
  });
  assert.equal(staleOriginal.ok, false);
  if (!staleOriginal.ok) assert.equal(staleOriginal.failureClass, "stale");
  const staleSvg = await validateAfcSr1RequestPackageReplay({
    requestPackage: fixture.requestPackage,
    evidenceBytes: { ...fixture.evidenceBytes, svgUtf8: `${fixture.evidenceBytes.svgUtf8} ` },
  });
  assert.equal(staleSvg.ok, false);
  if (!staleSvg.ok) assert.equal(staleSvg.reasonCode, "svg_digest_mismatch");
  const staleOverlay = await validateAfcSr1RequestPackageReplay({
    requestPackage: fixture.requestPackage,
    evidenceBytes: { ...fixture.evidenceBytes, overlayPngBytes: Buffer.from(fixture.evidenceBytes.overlayPngBytes).fill(0) },
  });
  assert.equal(staleOverlay.ok, false);
  if (!staleOverlay.ok) assert.equal(staleOverlay.reasonCode, "overlay_png_digest_mismatch");
  const staleComposite = await validateAfcSr1RequestPackageReplay({
    requestPackage: fixture.requestPackage,
    evidenceBytes: { ...fixture.evidenceBytes, compositePngBytes: Buffer.from(fixture.evidenceBytes.compositePngBytes).fill(0) },
  });
  assert.equal(staleComposite.ok, false);
  if (!staleComposite.ok) assert.equal(staleComposite.reasonCode, "composite_png_digest_mismatch");
  const nondeterministic = await validateAfcSr1RequestPackageReplay({
    requestPackage: fixture.requestPackage,
    evidenceBytes: fixture.evidenceBytes,
    rerenderedEvidence: {
      svgUtf8Sha256: "0".repeat(64),
      overlayPngSha256: fixture.requestPackage.artifact.renderedOverlay.overlayPngSha256,
      compositePngSha256: fixture.requestPackage.artifact.compositeImage.compositePngSha256,
    },
  });
  assert.equal(nondeterministic.ok, false);
  if (!nondeterministic.ok) assert.equal(nondeterministic.failureClass, "nondeterministic_render");

  const staleDescriptor: any = structuredClone(fixture.requestPackage);
  staleDescriptor.artifact.overlayDescriptor.rawSourcePolygon[0].x = 0.11;
  await expectStale(staleDescriptor);
  const stalePrompt: any = structuredClone(fixture.requestPackage);
  stalePrompt.artifact.prompt.promptText += "\nchanged";
  await expectStale(stalePrompt);
  const staleContract: any = structuredClone(fixture.requestPackage);
  staleContract.artifact.responseContract.semanticLabels = [];
  await expectStale(staleContract);
  const staleToken: any = structuredClone(fixture.requestPackage);
  staleToken.artifact.seamBindingToken = `sr1sbt1:${"0".repeat(64)}`;
  await expectStale(staleToken);
  const staleGeneration: any = structuredClone(fixture.requestPackage);
  staleGeneration.artifact.renderedOverlay.overlayGenerationId = "different-generation";
  await expectStale(staleGeneration);
});

test("P1 style changes alter the exact rendered and package identities", async () => {
  const changedStyle = Object.freeze({
    ...AFC_SR1_DEFAULT_OVERLAY_STYLE_V1,
    nrSeamStroke: "#123456",
    seamDashPatternPx: Object.freeze([...AFC_SR1_DEFAULT_OVERLAY_STYLE_V1.seamDashPatternPx]),
  });
  const baseline = await packageFixture();
  const changed = await packageFixture(changedStyle);
  assert.notEqual(
    baseline.requestPackage.artifact.renderedOverlay.styleDigest,
    changed.requestPackage.artifact.renderedOverlay.styleDigest,
  );
  assert.notEqual(
    baseline.requestPackage.artifact.canonicalSvg.svgUtf8Sha256,
    changed.requestPackage.artifact.canonicalSvg.svgUtf8Sha256,
  );
  assert.notEqual(
    baseline.requestPackage.artifact.renderedOverlay.overlayPngSha256,
    changed.requestPackage.artifact.renderedOverlay.overlayPngSha256,
  );
  assert.notEqual(
    baseline.requestPackage.artifact.compositeImage.compositePngSha256,
    changed.requestPackage.artifact.compositeImage.compositePngSha256,
  );
  assert.notEqual(baseline.requestPackage.packageDigest, changed.requestPackage.packageDigest);
});

test("P1 production modules contain no execution, UI, viewport, or authority coupling", () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const source = [
    "afc-sr1-overlay-evidence.ts",
    "afc-sr1-semantic-prior-prompt.ts",
    "afc-sr1-request-package.ts",
  ].map(file => readFileSync(join(directory, file), "utf8")).join("\n");
  for (const forbidden of [
    "AfcProposalOverlayCanvas", "AfcProposalOverlayPanel", "afc-proposal-overlay-state",
    "afc-main-viewport-evidence", "afc-proposal-overlay-view-model", "gemini-floor-proposal",
    "ThreeRoomLab", "afc-verified-floor-apply", "afc-verified-camera-apply",
    "perspective-solve", "ratio-fov-harness", "object-cover", "CP2A", "CP2B",
    "fetch(", "credentials", "api/",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
