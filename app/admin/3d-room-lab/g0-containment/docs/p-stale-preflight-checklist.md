# P-stale Preflight And Later Live-Smoke Boundary (Lab Only)

This checklist is a **B2I preflight artifact only**. It does not execute P-stale and does not create a formal G0 run record in-repo.

## Preflight Gate (must be captured later, outside B2I execution)

- Qualified-basis status is captured (exact status string).
- Calibrated apply availability is captured with `firstFailingGate: none`.
- Active snapshot presence is captured.
- Exact active frame size is captured.
- Artifact identity and digest are captured for `P-stale-precondition.jpg`.
- Explicit preflight pass/fail decision is recorded.

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
