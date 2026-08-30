#!/bin/bash
set -euo pipefail
WANT=f037e7c6dfd8599e8ccf6cf531ad56849e19711e
cd /home/casher/app
for i in $(seq 1 60); do
  if pgrep -f '/usr/local/sbin/deploy-casher|bash /usr/local/sbin/deploy-casher' >/dev/null 2>&1; then
    echo "deploy_running $i"
    sleep 5
    continue
  fi
  HEAD=$(git rev-parse HEAD)
  echo "check $i HEAD=$HEAD"
  case "$HEAD" in
    $WANT|f037e7c*) break ;;
  esac
  git fetch origin main >/dev/null 2>&1 || true
  sleep 5
done
HEAD=$(git rev-parse HEAD)
echo "FINAL_HEAD=$HEAD"
test -f src/modules/messaging/ai/conversationIntelligence/turnIntent.ts
grep -n 'BOOKING_ALTERNATIVE_QUERY\|alternative_employee_query\|detectTurnIntent' src/modules/messaging/ai/planner/processBookingPlannerTurn.ts | head -10
grep -E '^CONVERSATION_INTELLIGENCE_V2=' .env.local || echo CI_V2_FLAG=default_on
OLD=$(systemctl show messaging-ai-worker.service -p MainPID --value || true)
echo "old_ai_pid=$OLD"
if [ -n "${OLD:-}" ] && [ "$OLD" != "0" ]; then
  kill -TERM "$OLD" || true
fi
sleep 6
systemctl show messaging-ai-worker.service -p ActiveState,MainPID,ActiveEnterTimestamp --no-pager
systemctl is-active messaging-ai-worker.service casher.service messaging-inbox-worker.service
systemctl --user is-active messaging-worker.service
npx tsx -e "import { detectTurnIntent } from './src/modules/messaging/ai/conversationIntelligence/turnIntent.ts'; const r = detectTurnIntent('مين متاح تاني في الوقت ده؟'); console.log(JSON.stringify(r)); if (r.intent !== 'BOOKING_ALTERNATIVE_QUERY') process.exit(2);"
echo ARBITRATION_DEPLOY_OK
