#!/bin/bash
set -euo pipefail
cd /home/casher/app
npx tsx <<'TS'
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
import { isConversationOrchestratorV3Enabled } from './src/modules/messaging/ai/conversationOrchestrator/featureFlag.ts';
import { buildTurnFrame } from './src/modules/messaging/ai/conversationOrchestrator/turnFrame.ts';
const enabled = isConversationOrchestratorV3Enabled();
const t = buildTurnFrame({ text: 'فرع جليم مين متاح حاليا؟' });
console.log(JSON.stringify({ enabled, intent: t.primaryIntent, temporal: t.temporal, mutate: t.mutatesBookingPlan, env: process.env.CONVERSATION_ORCHESTRATOR_V3 }));
if (!enabled) process.exit(3);
console.log('ORCHESTRATOR_V3_LIVE_OK');
TS
