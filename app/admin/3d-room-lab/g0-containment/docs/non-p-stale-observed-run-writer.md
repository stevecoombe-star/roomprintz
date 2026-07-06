# Non-P-stale Observed-Run Writer (R2 first slice)

This command executes deterministic first-slice probe chains and writes one immutable `G0ObservedRunRecord`.

## Supported probes in this phase

- `P-legacy`
- `P-coordinate-space-drift`

All other probes, including `P-stale`, are rejected with `no_execution_adapter_yet:<probe>`.

## Command

Dry run (default, no write):

```bash
npm run write:g0-observed-run -- --probe P-legacy --input /absolute/path/to/run.json
```

Write mode:

```bash
npm run write:g0-observed-run -- --probe P-coordinate-space-drift --input /absolute/path/to/run.json --write
```

Optional root override (default root: `app/admin/3d-room-lab`):

```bash
npm run write:g0-observed-run -- --probe P-legacy --input /absolute/path/to/run.json --root-dir /absolute/path/to/root --write
```

## Minimal input JSON template

```json
{
  "createdAt": "2026-07-06T18:00:00.000Z",
  "executionNonce": "first-slice-run-1",
  "supersedesRunId": null,
  "rerunReason": "evaluation_changed"
}
```

Do **not** supply emitted result, supporting checks, artifact references, basis fingerprint, pipeline stage, no-authority checks, or incident fields. The command derives them from committed declarations and deterministic execution.

## Behavior summary

- `execution_mode=deterministic_execution_observed` is always printed for supported probes.
- Payload probes record:
  - `payload_identity:<identity>`
  - `payload_digest:<digest>`
- Payload probes explicitly log that no image basis was fetched/evaluated; `runIdentity.basisFingerprint` carries canonical payload digest.
- Dry run validates and prints intended immutable path only.
- `--write` uses exclusive create (`wx`), then re-reads and validates.
