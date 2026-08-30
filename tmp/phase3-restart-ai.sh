#!/bin/bash
set -euo pipefail
cd /home/casher/app

echo "=== RESTART messaging-ai-worker only ==="
pids=$(pgrep -f 'messaging-ai-worker.ts' || true)
echo "TERM pids: ${pids:-none}"
if [ -n "${pids}" ]; then
  kill -TERM $pids || true
fi
sleep 8

systemctl is-active casher messaging-ai-worker messaging-inbox-worker
systemctl show messaging-ai-worker -p MainPID -p NRestarts -p ActiveEnterTimestamp --no-pager
pgrep -af 'messaging-ai-worker.ts$' || true
pgrep -af 'messaging-inbox-worker.ts$' || true

echo "=== SHA / ENV ==="
git rev-parse HEAD
git log -1 --oneline
grep -E '^(GEMINI_MODEL|WHATSAPP_API_BASE_URL|DB_SERVER|DB_PORT|DB_DATABASE|DB_NAME)=' .env.local | sed -E 's/(TOKEN|KEY|SECRET|PASSWORD)=.*/\1=***/' || true

echo "=== GATE6 tool boundary ==="
test -f src/modules/messaging/ai/planner/processBookingPlannerTurn.ts && echo planner_present
test -f src/modules/messaging/ai/tools/registry.ts && echo tools_registry_present
grep -n "createPublicBooking\|holdPublic\|cancelPublicBooking\|reschedulePublic" src/modules/messaging/ai/tools/*.ts src/modules/messaging/ai/planner/*.ts 2>/dev/null | head || echo "no_write_tool_refs_in_tools_or_planner"
grep -n "get_availability\|list_services\|list_employees" src/modules/messaging/ai/tools/types.ts | head
grep -n "AI_BUSINESS_TOOL_NAMES" -A20 src/modules/messaging/ai/tools/types.ts | head -25

echo "=== HTTP ==="
curl -fsS --max-time 8 http://127.0.0.1:3000/login >/dev/null && echo cashier_ok || echo cashier_fail
curl -fsS --max-time 5 http://127.0.0.1:3001/api/whatsapp/status 2>/dev/null | head -c 180; echo
