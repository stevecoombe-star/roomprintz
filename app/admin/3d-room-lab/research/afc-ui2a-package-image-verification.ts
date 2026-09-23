import "server-only";

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import {
  AFC_UI2A_EMPTY_GENERATOR_ID,
  type AfcUi2aVerifiedEmptyEvidence,
} from "./afc-ui2a-empty-evidence-replay";
import type { AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";
import type { AfcUi2aSupportedMime } from "./afc-ui2a-original-preparation-contract";
import { deepFreeze } from "./afc-ui2a-prepared-package-contract";

export type AfcUi2aPackageImageVerificationFailure =
  | "original_image_missing"
  | "original_image_mismatch"
  | "empty_image_missing"
  | "empty_image_mismatch"
  | "empty_lineage_mismatch";

export type AfcUi2aReverifiedPackageImages = Readonly<{
  roomDirectory: string;
  original: AfcUi2aVerifiedOriginalEvidence["original"];
  emptyRoomAssist: AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"];
}>;

export type AfcUi2aPackageImageVerificationDependencies = Readonly<{
  inspectMetadata?: typeof inspectImageMetadata;
  fingerprint?: (bytes: Buffer) => string;
}>;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function mimeFromBytes(bytes: Buffer): AfcUi2aSupportedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
function extensionMatches(name: string, mime: AfcUi2aSupportedMime): boolean {
  return mime === "image/jpeg" ? /\.(jpg|jpeg)$/.test(name) :
    mime === "image/png" ? /\.png$/.test(name) : /\.webp$/.test(name);
}
function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
async function verifiedRoom(directory: string): Promise<string | null> {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    return await realpath(directory);
  } catch {
    return null;
  }
}
async function localRegularFile(directory: string, name: string): Promise<string | null> {
  if (path.basename(name) !== name) return null;
  const lexical = path.resolve(directory, name);
  if (!inside(directory, lexical)) return null;
  try {
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(lexical);
    return inside(directory, actual) ? actual : null;
  } catch {
    return null;
  }
}

async function verifyImage(
  directory: string,
  expected: AfcUi2aVerifiedOriginalEvidence["original"] | AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"],
  missing: AfcUi2aPackageImageVerificationFailure,
  mismatch: AfcUi2aPackageImageVerificationFailure,
  dependencies: AfcUi2aPackageImageVerificationDependencies,
): Promise<{ ok: true; image: typeof expected } | { ok: false; code: AfcUi2aPackageImageVerificationFailure }> {
  if (!extensionMatches(expected.fileName, expected.mimeType)) return { ok: false, code: mismatch };
  const filePath = await localRegularFile(directory, expected.fileName);
  if (!filePath) return { ok: false, code: missing };
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return { ok: false, code: missing };
  }
  const actualMime = mimeFromBytes(bytes);
  if (!actualMime || actualMime !== expected.mimeType || bytes.byteLength !== expected.byteCount ||
    (dependencies.fingerprint ?? digest)(bytes) !== expected.sha256) return { ok: false, code: mismatch };
  const metadata = await (dependencies.inspectMetadata ?? inspectImageMetadata)(bytes);
  if (!metadata.ok || metadata.orientation !== 1 || metadata.orientation !== expected.orientation ||
    metadata.width !== expected.decodedWidth ||
    metadata.height !== expected.decodedHeight) return { ok: false, code: mismatch };
  return { ok: true, image: expected };
}

/** Reopens immutable inputs immediately before a package write; frozen caller objects are not authority. */
export async function reverifyAfcUi2aPackageImages(
  originalEvidence: AfcUi2aVerifiedOriginalEvidence,
  emptyEvidence: AfcUi2aVerifiedEmptyEvidence,
  dependencies: AfcUi2aPackageImageVerificationDependencies = {},
): Promise<
  Readonly<{ ok: true; images: AfcUi2aReverifiedPackageImages }> |
  Readonly<{ ok: false; failureCode: AfcUi2aPackageImageVerificationFailure }>
> {
  const roomDirectory = await verifiedRoom(originalEvidence.roomDirectory);
  if (!roomDirectory) return deepFreeze({ ok: false as const, failureCode: "original_image_missing" as const });
  const original = await verifyImage(roomDirectory, originalEvidence.original, "original_image_missing", "original_image_mismatch", dependencies);
  if (!original.ok) return deepFreeze({ ok: false as const, failureCode: original.code });
  const empty = await verifyImage(roomDirectory, emptyEvidence.emptyRoomAssist, "empty_image_missing", "empty_image_mismatch", dependencies);
  if (!empty.ok) return deepFreeze({ ok: false as const, failureCode: empty.code });
  if (emptyEvidence.emptyRoomAssist.generatedFromOriginalSha256 !== originalEvidence.original.sha256 ||
    emptyEvidence.emptyRoomAssist.generatorId !== AFC_UI2A_EMPTY_GENERATOR_ID ||
    emptyEvidence.emptyRoomAssist.requestedModelId !== "NBP" ||
    emptyEvidence.emptyRoomAssist.resolvedModelId !== null ||
    emptyEvidence.emptyRoomAssist.resolvedModelStatus !== "not_reported_by_compositor") {
    return deepFreeze({ ok: false as const, failureCode: "empty_lineage_mismatch" as const });
  }
  return deepFreeze({
    ok: true as const,
    images: {
      roomDirectory,
      original: { ...(original.image as AfcUi2aVerifiedOriginalEvidence["original"]) },
      emptyRoomAssist: { ...(empty.image as AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"]) },
    },
  });
}
