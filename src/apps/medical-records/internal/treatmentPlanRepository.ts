import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  TreatmentPlanConflict, treatmentProgress, type TreatmentSessionView,
} from '../application/treatmentPlanPolicy';

type Context = { tenantId: string; branchId: number; practitionerEmpId: number; userId: number };
export type TreatmentPlanView = {
  planId: string;
  title: string;
  totalSessions: number;
  sourceEncounterId: string;
  createdAt: string;
  sessions: TreatmentSessionView[];
  progress: ReturnType<typeof treatmentProgress>;
};

async function assertSourceEncounter(
  input: Context & { encounterId: string },
): Promise<{ clientId: number; locationId: string; status: string }> {
  const pool = await getPool();
  const result = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('branchId', sql.Int, input.branchId)
    .input('doctor', sql.Int, input.practitionerEmpId)
    .input('encounterId', sql.UniqueIdentifier, input.encounterId)
    .query(`
      SELECT TOP 1 e.ClientID, e.LocationId, e.Status
      FROM dbo.ClinicEncounter e
      JOIN dbo.Location l ON l.TenantId=e.TenantId AND l.LocationId=e.LocationId
      WHERE e.TenantId=@tenantId AND e.EncounterId=@encounterId
        AND e.PractitionerEmpID=@doctor AND l.LegacyBranchId=@branchId;
    `);
  const row = result.recordset[0] as { ClientID: number; LocationId: string; Status: string } | undefined;
  if (!row) throw new TreatmentPlanConflict('NOT_FOUND', 'الزيارة مش موجودة للطبيب والفرع الحاليين.');
  return { clientId: Number(row.ClientID), locationId: String(row.LocationId), status: row.Status };
}

/** Clinician's plans for this patient within the active location; no medical notes exposed. */
export async function listTreatmentPlans(input: Context & { encounterId: string }):
  Promise<TreatmentPlanView[]> {
  const source = await assertSourceEncounter(input);
  const pool = await getPool();
  const results = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('doctor', sql.Int, input.practitionerEmpId)
    .input('clientId', sql.Int, source.clientId)
    .input('locationId', sql.UniqueIdentifier, source.locationId)
    .query(`
      SELECT p.PlanId, p.Title, p.TotalSessions, p.SourceEncounterId, p.CreatedAt,
             s.SessionNumber, s.BookingID, b.Status AS BookingStatus,
             CONVERT(VARCHAR(10), b.BookingDate, 23) AS BookingDate,
             linked.EncounterId, linked.Status AS EncounterStatus
      FROM dbo.ClinicTreatmentPlan p
      JOIN dbo.ClinicTreatmentSession s
        ON s.TenantId=p.TenantId AND s.PlanId=p.PlanId
      LEFT JOIN dbo.Bookings b
        ON b.BookingID=s.BookingID AND b.BranchID=
          (SELECT TOP 1 LegacyBranchId FROM dbo.Location
           WHERE TenantId=p.TenantId AND LocationId=p.LocationId)
      OUTER APPLY (
        SELECT TOP 1 e.EncounterId, e.Status
        FROM dbo.ClinicEncounter e
        WHERE e.TenantId=p.TenantId AND e.ClientID=p.ClientID
          AND e.PractitionerEmpID=p.PractitionerEmpID AND e.LocationId=p.LocationId
          AND e.BookingRef=CONCAT(N'booking:',CONVERT(NVARCHAR(20),s.BookingID))
        ORDER BY e.CreatedAt DESC
      ) linked
      WHERE p.TenantId=@tenantId AND p.ClientID=@clientId
        AND p.PractitionerEmpID=@doctor AND p.LocationId=@locationId
      ORDER BY p.CreatedAt DESC, p.PlanId DESC, s.SessionNumber ASC;
    `);
  type Row = {
    PlanId: string; Title: string; TotalSessions: number; SourceEncounterId: string;
    CreatedAt: Date | string; SessionNumber: number; BookingID: number | null;
    BookingStatus: string | null; BookingDate: string | null;
    EncounterId: string | null; EncounterStatus: string | null;
  };
  const plans = new Map<string, TreatmentPlanView>();
  for (const row of results.recordset as Row[]) {
    const id = String(row.PlanId);
    let plan = plans.get(id);
    if (!plan) {
      plan = {
        planId: id, title: row.Title, totalSessions: Number(row.TotalSessions),
        sourceEncounterId: String(row.SourceEncounterId),
        createdAt: String(row.CreatedAt),
        sessions: [], progress: { total: 0, completed: 0, remaining: 0, booked: 0,
          needsRebooking: 0, percent: 0 },
      };
      plans.set(id, plan);
    }
    plan.sessions.push({
      sessionNumber: Number(row.SessionNumber), bookingId: row.BookingID ?? null,
      bookingStatus: row.BookingStatus, bookingDate: row.BookingDate,
      encounterId: row.EncounterId == null ? null : String(row.EncounterId),
      encounterStatus: row.EncounterStatus,
    });
  }
  for (const plan of plans.values()) plan.progress = treatmentProgress(plan.sessions);
  return Array.from(plans.values());
}

/** Creates a full numbered plan only from a completed encounter owned by the logged-in doctor. */
export async function createTreatmentPlan(input: Context & {
  encounterId: string; title: string; totalSessions: number;
}): Promise<string> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const source = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('doctor', sql.Int, input.practitionerEmpId)
      .input('branchId', sql.Int, input.branchId)
      .input('encounterId', sql.UniqueIdentifier, input.encounterId)
      .query(`
        SELECT TOP 1 e.ClientID, e.LocationId, e.Status
        FROM dbo.ClinicEncounter e WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.Location l ON l.TenantId=e.TenantId AND l.LocationId=e.LocationId
        WHERE e.TenantId=@tenantId AND e.EncounterId=@encounterId
          AND e.PractitionerEmpID=@doctor AND l.LegacyBranchId=@branchId;
      `);
    const encounter = source.recordset[0] as {
      ClientID: number; LocationId: string; Status: string;
    } | undefined;
    if (!encounter) throw new TreatmentPlanConflict('NOT_FOUND', 'الزيارة غير موجودة أو ليست تحت مسؤوليتك.');
    if (encounter.Status !== 'completed') {
      throw new TreatmentPlanConflict('NOT_READY', 'كمّل الكشف الأول قبل إنشاء خطة جلسات.');
    }

    const created = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('doctor', sql.Int, input.practitionerEmpId)
      .input('clientId', sql.Int, encounter.ClientID)
      .input('locationId', sql.UniqueIdentifier, encounter.LocationId)
      .input('encounterId', sql.UniqueIdentifier, input.encounterId)
      .input('title', sql.NVarChar(180), input.title)
      .input('total', sql.Int, input.totalSessions)
      .input('actor', sql.Int, input.userId)
      .query(`
        INSERT dbo.ClinicTreatmentPlan
          (TenantId, ClientID, PractitionerEmpID, LocationId,
           SourceEncounterId, Title, TotalSessions, CreatedByUserID)
        OUTPUT INSERTED.PlanId
        VALUES
          (@tenantId,@clientId,@doctor,@locationId,@encounterId,@title,@total,@actor);
      `);
    const planId = String(created.recordset[0].PlanId);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('planId', sql.UniqueIdentifier, planId)
      .input('total', sql.Int, input.totalSessions)
      .query(`
        ;WITH numbered AS (
          SELECT 1 AS N
          UNION ALL SELECT N + 1 FROM numbered WHERE N < @total
        )
        INSERT dbo.ClinicTreatmentSession (TenantId,PlanId,SessionNumber)
        SELECT @tenantId,@planId,N FROM numbered OPTION (MAXRECURSION 50);
      `);
    await tx.commit();
    return planId;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    const code = (err as { number?: number; originalError?: { info?: { number?: number } } }).number
      ?? (err as { originalError?: { info?: { number?: number } } }).originalError?.info?.number;
    if (code === 2601 || code === 2627)
      throw new TreatmentPlanConflict('PLAN_ALREADY_EXISTS',
        'فيه خطة بنفس الاسم مسجلة من الكشف ده بالفعل. حدّث الصفحة.');
    throw err;
  }
}

/** Links an *existing* Shared Booking appointment. Never creates/updates a Booking row. */
export async function attachTreatmentSessionBooking(input: Context & {
  planId: string; sessionNumber: number; bookingId: number;
}): Promise<{ bookingId: number; reused: boolean }> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const row = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('planId', sql.UniqueIdentifier, input.planId)
      .input('number', sql.Int, input.sessionNumber)
      .input('doctor', sql.Int, input.practitionerEmpId)
      .input('branchId', sql.Int, input.branchId)
      .query(`
        SELECT TOP 1 p.ClientID, p.PractitionerEmpID, s.BookingID
        FROM dbo.ClinicTreatmentPlan p WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.ClinicTreatmentSession s WITH (UPDLOCK, HOLDLOCK)
          ON s.TenantId=p.TenantId AND s.PlanId=p.PlanId
        JOIN dbo.Location l ON l.TenantId=p.TenantId AND l.LocationId=p.LocationId
        WHERE p.TenantId=@tenantId AND p.PlanId=@planId AND s.SessionNumber=@number
          AND p.PractitionerEmpID=@doctor AND l.LegacyBranchId=@branchId;
      `);
    const session = row.recordset[0] as {
      ClientID: number; PractitionerEmpID: number; BookingID: number | null;
    } | undefined;
    if (!session) throw new TreatmentPlanConflict('NOT_FOUND', 'الجلسة مش موجودة للطبيب والفرع الحاليين.');
    if (Number(session.BookingID) === input.bookingId) {
      await tx.commit();
      return { bookingId: input.bookingId, reused: true };
    }
    if (session.BookingID != null) {
      // Do not silently replace previously attached visits, even if rescheduled/cancelled.
      throw new TreatmentPlanConflict('SESSION_OCCUPIED',
        'الجلسة مرتبطة بحجز بالفعل. تعديل الحجز يتم من Booking؛ إعادة الربط تحتاج مراجعة.');
    }

    const booking = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('branchId', sql.Int, input.branchId)
      .input('doctor', sql.Int, input.practitionerEmpId)
      .input('clientId', sql.Int, Number(session.ClientID))
      .input('bookingId', sql.Int, input.bookingId)
      .query(`
        SELECT TOP 1 b.BookingID, b.Status
        FROM dbo.Bookings b WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.TblClient c
          ON c.ClientID=b.ClientID AND c.TenantId=@tenantId
        JOIN dbo.TblEmp e
          ON e.EmpID=b.AssignedEmpID AND e.TenantId=@tenantId
        WHERE b.BookingID=@bookingId AND b.BranchID=@branchId
          AND b.ClientID=@clientId AND b.AssignedEmpID=@doctor;
      `);
    const target = booking.recordset[0] as { BookingID: number; Status: string } | undefined;
    if (!target || ['cancelled','canceled','no_show','rescheduled'].includes(
      String(target.Status || '').toLowerCase(),
    )) throw new TreatmentPlanConflict('BOOKING_MISMATCH',
      'الحجز غير صالح أو مش لنفس المريض والطبيب والفرع.');

    try {
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, input.tenantId)
        .input('planId', sql.UniqueIdentifier, input.planId)
        .input('number', sql.Int, input.sessionNumber)
        .input('bookingId', sql.Int, input.bookingId)
        .input('userId', sql.Int, input.userId)
        .query(`
          UPDATE dbo.ClinicTreatmentSession
          SET BookingID=@bookingId, LinkedByUserID=@userId, LinkedAt=SYSUTCDATETIME()
          WHERE TenantId=@tenantId AND PlanId=@planId
            AND SessionNumber=@number AND BookingID IS NULL;
        `);
    } catch (err) {
      const code = (err as { number?: number; originalError?: { info?: { number?: number } } }).number
        ?? (err as { originalError?: { info?: { number?: number } } }).originalError?.info?.number;
      if (code === 2601 || code === 2627)
        throw new TreatmentPlanConflict('BOOKING_ALREADY_LINKED',
          'الحجز مستخدم بالفعل في جلسة أخرى.');
      throw err;
    }
    await tx.commit();
    return { bookingId: input.bookingId, reused: false };
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}
