#!/bin/bash
set -euo pipefail
WANT_PREFIX=e34cdc0
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
    $WANT_PREFIX*) break ;;
  esac
  git fetch origin main >/dev/null 2>&1 || true
  sleep 5
done
HEAD=$(git rev-parse HEAD)
echo "FINAL_HEAD=$HEAD"
test -d src/modules/messaging/ai/conversationOrchestrator
test -f src/modules/messaging/ai/conversationOrchestrator/orchestrateTurn.ts
if grep -q "^CONVERSATION_ORCHESTRATOR_V3=" .env.local; then
  sed -i "s/^CONVERSATION_ORCHESTRATOR_V3=.*/CONVERSATION_ORCHESTRATOR_V3=true/" .env.local
else
  echo "CONVERSATION_ORCHESTRATOR_V3=true" >> .env.local
fi
grep -E "^CONVERSATION_ORCHESTRATOR_V3=" .env.local
OLD=$(systemctl show messaging-ai-worker.service -p MainPID --value || true)
echo "old_ai_pid=$OLD"
if [ -n "${OLD:-}" ] && [ "$OLD" != "0" ]; then
  kill -TERM "$OLD" || true
fi
sleep 6
systemctl show messaging-ai-worker.service -p ActiveState,MainPID,ActiveEnterTimestamp --no-pager
systemctl is-active messaging-ai-worker.service casher.service messaging-inbox-worker.service
systemctl --user is-active messaging-worker.service
npx tsx -e "import { buildTurnFrame } from './src/modules/messaging/ai/conversationOrchestrator/turnFrame.ts'; import { isConversationOrchestratorV3Enabled } from './src/modules/messaging/ai/conversationOrchestrator/featureFlag.ts'; const t = buildTurnFrame({ text: 'فرع جليم مين متاح حاليا؟' }); console.log(JSON.stringify({ enabled: isConversationOrchestratorV3Enabled(), intent: t.primaryIntent, temporal: t.temporal, mutate: t.mutatesBookingPlan })); if (!isConversationOrchestratorV3Enabled()) process.exit(3); if (t.primaryIntent !== 'AVAILABILITY_QUERY' || t.temporal !== 'now' || t.mutatesBookingPlan) process.exit(2);"
echo ORCHESTRATOR_V3_DEPLOY_OK
