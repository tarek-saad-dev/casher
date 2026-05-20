import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from "@/lib/publicBookingHelpers";

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
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();

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
        console.log("[available-slots] barber schedule:", {
          empId: r.EmpID,
          barberName: nameMap[r.EmpID],
          workDate: date,
          startTime: start,
          endTime: end,
          isOvernight: hhmmToMinutes(end) <= hhmmToMinutes(start),
        });
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

    // ── 6. Batch preload queue tickets (1 query) ──────────────────────────────
    const queueRes = await db
      .request()
      .input("qdate", sql.Date, date)
      .query(
        `
        SELECT EmpID, ServiceStartedAt, ISNULL(DurationMinutes, ${systemDefault}) AS DurationMinutes, Status
        FROM dbo.QueueTickets
        WHERE EmpID IN (${barberIdList})
          AND QueueDate = @qdate
          AND LOWER(Status) IN ('waiting','called','arrived','in_service')
        ORDER BY EmpID,
          CASE WHEN LOWER(Status)='in_service' THEN 0 ELSE 1 END ASC,
          QueueTicketID ASC
      `,
      )
      .catch(() => ({ recordset: [] as any[] }));

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
        SELECT AssignedEmpID AS EmpID, StartTime, EndTime, Status
        FROM dbo.Bookings
        WHERE AssignedEmpID IN (${barberIdList})
          AND BookingDate = @bdate
          AND LOWER(Status) IN ('confirmed','arrived','queued','in_service')
        ORDER BY AssignedEmpID, StartTime ASC
      `,
      )
      .catch(() => ({ recordset: [] as any[] }));

    if (DEV)
      console.log(
        "[available-slots] existing confirmed bookings:",
        bookingRes.recordset,
      );

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
      Array<{ start: string; end: string }>
    > = {};
    for (const r of bookingRes.recordset) {
      const id = r.EmpID as number;
      const startMs = sqlTimeToDateMs(date, r.StartTime);
      const fallbackDurMs =
        (barberDuration[id]?.minutes ?? systemDefault) * 60_000;
      const endMs = r.EndTime
        ? sqlTimeToDateMs(date, r.EndTime)
        : startMs + fallbackDurMs;
      blockersMap[id].push({ startMs, endMs, label: "booking" });
      (bookingBlocks[id] ??= []).push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      });
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

    for (const bid of activeBarbers) {
      const sched = scheduleMap[bid];
      if (!sched || !sched.isWorking) continue;
      for (const { time, dayOffset } of generateSlots(
        sched.start,
        sched.end,
        settings.slotIntervalMinutes,
      )) {
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
        const sched = scheduleMap[empId];

        if (dayOffSet.has(empId)) {
          slots.push({
            time,
            label,
            available: false,
            dayOffset,
            reason: "إجازة",
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
        if (!withinWindow(slotDateMs, date, sched.start, sched.end)) {
          continue; // outside this barber's shift — skip entirely
        }

        const slotEndMs = slotDateMs + durMin * 60_000;

        // Last slot must end within shift (pass startHHMM for correct overnight detection)
        if (!slotEndFitsInShift(slotEndMs, date, sched.start, sched.end)) {
          if (DEV)
            console.log("[available-slots] slot check:", {
              time,
              dayOffset,
              reason: "exceeds shift end",
              slotEnd: new Date(slotEndMs).toISOString(),
            });
          continue;
        }

        const conflict = findConflict(
          blockersMap[empId] ?? [],
          slotDateMs,
          slotEndMs,
        );
        if (DEV)
          console.log("[available-slots] slot check:", {
            slotStart: time,
            dayOffset,
            slotEnd: minutesToHHMM(hhmmToMinutes(time) + durMin),
            overlapsBooking: conflict,
            available: !conflict,
            reason: conflict ? "blocker" : "ok",
          });

        if (conflict) {
          slots.push({
            time,
            label,
            available: false,
            dayOffset,
            reason: "الوقت محجوز",
          });
        } else {
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
          const sched = scheduleMap[bid];
          if (!sched || !sched.isWorking) continue;
          if (!withinWindow(slotDateMs, date, sched.start, sched.end)) continue;

          const { minutes: durMin, source } = barberDuration[bid];
          const slotEndMs = slotDateMs + durMin * 60_000;

          if (!slotEndFitsInShift(slotEndMs, date, sched.start, sched.end))
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

/**
 * Returns the UTC epoch (ms) for a given "YYYY-MM-DD" + "HH:MM" in a specific IANA timezone.
 * This is the correct way to construct slot epoch when the server may not be in the salon TZ.
 *
 * Strategy: ask Intl what UTC instant corresponds to noon on that date in the TZ, then
 * add/subtract the offset between noon-UTC and noon-local to get the TZ offset, then
 * apply it to the desired HH:MM.
 * Simpler approach used here: parse the ISO string with the TZ offset derived from Intl.
 */
function salonDateTimeToMs(dateStr: string, hhmm: string, tz: string): number {
  try {
    // Construct a reference instant at the desired local wall-clock time.
    // We do this by using Temporal-like trick: format a known UTC instant back
    // to local time, compute the offset, then shift.
    // Simplest reliable approach: use Date.UTC for a candidate, check the
    // Intl-formatted local time for that candidate, iterate until match.
    // Instead, use the offset of the requested date at ~noon as a stable approximation
    // (avoids DST issues at exact midnight).
    const [h, m] = hhmm.split(":").map(Number);
    // Reference: noon UTC on that date — to find offset
    const noonUtc = new Date(`${dateStr}T12:00:00Z`);
    const noonLocal = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    }).formatToParts(noonUtc);
    // Extract offset from the formatted parts (e.g., "GMT+3" → +180)
    const offsetPart =
      noonLocal.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const offsetMatch = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const parts = offsetMatch[1].split(":");
      offsetMinutes =
        parseInt(parts[0], 10) * 60 +
        (parts[1]
          ? parseInt(parts[1], 10) * Math.sign(parseInt(parts[0], 10))
          : 0);
    }
    // Construct epoch: midnight UTC on that date, minus TZ offset (to get midnight local),
    // then add desired HH:MM
    const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
    return midnightUtcMs - offsetMinutes * 60_000 + (h * 60 + m) * 60_000;
  } catch {
    // Fallback: treat as local server time (original behavior)
    return new Date(`${dateStr}T${hhmm}:00`).getTime();
  }
}

/** Returns "YYYY-MM-DD" for today in the given IANA timezone. */
function dateInTimezone(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const mo = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${mo}-${d}`;
  } catch {
    return now.toISOString().slice(0, 10);
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

function sqlTimeToDateMs(dateStr: string, timeVal: unknown): number {
  return new Date(`${dateStr}T${fmtTime(timeVal) ?? "00:00"}:00`).getTime();
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
 */
function withinWindow(
  slotMs: number,
  dateStr: string,
  startHHMM: string,
  endHHMM: string,
): boolean {
  const shiftStartMs = new Date(`${dateStr}T${startHHMM}:00`).getTime();
  const isOvernight = hhmmToMinutes(endHHMM) <= hhmmToMinutes(startHHMM);
  const shiftEndMs = isOvernight
    ? new Date(`${nextDate(dateStr)}T${endHHMM}:00`).getTime()
    : new Date(`${dateStr}T${endHHMM}:00`).getTime();
  return slotMs >= shiftStartMs && slotMs < shiftEndMs;
}

/**
 * Checks that slotEnd epoch does not exceed shiftEnd epoch.
 * Requires startHHMM to detect overnight shifts correctly.
 */
function slotEndFitsInShift(
  slotEndMs: number,
  dateStr: string,
  startHHMM: string,
  endHHMM: string,
): boolean {
  const isOvernight = hhmmToMinutes(endHHMM) <= hhmmToMinutes(startHHMM);
  const shiftEndMs = isOvernight
    ? new Date(`${nextDate(dateStr)}T${endHHMM}:00`).getTime()
    : new Date(`${dateStr}T${endHHMM}:00`).getTime();
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
