import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import type {
  AfcSr1LiveBasis,
} from "../afc-sr1-live-product-contract";
import type {
  AfcSr1QualifiedOriginal,
  AfcSr1ResolvedEmpty,
} from "../afc-sr1-live-product";
import {
  replayAfcUi2aPreparedPackage,
  type AfcUi2aVerifiedPreparedPackage,
} from "./afc-ui2a-prepared-package-replay";

export type AfcSr1CertifiedEmptyPackageSelector = Readonly<{
  roomId: string;
  packageId: string;
  receiptFileName: string;
  receiptSha256: string;
}>;

export type AfcSr1CertifiedEmptyExpectedOriginal = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;

export type AfcSr1CertifiedEmptyLiveResolution = Readonly<{
  package: AfcSr1CertifiedEmptyPackageSelector;
  original: AfcSr1LiveBasis;
  empty: AfcSr1ResolvedEmpty;
}>;

export type AfcSr1CertifiedEmptyLiveResolveDependencies = Readonly<{
  replayPackage?: typeof replayAfcUi2aPreparedPackage;
  readEmptyBytes?: (
    evidence: AfcUi2aVerifiedPreparedPackage
  ) => Promise<Uint8Array>;
  inspectMetadata?: typeof inspectImageMetadata;
}>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mimeFromBytes(bytes: Uint8Array): AfcSr1LiveBasis["mimeType"] | null {
  const buffer = Buffer.from(bytes);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function matchesExpectedOriginal(
  original: AfcSr1LiveBasis,
  expected: AfcSr1CertifiedEmptyExpectedOriginal
): boolean {
  return original.sha256 === expected.sha256 &&
    original.decodedWidth === expected.decodedWidth &&
    original.decodedHeight === expected.decodedHeight &&
    original.orientation === expected.orientation;
}

function matchesQualifiedOriginal(
  original: AfcSr1QualifiedOriginal,
  expected: AfcSr1LiveBasis
): boolean {
  const basis = original.basis;
  return basis.sha256 === expected.sha256 &&
    basis.byteCount === expected.byteCount &&
    basis.decodedWidth === expected.decodedWidth &&
    basis.decodedHeight === expected.decodedHeight &&
    basis.mimeType === expected.mimeType &&
    basis.orientation === expected.orientation;
}

/**
 * Replays one immutable UI2A prepared package and exposes its exact certified
 * EMPTY only as a non-generated AFC input. Selectors are identities, never
 * caller-controlled paths; replay retains all fixed-input-root confinement.
 */
export async function resolveAfcSr1CertifiedEmptyLive(
  args: Readonly<{
    selector: AfcSr1CertifiedEmptyPackageSelector;
    expectedOriginal: AfcSr1CertifiedEmptyExpectedOriginal;
  }>,
  dependencies: AfcSr1CertifiedEmptyLiveResolveDependencies = {}
): Promise<AfcSr1CertifiedEmptyLiveResolution | null> {
  const replay = await (dependencies.replayPackage ?? replayAfcUi2aPreparedPackage)({
    roomLabel: args.selector.roomId,
    packageId: args.selector.packageId,
    receiptFileName: args.selector.receiptFileName,
    receiptSha256: args.selector.receiptSha256,
  });
  if (!replay.ok) return null;

  const receipt = replay.evidence.receipt;
  const receiptOriginal: AfcSr1LiveBasis = {
    sha256: receipt.original.sha256,
    byteCount: receipt.original.byteCount,
    decodedWidth: receipt.original.decodedWidth,
    decodedHeight: receipt.original.decodedHeight,
    mimeType: receipt.original.mimeType,
    orientation: receipt.original.orientation,
  };
  if (
    replay.evidence.roomId !== args.selector.roomId ||
    replay.evidence.packageId !== args.selector.packageId ||
    !matchesExpectedOriginal(receiptOriginal, args.expectedOriginal) ||
    receipt.emptyRoomAssist.generatedFromOriginalSha256 !== receipt.original.sha256
  ) {
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(
      await (dependencies.readEmptyBytes ?? (async (evidence) =>
        readFile(evidence.emptyRoomAssistFilePath)))(replay.evidence)
    );
  } catch {
    return null;
  }
  const mimeType = mimeFromBytes(bytes);
  const metadata = await (dependencies.inspectMetadata ?? inspectImageMetadata)(Buffer.from(bytes));
  if (
    !mimeType ||
    !metadata.ok ||
    metadata.orientation !== 1 ||
    sha256(bytes) !== receipt.emptyRoomAssist.sha256 ||
    bytes.byteLength !== receipt.emptyRoomAssist.byteCount ||
    mimeType !== receipt.emptyRoomAssist.mimeType ||
    metadata.width !== receipt.emptyRoomAssist.decodedWidth ||
    metadata.height !== receipt.emptyRoomAssist.decodedHeight ||
    receipt.emptyRoomAssist.orientation !== 1
  ) {
    return null;
  }

  return Object.freeze({
    package: Object.freeze({ ...args.selector }),
    original: Object.freeze(receiptOriginal),
    empty: Object.freeze({
      basis: Object.freeze({
        sha256: receipt.emptyRoomAssist.sha256,
        byteCount: receipt.emptyRoomAssist.byteCount,
        decodedWidth: receipt.emptyRoomAssist.decodedWidth,
        decodedHeight: receipt.emptyRoomAssist.decodedHeight,
        mimeType: receipt.emptyRoomAssist.mimeType,
        orientation: 1,
      }),
      bytes,
      generated: false,
    }),
  });
}

/** The executor may receive EMPTY only after its freshly qualified Original binds the package exactly. */
export function createAfcSr1CertifiedEmptyResolver(
  resolution: AfcSr1CertifiedEmptyLiveResolution
): (original: AfcSr1QualifiedOriginal) => Promise<AfcSr1ResolvedEmpty | null> {
  return async (original) =>
    matchesQualifiedOriginal(original, resolution.original) ? resolution.empty : null;
}
