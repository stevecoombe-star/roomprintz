import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  getP2S2BHoldoutOracleIdentity,
  type P2S2BHoldoutOracleRoomId,
} from "./p2-s2b-holdout-oracle-authoring";

export type P2S2BHoldoutOracleImageLoadResult =
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      contentType: "image/png";
      sha256: string;
      dimensions: Readonly<{ width: number; height: number }>;
    }>
  | Readonly<{
      ok: false;
      code:
        | "fixed_inputs_root_unavailable"
        | "fixed_inputs_root_disallowed"
        | "manifest_invalid"
        | "image_unavailable"
        | "image_identity_mismatch";
    }>;

type Manifest = Readonly<{
  roomId: string;
  original: Readonly<{ sha256: string }>;
  emptyRoomAssist: Readonly<{
    filePath: string;
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    mimeType: string;
    generatedFromOriginalSha256: string;
    generatorId: string;
  }>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(value: unknown): Manifest | null {
  if (
    !record(value) ||
    typeof value.roomId !== "string" ||
    !record(value.original) ||
    typeof value.original.sha256 !== "string" ||
    !record(value.emptyRoomAssist)
  ) {
    return null;
  }
  const empty = value.emptyRoomAssist;
  if (
    typeof empty.filePath !== "string" ||
    typeof empty.sha256 !== "string" ||
    typeof empty.decodedWidth !== "number" ||
    typeof empty.decodedHeight !== "number" ||
    typeof empty.mimeType !== "string" ||
    typeof empty.generatedFromOriginalSha256 !== "string" ||
    typeof empty.generatorId !== "string"
  ) {
    return null;
  }
  return value as Manifest;
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Reads only the certified EMPTY image and its identity manifest. No detector
 * receipt or result module is reachable from this authoring boundary.
 */
export async function loadP2S2BHoldoutOracleEmptyImage(
  roomId: P2S2BHoldoutOracleRoomId,
  configuredRoot =
    process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
    path.join(
      os.homedir(),
      "Documents",
      "Vibode",
      "AFC",
      "vibode-afc-r3c-fixed-inputs"
    )
): Promise<P2S2BHoldoutOracleImageLoadResult> {
  const resolvedRoot = await resolveAfcUi2aFixedInputsRoot(configuredRoot);
  if (!resolvedRoot.ok) return resolvedRoot;

  const identity = getP2S2BHoldoutOracleIdentity(roomId);
  const roomDirectory = path.join(resolvedRoot.root, roomId);
  let manifest: Manifest | null;
  try {
    manifest = parseManifest(JSON.parse(await readFile(
      path.join(roomDirectory, identity.manifestFileName),
      "utf8"
    )) as unknown);
  } catch {
    return { ok: false, code: "manifest_invalid" };
  }
  if (
    !manifest ||
    manifest.roomId !== roomId ||
    manifest.original.sha256 !== identity.originalSha256 ||
    manifest.emptyRoomAssist.sha256 !== identity.emptySha256 ||
    manifest.emptyRoomAssist.decodedWidth !== identity.emptyDimensions.width ||
    manifest.emptyRoomAssist.decodedHeight !== identity.emptyDimensions.height ||
    manifest.emptyRoomAssist.mimeType !== "image/png" ||
    manifest.emptyRoomAssist.generatedFromOriginalSha256 !==
      identity.originalSha256 ||
    manifest.emptyRoomAssist.generatorId !== identity.generatorId
  ) {
    return { ok: false, code: "manifest_invalid" };
  }

  const imagePath = path.resolve(roomDirectory, manifest.emptyRoomAssist.filePath);
  if (!inside(roomDirectory, imagePath)) {
    return { ok: false, code: "manifest_invalid" };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(imagePath);
  } catch {
    return { ok: false, code: "image_unavailable" };
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return { ok: false, code: "image_identity_mismatch" };
  }
  if (
    digest !== identity.emptySha256 ||
    metadata.width !== identity.emptyDimensions.width ||
    metadata.height !== identity.emptyDimensions.height ||
    metadata.format !== "png"
  ) {
    return { ok: false, code: "image_identity_mismatch" };
  }
  return Object.freeze({
    ok: true,
    bytes,
    contentType: "image/png",
    sha256: digest,
    dimensions: Object.freeze({ ...identity.emptyDimensions }),
  });
}
