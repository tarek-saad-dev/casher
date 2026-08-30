#!/usr/bin/env npx tsx
/**
 * Phase 3 Gates A–D + latency probe (read-only; no booking writes).
 */
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
const SMOKE_START = process.env.SMOKE_START_UTC || '2026-08-29T13:12:00.000Z';

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
      SELECT TOP 1 ConversationID, Phone, ControlMode
      FROM dbo.TblBotConversation
      WHERE Phone LIKE '%' + @phone + '%' OR ExternalContactKey LIKE '%' + @phone + '%'
      ORDER BY ConversationID DESC
    `);
  const conversationId = Number(conv.recordset[0]?.ConversationID);
  if (!conversationId) throw new Error('conversation not found');

  const active = await getActiveBookingPlan(conversationId);
  const allPlans = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .query(`
      SELECT PlanID, Stage, Version, BranchID, BranchCode, BranchName,
             ServiceIdsJson, ServiceNamesJson, EmpID, EmployeeName,
             RequestedDate, TimePreferenceJson, CandidateSlotsJson, SelectedSlotJson,
             MissingFieldsJson, LastTurnID, TraceJson, CreatedAt, UpdatedAt, CompletedAt
      FROM dbo.TblBotBookingPlan
      WHERE ConversationID = @cid
      ORDER BY PlanID
    `);

  const activeCount = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .query(`
      SELECT COUNT(*) AS c
      FROM dbo.TblBotBookingPlan
      WHERE ConversationID = @cid
        AND Stage IN (N'collecting', N'clarifying', N'choosing_slot',
                      N'ready_to_confirm', N'confirmed_intent')
    `);

  const turns = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .input('since', sql.DateTime2, SMOKE_START)
    .query(`
      SELECT TurnID, Status, Intent, NeedsBusinessTool,
             AnchorInboundMessageID, LatestInboundMessageID, OutboundMessageID, OutboxID,
             ResultJson, CompletedAt, CreatedAt
      FROM dbo.TblBotAiTurn
      WHERE ConversationID = @cid AND CreatedAt >= @since
      ORDER BY TurnID
    `);

  const msgs = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .input('since', sql.DateTime2, SMOKE_START)
    .query(`
      SELECT MessageID, Direction, LEFT(Text, 200) AS body, OccurredAt, InboxID
      FROM dbo.TblBotMessage
      WHERE ConversationID = @cid AND OccurredAt >= @since
      ORDER BY MessageID
    `);

  // Duplicate AI turns per same latest inbound
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

  // Mutation totals + soft since-window probes (column names vary)
  const mutations = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holdsTotal,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claimsTotal,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS createsTotal,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookingsTotal
  `);

  const colProbe = await pool.request().query(`
    SELECT t.name AS tableName, c.name AS columnName
    FROM sys.columns c
    INNER JOIN sys.tables t ON t.object_id = c.object_id
    WHERE t.name IN (
      N'TblBookingHold', N'TblBookingSlotClaim',
      N'TblPublicBookingCreateRequest', N'Bookings'
    )
      AND c.name IN (N'CreatedAt', N'CreatedOn', N'RequestedAt', N'InsertedAt', N'BookingDate', N'Phone', N'ClientPhone')
    ORDER BY t.name, c.name
  `);

  let sinceWindow: Record<string, unknown> = { smokeStart: SMOKE_START };
  for (const row of colProbe.recordset as Array<{ tableName: string; columnName: string }>) {
    if (row.columnName === 'CreatedAt' || row.columnName === 'CreatedOn' || row.columnName === 'RequestedAt' || row.columnName === 'InsertedAt') {
      try {
        const r = await pool
          .request()
          .input('since', sql.DateTime2, SMOKE_START)
          .query(`SELECT COUNT(*) AS c FROM dbo.[${row.tableName}] WHERE [${row.columnName}] >= @since`);
        sinceWindow[`${row.tableName}.${row.columnName}`] = Number(r.recordset[0]?.c ?? -1);
      } catch (e) {
        sinceWindow[`${row.tableName}.${row.columnName}`] = e instanceof Error ? e.message : String(e);
      }
    }
  }

  // Try correlate creates/claims by phone if columns exist — soft probes
  let correlated: Record<string, unknown> = {};
  try {
    const c = await pool
      .request()
      .input('phone', sql.NVarChar(50), PHONE)
      .input('since', sql.DateTime2, SMOKE_START)
      .query(`
        SELECT TOP 5 ID, CreatedAt, Status
        FROM dbo.TblPublicBookingCreateRequest
        WHERE CreatedAt >= @since
          AND (
            CAST(RequestJson AS NVARCHAR(MAX)) LIKE '%' + @phone + '%'
            OR CAST(RequestJson AS NVARCHAR(MAX)) LIKE '%201557994946%'
          )
        ORDER BY ID DESC
      `);
    correlated.publicCreatesForPhone = c.recordset;
  } catch (e) {
    correlated.publicCreatesProbeError = e instanceof Error ? e.message : String(e);
  }

  // SOT availability (read-only)
  const sot = await executeGetAvailability({
    name: 'get_availability',
    branchCode: 'CAMP_CAESAR',
    serviceIds: [20],
    empId: 25,
    dateText: '2026-08-30',
  });
  const sotTimes = ((sot.data as { slots?: Array<{ time: string }> })?.slots ?? []).map(
    (s) => s.time,
  );

  const turnSummaries = turns.recordset.map((t: Record<string, unknown>) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = t.ResultJson ? JSON.parse(String(t.ResultJson)) : null;
    } catch {
      parsed = null;
    }
    const planner = parsed?.bookingPlanner as Record<string, unknown> | undefined;
    const timing = parsed?.timing as Record<string, unknown> | undefined;
    const toolTrace = parsed?.toolTrace as { tools?: Array<Record<string, unknown>> } | undefined;
    return {
      turnId: Number(t.TurnID),
      status: t.Status,
      intent: t.Intent,
      latestInboundMessageId: Number(t.LatestInboundMessageID),
      outboundMessageId: t.OutboundMessageID == null ? null : Number(t.OutboundMessageID),
      outboxId: t.OutboxID == null ? null : Number(t.OutboxID),
      createdAt: t.CreatedAt,
      completedAt: t.CompletedAt,
      replyHead: String(parsed?.replyText ?? '').slice(0, 120),
      plannerHandled: planner?.handled ?? null,
      planId: planner?.planId ?? null,
      stage: planner?.stage ?? null,
      plannerTrace: planner?.trace ?? null,
      timing,
      tools: (toolTrace?.tools ?? []).map((x) => ({
        name: x.name,
        ok: x.ok,
        durationMs: x.durationMs,
      })),
      hasTamElHagz: /تم الحجز/.test(String(parsed?.replyText ?? '')),
    };
  });

  const planRow = allPlans.recordset[allPlans.recordset.length - 1] as Record<string, unknown> | undefined;
  let traceJson: unknown = null;
  try {
    traceJson = planRow?.TraceJson ? JSON.parse(String(planRow.TraceJson)) : null;
  } catch {
    traceJson = planRow?.TraceJson ?? null;
  }

  const candidates = active?.candidateSlots?.map((s) => s.time) ?? [];
  const selected = active?.selectedSlot?.time ?? null;

  console.log(
    JSON.stringify(
      {
        gateA: {
          conversationId,
          planId: active?.planId ?? null,
          stage: active?.stage ?? null,
          version: active?.version ?? null,
          serviceIds: active?.serviceIds ?? null,
          empId: active?.empId ?? null,
          branchId: active?.branchId ?? null,
          branchCode: active?.branchCode ?? null,
          requestedDate: active?.requestedDate ?? null,
          timePreference: active?.timePreference ?? null,
          candidateSlots: active?.candidateSlots ?? null,
          selectedSlot: active?.selectedSlot ?? null,
          missingFields: active?.missingFields ?? null,
          lastTurnId: active?.lastTurnId ?? null,
          planTraceJson: traceJson,
          firstPickTurn: turnSummaries.find((t) => /الأول/.test(
            String(msgs.recordset.find((m: { MessageID: unknown }) => Number(m.MessageID) === t.latestInboundMessageId)?.body ?? ''),
          )),
        },
        gateB: {
          activePlanCount: Number(activeCount.recordset[0]?.c ?? 0),
          allPlanIds: allPlans.recordset.map((p: { PlanID: unknown; Stage: string; Version: number }) => ({
            planId: Number(p.PlanID),
            stage: p.Stage,
            version: p.Version,
          })),
          duplicateTurnsByInbound: dupTurns.recordset,
        },
        gateC: {
          mutations: mutations.recordset[0],
          timeColumns: colProbe.recordset,
          sinceWindow,
          correlated,
          baselineNote:
            'pre-smoke baseline holds=0 claims=1426 creates=667 bookings=1567; correlate by since-window + phone',
        },
        gateD: {
          sotOk: sot.ok,
          sotError: sot.errorCode ?? null,
          sotSlotCount: sotTimes.length,
          sotHas1200: sotTimes.includes('12:00'),
          sotHas1215: sotTimes.includes('12:15'),
          sotHas1230: sotTimes.includes('12:30'),
          storedCandidates: candidates,
          selected,
          selectedInStoredCandidates: selected ? candidates.includes(selected) : false,
          selectedInSot: selected ? sotTimes.includes(selected) : false,
        },
        messages: msgs.recordset,
        turns: turnSummaries,
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
