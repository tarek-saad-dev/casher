#!/bin/bash
set -euo pipefail
cd /home/casher/app
for i in $(seq 1 90); do
  if ! pgrep -f '/usr/local/sbin/deploy-casher|bash /usr/local/sbin/deploy-casher' >/dev/null 2>&1; then
    # also wait until HEAD matches expected if already deploying finished
    break
  fi
  echo "waiting_deploy $i"
  sleep 5
done
git fetch origin main
git pull --ff-only origin main || true
echo "HEAD=$(git rev-parse HEAD)"
test -d src/modules/messaging/ai/conversationIntelligence
grep -n "شعر و دقن" src/modules/messaging/ai/conversationIntelligence/arabicNormalize.ts | head -1 || true
grep -n "around" src/modules/messaging/ai/conversationIntelligence/timePreference.ts | head -2
OLD=$(systemctl show messaging-ai-worker.service -p MainPID --value || true)
echo "old_pid=$OLD"
if [ -n "${OLD:-}" ] && [ "$OLD" != "0" ]; then
  kill -TERM "$OLD" || true
fi
sleep 6
systemctl show messaging-ai-worker.service -p ActiveState,MainPID,ActiveEnterTimestamp --no-pager
systemctl is-active messaging-ai-worker.service casher.service messaging-inbox-worker.service
systemctl --user is-active messaging-worker.service
# quick local smoke of scorer on VPS
npx tsx -e "
import { scoreServiceMatch } from './src/modules/messaging/ai/conversationIntelligence/arabicNormalize.ts';
import { parseTimePreferenceText, filterSlotsByPreference } from './src/modules/messaging/ai/conversationIntelligence/timePreference.ts';
import { resolveCustomerDateText } from './src/modules/messaging/ai/conversationIntelligence/dateResolve.ts';
console.log(JSON.stringify({
  svc: scoreServiceMatch('شعر ودقن', 'شعر و دقن'),
  date: resolveCustomerDateText('انهرده').date,
  time: parseTimePreferenceText('10 بليل'),
  around: parseTimePreferenceText('حوالي 10 بليل'),
}));
"
