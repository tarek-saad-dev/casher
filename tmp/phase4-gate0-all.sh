#!/bin/bash
set -euo pipefail
cd /home/casher/app

echo "=== RESTART ==="
pids=$(pgrep -f 'messaging-ai-worker.ts' || true)
echo "TERM: ${pids:-none}"
if [ -n "${pids}" ]; then
  kill -TERM $pids || true
fi
sleep 8
systemctl is-active messaging-ai-worker
pgrep -af 'messaging-ai-worker.ts$' || true
echo "count=$(pgrep -c -f 'messaging-ai-worker.ts$' || echo 0)"

echo "=== PLAN STATE ==="
npx tsx tmp-phase3-smoke-trace.ts > /tmp/gate0-trace.json 2>/tmp/gate0-trace.err || true
node - <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync('/tmp/gate0-trace.json', 'utf8');
const i = raw.indexOf('{');
const j = raw.lastIndexOf('}');
const o = JSON.parse(raw.slice(i, j + 1));
const a = o.activePlan;
console.log(JSON.stringify({
  conversationId: o.conversationId,
  planId: a && a.planId,
  stage: a && a.stage,
  version: a && a.version,
  selected: a && a.selected,
  serviceIds: a && a.serviceIds,
  empId: a && a.empId,
  date: a && a.date,
  candidates: a && a.candidates,
  planRows: (o.allPlans || []).length,
  mutations: o.mutations,
}, null, 2));
NODE
