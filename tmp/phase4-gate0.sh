#!/bin/bash
set -euo pipefail
cd /home/casher/app

echo "=== GATE0 BEFORE ==="
npx tsx tmp-phase3-smoke-trace.ts 2>/dev/null | tee /tmp/gate0-before.json | head -c 2000
echo

echo "=== RESTART AI WORKER ==="
pids=$(pgrep -f 'messaging-ai-worker.ts' || true)
echo "TERM: ${pids:-none}"
if [ -n "${pids}" ]; then kill -TERM $pids || true; fi
sleep 8
systemctl is-active messaging-ai-worker
pgrep -af 'messaging-ai-worker.ts$' || true
echo "worker_count=$(pgrep -cf 'messaging-ai-worker.ts$' || echo 0)"

echo "=== GATE0 AFTER ==="
npx tsx tmp-phase3-smoke-trace.ts 2>/dev/null | tee /tmp/gate0-after.json | head -c 2500
echo
