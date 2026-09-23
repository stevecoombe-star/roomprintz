import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import type { AfcSr1BasisBoundSourcePolygonV1 } from "./afc-sr1-basis-bound-source-polygon";
import type { AfcSr1ExplicitAnchorAuthorityV1 } from "./afc-sr1-common-basis-tr0-handoff";
import { executeAfcSr1TileFloorReader } from "./afc-sr1-tile-floor-reader-execution";

const fixtureDirectory = new URL(
  "./fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1/",
  import.meta.url
);

function stripTiming(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTiming);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "elapsedMs" && key !== "runtimeMs"
  ).map(([key, item]) => [key, stripTiming(item)]));
}

async function main(): Promise<void> {
  const control = JSON.parse(await readFile(new URL("control.json", fixtureDirectory), "utf8"));
  const imagePath = process.env.AFC_SR1_ROOM_C_RAW_PATH?.trim() ||
    control.authority.rawImage.canonicalFixedInputPath;
  const bytes = await readFile(imagePath);
  const imageSha = createHash("sha256").update(bytes).digest("hex");
  const image = control.authority.rawImage;
  if (imageSha !== image.sha256 || bytes.byteLength !== image.byteCount ||
      bytes.readUInt32BE(16) !== image.decodedWidth ||
      bytes.readUInt32BE(20) !== image.decodedHeight ||
      image.orientation !== 1) {
    throw new Error("Room C strict live certification input identity mismatch.");
  }

  const input = {
    readerVersion: "v3" as const,
    tiledImageBytes: bytes,
    roi: control.authority.readerRoi,
    expectedImageIdentity: {
      sha256: image.sha256,
      byteCount: image.byteCount,
      decodedWidth: image.decodedWidth,
      decodedHeight: image.decodedHeight,
    },
    strictTr0Handoff: {
      readerImageKind: "raw_input" as const,
      basisBoundSourcePolygon:
        control.authority.basisBoundSourcePolygon as AfcSr1BasisBoundSourcePolygonV1,
      basisRelation: "identical_input" as const,
      truncatedAnchor: "NL" as const,
      anchorAuthority:
        control.authority.anchorAuthority as AfcSr1ExplicitAnchorAuthorityV1,
    },
  };

  const started = performance.now();
  const first = await executeAfcSr1TileFloorReader(input);
  const runtimeMs = performance.now() - started;
  const replay = await executeAfcSr1TileFloorReader(input);
  if (first.readerExecution.status !== "usable" ||
      first.commonBasisHandoff?.status !== "validated" ||
      first.projectiveHandoff?.status !== "usable" ||
      first.legacyUnboundProjectiveHandoff !== null) {
    throw new Error("Room C strict live certification authority path did not return usable.");
  }
  const seamT = first.projectiveHandoff.prior.seamT;
  const absoluteError = Math.abs(seamT - control.evaluation.gt0SeamT);
  const replayExactExcludingTiming =
    JSON.stringify(stripTiming(first)) === JSON.stringify(stripTiming(replay));
  if (absoluteError > control.evaluation.absoluteTolerance ||
      runtimeMs >= 15_000 || !replayExactExcludingTiming) {
    throw new Error("Room C strict live certification bars failed.");
  }
  process.stdout.write(`${JSON.stringify({
    status: "certified",
    imageIdentity: first.readerExecution.imageIdentity,
    receiptEvidenceDigest: first.readerExecution.evidenceDigest.value,
    commonBasisEvidenceDigest: first.commonBasisHandoff.handoff.evidenceDigest.value,
    seamT,
    gt0SeamT: control.evaluation.gt0SeamT,
    absoluteError,
    replayExactExcludingTiming,
    runtimeMs,
    providerGeneration: false,
  }, null, 2)}\n`);
}

void main();
