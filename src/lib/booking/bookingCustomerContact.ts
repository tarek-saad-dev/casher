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

/** Internal shared reader. Tenant-scoped worker calls require an active Location at SQL read time. */
async function readBookingCustomerContact(
  bookingId: number,
  tenantId: string | null,
): Promise<BookingCustomerContact | null> {
  // A foreign BookingID must not cause even a customer name/phone to be read by a
  // worker. The JOIN happens before projecting PII or trying a secondary phone query.
  const db = await getPool();
  const request = db.request().input('id', sql.Int, bookingId);
  if (tenantId !== null) request.input('tenantId', sql.UniqueIdentifier, tenantId);
  const tenantJoin = tenantId === null ? '' : `
      INNER JOIN dbo.Location scopeLocation
        ON scopeLocation.LegacyBranchId = b.BranchID
       AND scopeLocation.TenantId = @tenantId
       AND scopeLocation.Status = N'active'
      INNER JOIN dbo.Tenant scopeTenant
        ON scopeTenant.TenantId = scopeLocation.TenantId
       AND scopeTenant.Status = N'active'`;
  // DRVO-015 establishes TenantId on legacy master records. A BookingId/ClientId/EmpId
  // is NOT authorization to join a different tenant's customer, barber or offering.
  const clientScope = tenantId === null ? '' : ' AND c.TenantId = @tenantId';
  const employeeScope = tenantId === null ? '' : ' AND e.TenantId = @tenantId';
  const productScope = tenantId === null ? '' : ' AND p.TenantId = @tenantId';
  const r = await request.query(`
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
          LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID${productScope}
          WHERE bs.BookingID = b.BookingID
        ) AS ServicesSummary
      FROM dbo.Bookings b
      ${tenantJoin}
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID${clientScope}
      LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID${employeeScope}
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
        // The optional legacy Phone column is a second PII read: scope it too.
        const phoneReq = db.request().input('cid', sql.Int, Number(row.ClientID));
        if (tenantId !== null) phoneReq.input('tenantId', sql.UniqueIdentifier, tenantId);
        const pr = await phoneReq.query(
          `SELECT Phone FROM dbo.TblClient WHERE ClientID = @cid${tenantId === null ? '' : ' AND TenantId = @tenantId'}`,
        );
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

/** Legacy callers without authoritative tenant still use their existing adapter. */
export async function loadBookingCustomerContact(
  bookingId: number,
): Promise<BookingCustomerContact | null> {
  return readBookingCustomerContact(bookingId, null);
}

/**
 * Tenant-owned outbox/worker path. No booking or customer data is selected until
 * a verified active Location maps the Booking BranchID to the claimed TenantId.
 * Reject a missing/invalid tenant before SQL; never default to CASHER_BOOT.
 */
export async function loadBookingCustomerContactForTenant(
  bookingId: number,
  tenantId: string,
): Promise<BookingCustomerContact | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId ?? '')) {
    throw new Error('BOOKING_CONTACT_TENANT_REQUIRED');
  }
  return readBookingCustomerContact(bookingId, tenantId.toLowerCase());
}
