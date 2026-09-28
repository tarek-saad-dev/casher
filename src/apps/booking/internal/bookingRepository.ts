import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';

export type BookingRecord = {
  bookingId: number;
  bookingCode: string | null;
  clientId: number | null;
  assignedEmpId: number | null;
  branchId: number;
  bookingDate: string;
  status: string;
  convertedInvId: number | null;
  convertedInvType: string | null;
};

export type BookingServiceLine = {
  proId: number;
  empId: number | null;
  price: number;
  qty: number;
  reservationDate: string;
};

export function sqlDateToYmd(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : String(value).slice(0, 10);
}

export async function loadBookingForConversion(
  tx: Transaction,
  bookingId: number,
): Promise<{ booking: BookingRecord; services: BookingServiceLine[] } | null> {
  const bkRes = await new sql.Request(tx)
    .input('id', sql.Int, bookingId)
    .query(`
      SELECT
        BookingID, BookingCode, ClientID, AssignedEmpID, BranchID,
        BookingDate, Status, ConvertedInvID, ConvertedInvType
      FROM [dbo].[Bookings] WITH (UPDLOCK, HOLDLOCK)
      WHERE BookingID = @id
    `);
  if (!bkRes.recordset.length) return null;

  const row = bkRes.recordset[0];
  const svcRes = await new sql.Request(tx)
    .input('id', sql.Int, bookingId)
    .query(`
      SELECT ProID, EmpID, Price, Qty
      FROM [dbo].[BookingServices]
      WHERE BookingID = @id
    `);

  return {
    booking: {
      bookingId: Number(row.BookingID),
      bookingCode: row.BookingCode != null ? String(row.BookingCode) : null,
      clientId: row.ClientID != null ? Number(row.ClientID) : null,
      assignedEmpId: row.AssignedEmpID != null ? Number(row.AssignedEmpID) : null,
      branchId: Number(row.BranchID),
      bookingDate: sqlDateToYmd(row.BookingDate),
      status: String(row.Status),
      convertedInvId: row.ConvertedInvID != null ? Number(row.ConvertedInvID) : null,
      convertedInvType: row.ConvertedInvType != null ? String(row.ConvertedInvType) : null,
    },
    services: svcRes.recordset.map((svc: Record<string, unknown>) => ({
      proId: Number(svc.ProID),
      empId: svc.EmpID != null ? Number(svc.EmpID) : null,
      price: Number(svc.Price ?? 0),
      qty: Number(svc.Qty ?? 1),
      reservationDate: sqlDateToYmd(row.BookingDate),
    })),
  };
}

export async function markBookingConverted(
  tx: Transaction,
  input: {
    bookingId: number;
    legacyInvId: number;
    legacyInvType: string;
  },
): Promise<void> {
  await new sql.Request(tx)
    .input('id', sql.Int, input.bookingId)
    .input('convInvID', sql.Int, input.legacyInvId)
    .input('convInvType', sql.NVarChar, input.legacyInvType)
    .query(`
      UPDATE [dbo].[Bookings]
      SET Status = N'completed',
          ConvertedInvID = @convInvID,
          ConvertedInvType = @convInvType,
          UpdatedAt = GETDATE()
      WHERE BookingID = @id
    `);
}
