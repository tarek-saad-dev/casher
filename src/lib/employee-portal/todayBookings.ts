import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  cairoTodayIso,
  maskClientFirstName,
  type MaskedPortalBooking,
} from '@/lib/employee-portal/bookingPrivacy';

export type { MaskedPortalBooking };
export { cairoTodayIso, maskClientFirstName };

function formatSqlTime(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const raw = String(value);
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return raw.slice(0, 5);
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

export async function getMaskedTodayBookingsForEmployee(input: {
  empId: number;
  tenantId: string;
  now?: Date;
}): Promise<MaskedPortalBooking[]> {
  const today = cairoTodayIso(input.now);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .input('date', sql.Date, today)
    .query(`
      SELECT
        b.StartTime,
        b.EndTime,
        b.Status,
        c.[Name] AS ClientName,
        br.BranchName,
        (
          SELECT STRING_AGG(p.ProName, N'|')
          FROM dbo.BookingServices bs
          LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
          WHERE bs.BookingID = b.BookingID
        ) AS ServiceNamesRaw
      FROM dbo.Bookings b
      INNER JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
      WHERE b.AssignedEmpID = @empId
        AND e.TenantId = @tenantId
        AND e.isActive = 1
        AND b.BookingDate = @date
      ORDER BY b.StartTime ASC
    `);

  return (result.recordset as Array<{
    StartTime: unknown;
    EndTime: unknown;
    Status: string | null;
    ClientName: string | null;
    BranchName: string | null;
    ServiceNamesRaw: string | null;
  }>).map((row) => ({
    startTime: formatSqlTime(row.StartTime),
    endTime: formatSqlTime(row.EndTime),
    status: String(row.Status ?? 'pending'),
    firstName: maskClientFirstName(row.ClientName),
    serviceNames: String(row.ServiceNamesRaw ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean),
    branchName: row.BranchName ? String(row.BranchName) : null,
  }));
}
