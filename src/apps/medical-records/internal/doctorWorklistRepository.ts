import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ClinicAppointmentRow } from './appointmentHandoffRepository';

/**
 * Doctor-only read adapter. Identity is resolved server-side from
 * ClinicPractitioner.UserID, never supplied by the request/query string.
 * Data comes from the canonical shared Booking rows.
 */
export async function listDoctorAppointments(input: {
  tenantId: string;
  branchId: number;
  userId: number;
  practitionerEmpId: number;
  date: string;
}): Promise<ClinicAppointmentRow[]> {
  const pool = await getPool();
  const result = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('branchId', sql.Int, input.branchId)
    .input('userId', sql.Int, input.userId)
    .input('empId', sql.Int, input.practitionerEmpId)
    .input('day', sql.Date, input.date)
    .query(`
      SELECT
        b.BookingID, b.BookingDate,
        CONVERT(VARCHAR(5), TRY_CONVERT(TIME, b.StartTime), 108) AS StartTimeDisplay,
        b.Status, b.ClientID, c.Name AS PatientName,
        b.AssignedEmpID AS PractitionerEmpID, e.EmpName AS PractitionerName,
        visit.EncounterId, visit.Status AS EncounterStatus
      FROM dbo.Bookings b
      INNER JOIN dbo.TblClient c
        ON c.ClientID=b.ClientID AND c.TenantId=@tenantId
      INNER JOIN dbo.TblEmp e
        ON e.EmpID=b.AssignedEmpID AND e.TenantId=@tenantId
        AND ISNULL(e.isActive,1)=1
        AND e.Job IN (N'طبيب', N'Doctor', N'doctor')
      INNER JOIN dbo.ClinicPractitioner cp
        ON cp.TenantId=@tenantId AND cp.EmpID=e.EmpID
        AND cp.IsActive=1 AND cp.UserID=@userId
      OUTER APPLY (
        SELECT TOP 1 ce.EncounterId, ce.Status
        FROM dbo.ClinicEncounter ce
        WHERE ce.TenantId=@tenantId AND ce.PractitionerEmpID=@empId
          AND ce.BookingRef=CONCAT(N'booking:', CONVERT(NVARCHAR(20), b.BookingID))
        ORDER BY ce.CreatedAt, ce.EncounterId
      ) visit
      WHERE b.BranchID=@branchId
        AND b.BookingDate=@day
        AND b.AssignedEmpID=@empId
      ORDER BY b.StartTime, b.BookingID;
    `);
  return result.recordset as ClinicAppointmentRow[];
}
