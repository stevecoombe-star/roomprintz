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
  readCertifiedEmptyRegionBoundaryFragments,
} from "./empty-region-boundary-fragments";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  classifyP2S2CCollisionPolicies,
} from "./empty-boundary-collision-policy";
import {
  loadP2S2BFrozenReviewReceipt,
} from "./p2-s2b-frozen-prediction-review-server";
import {
  type P2S2CCollisionOverlayReviewRecord,
  type P2S2CCollisionOverlayReviewRoomId,
} from "./p2-s2c-collision-overlay-review";

export type P2S2CCollisionOverlayReviewLoadResult =
  | Readonly<{ ok: true; record: P2S2CCollisionOverlayReviewRecord }>
  | Readonly<{
      ok: false;
      code:
        | "authority_invalid"
        | "receipt_unverified"
        | "receipt_outcome_unavailable"
        | "certified_empty_unavailable"
        | "detector_failed";
    }>;

export type P2S2CCollisionOverlayReviewImageLoadResult =
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      contentType: "image/png";
      sha256: string;
    }>
  | Readonly<{ ok: false; code: "certified_empty_unavailable" }>;

type ImageAuthority = Readonly<{
  roomId: P2S2CCollisionOverlayReviewRoomId;
  manifestFileName: string;
  emptyImageSha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
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

const REGRESSION_FIXTURE_VALUES = Object.freeze({
  "room-a": roomAValue,
  "room-c": roomCValue,
  "room-e": roomEValue,
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsedFixture(value: unknown): EmptyPhysicalBoundaryFixture | null {
  const parsed = parseEmptyPhysicalBoundaryFixture(value);
  return parsed.ok ? parsed.fixture : null;
}

function parsedManifest(value: unknown): EmptyManifest | null {
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
    typeof empty.mimeType !== "string"
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

async function imageAuthority(
  roomId: P2S2CCollisionOverlayReviewRoomId
): Promise<ImageAuthority | null> {
  if (roomId === "room-b" || roomId === "room-d") {
    const verified = await loadP2S2BFrozenReviewReceipt(roomId);
    if (!verified.ok) return null;
    return Object.freeze({
      roomId,
      manifestFileName: verified.receipt.input.manifestFileName,
      emptyImageSha256: verified.receipt.input.emptySha256,
      dimensions: verified.receipt.input.emptyDimensions,
    });
  }
  const fixture = parsedFixture(REGRESSION_FIXTURE_VALUES[roomId]);
  if (!fixture) return null;
  return Object.freeze({
    roomId,
    manifestFileName: fixture.emptyImage.manifestFileName,
    emptyImageSha256: fixture.emptyImage.sha256,
    dimensions: fixture.emptyImage.dimensions,
  });
}

async function loadImageForAuthority(
  authority: ImageAuthority
): Promise<P2S2CCollisionOverlayReviewImageLoadResult> {
  const root = await resolveAfcUi2aFixedInputsRoot(FIXED_INPUTS_ROOT);
  if (!root.ok) return { ok: false, code: "certified_empty_unavailable" };
  const roomDirectory = path.join(root.root, authority.roomId);
  let manifest: EmptyManifest | null;
  try {
    manifest = parsedManifest(JSON.parse(await readFile(
      path.join(roomDirectory, authority.manifestFileName),
      "utf8"
    )) as unknown);
  } catch {
    return { ok: false, code: "certified_empty_unavailable" };
  }
  if (
    !manifest ||
    manifest.roomId !== authority.roomId ||
    manifest.emptyRoomAssist.sha256 !== authority.emptyImageSha256 ||
    manifest.emptyRoomAssist.decodedWidth !== authority.dimensions.width ||
    manifest.emptyRoomAssist.decodedHeight !== authority.dimensions.height ||
    manifest.emptyRoomAssist.mimeType !== "image/png"
  ) return { ok: false, code: "certified_empty_unavailable" };

  const imagePath = path.resolve(roomDirectory, manifest.emptyRoomAssist.filePath);
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
      sha256 !== authority.emptyImageSha256 ||
      metadata.width !== authority.dimensions.width ||
      metadata.height !== authority.dimensions.height ||
      metadata.format !== "png"
    ) return { ok: false, code: "certified_empty_unavailable" };
    return Object.freeze({
      ok: true,
      bytes,
      contentType: "image/png",
      sha256,
    });
  } catch {
    return { ok: false, code: "certified_empty_unavailable" };
  }
}

export async function loadP2S2CCollisionOverlayReviewImage(
  roomId: P2S2CCollisionOverlayReviewRoomId
): Promise<P2S2CCollisionOverlayReviewImageLoadResult> {
  const authority = await imageAuthority(roomId);
  return authority
    ? loadImageForAuthority(authority)
    : { ok: false, code: "certified_empty_unavailable" };
}

export async function loadP2S2CCollisionOverlayReviewRecord(
  roomId: P2S2CCollisionOverlayReviewRoomId
): Promise<P2S2CCollisionOverlayReviewLoadResult> {
  if (roomId === "room-b" || roomId === "room-d") {
    const verified = await loadP2S2BFrozenReviewReceipt(roomId);
    if (!verified.ok) return { ok: false, code: "receipt_unverified" };
    if (verified.receipt.outcome.status !== "ok") {
      return { ok: false, code: "receipt_outcome_unavailable" };
    }
    const fragments = verified.receipt.outcome.fragments;
    return Object.freeze({
      ok: true,
      record: Object.freeze({
        roomId,
        sourceAuthority: "frozen_p2_s2b_receipt",
        emptyImageSha256: verified.receipt.input.emptySha256,
        dimensions: verified.receipt.input.emptyDimensions,
        receiptSha256: verified.receiptSha256,
        fragments,
        policies: classifyP2S2CCollisionPolicies(fragments),
      }),
    });
  }

  const fixture = parsedFixture(REGRESSION_FIXTURE_VALUES[roomId]);
  if (!fixture) return { ok: false, code: "authority_invalid" };
  const authority = await imageAuthority(roomId);
  if (!authority) return { ok: false, code: "authority_invalid" };
  const image = await loadImageForAuthority(authority);
  if (!image.ok) return { ok: false, code: "certified_empty_unavailable" };
  const fragmentRead = await readCertifiedEmptyRegionBoundaryFragments(
    image.bytes,
    fixture
  );
  if (!fragmentRead.ok) return { ok: false, code: "detector_failed" };
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      roomId,
      sourceAuthority: "certified_p2_s2a_current",
      emptyImageSha256: fixture.emptyImage.sha256,
      dimensions: fixture.emptyImage.dimensions,
      receiptSha256: null,
      fragments: fragmentRead.fragments,
      policies: classifyP2S2CCollisionPolicies(fragmentRead.fragments),
    }),
  });
}
