import "server-only";

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  parseAfcR3cImageManifest,
  type AfcR3cImageManifestV1,
  type ValidSharedCandidateComparisonContext,
} from "./gemini-floor-proposal-manifest";
import { writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
import type { AfcUi2aReverifiedPackageImages } from "./afc-ui2a-package-image-verification";
import { afcUi2aManifestFilename, deepFreeze } from "./afc-ui2a-prepared-package-contract";

export type AfcUi2aManifestWriteDisposition = "written" | "byte_identical" | "semantically_adopted";
export type AfcUi2aManifestWriterDependencies = Readonly<{
  immutableWriter?: typeof writeAfcR3cImmutableCapture;
}>;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Pure AFC-R3C v1 manifest construction from newly reread image evidence only. */
export function buildAfcUi2aImageManifest(input: {
  roomId: string;
  images: Pick<AfcUi2aReverifiedPackageImages, "original" | "emptyRoomAssist">;
  sharedComparisonContext: ValidSharedCandidateComparisonContext;
}): Readonly<{ ok: true; manifest: AfcR3cImageManifestV1 }> | Readonly<{ ok: false }> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.roomId) ||
    path.basename(input.images.original.fileName) !== input.images.original.fileName ||
    path.basename(input.images.emptyRoomAssist.fileName) !== input.images.emptyRoomAssist.fileName ||
    input.images.original.fileName === input.images.emptyRoomAssist.fileName) return deepFreeze({ ok: false as const });
  const parsed = parseAfcR3cImageManifest({
    contractVersion: "afc-r3c-image-manifest/v1",
    roomId: input.roomId,
    original: {
      filePath: input.images.original.fileName,
      sha256: input.images.original.sha256,
      byteCount: input.images.original.byteCount,
      decodedWidth: input.images.original.decodedWidth,
      decodedHeight: input.images.original.decodedHeight,
      orientation: 1,
      mimeType: input.images.original.mimeType,
    },
    emptyRoomAssist: {
      filePath: input.images.emptyRoomAssist.fileName,
      sha256: input.images.emptyRoomAssist.sha256,
      byteCount: input.images.emptyRoomAssist.byteCount,
      decodedWidth: input.images.emptyRoomAssist.decodedWidth,
      decodedHeight: input.images.emptyRoomAssist.decodedHeight,
      orientation: 1,
      mimeType: input.images.emptyRoomAssist.mimeType,
      generatedFromOriginalSha256: input.images.emptyRoomAssist.generatedFromOriginalSha256,
      generatorId: input.images.emptyRoomAssist.generatorId,
      generatorModelId: input.images.emptyRoomAssist.requestedModelId,
    },
    sharedComparisonContext: input.sharedComparisonContext,
  });
  return parsed.ok ? deepFreeze({ ok: true as const, manifest: parsed.manifest }) : deepFreeze({ ok: false as const });
}

export function stableAfcUi2aManifestBytes(manifest: AfcR3cImageManifestV1): Buffer {
  return Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

type SafeFile =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "unsafe" }>
  | Readonly<{ status: "present"; path: string; bytes: Buffer }>;

async function readSafeFile(directory: string, filename: string): Promise<SafeFile> {
  if (path.basename(filename) !== filename) return { status: "unsafe" };
  const lexical = path.resolve(directory, filename);
  if (!inside(directory, lexical)) return { status: "unsafe" };
  try {
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink()) return { status: "unsafe" };
    const actual = await realpath(lexical);
    if (!inside(directory, actual)) return { status: "unsafe" };
    return { status: "present", path: actual, bytes: await readFile(actual) };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "absent" } : { status: "unsafe" };
  }
}

async function safeExistingDirectory(directory: string): Promise<string | null> {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    return await realpath(directory);
  } catch {
    return null;
  }
}
function parseManifestBytes(bytes: Buffer): AfcR3cImageManifestV1 | null {
  try {
    const parsed = parseAfcR3cImageManifest(JSON.parse(bytes.toString("utf8")));
    return parsed.ok ? parsed.manifest : null;
  } catch {
    return null;
  }
}

/** Refuses replacement; semantic adoption is only for an existing parseable v1 manifest. */
export async function writeAfcUi2aImageManifest(args: {
  roomDirectory: string;
  roomId: string;
  expectedManifest: AfcR3cImageManifestV1;
  expectedBytes: Buffer;
}, dependencies: AfcUi2aManifestWriterDependencies = {}): Promise<
  | Readonly<{ ok: true; disposition: AfcUi2aManifestWriteDisposition; fileName: string; bytes: Buffer; sha256: string; manifest: AfcR3cImageManifestV1 }>
  | Readonly<{ ok: false; failureCode: "manifest_conflict" | "manifest_capture_failed" | "manifest_validation_failed" }>
> {
  const directory = await safeExistingDirectory(args.roomDirectory);
  const fileName = afcUi2aManifestFilename(args.roomId);
  if (!directory || args.expectedManifest.roomId !== args.roomId ||
    !stableAfcUi2aManifestBytes(args.expectedManifest).equals(args.expectedBytes)) {
    return deepFreeze({ ok: false as const, failureCode: "manifest_validation_failed" as const });
  }
  const existing = await readSafeFile(directory, fileName);
  if (existing.status === "unsafe") return deepFreeze({ ok: false as const, failureCode: "manifest_conflict" as const });
  if (existing.status === "present") {
    if (existing.bytes.equals(args.expectedBytes)) {
      return deepFreeze({
        ok: true as const, disposition: "byte_identical" as const, fileName, bytes: existing.bytes,
        sha256: sha256(existing.bytes), manifest: args.expectedManifest,
      });
    }
    const parsed = parseManifestBytes(existing.bytes);
    if (!parsed || !stableAfcUi2aManifestBytes(parsed).equals(args.expectedBytes)) {
      return deepFreeze({ ok: false as const, failureCode: "manifest_conflict" as const });
    }
    return deepFreeze({
      ok: true as const, disposition: "semantically_adopted" as const, fileName, bytes: existing.bytes,
      sha256: sha256(existing.bytes), manifest: parsed,
    });
  }
  const write = await (dependencies.immutableWriter ?? writeAfcR3cImmutableCapture)({
    outputDir: directory,
    filename: fileName,
    bytes: args.expectedBytes,
  });
  if (!write.ok) return deepFreeze({ ok: false as const, failureCode: "manifest_capture_failed" as const });
  const actual = await readSafeFile(directory, fileName);
  if (actual.status !== "present" || !actual.bytes.equals(args.expectedBytes)) {
    return deepFreeze({ ok: false as const, failureCode: "manifest_validation_failed" as const });
  }
  const parsed = parseManifestBytes(actual.bytes);
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(args.expectedManifest)) {
    return deepFreeze({ ok: false as const, failureCode: "manifest_validation_failed" as const });
  }
  return deepFreeze({
    ok: true as const, disposition: "written" as const, fileName, bytes: actual.bytes,
    sha256: sha256(actual.bytes), manifest: parsed,
  });
}
