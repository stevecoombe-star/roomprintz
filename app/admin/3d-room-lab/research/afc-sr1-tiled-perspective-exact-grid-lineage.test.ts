import assert from "node:assert/strict";
import test from "node:test";

import {
  AfcSr1TiledPerspectiveExactGridLineageError,
  validateAfcSr1TiledPerspectiveExactGridLineage,
} from "./afc-sr1-tiled-perspective-exact-grid-lineage";
import { makeSyntheticGeneratedTs0Lineage } from "./afc-sr1-ts0-parent-child-lineage-authority.test-helpers";

test("TILED perspective lineage admits only exact-grid parent and child", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 100,
    parentHeight: 50,
    childWidth: 100,
    childHeight: 50,
  });
  const result = await validateAfcSr1TiledPerspectiveExactGridLineage(
    fixture.result,
    fixture.parentBytes,
    fixture.childBytes
  );
  assert.equal(result.authority.evidence.compatibility.tier, "exact_grid_compatible");
  assert.equal(result.tiledIdentity.sha256, fixture.child.sha256);
});

test("TILED perspective lineage rejects historical aspect-rescaled admission", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 100,
    parentHeight: 50,
    childWidth: 200,
    childHeight: 100,
  });
  await assert.rejects(
    () => validateAfcSr1TiledPerspectiveExactGridLineage(
      fixture.result,
      fixture.parentBytes,
      fixture.childBytes
    ),
    (error: unknown) =>
      error instanceof AfcSr1TiledPerspectiveExactGridLineageError &&
      error.reason === "tiled_lineage_not_exact_grid"
  );
});
