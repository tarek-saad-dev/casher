import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  isClinicArrivalAllowed,
  isClinicStartAllowed,
} from '../application/appointmentHandoffPolicy';
import type { ClinicVisitType } from '../public/types';

export type ClinicAppointmentRow = {
  BookingID: number;
  BookingDate: string | Date;
  StartTimeDisplay: string | null;
  Status: string;
  ClientID: number;
  PatientName: string;
  PractitionerEmpID: number;
  PractitionerName: string;
  EncounterId: string | null;
  EncounterStatus: string | null;
};

export class ClinicAppointmentConflict extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_STATE' | 'DOCTOR_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'ClinicAppointmentConflict';
  }
}

/** Reuse Bookings as the sole appointment source of truth; never copy booking rows. */
export async function listClinicAppointments(input: {
  tenantId: string;
  branchId: number;
  date: string;
}): Promise<ClinicAppointmentRow[]> {
  const pool = await getPool();
  const res = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('branchId', sql.Int, input.branchId)
    .input('day', sql.Date, input.date)
    .query(`
      SELECT
        b.BookingID, b.BookingDate,
        CONVERT(VARCHAR(5), TRY_CONVERT(TIME, b.StartTime), 108) AS StartTimeDisplay,
        b.Status, b.ClientID, c.Name AS PatientName,
        b.AssignedEmpID AS PractitionerEmpID, p.EmpName AS PractitionerName,
        visit.EncounterId, visit.Status AS EncounterStatus
      FROM dbo.Bookings b
      INNER JOIN dbo.TblClient c
        ON c.ClientID=b.ClientID AND c.TenantId=@tenantId
      INNER JOIN dbo.TblEmp p
        ON p.EmpID=b.AssignedEmpID AND p.TenantId=@tenantId
        AND p.Job IN (N'طبيب', N'Doctor', N'doctor')
      INNER JOIN dbo.ClinicPractitioner cp
        ON cp.TenantId=@tenantId AND cp.EmpID=p.EmpID AND cp.IsActive=1
      OUTER APPLY (
        SELECT TOP 1 ce.EncounterId, ce.Status
        FROM dbo.ClinicEncounter ce
        WHERE ce.TenantId=@tenantId
          AND ce.BookingRef=CONCAT(N'booking:', CONVERT(NVARCHAR(20), b.BookingID))
        ORDER BY ce.CreatedAt, ce.EncounterId
      ) visit
      WHERE b.BranchID=@branchId AND b.BookingDate=@day
      ORDER BY b.StartTime, b.BookingID;
    `);
  return res.recordset as ClinicAppointmentRow[];
}

export type ClinicAppointmentTransition = {
  bookingId: number;
  status: 'arrived' | 'in_service';
  encounterId?: string;
  reused?: boolean;
};

/**
 * Lock the canonical Booking row for the whole handoff transaction. This
 * serializes two simultaneous "start" requests even before a BookingRef index
 * exists; no new schema or competing Booking mutation path is introduced.
 */
export async function transitionClinicAppointment(input: {
  tenantId: string;
  branchId: number;
  locationId: string;
  bookingId: number;
  actorUserId: number;
  action: 'arrive' | 'start';
  visitType?: ClinicVisitType;
}): Promise<ClinicAppointmentTransition> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const bookingRes = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('branchId', sql.Int, input.branchId)
      .input('bookingId', sql.Int, input.bookingId)
      .query(`
        SELECT TOP 1 b.BookingID, b.ClientID, b.AssignedEmpID, b.Status,
               b.BookingDate
        FROM dbo.Bookings b WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.TblClient c
          ON c.ClientID=b.ClientID AND c.TenantId=@tenantId
        INNER JOIN dbo.TblEmp p
          ON p.EmpID=b.AssignedEmpID AND p.TenantId=@tenantId
          AND ISNULL(p.isActive, 1)=1
          AND p.Job IN (N'طبيب', N'Doctor', N'doctor')
        INNER JOIN dbo.ClinicPractitioner cp
          ON cp.TenantId=@tenantId AND cp.EmpID=p.EmpID AND cp.IsActive=1
        WHERE b.BookingID=@bookingId AND b.BranchID=@branchId;
      `);
    const booking = bookingRes.recordset[0] as {
      BookingID: number;
      ClientID: number;
      AssignedEmpID: number;
      Status: string;
    } | undefined;
    if (!booking) {
      throw new ClinicAppointmentConflict('NOT_FOUND', 'الحجز غير موجود في العيادة والفرع الحاليين.');
    }

    if (input.action === 'arrive') {
      if (booking.Status === 'arrived' || booking.Status === 'queued' || booking.Status === 'in_service') {
        await tx.commit();
        return { bookingId: input.bookingId, status: booking.Status === 'in_service' ? 'in_service' : 'arrived', reused: true };
      }
      if (!isClinicArrivalAllowed(booking.Status)) {
        throw new ClinicAppointmentConflict('INVALID_STATE', 'لا يمكن تسجيل حضور حجز ملغي أو منتهي.');
      }
      const arrived = await new sql.Request(tx)
        .input('bookingId', sql.Int, input.bookingId)
        .input('branchId', sql.Int, input.branchId)
        .query(`
          UPDATE dbo.Bookings SET Status=N'arrived', UpdatedAt=GETDATE()
          OUTPUT INSERTED.BookingID
          WHERE BookingID=@bookingId AND BranchID=@branchId
            AND Status IN (N'pending', N'confirmed');
        `);
      if (!arrived.recordset.length) {
        throw new ClinicAppointmentConflict('INVALID_STATE', 'حالة الحجز اتغيرت؛ حدّث المواعيد وجرب تاني.');
      }
      await tx.commit();
      return { bookingId: input.bookingId, status: 'arrived' };
    }

    const bookingRef = `booking:${input.bookingId}`;
    const linked = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('bookingRef', sql.NVarChar(128), bookingRef)
      .query(`
        SELECT TOP 1 EncounterId
        FROM dbo.ClinicEncounter
        WHERE TenantId=@tenantId AND BookingRef=@bookingRef
        ORDER BY CreatedAt, EncounterId;
      `);
    if (linked.recordset[0]) {
      await tx.commit();
      return {
        bookingId: input.bookingId,
        status: 'in_service',
        encounterId: String(linked.recordset[0].EncounterId),
        reused: true,
      };
    }
    if (!isClinicStartAllowed(booking.Status)) {
      throw new ClinicAppointmentConflict('INVALID_STATE', 'سجل حضور المريض الأول قبل بدء الكشف.');
    }

    const encounter = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('branchId', sql.Int, input.branchId)
      .input('bookingId', sql.Int, input.bookingId)
      .input('bookingRef', sql.NVarChar(128), bookingRef)
      .input('locationId', sql.UniqueIdentifier, input.locationId)
      .input('visitType', sql.NVarChar(20), input.visitType ?? 'new')
      .input('actorUserId', sql.Int, input.actorUserId)
      .query(`
        INSERT INTO dbo.ClinicEncounter (
          TenantId, ClientID, PractitionerEmpID, LocationId, BookingRef,
          VisitType, Status, StartedAt, CreatedByUserID
        )
        OUTPUT INSERTED.EncounterId
        SELECT
          @tenantId, b.ClientID, b.AssignedEmpID, @locationId, @bookingRef,
          @visitType, N'in_progress', SYSUTCDATETIME(), @actorUserId
        FROM dbo.Bookings b
        WHERE b.BookingID=@bookingId AND b.BranchID=@branchId
          AND b.Status IN (N'arrived', N'queued')
          AND EXISTS (
            SELECT 1 FROM dbo.TblEmpBranchAssignment a
            WHERE a.EmpID=b.AssignedEmpID AND a.BranchID=@branchId
              AND a.IsActive=1 AND a.CanReceiveBookings=1
              AND a.EffectiveFrom<=b.BookingDate
              AND (a.EffectiveTo IS NULL OR a.EffectiveTo>=b.BookingDate)
          );
      `);
    if (!encounter.recordset[0]) {
      throw new ClinicAppointmentConflict('DOCTOR_UNAVAILABLE', 'الطبيب غير مؤهل للكشف في الفرع أو موعد الحجز.');
    }
    const encounterId = String(encounter.recordset[0].EncounterId);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('encounterId', sql.NVarChar(128), encounterId)
      .input('actorUserId', sql.Int, input.actorUserId)
      .query(`
        INSERT INTO dbo.ClinicClinicalAudit
          (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
        VALUES (@tenantId, N'encounter', @encounterId,
                N'booking-started', @actorUserId, N'{}');
      `);
    const started = await new sql.Request(tx)
      .input('bookingId', sql.Int, input.bookingId)
      .input('branchId', sql.Int, input.branchId)
      .query(`
        UPDATE dbo.Bookings SET Status=N'in_service', UpdatedAt=GETDATE()
        OUTPUT INSERTED.BookingID
        WHERE BookingID=@bookingId AND BranchID=@branchId
          AND Status IN (N'arrived', N'queued');
      `);
    if (!started.recordset.length) {
      throw new ClinicAppointmentConflict('INVALID_STATE', 'حالة الحجز اتغيرت أثناء بدء الكشف.');
    }
    await tx.commit();
    return { bookingId: input.bookingId, status: 'in_service', encounterId };
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}
