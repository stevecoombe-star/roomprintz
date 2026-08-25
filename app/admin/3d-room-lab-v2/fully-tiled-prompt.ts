export const AFC_V2_FULLY_TILED_PROMPT_VERSION =
  "afc-v2-fully-tiled-generation/v1" as const;

export const AFC_V2_FULLY_TILED_PROMPT = `You are a professional real-estate photo editor for MLS listings.

General rules:

- Preserve the room's geometry, perspective, and camera angle exactly.
- Keep the room's major architectural structure consistent.
- Keep edits photorealistic and suitable for real-estate photography.
- Do not add any text, logos, labels, markers, or watermarks.
- Do not add furniture, decor, or new objects unless explicitly asked.

## Research-only analytical room-envelope scaffold

Edit the room image into a simplified analytical architectural scaffold.

Replace the visible finish of the room's **floor, walls, and ceiling** with a clean orthogonal installation of neutral medium-light to medium grey / greyscale square tiles.

The purpose of this edit is to create a physically plausible perspective grid on the room's major architectural planes while simplifying away small attached elements that interfere with plane analysis.

## Core objective

Create a clean tiled version of the room in which the **main floor plane, main wall planes, and main ceiling plane** are the dominant visible surfaces.

The result should read as the same real room, from the same viewpoint, but simplified so that only the major envelope planes remain visually emphasized.

## What to tile

Tile the primary exposed planar fields of:

- the floor
- the walls
- the ceiling

Treat each of these as a real physical planar surface.

## What to REMOVE completely

Completely remove the following elements from the image and replace them with clean uninterrupted continuation of the surrounding architectural plane as if those attached elements were not present:

- floorboards
- baseboards
- shoe moulding
- perimeter floor trim
- crown moulding
- ceiling moulding
- wall trim that is not essential to preserving the major opening geometry
- outlet covers
- electrical outlets
- receptacles
- switches
- switch plates
- wall plates
- vents
- grilles
- air returns
- radiators
- heaters
- baseboard heaters
- shelves
- small wall-mounted fixtures
- small attached accessories
- utility covers
- access panels
- similar attached non-structural elements

Remove these elements cleanly and plausibly so the floor, wall, or ceiling surface continues smoothly through their former location.

## What to preserve

Preserve the major architectural structure of the room, including:

- room shape
- wall positions
- floor shape
- ceiling shape
- wall-wall corners
- floor-wall boundaries
- wall-ceiling boundaries
- windows
- window openings
- doors
- door openings
- major passage openings
- major built-in architectural boundaries
- framing and crop
- camera viewpoint
- camera height
- camera orientation
- window views

Preserve these structural features in the same positions and proportions as the source image.

## Important simplification rule

This is not a decorative redesign. This is a **cleaned architectural analysis rendering** of the same room.

Small attached architectural clutter should be removed if it interferes with reading the room as a set of clean planar envelope surfaces.

The goal is to simplify the room so the visible geometry of the major planes is easier to interpret.

## Tile/grid requirements

- Use clean square tiles as the strong preference.
- Use approximately the **same nominal real-world tile size across the floor, walls, and ceiling**, so the room appears to be covered by one consistent square tile module.
- Grout lines must be clearly visible, straight, evenly spaced on each physical surface, and consistently darker than the tiles.
- Keep grout widths physically plausible and relatively narrow.
- Keep tile surfaces matte or low-reflection with minimal variation, texture, veining, or decorative pattern.
- Use neutral medium-light to medium grey / greyscale tiles.
- Do not use white or near-white tile.
- The orthogonal grout grid must remain the dominant visual signal.

## Perspective requirements

For every visible tiled plane:

- Lay the tile grid flat against that actual surface.
- Align the two principal grout-line families with that surface's natural architectural directions and perspective.
- Let grout-line spacing and apparent tile shape change naturally with depth and foreshortening.
- Lines that are parallel in the physical room should converge naturally according to the existing camera perspective.
- Do not force grout lines to remain parallel in image space.
- Do not flatten, front-project, stretch, or screen-align the tile pattern.
- Do not use diagonal installation, herringbone, chevron, hexagonal layouts, mosaics, staggered decorative layouts, random stone, curved grout paths, veining, or decorative print.

At transitions between perpendicular surfaces — such as floor-to-wall, wall-to-wall, and wall-to-ceiling boundaries — the tile grids must meet at the existing physical architectural boundary without moving or redefining that boundary.

The tile grids on adjoining surfaces do not need to form one continuous 2D image pattern. Each grid should behave as though physically installed on its own real 3D surface.

## Boundary behavior around preserved openings

Windows and doors must remain present and correctly positioned.

Tile must stop cleanly at:

- window openings
- door openings
- major passage openings
- major structural boundaries

Do not tile across windows or doors.

If trim around windows or doors is visually non-essential and prevents a cleaner plane reading, it may be minimized or removed, but the opening geometry itself must remain unchanged.

## Do NOT do the following

Do not:

- move or straighten walls
- change wall angles
- change room proportions
- change ceiling height or shape
- change floor geometry
- add, remove, widen, narrow, or relocate windows or doors
- invent hidden surfaces
- extend surfaces beyond their true boundaries
- restage the room
- add furniture or decor
- add decorative textures or patterns
- turn the image into an illustration or painting

## Output requirements

- Return a single high-quality edited image.
- The result must look like a real photograph of the same room.
- The room must appear simplified into clean tiled floor, wall, and ceiling planes.
- Completely remove floorboards, trim, mouldings, outlets, switches, vents, radiators, shelves, and similar attached elements.
- Preserve the original room geometry, perspective, framing, openings, and camera angle.
- The result is an analytical perspective scaffold for room-envelope interpretation, not a decorative interior redesign.`;
