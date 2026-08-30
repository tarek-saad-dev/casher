#!/usr/bin/env npx tsx
/** Phase 4 canary DB probes — run from /home/casher/app */
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

const mode = process.argv[2] || 'baseline';

async function main() {
  const { getPool, closePool } = await import('./src/lib/db.ts');
  const pool = await getPool();

  if (mode === 'baseline' || mode === 'snapshot' || mode === 'all') {
    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblBotBookingPlan) AS plans,
        (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
        (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
        (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
        (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
    `);
    const plan = await pool.request().query(`
      SELECT TOP 1 *
      FROM dbo.TblBotBookingPlan WHERE PlanID = 1
    `);
    const conv = await pool.request().query(`
      SELECT ConversationID, Phone, ClientID, ControlMode, LastMessageAt, UpdatedAt
      FROM dbo.TblBotConversation WHERE ConversationID = 6
    `);
    const phone = String((conv.recordset[0] as any)?.Phone || '').replace(/\D/g, '');
    let customers: unknown = [];
    if (phone) {
      const c2 = await pool.request().input('p', phone).query(`
        SELECT TOP 5 ClientID, Name, Mobile, Phone
        FROM dbo.TblClient
        WHERE REPLACE(REPLACE(REPLACE(ISNULL(Mobile,''),' ',''),'+',''),'-','') LIKE '%' + RIGHT(@p,10)
           OR REPLACE(REPLACE(REPLACE(ISNULL(Phone,''),' ',''),'+',''),'-','') LIKE '%' + RIGHT(@p,10)
        ORDER BY ClientID DESC
      `);
      customers = c2.recordset;
    }
    console.log(
      JSON.stringify(
        {
          gate: mode,
          counts: counts.recordset[0],
          plan1: plan.recordset[0] || null,
          conversation6: conv.recordset[0] || null,
          customers,
        },
        null,
        2,
      ),
    );
  }

  if (mode === 'post-migration') {
    const cols = await pool.request().query(`
      SELECT c.name, t.name AS typ, c.is_nullable
      FROM sys.columns c
      JOIN sys.types t ON c.user_type_id = t.user_type_id
      WHERE c.object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
        AND c.name IN (N'BookingID', N'BookingCode', N'IdempotencyKey', N'ExecutionErrorCode')
      ORDER BY c.name
    `);
    const ck = await pool.request().query(`
      SELECT definition FROM sys.check_constraints
      WHERE name = N'CK_TblBotBookingPlan_Stage'
    `);
    const plan = await pool.request().query(`
      SELECT PlanID, Stage, Version, SelectedSlotJson, BookingID, BookingCode, IdempotencyKey
      FROM dbo.TblBotBookingPlan WHERE PlanID = 1
    `);
    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
        (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
        (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
    `);
    console.log(
      JSON.stringify(
        {
          gate: 'post-migration',
          cols: cols.recordset,
          stageCk: ck.recordset[0]?.definition ?? null,
          plan1: plan.recordset[0],
          counts: counts.recordset[0],
        },
        null,
        2,
      ),
    );
  }

  if (mode === 'revalidate') {
    const { getBookingPlanById } = await import(
      './src/modules/messaging/ai/planner/bookingPlanRepository.ts'
    );
    const { evaluatePublicBookingSelection } = await import(
      './src/lib/booking/publicBookingSelectionEvaluator.ts'
    );
    const plan = await getBookingPlanById(1);
    if (!plan || !plan.selectedSlot || !plan.branchCode || !plan.requestedDate) {
      console.log(JSON.stringify({ gate: 'revalidate', ok: false, reason: 'plan incomplete', plan }));
      await closePool();
      return;
    }
    const evaluation = await evaluatePublicBookingSelection({
      branchCode: plan.branchCode,
      date: plan.requestedDate,
      time: plan.selectedSlot.time,
      dayOffset: plan.selectedSlot.dayOffset ?? 0,
      serviceIds: plan.serviceIds,
      empId: plan.empId,
      mode: plan.empId ? 'specific_barber' : 'any_barber',
      purpose: 'internal_preview',
      auth: { userId: Number(process.env.AI_BOOKING_ACTOR_USER_ID || 1), canOperate: true },
    });
    console.log(
      JSON.stringify(
        {
          gate: 'revalidate',
          planId: plan.planId,
          stage: plan.stage,
          version: plan.version,
          branch: plan.branchCode,
          empId: plan.empId,
          date: plan.requestedDate,
          time: plan.selectedSlot.time,
          serviceIds: plan.serviceIds,
          available: evaluation.available,
          code: evaluation.availabilityCode,
          message: evaluation.availabilityMessage,
          hasPlanToken: !!evaluation.planToken,
        },
        null,
        2,
      ),
    );
  }

  if (mode === 'slot-snapshot') {
    const plan = await pool.request().query(`
      SELECT PlanID, Stage, Version, EmpID, RequestedDate, SelectedSlotJson, BranchCode, ServiceIdsJson, IdempotencyKey, BookingID
      FROM dbo.TblBotBookingPlan WHERE PlanID = 1
    `);
    const p = plan.recordset[0] as any;
    let slot: any = null;
    try {
      slot = p?.SelectedSlotJson ? JSON.parse(p.SelectedSlotJson) : null;
    } catch {
      slot = null;
    }
    const empId = p?.EmpID;
    const date = p?.RequestedDate;
    const claims = await pool
      .request()
      .input('emp', empId)
      .input('d', date)
      .query(`
        SELECT TOP 20 ClaimID, BookingID, EmpID, ClaimType, AbsoluteSlotStartUtc, CreatedAtUtc
        FROM dbo.TblBookingSlotClaim
        WHERE EmpID = @emp AND CAST(AbsoluteSlotStartUtc AS DATE) = CAST(@d AS DATE)
        ORDER BY ClaimID DESC
      `);
    const bookings = await pool
      .request()
      .input('emp', empId)
      .input('d', date)
      .query(`
        SELECT TOP 20 BookingID, BookingCode, AssignedEmpID, BranchID, BookingDate, StartTime, Status, ClientID, CreatedAt, AbsoluteStartUtc
        FROM dbo.Bookings
        WHERE AssignedEmpID = @emp AND CAST(BookingDate AS DATE) = CAST(@d AS DATE)
        ORDER BY BookingID DESC
      `);
    const creates = await pool.request().query(`
      SELECT TOP 10 RequestID, IdempotencyKey, BookingID, Status, CreatedAt
      FROM dbo.TblPublicBookingCreateRequest
      WHERE IdempotencyKey LIKE N'bot-booking-plan:1:%'
      ORDER BY RequestID DESC
    `);
    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
        (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
        (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
        (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
    `);
    console.log(
      JSON.stringify(
        {
          gate: 'slot-snapshot',
          counts: counts.recordset[0],
          plan: { ...p, selectedSlot: slot },
          claimsForEmpDate: claims.recordset,
          bookingsForEmpDate: bookings.recordset,
          createRequests: creates.recordset,
        },
        null,
        2,
      ),
    );
  }

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
