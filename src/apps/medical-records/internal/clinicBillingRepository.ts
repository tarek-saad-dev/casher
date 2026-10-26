import 'server-only';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  ClinicBillingConflict, matchesClinicBookedServices, type ClinicBillingItem,
} from '../application/clinicBillingPolicy';

export type ClinicBillableService = {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  Bonus: number;
};

export type ClinicBillingPreview = {
  encounterId: string;
  bookingId: number | null;
  clientId: number;
  patientName: string;
  patientMobile: string | null;
  practitionerEmpId: number;
  practitionerName: string;
  status: 'in_progress' | 'completed' | 'cancelled' | 'scheduled';
  invoiceId: number | null;
  billingState: 'ready' | 'not_ready' | 'already_billed';
  services: ClinicBillableService[];
};

/** Administrative (non-clinical) billable metadata for a single branch-owned visit. */
export async function getClinicBillingPreview(input: {
  tenantId: string; branchId: number; encounterId: string;
}): Promise<ClinicBillingPreview | null> {
  const pool = await getPool();
  const res = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('branchId', sql.Int, input.branchId)
    .input('encounterId', sql.UniqueIdentifier, input.encounterId)
    .query(`
      SELECT TOP 1
        e.EncounterId, e.ClientID, e.PractitionerEmpID, e.Status,
        c.Name AS PatientName, c.Mobile AS PatientMobile,
        p.EmpName AS PractitionerName,
        b.BookingID, l.InvID
      FROM dbo.ClinicEncounter e
      JOIN dbo.TblClient c
        ON c.TenantId=e.TenantId AND c.ClientID=e.ClientID
      JOIN dbo.TblEmp p
        ON p.TenantId=e.TenantId AND p.EmpID=e.PractitionerEmpID
      LEFT JOIN dbo.Bookings b
        ON e.BookingRef=CONCAT(N'booking:', CONVERT(NVARCHAR(20), b.BookingID))
        AND b.BranchID=@branchId AND b.ClientID=e.ClientID
        AND b.AssignedEmpID=e.PractitionerEmpID
      LEFT JOIN dbo.ClinicEncounterBillingLink l
        ON l.TenantId=e.TenantId AND l.EncounterId=e.EncounterId
      JOIN dbo.Location location
        ON location.TenantId=e.TenantId AND location.LocationId=e.LocationId
      WHERE e.TenantId=@tenantId AND e.EncounterId=@encounterId
        AND location.LegacyBranchID=@branchId;
    `);
  const r = res.recordset[0] as {
    ClientID: number; PatientName: string; PatientMobile: string | null;
    PractitionerEmpID: number; PractitionerName: string; Status: ClinicBillingPreview['status'];
    BookingID: number | null; InvID: number | null;
  } | undefined;
  if (!r) return null;
  let services: ClinicBillableService[] = [];
  if (r.BookingID != null) {
    const rows = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('bookingId', sql.Int, r.BookingID)
      .query(`
        SELECT DISTINCT p.ProID, p.ProName, p.ProNameAr,
          p.SPrice1, ISNULL(p.Bonus,0) AS Bonus
        FROM dbo.BookingServices bs
        JOIN dbo.TblPro p ON p.ProID=bs.ProID AND p.TenantId=@tenantId
        WHERE bs.BookingID=@bookingId AND ISNULL(p.isDeleted,0)=0
          AND p.SPrice1 > 0
        ORDER BY p.ProID;
      `);
    services = (rows.recordset as ClinicBillableService[]).map(s => ({
      ...s, SPrice1: Number(s.SPrice1), Bonus: Number(s.Bonus),
    }));
  }
  return {
    encounterId: input.encounterId,
    bookingId: r.BookingID == null ? null : Number(r.BookingID),
    clientId: Number(r.ClientID),
    patientName: r.PatientName,
    patientMobile: r.PatientMobile,
    practitionerEmpId: Number(r.PractitionerEmpID),
    practitionerName: r.PractitionerName,
    status: r.Status,
    invoiceId: r.InvID == null ? null : Number(r.InvID),
    billingState: r.InvID != null ? 'already_billed'
      : r.Status === 'completed' && services.length ? 'ready' : 'not_ready',
    services,
  };
}

/**
 * Called INSIDE the Shared POS sale transaction, in both legacy/modern adapters.
 * All sale/payment/stock writes rollback if the single-use encounter link fails.
 */
export async function linkClinicSaleWithinTransaction(
  tx: Transaction,
  input: {
    tenantId: string;
    encounterId: string;
    branchId: number;
    invId: number;
    clientId: number | null;
    userId: number;
    items: ClinicBillingItem[];
  },
): Promise<void> {
  const base = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('encounterId', sql.UniqueIdentifier, input.encounterId)
    .input('branchId', sql.Int, input.branchId)
    .query(`
      SELECT TOP 1 e.ClientID, e.PractitionerEmpID, e.Status, b.BookingID
      FROM dbo.ClinicEncounter e WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.Bookings b
        ON e.BookingRef=CONCAT(N'booking:', CONVERT(NVARCHAR(20), b.BookingID))
        AND b.BranchID=@branchId AND b.ClientID=e.ClientID
        AND b.AssignedEmpID=e.PractitionerEmpID
      JOIN dbo.Location location
        ON location.TenantId=e.TenantId AND location.LocationId=e.LocationId
      WHERE e.TenantId=@tenantId AND e.EncounterId=@encounterId
        AND location.LegacyBranchID=@branchId;
    `);
  const row = base.recordset[0] as {
    ClientID: number; PractitionerEmpID: number; Status: string; BookingID: number;
  } | undefined;
  if (!row || row.Status !== 'completed' || input.clientId !== Number(row.ClientID)) {
    throw new ClinicBillingConflict('NOT_READY', 'الكشف غير مكتمل أو المريض/الفرع لا يطابق الحجز.');
  }

  const booked = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('bookingId', sql.Int, row.BookingID)
    .query(`
      SELECT DISTINCT p.ProID, p.SPrice1
      FROM dbo.BookingServices bs
      JOIN dbo.TblPro p ON p.ProID=bs.ProID AND p.TenantId=@tenantId
      WHERE bs.BookingID=@bookingId AND ISNULL(p.isDeleted,0)=0 AND p.SPrice1>0;
    `);
  if (!matchesClinicBookedServices(input.items, booked.recordset, Number(row.PractitionerEmpID))) {
    throw new ClinicBillingConflict(
      'INVALID_ITEMS',
      'الفاتورة لازم تحتوي الخدمات المحجوزة فقط وباسم الدكتور المسؤول. حدّث الحجز لو الخدمات اتغيّرت.',
    );
  }

  try {
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('encounterId', sql.UniqueIdentifier, input.encounterId)
      .input('branchId', sql.Int, input.branchId)
      .input('invID', sql.Int, input.invId)
      .input('userID', sql.Int, input.userId)
      .query(`
        INSERT INTO dbo.ClinicEncounterBillingLink
          (TenantId, EncounterId, BranchID, InvID, InvType, CreatedByUserID)
        VALUES
          (@tenantId, @encounterId, @branchId, @invID, N'مبيعات', @userID);
      `);
  } catch (err) {
    const code = (err as { number?: number; originalError?: { info?: { number?: number } } }).number
      ?? (err as { originalError?: { info?: { number?: number } } }).originalError?.info?.number;
    if (code === 2601 || code === 2627) {
      throw new ClinicBillingConflict('ALREADY_BILLED', 'تم تسجيل فاتورة لهذا الكشف بالفعل. راجع الفاتورة الموجودة.');
    }
    if (code === 208) {
      throw new ClinicBillingConflict('MIGRATION_REQUIRED', 'ربط الفواتير يحتاج تشغيل Migration 015 أولًا.');
    }
    throw err;
  }
}
