/**
 * Authoritative customer contact loader for booking WhatsApp / ops display.
 * Never trust frontend-supplied phones for outbound messages.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  isUsableCustomerPhone,
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';

export type BookingCustomerContact = {
  bookingId: number;
  bookingCode: string | null;
  clientId: number | null;
  customerName: string | null;
  /** Normalized usable phone or null */
  phone: string | null;
  phoneSource: 'client_mobile' | 'client_phone' | 'booking_guest' | 'none';
  branchId: number | null;
  branchName: string | null;
  empId: number | null;
  empName: string | null;
  bookingDate: string | null;
  startTime: string | null;
  servicesSummary: string | null;
};

export async function loadBookingCustomerContact(
  bookingId: number,
): Promise<BookingCustomerContact | null> {
  const db = await getPool();
  const r = await db
    .request()
    .input('id', sql.Int, bookingId)
    .query(`
      SELECT
        b.BookingID, b.BookingCode, b.ClientID, b.AssignedEmpID, b.BranchID,
        CONVERT(varchar(10), b.BookingDate, 23) AS BookingDate,
        CONVERT(varchar(5), b.StartTime, 108) AS StartTime,
        c.[Name] AS ClientName,
        c.Mobile AS ClientMobile,
        e.EmpName,
        br.BranchName,
        (
          SELECT STRING_AGG(p.ProName, N'، ')
          FROM dbo.BookingServices bs
          LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
          WHERE bs.BookingID = b.BookingID
        ) AS ServicesSummary
      FROM dbo.Bookings b
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
      WHERE b.BookingID = @id
    `);

  const row = r.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  let clientPhone: string | null = null;
  if (row.ClientID != null) {
    try {
      const phoneCol = await db.request().query(`
        SELECT COL_LENGTH(N'dbo.TblClient', N'Phone') AS Len
      `);
      if (Number(phoneCol.recordset[0]?.Len ?? 0) > 0) {
        const pr = await db
          .request()
          .input('cid', sql.Int, Number(row.ClientID))
          .query(`SELECT Phone FROM dbo.TblClient WHERE ClientID = @cid`);
        clientPhone =
          pr.recordset[0]?.Phone != null ? String(pr.recordset[0].Phone) : null;
      }
    } catch {
      clientPhone = null;
    }
  }

  const mobile = normalizePublicBookingPhone(String(row.ClientMobile ?? ''));
  const phoneCol = normalizePublicBookingPhone(String(clientPhone ?? ''));

  let phone: string | null = null;
  let phoneSource: BookingCustomerContact['phoneSource'] = 'none';
  if (isUsableCustomerPhone(mobile)) {
    phone = mobile;
    phoneSource = 'client_mobile';
  } else if (isUsableCustomerPhone(phoneCol)) {
    phone = phoneCol;
    phoneSource = 'client_phone';
  }

  return {
    bookingId: Number(row.BookingID),
    bookingCode: row.BookingCode != null ? String(row.BookingCode) : null,
    clientId: row.ClientID != null ? Number(row.ClientID) : null,
    customerName: row.ClientName != null ? String(row.ClientName) : null,
    phone,
    phoneSource,
    branchId: row.BranchID != null ? Number(row.BranchID) : null,
    branchName: row.BranchName != null ? String(row.BranchName) : null,
    empId: row.AssignedEmpID != null ? Number(row.AssignedEmpID) : null,
    empName: row.EmpName != null ? String(row.EmpName) : null,
    bookingDate: row.BookingDate != null ? String(row.BookingDate).slice(0, 10) : null,
    startTime: row.StartTime != null ? String(row.StartTime).slice(0, 5) : null,
    servicesSummary: row.ServicesSummary != null ? String(row.ServicesSummary) : null,
  };
}
