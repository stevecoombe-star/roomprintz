import assert from "node:assert/strict";
import test from "node:test";

import type { AfcStoredTiledCertification } from "@/lib/afc-image-models";
import { reusedTiledArtifact } from "@/lib/afc-v2-diagnostics/manual-perspective-recovery.server";

import { makeSyntheticGeneratedTs0Lineage } from "./afc-sr1-ts0-parent-child-lineage-authority.test-helpers";
import {
  validateAfcSr1GeneratedTs0ParentChildLineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority";
import {
  AfcSr1TiledPerspectiveExactGridLineageError,
  validateAfcSr1TiledPerspectiveExactGridLineage,
} from "./afc-sr1-tiled-perspective-exact-grid-lineage";
import type { AfcSr1TileGridScaffoldResult } from "./afc-sr1-tile-grid-scaffold";

const SUNBURST_ID = "gpt-image-2.5-sunburst-2026-09-08";

function withProvenance(
  result: AfcSr1TileGridScaffoldResult,
  provenance: Record<string, unknown>,
): AfcSr1TileGridScaffoldResult {
  if (result.status !== "generated") throw new Error("expected generated fixture");
  return {
    ...result,
    provenance: {
      ...result.provenance,
      ...provenance,
    },
  };
}

function sunburstIdentity(): AfcStoredTiledCertification {
  return {
    requestedModelId: SUNBURST_ID,
    imageChoice: "gpt-image-2.5-sunburst-high",
    imageProvider: "openai",
    imageQuality: "high" as const,
  };
}

test("historical NBP TILED provenance still certifies and keeps its exact shape", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage();
  assert.equal(fixture.result.provenance.requestedModelId, "NBP");
  assert.equal("imageChoice" in fixture.result.provenance, false);
  const authority = await validateAfcSr1GeneratedTs0ParentChildLineage(
    fixture.result,
    fixture.parentBytes,
    fixture.childBytes,
  );
  assert.equal(authority.evidence.provenance.requestedModelId, "NBP");
});

test("Sunburst TILED certifies only with the pinned model, provider, and quality", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 32,
    parentHeight: 32,
    childWidth: 32,
    childHeight: 32,
  });
  const approved = withProvenance(fixture.result, sunburstIdentity());
  const authority = await validateAfcSr1TiledPerspectiveExactGridLineage(
    approved,
    fixture.parentBytes,
    fixture.childBytes,
  );
  assert.equal(authority.authority.evidence.provenance.requestedModelId, SUNBURST_ID);
  assert.equal(authority.tiledIdentity.decodedWidth, 32);
  assert.equal(authority.tiledIdentity.decodedHeight, 32);

  const rejected = [
    { requestedModelId: SUNBURST_ID },
    { ...sunburstIdentity(), imageQuality: "low" },
    { ...sunburstIdentity(), imageQuality: null },
    { ...sunburstIdentity(), imageProvider: "nanobanana-pro" },
    { ...sunburstIdentity(), requestedModelId: "gpt-image-2" },
    { ...sunburstIdentity(), requestedModelId: "gemini-3-pro-image-preview" },
    { requestedModelId: "NBP", imageChoice: "nano-banana-pro", imageProvider: "nanobanana-pro", imageQuality: null },
    { ...sunburstIdentity(), unexpected: true },
  ];
  for (const provenance of rejected) {
    await assert.rejects(() =>
      validateAfcSr1GeneratedTs0ParentChildLineage(
        withProvenance(fixture.result, provenance),
        fixture.parentBytes,
        fixture.childBytes,
      )
    );
  }
});

test("exact-grid still rejects a Sunburst TILED image with different pixels", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 64,
    parentHeight: 48,
    childWidth: 48,
    childHeight: 36,
  });
  const approved = withProvenance(fixture.result, sunburstIdentity());
  await validateAfcSr1GeneratedTs0ParentChildLineage(
    approved,
    fixture.parentBytes,
    fixture.childBytes,
  );
  await assert.rejects(
    () => validateAfcSr1TiledPerspectiveExactGridLineage(
      approved,
      fixture.parentBytes,
      fixture.childBytes,
    ),
    (error: unknown) =>
      error instanceof AfcSr1TiledPerspectiveExactGridLineageError
      && error.reason === "tiled_lineage_not_exact_grid",
  );
});

test("recovered TILED bytes keep the stored model and do not relabel it", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 24,
    parentHeight: 24,
    childWidth: 24,
    childHeight: 24,
  });
  const historical = reusedTiledArtifact({
    empty: fixture.parent,
    tiled: fixture.child,
    tiledBytes: fixture.childBytes,
    runId: fixture.result.provenance.runId,
    generatedAt: fixture.result.provenance.generatedAt,
  });
  assert.ok(historical);
  assert.equal(historical.provenance.requestedModelId, "NBP");
  assert.equal("imageProvider" in historical.provenance, false);
  await validateAfcSr1TiledPerspectiveExactGridLineage(
    historical,
    fixture.parentBytes,
    fixture.childBytes,
  );

  const sunburst = reusedTiledArtifact({
    empty: fixture.parent,
    tiled: fixture.child,
    tiledBytes: fixture.childBytes,
    runId: fixture.result.provenance.runId,
    generatedAt: fixture.result.provenance.generatedAt,
    modelIdentity: sunburstIdentity(),
  });
  assert.ok(sunburst);
  assert.equal(sunburst.provenance.requestedModelId, SUNBURST_ID);
  assert.equal(sunburst.provenance.imageQuality, "high");
  await validateAfcSr1TiledPerspectiveExactGridLineage(
    sunburst,
    fixture.parentBytes,
    fixture.childBytes,
  );
  assert.equal(
    reusedTiledArtifact({
      empty: fixture.parent,
      tiled: fixture.child,
      tiledBytes: fixture.childBytes,
      runId: fixture.result.provenance.runId,
      generatedAt: fixture.result.provenance.generatedAt,
      modelIdentity: { ...sunburstIdentity(), imageQuality: null },
    }),
    null,
  );
});
