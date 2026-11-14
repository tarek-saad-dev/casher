import 'server-only';
import { getPool, sql } from '@/lib/db';
import { sqlDateToYyyyMmDd } from '@/lib/bookingDateTime';
import { previewAddon } from '@/lib/employee-portal/bookingAddonAvailability';
import { assertEmployeeIntervalAvailable, acquireEmployeeScheduleLock, ScheduleConflictError } from '@/lib/scheduleIntegrity';
import { AvailabilityMutationNotifier } from '@/lib/booking/AvailabilityMutationNotifier';

export type ExtraServiceTransfer = {
  requestId: number;
  bookingId: number;
  originalEmpId: number;
  empName: string;
  clientFirstName: string;
  proId: number;
  serviceName: string;
  branchId: number;
  submittedAt: string;
};

export class ExtraServiceTransferError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

export async function ensureAddonTransferTable(): Promise<void> {
  const db = await getPool();
  await db.request().query(
    "IF OBJECT_ID(N'dbo.TblBookingAddonTransferRequest', N'U') IS NULL BEGIN " +
    "CREATE TABLE dbo.TblBookingAddonTransferRequest (" +
    "RequestID INT IDENTITY(1,1) NOT NULL PRIMARY KEY, " +
    "BookingID INT NOT NULL, TenantId NVARCHAR(100) NOT NULL, BranchID INT NOT NULL, " +
    "OriginalEmpID INT NOT NULL, ProID INT NOT NULL, " +
    "Status NVARCHAR(20) NOT NULL DEFAULT N'pending', " +
    "AssignedEmpID INT NULL, StartAtUtc DATETIME2 NULL, EndAtUtc DATETIME2 NULL, " +
    "OperationalDate DATE NULL, BookingServiceID INT NULL, " +
    "CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), " +
    "UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), " +
    "CONSTRAINT CK_TblBookingAddonTransfer_Status " +
    "CHECK (Status IN (N'pending', N'assigned', N'cancelled'))" +
    "); CREATE UNIQUE INDEX UX_TblBookingAddonTransfer_Active " +
    "ON dbo.TblBookingAddonTransferRequest (BookingID, ProID) WHERE Status=N'pending'; " +
    "CREATE INDEX IX_TblBookingAddonTransfer_AssignedBusy " +
    "ON dbo.TblBookingAddonTransferRequest (AssignedEmpID, StartAtUtc, EndAtUtc) " +
    "WHERE Status=N'assigned'; " +
    "CREATE INDEX IX_TblBookingAddonTransfer_Inbox " +
    "ON dbo.TblBookingAddonTransferRequest (TenantId, BranchID, Status, CreatedAt); END"
  );
}

export async function requestAddonTransfer(input: {
  bookingId: number;
  originalEmpId: number;
  tenantId: string;
  proId: number;
}): Promise<{ requestId: number; existing: boolean }> {
  if (!Number.isSafeInteger(input.bookingId) || input.bookingId <= 0 ||
      !Number.isSafeInteger(input.proId) || input.proId <= 0) {
    throw new ExtraServiceTransferError(400, 'طلب غير صالح');
  }
  await ensureAddonTransferTable();
  // A cashier request is allowed only when the employee's own confirmed
  // booking extension is *not available*. Otherwise they should reserve
  // directly. Revalidate again when cashier approves a different employee.
  const preview = await previewAddon({
    bookingId: input.bookingId, empId: input.originalEmpId,
    tenantId: input.tenantId, proId: input.proId,
  });
  if (preview.available) {
    throw new ExtraServiceTransferError(409, 'الوقت متاح عندك — احجزه من تطبيق الموظف مباشرة');
  }

  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const found = await new sql.Request(tx)
      .input('bookingId', sql.Int, input.bookingId)
      .input('empId', sql.Int, input.originalEmpId)
      .input('tenant', sql.NVarChar(100), input.tenantId)
      .query(
        "SELECT b.BookingID,b.BranchID,b.Status,b.ConvertedInvID " +
        "FROM dbo.Bookings b WITH (UPDLOCK, HOLDLOCK) " +
        "INNER JOIN dbo.TblEmp e ON e.EmpID=b.AssignedEmpID " +
        "WHERE b.BookingID=@bookingId AND b.AssignedEmpID=@empId " +
        "AND e.TenantId=@tenant AND e.isActive=1"
      );
    const booking = found.recordset[0] as
      | { BookingID: number; BranchID: number; Status: string | null; ConvertedInvID: number | null }
      | undefined;
    if (!booking) throw new ExtraServiceTransferError(404, 'الحجز غير موجود أو مش تابع لك');
    if (booking.ConvertedInvID != null ||
        ['cancelled', 'no_show', 'completed'].includes(String(booking.Status ?? '').toLowerCase())) {
      throw new ExtraServiceTransferError(409, 'الحجز اتقفل أو اتحاسب');
    }
    const handed = await new sql.Request(tx).input('id', sql.Int, input.bookingId)
      .query(
        "IF OBJECT_ID(N'dbo.TblBookingCashierHandoff',N'U') IS NOT NULL " +
        "SELECT HandoffID FROM dbo.TblBookingCashierHandoff " +
        "WHERE BookingID=@id AND Status IN (N'pending',N'loaded',N'charged')"
      );
    if (handed.recordset.length) throw new ExtraServiceTransferError(409, 'الحجز اتبعت بالفعل للكاشير');
    const existing = await new sql.Request(tx)
      .input('bookingId', sql.Int, input.bookingId)
      .input('proId', sql.Int, input.proId)
      .query(
        "SELECT TOP 1 RequestID FROM dbo.TblBookingAddonTransferRequest " +
        "WHERE BookingID=@bookingId AND ProID=@proId AND Status=N'pending'"
      );
    if (existing.recordset[0]) {
      await tx.rollback();
      return { requestId: Number(existing.recordset[0].RequestID), existing: true };
    }
    const inserted = await new sql.Request(tx)
      .input('bookingId', sql.Int, input.bookingId)
      .input('branchId', sql.Int, booking.BranchID)
      .input('empId', sql.Int, input.originalEmpId)
      .input('tenant', sql.NVarChar(100), input.tenantId)
      .input('proId', sql.Int, input.proId)
      .query(
        "INSERT INTO dbo.TblBookingAddonTransferRequest " +
        "(BookingID,TenantId,BranchID,OriginalEmpID,ProID,Status) " +
        "OUTPUT INSERTED.RequestID " +
        "VALUES (@bookingId,@tenant,@branchId,@empId,@proId,N'pending')"
      );
    await tx.commit();
    return { requestId: Number(inserted.recordset[0].RequestID), existing: false };
  } catch (error) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw error;
  }
}

export async function listPendingAddonTransfers(input: { branchId: number; tenantId: string }): Promise<ExtraServiceTransfer[]> {
  await ensureAddonTransferTable();
  const db = await getPool();
  const found = await db.request()
    .input('branch', sql.Int, input.branchId)
    .input('tenant', sql.NVarChar(100), input.tenantId)
    .query(
      "SELECT r.RequestID,r.BookingID,r.OriginalEmpID,r.BranchID,r.ProID,r.CreatedAt, " +
      "e.EmpName,p.ProName,c.Name AS ClientName " +
      "FROM dbo.TblBookingAddonTransferRequest r " +
      "INNER JOIN dbo.Bookings b ON b.BookingID=r.BookingID " +
      "INNER JOIN dbo.TblEmp e ON e.EmpID=r.OriginalEmpID AND e.TenantId=@tenant " +
      "INNER JOIN dbo.TblPro p ON p.ProID=r.ProID " +
      "LEFT JOIN dbo.TblClient c ON c.ClientID=b.ClientID " +
      "WHERE r.TenantId=@tenant AND r.BranchID=@branch AND r.Status=N'pending' " +
      "AND b.ConvertedInvID IS NULL AND b.Status NOT IN (N'cancelled',N'no_show',N'completed') " +
      "ORDER BY r.CreatedAt ASC"
    );
  return (found.recordset as Array<{
    RequestID: number; BookingID: number; OriginalEmpID: number; BranchID: number;
    ProID: number; CreatedAt: Date; EmpName: string; ProName: string; ClientName: string | null;
  }>).map(r => ({
    requestId: r.RequestID, bookingId: r.BookingID,
    originalEmpId: r.OriginalEmpID, empName: r.EmpName,
    proId: r.ProID, serviceName: r.ProName, branchId: r.BranchID,
    clientFirstName: String(r.ClientName ?? 'عميل').trim().split(/\s+/)[0] || 'عميل',
    submittedAt: new Date(r.CreatedAt).toISOString(),
  }));
}

export async function getTransferAlternatives(input: {
  requestId: number; branchId: number; tenantId: string;
}) {
  await ensureAddonTransferTable();
  const db = await getPool();
  const found = await db.request()
    .input('id', sql.Int, input.requestId)
    .input('branch', sql.Int, input.branchId)
    .input('tenant', sql.NVarChar(100), input.tenantId)
    .query(
      "SELECT RequestID,BookingID,OriginalEmpID,ProID " +
      "FROM dbo.TblBookingAddonTransferRequest " +
      "WHERE RequestID=@id AND BranchID=@branch AND TenantId=@tenant AND Status=N'pending'"
    );
  const row = found.recordset[0] as
    | { RequestID: number; BookingID: number; OriginalEmpID: number; ProID: number }
    | undefined;
  if (!row) throw new ExtraServiceTransferError(404, 'طلب التحويل مش موجود');
  const preview = await previewAddon({
    bookingId: row.BookingID, empId: row.OriginalEmpID,
    tenantId: input.tenantId, proId: row.ProID,
  });
  return { requestId: input.requestId, alternatives: preview.alternatives,
    originalAvailable: preview.available, durationMinutes: preview.durationMinutes };
}

export async function assignAddonTransfer(input: {
  requestId: number;
  assignedEmpId: number;
  proposedStartAt: string;
  tenantId: string;
  branchId: number;
}): Promise<{ assignedEmpId: number; startAt: string; endAt: string; bookingServiceId: number }> {
  if (!Number.isSafeInteger(input.requestId) || input.requestId <= 0 ||
      !Number.isSafeInteger(input.assignedEmpId) || input.assignedEmpId <= 0) {
    throw new ExtraServiceTransferError(400, 'طلب أو موظف غير صالح');
  }
  const startAt = new Date(input.proposedStartAt);
  if (!Number.isFinite(startAt.getTime())) throw new ExtraServiceTransferError(400, 'وقت غير صالح');
  await ensureAddonTransferTable();

  // Read only what we need for the schedule lock key. Everything is checked
  // again within the transaction after the employee schedule lock.
  const pool = await getPool();
  const head = await pool.request()
    .input('id', sql.Int, input.requestId)
    .input('tenant', sql.NVarChar(100), input.tenantId)
    .input('branch', sql.Int, input.branchId)
    .query(
      "SELECT r.BookingID,r.OriginalEmpID,r.ProID,b.PublicWorkDate,b.BookingDate " +
      "FROM dbo.TblBookingAddonTransferRequest r " +
      "INNER JOIN dbo.Bookings b ON b.BookingID=r.BookingID " +
      "WHERE r.RequestID=@id AND r.TenantId=@tenant AND r.BranchID=@branch AND r.Status=N'pending'"
    );
  const snapshot = head.recordset[0] as
    | { BookingID:number; OriginalEmpID:number; ProID:number; PublicWorkDate:Date|null; BookingDate:Date }
    | undefined;
  if (!snapshot) throw new ExtraServiceTransferError(404, 'الطلب اتنفذ أو اتلغى');
  const operationalDate = sqlDateToYyyyMmDd(snapshot.PublicWorkDate ?? snapshot.BookingDate);
  const tx = pool.transaction();
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await acquireEmployeeScheduleLock(tx, input.assignedEmpId, operationalDate);
    const found = await new sql.Request(tx)
      .input('id', sql.Int, input.requestId)
      .input('tenant', sql.NVarChar(100), input.tenantId)
      .input('branch', sql.Int, input.branchId)
      .query(
        "SELECT r.RequestID,r.BookingID,r.OriginalEmpID,r.ProID,r.Status, " +
        "b.ClientID,b.AssignedEmpID,b.Status AS BookingStatus,b.ConvertedInvID, " +
        "b.AbsoluteEndUtc,b.PublicWorkDate,b.BookingDate " +
        "FROM dbo.TblBookingAddonTransferRequest r WITH (UPDLOCK,HOLDLOCK) " +
        "INNER JOIN dbo.Bookings b WITH (UPDLOCK,HOLDLOCK) ON b.BookingID=r.BookingID " +
        "WHERE r.RequestID=@id AND r.TenantId=@tenant AND r.BranchID=@branch AND r.Status=N'pending'"
      );
    const row = found.recordset[0] as
      | { BookingID:number;OriginalEmpID:number;ProID:number;Status:string;
          ClientID:number;AssignedEmpID:number;BookingStatus:string;ConvertedInvID:number|null;
          AbsoluteEndUtc:Date|null;PublicWorkDate:Date|null;BookingDate:Date }
      | undefined;
    if (!row) throw new ExtraServiceTransferError(409, 'طلب التحويل اتغير — حدّث الوارد');
    if (row.AssignedEmpID !== row.OriginalEmpID || row.AssignedEmpID === input.assignedEmpId ||
      row.ConvertedInvID != null ||
      ['cancelled','no_show','completed'].includes(String(row.BookingStatus).toLowerCase())) {
      throw new ExtraServiceTransferError(409, 'الحجز أو الموظف مش صالح للتحويل');
    }
    if (operationalDate !== sqlDateToYyyyMmDd(row.PublicWorkDate ?? row.BookingDate)) {
      throw new ExtraServiceTransferError(409, 'تاريخ الحجز اتغير');
    }
    const employee = await new sql.Request(tx)
      .input('emp', sql.Int, input.assignedEmpId)
      .input('tenant', sql.NVarChar(100), input.tenantId)
      .query(
        "SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpID=@emp AND TenantId=@tenant " +
        "AND isActive=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')"
      );
    if (!employee.recordset[0]) throw new ExtraServiceTransferError(403, 'الموظف البديل غير متاح');

    const service = await new sql.Request(tx)
      .input('pro', sql.Int, row.ProID)
      .input('tenant', sql.NVarChar(100), input.tenantId)
      .query(
        "SELECT TOP 1 ProID,DurationMinutes,ISNULL(SPrice1,0) AS Price " +
        "FROM dbo.TblPro WHERE ProID=@pro AND ISNULL(isDeleted,0)=0 " +
        "AND (TenantId=TRY_CONVERT(UNIQUEIDENTIFIER,@tenant) " +
        "OR CONVERT(NVARCHAR(100),TenantId)=@tenant)"
      );
    if (!service.recordset[0]) throw new ExtraServiceTransferError(409, 'الخدمة مش متاحة');
    let minutes = Number(service.recordset[0].DurationMinutes);
    const override = await new sql.Request(tx)
      .input('emp', sql.Int, input.assignedEmpId)
      .input('pro', sql.Int, row.ProID)
      .query(
        "IF OBJECT_ID(N'dbo.TblEmpServiceSettings',N'U') IS NOT NULL " +
        "SELECT TOP 1 DurationMinutes FROM dbo.TblEmpServiceSettings " +
        "WHERE EmpID=@emp AND ProID=@pro AND IsActive=1 AND DurationMinutes>0"
      );
    if (override.recordset[0]) minutes = Number(override.recordset[0].DurationMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 240) {
      throw new ExtraServiceTransferError(409, 'مدة الخدمة مش مضبوطة');
    }
    const endAt = new Date(startAt.getTime() + minutes * 60000);
    const originalEnd = row.AbsoluteEndUtc instanceof Date ? row.AbsoluteEndUtc : null;
    if (!originalEnd || !Number.isFinite(originalEnd.getTime()) ||
        startAt.getTime() < originalEnd.getTime() ||
        startAt.getTime() > originalEnd.getTime() + 90 * 60000 ||
        startAt.getTime() < Date.now() - 60000) {
      throw new ExtraServiceTransferError(409, 'وقت الطلب مش مطابق للحجز — افحص البدائل من جديد');
    }
    const handed = await new sql.Request(tx).input('bid', sql.Int, row.BookingID)
      .query(
        "IF OBJECT_ID(N'dbo.TblBookingCashierHandoff',N'U') IS NOT NULL " +
        "SELECT HandoffID FROM dbo.TblBookingCashierHandoff " +
        "WHERE BookingID=@bid AND Status IN (N'pending',N'loaded',N'charged')"
      );
    if (handed.recordset.length) throw new ExtraServiceTransferError(409, 'الطلب اتحول بالفعل للتحصيل');
    await assertEmployeeIntervalAvailable({
      empId: input.assignedEmpId, branchId: input.branchId, operationalDate,
      startAt, endAt, transaction: tx,
    });
    const line = await new sql.Request(tx)
      .input('booking', sql.Int, row.BookingID)
      .input('pro', sql.Int, row.ProID)
      .input('emp', sql.Int, input.assignedEmpId)
      .input('price', sql.Decimal(18,2), Number(service.recordset[0].Price))
      .input('duration', sql.Int, minutes)
      .query(
        "INSERT INTO dbo.BookingServices (BookingID,ProID,EmpID,Qty,Price,DurationMinutes) " +
        "OUTPUT INSERTED.BookingServiceID " +
        "VALUES (@booking,@pro,@emp,1,@price,@duration)"
      );
    const bookingServiceId = Number(line.recordset[0]?.BookingServiceID);
    if (!bookingServiceId) throw new Error('BookingService insert missing ID');
    const changed = await new sql.Request(tx)
      .input('request', sql.Int, input.requestId)
      .input('emp', sql.Int, input.assignedEmpId)
      .input('workDate', sql.Date, operationalDate)
      .input('start', sql.DateTime2, startAt)
      .input('end', sql.DateTime2, endAt)
      .input('line', sql.Int, bookingServiceId)
      .query(
        "UPDATE dbo.TblBookingAddonTransferRequest " +
        "SET Status=N'assigned',AssignedEmpID=@emp,OperationalDate=@workDate, " +
        "StartAtUtc=@start,EndAtUtc=@end,BookingServiceID=@line,UpdatedAt=SYSUTCDATETIME() " +
        "WHERE RequestID=@request AND Status=N'pending'"
      );
    if (changed.rowsAffected[0] !== 1) throw new ExtraServiceTransferError(409,'الطلب اتغير');
    await tx.commit();
    try {
      await AvailabilityMutationNotifier.bookingOccupancyChanged({
        employeeId: input.assignedEmpId, businessDate: operationalDate,
        branchId: input.branchId, reason: 'cashier_assisted_addon',
      });
    } catch (error) {
      console.warn('[addon-transfer] cache invalidation failed',
        error instanceof Error ? error.message : error);
    }
    return { assignedEmpId: input.assignedEmpId,
      startAt: startAt.toISOString(), endAt: endAt.toISOString(), bookingServiceId };
  } catch (error) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    if (error instanceof ScheduleConflictError) {
      throw new ExtraServiceTransferError(409, 'وقت الموظف البديل اتشغل — اختار وقت آخر');
    }
    throw error;
  }
}
