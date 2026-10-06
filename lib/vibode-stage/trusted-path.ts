/**
 * Derived Room Scale presentation for an already certified AFC path.
 *
 * The baseline length is the certified measurement at roomScaleMultiplier
 * 1.00. Room Scale only multiplies that number for display. Nothing here
 * is written back to AFC certification or metricScale.
 */

import {
  ROOM_SCALE_DEFAULT,
  clampRoomScaleMultiplier,
} from "@/lib/vibode-stage/room-scale";

/** Diagnostic trusted-span stroke, rgb(34, 211, 238). */
export const TRUSTED_PATH_STROKE = 0x22d3ee;

export const TRUSTED_PATH_UNAVAILABLE_TITLE =
  "No trusted path is available for this room";

export type TrustedPathImagePoint = Readonly<{
  x: number;
  y: number;
}>;

/**
 * Certified path at room scale 1.00.
 * Image points are the diagnostic span endpoints in source-normalized space.
 */
export type TrustedPathBaseline = Readonly<{
  baselineLengthMeters: number;
  imageA: TrustedPathImagePoint;
  imageB: TrustedPathImagePoint;
}>;

export function initialTrustedPathVisible(): boolean {
  return false;
}

/** Reset changes scale only. A visible path stays visible. */
export function trustedPathVisibleAfterScaleReset(visible: boolean): boolean {
  return visible;
}

export function nextTrustedPathVisible(
  visible: boolean,
  available: boolean,
): boolean {
  if (!available) return visible;
  return !visible;
}

/**
 * displayedLengthMeters = baselineTrustedPathLengthMeters × roomScaleMultiplier
 *
 * At 1.00× the baseline number is returned unchanged.
 */
export function effectiveTrustedPathLengthMeters(
  baselineTrustedPathLengthMeters: number,
  roomScaleMultiplier: number,
): number | null {
  if (
    typeof baselineTrustedPathLengthMeters !== "number" ||
    !Number.isFinite(baselineTrustedPathLengthMeters) ||
    baselineTrustedPathLengthMeters <= 0
  ) {
    return null;
  }
  const scale = clampRoomScaleMultiplier(roomScaleMultiplier);
  if (scale === ROOM_SCALE_DEFAULT) return baselineTrustedPathLengthMeters;
  return baselineTrustedPathLengthMeters * scale;
}

/** Exact inches per metre used for the overlay's imperial line. */
export const TRUSTED_PATH_INCHES_PER_METER = 39.37007874015748;

export function formatTrustedPathLengthLabel(meters: number): string | null {
  if (typeof meters !== "number" || !Number.isFinite(meters)) return null;
  return `${meters.toFixed(2)} m`;
}

/**
 * Nearest whole inch, then feet. A remainder that rounds to 12 inches
 * becomes the next foot and 0 inches.
 */
export function formatTrustedPathImperialLabel(meters: number): string | null {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return null;
  const totalInches = meters * TRUSTED_PATH_INCHES_PER_METER;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${feet}' ${inches}"`;
}

/** Two-line overlay label. Imperial is converted only from this metre value. */
export function formatMetersAndImperial(meters: number): string | null {
  const metric = formatTrustedPathLengthLabel(meters);
  const imperial = formatTrustedPathImperialLabel(meters);
  if (metric == null || imperial == null) return null;
  return `${metric}\n${imperial}`;
}

export function parseTrustedPathBaseline(value: unknown): TrustedPathBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.baselineLengthMeters !== "number" ||
    !Number.isFinite(record.baselineLengthMeters) ||
    record.baselineLengthMeters <= 0
  ) {
    return null;
  }
  const imageA = readPoint(record.imageA);
  const imageB = readPoint(record.imageB);
  if (!imageA || !imageB) return null;
  if (Math.hypot(imageB.x - imageA.x, imageB.y - imageA.y) <= 1e-6) return null;
  return Object.freeze({
    baselineLengthMeters: record.baselineLengthMeters,
    imageA: Object.freeze(imageA),
    imageB: Object.freeze(imageB),
  });
}

function readPoint(value: unknown): TrustedPathImagePoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number") return null;
  if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return null;
  return { x: record.x, y: record.y };
}
