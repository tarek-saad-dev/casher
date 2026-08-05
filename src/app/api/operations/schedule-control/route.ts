/**
 * GET /api/operations/schedule-control?date=YYYY-MM-DD
 * Phase 1R: session-branch day-state from resolvers + legacy override timing.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from "@/lib/api-auth";
import { getBarbersDayStatus, cairoDateStr } from "@/lib/availabilityEngine";
import { loadOperationsDayState } from "@/lib/hr/operationsDayState";
import { listActiveBranches } from "@/lib/branch/repository";
import { listUserValidBranchAccess } from "@/lib/branch/repository";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requirePageAccess("/operations");
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const date =
      searchParams.get("date") ??
      new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "date مطلوب بتنسيق YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const todayStr = cairoDateStr(new Date());
    const isToday = date === todayStr;

    const access = await listUserValidBranchAccess(auth.userId);
    const includeElsewhere =
      auth.isSuperAdmin ||
      access.filter((a) => a.canOperate || a.canSwitch).length > 1;

    const dayState = await loadOperationsDayState({
      sessionBranchId: auth.activeBranchId,
      workDate: date,
      includeElsewhere,
    });

    const ordered = [
      ...dayState.sections.present,
      ...dayState.sections.transferredIn,
      ...dayState.sections.elsewhere,
      ...dayState.sections.off,
    ];

    const empIds = ordered.map((e) => e.empId);
    const statusMap = empIds.length
      ? await getBarbersDayStatus(empIds, date, {
          isToday,
          branchId: auth.activeBranchId,
        })
      : new Map();

    const allBranches = await listActiveBranches();
    // All live operational branches. The client excludes the employee's *from*
    // branch for the day (may differ from session when schedule is split-week).
    const transferDestinations = allBranches
      .filter((b) => b.isActive)
      .filter((b) => auth.isSuperAdmin || b.lifecycleStatus !== 'SETUP')
      .map((b) => ({
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
      }));

    const result = ordered.map((e) => {
      const s = statusMap.get(e.empId);
      const windowStart = e.scheduleWindow?.startTime ?? s?.effectiveStart ?? null;
      const windowEnd = e.scheduleWindow?.endTime ?? s?.effectiveEnd ?? null;

      return {
        empId: e.empId,
        empName: e.empName,
        baseBranch: e.baseBranch,
        currentBranch: e.currentBranch,
        isTransferred: e.isTransferred,
        transferReason: e.transferReason,
        isGlobalDayOff: e.isGlobalDayOff,
        scheduleSource: e.source,

        defaultSchedule: s
          ? {
              isWorkingDay: s.isWorkingDay || s.schedule.isWorkingDay,
              start: s.effectiveStart ?? windowStart ?? s.schedule.start,
              end: s.effectiveEnd ?? windowEnd ?? s.schedule.end,
              source: e.source ?? s.schedule.source,
            }
          : {
              isWorkingDay: e.section === "present" || e.section === "transferred_in",
              start: windowStart,
              end: windowEnd,
              source: e.source ?? "resolver",
            },

        effectiveSchedule: s
          ? {
              isWorking: s.effectiveSchedule.isWorking || s.isWorkingDay,
              start: s.effectiveStart ?? s.effectiveSchedule.start ?? windowStart,
              end: s.effectiveEnd ?? s.effectiveSchedule.end ?? windowEnd,
              blockedIntervals: s.effectiveSchedule.blockedIntervals,
            }
          : {
              isWorking: e.section === "present" || e.section === "transferred_in",
              start: windowStart,
              end: windowEnd,
              blockedIntervals: [],
            },

        effectiveStart: s?.effectiveStart ?? windowStart,
        effectiveEnd: s?.effectiveEnd ?? windowEnd,

        isDayOff: s?.isDayOff ?? (e.isGlobalDayOff || e.section === "off"),
        isAbsent: s?.isAbsent ?? false,
        isLateStart: s?.isLateStart ?? false,
        isEarlyLeave: s?.isEarlyLeave ?? false,
        isCustomHours: s?.isCustomHours ?? false,

        dayOffReason: s?.dayOffReason ?? null,
        currentAvailabilityStatus:
          s?.currentAvailabilityStatus ??
          (e.section === "off" ? "day_off" : e.section === "elsewhere" ? "off" : "working"),

        appliedOverride: s?.appliedOverride
          ? {
              overrideId: (s.appliedOverride as { OverrideID?: number }).OverrideID ?? null,
              type: s.appliedOverride.Type,
              startTime: s.appliedOverride.StartTime ?? null,
              endTime: s.appliedOverride.EndTime ?? null,
              reason: s.appliedOverride.Reason ?? null,
            }
          : null,

        attendance: e.attendance ?? s?.attendance ?? null,

        activeBookingsCount: e.activeBookingsCount,
        activeQueueCount: e.activeQueueCount,

        // Prefer availability engine after restore-present / custom_hours unlock
        isWorkingDay: s
          ? Boolean(s.isWorkingDay)
          : e.section === "present" || e.section === "transferred_in",
        section:
          s?.isWorkingDay && (e.section === "off" || e.section === "elsewhere")
            ? "present"
            : e.section,
        statusLabelAr:
          s?.isWorkingDay && !s.isAbsent
            ? s.statusReasonArabic
            : e.statusLabelAr,
        statusReasonArabic:
          s && !s.isDayOff
            ? s.statusReasonArabic
            : e.statusLabelAr || s?.statusReasonArabic || "غير معروف",
      };
    });

    return NextResponse.json({
      ok: true,
      date,
      isToday,
      sessionBranchId: auth.activeBranchId,
      sessionBranchCode: dayState.sessionBranchCode,
      version: dayState.version,
      transferDestinations,
      sections: {
        present: dayState.sections.present.map((x) => x.empId),
        transferredIn: dayState.sections.transferredIn.map((x) => x.empId),
        elsewhere: dayState.sections.elsewhere.map((x) => x.empId),
        off: dayState.sections.off.map((x) => x.empId),
      },
      barbers: result,
    });
  } catch (err) {
    console.error("[operations/schedule-control GET]", err);
    return NextResponse.json(
      { error: "فشل تحميل بيانات الجدول" },
      { status: 500 },
    );
  }
}
