/**
 * Verbatim AFC image-edit instructions for the OpenAI path.
 *
 * Nano Banana Pro does not receive these strings. The Railway compositor builds
 * them from the same fragments in roomprintz-compositor `main.py`:
 * - EMPTY: build_stage1_prestage_prompt_v1(enhance_photo=True, empty_room_mode=True)
 *   enhance_photo is the compositor default because the UI omits the field.
 * - TILED: build_stage2_surfaces_prompt_v1 with flooringPreset tile_grid_scaffold
 *   and researchProfile afc-sr1-tile-grid-scaffold/v1. Stage 2 does not include
 *   the enhance fragment.
 *
 * No Gemini image-index or tool syntax is present, so the text is unchanged.
 */

const BASE_ROOMPRINTZ_INSTRUCTIONS = `
You are a professional real-estate photo editor for MLS listings.

General rules:
- Preserve the room's geometry, perspective, and camera angle.
- Keep windows, doors, walls, floors, ceilings, and built-in elements consistent.
- Do not add new furniture or decor unless explicitly asked.
- Do not remove structural elements (walls, windows, doors).
- Keep edits subtle, photorealistic, and suitable for real-estate marketing.
- Do not add any text, logos, or watermarks.
`.trim();

const ENHANCE_FRAGMENT = `
Step 1 — Enhance photo quality:
- Correct white balance so the scene looks neutral and natural.
- Optimize exposure: recover highlights, open up shadows, and maintain good contrast.
- Improve dynamic range for a bright, inviting interior without looking HDR or fake.
- Increase sharpness and clarity slightly so details are crisp but not oversharpened.
- Reduce noise or grain, especially in darker areas.
- Keep the overall style realistic and suitable for real-estate MLS listings.
`.trim();

const EMPTY_ROOM_FRAGMENT = `
Step 4 — Empty the room:
- Remove all movable furniture and decor items from the room.
- Remove sofas, chairs, tables, lamps, rugs, wall art, small decor, and personal items.
- Keep only the fixed architectural shell: walls, ceilings, floors, windows, doors, built-in cabinetry, and radiators.
- The result should be a completely empty but clean room shell, ready for virtual staging or inspection.
`.trim();

const FLOORING_TILE_GRID_SCAFFOLD_FRAGMENT = `
Research-only analytical flooring scaffold — modify flooring only:
- Replace only the visible floor surface with a clean, straight orthogonal grid installation of neutral medium-light to medium grey / greyscale tiles.
- Make grout lines clearly visible, evenly spaced, straight, and consistently darker than the tiles. Use dark charcoal or dark-neutral grout with strong contrast against the tiles across the entire visible floor. Do not use white, off-white, or low-contrast grout. Keep grout physically plausible, not cartoonishly thick.
- Prefer square tiles, but large rectangular tiles are acceptable when they produce a more stable, clean orthogonal grid in the room's natural perspective.
- Align the two principal grout-line families to the existing floor perspective. Do not use diagonal installation, herringbone, chevron, hexagonal layouts, mosaic, staggered decorative patterns, random stone, curved grout paths, veining, decorative print, or strong texture.
- Keep the tile surface matte or low-reflection with minimal patterning; the grout grid must remain the dominant floor signal. Do not use white or near-white tile.
- Preserve the exact camera viewpoint, framing, image composition, room dimensions, walls, openings, wall-floor intersections, thresholds, baseboards, corners, and all existing architecture.
- Do not move walls, add or remove openings, restage the room, or add any objects.
`.trim();

const OUTPUT_REQUIREMENTS = `
Output requirements:
- Return a single, high-quality edited image.
- The edit must look like a real photograph, not an illustration or painting.
- Do not alter the room's basic layout, window views, or camera angle.
`.trim();

export function afcEmptyRoomImagePrompt(): string {
  return [
    BASE_ROOMPRINTZ_INSTRUCTIONS,
    "You are given a single interior room photo. Edit this photo in-place according to the steps below.",
    ENHANCE_FRAGMENT,
    EMPTY_ROOM_FRAGMENT,
    OUTPUT_REQUIREMENTS,
  ].join("\n\n");
}

export function afcTiledScaffoldImagePrompt(): string {
  return [
    BASE_ROOMPRINTZ_INSTRUCTIONS,
    "You are given a single interior room photo. Edit this photo in-place for a surfaces/finishes pass.",
    FLOORING_TILE_GRID_SCAFFOLD_FRAGMENT,
    OUTPUT_REQUIREMENTS,
  ].join("\n\n");
}
