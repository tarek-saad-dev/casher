#!/usr/bin/env bash
# Resume a financial rehearsal using the already-restored isolated database.
# Never creates or alters schema and never reconnects to production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPECTED_ROOT="/home/casher/payroll-rehearsal"
if [[ "$ROOT" != "$EXPECTED_ROOT" ]]; then
  echo "STOP: run ONLY in the existing QA worktree $EXPECTED_ROOT" >&2
  exit 1
fi
if [[ "${PAYROLL_E2E_ALLOW_WRITE:-}" != "isolated-clone" ]]; then
  echo "STOP: PAYROLL_E2E_ALLOW_WRITE=isolated-clone required" >&2
  exit 1
fi
if [[ ! -f "$ROOT/tsconfig.json" || ! -f "$ROOT/scripts/payroll/qa-ziad-retroactive-clone.ts" ]]; then
  echo "STOP: incomplete rehearsal checkout" >&2
  exit 1
fi
if [[ ! -x "$ROOT/node_modules/.bin/tsx" ]]; then
  echo "STOP: tsx dependencies unavailable in QA checkout" >&2
  exit 1
fi

# The TypeScript entrypoint itself also forces local 127.0.0.1:1433 and checks
# DB_NAME() = last132_payroll_rehearsal BEFORE doing any financial write.
cd "$ROOT"
echo "=== Resume on existing isolated last132_payroll_rehearsal clone ==="
PAYROLL_E2E_ENV_DIR=/home/casher/app \
NODE_OPTIONS="--conditions=react-server" \
"$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/tsconfig.json" scripts/payroll/qa-ziad-retroactive-clone.ts
echo "=== ISOLATED REHEARSAL PASSED ==="
