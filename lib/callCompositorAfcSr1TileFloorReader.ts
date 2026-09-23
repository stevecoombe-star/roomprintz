import "server-only";

import { callCompositorJson } from "./compositorTransportError";

export const AFC_SR1_TR2_TILE_FLOOR_READER_PATH =
  "/api/research/afc-sr1/tile-floor-vanishing-line" as const;

export async function callCompositorAfcSr1TileFloorReader(args: {
  payload: unknown;
  signal?: AbortSignal;
}): Promise<unknown> {
  return callCompositorJson({
    seam: "tile-floor-reader",
    path: AFC_SR1_TR2_TILE_FLOOR_READER_PATH,
    method: "POST",
    payload: args.payload,
    signal: args.signal,
  });
}
