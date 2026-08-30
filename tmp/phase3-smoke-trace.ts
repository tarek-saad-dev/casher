#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

const PHONE = process.env.SMOKE_PHONE || '201557994946';

async function main() {
  const { getPool, closePool, sql } = await import('./src/lib/db.ts');
  const { getActiveBookingPlan } = await import(
    './src/modules/messaging/ai/planner/bookingPlanRepository.ts'
  );
  const pool = await getPool();

  // Prove repo read path
  const conv = await pool
    .request()
    .input('phone', sql.NVarChar(50), PHONE)
    .query(`
      SELECT TOP 1 ConversationID, Phone, ControlMode
      FROM dbo.TblBotConversation
      WHERE Phone LIKE '%' + @phone + '%' OR ExternalContactKey LIKE '%' + @phone + '%'
      ORDER BY ConversationID DESC
    `);
  const conversationId = conv.recordset[0]?.ConversationID
    ? Number(conv.recordset[0].ConversationID)
    : null;

  let active = null;
  if (conversationId) {
    active = await getActiveBookingPlan(conversationId);
  }

  const recent = await pool
    .request()
    .input('phone', sql.NVarChar(50), PHONE)
    .query(`
      SELECT TOP 5
        m.MessageID, m.Direction, LEFT(m.Text, 120) AS body, m.OccurredAt, m.ConversationID
      FROM dbo.TblBotMessage m
      INNER JOIN dbo.TblBotConversation c ON c.ConversationID = m.ConversationID
      WHERE c.Phone LIKE '%' + @phone + '%' OR c.ExternalContactKey LIKE '%' + @phone + '%'
      ORDER BY m.MessageID DESC
    `);

  const plans = conversationId
    ? await pool
        .request()
        .input('cid', sql.BigInt, conversationId)
        .query(`
          SELECT PlanID, Stage, Version, EmpID, BranchCode, ServiceIdsJson, RequestedDate,
                 TimePreferenceJson, CandidateSlotsJson, SelectedSlotJson, MissingFieldsJson,
                 LastTurnID, UpdatedAt, CreatedAt
          FROM dbo.TblBotBookingPlan
          WHERE ConversationID = @cid
          ORDER BY PlanID DESC
        `)
    : { recordset: [] };

  const turns = conversationId
    ? await pool
        .request()
        .input('cid', sql.BigInt, conversationId)
        .query(`
          SELECT TOP 5 TurnID, Status, Intent, NeedsBusinessTool,
                 LEFT(CAST(ResultJson AS NVARCHAR(MAX)), 400) AS resultHead,
                 CompletedAt, CreatedAt
          FROM dbo.TblBotAiTurn
          WHERE ConversationID = @cid
          ORDER BY TurnID DESC
        `)
    : { recordset: [] };

  const mutations = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings,
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates
  `);

  console.log(
    JSON.stringify(
      {
        phoneTail: PHONE.slice(-4),
        conversationId,
        activePlan: active
          ? {
              planId: active.planId,
              stage: active.stage,
              version: active.version,
              serviceIds: active.serviceIds,
              empId: active.empId,
              date: active.requestedDate,
              timePreference: active.timePreference,
              candidateCount: active.candidateSlots.length,
              candidates: active.candidateSlots.map((s) => s.time),
              selected: active.selectedSlot?.time ?? null,
              missing: active.missingFields,
            }
          : null,
        allPlans: plans.recordset,
        recentMessages: recent.recordset,
        recentTurns: turns.recordset,
        mutations: mutations.recordset[0],
      },
      null,
      2,
    ),
  );
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
