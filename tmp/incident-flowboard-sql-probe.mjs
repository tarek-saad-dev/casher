/**
 * Read-only: replicate loadFlowBoardForBranch booking inclusion for BookingID 3816.
 */
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const SALON_TZ = 'Africa/Cairo';
const dateStr = '2026-08-28';
const branchId = 1;
const targetBookingId = 3816;

function sqlTimeToHhmm(v) {
  if (!v) return '00:00';
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 5);
}

function salonDateTimeToMs(dateStr, hhmm, tz) {
  const [h, m] = hhmm.split(':').map(Number);
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const noonLocal = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(noonUtc);
  const offsetPart = noonLocal.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const offsetMatch = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
  let offsetMinutes = 0;
  if (offsetMatch) {
    const parts = offsetMatch[1].split(':');
    offsetMinutes =
      parseInt(parts[0], 10) * 60 +
      (parts[1] ? parseInt(parts[1], 10) * Math.sign(parseInt(parts[0], 10)) : 0);
  }
  const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
  return midnightUtcMs - offsetMinutes * 60_000 + (h * 60 + m) * 60_000;
}

const pool = await sql.connect({
  server: process.env.DB_SERVER || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

// Exact flow-board bookings query for emp 7
const bookingsRes = await pool.request()
  .input('bdate', sql.Date, dateStr)
  .input('branchId', sql.Int, branchId)
  .query(`
    SELECT b.BookingID, b.AssignedEmpID, c.Name AS ClientName, b.StartTime, b.EndTime, b.Status, b.BookingDate
    FROM dbo.Bookings b
    LEFT JOIN dbo.TblClient c ON b.ClientID = c.ClientID
    WHERE b.BookingDate = @bdate
      AND b.BranchID = @branchId
      AND b.AssignedEmpID = 7
      AND b.AssignedEmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE isActive = 1 AND Job = N'حلاق')
      AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
  `);

const hit = bookingsRes.recordset.find((r) => r.BookingID === targetBookingId);
console.log('SQL flow-board query includes booking 3816:', !!hit);
console.log('Emp7 bookings on board date:', bookingsRes.recordset.map((r) => ({
  id: r.BookingID,
  client: r.ClientName,
  start: sqlTimeToHhmm(r.StartTime),
})));

// Emp 7 schedule for shift window (branch weekly)
const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
const sched = await pool.request()
  .input('branchId', sql.Int, branchId)
  .input('dow', sql.TinyInt, dow)
  .input('day', sql.Date, dateStr)
  .query(`
    SELECT TOP 1 StartTime, EndTime FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID = 7 AND BranchID = @branchId AND DayOfWeek = @dow AND IsActive = 1 AND IsWorking = 1
      AND EffectiveFrom <= @day AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
  `);

const workStart = sqlTimeToHhmm(sched.recordset[0]?.StartTime ?? '11:00');
const workEnd = sqlTimeToHhmm(sched.recordset[0]?.EndTime ?? '23:00');
console.log('Emp7 shift window:', workStart, '-', workEnd);

if (hit) {
  const startH = sqlTimeToHhmm(hit.StartTime);
  const endH = sqlTimeToHhmm(hit.EndTime);
  const bookingDateStr = dateStr;
  const startMs = salonDateTimeToMs(bookingDateStr, startH, SALON_TZ);
  const endMs = salonDateTimeToMs(bookingDateStr, endH, SALON_TZ);
  const shiftStartMs = salonDateTimeToMs(dateStr, workStart, SALON_TZ);
  const shiftEndMs = salonDateTimeToMs(dateStr, workEnd, SALON_TZ);
  const inShiftWindow = startMs < shiftEndMs && endMs > shiftStartMs;
  console.log('Booking 3816 inShiftWindow:', inShiftWindow, {
    startH,
    endH,
    startIso: new Date(startMs).toISOString(),
    operationalHour: (() => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: SALON_TZ,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(new Date(startMs));
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      return h + m / 60;
    })(),
  });
}

// Presence: emp 7 on GLEEM schedule for day
const presence = await pool.request()
  .input('branchId', sql.Int, branchId)
  .input('day', sql.Date, dateStr)
  .query(`
    SELECT DISTINCT e.EmpID FROM dbo.TblEmp e
    INNER JOIN dbo.TblEmpBranchAssignment ea ON ea.EmpID = e.EmpID
    WHERE e.EmpID = 7 AND ea.BranchID = @branchId AND ea.IsActive = 1
      AND ea.EffectiveFrom <= @day AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
  `);
console.log('Emp7 in branch assignment (presence base):', presence.recordset.length > 0);

await pool.close();
