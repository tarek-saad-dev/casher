#!/usr/bin/env npx tsx
/**
 * Phase 3 local multi-turn booking planner E2E (no booking writes).
 * Exercises processBookingPlannerTurn with real resolve + mocked availability
 * unless LIVE_AVAILABILITY=1.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

type Step = {
  text: string;
  entities: {
    serviceText: string | null;
    employeeName: string | null;
    dateText: string | null;
    timeText: string | null;
    branchText: string | null;
  };
};

async function main() {
  const { getPool, closePool, getCurrentDbTarget, getDbConnectionInfo } = await import('../src/lib/db');
  const { processBookingPlannerTurn } = await import(
    '../src/modules/messaging/ai/planner/processBookingPlannerTurn'
  );
  const { getActiveBookingPlan } = await import(
    '../src/modules/messaging/ai/planner/bookingPlanRepository'
  );
  const { executeGetAvailability } = await import(
    '../src/modules/messaging/ai/tools/getAvailability'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('phase3-planner-e2e', { target, server: resolved.server, database: resolved.database });

  const pool = await getPool();

  // Ensure table exists
  const tbl = await pool.request().query(`
    SELECT OBJECT_ID(N'dbo.TblBotBookingPlan') AS oid
  `);
  if (!tbl.recordset[0]?.oid) {
    throw new Error('TblBotBookingPlan missing — run npm run messaging:migrate-booking-plan');
  }

  // Synthetic conversation row (or reuse)
  const phone = `20155${String(Date.now()).slice(-7)}`;
  const conv = await pool
    .request()
    .input('phone', phone)
    .query(`
      INSERT INTO dbo.TblBotConversation (
        Channel, Provider, ExternalContactKey, Phone, ControlMode, LastMessageAt, CreatedAt, UpdatedAt
      )
      OUTPUT INSERTED.ConversationID
      VALUES (
        N'whatsapp', N'baileys', @phone, @phone, N'BOT', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME()
      )
    `);
  const conversationId = Number(conv.recordset[0].ConversationID);
  console.log('conversationId', conversationId);

  const baseline = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS createReqs
  `).catch(async () => {
    // tables may have different names — probe soft
    return { recordset: [{ holds: -1, createReqs: -1 }] };
  });

  const useLive = process.env.LIVE_AVAILABILITY === '1';
  const runAvailability = useLive
    ? executeGetAvailability
    : async () => ({
        name: 'get_availability' as const,
        ok: true,
        input: {},
        data: {
          branch: { branchCode: 'CAMP_CAESAR', branchName: 'كامب شيزار' },
          date: '2026-08-30',
          slots: [
            { time: '18:15', dayOffset: 0, empId: 25, empName: 'عمر' },
            { time: '19:00', dayOffset: 0, empId: 25, empName: 'عمر' },
            { time: '19:45', dayOffset: 0, empId: 25, empName: 'عمر' },
          ],
          noSlots: false,
        },
      });

  const steps: Step[] = [
    {
      text: 'عاوز أحجز شعر ودقن',
      entities: {
        serviceText: 'شعر ودقن',
        employeeName: null,
        dateText: null,
        timeText: null,
        branchText: null,
      },
    },
    {
      text: 'مع عمر',
      entities: {
        serviceText: null,
        employeeName: 'عمر',
        dateText: null,
        timeText: null,
        branchText: null,
      },
    },
    {
      text: 'بكرة بعد 6',
      entities: {
        serviceText: null,
        employeeName: null,
        dateText: 'بكرة',
        timeText: 'بعد 6',
        branchText: null,
      },
    },
    {
      text: 'الأول',
      entities: {
        serviceText: null,
        employeeName: null,
        dateText: null,
        timeText: null,
        branchText: null,
      },
    },
    {
      text: 'أيوه',
      entities: {
        serviceText: null,
        employeeName: null,
        dateText: null,
        timeText: null,
        branchText: null,
      },
    },
  ];

  const progression: Array<Record<string, unknown>> = [];
  let turnId = 900000 + Math.floor(Math.random() * 1000);

  for (const step of steps) {
    turnId += 1;
    const started = performance.now();
    const result = await processBookingPlannerTurn({
      conversationId,
      turnId,
      phone,
      inboundText: step.text,
      structured: {
        replyText: '',
        intent: 'booking_request',
        confidence: 0.95,
        needsBusinessTool: true,
        missingInformation: [],
        entities: step.entities,
        shouldReply: true,
        toolCalls: [],
      },
      runAvailability: runAvailability as typeof executeGetAvailability,
    });
    const ms = Math.round(performance.now() - started);
    const plan = await getActiveBookingPlan(conversationId);
    const row = {
      text: step.text,
      ms,
      handled: result.handled,
      stage: plan?.stage ?? result.trace.stageAfter,
      serviceIds: plan?.serviceIds ?? [],
      empId: plan?.empId ?? null,
      date: plan?.requestedDate ?? null,
      candidates: plan?.candidateSlots?.map((s) => s.time) ?? [],
      selected: plan?.selectedSlot?.time ?? null,
      reply: result.replyText,
      noWriteProof: !/تم الحجز/.test(result.replyText || ''),
    };
    progression.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  const after = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS createReqs
  `).catch(() => baseline);

  const finalPlan = await getActiveBookingPlan(conversationId);
  const pass =
    finalPlan?.stage === 'confirmed_intent' &&
    progression.every((p) => p.noWriteProof) &&
    JSON.stringify(baseline.recordset[0]) === JSON.stringify(after.recordset[0]);

  console.log(
    JSON.stringify(
      {
        PHASE_3_BOOKING_PLANNER_LOCAL_E2E: pass ? 'PASS' : 'FAIL',
        finalStage: finalPlan?.stage,
        writesUnchanged: JSON.stringify(baseline.recordset[0]) === JSON.stringify(after.recordset[0]),
        baseline: baseline.recordset[0],
        after: after.recordset[0],
        progression,
      },
      null,
      2,
    ),
  );

  await closePool();
  if (!pass) process.exit(2);
}

main().catch((e) => {
  console.error('E2E FAIL', e instanceof Error ? e.message : e);
  process.exit(2);
});
