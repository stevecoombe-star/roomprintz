import assert from "node:assert/strict";
import test from "node:test";

import { buildAfcAdminVisualOverlayV1 } from "./admin-visual-overlay.server";
import type { AfcDiagnosticVisualOverlayGenerationRecord } from "./admin-visual-overlay.server";

const GEN = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";

function failedGeneration(
  overrides: Partial<AfcDiagnosticVisualOverlayGenerationRecord> = {},
): AfcDiagnosticVisualOverlayGenerationRecord {
  return {
    id: GEN,
    roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "22222222-2222-4222-8222-222222222222",
    status: "failed",
    productionAuthority: null,
    frameWidth: 1200,
    frameHeight: 800,
    originalSha256: "a".repeat(64),
    originalDecodedWidth: 1200,
    originalDecodedHeight: 800,
    originalOrientation: 1,
    emptySha256: "b".repeat(64),
    emptyDecodedWidth: 1200,
    emptyDecodedHeight: 800,
    emptyOrientation: 1,
    tiledSha256: "c".repeat(64),
    tiledDecodedWidth: 1200,
    tiledDecodedHeight: 800,
    tiledOrientation: 1,
    ...overrides,
  };
}

test("a failed generation hosts a manual quad without inventing an automatic floor", () => {
  const original = buildAfcAdminVisualOverlayV1({
    generation: failedGeneration(),
    kind: "original",
  });
  const empty = buildAfcAdminVisualOverlayV1({
    generation: failedGeneration(),
    kind: "empty",
  });
  const tiled = buildAfcAdminVisualOverlayV1({
    generation: failedGeneration(),
    kind: "tiled",
  });
  for (const overlay of [original, empty, tiled]) {
    assert.equal(overlay.floorQuad, null);
    assert.deepEqual(overlay.collisionEdges, []);
    assert.equal(overlay.sourceNormalizedHost, true);
  }
});

test("an incompatible artifact stays a non-host and does not receive a floor quad", () => {
  const empty = buildAfcAdminVisualOverlayV1({
    generation: failedGeneration({
      emptyDecodedWidth: 800,
      emptyDecodedHeight: 800,
    }),
    kind: "empty",
  });
  const tiled = buildAfcAdminVisualOverlayV1({
    generation: failedGeneration({
      tiledDecodedWidth: 601,
      tiledDecodedHeight: 800,
    }),
    kind: "tiled",
  });
  assert.equal(empty.sourceNormalizedHost, false);
  assert.equal(empty.floorQuad, null);
  assert.equal(tiled.sourceNormalizedHost, false);
  assert.equal(tiled.floorQuad, null);
  const original = buildAfcAdminVisualOverlayV1({
    generation: failedGeneration({
      emptyDecodedWidth: 800,
      emptyDecodedHeight: 800,
      tiledDecodedWidth: 601,
      tiledDecodedHeight: 800,
    }),
    kind: "original",
  });
  assert.equal(original.sourceNormalizedHost, true);
  assert.equal(original.floorQuad, null);
});
