import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  cairoTodayIso,
  maskClientFirstName,
  type MaskedPortalBooking,
  type PortalHandoffBadge,
} from '@/lib/employee-portal/bookingPrivacy';
import {
  ensureBookingCashierHandoffTable,
  mapPortalHandoffStatus,
} from '@/lib/booking/cashierHandoff';

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

function toHandoffBadge(status: string | null | undefined): PortalHandoffBadge {
  return mapPortalHandoffStatus(status);
}

export async function getMaskedTodayBookingsForEmployee(input: {
  empId: number;
  tenantId: string;
  now?: Date;
}): Promise<MaskedPortalBooking[]> {
  const today = cairoTodayIso(input.now);
  try {
    await ensureBookingCashierHandoffTable();
  } catch (err) {
    console.warn('[todayBookings] handoff table ensure skipped', err);
  }

  const pool = await getPool();
  const result = await pool
    .request()
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .input('date', sql.Date, today)
    .query(`
      SELECT
        b.BookingID,
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
        ) AS ServiceNamesRaw,
        (
          SELECT TOP 1 h.Status
          FROM dbo.TblBookingCashierHandoff h
          WHERE h.BookingID = b.BookingID
            AND h.Status IN (N'pending', N'loaded', N'charged')
          ORDER BY CASE h.Status
            WHEN N'charged' THEN 0
            WHEN N'loaded' THEN 1
            WHEN N'pending' THEN 2
            ELSE 3
          END, h.HandoffID DESC
        ) AS HandoffStatus
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
    BookingID: number;
    StartTime: unknown;
    EndTime: unknown;
    Status: string | null;
    ClientName: string | null;
    BranchName: string | null;
    ServiceNamesRaw: string | null;
    HandoffStatus: string | null;
  }>).map((row) => ({
    bookingId: Number(row.BookingID),
    startTime: formatSqlTime(row.StartTime),
    endTime: formatSqlTime(row.EndTime),
    status: String(row.Status ?? 'pending'),
    firstName: maskClientFirstName(row.ClientName),
    serviceNames: String(row.ServiceNamesRaw ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean),
    branchName: row.BranchName ? String(row.BranchName) : null,
    handoffStatus: toHandoffBadge(row.HandoffStatus),
  }));
}

export type MaskedPortalBookingDetail = MaskedPortalBooking & {
  services: Array<{
    proId: number;
    name: string;
    qty: number;
    source: 'booked';
  }>;
  canSend: boolean;
  readOnly: boolean;
};

export async function getMaskedBookingDetailForEmployee(input: {
  bookingId: number;
  empId: number;
  tenantId: string;
}): Promise<MaskedPortalBookingDetail | null> {
  try {
    await ensureBookingCashierHandoffTable();
  } catch (err) {
    console.warn('[todayBookings] handoff table ensure skipped', err);
  }

  const pool = await getPool();
  const bookingRes = await pool
    .request()
    .input('bookingId', sql.Int, input.bookingId)
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .query(`
      SELECT
        b.BookingID,
        b.StartTime,
        b.EndTime,
        b.Status,
        b.ConvertedInvID,
        c.[Name] AS ClientName,
        br.BranchName,
        (
          SELECT TOP 1 h.Status
          FROM dbo.TblBookingCashierHandoff h
          WHERE h.BookingID = b.BookingID
            AND h.Status IN (N'pending', N'loaded', N'charged')
          ORDER BY CASE h.Status
            WHEN N'charged' THEN 0
            WHEN N'loaded' THEN 1
            WHEN N'pending' THEN 2
            ELSE 3
          END, h.HandoffID DESC
        ) AS HandoffStatus
      FROM dbo.Bookings b
      INNER JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
      WHERE b.BookingID = @bookingId
        AND b.AssignedEmpID = @empId
        AND e.TenantId = @tenantId
        AND e.isActive = 1
    `);

  const row = bookingRes.recordset[0] as
    | {
        BookingID: number;
        StartTime: unknown;
        EndTime: unknown;
        Status: string | null;
        ConvertedInvID: number | null;
        ClientName: string | null;
        BranchName: string | null;
        HandoffStatus: string | null;
      }
    | undefined;
  if (!row) return null;

  const servicesRes = await pool
    .request()
    .input('bookingId', sql.Int, input.bookingId)
    .query(`
      SELECT bs.ProID, bs.Qty, p.ProName
      FROM dbo.BookingServices bs
      LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
      WHERE bs.BookingID = @bookingId
      ORDER BY bs.BookingServiceID
    `);

  const status = String(row.Status ?? 'pending').toLowerCase();
  const handoffStatus = toHandoffBadge(row.HandoffStatus);
  const readOnly =
    handoffStatus === 'charged' ||
    row.ConvertedInvID != null ||
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'no_show';
  const canSend = !readOnly;

  return {
    bookingId: Number(row.BookingID),
    startTime: formatSqlTime(row.StartTime),
    endTime: formatSqlTime(row.EndTime),
    status: String(row.Status ?? 'pending'),
    firstName: maskClientFirstName(row.ClientName),
    serviceNames: (servicesRes.recordset as Array<{ ProName: string | null }>).map(
      (s) => String(s.ProName ?? 'خدمة'),
    ),
    branchName: row.BranchName ? String(row.BranchName) : null,
    handoffStatus,
    services: (servicesRes.recordset as Array<{
      ProID: number;
      Qty: number | null;
      ProName: string | null;
    }>).map((s) => ({
      proId: Number(s.ProID),
      name: String(s.ProName ?? 'خدمة'),
      qty: Math.max(1, Number(s.Qty) || 1),
      source: 'booked' as const,
    })),
    canSend,
    readOnly,
  };
}

export async function listPortalServicesForEmployee(input: {
  tenantId: string;
  search?: string;
}): Promise<Array<{ proId: number; name: string; durationMinutes: number | null }>> {
  const pool = await getPool();
  const search = String(input.search ?? '').trim().slice(0, 80);
  const result = await pool
    .request()
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .input('search', sql.NVarChar(80), search ? `%${search}%` : null)
    .query(`
      SELECT TOP 80
        p.ProID,
        COALESCE(NULLIF(LTRIM(RTRIM(p.ProNameAr)), N''), p.ProName) AS DisplayName,
        p.DurationMinutes
      FROM dbo.TblPro p
      WHERE ISNULL(p.isDeleted, 0) = 0
        AND (
          p.TenantId = TRY_CONVERT(UNIQUEIDENTIFIER, @tenantId)
          OR CONVERT(NVARCHAR(100), p.TenantId) = @tenantId
        )
        AND (
          @search IS NULL
          OR p.ProName LIKE @search
          OR p.ProNameAr LIKE @search
        )
      ORDER BY DisplayName
    `);

  return (result.recordset as Array<{
    ProID: number;
    DisplayName: string | null;
    DurationMinutes: number | null;
  }>).map((row) => ({
    proId: Number(row.ProID),
    name: String(row.DisplayName ?? 'خدمة'),
    durationMinutes:
      row.DurationMinutes != null && Number.isFinite(Number(row.DurationMinutes))
        ? Number(row.DurationMinutes)
        : null,
  }));
}
