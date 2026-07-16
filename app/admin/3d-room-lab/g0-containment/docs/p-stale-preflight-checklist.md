# P-stale Preflight And Later Live-Smoke Boundary (Lab Only)

This checklist is a **B2I preflight artifact only**. It does not execute P-stale and does not create a formal G0 run record in-repo.

## Precondition Artifact (active v2)

- Active URL (only URL to use for future B2P-E retry): `http://localhost:3000/3d-lab/room-images/P-stale-precondition-v2.jpg`
- Minimum renderer width: `640 px`
- Default floor mapping: `4 m x 4 m`
- Marker-center placement map (single honest placement attempt only):
  - `NL -> bottom-left marker`
  - `NR -> bottom-right marker`
  - `FR -> upper-right marker`
  - `FL -> upper-left marker`
- Artifact identity and digest are captured for `P-stale-precondition-v2.jpg` (v1 is lineage-only and retired from active preflight).

## Expected Normal Desktop-Frame Readout Envelope

- Recommended FOV: `59deg-61deg`
- High-confidence range: strictly interior (not pinned to FOV bounds)
- `cvAvg`: approximately `<= 2.2 px`
- `cvMax`: approximately `<= 3.1 px`
- Display/CV delta: approximately `0`
- Scale ratio: safely inside current bounds
- Apply status: available
- `firstFailingGate: none`

## Hard Stops (fail preflight)

- FOV pinned at or within `5deg` of `20deg` or `90deg`
- Recommended FOV outside `59deg-61deg`
- Scale ratio outside `0.99-1.02`
- Any apply-funnel gate failure after one honest marker-center placement

No corner refinement is allowed after the one marker-center placement attempt. A failure is artifact/preflight evidence and never an invitation to sculpt the quadrilateral.

## Live Smoke Observation Window (B2E boundary)

- Window begins immediately before the controlled frame change.
- Window ends only after all of the following are captured:
  - snapshot-cleared proof;
  - authority-drop proof;
  - fresh projection / re-solve / requalification requirement.

## Later B2E Smoke Checklist (do not execute in B2I)

1. Capture active snapshot proof.
2. Record exact pre-change frame dimensions.
3. Apply controlled frame change.
4. Capture cleared-snapshot / authority-drop proof.
5. Record exact post-change frame dimensions.
6. Capture fresh-projection / re-solve / requalification requirement.
7. Populate `G0ObservedRunRecord` manual log, raw evidence references, derived containment conclusion, and no-authority checks.
