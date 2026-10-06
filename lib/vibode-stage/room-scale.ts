/**
 * User room-scale calibration.
 *
 * Certified AFC metricScale stays on the authority.
 * effectiveMetricScale = certifiedMetricScale × roomScaleMultiplier
 * is applied once by production-world realization.
 */

/** Beta/demo calibration window. Narrow again before general availability. */
export const ROOM_SCALE_MIN = 0.25;
export const ROOM_SCALE_MAX = 2;
export const ROOM_SCALE_STEP = 0.01;
export const ROOM_SCALE_DEFAULT = 1;

export const ROOM_SCALE_RANGE_ERROR =
  `Room scale is outside ${ROOM_SCALE_MIN.toFixed(2)}×–${ROOM_SCALE_MAX.toFixed(2)}×.`;

export function clampRoomScaleMultiplier(value: number): number {
  if (!Number.isFinite(value)) return ROOM_SCALE_DEFAULT;
  const rounded = Math.round(value * 100) / 100;
  if (rounded < ROOM_SCALE_MIN) return ROOM_SCALE_MIN;
  if (rounded > ROOM_SCALE_MAX) return ROOM_SCALE_MAX;
  return rounded;
}

/** Accepts an in-range hundredth. Out-of-range values are rejected, not clamped. */
export function parseRoomScaleMultiplier(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric * 100) / 100;
  if (Math.abs(numeric - rounded) > 1e-8) return null;
  if (rounded < ROOM_SCALE_MIN || rounded > ROOM_SCALE_MAX) return null;
  return rounded;
}

export function effectiveMetricScale(
  certifiedMetricScale: number,
  roomScaleMultiplier: number,
): number {
  const certified = Number.isFinite(certifiedMetricScale) && certifiedMetricScale > 0
    ? certifiedMetricScale
    : 1;
  return certified * clampRoomScaleMultiplier(roomScaleMultiplier);
}

export function stepRoomScaleMultiplier(current: number, direction: -1 | 1): number {
  return clampRoomScaleMultiplier(
    clampRoomScaleMultiplier(current) + direction * ROOM_SCALE_STEP,
  );
}

export function formatRoomScaleMultiplier(multiplier: number): string {
  return `${clampRoomScaleMultiplier(multiplier).toFixed(2)}×`;
}

export function roomScaleButtonLabel(multiplier: number): string {
  const value = clampRoomScaleMultiplier(multiplier);
  if (value === ROOM_SCALE_DEFAULT) return "Room Scale";
  return `Room Scale ${value.toFixed(2)}×`;
}

export type RoomScaleResult =
  | { ok: true; roomScaleMultiplier: number }
  | { ok: false; status: number; error: string };

export type RoomScaleStore = Readonly<{
  read: (userId: string, roomId: string) => Promise<RoomScaleResult>;
  write: (
    userId: string,
    roomId: string,
    roomScaleMultiplier: number,
  ) => Promise<RoomScaleResult>;
}>;

export function createMemoryRoomScaleStore(
  rooms: readonly { roomId: string; userId: string; roomScaleMultiplier?: number }[],
): RoomScaleStore {
  const rows = new Map(rooms.map((room) => [
    room.roomId,
    {
      userId: room.userId,
      roomScaleMultiplier: room.roomScaleMultiplier ?? ROOM_SCALE_DEFAULT,
    },
  ]));
  return {
    async read(userId, roomId) {
      const row = rows.get(roomId);
      if (!row || row.userId !== userId) {
        return { ok: false, status: 404, error: "Room not found." };
      }
      return { ok: true, roomScaleMultiplier: row.roomScaleMultiplier };
    },
    async write(userId, roomId, roomScaleMultiplier) {
      const row = rows.get(roomId);
      if (!row || row.userId !== userId) {
        return { ok: false, status: 404, error: "Room not found." };
      }
      const parsed = parseRoomScaleMultiplier(roomScaleMultiplier);
      if (parsed == null) {
        return { ok: false, status: 400, error: ROOM_SCALE_RANGE_ERROR };
      }
      row.roomScaleMultiplier = parsed;
      return { ok: true, roomScaleMultiplier: parsed };
    },
  };
}
