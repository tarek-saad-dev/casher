#!/bin/bash
set -euo pipefail
cd /home/casher/app

echo "=== RESTART MESSAGING WORKERS ==="
# systemd Restart=always — SIGTERM the main worker node processes
for pat in 'messaging-inbox-worker.ts' 'messaging-ai-worker.ts' 'messaging-outbox-worker.ts'; do
  pids=$(pgrep -f "$pat" || true)
  if [ -n "$pids" ]; then
    echo "TERM $pat -> $pids"
    kill -TERM $pids || true
  else
    echo "no pid for $pat"
  fi
done

sleep 8

echo "=== SERVICE STATE ==="
systemctl is-active casher messaging-inbox-worker messaging-ai-worker || true
systemctl --user is-active messaging-worker || true
systemctl show casher messaging-inbox-worker messaging-ai-worker -p Id -p ActiveState -p NRestarts -p MainPID -p ActiveEnterTimestamp --no-pager || true
systemctl --user show messaging-worker -p Id -p ActiveState -p NRestarts -p MainPID -p ActiveEnterTimestamp --no-pager || true

echo "=== PROCESS TREES ==="
pgrep -af 'messaging-inbox-worker.ts$' || true
pgrep -af 'messaging-ai-worker.ts$' || true
pgrep -af 'messaging-outbox-worker.ts$' || true

echo "=== ENV ==="
grep -E '^(GEMINI_MODEL|WHATSAPP_API_BASE_URL|DB_SERVER|DB_PORT|DB_DATABASE|DB_NAME)=' .env.local | sed -E 's/(TOKEN|KEY|SECRET|PASSWORD)=.*/\1=***/'

echo "=== HTTP ==="
curl -fsS --max-time 8 http://127.0.0.1:3000/login >/dev/null && echo cashier_ok || echo cashier_fail
curl -fsS --max-time 5 http://127.0.0.1:3001/api/whatsapp/status 2>/dev/null | head -c 200 || echo wa_status_fail

echo "=== SHA ==="
git rev-parse HEAD
test -f src/modules/messaging/ai/tools/registry.ts && echo tools_registry_present
grep -n "MAX_AI_TOOL_CALLS_PER_TURN\|list_branches\|get_availability\|createPublicBooking\|createBookingHold" src/modules/messaging/ai/tools/*.ts | head -n 40
