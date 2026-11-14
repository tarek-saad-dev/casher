import 'server-only';
import { getPool, sql } from '@/lib/db';
import { matchesPaidHandoffLines } from '@/lib/booking/cashierHandoffReconciliationPolicy';
import {
  normalizeHandoffServices,
  parseHandoffPayload,
  serializeHandoffPayload,
  type HandoffServiceLine,
} from '@/lib/booking/cashierHandoffShared';

export type {
  HandoffPayload,
  HandoffServiceLine,
  HandoffServiceSource,
  HandoffStatus,
  PortalHandoffStatus,
} from '@/lib/booking/cashierHandoffShared';

export {
  mapPortalHandoffStatus,
  normalizeHandoffServices,
  parseHandoffPayload,
  serializeHandoffPayload,
} from '@/lib/booking/cashierHandoffShared';

const LOCK_TTL_MS = 5 * 60 * 1000;

export async function ensureBookingCashierHandoffTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.TblBookingCashierHandoff', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBookingCashierHandoff (
        HandoffID INT IDENTITY(1, 1) NOT NULL,
        BookingID INT NOT NULL,
        BranchID INT NOT NULL,
        EmpID INT NOT NULL,
        TenantId NVARCHAR(100) NOT NULL,
        Status NVARCHAR(20) NOT NULL
          CONSTRAINT DF_TblBookingCashierHandoff_Status DEFAULT N'pending',
        PayloadJson NVARCHAR(MAX) NOT NULL,
        LockedByUserID INT NULL,
        LockedAt DATETIME2 NULL,
        ChargedInvID INT NULL,
        ChargedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL
          CONSTRAINT DF_TblBookingCashierHandoff_Created DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
          CONSTRAINT DF_TblBookingCashierHandoff_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TblBookingCashierHandoff PRIMARY KEY (HandoffID),
        CONSTRAINT CK_TblBookingCashierHandoff_Status CHECK (
          Status IN (N'pending', N'loaded', N'charged', N'cancelled', N'superseded')
        ),
        CONSTRAINT CK_TblBookingCashierHandoff_PayloadJson CHECK (ISJSON(PayloadJson) = 1),
        CONSTRAINT CK_TblBookingCashierHandoff_Charged CHECK (
          (Status = N'charged' AND ChargedInvID IS NOT NULL AND ChargedAt IS NOT NULL)
          OR (Status <> N'charged' AND ChargedInvID IS NULL AND ChargedAt IS NULL)
        )
      );
      CREATE UNIQUE INDEX UX_TblBookingCashierHandoff_ActiveBooking
        ON dbo.TblBookingCashierHandoff (BookingID)
        WHERE Status IN (N'pending', N'loaded');
      CREATE INDEX IX_TblBookingCashierHandoff_BranchInbox
        ON dbo.TblBookingCashierHandoff (BranchID, Status, UpdatedAt DESC);
      CREATE INDEX IX_TblBookingCashierHandoff_TenantEmp
        ON dbo.TblBookingCashierHandoff (TenantId, EmpID, Status);
    END
  `);
}

export type UpsertHandoffResult =
  | { ok: true; handoffId: number; updated: boolean }
  | { ok: false; error: 'not_found' | 'forbidden' | 'not_sendable' | 'already_charged' | 'empty_services' | 'services_not_reserved' | 'pending_transfer' };

export async function upsertEmployeeHandoff(input: {
  bookingId: number;
  empId: number;
  tenantId: string;
  services: HandoffServiceLine[];
}): Promise<UpsertHandoffResult> {
  const services = normalizeHandoffServices(input.services);
  if (services.length === 0) return { ok: false, error: 'empty_services' };

  await ensureBookingCashierHandoffTable();
  const pool = await getPool();
  const bookingRes = await pool
    .request()
    .input('bookingId', sql.Int, input.bookingId)
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .query(`
      SELECT b.BookingID, b.BranchID, b.AssignedEmpID, b.Status, b.ConvertedInvID
      FROM dbo.Bookings b
      INNER JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      WHERE b.BookingID = @bookingId
        AND b.AssignedEmpID = @empId
        AND e.EmpID = @empId
        AND e.TenantId = @tenantId
        AND e.isActive = 1
    `);

  const booking = bookingRes.recordset[0] as
    | {
        BookingID: number;
        BranchID: number;
        AssignedEmpID: number;
        Status: string | null;
        ConvertedInvID: number | null;
      }
    | undefined;

  if (!booking) return { ok: false, error: 'not_found' };
  if (booking.AssignedEmpID !== input.empId) return { ok: false, error: 'forbidden' };

  const status = String(booking.Status ?? '').toLowerCase();
  if (status === 'cancelled' || status === 'no_show') {
    return { ok: false, error: 'not_sendable' };
  }
  if (booking.ConvertedInvID != null || status === 'completed') {
    // still allow if no charged handoff yet? Plan: charged = done. completed booking = read-only.
    const charged = await pool
      .request()
      .input('bookingId', sql.Int, input.bookingId)
      .query(`
        SELECT TOP 1 HandoffID FROM dbo.TblBookingCashierHandoff
        WHERE BookingID = @bookingId AND Status = N'charged'
      `);
    if (charged.recordset[0] || booking.ConvertedInvID != null) {
      return { ok: false, error: 'already_charged' };
    }
  }

  // Do not send an incomplete service package to POS while cashier is
  // deciding who will perform a requested extra service.
  const pendingTransfer = await pool.request()
    .input('bookingId', sql.Int, input.bookingId)
    .query(
      "IF OBJECT_ID(N'dbo.TblBookingAddonTransferRequest',N'U') IS NOT NULL " +
      "SELECT TOP 1 RequestID FROM dbo.TblBookingAddonTransferRequest " +
      "WHERE BookingID=@bookingId AND Status=N'pending'"
    );
  if (pendingTransfer.recordset?.length) {
    return { ok: false, error: 'pending_transfer' };
  }

  // A cashier handoff may only contain services already reserved by booking.
  // Previously the client could append arbitrary extras without a schedule check.
  const reserved = await pool.request()
    .input('bookingId', sql.Int, input.bookingId)
    .query(
      "SELECT ProID, SUM(ISNULL(Qty,1)) AS Qty " +
      "FROM dbo.BookingServices WHERE BookingID=@bookingId GROUP BY ProID"
    );
  const allowedQty = new Map<number, number>();
  for (const row of reserved.recordset as Array<{ProID:number;Qty:number}>) {
    allowedQty.set(Number(row.ProID), Number(row.Qty));
  }
  if (services.some(line => line.qty > (allowedQty.get(line.proId) ?? 0))) {
    return { ok: false, error: 'services_not_reserved' };
  }

  const payloadJson = serializeHandoffPayload({ services });
  const existing = await pool
    .request()
    .input('bookingId', sql.Int, input.bookingId)
    .query(`
      SELECT TOP 1 HandoffID, Status
      FROM dbo.TblBookingCashierHandoff
      WHERE BookingID = @bookingId AND Status IN (N'pending', N'loaded')
      ORDER BY HandoffID DESC
    `);

  const row = existing.recordset[0] as { HandoffID: number; Status: string } | undefined;
  if (row) {
    await pool
      .request()
      .input('handoffId', sql.Int, row.HandoffID)
      .input('payload', sql.NVarChar(sql.MAX), payloadJson)
      .query(`
        UPDATE dbo.TblBookingCashierHandoff
        SET PayloadJson = @payload,
            Status = N'pending',
            LockedByUserID = NULL,
            LockedAt = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HandoffID = @handoffId
          AND Status IN (N'pending', N'loaded')
      `);
    return { ok: true, handoffId: row.HandoffID, updated: true };
  }

  const inserted = await pool
    .request()
    .input('bookingId', sql.Int, input.bookingId)
    .input('branchId', sql.Int, booking.BranchID)
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .input('payload', sql.NVarChar(sql.MAX), payloadJson)
    .query(`
      INSERT INTO dbo.TblBookingCashierHandoff
        (BookingID, BranchID, EmpID, TenantId, Status, PayloadJson)
      OUTPUT INSERTED.HandoffID
      VALUES (@bookingId, @branchId, @empId, @tenantId, N'pending', @payload)
    `);

  const handoffId = Number(inserted.recordset[0]?.HandoffID);
  return { ok: true, handoffId, updated: false };
}

export type BarberHandoffInboxItem = {
  handoffId: number;
  bookingId: number;
  empId: number;
  empName: string;
  clientId: number | null;
  clientName: string;
  serviceCount: number;
  startTime: string;
  updatedAt: string;
  lockedByOther: boolean;
  lockedByUserId: number | null;
};

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

export async function listPendingHandoffsForBranch(input: {
  branchId: number;
  tenantId: string;
  viewerUserId: number;
}): Promise<BarberHandoffInboxItem[]> {
  await ensureBookingCashierHandoffTable();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .query(`
      SELECT
        h.HandoffID,
        h.BookingID,
        h.EmpID,
        h.PayloadJson,
        h.LockedByUserID,
        h.LockedAt,
        h.UpdatedAt,
        b.StartTime,
        b.ClientID,
        c.[Name] AS ClientName,
        e.EmpName
      FROM dbo.TblBookingCashierHandoff h
      INNER JOIN dbo.Bookings b ON b.BookingID = h.BookingID
      INNER JOIN dbo.TblEmp e ON e.EmpID = h.EmpID
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      WHERE h.BranchID = @branchId
        AND h.TenantId = @tenantId
        AND h.Status IN (N'pending', N'loaded')
        AND e.TenantId = @tenantId
      ORDER BY h.UpdatedAt DESC
    `);

  const now = Date.now();
  return (result.recordset as Array<{
    HandoffID: number;
    BookingID: number;
    EmpID: number;
    PayloadJson: string;
    LockedByUserID: number | null;
    LockedAt: Date | null;
    UpdatedAt: Date;
    StartTime: unknown;
    ClientID: number | null;
    ClientName: string | null;
    EmpName: string | null;
  }>).map((row) => {
    const payload = parseHandoffPayload(row.PayloadJson);
    const lockedAtMs = row.LockedAt ? new Date(row.LockedAt).getTime() : 0;
    const lockFresh = lockedAtMs > 0 && now - lockedAtMs < LOCK_TTL_MS;
    const lockedByOther =
      lockFresh &&
      row.LockedByUserID != null &&
      row.LockedByUserID !== input.viewerUserId;
    return {
      handoffId: row.HandoffID,
      bookingId: row.BookingID,
      empId: row.EmpID,
      empName: String(row.EmpName ?? 'حلاق'),
      clientId: row.ClientID,
      clientName: String(row.ClientName ?? 'عميل').trim() || 'عميل',
      serviceCount: payload.services.reduce((n, s) => n + s.qty, 0),
      startTime: formatSqlTime(row.StartTime),
      updatedAt: new Date(row.UpdatedAt).toISOString(),
      lockedByOther,
      lockedByUserId: row.LockedByUserID,
    };
  });
}

export type ClaimHandoffResult =
  | {
      ok: true;
      handoffId: number;
      bookingId: number;
      empId: number;
      empName: string;
      startTime: string;
      client: {
        ClientID: number;
        Name: string;
        Mobile: string | null;
      } | null;
      lines: Array<{
        ProID: number;
        ProName: string;
        EmpID: number;
        EmpName: string;
        SPrice: number;
        Bonus: number;
        Qty: number;
      }>;
      lockedByOther?: false;
    }
  | { ok: false; error: 'not_found' | 'locked' | 'branch_mismatch'; lockedByUserId?: number };

export async function claimHandoffForPos(input: {
  handoffId: number;
  branchId: number;
  tenantId: string;
  userId: number;
}): Promise<ClaimHandoffResult> {
  await ensureBookingCashierHandoffTable();
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('handoffId', sql.Int, input.handoffId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .query(`
      SELECT
        h.HandoffID, h.BookingID, h.BranchID, h.EmpID, h.Status, h.PayloadJson,
        h.LockedByUserID, h.LockedAt,
        b.StartTime, b.ClientID,
        c.[Name] AS ClientName, c.Mobile,
        e.EmpName
      FROM dbo.TblBookingCashierHandoff h
      INNER JOIN dbo.Bookings b ON b.BookingID = h.BookingID
      INNER JOIN dbo.TblEmp e ON e.EmpID = h.EmpID
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      WHERE h.HandoffID = @handoffId
        AND h.TenantId = @tenantId
        AND h.Status IN (N'pending', N'loaded')
        AND e.TenantId = @tenantId
    `);

  const row = existing.recordset[0] as
    | {
        HandoffID: number;
        BookingID: number;
        BranchID: number;
        EmpID: number;
        Status: string;
        PayloadJson: string;
        LockedByUserID: number | null;
        LockedAt: Date | null;
        StartTime: unknown;
        ClientID: number | null;
        ClientName: string | null;
        Mobile: string | null;
        EmpName: string | null;
      }
    | undefined;

  if (!row) return { ok: false, error: 'not_found' };
  if (row.BranchID !== input.branchId) return { ok: false, error: 'branch_mismatch' };

  const lockedAtMs = row.LockedAt ? new Date(row.LockedAt).getTime() : 0;
  const lockFresh = lockedAtMs > 0 && Date.now() - lockedAtMs < LOCK_TTL_MS;
  if (
    lockFresh &&
    row.LockedByUserID != null &&
    row.LockedByUserID !== input.userId
  ) {
    return { ok: false, error: 'locked', lockedByUserId: row.LockedByUserID };
  }

  await pool
    .request()
    .input('handoffId', sql.Int, input.handoffId)
    .input('userId', sql.Int, input.userId)
    .query(`
      UPDATE dbo.TblBookingCashierHandoff
      SET Status = N'loaded',
          LockedByUserID = @userId,
          LockedAt = SYSUTCDATETIME(),
          UpdatedAt = SYSUTCDATETIME()
      WHERE HandoffID = @handoffId
        AND Status IN (N'pending', N'loaded')
    `);

  const payload = parseHandoffPayload(row.PayloadJson);
  if (payload.services.length === 0) {
    return {
      ok: true,
      handoffId: row.HandoffID,
      bookingId: row.BookingID,
      empId: row.EmpID,
      empName: String(row.EmpName ?? 'حلاق'),
      startTime: formatSqlTime(row.StartTime),
      client: row.ClientID
        ? {
            ClientID: row.ClientID,
            Name: String(row.ClientName ?? 'عميل').trim() || 'عميل',
            Mobile: row.Mobile != null ? String(row.Mobile) : null,
          }
        : null,
      lines: [],
    };
  }

  const proIds = payload.services.map((s) => s.proId);
  const catalog = await pool
    .request()
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .query(`
      SELECT p.ProID, p.ProName, ISNULL(p.SPrice1, 0) AS SPrice1, ISNULL(p.Bonus, 0) AS Bonus
      FROM dbo.TblPro p
      WHERE p.TenantId = TRY_CONVERT(UNIQUEIDENTIFIER, @tenantId)
         OR CONVERT(NVARCHAR(100), p.TenantId) = @tenantId
    `);

  const byPro = new Map<number, { ProName: string; SPrice: number; Bonus: number }>();
  for (const p of catalog.recordset as Array<{
    ProID: number;
    ProName: string | null;
    SPrice1: number;
    Bonus: number;
  }>) {
    if (!proIds.includes(Number(p.ProID))) continue;
    byPro.set(Number(p.ProID), {
      ProName: String(p.ProName ?? 'خدمة'),
      SPrice: Number(p.SPrice1) || 0,
      Bonus: Number(p.Bonus) || 0,
    });
  }

  // The assigned service may be performed by another barber. Preserve the
  // actual employee on each booked row; one ProID may have multiple barbers.
  const reserved = await pool.request()
    .input('bookingId', sql.Int, row.BookingID)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .query(
      "SELECT bs.BookingServiceID,bs.ProID,ISNULL(bs.EmpID,b.AssignedEmpID) AS EmpID, " +
      "bs.Qty,e.EmpName " +
      "FROM dbo.BookingServices bs " +
      "INNER JOIN dbo.Bookings b ON b.BookingID=bs.BookingID " +
      "INNER JOIN dbo.TblEmp e ON e.EmpID=ISNULL(bs.EmpID,b.AssignedEmpID) " +
      "AND e.TenantId=@tenantId " +
      "WHERE bs.BookingID=@bookingId ORDER BY bs.BookingServiceID"
    );
  const bookedRows = reserved.recordset as Array<{
    BookingServiceID: number; ProID: number; EmpID: number; EmpName: string; Qty: number;
  }>;
  const empName = String(row.EmpName ?? 'حلاق');
  const lines: Array<{
    ProID: number; ProName: string; EmpID: number; EmpName: string;
    SPrice: number; Bonus: number; Qty: number;
  }> = [];
  for (const chosen of payload.services) {
    let remaining = chosen.qty;
    for (const booked of bookedRows.filter(item => item.ProID === chosen.proId)) {
      if (remaining <= 0) break;
      const count = Math.min(remaining, Math.max(0, Number(booked.Qty) || 0));
      if (!count) continue;
      const cat = byPro.get(chosen.proId);
      lines.push({
        ProID: chosen.proId,
        ProName: cat?.ProName ?? ('خدمة #' + chosen.proId),
        EmpID: booked.EmpID,
        EmpName: String(booked.EmpName || empName),
        SPrice: cat?.SPrice ?? 0,
        Bonus: cat?.Bonus ?? 0,
        Qty: count,
      });
      remaining -= count;
    }
    if (remaining > 0) {
      return { ok: false, error: 'not_found' };
    }
  }

  return {
    ok: true,
    handoffId: row.HandoffID,
    bookingId: row.BookingID,
    empId: row.EmpID,
    empName,
    startTime: formatSqlTime(row.StartTime),
    client: row.ClientID
      ? {
          ClientID: row.ClientID,
          Name: String(row.ClientName ?? 'عميل').trim() || 'عميل',
          Mobile: row.Mobile != null ? String(row.Mobile) : null,
        }
      : null,
    lines,
  };
}

export async function markHandoffCharged(input: {
  handoffId: number;
  branchId: number;
  tenantId: string;
  invId: number;
  invType?: string;
}): Promise<boolean> {
  if (!Number.isSafeInteger(input.handoffId) || input.handoffId <= 0 ||
      !Number.isSafeInteger(input.invId) || input.invId <= 0) return false;
  await ensureBookingCashierHandoffTable();
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const current = await new sql.Request(tx)
      .input('handoffId', sql.Int, input.handoffId)
      .input('branchId', sql.Int, input.branchId)
      .input('tenantId', sql.NVarChar(100), input.tenantId)
      .query(
        "SELECT h.HandoffID,h.BookingID,h.Status,h.ChargedInvID,h.PayloadJson, " +
        "b.ClientID,b.Status AS BookingStatus,b.ConvertedInvID " +
        "FROM dbo.TblBookingCashierHandoff h WITH (UPDLOCK,HOLDLOCK) " +
        "INNER JOIN dbo.Bookings b WITH (UPDLOCK,HOLDLOCK) ON b.BookingID=h.BookingID " +
        "INNER JOIN dbo.TblEmp e ON e.EmpID=b.AssignedEmpID AND e.TenantId=@tenantId " +
        "WHERE h.HandoffID=@handoffId AND h.BranchID=@branchId AND h.TenantId=@tenantId " +
        "AND b.BranchID=@branchId AND h.Status IN (N'pending',N'loaded',N'charged')"
      );
    const row = current.recordset[0] as
      | { HandoffID:number;BookingID:number;Status:string;ChargedInvID:number|null;
          PayloadJson:string;ClientID:number|null;BookingStatus:string;ConvertedInvID:number|null }
      | undefined;
    if (!row) { await tx.rollback(); return false; }

    // Repair retries must never create another sale, and a different invoice
    // cannot take over a handoff already charged to another invoice.
    if (row.Status === 'charged') {
      const same = row.ChargedInvID === input.invId &&
        row.ConvertedInvID === input.invId;
      await tx.rollback();
      return same;
    }
    if (row.ConvertedInvID != null && row.ConvertedInvID !== input.invId) {
      await tx.rollback(); return false;
    }
    if (['cancelled','no_show'].includes(String(row.BookingStatus).toLowerCase())) {
      await tx.rollback(); return false;
    }

    // Verify that the invoice is real, paid, belongs to the same
    // branch/tenant, and still belongs to this appointment customer.
    const invType = input.invType || 'مبيعات';
    const invoice = await new sql.Request(tx)
      .input('invId', sql.Int, input.invId)
      .input('invType', sql.NVarChar(50), invType)
      .input('branchId', sql.Int, input.branchId)
      .input('tenantId', sql.NVarChar(100), input.tenantId)
      .query(
        "SELECT TOP 1 h.invID,h.ClientID,h.GrandTotal,h.PayDue,h.Notes2,ISNULL(p.Paid,0) AS Paid " +
        "FROM dbo.TblinvServHead h WITH (HOLDLOCK) " +
        "INNER JOIN dbo.Location l ON l.LegacyBranchId=h.BranchID " +
        "OUTER APPLY (SELECT SUM(PayValue) AS Paid FROM dbo.TblinvServPayment " +
        "WHERE invID=h.invID AND invType=h.invType) p " +
        "WHERE h.invID=@invId AND h.invType=@invType AND h.BranchID=@branchId " +
        "AND l.TenantId=TRY_CONVERT(UNIQUEIDENTIFIER,@tenantId)"
      );
    const paid = invoice.recordset[0] as
      | { invID:number;ClientID:number|null;GrandTotal:number;PayDue:number;Paid:number;Notes2:string|null }
      | undefined;
    // Bind the invoice to this *specific* handoff, not merely to a customer
    // and a matching service cart. Prevent an unrelated paid invoice from
    // being reused to close a different booking.
    const marker = 'CUT_HANDOFF:' + input.handoffId + '|';
    if (!paid || !String(paid.Notes2 ?? '').endsWith(marker) ||
        Number(paid.GrandTotal) < 0 ||
        (row.ClientID != null && paid.ClientID !== row.ClientID) ||
        Number(paid.PayDue) > 0.01 ||
        Number(paid.Paid) + 0.01 < Number(paid.GrandTotal)) {
      await tx.rollback(); return false;
    }

    // One paid invoice belongs to one cashier handoff. Refuse to re-use it
    // for a different booking even if the service names and client match.
    const duplicateLink = await new sql.Request(tx)
      .input('invId', sql.Int, input.invId)
      .input('handoff', sql.Int, input.handoffId)
      .query(
        "SELECT TOP 1 HandoffID FROM dbo.TblBookingCashierHandoff WITH (UPDLOCK,HOLDLOCK) " +
        "WHERE ChargedInvID=@invId AND HandoffID<>@handoff AND Status=N'charged'"
      );
    if (duplicateLink.recordset.length) { await tx.rollback(); return false; }

    // At a minimum the paid invoice must contain every selected booked line
    // attributed to the *actual* performing barber, not the handoff owner.
    const requested = parseHandoffPayload(row.PayloadJson).services;
    if (!requested.length) { await tx.rollback(); return false; }
    const booked = await new sql.Request(tx)
      .input('booking', sql.Int, row.BookingID)
      .query(
        "SELECT bs.ProID,ISNULL(bs.EmpID,b.AssignedEmpID) AS EmpID,bs.Qty " +
        "FROM dbo.BookingServices bs JOIN dbo.Bookings b ON b.BookingID=bs.BookingID " +
        "WHERE bs.BookingID=@booking ORDER BY bs.BookingServiceID"
      );
    const details = await new sql.Request(tx)
      .input('inv', sql.Int, input.invId)
      .input('type', sql.NVarChar(50), invType)
      .query(
        "SELECT ProID,EmpID,SUM(Qty) AS Qty FROM dbo.TblinvServDetail " +
        "WHERE invID=@inv AND invType=@type GROUP BY ProID,EmpID"
      );
    const bookedLines = booked.recordset as Array<{ProID:number;EmpID:number;Qty:number}>;
    const paidLines = details.recordset as Array<{ProID:number;EmpID:number|null;Qty:number}>;
    if (!matchesPaidHandoffLines(requested, bookedLines, paidLines)) {
      await tx.rollback();
      return false;
    }

    const charged = await new sql.Request(tx)
      .input('handoffId', sql.Int, input.handoffId)
      .input('invId', sql.Int, input.invId)
      .query(
        "UPDATE dbo.TblBookingCashierHandoff " +
        "SET Status=N'charged',ChargedInvID=@invId,ChargedAt=SYSUTCDATETIME(), " +
        "LockedByUserID=NULL,LockedAt=NULL,UpdatedAt=SYSUTCDATETIME() " +
        "WHERE HandoffID=@handoffId AND Status IN (N'pending',N'loaded')"
      );
    if (charged.rowsAffected[0] !== 1) { await tx.rollback(); return false; }
    const booking = await new sql.Request(tx)
      .input('bookingId', sql.Int, row.BookingID)
      .input('invId', sql.Int, input.invId)
      .input('invType', sql.NVarChar(50), invType)
      .query(
        "UPDATE dbo.Bookings SET Status=N'completed', " +
        "ConvertedInvID=CASE WHEN ConvertedInvID IS NULL THEN @invId ELSE ConvertedInvID END, " +
        "ConvertedInvType=CASE WHEN ConvertedInvID IS NULL THEN @invType ELSE ConvertedInvType END " +
        "WHERE BookingID=@bookingId AND (ConvertedInvID IS NULL OR ConvertedInvID=@invId) " +
        "AND Status NOT IN (N'cancelled',N'no_show')"
      );
    if (booking.rowsAffected[0] !== 1) { await tx.rollback(); return false; }
    await tx.commit();
    return true;
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw err;
  }
}
