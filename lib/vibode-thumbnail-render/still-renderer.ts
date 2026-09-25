/**
 * Still-render constants locked to the production STAGE viewer.
 *
 * AfcProductionRoomViewer keeps these values inline. Partner snapshot
 * tests require that file to stay byte-identical, so this module is the
 * shared contract and a parity test reads the viewer source.
 *
 * Worker DPR is 1. The interactive viewer still uses device pixel ratio.
 */

export const VIBODE_THUMBNAIL_RENDERER_DPR = 1;

export const VIBODE_PRODUCTION_LIGHT_COLOR = 0xffffff;

export const VIBODE_PRODUCTION_AMBIENT_INTENSITY = 0.8;

export const VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY = 1;

export const VIBODE_PRODUCTION_DIRECTIONAL_POSITION = Object.freeze({
  x: 3,
  y: 6,
  z: 5,
});

export const VIBODE_THUMBNAIL_FRAME_SELECTOR = "[data-vibode-thumbnail-frame]";

export const VIBODE_THUMBNAIL_FRAME_ATTRIBUTE = "data-vibode-thumbnail-frame";
