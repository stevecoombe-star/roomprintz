#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Deterministic UI client environment ownership: repository .env first, then
# .env.local overrides. Server-side AFC gates are never read from these files;
# the compositor readiness endpoint is the authority for process gate state.
if [[ -f ".env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source ".env"
  set +a
fi

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source ".env.local"
  set +a
fi

if [[ "${AFC_SR1_CERTIFIED_PERMISSION_MODE:-}" != "filesystem-localhost-confirmed/v1" ]]; then
  echo "Set AFC_SR1_CERTIFIED_PERMISSION_MODE=filesystem-localhost-confirmed/v1 only in an invocation with confirmed filesystem and localhost access." >&2
  exit 2
fi

exec node \
  --conditions=react-server \
  --import tsx \
  app/admin/3d-room-lab/research/afc-sr1-certified-control-runner-cli.ts \
  "$@"
