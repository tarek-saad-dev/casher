import 'server-only';
import { getPool, sql } from '@/lib/db';

export type StaffBookingPhase = 'scheduled' | 'arrived' | 'in_service' | 'finished';
export type StaffBookingAction = 'arrive' | 'start' | 'finish';

export const STAFF_BOOKING_TRANSITIONS: Record<StaffBookingAction, {
  previous: StaffBookingPhase;
  next: StaffBookingPhase;
}> = {
  arrive: { previous: 'scheduled', next: 'arrived' },
  start: { previous: 'arrived', next: 'in_service' },
  finish: { previous: 'in_service', next: 'finished' },
};

export async function ensureStaffBookingLifecycleTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(
    "IF OBJECT_ID(N'dbo.TblBookingStaffLifecycle', N'U') IS NULL BEGIN " +
    "CREATE TABLE dbo.TblBookingStaffLifecycle (" +
    "BookingID INT NOT NULL PRIMARY KEY, " +
    "EmpID INT NOT NULL, TenantId NVARCHAR(100) NOT NULL, " +
    "Phase NVARCHAR(20) NOT NULL, " +
    "ArrivedAt DATETIME2 NULL, StartedAt DATETIME2 NULL, FinishedAt DATETIME2 NULL, " +
    "UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), " +
    "CONSTRAINT CK_TblBookingStaffLifecycle_Phase CHECK (Phase IN (N'arrived',N'in_service',N'finished'))" +
    "); CREATE INDEX IX_TblBookingStaffLifecycle_EmpTenant ON " +
    "dbo.TblBookingStaffLifecycle (TenantId, EmpID, Phase); END"
  );
}

export type StaffPhaseChange =
  | { ok: true; phase: StaffBookingPhase; alreadyApplied: boolean }
  | { ok: false; status: 404 | 409 | 503; error: string };

export async function advanceStaffBookingPhase(input: {
  bookingId: number;
  empId: number;
  tenantId: string;
  action: StaffBookingAction;
}): Promise<StaffPhaseChange> {
  const transition = STAFF_BOOKING_TRANSITIONS[input.action];
  if (!transition) return { ok: false, status: 409, error: 'حالة خدمة غير صالحة' };
  try {
    await ensureStaffBookingLifecycleTable();
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const found = await new sql.Request(tx)
        .input('bookingId', sql.Int, input.bookingId)
        .input('empId', sql.Int, input.empId)
        .input('tenantId', sql.NVarChar(100), input.tenantId)
        .query(
          "SELECT b.BookingID, b.Status, b.ConvertedInvID, " +
          "ISNULL(l.Phase, N'scheduled') AS Phase, h.HandoffID " +
          "FROM dbo.Bookings b WITH (UPDLOCK, HOLDLOCK) " +
          "INNER JOIN dbo.TblEmp e ON e.EmpID=b.AssignedEmpID " +
          "LEFT JOIN dbo.TblBookingStaffLifecycle l WITH (UPDLOCK, HOLDLOCK) ON l.BookingID=b.BookingID " +
          "OUTER APPLY (SELECT TOP 1 HandoffID FROM dbo.TblBookingCashierHandoff " +
          "WHERE BookingID=b.BookingID AND Status IN (N'pending',N'loaded',N'charged') " +
          "ORDER BY HandoffID DESC) h " +
          "WHERE b.BookingID=@bookingId AND b.AssignedEmpID=@empId " +
          "AND e.EmpID=@empId AND e.TenantId=@tenantId AND e.isActive=1"
        );
      const row = found.recordset[0] as
        | { BookingID: number; Status: string | null; ConvertedInvID: number | null;
            Phase: StaffBookingPhase; HandoffID: number | null }
        | undefined;
      if (!row) {
        await tx.rollback();
        return { ok: false, status: 404, error: 'الحجز غير موجود أو مش تابع لك' };
      }
      if (row.Phase === transition.next) {
        await tx.rollback();
        return { ok: true, phase: transition.next, alreadyApplied: true };
      }
      const status = String(row.Status ?? '').toLowerCase();
      if (row.ConvertedInvID != null ||
          ['cancelled', 'no_show', 'completed'].includes(status) ||
          row.HandoffID != null) {
        await tx.rollback();
        return { ok: false, status: 409, error: 'الحجز اتقفل أو اتبعت للكاشير بالفعل' };
      }
      if (row.Phase !== transition.previous) {
        await tx.rollback();
        return { ok: false, status: 409, error: 'لازم تكمل خطوات استلام وبدء وإنهاء الخدمة بالترتيب' };
      }
      if (input.action === 'arrive') {
        await new sql.Request(tx)
          .input('bookingId', sql.Int, input.bookingId)
          .input('empId', sql.Int, input.empId)
          .input('tenantId', sql.NVarChar(100), input.tenantId)
          .query(
            "INSERT INTO dbo.TblBookingStaffLifecycle " +
            "(BookingID, EmpID, TenantId, Phase, ArrivedAt) " +
            "VALUES (@bookingId,@empId,@tenantId,N'arrived',SYSUTCDATETIME())"
          );
      } else {
        const timestampField = input.action === 'start' ? 'StartedAt' : 'FinishedAt';
        const changed = await new sql.Request(tx)
          .input('bookingId', sql.Int, input.bookingId)
          .input('empId', sql.Int, input.empId)
          .input('tenantId', sql.NVarChar(100), input.tenantId)
          .input('previous', sql.NVarChar(20), transition.previous)
          .input('next', sql.NVarChar(20), transition.next)
          .query(
            "UPDATE dbo.TblBookingStaffLifecycle SET Phase=@next, " +
            timestampField + "=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME() " +
            "WHERE BookingID=@bookingId AND EmpID=@empId AND TenantId=@tenantId AND Phase=@previous"
          );
        if (changed.rowsAffected[0] !== 1) throw new Error('Lifecycle compare-and-set failed');
      }
      await tx.commit();
      return { ok: true, phase: transition.next, alreadyApplied: false };
    } catch (error) {
      try { await tx.rollback(); } catch { /* already rolled back */ }
      throw error;
    }
  } catch (error) {
    console.error('[booking-lifecycle]', error instanceof Error ? error.message : error);
    return { ok: false, status: 503, error: 'تعذر تحديث حالة الخدمة، حاول مرة تانية' };
  }
}
