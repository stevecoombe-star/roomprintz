import { readFile } from "node:fs/promises";

import { deriveAfcSr1FloorVanishingLineCrossRoom } from "./afc-sr1-floor-vanishing-line-cross-room";
import { validateAfcSr1Tr2ReaderReceipt } from "./afc-sr1-tile-floor-reader-execution";

/**
 * Historical Reader V3 reproduction bridge only.
 *
 * Its source polygon and truncated anchor predate the common-basis contract,
 * so its output is intentionally named legacy-unbound and is never authority
 * for the new semantic handoff certification.
 */
type BridgeRow = Readonly<{
  receipt: unknown;
  imageBase64: string;
  roi: Readonly<{
    coordinateSpace: "source-normalized/v1";
    polygon: readonly (readonly [number, number])[];
  }>;
  sourcePolygon: unknown;
  truncatedAnchor: unknown;
}>;

async function main(): Promise<void> {
  const rows: unknown = JSON.parse(await readFile("/dev/stdin", "utf8"));
  if (!Array.isArray(rows)) throw new Error("Expected an array of V3 receipt handoffs.");
  const results = rows.map((unknownRow) => {
    const row = unknownRow as BridgeRow;
    const imageBytes = Buffer.from(row.imageBase64, "base64");
    const receipt = validateAfcSr1Tr2ReaderReceipt(row.receipt, {
      readerVersion: "v3",
      tiledImageBytes: imageBytes,
      roi: row.roi,
    });
    if (receipt.status === "rejected") {
      return {
        validationStatus: "accepted",
        readerStatus: "rejected",
        legacyUnboundProjectiveHandoff: null,
      };
    }
    if (receipt.imageIdentity.decodedWidth === null || receipt.imageIdentity.decodedHeight === null) {
      throw new Error("Usable V3 receipt is missing decoded image dimensions.");
    }
    return {
      validationStatus: "accepted",
      readerStatus: "usable",
      legacyUnboundProjectiveHandoff: deriveAfcSr1FloorVanishingLineCrossRoom({
        analysisImage: {
          decodedWidth: receipt.imageIdentity.decodedWidth,
          decodedHeight: receipt.imageIdentity.decodedHeight,
        },
        floorVanishingLinePixel: receipt.floorVanishingLinePixel,
        sourcePolygon: row.sourcePolygon,
        truncatedAnchor: row.truncatedAnchor,
      }),
    };
  });
  process.stdout.write(`${JSON.stringify(results)}\n`);
}

void main();
