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
import { readCertifiedEmptyRegionBoundaryFragments } from "./empty-region-boundary-fragments";
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
  P2S2DFloorContactReviewRecord,
  P2S2DFloorContactReviewRoomId,
} from "./p2-s2d-floor-contact-overlay-review";

export type P2S2DFloorContactReviewLoadResult =
  | Readonly<{ ok: true; record: P2S2DFloorContactReviewRecord }>
  | Readonly<{
      ok: false;
      code:
        | "authority_invalid"
        | "receipt_unverified"
        | "receipt_outcome_unavailable"
        | "certified_empty_unavailable"
        | "old_detector_failed"
        | "new_localizer_failed";
    }>;

export type P2S2DFloorContactReviewImageLoadResult =
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      contentType: "image/png";
      sha256: string;
    }>
  | Readonly<{ ok: false; code: "certified_empty_unavailable" }>;

type ImageAuthority = Readonly<{
  roomId: P2S2DFloorContactReviewRoomId;
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
  roomId: P2S2DFloorContactReviewRoomId
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
  const parsed = fixture(FIXTURE_VALUES[roomId]);
  return parsed
    ? Object.freeze({
        roomId,
        manifestFileName: parsed.emptyImage.manifestFileName,
        emptyImageSha256: parsed.emptyImage.sha256,
        dimensions: parsed.emptyImage.dimensions,
      })
    : null;
}

async function loadImage(
  value: ImageAuthority
): Promise<P2S2DFloorContactReviewImageLoadResult> {
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

export async function loadP2S2DFloorContactReviewImage(
  roomId: P2S2DFloorContactReviewRoomId
): Promise<P2S2DFloorContactReviewImageLoadResult> {
  const value = await authority(roomId);
  return value
    ? loadImage(value)
    : { ok: false, code: "certified_empty_unavailable" };
}

export async function loadP2S2DFloorContactReviewRecord(
  roomId: P2S2DFloorContactReviewRoomId
): Promise<P2S2DFloorContactReviewLoadResult> {
  const value = await authority(roomId);
  if (!value) return { ok: false, code: "authority_invalid" };
  const image = await loadImage(value);
  if (!image.ok) return image;

  if (roomId === "room-b" || roomId === "room-d") {
    const verified = await loadP2S2BFrozenReviewReceipt(roomId);
    if (!verified.ok) return { ok: false, code: "receipt_unverified" };
    if (verified.receipt.outcome.status !== "ok") {
      return { ok: false, code: "receipt_outcome_unavailable" };
    }
    const identityFixture = createP2S2BEphemeralIdentityAdapter(
      verified.receipt.input,
      "a"
    );
    const localized = await readCertifiedVisibleFloorTerminationFragments(
      image.bytes,
      identityFixture
    );
    if (!localized.ok) return { ok: false, code: "new_localizer_failed" };
    return Object.freeze({
      ok: true,
      record: Object.freeze({
        roomId,
        oldSourceAuthority: "frozen_p2_s2b_receipt",
        emptyImageSha256: value.emptyImageSha256,
        dimensions: value.dimensions,
        oldReceiptSha256: verified.receiptSha256,
        oldFragments: verified.receipt.outcome.fragments,
        newFragments: localized.localization.fragments,
        diagnostics: localized.localization.diagnostics,
      }),
    });
  }

  const parsedFixture = fixture(FIXTURE_VALUES[roomId]);
  if (!parsedFixture) return { ok: false, code: "authority_invalid" };
  const [oldRead, localized] = await Promise.all([
    readCertifiedEmptyRegionBoundaryFragments(image.bytes, parsedFixture),
    readCertifiedVisibleFloorTerminationFragments(image.bytes, parsedFixture),
  ]);
  if (!oldRead.ok) return { ok: false, code: "old_detector_failed" };
  if (!localized.ok) return { ok: false, code: "new_localizer_failed" };
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      roomId,
      oldSourceAuthority: "certified_p2_s2a_current",
      emptyImageSha256: value.emptyImageSha256,
      dimensions: value.dimensions,
      oldReceiptSha256: null,
      oldFragments: oldRead.fragments,
      newFragments: localized.localization.fragments,
      diagnostics: localized.localization.diagnostics,
    }),
  });
}
