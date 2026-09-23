import "server-only";

import type { AfcSr1TileGridScaffoldResult } from "./afc-sr1-tile-grid-scaffold";
import {
  validateAfcSr1GeneratedTs0ParentChildLineage,
  type AfcSr1ValidatedTs0ParentChildLineageAuthorityV1,
} from "./afc-sr1-ts0-parent-child-lineage-authority";

export type AfcSr1TiledPerspectiveExactGridLineage = Readonly<{
  authority: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
  tiledIdentity: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1["evidence"]["child"];
}>;

export class AfcSr1TiledPerspectiveExactGridLineageError extends Error {
  constructor(readonly reason: "tiled_lineage_not_exact_grid" | "tiled_lineage_invalid") {
    super(reason);
  }
}

/**
 * S2A narrows the historical TS0 lineage authority to byte-identical grids.
 * It intentionally does not alter the historical validator's broader policy.
 */
export async function validateAfcSr1TiledPerspectiveExactGridLineage(
  result: AfcSr1TileGridScaffoldResult,
  emptyBytes: Uint8Array,
  tiledBytes: Uint8Array
): Promise<AfcSr1TiledPerspectiveExactGridLineage> {
  let authority: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
  try {
    authority = await validateAfcSr1GeneratedTs0ParentChildLineage(
      result,
      emptyBytes,
      tiledBytes
    );
  } catch {
    throw new AfcSr1TiledPerspectiveExactGridLineageError("tiled_lineage_invalid");
  }
  if (
    authority.evidence.compatibility.tier !== "exact_grid_compatible" ||
    authority.evidence.parent.orientation !== 1 ||
    authority.evidence.child.orientation !== 1
  ) {
    throw new AfcSr1TiledPerspectiveExactGridLineageError(
      "tiled_lineage_not_exact_grid"
    );
  }
  return Object.freeze({
    authority,
    tiledIdentity: authority.evidence.child,
  });
}
