/**
 * Read-only audit: find post-midnight bookings that may be stored on the wrong date.
 *
 * Problem context:
 *   Before the overnight-availability fix, a booking at 00:30 for an employee
 *   whose shift is 13:00 -> 01:00 on business date 2026-07-08 may have been
 *   stored with BookingDate = 2026-07-08 instead of the actual calendar date
 *   2026-07-09. This script scans for such rows without modifying anything.
 *
 * Usage:
 *   npx tsx scripts/audit-post-midnight-bookings.ts [startDate] [endDate]
 *
 * Examples:
 *   npx tsx scripts/audit-post-midnight-bookings.ts
 *   npx tsx scripts/audit-post-midnight-bookings.ts 2026-07-01 2026-07-31
 *
 * Output:
 *   - Human-readable report to stdout
 *   - Detailed JSON written to scripts/audit-post-midnight-bookings-report.json
 */

import fs from 'fs';
import path from 'path';
import { getPool } from '../src/lib/db';
import { getCairoBusinessDate } from '../src/lib/businessDate';

const POST_MIDNIGHT_END_HOUR = 4; // bookings with StartTime hour < 4 are "post-midnight"

interface ScheduleRow {
  EmpID: number;
  EmpName: string;
  BookingDate: string;
  DayOfWeek: number;
  IsWorkingDay: boolean;
  StartTime: string | null;
  EndTime: string | null;
}

interface CandidateRow {
  BookingID: number;
  BookingCode: string | null;
  ClientID: number | null;
  ClientName: string | null;
  AssignedEmpID: number;
  EmpName: string;
  BookingDate: string;
  StartTime: string;
  EndTime: string;
  Status: string;
  Source: string;
  Notes: string | null;
  CreatedAt: string;
  ScheduleStart: string | null;
  ScheduleEnd: string | null;
  IsOvernightSchedule: boolean;
  BookingStartMinutes: number;
  ScheduleEndMinutes: number;
  LikelyWrongDate: boolean;
  SuggestedBookingDate: string;
  NextDayDuplicateExists: boolean;
  NextDayBookingID: number | null;
}

function hhmmToMinutes(hhmm: string | null | undefined): number {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime(timeVal: any): string | null {
  if (!timeVal) return null;
  if (typeof timeVal === 'string') return timeVal.length <= 5 ? timeVal : timeVal.slice(0, 5);
  if (timeVal instanceof Date) {
    return `${String(timeVal.getUTCHours()).padStart(2, '0')}:${String(timeVal.getUTCMinutes()).padStart(2, '0')}`;
  }
  return String(timeVal).slice(0, 5);
}

function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isOvernightShift(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return hhmmToMinutes(end) <= hhmmToMinutes(start);
}

async function main() {
  const startDate = process.argv[2];
  const endDate = process.argv[3];

  const defaultStart = '2020-01-01';
  const defaultEnd = addOneDay(getCairoBusinessDate());

  const auditStart = startDate || defaultStart;
  const auditEnd = endDate || defaultEnd;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(auditStart) || !/^\d{4}-\d{2}-\d{2}$/.test(auditEnd)) {
    console.error('Invalid date format. Use YYYY-MM-DD.');
    process.exit(1);
  }

  console.log(`\n=== Post-midnight booking date audit ===`);
  console.log(`Date range: ${auditStart} .. ${auditEnd}`);
  console.log(`Mode: READ-ONLY (no updates will be made)\n`);

  const db = await getPool();

  // 0. Check if BookingCode column exists (added by a later migration)
  const bookingCodeColRes = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Bookings' AND COLUMN_NAME = 'BookingCode'
  `);
  const hasBookingCode = (bookingCodeColRes.recordset[0]?.cnt ?? 0) > 0;

  // 1. Find post-midnight bookings in the requested range
  const bookingsRes = await db.request()
    .input('startDate', auditStart)
    .input('endDate', auditEnd)
    .query(`
      SELECT
        b.BookingID,
        ${hasBookingCode ? 'b.BookingCode' : 'NULL AS BookingCode'},
        b.ClientID,
        ISNULL(c.Name, c.Company) AS ClientName,
        b.AssignedEmpID,
        e.EmpName,
        CAST(b.BookingDate AS DATE) AS BookingDate,
        CONVERT(VARCHAR(5), b.StartTime, 108) AS StartTime,
        CONVERT(VARCHAR(5), b.EndTime, 108) AS EndTime,
        b.Status,
        b.Source,
        b.Notes,
        b.CreatedAt,
        DATEPART(HOUR, b.StartTime) AS StartHour,
        DATEPART(MINUTE, b.StartTime) AS StartMinute
      FROM dbo.Bookings b
      LEFT JOIN dbo.TblClients c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      WHERE b.BookingDate BETWEEN @startDate AND @endDate
        AND b.Status NOT IN ('cancelled', 'no_show')
        AND b.StartTime IS NOT NULL
        AND DATEPART(HOUR, b.StartTime) < ${POST_MIDNIGHT_END_HOUR}
      ORDER BY b.BookingDate, b.AssignedEmpID, b.StartTime
    `);

  // 2. Load schedules for the employees/days touched by these bookings
  const dateEmpKeys = new Set<string>();
  for (const row of bookingsRes.recordset) {
    const date = new Date(`${row.BookingDate}T12:00:00Z`);
    const dow = date.getDay();
    dateEmpKeys.add(`${row.AssignedEmpID}|${dow}`);
  }

  const scheduleMap = new Map<string, ScheduleRow>();
  if (dateEmpKeys.size > 0) {
    const conditions = Array.from(dateEmpKeys)
      .map((k) => {
        const [empId, dow] = k.split('|');
        return `(EmpID = ${empId} AND DayOfWeek = ${dow})`;
      })
      .join(' OR ');

    const schedulesRes = await db.request().query(`
      SELECT
        EmpID,
        DayOfWeek,
        IsWorkingDay,
        CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
        CASE WHEN EndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime,   108), 5) ELSE NULL END AS EndTime
      FROM dbo.TblEmpWorkSchedule
      WHERE ${conditions}
    `);

    for (const row of schedulesRes.recordset) {
      const empId = Number(row.EmpID);
      const dow = Number(row.DayOfWeek);
      scheduleMap.set(`${empId}|${dow}`, {
        EmpID: empId,
        EmpName: '',
        BookingDate: '',
        DayOfWeek: dow,
        IsWorkingDay: !!row.IsWorkingDay,
        StartTime: formatTime(row.StartTime),
        EndTime: formatTime(row.EndTime),
      });
    }
  }

  // 3. Check for next-day duplicates (same employee + same start time on BookingDate + 1)
  const nextDayKeys = new Set<string>();
  for (const row of bookingsRes.recordset) {
    const nextDate = addOneDay(row.BookingDate as string);
    nextDayKeys.add(`${row.AssignedEmpID}|${nextDate}|${formatTime(row.StartTime)}`);
  }

  const duplicateMap = new Map<string, { BookingID: number }>();
  if (nextDayKeys.size > 0) {
    const values = Array.from(nextDayKeys)
      .map((k) => {
        const [empId, date, time] = k.split('|');
        return `(${empId}, '${date}', '${time}')`;
      })
      .join(', ');

    const dupRes = await db.request().query(`
      SELECT
        b.AssignedEmpID AS EmpID,
        CAST(b.BookingDate AS DATE) AS BookingDate,
        CONVERT(VARCHAR(5), b.StartTime, 108) AS StartTime,
        b.BookingID
      FROM dbo.Bookings b
      INNER JOIN (VALUES ${values}) AS v(EmpID, BookingDate, StartTime)
        ON b.AssignedEmpID = v.EmpID
        AND CAST(b.BookingDate AS DATE) = v.BookingDate
        AND CONVERT(VARCHAR(5), b.StartTime, 108) = v.StartTime
      WHERE b.Status NOT IN ('cancelled', 'no_show')
    `);

    for (const row of dupRes.recordset) {
      duplicateMap.set(`${row.EmpID}|${row.BookingDate}|${row.StartTime}`, {
        BookingID: row.BookingID,
      });
    }
  }

  // 4. Build candidate list and classify
  const candidates: CandidateRow[] = [];
  for (const row of bookingsRes.recordset) {
    const dateObj = new Date(`${row.BookingDate}T12:00:00Z`);
    const dow = dateObj.getDay();
    const schedule = scheduleMap.get(`${row.AssignedEmpID}|${dow}`);

    const startStr = formatTime(row.StartTime) as string;
    const endStr = formatTime(row.EndTime) as string;
    const schedStart = schedule?.StartTime ?? null;
    const schedEnd = schedule?.EndTime ?? null;
    const overnight = isOvernightShift(schedStart, schedEnd);

    const bookingStartMinutes = hhmmToMinutes(startStr);
    const scheduleEndMinutes = hhmmToMinutes(schedEnd);

    // Heuristic: booking is in the post-midnight tail of an overnight shift
    // if the shift end is <= shift start (overnight) and the booking start
    // is before or at the shift end.
    const likelyWrongDate = overnight && bookingStartMinutes <= scheduleEndMinutes;
    const suggestedDate = likelyWrongDate ? addOneDay(row.BookingDate as string) : (row.BookingDate as string);

    const nextDate = addOneDay(row.BookingDate as string);
    const dupKey = `${row.AssignedEmpID}|${nextDate}|${startStr}`;
    const duplicate = duplicateMap.get(dupKey);

    candidates.push({
      BookingID: row.BookingID,
      BookingCode: row.BookingCode ?? null,
      ClientID: row.ClientID ?? null,
      ClientName: row.ClientName ?? null,
      AssignedEmpID: row.AssignedEmpID,
      EmpName: row.EmpName,
      BookingDate: row.BookingDate as string,
      StartTime: startStr,
      EndTime: endStr,
      Status: row.Status,
      Source: row.Source,
      Notes: row.Notes ?? null,
      CreatedAt: row.CreatedAt?.toISOString?.() ?? String(row.CreatedAt),
      ScheduleStart: schedStart,
      ScheduleEnd: schedEnd,
      IsOvernightSchedule: overnight,
      BookingStartMinutes: bookingStartMinutes,
      ScheduleEndMinutes: scheduleEndMinutes,
      LikelyWrongDate: likelyWrongDate,
      SuggestedBookingDate: suggestedDate,
      NextDayDuplicateExists: !!duplicate,
      NextDayBookingID: duplicate?.BookingID ?? null,
    });
  }

  // 5. Report
  const likelyWrong = candidates.filter((c) => c.LikelyWrongDate);
  const outsideShift = candidates.filter((c) => !c.IsOvernightSchedule);

  console.log(`Total post-midnight bookings scanned: ${candidates.length}`);
  console.log(`  - Likely stored on wrong date (need BookingDate +1): ${likelyWrong.length}`);
  console.log(`  - Post-midnight but schedule is not overnight (review manually): ${outsideShift.length}`);
  console.log(`  - Post-midnight with overnight schedule and probably correct date: ${candidates.length - likelyWrong.length - outsideShift.length}\n`);

  if (likelyWrong.length > 0) {
    console.log('--- Likely wrong date (BookingDate should be +1) ---');
    for (const c of likelyWrong) {
      const dupInfo = c.NextDayDuplicateExists
        ? ` [DUPLICATE on ${c.SuggestedBookingDate}: BookingID ${c.NextDayBookingID}]`
        : '';
      console.log(
        `[Booking ${c.BookingID}${c.BookingCode ? ` / ${c.BookingCode}` : ''}] ` +
          `${c.EmpName} | ${c.BookingDate} ${c.StartTime}-${c.EndTime} ` +
          `| shift ${c.ScheduleStart}-${c.ScheduleEnd} ` +
          `| suggest: ${c.SuggestedBookingDate}${dupInfo}`,
      );
    }
    console.log('');
  }

  if (outsideShift.length > 0) {
    console.log('--- Post-midnight bookings with non-overnight schedule (anomalies) ---');
    for (const c of outsideShift) {
      console.log(
        `[Booking ${c.BookingID}${c.BookingCode ? ` / ${c.BookingCode}` : ''}] ` +
          `${c.EmpName} | ${c.BookingDate} ${c.StartTime}-${c.EndTime} ` +
          `| schedule ${c.ScheduleStart}-${c.ScheduleEnd} (${c.IsOvernightSchedule ? 'overnight' : 'same-day'})`,
      );
    }
    console.log('');
  }

  const reportPath = path.resolve(process.cwd(), 'scripts', 'audit-post-midnight-bookings-report.json');
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      auditStart,
      auditEnd,
      postMidnightEndHour: POST_MIDNIGHT_END_HOUR,
      mode: 'read-only',
    },
    summary: {
      totalScanned: candidates.length,
      likelyWrongDateCount: likelyWrong.length,
      outsideShiftCount: outsideShift.length,
      probablyCorrectCount: candidates.length - likelyWrong.length - outsideShift.length,
    },
    candidates,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Detailed report written to: ${reportPath}`);

  // 6. Safety check: ensure no writes happened
  console.log('\nAudit completed. No database changes were made.');
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
