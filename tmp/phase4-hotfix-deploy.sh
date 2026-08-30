#!/bin/bash
set -euo pipefail
cd /home/casher/app
git fetch origin main
git checkout -- .
git pull --ff-only origin main
echo "HEAD=$(git rev-parse HEAD)"
test -f src/lib/schedulePostResponse.ts
grep -n "outside a request scope" src/lib/schedulePostResponse.ts | head -2
grep -n "priorIdempotencyKey" src/modules/messaging/ai/planner/executeConfirmedBookingPlan.ts | head -2
OLD=$(systemctl show messaging-ai-worker.service -p MainPID --value)
echo "old_pid=$OLD"
if [ -n "$OLD" ] && [ "$OLD" != "0" ]; then
  kill -TERM "$OLD" || true
fi
sleep 5
systemctl show messaging-ai-worker.service -p ActiveEnterTimestamp,MainPID,ActiveState --no-pager
systemctl is-active messaging-ai-worker.service casher.service messaging-inbox-worker.service
systemctl --user is-active messaging-worker.service
