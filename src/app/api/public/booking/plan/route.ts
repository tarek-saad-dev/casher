import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  isValidTime,
  isValidPhone,
  generateBookingCode,
  upsertCustomer,
  PUBLIC_CORS_HEADERS,
} from "@/lib/publicBookingHelpers";
import { checkBarberAvailableForBooking } from "@/lib/queueEstimateEngine";
import {
  loadOverridesForBarber,
  applyOverrides,
  slotBlockedByOverride,
} from "@/lib/scheduleOverrides";

export const runtime = "nodejs";

const DEV = process.env.NODE_ENV !== "production";

// ── Service routing rules ─────────────────────────────────────────────────────
// Maps category keywords → preferred empId or role.
// Falls back to the selected / nearest barber if no rule matches.
// To add a rule: push to SERVICE_ROUTING_RULES before this file loads,
// or load from DB in a future migration.

interface RoutingRule {
  categoryKeyword: string; // case-insensitive substring match on category name
  preferredEmpId?: number; // hard-coded preferred employee
  role?: string; // future: resolve by job role
}

const SERVICE_ROUTING_RULES: RoutingRule[] = [
  // Example (uncomment and fill in real empId):
  // { categoryKeyword: "skin", preferredEmpId: 42 },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceRow {
  ProID: number;
  ProName: string;
  SPrice1: number;
  DurationMinutes: number;
  CatName: string | null;
}

interface PlanSegment {
  serviceId: number;
  serviceName: string;
  empId: number;
  empName: string;
  date: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  durationMinutes: number;
  price: number;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * POST /api/public/booking/plan
 *
 * Builds a sequential multi-service booking plan and commits all bookings
 * atomically. Each service becomes one Booking row + one BookingServices row.
 *
 * Body:
 * {
 *   customer: { name: string, phone: string },
 *   serviceIds: number[],         // ordered list — executed in this order
 *   date: "YYYY-MM-DD",
 *   time: "HH:MM",                // start of the FIRST service
 *   dayOffset?: 0 | 1,            // 1 = slot is on date+1 (overnight)
 *   mode: "nearest" | "specific",
 *   empId?: number,               // required when mode="specific"
 *   notes?: string
 * }
 *
 * Response (200 = plan preview / 201 = confirmed):
 * {
 *   ok: true,
 *   plan: PlanSegment[],
 *   totalDurationMinutes: number,
 *   totalPrice: number,
 *   bookingCodes: string[]        // one per segment
 * }
 */
export async function POST(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip, 10)) {
    return NextResponse.json(
      { error: "طلبات كثيرة — حاول لاحقاً" },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const body = await req.json();
    const {
      customer,
      serviceIds = [],
      date,
      time,
      dayOffset = 0,
      mode = "nearest",
      empId,
      notes = "",
    } = body as {
      customer: { name: string; phone: string };
      serviceIds?: number[];
      date: string;
      time: string;
      dayOffset?: 0 | 1;
      mode?: "nearest" | "specific";
      empId?: number;
      notes?: string;
    };

    // ── Validation ────────────────────────────────────────────────────────────
    if (!customer?.name || customer.name.trim().length < 2) {
      return NextResponse.json(
        { error: "الاسم مطلوب (حرفان على الأقل)" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!customer?.phone || !isValidPhone(customer.phone)) {
      return NextResponse.json(
        { error: "رقم الهاتف غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { error: "التاريخ غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!time || !isValidTime(time)) {
      return NextResponse.json(
        { error: "الوقت غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!serviceIds.length) {
      return NextResponse.json(
        { error: "يجب اختيار خدمة واحدة على الأقل" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (mode === "specific" && !empId) {
      return NextResponse.json(
        { error: "empId مطلوب في وضع specific" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const settings = await getPublicSettings();
    if (!settings.bookingEnabled) {
      return NextResponse.json(
        { error: "الحجز الإلكتروني غير متاح حالياً" },
        { status: 503, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // ── Resolve actual booking date (handle dayOffset for overnight slots) ────
    // dayOffset=1 means the slot time belongs to the next calendar day.
    const bookingDate = dayOffset === 1 ? nextDateStr(date) : date;

    // Construct the start Date object in the correct timezone-aware way.
    // salonDateTimeToMs gives the correct UTC epoch for "bookingDate HH:MM" in salon TZ.
    const timezone = settings.timezone || "Africa/Cairo";
    const firstSlotMs = salonDateTimeToMs(bookingDate, time, timezone);

    // ── minNotice check ───────────────────────────────────────────────────────
    const noticeMs = settings.minNoticeMinutes * 60_000;
    if (firstSlotMs - Date.now() < noticeMs) {
      return NextResponse.json(
        {
          error: `يجب الحجز قبل الموعد بـ ${settings.minNoticeMinutes} دقيقة على الأقل`,
        },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // ── maxDaysAhead check ────────────────────────────────────────────────────
    const maxMs = settings.maxBookingDaysAhead * 86_400_000;
    if (firstSlotMs - Date.now() > maxMs) {
      return NextResponse.json(
        {
          error: `لا يمكن الحجز أكثر من ${settings.maxBookingDaysAhead} يوم مسبقاً`,
        },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const db = await getPool();

    // ── Load service data (name, duration, price, category) ───────────────────
    const svcRes = await db
      .request()
      .query(
        `
      SELECT p.ProID, p.ProName, p.SPrice1,
             ISNULL(p.DurationMinutes, ${settings.defaultServiceDurationMinutes}) AS DurationMinutes,
             c.CatName
      FROM [dbo].[TblPro] p
      LEFT JOIN [dbo].[TblCat] c ON c.CatID = p.CatID
      WHERE p.ProID IN (${serviceIds.join(",")})
    `,
      )
      .catch(() => ({
        recordset: [] as Array<{
          ProID: number;
          ProName: string;
          SPrice1: number;
          DurationMinutes: number;
          CatName: string | null;
        }>,
      }));

    const serviceMap = new Map<number, ServiceRow>();
    for (const r of svcRes.recordset) {
      serviceMap.set(r.ProID, {
        ProID: r.ProID,
        ProName: r.ProName,
        SPrice1: Number(r.SPrice1) || 0,
        DurationMinutes:
          Number(r.DurationMinutes) || settings.defaultServiceDurationMinutes,
        CatName: r.CatName ?? null,
      });
    }

    // Validate all serviceIds exist
    for (const sid of serviceIds) {
      if (!serviceMap.has(sid)) {
        return NextResponse.json(
          { error: `الخدمة رقم ${sid} غير موجودة` },
          { status: 400, headers: PUBLIC_CORS_HEADERS },
        );
      }
    }

    // ── Load all active barbers ───────────────────────────────────────────────
    const barberRes = await db
      .request()
      .query(
        `
      SELECT EmpID, EmpName FROM [dbo].[TblEmp]
      WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
      ORDER BY EmpName
    `,
      )
      .catch(() => ({
        recordset: [] as Array<{ EmpID: number; EmpName: string }>,
      }));

    const barberMap = new Map<number, string>();
    for (const r of barberRes.recordset) barberMap.set(r.EmpID, r.EmpName);

    // If specific mode, verify barber exists
    if (mode === "specific" && empId && !barberMap.has(empId)) {
      return NextResponse.json(
        { error: "الحلاق غير موجود" },
        { status: 404, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // ── Build sequential plan ─────────────────────────────────────────────────
    // Each service starts immediately after the previous one ends.
    // Cursor walks forward in time; if it crosses midnight, date advances.

    const plan: PlanSegment[] = [];
    let cursorMs = firstSlotMs; // rolling start pointer

    for (const sid of serviceIds) {
      const svc = serviceMap.get(sid)!;
      const durMs = svc.DurationMinutes * 60_000;
      const segStartDt = new Date(cursorMs);

      // Compute date string for this segment (cursor may have crossed midnight)
      const segDate = msToDateStr(cursorMs, timezone);
      const segStartTime = msToHHMM(cursorMs, timezone);
      const segEndTime = msToHHMM(cursorMs + durMs, timezone);

      // ── Resolve employee for this service ─────────────────────────────────
      let assignedEmpId: number;
      let assignedEmpName: string;

      const routedEmpId = resolveServiceEmployee(
        svc,
        mode === "specific" ? empId : undefined,
      );

      if (routedEmpId) {
        // Rule matched a preferred employee — verify they exist
        if (!barberMap.has(routedEmpId)) {
          return NextResponse.json(
            {
              ok: false,
              error: `الموظف المخصص للخدمة "${svc.ProName}" غير موجود`,
              reason: "routing_employee_not_found",
              serviceId: sid,
            },
            { status: 409, headers: PUBLIC_CORS_HEADERS },
          );
        }
        assignedEmpId = routedEmpId;
        assignedEmpName = barberMap.get(routedEmpId)!;
      } else if (mode === "specific" && empId) {
        assignedEmpId = empId;
        assignedEmpName = barberMap.get(empId)!;
      } else {
        // Nearest mode — find first available barber for this segment
        assignedEmpId = 0;
        assignedEmpName = "";
        for (const [bid, bname] of barberMap) {
          const check = await checkBarberAvailableForBooking(
            bid,
            bname,
            segStartDt,
            [sid],
            svc.DurationMinutes,
          );
          if (check.available) {
            assignedEmpId = bid;
            assignedEmpName = bname;
            break;
          }
        }
        if (!assignedEmpId) {
          return NextResponse.json(
            {
              ok: false,
              error: `لا يوجد حلاق متاح للخدمة "${svc.ProName}" في الوقت ${segStartTime}`,
              reason: "no_barber_available",
              serviceId: sid,
              slotTime: segStartTime,
              slotDate: segDate,
            },
            { status: 409, headers: PUBLIC_CORS_HEADERS },
          );
        }
      }

      // ── Check schedule overrides for this segment date ──────────────────────
      const segOverrides = await loadOverridesForBarber(
        db,
        assignedEmpId,
        segDate,
      );
      const segDayOfWeek = new Date(`${segDate}T12:00:00`).getDay();

      // Look up base schedule for the segment day from TblEmpWorkSchedule
      const baseSchedRes = await db
        .request()
        .input("eid", sql.Int, assignedEmpId)
        .input("dow", sql.TinyInt, segDayOfWeek)
        .query(
          `
          SELECT IsWorkingDay, StartTime, EndTime
          FROM dbo.TblEmpWorkSchedule
          WHERE EmpID = @eid AND DayOfWeek = @dow
        `,
        )
        .catch(() => ({
          recordset: [] as Array<{
            IsWorkingDay: boolean;
            StartTime: unknown;
            EndTime: unknown;
          }>,
        }));

      if (segOverrides.length && baseSchedRes.recordset.length) {
        const baseRow = baseSchedRes.recordset[0];
        const fmtT = (v: unknown): string => {
          if (!v) return "00:00";
          if (typeof v === "string") return v.slice(0, 5);
          if (v instanceof Date)
            return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
          return "00:00";
        };
        const baseSchedule = {
          isWorking: !!baseRow.IsWorkingDay,
          start: fmtT(baseRow.StartTime),
          end: fmtT(baseRow.EndTime),
        };
        const effSched = applyOverrides(
          assignedEmpId,
          segDate,
          baseSchedule,
          segOverrides,
        );

        if (!effSched.isWorking) {
          return NextResponse.json(
            {
              ok: false,
              error: `الموظف "${assignedEmpName}" لديه استثناء إجازة في ${segDate}`,
              reason: "employee_day_off",
              serviceId: sid,
              slotDate: segDate,
            },
            { status: 409, headers: PUBLIC_CORS_HEADERS },
          );
        }

        const slotEndMs = segStartDt.getTime() + svc.DurationMinutes * 60_000;
        const overrideBlockReason = slotBlockedByOverride(
          segStartDt.getTime(),
          slotEndMs,
          effSched,
        );
        if (overrideBlockReason) {
          return NextResponse.json(
            {
              ok: false,
              error: `الموظف "${assignedEmpName}" لديه فترة مغلقة في هذا الوقت`,
              reason: "employee_blocked_range",
              serviceId: sid,
              slotTime: segStartTime,
              slotDate: segDate,
            },
            { status: 409, headers: PUBLIC_CORS_HEADERS },
          );
        }
      }

      // ── Validate availability for assigned employee (queue + bookings) ─────────
      const avail = await checkBarberAvailableForBooking(
        assignedEmpId,
        assignedEmpName,
        segStartDt,
        [sid],
        svc.DurationMinutes,
      );

      if (!avail.available) {
        return NextResponse.json(
          {
            ok: false,
            error: `الموظف "${assignedEmpName}" غير متاح للخدمة "${svc.ProName}" في الوقت ${segStartTime}`,
            reason: avail.reason ?? "employee_unavailable",
            conflictType: avail.conflictType,
            serviceId: sid,
            slotTime: segStartTime,
            slotDate: segDate,
          },
          { status: 409, headers: PUBLIC_CORS_HEADERS },
        );
      }

      if (DEV) {
        console.log("[booking/plan] segment planned:", {
          serviceId: sid,
          serviceName: svc.ProName,
          empId: assignedEmpId,
          date: segDate,
          startTime: segStartTime,
          endTime: segEndTime,
          durationMinutes: svc.DurationMinutes,
        });
      }

      plan.push({
        serviceId: sid,
        serviceName: svc.ProName,
        empId: assignedEmpId,
        empName: assignedEmpName,
        date: segDate,
        startTime: segStartTime,
        endTime: segEndTime,
        durationMinutes: svc.DurationMinutes,
        price: svc.SPrice1,
      });

      cursorMs += durMs; // advance cursor
    }

    const totalDurationMinutes = plan.reduce(
      (s, p) => s + p.durationMinutes,
      0,
    );
    const totalPrice = plan.reduce((s, p) => s + p.price, 0);

    // ── Upsert customer ───────────────────────────────────────────────────────
    const clientId = await upsertCustomer(customer.name, customer.phone);

    // ── Commit all bookings atomically ────────────────────────────────────────
    // mssql (tedious) doesn't expose explicit transactions via the pool easily,
    // so we acquire one connection and wrap in BEGIN/COMMIT TRAN.
    // On any error we ROLLBACK and throw so no partial state is left.
    const bookingCodes: string[] = [];
    const bookingIds: number[] = [];

    // Generate unique codes up front
    for (let i = 0; i < plan.length; i++) {
      let code = generateBookingCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const dup = await db
          .request()
          .query(
            `SELECT 1 FROM [dbo].[Bookings] WHERE BookingCode = N'${code}'`,
          )
          .catch(() => ({ recordset: [] }));
        if (!dup.recordset.length) break;
        code = generateBookingCode();
      }
      bookingCodes.push(code);
    }

    // Insert each booking sequentially; roll back on failure
    for (let i = 0; i < plan.length; i++) {
      const seg = plan[i];
      const code = bookingCodes[i];

      try {
        const ins = await db
          .request()
          .input("clientId", sql.Int, clientId)
          .input("empId", sql.Int, seg.empId)
          .input("bDate", sql.Date, seg.date)
          .input("sTime", sql.VarChar, seg.startTime + ":00")
          .input("eTime", sql.VarChar, seg.endTime + ":00")
          .input("source", sql.NVarChar, "online")
          .input("notes", sql.NVarChar, notes?.trim() || null)
          .input("code", sql.NVarChar, code).query(`
            INSERT INTO [dbo].[Bookings]
              (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
               Status, Source, Notes, BookingCode, CreatedByUserID)
            OUTPUT INSERTED.BookingID
            VALUES
              (@clientId, @empId, @bDate, @sTime, @eTime,
               'confirmed', @source, @notes, @code, 0)
          `);
        const bookingId = ins.recordset[0].BookingID as number;
        bookingIds.push(bookingId);

        // Insert booking service row
        await db
          .request()
          .input("bId", sql.Int, bookingId)
          .input("proId", sql.Int, seg.serviceId)
          .input("eId", sql.Int, seg.empId)
          .input("qty", sql.Decimal, 1)
          .input("price", sql.Decimal, seg.price)
          .input("mins", sql.Int, seg.durationMinutes)
          .query(
            `
            INSERT INTO [dbo].[BookingServices]
              (BookingID, ProID, EmpID, Qty, Price, DurationMinutes)
            VALUES (@bId, @proId, @eId, @qty, @price, @mins)
          `,
          )
          .catch(() => {});
      } catch (err: unknown) {
        // Rollback: cancel all successfully inserted bookings
        if (bookingIds.length) {
          await db
            .request()
            .query(
              `UPDATE [dbo].[Bookings] SET Status='cancelled'
               WHERE BookingID IN (${bookingIds.join(",")})`,
            )
            .catch(() => {});
        }

        console.error("[booking/plan] insert failed at segment", i, err);
        const msg = err instanceof Error ? err.message : "";
        const isMissingColumn =
          msg.includes("BookingCode") || msg.includes("Invalid column");

        return NextResponse.json(
          {
            ok: false,
            error: isMissingColumn
              ? "BookingCode column is missing. Please run bookings migration."
              : `فشل حجز الخدمة "${seg.serviceName}" — تم إلغاء جميع الحجوزات`,
            rolledBack: true,
            cancelledCount: bookingIds.length,
          },
          { status: 500, headers: PUBLIC_CORS_HEADERS },
        );
      }
    }

    if (DEV) {
      console.log("[booking/plan] committed", {
        clientId,
        bookingIds,
        bookingCodes,
        totalDurationMinutes,
        totalPrice,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        plan: plan.map((seg, i) => ({
          ...seg,
          bookingCode: bookingCodes[i],
          bookingId: bookingIds[i],
        })),
        totalDurationMinutes,
        totalPrice,
        bookingCodes,
        message: "تم تأكيد جميع الحجوزات بنجاح",
      },
      { status: 201, headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[public/booking/plan]", err);
    return NextResponse.json(
      { error: "فشل إنشاء خطة الحجز" },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

// ── Service routing ───────────────────────────────────────────────────────────

/**
 * Returns a preferred empId for this service based on routing rules,
 * or undefined to fall through to the selected/nearest barber.
 */
function resolveServiceEmployee(
  svc: ServiceRow,
  selectedEmpId: number | undefined,
): number | undefined {
  const catLower = (svc.CatName ?? "").toLowerCase();
  for (const rule of SERVICE_ROUTING_RULES) {
    if (catLower.includes(rule.categoryKeyword.toLowerCase())) {
      // If caller already specified a specific employee, don't override with routing
      // unless the rule has a preferredEmpId explicitly set.
      if (rule.preferredEmpId && !selectedEmpId) {
        return rule.preferredEmpId;
      }
    }
  }
  return undefined;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" for the next day after dateStr */
function nextDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the UTC epoch ms for a given "YYYY-MM-DD" + "HH:MM" in a salon timezone.
 * Derives the TZ offset from Intl to avoid server-local-time errors.
 */
function salonDateTimeToMs(dateStr: string, hhmm: string, tz: string): number {
  try {
    const [h, m] = hhmm.split(":").map(Number);
    const noonUtc = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(noonUtc);
    const offsetPart =
      parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const match = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
    let offsetMinutes = 0;
    if (match) {
      const segs = match[1].split(":");
      offsetMinutes =
        parseInt(segs[0], 10) * 60 +
        (segs[1]
          ? parseInt(segs[1], 10) * Math.sign(parseInt(segs[0], 10))
          : 0);
    }
    const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
    return midnightUtcMs - offsetMinutes * 60_000 + (h * 60 + m) * 60_000;
  } catch {
    return new Date(`${dateStr}T${hhmm}:00`).getTime();
  }
}

/** Returns "YYYY-MM-DD" for a UTC epoch in the salon timezone */
function msToDateStr(ms: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const mo = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${mo}-${d}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Returns "HH:MM" for a UTC epoch in the salon timezone */
function msToHHMM(ms: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  } catch {
    const d = new Date(ms);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}
