#!/usr/bin/env npx tsx
/** Gate 6 write-boundary static proof on VPS */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const exec = fs.readFileSync(
  path.join(root, 'src/modules/messaging/ai/planner/executeConfirmedBookingPlan.ts'),
  'utf8',
);
const proc = fs.readFileSync(
  path.join(root, 'src/modules/messaging/ai/planner/processBookingPlannerTurn.ts'),
  'utf8',
);
const toolsDir = path.join(root, 'src/modules/messaging/ai/tools');
const toolFiles = fs.existsSync(toolsDir)
  ? fs.readdirSync(toolsDir).filter((f) => f.endsWith('.ts'))
  : [];
const toolContents = toolFiles.map((f) => ({
  f,
  text: fs.readFileSync(path.join(toolsDir, f), 'utf8'),
}));

const out = {
  gate: 'write-boundary',
  sha: process.env.GIT_SHA || null,
  executorImportsCreatePublicBooking: /from ['"]@\/lib\/booking\/publicBookingCreate['"]/.test(exec),
  executorUsesEvaluateSelection: /evaluatePublicBookingSelection/.test(exec),
  executorSetsClientRequestId: /clientRequestId:\s*idempotencyKey/.test(exec),
  executorPurposeInternalPreview: /purpose:\s*'internal_preview'/.test(exec),
  executorSuppressNotification: /suppressNotification:\s*true/.test(exec),
  plannerTriggersOnAffirmative: /isAffirmative\(text\)/.test(proc) && /executeConfirmedBookingPlan/.test(proc),
  geminiToolsHaveCreateBooking: toolContents.some((t) =>
    /createBooking|create_booking|createPublicBooking/.test(t.text),
  ),
  toolFiles,
};

console.log(JSON.stringify(out, null, 2));
if (
  !out.executorImportsCreatePublicBooking ||
  !out.executorUsesEvaluateSelection ||
  !out.executorSetsClientRequestId ||
  out.geminiToolsHaveCreateBooking
) {
  process.exit(2);
}
