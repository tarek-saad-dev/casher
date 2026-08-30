#!/bin/bash
set -euo pipefail
cd /home/casher/app
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
systemctl is-active messaging-ai-worker.service casher.service
systemctl show messaging-ai-worker.service -p MainPID,ActiveState --no-pager
git rev-parse HEAD
npx tsx <<'TS'
import { buildTurnFrame } from './src/modules/messaging/ai/conversationOrchestrator/turnFrame.ts';
import { isConversationOrchestratorV3Enabled } from './src/modules/messaging/ai/conversationOrchestrator/featureFlag.ts';
const t = buildTurnFrame({ text: 'فرع جليم مين متاح حاليا؟' });
const enabled = isConversationOrchestratorV3Enabled();
console.log(JSON.stringify({ enabled, intent: t.primaryIntent, temporal: t.temporal, mutate: t.mutatesBookingPlan }));
if (!enabled) process.exit(3);
if (t.primaryIntent !== 'AVAILABILITY_QUERY' || t.temporal !== 'now' || t.mutatesBookingPlan) process.exit(2);
console.log('ORCHESTRATOR_V3_LIVE_OK');
TS
