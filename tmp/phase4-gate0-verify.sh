#!/bin/bash
set -euo pipefail
cd /home/casher/app
echo "=== worker ==="
systemctl is-active messaging-ai-worker
pgrep -af 'messaging-ai-worker.ts$' || true
echo "count=$(pgrep -c -f 'messaging-ai-worker.ts$' || echo 0)"
echo "=== plan ==="
npx tsx - <<'EOF'
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};
const { getPool, closePool } = await import('./src/lib/db.ts');
const { getActiveBookingPlan } = await import('./src/modules/messaging/ai/planner/bookingPlanRepository.ts');
const pool = await getPool();
const active = await getActiveBookingPlan(6);
const counts = await pool.request().query(`
  SELECT
    (SELECT COUNT(*) FROM dbo.TblBotBookingPlan WHERE ConversationID=6 AND Stage<>N'abandoned') AS plans,
    (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
    (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
    (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
    (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
`);
console.log(JSON.stringify({
  gate0: 'ok',
  planId: active?.planId ?? null,
  stage: active?.stage ?? null,
  version: active?.version ?? null,
  selected: active?.selectedSlot?.time ?? null,
  serviceIds: active?.serviceIds ?? null,
  empId: active?.empId ?? null,
  branch: active?.branchCode ?? null,
  date: active?.requestedDate ?? null,
  counts: counts.recordset[0],
}, null, 2));
await closePool();
EOF
