import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  classifyAfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import {
  validateAfcSr1GeneratedTs0ParentChildLineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority";
import type {
  AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";

export async function makeSyntheticGeneratedTs0Lineage(options: Readonly<{
  parentWidth?: number;
  parentHeight?: number;
  childWidth?: number;
  childHeight?: number;
  parentRed?: number;
  childRed?: number;
}> = {}) {
  const parentWidth = options.parentWidth ?? 100;
  const parentHeight = options.parentHeight ?? 50;
  const childWidth = options.childWidth ?? 80;
  const childHeight = options.childHeight ?? 40;
  const parentBytes = Buffer.from(await sharp({
    create: {
      width: parentWidth,
      height: parentHeight,
      channels: 3,
      background: { r: options.parentRed ?? 220, g: 210, b: 200 },
    },
  }).png().toBuffer());
  const childBytes = Buffer.from(await sharp({
    create: {
      width: childWidth,
      height: childHeight,
      channels: 3,
      background: { r: options.childRed ?? 180, g: 170, b: 160 },
    },
  }).png().toBuffer());
  const parent = {
    sha256: createHash("sha256").update(parentBytes).digest("hex"),
    byteCount: parentBytes.byteLength,
    decodedWidth: parentWidth,
    decodedHeight: parentHeight,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  };
  const child = {
    sha256: createHash("sha256").update(childBytes).digest("hex"),
    byteCount: childBytes.byteLength,
    decodedWidth: childWidth,
    decodedHeight: childHeight,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  };
  const result: AfcSr1TileGridScaffoldResult = {
    status: "generated",
    input: parent,
    tiled: {
      base64: childBytes.toString("base64"),
      identity: child,
    },
    provenance: {
      generatorId: "vibode-tile-grid-scaffold/stage2/v1",
      profileId: "afc-sr1-tile-grid-scaffold/v1",
      researchPreset: "tile_grid_scaffold",
      requestedModelId: "NBP",
      runId: "synthetic-existing-ts0-run",
      generatedAt: "2026-08-10T00:00:00.000Z",
      appliedAspectRatio: null,
      imageTransport: "data_url",
      generationStatus: "generated",
    },
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: parent.sha256,
        decodedWidth: parentWidth,
        decodedHeight: parentHeight,
        orientation: 1,
      },
      {
        fingerprint: child.sha256,
        decodedWidth: childWidth,
        decodedHeight: childHeight,
        orientation: 1,
      }
    ),
  };
  const authority = await validateAfcSr1GeneratedTs0ParentChildLineage(
    result,
    parentBytes,
    childBytes
  );
  return { parentBytes, childBytes, parent, child, result, authority };
}
