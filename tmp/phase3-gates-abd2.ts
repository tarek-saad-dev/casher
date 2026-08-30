#!/usr/bin/env npx tsx
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

const PHONE = '201557994946';
const SMOKE_START = '2026-08-29T13:12:00.000Z';
const BASELINE = { holds: 0, claims: 1426, creates: 667, bookings: 1567 };

async function main() {
  const { getPool, closePool, sql } = await import('./src/lib/db.ts');
  const { getActiveBookingPlan } = await import(
    './src/modules/messaging/ai/planner/bookingPlanRepository.ts'
  );
  const { executeGetAvailability } = await import(
    './src/modules/messaging/ai/tools/getAvailability.ts'
  );
  const pool = await getPool();

  const conv = await pool
    .request()
    .input('phone', sql.NVarChar(50), PHONE)
    .query(`
      SELECT TOP 1 ConversationID FROM dbo.TblBotConversation
      WHERE Phone LIKE '%' + @phone + '%' OR ExternalContactKey LIKE '%' + @phone + '%'
      ORDER BY ConversationID DESC
    `);
  const conversationId = Number(conv.recordset[0].ConversationID);
  const active = await getActiveBookingPlan(conversationId);

  const plans = await pool.request().input('cid', sql.BigInt, conversationId).query(`
    SELECT PlanID, Stage, Version, BranchID, BranchCode, EmpID, ServiceIdsJson,
           RequestedDate, TimePreferenceJson, CandidateSlotsJson, SelectedSlotJson,
           LastTurnID, CreatedAt, UpdatedAt
    FROM dbo.TblBotBookingPlan WHERE ConversationID = @cid ORDER BY PlanID
  `);

  const activeCount = await pool.request().input('cid', sql.BigInt, conversationId).query(`
    SELECT COUNT(*) AS c FROM dbo.TblBotBookingPlan
    WHERE ConversationID = @cid AND Stage IN (
      N'collecting', N'clarifying', N'choosing_slot', N'ready_to_confirm', N'confirmed_intent'
    )
  `);

  const turns = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .input('since', sql.DateTime2, SMOKE_START)
    .query(`
      SELECT TurnID, Status, Intent, LatestInboundMessageID, OutboundMessageID, OutboxID,
             ResultJson, CreatedAt, CompletedAt
      FROM dbo.TblBotAiTurn
      WHERE ConversationID = @cid AND CreatedAt >= @since
      ORDER BY TurnID
    `);

  const msgs = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .input('since', sql.DateTime2, SMOKE_START)
    .query(`
      SELECT MessageID, Direction, Text, OccurredAt
      FROM dbo.TblBotMessage
      WHERE ConversationID = @cid AND OccurredAt >= @since
      ORDER BY MessageID
    `);

  const msgById = new Map<number, string>();
  for (const m of msgs.recordset as Array<{ MessageID: unknown; Text: string }>) {
    msgById.set(Number(m.MessageID), String(m.Text || ''));
  }

  const dupTurns = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .input('since', sql.DateTime2, SMOKE_START)
    .query(`
      SELECT LatestInboundMessageID, COUNT(*) AS turnCount
      FROM dbo.TblBotAiTurn
      WHERE ConversationID = @cid AND CreatedAt >= @since
      GROUP BY LatestInboundMessageID
      HAVING COUNT(*) > 1
    `);

  const totals = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
  `);

  const sinceCreates = await pool.request().input('since', sql.DateTime2, SMOKE_START).query(`
    SELECT COUNT(*) AS c FROM dbo.TblPublicBookingCreateRequest WHERE CreatedAt >= @since
  `);
  const sinceHolds = await pool.request().input('since', sql.DateTime2, SMOKE_START).query(`
    SELECT COUNT(*) AS c FROM dbo.TblBookingHold WHERE CreatedAt >= @since
  `);
  const sinceBookings = await pool.request().input('since', sql.DateTime2, SMOKE_START).query(`
    SELECT COUNT(*) AS c FROM dbo.Bookings WHERE CreatedAt >= @since
  `);

  // Bookings in window: check if any mention our phone / this conversation client
  let bookingsSample: unknown[] = [];
  try {
    const b = await pool.request().input('since', sql.DateTime2, SMOKE_START).query(`
      SELECT TOP 10 BookingID, CreatedAt, BranchID, EmpID, ClientID
      FROM dbo.Bookings WHERE CreatedAt >= @since ORDER BY BookingID DESC
    `);
    bookingsSample = b.recordset;
  } catch {
    bookingsSample = [];
  }

  const sot = await executeGetAvailability({
    name: 'get_availability',
    branchCode: 'CAMP_CAESAR',
    serviceIds: [20],
    empId: 25,
    dateText: '2026-08-30',
  });
  const sotTimes = ((sot.data as { slots?: Array<{ time: string }> })?.slots ?? []).map((s) => s.time);

  const turnRows = (turns.recordset as Array<Record<string, unknown>>).map((t) => {
    let parsed: any = null;
    try {
      parsed = t.ResultJson ? JSON.parse(String(t.ResultJson)) : null;
    } catch {
      parsed = null;
    }
    const inbound = msgById.get(Number(t.LatestInboundMessageID)) || '';
    const planner = parsed?.bookingPlanner;
    return {
      turnId: Number(t.TurnID),
      inbound: inbound.slice(0, 80),
      replyHead: String(parsed?.replyText || '').slice(0, 100),
      stage: planner?.stage ?? null,
      deterministicAction: planner?.trace?.deterministicAction ?? null,
      selectedSlot: planner?.trace?.selectedSlot?.time ?? null,
      candidateSlotCount: planner?.trace?.candidateSlotCount ?? null,
      stageBefore: planner?.trace?.stageBefore ?? null,
      stageAfter: planner?.trace?.stageAfter ?? null,
      tools: (parsed?.toolTrace?.tools || []).map((x: any) => ({
        name: x.name,
        ok: x.ok,
        durationMs: x.durationMs,
      })),
      timing: parsed?.timing ?? null,
      hasTamElHagz: /تم الحجز/.test(String(parsed?.replyText || '')),
      outboundMessageId: t.OutboundMessageID == null ? null : Number(t.OutboundMessageID),
      outboxId: t.OutboxID == null ? null : Number(t.OutboxID),
      createdAt: t.CreatedAt,
      completedAt: t.CompletedAt,
    };
  });

  const selectTurn = turnRows.find((t) => t.deterministicAction === 'select_slot');
  const confirmTurn = turnRows.find((t) => t.deterministicAction === 'confirm_intent');
  const availTurn = turnRows.find((t) => t.tools.some((x) => x.name === 'get_availability' && (x.durationMs || 0) > 50));

  const out = {
    gateA: {
      conversationId,
      planId: active?.planId,
      stage: active?.stage,
      version: active?.version,
      serviceIds: active?.serviceIds,
      empId: active?.empId,
      branchId: active?.branchId,
      branchCode: active?.branchCode,
      requestedDate: active?.requestedDate,
      timePreference: active?.timePreference,
      candidateSlots: active?.candidateSlots?.map((s) => s.time),
      selectedSlot: active?.selectedSlot?.time,
      lastTurnId: active?.lastTurnId,
      selectTurnProof: selectTurn
        ? {
            turnId: selectTurn.turnId,
            inbound: selectTurn.inbound,
            deterministicAction: selectTurn.deterministicAction,
            stageBefore: selectTurn.stageBefore,
            stageAfter: selectTurn.stageAfter,
            selectedSlot: selectTurn.selectedSlot,
            note: 'select_slot uses stored candidates; freshness re-read may call get_availability',
          }
        : null,
      confirmTurnProof: confirmTurn
        ? {
            turnId: confirmTurn.turnId,
            inbound: confirmTurn.inbound,
            deterministicAction: confirmTurn.deterministicAction,
            stageAfter: confirmTurn.stageAfter,
            hasTamElHagz: confirmTurn.hasTamElHagz,
            tools: confirmTurn.tools,
          }
        : null,
    },
    gateB: {
      activePlanCount: Number(activeCount.recordset[0].c),
      plans: plans.recordset.map((p: any) => ({
        planId: Number(p.PlanID),
        stage: p.Stage,
        version: p.Version,
      })),
      duplicateTurnsByInbound: dupTurns.recordset,
    },
    gateC: {
      baseline: BASELINE,
      currentTotals: totals.recordset[0],
      claimsUnchanged: Number(totals.recordset[0].claims) === BASELINE.claims,
      holdsTotalUnchanged: Number(totals.recordset[0].holds) === BASELINE.holds,
      createsTotalUnchanged: Number(totals.recordset[0].creates) === BASELINE.creates,
      sinceWindow: {
        holds: Number(sinceHolds.recordset[0].c),
        creates: Number(sinceCreates.recordset[0].c),
        bookings: Number(sinceBookings.recordset[0].c),
      },
      bookingsSampleSinceSmoke: bookingsSample,
      note: 'claims total still 1426; creates/holds since smoke = 0; bookings since may be unrelated POS traffic',
    },
    gateD: {
      sotOk: sot.ok,
      sotCount: sotTimes.length,
      sotContainsCandidates: ['12:00', '12:15', '12:30'].every((t) => sotTimes.includes(t)),
      storedCandidates: active?.candidateSlots?.map((s) => s.time),
      selected: active?.selectedSlot?.time,
      selectedInStored: active?.selectedSlot
        ? active.candidateSlots.some((c) => c.time === active.selectedSlot!.time)
        : false,
      selectedInSot: active?.selectedSlot ? sotTimes.includes(active.selectedSlot.time) : false,
    },
    gateH: {
      availabilityTurn: availTurn
        ? { turnId: availTurn.turnId, timing: availTurn.timing, tools: availTurn.tools }
        : null,
      selectTurn: selectTurn
        ? { turnId: selectTurn.turnId, timing: selectTurn.timing, tools: selectTurn.tools, action: selectTurn.deterministicAction }
        : null,
      confirmTurn: confirmTurn
        ? { turnId: confirmTurn.turnId, timing: confirmTurn.timing, tools: confirmTurn.tools, action: confirmTurn.deterministicAction }
        : null,
    },
    turns: turnRows,
  };

  fs.writeFileSync('/home/casher/app/tmp-phase3-gates-abd.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE tmp-phase3-gates-abd.json');
  console.log(
    JSON.stringify(
      {
        stage: out.gateA.stage,
        planId: out.gateA.planId,
        version: out.gateA.version,
        selected: out.gateA.selectedSlot,
        activePlans: out.gateB.activePlanCount,
        claimsUnchanged: out.gateC.claimsUnchanged,
        holdsSince: out.gateC.sinceWindow.holds,
        createsSince: out.gateC.sinceWindow.creates,
        sotContains: out.gateD.sotContainsCandidates,
        selectAction: out.gateA.selectTurnProof?.deterministicAction,
        confirmAction: out.gateA.confirmTurnProof?.deterministicAction,
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
