# P-stale Observed-Run Writer (Operator Command)

This command writes one P-stale `G0ObservedRunRecord` through the immutable writer contract. It validates schema and contract shape only; it does **not** observe the browser itself and does **not** verify evidence truthfulness.

## Active v2 Binding (fixed)

- Active URL: `http://localhost:3000/3d-lab/room-images/P-stale-precondition-v2.jpg`
- Active SHA-256: `2e8b55c2fb8f8b68ba28f6b01ecf327be32270a51cfde4fa2cfcfbbc29eabd67`
- `preconditionArtifact.url` must exactly equal the active URL.
- `preconditionArtifact.sha256` and `runIdentity.basisFingerprint` must exactly equal the active SHA.

## Commands

Dry run (default, no write):

```bash
npm run write:p-stale-observed-run -- --input /absolute/path/to/p-stale-run.json
```

Explicit immutable write:

```bash
npm run write:p-stale-observed-run -- --input /absolute/path/to/p-stale-run.json --write
```

Optional output root override (default root: `app/admin/3d-room-lab`):

```bash
npm run write:p-stale-observed-run -- --input /absolute/path/to/p-stale-run.json --root-dir /absolute/path/to/root --write
```

## Input JSON Template

```json
{
  "createdAt": "2026-07-05T21:00:00.000Z",
  "runIdentity": {
    "fixtureVersion": "g0/P-stale/v1",
    "basisFingerprint": "2e8b55c2fb8f8b68ba28f6b01ecf327be32270a51cfde4fa2cfcfbbc29eabd67",
    "coordinateSpaceVersion": {
      "decoderId": "sharp-metadata/v1",
      "normalizationPolicyVersion": "orientation-normal/v1",
      "orientationApplied": false
    },
    "solverGeneratorVersion": "g0-harness/v1",
    "evaluationVersion": "g0-eval/v1",
    "evidenceBundleVersion": "g0-bundle/v1"
  },
  "executionNonce": "p-stale-live-observation-1",
  "supersedesRunId": null,
  "rerunReason": "evaluation_changed",
  "baselineFrame": {
    "width": 1118,
    "height": 698,
    "rawObservationReference": "artifact://p-stale/baseline-frame"
  },
  "postTriggerFrame": {
    "width": 960,
    "height": 600,
    "rawObservationReference": "artifact://p-stale/post-trigger-frame"
  },
  "preconditionArtifact": {
    "url": "http://localhost:3000/3d-lab/room-images/P-stale-precondition-v2.jpg",
    "sha256": "2e8b55c2fb8f8b68ba28f6b01ecf327be32270a51cfde4fa2cfcfbbc29eabd67"
  },
  "manualObservationLog": "Observed active authority receipt drop after controlled frame-size transition.",
  "observedClassification": {
    "outcome": "pass",
    "expectedVsObservedComparison": "matches_expected"
  }
}
```

## Truthfulness and Stop Conditions

- Raw baseline and post-trigger evidence references are required.
- A containment pass requires baseline/post-trigger dimensions to differ.
- If dimensions are identical, pass is rejected and the truthful option is inconclusive.
- Do not retry, perform another resize, or re-apply calibration in the same run.
- Any inconclusive or failure result is a hard stop for this run.
- This command does not execute P-stale and does not observe browser state.

## Output Path Convention

`<root-dir>/g0-containment/receipts/b3h-b2i-g0-v1/P-stale/<run-id-hex>.json`

- Dry run prints only the intended path.
- `--write` uses exclusive create and fails if target path already exists.
- After write, the command re-reads and validates the written record.

## Record Semantics Reminder

- A P-stale record is not a G0-wide pass.
- A P-stale record is not a calibration-quality result.
- No receipt or incident is created by this command.
- Never hand-edit a generated record.
- Generated records are not ignored by repository rules; operator explicitly decides whether to stage.
