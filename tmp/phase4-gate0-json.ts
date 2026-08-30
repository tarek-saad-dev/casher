#!/usr/bin/env npx tsx
import Module from 'module';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};
async function main() {
  const { getPool, closePool } = await import('./src/lib/db.ts');
  const { getActiveBookingPlan } = await import(
    './src/modules/messaging/ai/planner/bookingPlanRepository.ts'
  );
  const pool = await getPool();
  const active = await getActiveBookingPlan(6);
  const q = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBotBookingPlan WHERE ConversationID=6 AND Stage IN (
        N'collecting',N'clarifying',N'choosing_slot',N'ready_to_confirm',N'confirmed_intent',N'executing'
      )) AS activePlans,
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
  `);
  const out = {
    planId: active?.planId ?? null,
    stage: active?.stage ?? null,
    version: active?.version ?? null,
    selected: active?.selectedSlot?.time ?? null,
    serviceIds: active?.serviceIds ?? null,
    empId: active?.empId ?? null,
    branch: active?.branchCode ?? null,
    date: active?.requestedDate ?? null,
    counts: q.recordset[0],
  };
  fs.writeFileSync('/tmp/phase4-gate0.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
