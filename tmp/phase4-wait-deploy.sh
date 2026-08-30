#!/bin/bash
set -euo pipefail
cd /home/casher/app
for i in $(seq 1 60); do
  if ! pgrep -f '/usr/local/sbin/deploy-casher|deploy/deploy-casher' >/dev/null; then
    break
  fi
  echo "waiting_deploy $i"
  sleep 5
done
echo "deploy_done HEAD=$(git rev-parse HEAD)"
grep -n priorIdempotencyKey src/modules/messaging/ai/planner/executeConfirmedBookingPlan.ts | head -1
grep -n 'outside a request scope' src/lib/schedulePostResponse.ts | head -1
OLD=$(systemctl show messaging-ai-worker.service -p MainPID --value || true)
echo "old_pid=$OLD"
if [ -n "${OLD:-}" ] && [ "$OLD" != "0" ]; then
  kill -TERM "$OLD" || true
fi
sleep 6
systemctl show messaging-ai-worker.service -p ActiveState,MainPID,ActiveEnterTimestamp,NRestarts --no-pager
systemctl is-active messaging-ai-worker.service casher.service messaging-inbox-worker.service
systemctl --user is-active messaging-worker.service
pgrep -af 'messaging:ai-worker' | head -3
