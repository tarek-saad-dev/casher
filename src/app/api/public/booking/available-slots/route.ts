import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';

export type DurationSource =
  | 'EMP_SERVICE_OVERRIDE'   // TblEmpServiceSettings
  | 'SERVICE_DEFAULT'        // TblPro.DurationMinutes
  | 'SYSTEM_DEFAULT'         // QueueBookingSettings.DefaultServiceDurationMinutes
  | 'HARDCODED_FALLBACK';    // 30 min

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/available-slots
 *
 * Batch-optimised — all DB I/O runs ONCE before the slot loop.
 * Supports per-barber service duration overrides via TblEmpServiceSettings.
 *
 * Duration resolution order (per barber per service):
 *   1. TblEmpServiceSettings.DurationMinutes  (EMP_SERVICE_OVERRIDE)
 *   2. TblPro.DurationMinutes                 (SERVICE_DEFAULT)
 *   3. QueueBookingSettings.DefaultServiceDurationMinutes (SYSTEM_DEFAULT)
 *   4. 30 min hardcoded                       (HARDCODED_FALLBACK)
 *
 * Query params:
 *   date       = "2026-05-19"
 *   serviceIds = "1049,1050"
 *   mode       = "nearest" | "specific"
 *   empId      = number (required for mode=specific)
 */
export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const date         = searchParams.get('date') ?? '';
    const serviceParam = searchParams.get('serviceIds') ?? '';
    const mode         = (searchParams.get('mode') ?? 'nearest') as 'nearest' | 'specific';
    const empIdParam   = searchParams.get('empId');

    if (!date || !isValidDate(date)) {
      return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const serviceIds = serviceParam
      ? serviceParam.split(',').map(Number).filter(n => n > 0)
      : [];
    const empId = empIdParam ? Number(empIdParam) : null;

    if (mode === 'specific' && !empId) {
      return NextResponse.json({ error: 'empId مطلوب في وضع specific' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const settings  = await getPublicSettings();
    const db        = await getPool();
    const nowMs     = Date.now();
    const minNotice = settings.minNoticeMinutes;
    const systemDefault = settings.defaultServiceDurationMinutes || 30;

    // ── 1. Resolve barbers ────────────────────────────────────────────────────
    const barberIds: number[] = empId ? [empId] : await getAllBarberIds(db);
    if (!barberIds.length) {
      return NextResponse.json({
        ok: true, date, mode,
        serviceDurationMinutes: systemDefault,
        durationSource: 'SYSTEM_DEFAULT' as DurationSource,
        slots: [],
      }, { headers: PUBLIC_CORS_HEADERS });
    }
    const nameMap = await getBarberNames(db, barberIds);
    const barberIdList = barberIds.join(',');
    const dayOfWeek    = new Date(`${date}T12:00:00`).getDay();

    // ── 2. Batch load all duration data (2 queries) ───────────────────────────

    // 2a. TblPro base durations for selected services
    const proDurMap: Record<number, number | null> = {};
    if (serviceIds.length) {
      const proRes = await db.request().query(`
        SELECT ProID, DurationMinutes FROM dbo.TblPro
        WHERE ProID IN (${serviceIds.join(',')})
      `).catch(() => ({ recordset: [] as any[] }));
      for (const r of proRes.recordset) proDurMap[r.ProID] = r.DurationMinutes ?? null;
    }

    // 2b. Per-barber overrides from TblEmpServiceSettings
    // Shape: empOverrides[empId][proId] = durationMinutes
    const empOverrides: Record<number, Record<number, number>> = {};
    if (serviceIds.length) {
      const ovRes = await db.request().query(`
        SELECT EmpID, ProID, DurationMinutes FROM dbo.TblEmpServiceSettings
        WHERE EmpID IN (${barberIdList})
          AND ProID IN (${serviceIds.join(',')})
          AND IsActive = 1
      `).catch(() => ({ recordset: [] as any[] }));
      for (const r of ovRes.recordset) {
        (empOverrides[r.EmpID] ??= {})[r.ProID] = r.DurationMinutes;
      }
    }

    // ── 3. Compute per-barber total duration + source ─────────────────────────
    const barberDuration: Record<number, { minutes: number; source: DurationSource }> = {};
    for (const bid of barberIds) {
      barberDuration[bid] = resolveBarberDuration(bid, serviceIds, empOverrides, proDurMap, systemDefault);
    }

    // ── 4. Batch preload schedules (1 query) ──────────────────────────────────
    const schedRes = await db.request().query(`
      SELECT EmpID, IsWorkingDay, StartTime, EndTime
      FROM dbo.TblEmpWorkSchedule
      WHERE EmpID IN (${barberIdList}) AND DayOfWeek = ${dayOfWeek}
    `).catch(() => ({ recordset: [] as any[] }));

    const scheduleMap: Record<number, { isWorking: boolean; start: string; end: string }> = {};
    for (const r of schedRes.recordset) {
      scheduleMap[r.EmpID] = {
        isWorking: !!r.IsWorkingDay,
        start: fmtTime(r.StartTime) ?? '09:00',
        end:   fmtTime(r.EndTime)   ?? '23:00',
      };
    }

    // ── 5. Batch preload day-offs (1 query) ───────────────────────────────────
    const dayOffSet = new Set<number>();
    try {
      const doRes = await db.request()
        .input('offDate', sql.Date, date)
        .query(`
          SELECT EmpID FROM dbo.TblEmpDayOff
          WHERE EmpID IN (${barberIdList}) AND OffDate = @offDate AND IsDeleted = 0
        `);
      for (const r of doRes.recordset) dayOffSet.add(r.EmpID);
    } catch { /* table may not exist */ }

    // ── 6. Batch preload queue tickets (1 query) ──────────────────────────────
    const queueRes = await db.request()
      .input('qdate', sql.Date, date)
      .query(`
        SELECT EmpID, ServiceStartedAt, ISNULL(DurationMinutes, ${systemDefault}) AS DurationMinutes
        FROM dbo.QueueTickets
        WHERE EmpID IN (${barberIdList})
          AND QueueDate = @qdate
          AND LOWER(Status) IN ('waiting','called','arrived','in_service')
        ORDER BY EmpID,
          CASE WHEN LOWER(Status)='in_service' THEN 0 ELSE 1 END ASC,
          QueueTicketID ASC
      `).catch(() => ({ recordset: [] as any[] }));

    // ── 7. Batch preload bookings (1 query) ───────────────────────────────────
    const bookingRes = await db.request()
      .input('bdate', sql.Date, date)
      .query(`
        SELECT AssignedEmpID AS EmpID, StartTime, EndTime
        FROM dbo.Bookings
        WHERE AssignedEmpID IN (${barberIdList})
          AND BookingDate = @bdate
          AND LOWER(Status) IN ('confirmed','arrived','queued','in_service')
        ORDER BY AssignedEmpID, StartTime ASC
      `).catch(() => ({ recordset: [] as any[] }));

    // ── 8. Build per-barber blocker maps in memory ────────────────────────────
    const blockersMap: Record<number, Array<{ startMs: number; endMs: number }>> = {};
    for (const id of barberIds) blockersMap[id] = [];

    const realNow = new Date(nowMs);

    const queueByBarber: Record<number, any[]> = {};
    for (const r of queueRes.recordset) (queueByBarber[r.EmpID] ??= []).push(r);

    for (const [eid, tickets] of Object.entries(queueByBarber)) {
      const id = Number(eid);
      let cursor = realNow;
      for (const t of tickets) {
        const dur   = Math.max(1, Number(t.DurationMinutes) || systemDefault);
        const start = t.ServiceStartedAt ? new Date(t.ServiceStartedAt) : new Date(cursor);
        const end   = new Date(start.getTime() + dur * 60_000);
        blockersMap[id].push({ startMs: start.getTime(), endMs: end.getTime() });
        if (end > cursor) cursor = end;
      }
    }

    for (const r of bookingRes.recordset) {
      const id    = r.EmpID as number;
      const start = sqlTimeToDateMs(date, r.StartTime);
      // Use this barber's own resolved duration as fallback for bookings without EndTime
      const fallbackDurMs = (barberDuration[id]?.minutes ?? systemDefault) * 60_000;
      const end   = r.EndTime ? sqlTimeToDateMs(date, r.EndTime) : start + fallbackDurMs;
      blockersMap[id].push({ startMs: start, endMs: end });
    }

    for (const id of barberIds) {
      blockersMap[id].sort((a, b) => a.startMs - b.startMs);
    }

    const dbTimeMs = Date.now() - t0;

    // ── 9. Generate slot grid and check availability in memory ────────────────
    const slotTimes = generateSlots('09:00', '23:00', settings.slotIntervalMinutes);
    const slots: any[] = [];

    for (const time of slotTimes) {
      const slotMs = new Date(`${date}T${time}:00`).getTime();
      const label  = formatTimeLabel(time);

      if (slotMs - nowMs < minNotice * 60_000) continue;

      if (mode === 'specific' && empId) {
        const { minutes: durMin } = barberDuration[empId];
        const slotEndMs = slotMs + durMin * 60_000;
        const sched     = scheduleMap[empId];

        if (dayOffSet.has(empId)) {
          slots.push({ time, label, available: false, reason: 'إجازة' });
          continue;
        }
        if (sched) {
          if (!sched.isWorking) {
            slots.push({ time, label, available: false, reason: 'إجازة أسبوعية' });
            continue;
          }
          if (!withinWindow(slotMs, date, sched.start, sched.end)) {
            slots.push({ time, label, available: false, reason: `خارج ساعات العمل (${sched.start} - ${sched.end})` });
            continue;
          }
        }

        if (findConflict(blockersMap[empId] ?? [], slotMs, slotEndMs)) {
          slots.push({ time, label, available: false, reason: 'الوقت محجوز' });
        } else {
          slots.push({ time, label, available: true, empId, barberName: nameMap[empId] ?? '' });
        }

      } else {
        // Nearest: each barber uses its own duration
        let bestId     = 0;
        let bestName   = '';
        let bestDurMin = systemDefault;
        let bestSource: DurationSource = 'SYSTEM_DEFAULT';

        for (const bid of barberIds) {
          if (dayOffSet.has(bid)) continue;
          const sched = scheduleMap[bid];
          if (sched) {
            if (!sched.isWorking) continue;
            if (!withinWindow(slotMs, date, sched.start, sched.end)) continue;
          }
          const { minutes: durMin, source } = barberDuration[bid];
          if (!findConflict(blockersMap[bid] ?? [], slotMs, slotMs + durMin * 60_000)) {
            bestId     = bid;
            bestName   = nameMap[bid] ?? '';
            bestDurMin = durMin;
            bestSource = source;
            break;
          }
        }

        if (bestId) {
          slots.push({
            time, label, available: true,
            empId: bestId, barberName: bestName,
            durationMinutes: bestDurMin, durationSource: bestSource,
          });
        } else {
          slots.push({ time, label, available: false, reason: 'لا يوجد حلاق متاح' });
        }
      }
    }

    const totalMs = Date.now() - t0;
    const { minutes: respDurMin, source: respDurSource } =
      mode === 'specific' && empId
        ? barberDuration[empId]
        : { minutes: systemDefault, source: 'SYSTEM_DEFAULT' as DurationSource };

    console.log(
      `[available-slots] ${mode} date=${date} empId=${empId ?? 'any'} ` +
      `dur=${respDurMin}min src=${respDurSource} dbMs=${dbTimeMs} totalMs=${totalMs} slots=${slots.length}`
    );

    return NextResponse.json({
      ok:   true,
      date,
      mode,
      serviceDurationMinutes: respDurMin,
      durationSource:         respDurSource,
      ...(mode === 'specific' && empId ? { empId } : {}),
      slots,
    }, { headers: PUBLIC_CORS_HEADERS });

  } catch (err) {
    console.error('[public/booking/available-slots]', err);
    return NextResponse.json({ error: 'فشل تحميل المواعيد' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

// ── Duration resolution ───────────────────────────────────────────────────────

/**
 * Resolve total duration for a barber across all selected services.
 * For each service: EmpServiceOverride → TblPro.DurationMinutes → systemDefault.
 * Sum across all services.
 */
function resolveBarberDuration(
  empId: number,
  serviceIds: number[],
  empOverrides: Record<number, Record<number, number>>,
  proDurMap: Record<number, number | null>,
  systemDefault: number,
): { minutes: number; source: DurationSource } {
  if (!serviceIds.length) {
    return { minutes: systemDefault, source: 'SYSTEM_DEFAULT' };
  }

  let total = 0;
  let hasOverride   = false;
  let hasProDefault = false;

  for (const proId of serviceIds) {
    const override = empOverrides[empId]?.[proId];
    if (override != null) {
      total += override;
      hasOverride = true;
    } else {
      const proDur = proDurMap[proId];
      if (proDur != null && proDur > 0) {
        total += proDur;
        hasProDefault = true;
      } else {
        total += systemDefault;
      }
    }
  }

  const source: DurationSource =
    hasOverride   ? 'EMP_SERVICE_OVERRIDE' :
    hasProDefault ? 'SERVICE_DEFAULT'      :
                    'SYSTEM_DEFAULT';

  return { minutes: total > 0 ? total : systemDefault, source };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  return null;
}

function sqlTimeToDateMs(dateStr: string, timeVal: unknown): number {
  return new Date(`${dateStr}T${fmtTime(timeVal) ?? '00:00'}:00`).getTime();
}

function findConflict(blockers: Array<{ startMs: number; endMs: number }>, slotMs: number, slotEndMs: number): boolean {
  for (const b of blockers) {
    if (slotMs < b.endMs && slotEndMs > b.startMs) return true;
  }
  return false;
}

function withinWindow(slotMs: number, dateStr: string, startHHMM: string, endHHMM: string): boolean {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const startMs  = new Date(`${dateStr}T${startHHMM}:00`).getTime();
  let   endMs    = new Date(`${dateStr}T${endHHMM}:00`).getTime();
  if (eh * 60 + em <= sh * 60 + sm) endMs += 24 * 3600_000;
  return slotMs >= startMs && slotMs < endMs;
}

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period  = h >= 12 ? 'PM' : 'AM';
  const h12     = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

function generateSlots(start: string, end: string, intervalMin: number): string[] {
  const times: string[] = [];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const overnight = eh * 60 + em <= sh * 60 + sm;
  const endTotal  = overnight ? (eh + 24) * 60 + em : eh * 60 + em;
  let cur = sh * 60 + sm;
  while (cur < endTotal) {
    const tod  = cur % (24 * 60);
    times.push(`${String(Math.floor(tod / 60)).padStart(2, '0')}:${String(tod % 60).padStart(2, '0')}`);
    cur += intervalMin;
  }
  return times;
}

async function getAllBarberIds(db: any): Promise<number[]> {
  const res = await db.request().query(`
    SELECT EmpID FROM dbo.TblEmp
    WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
    ORDER BY EmpName
  `).catch(() => ({ recordset: [] as any[] }));
  return res.recordset.map((r: any) => r.EmpID as number);
}

async function getBarberNames(db: any, ids: number[]): Promise<Record<number, string>> {
  if (!ids.length) return {};
  const res = await db.request().query(`
    SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID IN (${ids.join(',')})
  `).catch(() => ({ recordset: [] as any[] }));
  const map: Record<number, string> = {};
  for (const r of res.recordset) map[r.EmpID] = r.EmpName;
  return map;
}
