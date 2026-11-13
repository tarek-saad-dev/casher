import 'server-only';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { normalizeBookingTimes, sqlDateToYyyyMmDd, sqlTimeToHhmm, createCairoDateTime } from '@/lib/bookingDateTime';
import { acquireEmployeeScheduleLock, assertEmployeeIntervalAvailable, ScheduleConflictError } from '@/lib/scheduleIntegrity';

type BookingRow = {
  BookingID: number; BranchID: number; BookingDate: unknown;
  PublicWorkDate: unknown; StartTime: unknown; EndTime: unknown; TotalDuration: number;
  AbsoluteEndUtc: Date | null; Status: string; ConvertedInvID: number | null;
};
type DbHandle = Awaited<ReturnType<typeof getPool>> | Transaction;
type Service = { ProID: number; ProName: string; DurationMinutes: number; SPrice1: number };
export type SuggestedBarber = { empId: number; empName: string; startAt: string; endAt: string };
export type AddonAvailability = {
  available: boolean; durationMinutes: number; expectedEndAt: string;
  proposedEndAt: string; reason?: string; alternatives: SuggestedBarber[];
};
export class AddonGuardError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function request(db: DbHandle) { return new sql.Request(db); }

async function getBooking(db: DbHandle, actor: { bookingId: number; empId: number; tenantId: string }, lock = false): Promise<BookingRow> {
  const result = await request(db)
    .input('bid', sql.Int, actor.bookingId)
    .input('emp', sql.Int, actor.empId)
    .input('tenant', sql.NVarChar(100), actor.tenantId)
    .query(
      "SELECT b.BookingID, b.BranchID, b.BookingDate, b.PublicWorkDate, " +
      "b.StartTime, b.EndTime, b.AbsoluteEndUtc, b.Status, b.ConvertedInvID, (SELECT COALESCE(SUM(COALESCE(bs.DurationMinutes,30)),30) FROM dbo.BookingServices bs WHERE bs.BookingID=b.BookingID) AS TotalDuration " +
      "FROM dbo.Bookings b " + (lock ? "WITH (UPDLOCK, HOLDLOCK) " : "") +
      "INNER JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID " +
      "WHERE b.BookingID=@bid AND b.AssignedEmpID=@emp AND e.TenantId=@tenant AND e.isActive=1"
    );
  const row = result.recordset[0] as BookingRow | undefined;
  if (!row) throw new AddonGuardError(404, 'الحجز غير موجود أو غير تابع لك');
  if (!row.BranchID) throw new AddonGuardError(409, 'الحجز بدون فرع — راجع الكاشير');
  if (['cancelled','no_show','completed'].includes(String(row.Status || '').toLowerCase()) || row.ConvertedInvID != null) {
    throw new AddonGuardError(409, 'لا يمكن إضافة خدمة بعد إلغاء أو تحصيل الحجز');
  }
  return row;
}
async function getService(db: DbHandle, tenantId: string, proId: number, empId: number): Promise<Service> {
  if (!Number.isInteger(proId) || proId < 1) throw new AddonGuardError(400, 'الخدمة غير صالحة');
  const found = await request(db)
    .input('proId', sql.Int, proId).input('tenant', sql.NVarChar(100), tenantId)
    .query(
      "SELECT TOP 1 ProID, COALESCE(NULLIF(ProNameAr,N''), ProName) AS ProName, " +
      "DurationMinutes, ISNULL(SPrice1,0) AS SPrice1 FROM dbo.TblPro " +
      "WHERE ProID=@proId AND ISNULL(isDeleted,0)=0 AND " +
      "(TenantId=TRY_CONVERT(UNIQUEIDENTIFIER,@tenant) OR CONVERT(NVARCHAR(100),TenantId)=@tenant)"
    );
  const service = found.recordset[0] as Service | undefined;
  if (!service) throw new AddonGuardError(400, 'الخدمة مش متاحة');
  let duration = Number(service.DurationMinutes);
  // Honor the same per-barber duration overrides used by operations.
  // Unsupported legacy schemas fall back to catalog duration; other DB errors fail closed.
  try {
    const override = await request(db)
      .input('empId', sql.Int, empId).input('proId', sql.Int, proId)
      .query(
        "SELECT TOP 1 DurationMinutes FROM dbo.TblEmpServiceSettings " +
        "WHERE EmpID=@empId AND ProID=@proId AND IsActive=1 " +
        "AND DurationMinutes > 0"
      );
    const minutes = Number(override.recordset[0]?.DurationMinutes);
    if (Number.isInteger(minutes) && minutes > 0) duration = minutes;
  } catch (error) {
    if ((error as {number?:number})?.number !== 208 &&
      !String((error as Error)?.message ?? '').includes('Invalid object name')) {
      throw error;
    }
  }
  if (!Number.isInteger(duration) || duration <= 0 || duration > 240) {
    throw new AddonGuardError(409, 'مدة الخدمة غير محددة — راجع الكاشير');
  }
  return { ...service, DurationMinutes: duration };
}
function period(booking: BookingRow) {
  const date = sqlDateToYyyyMmDd(booking.BookingDate);
  const n = normalizeBookingTimes(date, sqlTimeToHhmm(booking.StartTime), sqlTimeToHhmm(booking.EndTime), Math.max(1,Number(booking.TotalDuration)||30));
  const derivedEnd = new Date(n.endDateTimeCairo);
  const endAt = booking.AbsoluteEndUtc instanceof Date && Number.isFinite(booking.AbsoluteEndUtc.getTime())
    ? booking.AbsoluteEndUtc : derivedEnd;
  if (!Number.isFinite(endAt.getTime())) throw new AddonGuardError(409, 'موعد الحجز غير واضح — راجع الكاشير');
  const startAt = createCairoDateTime(date, booking.StartTime);
  const sqlEndAt = createCairoDateTime(date, booking.EndTime);
  if (sqlEndAt.getTime() <= startAt.getTime()) {
    sqlEndAt.setTime(sqlEndAt.getTime() + 86400000);
  }
  // Do not shorten or overwrite an inconsistent legacy reservation. Require
  // persisted end, absolute end and service-derived duration to agree.
  if (Math.abs(sqlEndAt.getTime() - endAt.getTime()) > 60000 ||
      Math.abs(derivedEnd.getTime() - endAt.getTime()) > 60000) {
    throw new AddonGuardError(409, 'مدة الحجز المسجلة غير متطابقة — راجع الكاشير قبل الإضافة');
  }
  if (endAt.getTime() < Date.now() - 60_000) throw new AddonGuardError(409, 'انتهى وقت الحجز — خلي الكاشير ينظم الإضافة');
  return {
    endAt, operationalDate: booking.PublicWorkDate
      ? sqlDateToYyyyMmDd(booking.PublicWorkDate) : date,
  };
}
function cairoHhmm(at: Date) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  return (p.find(x => x.type === 'hour')?.value ?? '00') + ':' +
    (p.find(x => x.type === 'minute')?.value ?? '00');
}
async function ensureNotSent(db: DbHandle, bookingId: number) {
  const sent = await request(db).input('id', sql.Int, bookingId).query(
    "IF OBJECT_ID(N'dbo.TblBookingCashierHandoff',N'U') IS NOT NULL " +
    "SELECT TOP 1 HandoffID FROM dbo.TblBookingCashierHandoff " +
    "WHERE BookingID=@id AND Status IN (N'pending',N'loaded',N'charged')"
  );
  if (sent.recordset.length) throw new AddonGuardError(409, 'الطلب اتبعت للكاشير — خلي الكاشير يراجع الإضافة');
}
async function alternatives(input: {
  empId: number; branchId: number; tenantId: string; workDate: string;
  startAt: Date; durationMinutes: number; proId: number;
}): Promise<SuggestedBarber[]> {
  const db = await getPool();
  const staff = await db.request()
    .input('tenant', sql.NVarChar(100), input.tenantId)
    .input('emp', sql.Int, input.empId)
    .query(
      "SELECT TOP 8 EmpID, EmpName FROM dbo.TblEmp WHERE TenantId=@tenant " +
      "AND isActive=1 AND EmpID<>@emp AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber') ORDER BY EmpID"
    );
  const people = staff.recordset as Array<{EmpID:number;EmpName:string}>;
  const durations = await Promise.all(people.map(p =>
    getService(db, input.tenantId, input.proId, p.EmpID).then(s => s.DurationMinutes)
  ));
  const found: SuggestedBarber[] = [];
  const suggestedEmployees = new Set<number>();
  for (const delay of [0,15,30,45,60]) {
    const startAt = new Date(input.startAt.getTime() + delay * 60000);
    const checked = await Promise.all(people.map(async (p, index) => {
      const endAt = new Date(startAt.getTime() + durations[index]! * 60000);
      try {
        await assertEmployeeIntervalAvailable({
          empId: p.EmpID, branchId: input.branchId, operationalDate: input.workDate, startAt, endAt,
        });
        return {empId:p.EmpID,empName:p.EmpName,startAt:startAt.toISOString(),endAt:endAt.toISOString()};
      } catch (error) {
        if (error instanceof ScheduleConflictError) return null;
        throw error;
      }
    }));
    for (const row of checked) {
      if (row && !suggestedEmployees.has(row.empId)) {
        suggestedEmployees.add(row.empId);
        found.push(row);
      }
      if (found.length === 3) return found;
    }
  }
  return found;
}
export async function previewAddon(input: {
  bookingId: number; empId: number; tenantId: string; proId: number;
}): Promise<AddonAvailability> {
  const db = await getPool();
  const [booking, service] = await Promise.all([
    getBooking(db,input), getService(db,input.tenantId,input.proId,input.empId),
  ]);
  await ensureNotSent(db,input.bookingId);
  const p = period(booking);
  const endAt = new Date(p.endAt.getTime() + service.DurationMinutes*60000);
  try {
    await assertEmployeeIntervalAvailable({
      empId:input.empId, branchId:booking.BranchID, operationalDate:p.operationalDate,
      startAt:p.endAt, endAt,
    });
    return {available:true,durationMinutes:service.DurationMinutes,
      expectedEndAt:p.endAt.toISOString(),proposedEndAt:endAt.toISOString(),alternatives:[]};
  } catch (error) {
    if (!(error instanceof ScheduleConflictError)) throw error;
    let suggested: SuggestedBarber[] = [];
    try {
      suggested = await alternatives({
        empId:input.empId,tenantId:input.tenantId,branchId:booking.BranchID,
        workDate:p.operationalDate,startAt:p.endAt,durationMinutes:service.DurationMinutes,proId:input.proId,
      });
    } catch (lookupError) {
      // The original barber is definitely unavailable. Do not hide this result
      // just because the optional recommendation lookup failed.
      console.warn('[staff-addon] optional alternative lookup failed',
        lookupError instanceof Error ? lookupError.message : lookupError);
    }
    return {available:false,durationMinutes:service.DurationMinutes,reason:error.message,
      expectedEndAt:p.endAt.toISOString(),proposedEndAt:endAt.toISOString(),alternatives:suggested};
  }
}
export async function reserveAddon(input: {
  bookingId: number; empId: number; tenantId: string; proId: number; expectedEndAt: string;
}): Promise<{ok:true;endAt:string;durationMinutes:number}|{ok:false;status:number;error:string}> {
  const expected = new Date(input.expectedEndAt);
  if (!Number.isFinite(expected.getTime())) {
    return {ok:false,status:400,error:'افحص توافر الوقت الأول'};
  }
  const db = await getPool();
  let tx: Transaction | null = null;
  try {
    const snapshot = await getBooking(db,input);
    const initialPeriod = period(snapshot);
    tx = db.transaction();
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireEmployeeScheduleLock(tx,input.empId,initialPeriod.operationalDate);
    const booking = await getBooking(tx,input,true);
    const service = await getService(tx,input.tenantId,input.proId,input.empId);
    await ensureNotSent(tx,input.bookingId);
    const p = period(booking);
    if (p.operationalDate !== initialPeriod.operationalDate ||
        p.endAt.getTime() !== expected.getTime()) {
      throw new AddonGuardError(409,'جدول المواعيد اتغير — افحصه من جديد');
    }
    const newEnd = new Date(p.endAt.getTime()+service.DurationMinutes*60000);
    // Authoritative re-check under schedule lock, including queue, future bookings,
    // holds, breaks and actual shift windows. Never trust a preview by itself.
    await assertEmployeeIntervalAvailable({
      empId:input.empId,startAt:p.endAt,endAt:newEnd,
      operationalDate:p.operationalDate,branchId:booking.BranchID,transaction:tx,
    });
    await request(tx)
      .input('bid',sql.Int,input.bookingId)
      .input('endTime',sql.VarChar(8),cairoHhmm(newEnd))
      .input('absEnd',sql.DateTime2,newEnd)
      .query("UPDATE dbo.Bookings SET EndTime=@endTime, AbsoluteEndUtc=@absEnd, UpdatedAt=GETDATE() WHERE BookingID=@bid");
    await request(tx)
      .input('bid',sql.Int,input.bookingId)
      .input('proId',sql.Int,input.proId)
      .input('empId',sql.Int,input.empId)
      .input('price',sql.Decimal(18,2),Number(service.SPrice1)||0)
      .input('minutes',sql.Int,service.DurationMinutes)
      .query("INSERT INTO dbo.BookingServices (BookingID,ProID,EmpID,Qty,Price,DurationMinutes) VALUES (@bid,@proId,@empId,1,@price,@minutes)");
    await tx.commit();
    tx = null;
    // Refresh booking availability in other screens after the schedule extension.
    try {
      const { AvailabilityMutationNotifier } = await import('@/lib/booking/AvailabilityMutationNotifier');
      await AvailabilityMutationNotifier.bookingOccupancyChanged({
        employeeId: input.empId,
        businessDate: p.operationalDate,
        branchId: booking.BranchID,
        reason: 'employee_portal_addon_reservation',
      });
    } catch (error) {
      console.warn('[staff-addon] cache invalidation failed', error instanceof Error ? error.message : error);
    }
    return {ok:true,endAt:newEnd.toISOString(),durationMinutes:service.DurationMinutes};
  } catch (error) {
    if (tx) { try {await tx.rollback();} catch {/* already rolled back */} }
    if (error instanceof AddonGuardError) return {ok:false,status:error.status,error:error.message};
    if (error instanceof ScheduleConflictError) return {ok:false,status:409,error:'الوقت مش متاح؛ الحجوزات المؤكدة لها الأولوية — اطلب أقرب موظف أو توجه للكاشير'};
    console.error('[staff-addon]',error instanceof Error?error.message:error);
    return {ok:false,status:503,error:'تعذر تأكيد الوقت — لم تتم إضافة الخدمة. راجع الكاشير'};
  }
}
