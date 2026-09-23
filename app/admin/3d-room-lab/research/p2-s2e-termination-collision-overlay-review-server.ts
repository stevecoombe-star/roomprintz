import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import roomAValue from "./fixtures/p2-s1-empty-physical-boundary/room-a.json";
import roomCValue from "./fixtures/p2-s1-empty-physical-boundary/room-c.json";
import roomEValue from "./fixtures/p2-s1-empty-physical-boundary/room-e.json";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
  classifyP2S2ETerminationCollisionPolicies,
} from "./empty-visible-floor-termination-collision-policy";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  readCertifiedVisibleFloorTerminationFragments,
} from "./empty-visible-floor-contact-localizer";
import {
  createP2S2BEphemeralIdentityAdapter,
} from "./p2-s2b-holdout-prediction";
import {
  loadP2S2BFrozenReviewReceipt,
} from "./p2-s2b-frozen-prediction-review-server";
import type {
  P2S2ETerminationCollisionReviewRecord,
  P2S2ETerminationCollisionReviewRoomId,
} from "./p2-s2e-termination-collision-overlay-review";

export type P2S2ETerminationCollisionReviewLoadResult =
  | Readonly<{ ok: true; record: P2S2ETerminationCollisionReviewRecord }>
  | Readonly<{
      ok: false;
      code:
        | "authority_invalid"
        | "certified_empty_unavailable"
        | "p2_s2d_localizer_failed"
        | "policy_identity_mismatch";
    }>;

export type P2S2ETerminationCollisionReviewImageLoadResult =
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      contentType: "image/png";
      sha256: string;
    }>
  | Readonly<{ ok: false; code: "certified_empty_unavailable" }>;

type ImageAuthority = Readonly<{
  roomId: P2S2ETerminationCollisionReviewRoomId;
  manifestFileName: string;
  emptyImageSha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
  fixture: EmptyPhysicalBoundaryFixture;
}>;

type EmptyManifest = Readonly<{
  roomId: string;
  emptyRoomAssist: Readonly<{
    filePath: string;
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    mimeType: string;
  }>;
}>;

const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );

const FIXTURE_VALUES = Object.freeze({
  "room-a": roomAValue,
  "room-c": roomCValue,
  "room-e": roomEValue,
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixture(value: unknown): EmptyPhysicalBoundaryFixture | null {
  const parsed = parseEmptyPhysicalBoundaryFixture(value);
  return parsed.ok ? parsed.fixture : null;
}

function manifest(value: unknown): EmptyManifest | null {
  if (
    !record(value) ||
    typeof value.roomId !== "string" ||
    !record(value.emptyRoomAssist)
  ) return null;
  const empty = value.emptyRoomAssist;
  if (
    typeof empty.filePath !== "string" ||
    typeof empty.sha256 !== "string" ||
    typeof empty.decodedWidth !== "number" ||
    typeof empty.decodedHeight !== "number" ||
    empty.mimeType !== "image/png"
  ) return null;
  return value as EmptyManifest;
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

async function authority(
  roomId: P2S2ETerminationCollisionReviewRoomId
): Promise<ImageAuthority | null> {
  if (roomId === "room-b" || roomId === "room-d") {
    const verified = await loadP2S2BFrozenReviewReceipt(roomId);
    if (!verified.ok) return null;
    const input = verified.receipt.input;
    return Object.freeze({
      roomId,
      manifestFileName: input.manifestFileName,
      emptyImageSha256: input.emptySha256,
      dimensions: input.emptyDimensions,
      fixture: createP2S2BEphemeralIdentityAdapter(input, "a"),
    });
  }
  const parsed = fixture(FIXTURE_VALUES[roomId]);
  return parsed
    ? Object.freeze({
        roomId,
        manifestFileName: parsed.emptyImage.manifestFileName,
        emptyImageSha256: parsed.emptyImage.sha256,
        dimensions: parsed.emptyImage.dimensions,
        fixture: parsed,
      })
    : null;
}

async function loadImage(
  value: ImageAuthority
): Promise<P2S2ETerminationCollisionReviewImageLoadResult> {
  const root = await resolveAfcUi2aFixedInputsRoot(FIXED_INPUTS_ROOT);
  if (!root.ok) return { ok: false, code: "certified_empty_unavailable" };
  const roomDirectory = path.join(root.root, value.roomId);
  let parsedManifest: EmptyManifest | null;
  try {
    parsedManifest = manifest(JSON.parse(await readFile(
      path.join(roomDirectory, value.manifestFileName),
      "utf8"
    )) as unknown);
  } catch {
    return { ok: false, code: "certified_empty_unavailable" };
  }
  if (
    !parsedManifest ||
    parsedManifest.roomId !== value.roomId ||
    parsedManifest.emptyRoomAssist.sha256 !== value.emptyImageSha256 ||
    parsedManifest.emptyRoomAssist.decodedWidth !== value.dimensions.width ||
    parsedManifest.emptyRoomAssist.decodedHeight !== value.dimensions.height
  ) return { ok: false, code: "certified_empty_unavailable" };
  const imagePath = path.resolve(
    roomDirectory,
    parsedManifest.emptyRoomAssist.filePath
  );
  if (!inside(roomDirectory, imagePath)) {
    return { ok: false, code: "certified_empty_unavailable" };
  }
  try {
    const bytes = await readFile(imagePath);
    const [sha256, metadata] = await Promise.all([
      Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
      sharp(bytes).metadata(),
    ]);
    if (
      sha256 !== value.emptyImageSha256 ||
      metadata.width !== value.dimensions.width ||
      metadata.height !== value.dimensions.height ||
      metadata.format !== "png"
    ) return { ok: false, code: "certified_empty_unavailable" };
    return Object.freeze({
      ok: true,
      bytes,
      contentType: "image/png" as const,
      sha256,
    });
  } catch {
    return { ok: false, code: "certified_empty_unavailable" };
  }
}

export async function loadP2S2ETerminationCollisionReviewImage(
  roomId: P2S2ETerminationCollisionReviewRoomId
): Promise<P2S2ETerminationCollisionReviewImageLoadResult> {
  const value = await authority(roomId);
  return value
    ? loadImage(value)
    : { ok: false, code: "certified_empty_unavailable" };
}

export async function loadP2S2ETerminationCollisionReviewRecord(
  roomId: P2S2ETerminationCollisionReviewRoomId
): Promise<P2S2ETerminationCollisionReviewLoadResult> {
  const value = await authority(roomId);
  if (!value) return { ok: false, code: "authority_invalid" };
  const image = await loadImage(value);
  if (!image.ok) return image;
  const localized = await readCertifiedVisibleFloorTerminationFragments(
    image.bytes,
    value.fixture
  );
  if (!localized.ok) return { ok: false, code: "p2_s2d_localizer_failed" };
  const fragments = localized.localization.fragments;
  const policies = classifyP2S2ETerminationCollisionPolicies(fragments);
  if (
    policies.length !== fragments.length ||
    policies.some((policy, index) => policy.fragmentId !== fragments[index].id)
  ) return { ok: false, code: "policy_identity_mismatch" };
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      roomId,
      geometryAuthority: "certified_p2_s2d_current",
      policyVersion: P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
      emptyImageSha256: value.emptyImageSha256,
      dimensions: value.dimensions,
      fragments,
      policies,
      diagnostics: localized.localization.diagnostics,
    }),
  });
}
