import assert from "node:assert/strict";
import test from "node:test";

import { deriveAfcSr1FloorVanishingLineCrossRoom } from "./afc-sr1-floor-vanishing-line-cross-room";
import fixture from "./fixtures/afc-sr1-ts2-development-parity.v1.json";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";

test("TR0 plus Track 1a preserves all six frozen TS2 C/D seamT handoffs", () => {
  for (const row of fixture.cases) {
    const result = deriveAfcSr1FloorVanishingLineCrossRoom({
      analysisImage: row.analysisImage,
      floorVanishingLinePixel: row.floorVanishingLinePixel,
      sourcePolygon: row.sourcePolygon as unknown as AfcSr1SourcePolygon,
      truncatedAnchor: row.truncatedAnchor,
    });
    if (result.status !== "usable") {
      assert.fail(`${row.room}-${row.generation}: rejected ${result.reason}`);
    }
    assert.ok(
      Math.abs(result.prior.seamT - row.expectedSeamT) < 1e-12,
      `${row.room}-${row.generation}: ${result.prior.seamT} !== ${row.expectedSeamT}`
    );
  }
});
