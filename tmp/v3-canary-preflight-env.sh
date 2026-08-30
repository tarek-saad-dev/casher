#!/bin/bash
set -euo pipefail
cd /home/casher/app
echo "=== SHA ==="
git rev-parse HEAD
git log -1 --oneline
echo "=== V3 FLAG ==="
grep -E '^CONVERSATION_ORCHESTRATOR_V3=' .env.local || echo 'FLAG_MISSING'
echo "=== AI WORKER ==="
systemctl show messaging-ai-worker.service -p ActiveState,MainPID,ActiveEnterTimestamp,FragmentPath --no-pager
PID=$(systemctl show messaging-ai-worker.service -p MainPID --value)
echo "MainPID=$PID"
# worker loads dotenv from .env.local — confirm module present on disk
test -f src/modules/messaging/ai/conversationOrchestrator/orchestrateTurn.ts && echo ORCH_MODULE=present
test -f src/modules/messaging/ai/conversationOrchestrator/turnFrame.ts && echo TURNFRAME=present
# smoke with dotenv
npx tsx <<'TS'
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
import { isConversationOrchestratorV3Enabled } from './src/modules/messaging/ai/conversationOrchestrator/featureFlag.ts';
import { buildTurnFrame } from './src/modules/messaging/ai/conversationOrchestrator/turnFrame.ts';
const enabled = isConversationOrchestratorV3Enabled();
const t = buildTurnFrame({ text: 'فرع جليم مين متاح حاليا؟' });
console.log(JSON.stringify({
  enabled,
  env: process.env.CONVERSATION_ORCHESTRATOR_V3,
  intent: t.primaryIntent,
  scope: t.scope,
  temporal: t.temporal,
  branchHint: t.entities.branchHint,
  mutatesBookingPlan: t.mutatesBookingPlan,
}, null, 2));
if (!enabled) process.exit(3);
if (t.primaryIntent !== 'AVAILABILITY_QUERY' || t.temporal !== 'now' || t.mutatesBookingPlan) process.exit(4);
console.log('PREFLIGHT_TURNFRAME_OK');
TS
