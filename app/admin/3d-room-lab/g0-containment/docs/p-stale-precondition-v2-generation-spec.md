# P-stale Precondition v2 Generation Spec (Deterministic)

## Identity and files

- asset identity: `P-stale-precondition-v2`
- canonical file: `app/admin/3d-room-lab/g0-containment/synthetic-assets/P-stale-precondition-v2.jpg`
- public mirror: `public/3d-lab/room-images/P-stale-precondition-v2.jpg`
- public URL: `/3d-lab/room-images/P-stale-precondition-v2.jpg`

## Source and projection geometry

- source image: `1280 x 720`
- floor rectangle: `4.0 m x 4.0 m`, centered on world origin, `Y = 0`
- vertical FOV: `60.0deg`
- eye: `(0, 3.0, 3.0)`
- lookAt: `(0, 0, 0)`
- up: `(0, 1, 0)`

Projection derivation is implemented by committed helper code in `p-stale-precondition-v2-spec.ts` through `projectFloorPointThroughPose(...)` with ordered floor corners from `getFloorRectCorners(...)`.

Declared source-space corners in solver order `NL, NR, FR, FL`:

- `NL: (199.09, 671.77)` source norm `(0.1555, 0.9330)`
- `NR: (1080.91, 671.77)` source norm `(0.8445, 0.9330)`
- `FR: (860.45, 204.12)` source norm `(0.6722, 0.2835)`
- `FL: (419.55, 204.12)` source norm `(0.3278, 0.2835)`

The generator and tests assert that helper-derived corners match these declared values within a small tolerance. These are not standalone magic numbers; they are centralized in `P_STALE_PRECONDITION_V2_DECLARED_CORNERS`.

## Deterministic rasterization requirements

Manual-only generator:

- command: `npm run generate:p-stale-precondition-v2`
- implementation: `synthetic-assets/generate-p-stale-precondition-v2.ts`
- never runs in tests, build, app startup, or calibration flows

Raster method:

- deterministic 2D pixel raster (no browser, no Three.js render path, no AI images)
- floor surface rendered by inverse homography over the projected `4m x 4m` plane
- includes projected `1 m` grid lines
- includes high-contrast floor boundary
- includes four `~28 source-pixel` checkerboard-X markers
- marker center intersections are exactly at declared `NL/NR/FR/FL` centers
- includes visible baked wording:
  `SYNTHETIC TEST PATTERN - NON-BENCHMARK - P-stale precondition v2`
- outputs baseline sRGB JPEG, normal orientation, no alpha channel

## Canonical truth and versioning rule

- The committed canonical JPEG is the source of truth.
- Its SHA-256 is pinned in `G0_SYNTHETIC_ASSETS`.
- Public mirror must remain byte-identical to canonical bytes.
- Regeneration is explicit only; changed output must mint a new artifact version (not overwrite v2 semantics).

