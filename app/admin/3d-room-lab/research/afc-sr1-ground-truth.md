# AFC-SR1 GT0 ground-truth fixture protocol

The `afc-sr1-ground-truth/v1` fixtures are non-authoritative research records.
They neither apply Floor nor camera state, and must not be used as a proposal,
search, or persistence input.

## Evidence classes

- **Empirical calibration truth** is receipt-linked Empty geometry, the explicitly
  accepted Floor and dimensions/FOV, current camera diagnostic values, a
  successful existing calibrated-camera Apply, and the operator's visual
  acceptance record. CP2B execution is tracked separately as an AFC authority
  path, not as empirical calibration completeness.
- **Repository regression truth** is a control fixture, test-local geometry,
  ratio/FOV harness output, or a synthetic camera snapshot. It remains useful
  for deterministic regression, but is never receipt-linked by implication.
- **Physical measurement truth** may only be recorded when independently
  surveyed. Accepted calibration dimensions are not physical measurements.

`provenance` identifies the source for each fixture section. When a section
combines evidence, its notes name the narrower sources.

## Source geometry convention

All polygon and seam coordinates use `source-normalized/v1`, and polygons are
ordered `NL, NR, FR, FL`. Off-frame coordinates are valid source coordinates
within the established inclusive Floor authority extent `[-0.25, 1.25]`; GT0
rejects values outside that extent and never clamps them.
`rawFloor` independently records its source basis and whether its polygon was
explicitly projected to the fixture's Original image basis; matching normalized
values alone are not evidence of that projection. Same-basis placement records
also carry a canonical SHA-256 polygon fingerprint; GT0 recomputes and enforces
that fingerprint during parsing.

For a right-side refinement:

```text
seamStart = raw NR
seamEnd   = raw FR
adjustedCorner(t) = seamStart + t * (seamEnd - seamStart)
```

For a left-side refinement, substitute `raw NL` and `raw FL`. In both cases
`t=0` is the raw near corner and `t=1` is the far corner. GT0 records the
unclamped finite-segment projection: a point outside the segment has `t < 0`
or `t > 1`, rather than being silently changed.

The pure helper's source-normalized perpendicular error treats x and y
isotropically in that mathematical space. It is not a uniform pixel distance
on non-square images and is suitable only for research comparison. Certified
seam evidence should use a same-basis intrinsic-pixel measurement once the
Original basis is available.

## Canonical and uncertified seam evidence

`seamRefinement` is canonical only when `rawToOriginalPlacement` contains a
documented `same_basis` transfer and cross-validates the raw source and
Original basis fingerprints. A `projectedToImageBasis` boolean alone is never
enough. Without that record, canonical side, corner, coordinates, `seamT`,
collinearity, and source-normalized error fields must all remain unknown/null.
For a canonical one-corner refinement, every non-adjusted semantic corner must
remain byte-for-byte equal to the raw source point, and the seam endpoints must
equal the corresponding raw near and far corners.

`uncertifiedReceiptSeamEvidence` separately records an Empty-to-Original
cross-basis calculation. It is discriminated as
`cross_basis_unprojected`, hard-codes `usableAsGroundTruth: false`, names the
Empty and Original bases for every coordinate role, and uses
`unprojectedReceiptSeamT` plus research-only error/tolerance names.

`widthDepthRatio = worldWidthMeters / worldDepthMeters` and
`depthWidthAspect = worldDepthMeters / worldWidthMeters`. These names are
deliberately both present; GT0 never uses an unqualified `ratio` or
`aspectRatio`.

## Current Room C certification

Room C includes a replayed single-candidate Empty receipt and its
source-normalized raw polygon. The receipt's Empty image is
`aspect_compatible_rescaled` against the recorded Original image (relative
aspect error `0.0052`). The historical receipt-to-control arithmetic remains in
the explicitly uncertified cross-basis block. It does not establish canonical
seam truth.

The prior `4.8 × 4.0` dimensions are repository test-snapshot calibration
values, not surveyed dimensions. They remain regression history only.

The completed Room C capture supersedes those calibration-control values for
the GT0 fixture: it records the CP2A-applied Empty Floor on the Original basis,
the manually refined Floor, `4.6 × 4.0` at `79°`, and the successful ordinary
calibrated-camera Apply. The manual Floor change invalidated the ephemeral AFC
Floor-camera binding, so that ordinary Apply is explicitly not an AFC-bound
CP2B Apply. The refined SR1 advisory handoff has not yet been exercised, so
`afcAuthorityPathStatus` is `not_yet_exercisable`; this does not reduce the
fixture's empirical `certified` status.

The certified canonical Room C values are:

```text
NR = (0.5866547177769379, 0.6762406630659392)
seamT = 0.7063703325987577
width/depth = 4.6 m / 4.0 m (widthDepthRatio 1.15)
vertical FOV = 79°
CV/display average = 1.62 px
CV/display maximum = 3.28 px
```

The scale ratio `1.0119014164972706` is deterministically derived at frame
`1118 × 698` from the Original `7360 × 4912` basis using the same centered
object-cover conversion and homography camera evaluation used by the ratio/FOV
harness. GT0 parser validation recomputes this scale ratio and CV residuals;
empirical certification requires both CV and rendered diagnostics. Rooms A and
B remain `partial` because their control fixtures have no raw-to-final seam
history.
