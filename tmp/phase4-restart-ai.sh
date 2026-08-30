#!/bin/bash
set -euo pipefail
cd /home/casher/app
OLD=$(systemctl show messaging-ai-worker.service -p MainPID --value)
echo "old_pid=$OLD"
if [ -n "$OLD" ] && [ "$OLD" != "0" ]; then
  kill -TERM "$OLD" || true
fi
sleep 4
systemctl show messaging-ai-worker.service -p ActiveEnterTimestamp,MainPID,NRestarts,ActiveState --no-pager
pgrep -af 'messaging-ai-worker|messaging:ai-worker' | head -8 || true
test -f src/modules/messaging/ai/planner/executeConfirmedBookingPlan.ts && echo "executor=present"
grep -n "executeConfirmedBookingPlan" src/modules/messaging/ai/planner/processBookingPlannerTurn.ts | head -3
grep GEMINI_MODEL .env.local | head -1
grep WHATSAPP_API_BASE_URL .env.local | head -1
systemctl is-active casher.service messaging-ai-worker.service messaging-inbox-worker.service
systemctl --user is-active messaging-worker.service
git rev-parse HEAD
