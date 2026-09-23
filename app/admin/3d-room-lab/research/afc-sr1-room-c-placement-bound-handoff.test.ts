/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveAfcSr1FloorVanishingLineCrossRoom,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  classifyAfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import {
  buildAfcSr1PlacementBoundTr0Handoff,
  validateAfcSr1ValidatedPlacementBoundTr0Handoff,
} from "./afc-sr1-placement-bound-tr0-handoff";
import {
  getAfcSr1ValidatedTr2UsableReaderAuthority,
  validateAfcSr1Tr2ReaderReceipt,
} from "./afc-sr1-tile-floor-reader-execution";
import {
  getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority,
  validateAfcSr1Ts0ChildProjectivePlacementReceipt,
  type AfcSr1Ts0ChildProjectivePlacementReceiptV1,
} from "./afc-sr1-ts0-child-projective-placement";
import {
  validateAfcSr1GeneratedTs0ParentChildLineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority";
import type {
  AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";

const fixtureDirectory = new URL(
  "./fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1/",
  import.meta.url
);
const control = JSON.parse(
  readFileSync(new URL("control.json", fixtureDirectory), "utf8")
) as any;
const placementControl = JSON.parse(readFileSync(
  new URL(
    "./fixtures/afc-sr1-room-c-placement-bound-control.v1.json",
    import.meta.url
  ),
  "utf8"
)) as any;
const lineageControl = JSON.parse(readFileSync(
  new URL(
    "./fixtures/afc-sr1-room-c-ts0-lineage-control.v1.json",
    import.meta.url
  ),
  "utf8"
)) as any;

type ChildLabel = "C-T1" | "C-T2" | "C-T3";

function bytesFor(label: ChildLabel): Uint8Array {
  return readFileSync(new URL(
    control.realCompositorV3Evidence[label].imageFixtureFile,
    fixtureDirectory
  ));
}

test("real Room C child receipts use placement authority through unchanged TR0/Track1a", async () => {
  assert.equal(
    placementControl.schemaVersion,
    "afc-sr1-room-c-placement-bound-control/v1"
  );
  const seamValues: number[] = [];
  const parentBytes = readFileSync(new URL(
    control.authority.rawImage.fixtureFile,
    fixtureDirectory
  ));
  for (const label of ["C-T1", "C-T2", "C-T3"] as const) {
    const bytes = bytesFor(label);
    const readerReceipt = validateAfcSr1Tr2ReaderReceipt(
      structuredClone(control.realCompositorV3Evidence[label].receipt),
      {
        readerVersion: "v3",
        tiledImageBytes: bytes,
        roi: control.authority.readerRoi,
        expectedImageIdentity:
          control.realCompositorV3Evidence[label].receipt.imageIdentity,
      }
    );
    const readerAuthority =
      getAfcSr1ValidatedTr2UsableReaderAuthority(readerReceipt);
    assert.notEqual(readerAuthority, null);

    const serializedPlacement = structuredClone(
      placementControl.placements[label].receipt
    ) as AfcSr1Ts0ChildProjectivePlacementReceiptV1;
    const metadata = lineageControl.results[label];
    const compatibility = classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: lineageControl.parent.sha256,
        decodedWidth: lineageControl.parent.decodedWidth,
        decodedHeight: lineageControl.parent.decodedHeight,
        orientation: lineageControl.parent.orientation,
      },
      {
        fingerprint: metadata.child.sha256,
        decodedWidth: metadata.child.decodedWidth,
        decodedHeight: metadata.child.decodedHeight,
        orientation: metadata.child.orientation,
      }
    );
    const ts0Result: AfcSr1TileGridScaffoldResult = {
      status: "generated",
      input: lineageControl.parent,
      tiled: {
        base64: Buffer.from(bytes).toString("base64"),
        identity: metadata.child,
      },
      provenance: metadata.provenance,
      compatibility,
    };
    const lineageAuthority =
      await validateAfcSr1GeneratedTs0ParentChildLineage(
        ts0Result,
        parentBytes,
        bytes
      );
    const placementReceipt =
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(serializedPlacement, {
        parentBytes,
        childBytes: bytes,
        lineageAuthority,
      });
    const placementAuthority =
      getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(placementReceipt);
    assert.notEqual(placementAuthority, null);

    const handoff = buildAfcSr1PlacementBoundTr0Handoff({
      readerAuthority: readerAuthority!,
      placementAuthority: placementAuthority!,
      lineageAuthority,
      basisBoundSourcePolygon: control.authority.basisBoundSourcePolygon,
      truncatedAnchor: control.authority.truncatedAnchor,
      anchorAuthority: control.authority.anchorAuthority,
    });
    assert.equal(handoff.status, "validated");
    if (handoff.status !== "validated") continue;
    validateAfcSr1ValidatedPlacementBoundTr0Handoff(handoff.handoff);
    const downstream = deriveAfcSr1FloorVanishingLineCrossRoom(
      handoff.handoff.tr0Input
    );
    assert.equal(downstream.status, "usable");
    if (downstream.status !== "usable") continue;
    const seamT = downstream.prior.seamT;
    seamValues.push(seamT);
    assert.ok(
      Math.abs(
        seamT - placementControl.placements[label].expectedSeamT
      ) <= 1e-15
    );
    assert.ok(
      Math.abs(seamT - placementControl.gt0SeamT) <=
        placementControl.absoluteTolerance
    );
  }
  assert.equal(seamValues.length, 3);
  assert.ok(
    Math.max(...seamValues) - Math.min(...seamValues) <=
      placementControl.rangeTolerance
  );
});
