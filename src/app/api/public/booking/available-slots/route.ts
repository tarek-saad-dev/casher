import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
  salonDateTimeToMs,
  dateInTimezone,
} from "@/lib/publicBookingHelpers";
import {
  loadOverridesForDate,
  applyOverrides,
  slotBlockedByOverride,
  EffectiveSchedule,
} from "@/lib/scheduleOverrides";

export const runtime = "nodejs";

const DEV = process.env.NODE_ENV !== "production";

export type DurationSource =
  | "EMP_SERVICE_OVERRIDE" // TblEmpServiceSettings
  | "SERVICE_DEFAULT" // TblPro.DurationMinutes
  | "SYSTEM_DEFAULT" // QueueBookingSettings.DefaultServiceDurationMinutes
  | "HARDCODED_FALLBACK"; // 30 min

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
    return NextResponse.json(
      { error: "طلبات كثيرة" },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? "";
    const serviceParam = searchParams.get("serviceIds") ?? "";
    const mode = (searchParams.get("mode") ?? "nearest") as
      | "nearest"
      | "specific";
    const empIdParam = searchParams.get("empId");

    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { error: "تاريخ غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const serviceIds = serviceParam
      ? serviceParam
          .split(",")
          .map(Number)
          .filter((n) => n > 0)
      : [];
    const empId = empIdParam ? Number(empIdParam) : null;

    if (mode === "specific" && !empId) {
      return NextResponse.json(
        { error: "empId مطلوب في وضع specific" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const settings = await getPublicSettings();
    const db = await getPool();
    const timezone = settings.timezone || "Africa/Cairo";
    const minNotice = settings.minNoticeMinutes;
    const systemDefault = settings.defaultServiceDurationMinutes || 30;

    // ── Timezone-aware "now" ──────────────────────────────────────────────────
    // Convert current UTC time to salon's local time (Africa/Cairo)
    const serverNow = new Date();
    const nowInSalon = nowInTimezone(serverNow, timezone); // "HH:MM" in salon TZ
    const nowMinutesSinceMidnight = hhmmToMinutes(nowInSalon);

    // "today" in salon timezone
    const todayInSalon = dateInTimezone(serverNow, timezone); // "YYYY-MM-DD"
    const isToday = date === todayInSalon;
    const isPast = date < todayInSalon;

    // Minimum allowed start time for today
    const minAllowedMinutes = isToday
      ? ceilToInterval(
          nowMinutesSinceMidnight + minNotice,
          settings.slotIntervalMinutes,
        )
      : 0;
    const minimumAllowedStartTime = minutesToHHMM(minAllowedMinutes);

    if (DEV) {
      console.log("[available-slots] request:", {
        date,
        serviceIds,
        mode,
        empId,
      });
      console.log("[available-slots] config:", {
        timezone,
        slotIntervalMinutes: settings.slotIntervalMinutes,
        minNoticeMinutes: minNotice,
        maxBookingDaysAhead: settings.maxBookingDaysAhead,
      });
      console.log("[available-slots] now:", {
        serverNow,
        nowInSalonTimezone: nowInSalon,
        requestedDate: date,
        isToday,
        isPast,
        minimumAllowedStartTime,
      });
    }

    // Reject past dates immediately
    if (isPast) {
      return NextResponse.json(
        {
          ok: true,
          date,
          mode,
          serviceDurationMinutes: systemDefault,
          durationSource: "SYSTEM_DEFAULT" as DurationSource,
          slots: [],
          reason: "تاريخ مضى",
        },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }

    // ── 1. Resolve barbers ────────────────────────────────────────────────────
    const barberIds: number[] = empId ? [empId] : await getAllBarberIds(db);
    if (!barberIds.length) {
      return NextResponse.json(
        {
          ok: true,
          date,
          mode,
          serviceDurationMinutes: systemDefault,
          durationSource: "SYSTEM_DEFAULT" as DurationSource,
          slots: [],
        },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }
    const nameMap = await getBarberNames(db, barberIds);
    const barberIdList = barberIds.join(",");

    // DayOfWeek: TblEmpWorkSchedule uses 0-6 convention (0=Sunday, 6=Saturday)
    // This matches JavaScript getDay() exactly - no conversion needed
    const jsDayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const dayOfWeek = jsDayOfWeek; // 0=Sunday, 1=Monday, ..., 6=Saturday

    if (DEV) {
      console.log("[available-slots full debug] now/timezone:", {
        serverNow: serverNow.toISOString(),
        timezone,
        nowInSalonTimezone: nowInSalon,
        salonToday: todayInSalon,
        requestedDate: date,
        isToday,
        isPast,
        nowMinutesSinceMidnight,
        jsDayOfWeek,
        dayOfWeek,
      });
      console.log("[available-slots full debug] settings:", {
        minNoticeMinutes: minNotice,
        slotIntervalMinutes: settings.slotIntervalMinutes,
        maxBookingDaysAhead: settings.maxBookingDaysAhead,
        timezone,
        minimumAllowedStartTime,
      });
    }

    // ── 2. Batch load all duration data (2 queries) ───────────────────────────

    // 2a. TblPro base durations for selected services
    const proDurMap: Record<number, number | null> = {};
    if (serviceIds.length) {
      const proRes = await db
        .request()
        .query(
          `
        SELECT ProID, DurationMinutes FROM dbo.TblPro
        WHERE ProID IN (${serviceIds.join(",")})
      `,
        )
        .catch(() => ({ recordset: [] as any[] }));
      for (const r of proRes.recordset)
        proDurMap[r.ProID] = r.DurationMinutes ?? null;
    }

    // 2b. Per-barber overrides from TblEmpServiceSettings
    const empOverrides: Record<number, Record<number, number>> = {};
    if (serviceIds.length) {
      const ovRes = await db
        .request()
        .query(
          `
        SELECT EmpID, ProID, DurationMinutes FROM dbo.TblEmpServiceSettings
        WHERE EmpID IN (${barberIdList})
          AND ProID IN (${serviceIds.join(",")})
          AND IsActive = 1
      `,
        )
        .catch(() => ({ recordset: [] as any[] }));
      for (const r of ovRes.recordset) {
        (empOverrides[r.EmpID] ??= {})[r.ProID] = r.DurationMinutes;
      }
    }

    // ── 3. Compute per-barber total duration + source ─────────────────────────
    const barberDuration: Record<
      number,
      { minutes: number; source: DurationSource }
    > = {};
    for (const bid of barberIds) {
      barberDuration[bid] = resolveBarberDuration(
        bid,
        serviceIds,
        empOverrides,
        proDurMap,
        systemDefault,
      );
    }

    if (DEV)
      console.log("[available-slots] selected services:", {
        serviceIds,
        proDurMap,
        empOverrides,
      });

    // ── 4. Batch preload schedules (1 query) ──────────────────────────────────
    const schedRes = await db
      .request()
      .query(
        `
      SELECT EmpID, IsWorkingDay, StartTime, EndTime
      FROM dbo.TblEmpWorkSchedule
      WHERE EmpID IN (${barberIdList}) AND DayOfWeek = ${dayOfWeek}
    `,
      )
      .catch(() => ({ recordset: [] as any[] }));

    const scheduleMap: Record<
      number,
      { isWorking: boolean; start: string; end: string }
    > = {};
    for (const r of schedRes.recordset) {
      const start = fmtTime(r.StartTime) ?? "09:00";
      const end = fmtTime(r.EndTime) ?? "23:00";
      scheduleMap[r.EmpID] = { isWorking: !!r.IsWorkingDay, start, end };
      if (DEV)
        console.log("[available-slots full debug] barber schedule from DB:", {
          empId: r.EmpID,
          empName: nameMap[r.EmpID],
          workDate: date,
          jsDayOfWeek,
          dayOfWeek,
          isWorkingDay: r.IsWorkingDay,
          startTime: start,
          endTime: end,
          isOvernight: hhmmToMinutes(end) <= hhmmToMinutes(start),
          scheduleSource: "TblEmpWorkSchedule",
        });
    }

    // Log barbers who don't have schedule entries for this day
    if (DEV) {
      for (const bid of barberIds) {
        if (!scheduleMap[bid]) {
          console.log(
            "[available-slots full debug] barber NO schedule found:",
            {
              empId: bid,
              empName: nameMap[bid],
              workDate: date,
              jsDayOfWeek,
              dayOfWeek,
              warning: "No schedule row found - will use fallback default",
            },
          );
        }
      }
    }

    // ── 5. Batch preload day-offs (1 query) ───────────────────────────────────
    const dayOffSet = new Set<number>();
    try {
      const doRes = await db.request().input("offDate", sql.Date, date).query(`
          SELECT EmpID FROM dbo.TblEmpDayOff
          WHERE EmpID IN (${barberIdList}) AND OffDate = @offDate AND IsDeleted = 0
        `);
      for (const r of doRes.recordset) dayOffSet.add(r.EmpID);
    } catch {
      /* table may not exist */
    }

    // ── 5b. Batch preload schedule overrides (1 query) ────────────────────────
    const overridesMap = await loadOverridesForDate(db, barberIds, date);

    // Apply overrides to each barber's base schedule
    const effectiveScheduleMap: Record<number, EffectiveSchedule> = {};
    for (const bid of barberIds) {
      const base = scheduleMap[bid] ?? {
        isWorking: false,
        start: "09:00",
        end: "23:00",
      };
      const overrides = overridesMap.get(bid) ?? [];
      effectiveScheduleMap[bid] = applyOverrides(bid, date, base, overrides);
      // day_off override → treat same as TblEmpDayOff
      if (!effectiveScheduleMap[bid].isWorking) {
        dayOffSet.add(bid);
      }
    }

    // ── 6. Batch preload queue tickets (1 query) ──────────────────────────────
    // Guard optional columns: DurationMinutes and EstimatedStartTime may not exist
    const qColRes = await db
      .request()
      .query(
        `
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'QueueTickets'
        AND COLUMN_NAME IN ('DurationMinutes','EstimatedStartTime')
    `,
      )
      .catch(() => ({ recordset: [] as any[] }));
    const qCols = new Set(
      qColRes.recordset.map((r: any) => r.COLUMN_NAME as string),
    );
    const durSql = qCols.has("DurationMinutes")
      ? `ISNULL(qt.DurationMinutes, ${systemDefault})`
      : `${systemDefault}`;

    const queueRes = await db
      .request()
      .input("qdate", sql.Date, date)
      .query(
        `
        SELECT qt.EmpID, qt.ServiceStartedAt, ${durSql} AS DurationMinutes, qt.Status
        FROM dbo.QueueTickets qt
        WHERE qt.EmpID IN (${barberIdList})
          AND qt.QueueDate = @qdate
          AND LOWER(qt.Status) IN ('waiting','called','in_service')
        ORDER BY qt.EmpID,
          CASE WHEN LOWER(qt.Status)='in_service' THEN 0 ELSE 1 END ASC,
          qt.QueueTicketID ASC
      `,
      )
      .catch((e: any) => {
        console.error("[available-slots] queue query error:", e?.message ?? e);
        return { recordset: [] as any[] };
      });

    if (DEV)
      console.log(
        "[available-slots] active queue tickets:",
        queueRes.recordset,
      );

    // ── 7. Batch preload bookings (1 query) ───────────────────────────────────
    const bookingRes = await db
      .request()
      .input("bdate", sql.Date, date)
      .query(
        `
        SELECT AssignedEmpID AS EmpID, StartTime, EndTime, Status, BookingCode
        FROM dbo.Bookings
        WHERE AssignedEmpID IN (${barberIdList})
          AND BookingDate = @bdate
          AND LOWER(Status) IN ('confirmed','arrived','queued','in_service')
        ORDER BY AssignedEmpID, StartTime ASC
      `,
      )
      .catch(() => ({ recordset: [] as any[] }));

    // ── 8. Build per-barber blocker maps in memory ────────────────────────────
    const blockersMap: Record<
      number,
      Array<{ startMs: number; endMs: number; label: string }>
    > = {};
    for (const id of barberIds) blockersMap[id] = [];

    const queueByBarber: Record<
      number,
      Array<{
        DurationMinutes: number;
        ServiceStartedAt: string | null;
        Status: string;
      }>
    > = {};
    for (const r of queueRes.recordset) (queueByBarber[r.EmpID] ??= []).push(r);

    const queueBlocks: Record<
      number,
      Array<{ start: string; end: string; durationMin: number }>
    > = {};
    for (const [eid, tickets] of Object.entries(queueByBarber)) {
      const id = Number(eid);
      let cursorMs = serverNow.getTime();
      queueBlocks[id] = [];
      for (const t of tickets) {
        const dur = Math.max(1, Number(t.DurationMinutes) || systemDefault);
        const startMs = t.ServiceStartedAt
          ? new Date(t.ServiceStartedAt).getTime()
          : cursorMs;
        const endMs = startMs + dur * 60_000;
        blockersMap[id].push({ startMs, endMs, label: "queue" });
        queueBlocks[id].push({
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          durationMin: dur,
        });
        if (endMs > cursorMs) cursorMs = endMs;
      }
    }

    const bookingBlocks: Record<
      number,
      Array<{ start: string; end: string; bookingCode?: string }>
    > = {};
    for (const r of bookingRes.recordset) {
      const id = r.EmpID as number;
      // IMPORTANT: Use salon timezone-aware epoch calculation to match slot checking
      // sqlTimeToDateMs uses local server time which causes timezone mismatches
      const startMs = salonDateTimeToMs(
        date,
        fmtTime(r.StartTime) ?? "00:00",
        timezone,
      );
      const fallbackDurMs =
        (barberDuration[id]?.minutes ?? systemDefault) * 60_000;
      const endMs = r.EndTime
        ? salonDateTimeToMs(date, fmtTime(r.EndTime) ?? "00:00", timezone)
        : startMs + fallbackDurMs;
      blockersMap[id].push({ startMs, endMs, label: "booking" });
      (bookingBlocks[id] ??= []).push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        bookingCode: r.BookingCode,
      });
    }

    if (DEV) {
      console.log("[available-slots blockers] booking blocks:", bookingBlocks);
    }

    // ── 8b. Inject block_range override intervals into blockersMap ──────────────
    for (const bid of barberIds) {
      for (const iv of effectiveScheduleMap[bid]?.blockedIntervals ?? []) {
        blockersMap[bid].push({
          startMs: iv.startMs,
          endMs: iv.endMs,
          label: "override",
        });
      }
    }

    for (const id of barberIds) {
      blockersMap[id].sort((a, b) => a.startMs - b.startMs);
    }

    if (DEV) {
      for (const id of barberIds) {
        if (bookingBlocks[id]?.length)
          console.log("[available-slots] booking blocking timeline:", {
            empId: id,
            blocks: bookingBlocks[id],
          });
        if (queueBlocks[id]?.length)
          console.log("[available-slots] queue blocking timeline:", {
            empId: id,
            blocks: queueBlocks[id],
          });
        if (blockersMap[id]?.length)
          console.log("[available-slots] blocked intervals:", {
            empId: id,
            count: blockersMap[id].length,
          });
      }
    }

    const dbTimeMs = Date.now() - t0;

    // ── 9. Generate slots per barber using their own schedule ─────────────────
    // We collect all unique slot times across all active barbers, then check each.
    // For specific mode: only the requested barber's schedule.
    // For nearest mode: union of all barbers' schedules.

    // slotMap: HH:MM → dayOffset (0=same day, 1=next day for overnight post-midnight slots)
    const slotMap = new Map<string, 0 | 1>();
    const activeBarbers = barberIds.filter((id) => !dayOffSet.has(id));

    // Track generated slots per barber for detailed debugging
    const generatedSlotsByBarber: Record<
      number,
      Array<{ time: string; dayOffset: 0 | 1 }>
    > = {};

    for (const bid of activeBarbers) {
      // Use effective schedule (post-override) for slot generation
      const effSched = effectiveScheduleMap[bid];
      const sched = effSched ?? scheduleMap[bid];
      if (!sched || !sched.isWorking) {
        if (DEV) {
          console.log(
            "[available-slots full debug] barber skipped - not working:",
            {
              empId: bid,
              empName: nameMap[bid],
              hasSchedule: !!sched,
              isWorking: sched?.isWorking,
            },
          );
        }
        continue;
      }
      const barberSlots = generateSlots(
        sched.start,
        sched.end,
        settings.slotIntervalMinutes,
      );
      generatedSlotsByBarber[bid] = barberSlots;
      if (DEV) {
        console.log(
          "[available-slots full debug] generated slots for barber:",
          {
            empId: bid,
            empName: nameMap[bid],
            scheduleStart: sched.start,
            scheduleEnd: sched.end,
            totalGenerated: barberSlots.length,
            first20: barberSlots.slice(0, 20).map((s) => s.time),
            last10: barberSlots.slice(-10).map((s) => s.time),
          },
        );
      }
      for (const { time, dayOffset } of barberSlots) {
        // Prefer dayOffset=0 if two barbers share the same HH:MM at different offsets
        if (!slotMap.has(time) || dayOffset < slotMap.get(time)!) {
          slotMap.set(time, dayOffset);
        }
      }
    }

    // Sort: day-0 slots chronologically first, then day-1 (overnight) slots chronologically
    const sortedSlots = [...slotMap.entries()].sort(([aT, aD], [bT, bD]) =>
      aD !== bD ? aD - bD : aT.localeCompare(bT),
    );

    if (DEV) {
      const overnightSlots = sortedSlots.filter(([, d]) => d === 1);
      console.log("[available-slots] generated range:", {
        firstGeneratedSlot: sortedSlots[0]?.[0],
        lastGeneratedSlot: sortedSlots[sortedSlots.length - 1]?.[0],
        totalGeneratedSlots: sortedSlots.length,
        overnightSlotsCount: overnightSlots.length,
      });
      if (overnightSlots.length)
        console.log(
          "[available-slots overnight] post-midnight slots:",
          overnightSlots.map(([t]) => t),
        );
    }

    const slots: Array<{
      time: string;
      label: string;
      available: boolean;
      dayOffset: 0 | 1;
      empId?: number;
      barberName?: string;
      durationMinutes?: number;
      durationSource?: DurationSource;
      reason?: string;
    }> = [];

    let removedPast = 0;
    let removedNotice = 0;

    // Track all slot checks for detailed debugging (11 AM to 5 PM)
    const slotChecks: Array<{
      time: string;
      dayOffset: 0 | 1;
      slotStartMs: number;
      slotEndMs: number;
      available: boolean;
      rejected: boolean;
      reason?: string;
      outsideWorkingHours?: boolean;
      exceedsShiftEnd?: boolean;
      overlapsBooking?: boolean;
      overlapsQueue?: boolean;
      overlapsOverride?: boolean;
      empId?: number;
      empName?: string;
    }> = [];

    for (const [time, dayOffset] of sortedSlots) {
      const label = formatTimeLabel(time);

      // Correct epoch: post-midnight overnight slots belong to the next calendar day.
      // This fixes the core bug: 00:15 on an overnight shift is date+1T00:15, NOT dateT00:15.
      const slotDate = dayOffset === 1 ? nextDate(date) : date;
      // Use timezone-aware epoch so comparison with serverNow is apples-to-apples.
      // Plain new Date(`${date}T${time}:00`) parses in SERVER local TZ which may differ
      // from salon TZ (e.g., server=UTC, salon=Africa/Cairo=UTC+3 → 3h error).
      const slotDateMs = salonDateTimeToMs(slotDate, time, timezone);

      // ── Today: skip past/minNotice slots using FULL epoch (not minutes-only) ──
      // Must use epoch so overnight post-midnight slots (dayOffset=1, always tomorrow)
      // are never wrongly discarded as "past" because their HH:MM < nowMinutes.
      if (isToday) {
        if (slotDateMs <= serverNow.getTime()) {
          removedPast++;
          continue;
        }
        if (slotDateMs < serverNow.getTime() + minNotice * 60_000) {
          removedNotice++;
          continue;
        }
      }

      if (mode === "specific" && empId) {
        const { minutes: durMin } = barberDuration[empId];
        const effSched = effectiveScheduleMap[empId];
        const sched = effSched ?? scheduleMap[empId];

        // Track detailed slot check
        const slotEndMs = slotDateMs + durMin * 60_000;
        let slotCheckReason = "";
        let slotRejected = false;
        let outsideWorkingHours = false;
        let exceedsShiftEnd = false;
        let overlapsBooking = false;
        let overlapsQueue = false;
        let overlapsOverride = false;

        if (dayOffSet.has(empId)) {
          slotRejected = true;
          slotCheckReason = "day_off";
        } else if (!sched || !sched.isWorking) {
          slotRejected = true;
          slotCheckReason = "not_working";
        } else if (
          !withinWindow(slotDateMs, date, sched.start, sched.end, timezone)
        ) {
          slotRejected = true;
          slotCheckReason = "outside_working_hours";
          outsideWorkingHours = true;
        } else {
          // Last slot must end within shift
          if (
            !slotEndFitsInShift(
              slotEndMs,
              date,
              sched.start,
              sched.end,
              timezone,
            )
          ) {
            slotRejected = true;
            slotCheckReason = "exceeds_shift_end";
            exceedsShiftEnd = true;
          } else {
            // Check block_range override intervals first
            const overrideBlock = effSched
              ? slotBlockedByOverride(slotDateMs, slotEndMs, effSched)
              : null;
            const conflict = overrideBlock
              ? true
              : findConflict(blockersMap[empId] ?? [], slotDateMs, slotEndMs);

            if (overrideBlock) {
              slotRejected = true;
              slotCheckReason = "override_block";
              overlapsOverride = true;
            } else if (conflict) {
              slotRejected = true;
              slotCheckReason = "already_booked";

              // Detailed diagnostic logging for conflicting slots
              if (DEV) {
                const blockersForThisBarber = blockersMap[empId] ?? [];
                console.log("[available-slots] CONFLICT slot check:", {
                  empId,
                  slotTime: time,
                  slotStartMs: slotDateMs,
                  slotEndMs,
                  slotISO: new Date(slotDateMs).toISOString(),
                  blockersCount: blockersForThisBarber.length,
                  blockers: blockersForThisBarber.map((b: any) => ({
                    type: b.type,
                    id: b.id,
                    empId: b.empId,
                    startMs: b.startMs,
                    endMs: b.endMs,
                    startISO: new Date(b.startMs).toISOString(),
                    endISO: new Date(b.endMs).toISOString(),
                    status: b.status,
                    source: b.source,
                  })),
                });
              }

              // Find what type of blocker
              const blocker = (blockersMap[empId] ?? []).find(
                (b) => slotDateMs < b.endMs && slotEndMs > b.startMs,
              );
              if (blocker?.label === "booking") overlapsBooking = true;
              if (blocker?.label === "queue") overlapsQueue = true;
              if (blocker?.label === "override") overlapsOverride = true;
            }
          }
        }

        // Add to tracking array for debugging (only for slots 09:00-23:00)
        const timeMinutes = hhmmToMinutes(time);
        if (timeMinutes >= 540 && timeMinutes <= 1380) {
          // 09:00 to 23:00
          slotChecks.push({
            time,
            dayOffset,
            slotStartMs: slotDateMs,
            slotEndMs,
            available: !slotRejected,
            rejected: slotRejected,
            reason: slotCheckReason,
            outsideWorkingHours,
            exceedsShiftEnd,
            overlapsBooking,
            overlapsQueue,
            overlapsOverride,
            empId,
            empName: nameMap[empId] ?? "",
          });
        }

        // Handle slot result
        if (dayOffSet.has(empId)) {
          const overrideReason = overridesMap
            .get(empId)
            ?.find((o) => o.Type === "day_off");
          slots.push({
            time,
            label,
            available: false,
            dayOffset,
            reason: overrideReason ? "employee_day_off" : "إجازة",
          });
          continue;
        }
        if (!sched || !sched.isWorking) {
          slots.push({
            time,
            label,
            available: false,
            dayOffset,
            reason: "إجازة أسبوعية",
          });
          continue;
        }
        if (outsideWorkingHours) {
          continue; // outside this barber's effective shift — skip entirely
        }
        if (exceedsShiftEnd) {
          if (DEV)
            console.log("[available-slots] slot check:", {
              time,
              dayOffset,
              reason: "exceeds shift end",
              slotEnd: new Date(slotEndMs).toISOString(),
            });
          continue;
        }

        // Check block_range override intervals first
        const overrideBlock = effSched
          ? slotBlockedByOverride(slotDateMs, slotEndMs, effSched)
          : null;
        const conflict = overrideBlock
          ? true
          : findConflict(blockersMap[empId] ?? [], slotDateMs, slotEndMs);

        if (conflict) {
          slots.push({
            time,
            label,
            available: false,
            dayOffset,
            reason: overrideBlock ?? "الوقت محجوز",
          });
        } else {
          // Correlation log — compare with [booking/plan] slot correlation
          console.log("[available-slots] slot available", {
            endpoint: "available-slots",
            date,
            empId,
            empName: nameMap[empId] ?? "",
            serviceIds,
            duration: durMin,
            returnedSlot: {
              time,
              dayOffset,
              startMs: slotDateMs,
              endMs: slotEndMs,
            },
            workingWindow: { start: sched?.start, end: sched?.end },
            blockersCount: blockersMap[empId]?.length ?? 0,
            timezone,
          });
          slots.push({
            time,
            label,
            available: true,
            dayOffset,
            empId,
            barberName: nameMap[empId] ?? "",
            durationMinutes: durMin,
          });
        }
      } else {
        // Nearest: pick first available barber at this slot
        let bestId = 0;
        let bestName = "";
        let bestDurMin = systemDefault;
        let bestSource: DurationSource = "SYSTEM_DEFAULT";

        for (const bid of activeBarbers) {
          const effSchedN = effectiveScheduleMap[bid];
          const sched = effSchedN ?? scheduleMap[bid];
          if (!sched || !sched.isWorking) continue;
          if (!withinWindow(slotDateMs, date, sched.start, sched.end, timezone))
            continue;

          const { minutes: durMin, source } = barberDuration[bid];
          const slotEndMs = slotDateMs + durMin * 60_000;

          if (
            !slotEndFitsInShift(
              slotEndMs,
              date,
              sched.start,
              sched.end,
              timezone,
            )
          )
            continue;
          // Check override block_range intervals
          if (
            effSchedN &&
            slotBlockedByOverride(slotDateMs, slotEndMs, effSchedN)
          )
            continue;
          if (findConflict(blockersMap[bid] ?? [], slotDateMs, slotEndMs))
            continue;

          bestId = bid;
          bestName = nameMap[bid] ?? "";
          bestDurMin = durMin;
          bestSource = source;
          break;
        }

        if (bestId) {
          slots.push({
            time,
            label,
            available: true,
            dayOffset,
            empId: bestId,
            barberName: bestName,
            durationMinutes: bestDurMin,
            durationSource: bestSource,
          });
        } else {
          slots.push({
            time,
            label,
            available: false,
            dayOffset,
            reason: "لا يوجد حلاق متاح",
          });
        }
      }
    }

    const totalMs = Date.now() - t0;
    const { minutes: respDurMin, source: respDurSource } =
      mode === "specific" && empId
        ? barberDuration[empId]
        : {
            minutes: systemDefault,
            source: "SYSTEM_DEFAULT" as DurationSource,
          };

    if (DEV) {
      console.log("[available-slots] past-slot filter summary:", {
        requestedDate: date,
        salonNow: nowInSalon,
        minNoticeMinutes: minNotice,
        isToday,
        originalSlotsCount: sortedSlots.length,
        filteredSlotsCount: slots.length,
        removedPastSlotsCount: removedPast,
        removedMinNoticeSlotsCount: removedNotice,
      });
      console.log("[available-slots] final slots:", {
        total: slots.length,
        available: slots.filter((s) => s.available).length,
        unavailable: slots.filter((s) => !s.available).length,
        first: slots[0],
        last: slots[slots.length - 1],
      });
      const overnightFinal = slots.filter((s) => s.dayOffset === 1);
      if (overnightFinal.length)
        console.log(
          "[available-slots overnight] final post-midnight slots:",
          overnightFinal,
        );

      // Print detailed slot table for debugging (specific mode only)
      if (mode === "specific" && empId && slotChecks.length > 0) {
        const rejectedSlots = slotChecks.filter((s) => s.rejected);
        console.log(
          `[available-slots full debug] Slot checks for ${nameMap[empId]} (${empId}):`,
        );
        console.log(
          `Total slots checked: ${slotChecks.length}, Rejected: ${rejectedSlots.length}`,
        );
        console.table(
          slotChecks.map((s) => ({
            time: s.time,
            available: s.available,
            rejected: s.rejected,
            reason: s.reason || "",
            outsideWH: s.outsideWorkingHours ? "YES" : "",
            exceedsEnd: s.exceedsShiftEnd ? "YES" : "",
            booking: s.overlapsBooking ? "YES" : "",
            queue: s.overlapsQueue ? "YES" : "",
            override: s.overlapsOverride ? "YES" : "",
          })),
        );
        if (rejectedSlots.length > 0) {
          console.log("[available-slots full debug] REJECTED slots summary:");
          const rejectionReasons = rejectedSlots.reduce(
            (acc, s) => {
              acc[s.reason || "unknown"] =
                (acc[s.reason || "unknown"] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          );
          console.table(rejectionReasons);
        }
      }
    }

    console.log(
      `[available-slots] ${mode} date=${date} empId=${empId ?? "any"} ` +
        `dur=${respDurMin}min src=${respDurSource} dbMs=${dbTimeMs} totalMs=${totalMs} ` +
        `slots=${slots.length} available=${slots.filter((s) => s.available).length} ` +
        `isToday=${isToday} minAllowed=${minimumAllowedStartTime}`,
    );

    return NextResponse.json(
      {
        ok: true,
        date,
        mode,
        serviceDurationMinutes: respDurMin,
        durationSource: respDurSource,
        ...(mode === "specific" && empId ? { empId } : {}),
        slots,
      },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[public/booking/available-slots]", err);
    return NextResponse.json(
      { error: "فشل تحميل المواعيد" },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

// ── Duration resolution ───────────────────────────────────────────────────────

function resolveBarberDuration(
  empId: number,
  serviceIds: number[],
  empOverrides: Record<number, Record<number, number>>,
  proDurMap: Record<number, number | null>,
  systemDefault: number,
): { minutes: number; source: DurationSource } {
  if (!serviceIds.length) {
    return { minutes: systemDefault, source: "SYSTEM_DEFAULT" };
  }

  let total = 0;
  let hasOverride = false;
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

  const source: DurationSource = hasOverride
    ? "EMP_SERVICE_OVERRIDE"
    : hasProDefault
      ? "SERVICE_DEFAULT"
      : "SYSTEM_DEFAULT";

  return { minutes: total > 0 ? total : systemDefault, source };
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

/** Returns "HH:MM" of the current time in the given IANA timezone. */
function nowInTimezone(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  } catch {
    // Fallback: UTC
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Round minutes up to the nearest interval boundary. */
function ceilToInterval(minutes: number, interval: number): number {
  return Math.ceil(minutes / interval) * interval;
}

/**
 * fmtTime: extract "HH:MM" from a SQL time field.
 * SQL Server `time` columns arrive as Date objects with UTC epoch (1970-01-01T HH:MM:SS Z).
 * We must use getUTCHours/getUTCMinutes to avoid local TZ shift.
 */
function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  return null;
}

function findConflict(
  blockers: Array<{ startMs: number; endMs: number }>,
  slotMs: number,
  slotEndMs: number,
): boolean {
  for (const b of blockers) {
    if (slotMs < b.endMs && slotEndMs > b.startMs) return true;
  }
  return false;
}

/**
 * Returns true if slotMs falls within [shiftStart, shiftEnd).
 * For overnight shifts (endHHMM <= startHHMM), shiftEnd is placed on date+1.
 * slotMs for post-midnight slots is already epoch of date+1, so comparison is correct.
 * CRITICAL: Uses timezone-aware epoch calculation to avoid server/salon TZ mismatches.
 */
function withinWindow(
  slotMs: number,
  dateStr: string,
  startHHMM: string,
  endHHMM: string,
  timezone: string,
): boolean {
  const shiftStartMs = salonDateTimeToMs(dateStr, startHHMM, timezone);
  const isOvernight = hhmmToMinutes(endHHMM) <= hhmmToMinutes(startHHMM);
  const shiftEndMs = isOvernight
    ? salonDateTimeToMs(nextDate(dateStr), endHHMM, timezone)
    : salonDateTimeToMs(dateStr, endHHMM, timezone);
  return slotMs >= shiftStartMs && slotMs < shiftEndMs;
}

/**
 * Checks that slotEnd epoch does not exceed shiftEnd epoch.
 * Requires startHHMM to detect overnight shifts correctly.
 * CRITICAL: Uses timezone-aware epoch calculation to avoid server/salon TZ mismatches.
 */
function slotEndFitsInShift(
  slotEndMs: number,
  dateStr: string,
  startHHMM: string,
  endHHMM: string,
  timezone: string,
): boolean {
  const isOvernight = hhmmToMinutes(endHHMM) <= hhmmToMinutes(startHHMM);
  const shiftEndMs = isOvernight
    ? salonDateTimeToMs(nextDate(dateStr), endHHMM, timezone)
    : salonDateTimeToMs(dateStr, endHHMM, timezone);
  return slotEndMs <= shiftEndMs;
}

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Generate slot entries between start and end at intervalMin spacing.
 * Returns { time: "HH:MM", dayOffset: 0|1 }.
 * dayOffset=1 means this slot is on the next calendar day (overnight post-midnight).
 * Example: start=14:00, end=01:00 → 14:00..23:45 dayOffset=0, 00:00..00:45 dayOffset=1
 */
function generateSlots(
  start: string,
  end: string,
  intervalMin: number,
): Array<{ time: string; dayOffset: 0 | 1 }> {
  const entries: Array<{ time: string; dayOffset: 0 | 1 }> = [];
  const startMin = hhmmToMinutes(start);
  const endMin = hhmmToMinutes(end);
  const overnight = endMin <= startMin;
  const endTotal = overnight ? endMin + 24 * 60 : endMin;
  let cur = startMin;
  while (cur < endTotal) {
    const tod = cur % (24 * 60);
    const dayOffset: 0 | 1 = cur >= 24 * 60 ? 1 : 0;
    entries.push({
      time: `${String(Math.floor(tod / 60)).padStart(2, "0")}:${String(tod % 60).padStart(2, "0")}`,
      dayOffset,
    });
    cur += intervalMin;
  }
  return entries;
}

/** Returns "YYYY-MM-DD" for the day after dateStr. */
function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function getAllBarberIds(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<number[]> {
  const res = await db
    .request()
    .query(
      `
    SELECT EmpID FROM dbo.TblEmp
    WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
    ORDER BY EmpName
  `,
    )
    .catch(() => ({ recordset: [] as Array<{ EmpID: number }> }));
  return res.recordset.map((r) => r.EmpID);
}

async function getBarberNames(
  db: Awaited<ReturnType<typeof getPool>>,
  ids: number[],
): Promise<Record<number, string>> {
  if (!ids.length) return {};
  const res = await db
    .request()
    .query(
      `
    SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID IN (${ids.join(",")})
  `,
    )
    .catch(() => ({
      recordset: [] as Array<{ EmpID: number; EmpName: string }>,
    }));
  const map: Record<number, string> = {};
  for (const r of res.recordset) map[r.EmpID] = r.EmpName;
  return map;
}
