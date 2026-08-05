/**
 * Phase 3B.2 — Availability Layers Inspector view-model (pure, no DB).
 *
 * Consumes resolved day plan + explanation metadata. Does not recalculate
 * schedules independently of the canonical resolver/explain engines.
 */

import type { DayPlanWindow, EmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import type { AvailabilityExplanation } from '@/lib/availability/explainAvailability';
import type { EmployeeDailyAdjustment } from '@/lib/availability/dailyAdjustments';
import {
  BASE_SCHEDULE_SOURCE_AR,
  DAILY_ADJUSTMENT_STATE_AR,
  DAILY_ADJUSTMENT_TYPE_AR,
  EXPLAIN_RESULT_AR,
  reasonCodeLabelAr,
} from '@/lib/availability/workforceUiLabels';
import {
  buildAvailabilityDecision,
  type AvailabilityDecisionExplain,
} from '@/lib/availability/buildAvailabilityDecision';
import {
  EMPLOYMENT_TYPE_LABELS,
  type EmploymentType,
  normalizeEmploymentType,
} from '@/lib/hr/employee-hr-model';
import type { ScheduleOverride } from '@/lib/scheduleOverrides';

export type AvailabilityLayerKey =
  | 'EMPLOYMENT'
  | 'BASE_SCHEDULE'
  | 'TRANSFER_OR_FREELANCE'
  | 'LEGACY_OVERRIDES'
  | 'ATTENDANCE'
  | 'DAILY_ADJUSTMENTS'
  | 'FINAL_RESULT';

export type AvailabilityLayerStatus =
  | 'APPLIED'
  | 'NOT_APPLICABLE'
  | 'NO_DATA'
  | 'OVERRIDDEN'
  | 'BLOCKING'
  | 'INFORMATIONAL'
  | 'WARNING';

export const AVAILABILITY_LAYER_STATUS_AR: Record<AvailabilityLayerStatus, string> = {
  APPLIED: 'مطبقة',
  NOT_APPLICABLE: 'غير منطبقة',
  NO_DATA: 'لا توجد بيانات',
  OVERRIDDEN: 'تم تجاوزها بطبقة لاحقة',
  BLOCKING: 'تمنع التوافر',
  INFORMATIONAL: 'معلومات فقط',
  WARNING: 'يحتاج مراجعة',
};

export type AvailabilityLayerAction = {
  key: string;
  labelAr: string;
  href?: string;
  actionType:
    | 'OPEN_MODAL'
    | 'OPEN_PAGE'
    | 'OPEN_LAYER_CONTROL'
    | 'API_MUTATION'
    | 'READ_ONLY';
  enabled: boolean;
  disabledReasonAr?: string;
  /** OPEN_MODAL → daily type; OPEN_LAYER_CONTROL → layer key. */
  modalType?: string;
};

export type BlockedIntervalView = {
  startMs: number;
  endMs: number;
  reason?: string | null;
};

export type AvailabilityLayerSnapshot = {
  beforeWindows: DayPlanWindow[];
  afterWindows: DayPlanWindow[];
  beforeBlockedIntervals: BlockedIntervalView[];
  afterBlockedIntervals: BlockedIntervalView[];
  availabilityBefore: boolean;
  availabilityAfter: boolean;
  effectCode: string | null;
};

export type AvailabilityLayerView = {
  key: AvailabilityLayerKey;
  order: number;
  titleAr: string;
  descriptionAr: string;
  status: AvailabilityLayerStatus;
  summaryAr: string;
  effectAr: string | null;
  sourceCode?: string | null;
  data: Record<string, unknown>;
  warnings: string[];
  actions: AvailabilityLayerAction[];
  snapshot?: AvailabilityLayerSnapshot | null;
  /** Auto-expand when blocking or final. */
  defaultExpanded: boolean;
  emphasized?: boolean;
  /** True when this layer is the primary cause of the final decision. */
  isDecidingCause?: boolean;
};

export type WorkforceLayerPermissions = {
  canEditDailyAdjustments: boolean;
  canViewEmployeeProfile: boolean;
  canEditWeeklySchedule: boolean;
  canManageTransfers: boolean;
  canManageAttendance: boolean;
  canCancelLegacyOverrides: boolean;
};

export type TransferMeta = {
  direction: 'in' | 'away' | 'none';
  fromBranchId?: number | null;
  fromBranchName?: string | null;
  toBranchId?: number | null;
  toBranchName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  workDate?: string | null;
};

/** When not working on the active branch, where the weekly schedule places them today. */
export type ScheduledElsewhereMeta = {
  branchId: number;
  branchCode: string;
  branchName: string;
  startTime: string | null;
  endTime: string | null;
};

export type AssignmentMeta = {
  branchId: number | null;
  branchName?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  isAssignedToActiveBranch: boolean;
};

export type WorkforceLayerEmployee = {
  employeeId: number;
  employeeName: string;
  job: string | null;
  isActive: boolean;
  employmentType?: string | null;
  assignment?: AssignmentMeta | null;
  transfer?: TransferMeta | null;
  scheduledElsewhere?: ScheduledElsewhereMeta | null;
  canReceiveBookings?: boolean | null;
};

export type BuildAvailabilityLayersArgs = {
  employee: WorkforceLayerEmployee;
  dayPlan: EmployeeDayPlan;
  explanation: AvailabilityExplanation;
  activeAdjustments: EmployeeDailyAdjustment[];
  permissions: WorkforceLayerPermissions;
  /** Active branch context for transfer direction. */
  activeBranchId: number | null;
  activeBranchName?: string | null;
};

const LEGACY_TYPE_AR: Record<string, string> = {
  day_off: 'إجازة يوم',
  custom_hours: 'ساعات مخصصة',
  late_start: 'بداية متأخرة',
  early_leave: 'انصراف مبكر',
  block_range: 'حظر فترة',
};

function formatWindowsAr(windows: DayPlanWindow[]): string {
  if (!windows.length) return 'لا توجد فترات';
  return windows
    .map((w) =>
      w.endDayOffset === 1
        ? `${w.start}–${w.end} (اليوم التالي)`
        : `${w.start}–${w.end}`,
    )
    .join(' · ');
}

function employmentLabelAr(raw: string | null | undefined): string {
  const et = normalizeEmploymentType(raw);
  if (!et) return 'نوع التوظيف غير محدد';
  return EMPLOYMENT_TYPE_LABELS[et as EmploymentType] ?? et;
}

function isAbsent(plan: EmployeeDayPlan): boolean {
  return (
    plan.denyReasonCode === 'EMPLOYEE_ABSENT' ||
    plan.attendanceState?.status === 'Absent'
  );
}

function disabled(
  labelAr: string,
  reason: string,
  extra?: Partial<AvailabilityLayerAction>,
): AvailabilityLayerAction {
  return {
    key: extra?.key ?? 'disabled',
    labelAr,
    actionType: extra?.actionType ?? 'READ_ONLY',
    enabled: false,
    disabledReasonAr: reason,
    ...extra,
  };
}

function controlLayerAction(
  layerKey: AvailabilityLayerKey,
  enabled: boolean,
  disabledReasonAr?: string,
): AvailabilityLayerAction {
  return {
    key: `control_${layerKey}`,
    labelAr: 'تحكم في هذه الطبقة',
    actionType: 'OPEN_LAYER_CONTROL',
    modalType: layerKey,
    enabled,
    disabledReasonAr,
  };
}

/**
 * Build seven ordered layer views for the workforce inspector.
 * Pure — no database, no independent schedule math beyond explain snapshots.
 */
export function buildAvailabilityLayers(
  args: BuildAvailabilityLayersArgs,
): AvailabilityLayerView[] {
  const {
    employee,
    dayPlan,
    explanation,
    activeAdjustments,
    permissions,
    activeBranchId,
    activeBranchName,
  } = args;

  const explainLayers = explanation.layers ?? [];
  const snap = (key: AvailabilityLayerKey) =>
    explainLayers.find((l) => l.key === key)?.snapshot ?? null;

  const decision = buildAvailabilityDecision({
    dayPlan,
    isActive: employee.isActive,
    transfer: employee.transfer,
    scheduledElsewhere: employee.scheduledElsewhere,
    activeBranchName,
  });

  const layers: AvailabilityLayerView[] = [];

  // ── 1. Employment ────────────────────────────────────────────────────────
  {
    const inactive = !employee.isActive;
    const et = normalizeEmploymentType(employee.employmentType);
    const assigned = employee.assignment?.isAssignedToActiveBranch ?? true;
    let status: AvailabilityLayerStatus = 'APPLIED';
    let summaryAr = `${employee.employeeName} · ${employmentLabelAr(employee.employmentType)}`;
    let effectAr: string | null = 'موظف مُعيَّن ضمن نطاق هذا الفرع لهذا اليوم.';

    if (inactive) {
      status = 'BLOCKING';
      effectAr = 'الموظف غير نشط، لذلك جميع الطبقات التالية لن تجعله متاحًا.';
    } else if (et === 'freelance') {
      status = 'INFORMATIONAL';
      effectAr =
        'موظف بنظام العمل الحر، يحتاج إلى فتح عمل صريح إذا لم يكن لديه جدول.';
    } else if (!assigned) {
      status = 'WARNING';
      effectAr = 'التعيين على هذا الفرع غير مؤكد — راجع طبقة النقل.';
    } else {
      effectAr =
        'موظف دائم ومُعيَّن حاليًا على هذا الفرع. فترات العمل لا تُفتح من هذه الطبقة — راجع «الجدول الأساسي للفرع».';
    }

    const actions: AvailabilityLayerAction[] = [
      controlLayerAction(
        'EMPLOYMENT',
        permissions.canViewEmployeeProfile,
        permissions.canViewEmployeeProfile
          ? undefined
          : 'لا توجد صلاحية لعرض ملف الموظف',
      ),
    ];
    if (permissions.canViewEmployeeProfile) {
      actions.push({
        key: 'open_profile',
        labelAr: 'فتح صفحة الموارد البشرية',
        href: `/admin/hr?empId=${employee.employeeId}`,
        actionType: 'OPEN_PAGE',
        enabled: true,
      });
    }
    if (permissions.canEditWeeklySchedule) {
      actions.push({
        key: 'open_assignment',
        labelAr: 'فتح صفحة الجدول الأسبوعي',
        href: `/admin/hr/employees/${employee.employeeId}/branch-schedule`,
        actionType: 'OPEN_PAGE',
        enabled: true,
      });
    }

    layers.push({
      key: 'EMPLOYMENT',
      order: 1,
      titleAr: 'بيانات الموظف ونوع التوظيف',
      descriptionAr: 'هوية الموظف ونموذج التوظيف والتعيين الحالي.',
      status,
      summaryAr,
      effectAr,
      sourceCode: et,
      data: {
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        job: employee.job,
        isActive: employee.isActive,
        employmentType: employee.employmentType ?? null,
        assignment: employee.assignment ?? null,
        canReceiveBookings: employee.canReceiveBookings ?? null,
        branchName: activeBranchName ?? null,
      },
      warnings: inactive ? ['الموظف غير نشط'] : [],
      actions,
      snapshot: snap('EMPLOYMENT'),
      defaultExpanded: status === 'BLOCKING',
    });
  }

  // ── 2. Base schedule ─────────────────────────────────────────────────────
  {
    const weekly = dayPlan.weeklyWindows;
    const source = dayPlan.baseScheduleSource;
    const sourceLabel = BASE_SCHEDULE_SOURCE_AR[source] ?? source;
    const elsewhere = employee.scheduledElsewhere;
    const isScheduledOff = !!weekly && weekly.isWorkingDay === false && !elsewhere;
    const isWorkingWindow =
      !!weekly?.isWorkingDay && !!weekly.startTime && !!weekly.endTime;
    const isElsewhere = !dayPlan.isWorking && !!elsewhere;

    let status: AvailabilityLayerStatus =
      isWorkingWindow || source === 'FREELANCE_UNLOCK' || source === 'TEMPORARY_TRANSFER'
        ? 'APPLIED'
        : isElsewhere || isScheduledOff
          ? 'APPLIED'
          : source === 'NONE'
            ? 'NO_DATA'
            : 'INFORMATIONAL';

    // If transfer/freelance is the resolved source, base layer still shows what resolved.
    if (source === 'TEMPORARY_TRANSFER' || source === 'FREELANCE_UNLOCK') {
      status = 'INFORMATIONAL';
    }

    const windowSummary = isWorkingWindow
      ? `${weekly!.startTime}–${weekly!.endTime}`
      : isElsewhere
        ? `يعمل اليوم على ${elsewhere!.branchName}${
            elsewhere!.startTime && elsewhere!.endTime
              ? ` · ${elsewhere!.startTime}–${elsewhere!.endTime}`
              : ''
          }`
        : isScheduledOff
          ? 'إجازة أسبوعية حقيقية'
          : 'لا يوجد جدول أساسي لهذا اليوم.';

    const overnight =
      !!weekly?.startTime &&
      !!weekly?.endTime &&
      weekly.startTime > weekly.endTime;

    const summaryAr = `${sourceLabel} · ${windowSummary}`;
    const effectAr = isWorkingWindow
      ? overnight
        ? `الجدول الأساسي يفتح العمل من ${weekly!.startTime} إلى ${weekly!.endTime} في اليوم التالي.`
        : `الجدول الأساسي يفتح العمل من ${weekly!.startTime} إلى ${weekly!.endTime}.`
      : isElsewhere
        ? `على الفرع الحالي (${activeBranchName ?? 'هذا الفرع'}) اليوم غير عامل لأن التوزيع الأسبوعي يضع الموظف على «${elsewhere!.branchName}». هذا ليس إجازة عامة.`
        : isScheduledOff
          ? 'الجدول الأسبوعي يُحدِّد هذا اليوم كإجازة على كل الفروع — لذلك لا تُفتح نوافذ حجز.'
          : 'لا يوجد جدول أساسي لهذا اليوم.';

    const actions: AvailabilityLayerAction[] = [
      controlLayerAction(
        'BASE_SCHEDULE',
        permissions.canEditWeeklySchedule,
        permissions.canEditWeeklySchedule
          ? undefined
          : 'لا توجد صلاحية لتعديل الجدول الأسبوعي',
      ),
    ];
    if (permissions.canEditWeeklySchedule) {
      actions.push({
        key: 'manage_weekly',
        labelAr: 'فتح الصفحة الكاملة',
        href: `/admin/hr/employees/${employee.employeeId}/branch-schedule`,
        actionType: 'OPEN_PAGE',
        enabled: true,
      });
    }

    const isDeciding = decision.decidingLayerKey === 'BASE_SCHEDULE';

    layers.push({
      key: 'BASE_SCHEDULE',
      order: 2,
      titleAr: 'الجدول الأساسي للفرع',
      descriptionAr: isElsewhere
        ? 'التوافر هنا خاص بالفرع النشط فقط. التوزيع الأسبوعي قد يضع الموظف على فرع آخر في نفس اليوم.'
        : 'هذا التعديل يؤثر على هذا اليوم من كل أسبوع، وليس اليوم المحدد فقط.',
      status,
      summaryAr,
      effectAr,
      sourceCode: isElsewhere ? 'SCHEDULED_ELSEWHERE' : source,
      data: {
        baseScheduleSource: source,
        weeklyWindows: weekly,
        overnight: !!overnight,
        isScheduledOff,
        scheduledElsewhere: elsewhere ?? null,
        activeBranchName: activeBranchName ?? null,
      },
      warnings: [],
      actions,
      snapshot: (() => {
        const baseSnap = snap('BASE_SCHEDULE');
        if (!baseSnap) return null;
        if (isElsewhere) {
          return {
            ...baseSnap,
            effectCode: 'SCHEDULED_ELSEWHERE',
          };
        }
        if (isScheduledOff && baseSnap.effectCode === 'NO_BASE') {
          return { ...baseSnap, effectCode: 'WEEKLY_DAY_OFF' };
        }
        return baseSnap;
      })(),
      defaultExpanded: isDeciding,
      isDecidingCause: isDeciding,
    });
  }

  // ── 3. Transfer / freelance ───────────────────────────────────────────────
  {
    const transfer = employee.transfer;
    const isTransfer = dayPlan.baseScheduleSource === 'TEMPORARY_TRANSFER';
    const isFreelance = dayPlan.baseScheduleSource === 'FREELANCE_UNLOCK';
    let status: AvailabilityLayerStatus = 'NO_DATA';
    let summaryAr = 'لا يوجد نقل مؤقت أو فتح استثنائي.';
    let effectAr: string | null = null;

    if (transfer?.direction === 'away') {
      status = 'BLOCKING';
      summaryAr = 'الموظف منقول إلى فرع آخر لهذا اليوم.';
      effectAr = 'الموظف منقول إلى فرع آخر، لذلك غير متاح هنا.';
    } else if (isTransfer || transfer?.direction === 'in') {
      status = 'APPLIED';
      summaryAr = 'تم نقل الموظف إلى هذا الفرع لهذا اليوم.';
      effectAr = `نقل مؤقت · ${transfer?.startTime ?? dayPlan.weeklyWindows?.startTime ?? '—'}–${transfer?.endTime ?? dayPlan.weeklyWindows?.endTime ?? '—'}`;
    } else if (isFreelance) {
      status = 'APPLIED';
      summaryAr = 'تم فتح عمل استثنائي (مستقل) لهذا اليوم.';
      effectAr = 'فتح العمل الاستثنائي أنشأ أساس التوافر لهذا اليوم.';
    }

    const actions: AvailabilityLayerAction[] = [
      controlLayerAction(
        'TRANSFER_OR_FREELANCE',
        permissions.canManageTransfers || permissions.canManageAttendance,
        permissions.canManageTransfers || permissions.canManageAttendance
          ? undefined
          : 'لا توجد صلاحية للنقل أو الحضور',
      ),
    ];
    if (permissions.canManageTransfers) {
      actions.push({
        key: 'open_transfer_page',
        labelAr: 'فتح صفحة الموارد البشرية',
        href: `/admin/hr?empId=${employee.employeeId}`,
        actionType: 'OPEN_PAGE',
        enabled: true,
      });
    }

    layers.push({
      key: 'TRANSFER_OR_FREELANCE',
      order: 3,
      titleAr: 'النقل وفتح العمل الاستثنائي',
      descriptionAr: 'نقل يومي أو فتح عمل للمستقل — لا يُدار عبر التعديلات اليومية.',
      status,
      summaryAr,
      effectAr,
      sourceCode: dayPlan.baseScheduleSource,
      data: {
        transfer: transfer ?? { direction: 'none' },
        freelance: isFreelance,
        activeBranchId,
      },
      warnings: [],
      actions,
      snapshot: snap('TRANSFER_OR_FREELANCE'),
      defaultExpanded: status === 'BLOCKING' || status === 'APPLIED',
    });
  }

  // ── 4. Legacy overrides ──────────────────────────────────────────────────
  {
    const overrides = dayPlan.appliedOverrides ?? [];
    const hasDaily = activeAdjustments.length > 0;
    let status: AvailabilityLayerStatus =
      overrides.length === 0 ? 'NO_DATA' : 'APPLIED';

    // If daily adjustments replaced windows / closed, legacy may be overridden.
    if (
      overrides.length > 0 &&
      (dayPlan.dailyAdjustmentState === 'REPLACED' ||
        dayPlan.dailyAdjustmentState === 'CLOSED' ||
        dayPlan.dailyAdjustmentState === 'EXTENDED')
    ) {
      status = 'OVERRIDDEN';
    }

    const typeLabels = overrides.map((o) => LEGACY_TYPE_AR[o.Type] ?? o.Type);
    const summaryAr =
      overrides.length === 0
        ? 'لا توجد تعديلات قديمة لهذا اليوم.'
        : `تعديلات قديمة: ${typeLabels.join(' · ')}`;

    let effectAr: string | null = null;
    if (overrides.length === 0) {
      effectAr = null;
    } else if (status === 'OVERRIDDEN') {
      effectAr = 'تم تجاوز جزء من أثر التعديلات القديمة بواسطة تعديل يومي أحدث.';
    } else {
      const first = overrides[0]!;
      effectAr = `تم تطبيق ${LEGACY_TYPE_AR[first.Type] ?? first.Type}${
        first.StartTime ? ` (${first.StartTime}${first.EndTime ? `–${first.EndTime}` : ''})` : ''
      }.`;
    }

    const actions: AvailabilityLayerAction[] = [
      controlLayerAction(
        'LEGACY_OVERRIDES',
        permissions.canCancelLegacyOverrides || permissions.canEditDailyAdjustments,
        permissions.canCancelLegacyOverrides || permissions.canEditDailyAdjustments
          ? undefined
          : 'لا توجد صلاحية لإدارة التجاوزات أو التعديلات اليومية',
      ),
      {
        key: 'create_daily_instead',
        labelAr: 'تعديل يومي بدل القديميم',
        actionType: 'OPEN_MODAL',
        modalType: 'REPLACE_WINDOWS',
        enabled: permissions.canEditDailyAdjustments,
        disabledReasonAr: permissions.canEditDailyAdjustments
          ? undefined
          : 'لا توجد صلاحية لإنشاء تعديلات يومية',
      },
      disabled('إنشاء تجاوز قديم', 'معطّل — استخدم التعديلات اليومية', {
        key: 'legacy_create_disabled',
        actionType: 'READ_ONLY',
      }),
    ];

    layers.push({
      key: 'LEGACY_OVERRIDES',
      order: 4,
      titleAr: 'التعديلات القديمة على الجدول',
      descriptionAr: 'نظام قديم — ما زال يؤثر على الحسبة حتى تُلغى السجلات.',
      status,
      summaryAr,
      effectAr,
      sourceCode: 'LEGACY_OVERRIDES',
      data: {
        overrides: overrides.map((o: ScheduleOverride) => ({
          overrideId: o.OverrideID,
          type: o.Type,
          typeAr: LEGACY_TYPE_AR[o.Type] ?? o.Type,
          startTime: o.StartTime,
          endTime: o.EndTime,
          reason: o.Reason,
          createdBy: o.CreatedBy,
          deprecated: true,
        })),
        hasDailyAdjustments: hasDaily,
        deprecationBadgeAr: 'نظام قديم',
      },
      warnings: overrides.length
        ? ['التعديلات القديمة ما زالت تُقرأ في المحرك مع التعديلات اليومية.']
        : [],
      actions,
      snapshot: snap('LEGACY_OVERRIDES'),
      defaultExpanded: overrides.length > 0 && status !== 'OVERRIDDEN',
    });
  }

  // ── 5. Attendance ────────────────────────────────────────────────────────
  {
    const attendance = dayPlan.attendanceState;
    const absent = isAbsent(dayPlan);
    let status: AvailabilityLayerStatus = 'NO_DATA';
    let summaryAr = 'لا يوجد سجل حضور.';
    let effectAr: string | null =
      'الحضور يسجل الواقع التشغيلي، لكنه لا يفتح مواعيد حجز بمفرده.';

    if (absent) {
      status = 'BLOCKING';
      summaryAr = 'الموظف غائب.';
      effectAr = 'الموظف غائب؛ الغياب يمنع التوافر حتى مع وجود تعديل يومي.';
    } else if (attendance?.status === 'Present' || attendance?.checkInTime) {
      status = 'INFORMATIONAL';
      summaryAr = `حاضر${attendance.checkInTime ? ` · دخول ${attendance.checkInTime}` : ''}${
        attendance.checkOutTime ? ` · خروج ${attendance.checkOutTime}` : ''
      }`;
      if (!dayPlan.isWorking) {
        effectAr =
          'الموظف حاضر، لكن لا يوجد جدول أو نافذة يومية تفتح الحجز.';
      } else {
        effectAr =
          'الحضور معلومات تشغيلية — التوافر النهائي يعتمد على نوافذ العمل.';
      }
    } else if (attendance) {
      status = 'INFORMATIONAL';
      summaryAr = `حالة الحضور: ${attendance.status ?? '—'}`;
    }

    const actions: AvailabilityLayerAction[] = [
      controlLayerAction(
        'ATTENDANCE',
        permissions.canManageAttendance,
        permissions.canManageAttendance ? undefined : 'لا توجد صلاحية للحضور',
      ),
    ];
    if (permissions.canManageAttendance) {
      actions.push(
        {
          key: 'mark_present',
          labelAr: 'تسجيل حضور سريع',
          actionType: 'OPEN_LAYER_CONTROL',
          modalType: 'ATTENDANCE',
          enabled: true,
        },
        {
          key: 'mark_absent',
          labelAr: 'تسجيل غياب سريع',
          actionType: 'OPEN_LAYER_CONTROL',
          modalType: 'ATTENDANCE',
          enabled: true,
        },
      );
    }

    layers.push({
      key: 'ATTENDANCE',
      order: 5,
      titleAr: 'الحضور الفعلي',
      descriptionAr:
        'الجدول يحدد متى يمكن استقبال الحجوزات. الحضور يوضح ما حدث فعليًا في يوم العمل. وجود حضور وحده لا يفتح الحجوزات إذا لم توجد ساعات عمل.',
      status,
      summaryAr,
      effectAr,
      sourceCode: attendance?.status ?? null,
      data: {
        attendance,
        policyNoteAr:
          'استعادة الحضور قد تكون «حضور فقط» أو «حضور + نافذة عمل صريحة» حسب الإجراء المستخدم.',
      },
      warnings: absent ? ['الغياب يمنع إعادة الفتح عبر التعديل اليومي'] : [],
      actions,
      snapshot: snap('ATTENDANCE'),
      defaultExpanded: status === 'BLOCKING',
    });
  }

  // ── 6. Daily adjustments ─────────────────────────────────────────────────
  {
    const state = dayPlan.dailyAdjustmentState;
    let status: AvailabilityLayerStatus =
      activeAdjustments.length === 0 ? 'NO_DATA' : 'APPLIED';
    if (state === 'CLOSED' || dayPlan.denyReasonCode === 'DAY_CLOSED_BY_ADJUSTMENT') {
      status = 'BLOCKING';
    }

    const chrono = [...activeAdjustments].sort((a, b) =>
      a.createdAt !== b.createdAt
        ? a.createdAt.localeCompare(b.createdAt)
        : a.adjustmentId - b.adjustmentId,
    );

    const summaryAr =
      activeAdjustments.length === 0
        ? 'لا توجد تعديلات يومية نشطة.'
        : `${DAILY_ADJUSTMENT_STATE_AR[state] ?? state} · ${activeAdjustments.length} تعديل`;

    const effectParts = chrono.map((a, i) => {
      const label = DAILY_ADJUSTMENT_TYPE_AR[a.adjustmentType] ?? a.adjustmentType;
      return `${i + 1}. ${label}`;
    });
    const effectAr =
      effectParts.length > 0
        ? `ترتيب التقييم: ${effectParts.join(' ← ')}`
        : null;

    const canAdj = permissions.canEditDailyAdjustments;
    const actions: AvailabilityLayerAction[] = [
      controlLayerAction(
        'DAILY_ADJUSTMENTS',
        canAdj,
        canAdj ? undefined : 'لا توجد صلاحية للتعديلات اليومية',
      ),
      ...(
        [
          ['CLOSE_DAY', 'إغلاق اليوم'],
          ['REPLACE_WINDOWS', 'استبدال المواعيد'],
          ['ADD_WINDOW', 'إضافة فترة عمل'],
          ['BLOCK_WINDOW', 'حظر فترة'],
        ] as const
      ).map(([modalType, labelAr]) => ({
        key: `adj_${modalType}`,
        labelAr,
        actionType: 'OPEN_MODAL' as const,
        modalType,
        enabled: canAdj,
        disabledReasonAr: canAdj ? undefined : 'لا توجد صلاحية للتعديلات اليومية',
      })),
    ];

    layers.push({
      key: 'DAILY_ADJUSTMENTS',
      order: 6,
      titleAr: 'التعديلات اليومية لهذا اليوم',
      descriptionAr: 'التعديلات اليومية سلطة نهائية على نوافذ اليوم (بعد التجاوزات القديمة).',
      status,
      summaryAr,
      effectAr,
      sourceCode: state,
      data: {
        dailyAdjustmentState: state,
        adjustments: chrono.map((a) => ({
          adjustmentId: a.adjustmentId,
          type: a.adjustmentType,
          typeAr: DAILY_ADJUSTMENT_TYPE_AR[a.adjustmentType],
          windows: a.windows,
          reasonText: a.reasonText,
          reasonCode: a.reasonCode,
          createdBy: a.createdBy,
          createdAt: a.createdAt,
          source: a.source,
        })),
        chronologyAr: chrono.map((a, i) => {
          const t = DAILY_ADJUSTMENT_TYPE_AR[a.adjustmentType];
          const wins =
            a.windows?.length > 0
              ? a.windows.map((w) => `${w.start}–${w.end}`).join('، ')
              : '';
          return `${i + 1}. ${t}${wins ? ` ${wins}` : ''} — ${a.createdAt}`;
        }),
      },
      warnings: dayPlan.warnings.filter((w) =>
        /adjustment|تعديل|REPLACE|ADD|CLOSE|BLOCK/i.test(w),
      ),
      actions,
      snapshot: snap('DAILY_ADJUSTMENTS'),
      defaultExpanded: activeAdjustments.length > 0,
    });
  }

  // ── 7. Final result ──────────────────────────────────────────────────────
  {
    const resultLabel =
      EXPLAIN_RESULT_AR[explanation.result] ?? String(explanation.result);
    const reasonLabel = reasonCodeLabelAr(dayPlan.denyReasonCode);
    const wins = dayPlan.effectiveWindows;
    const blocked = explanation.blockedIntervals;

    let summaryAr = `النتيجة: ${resultLabel}`;
    if (dayPlan.isWorking && wins.length) {
      summaryAr += ` · ${formatWindowsAr(wins)}`;
    } else if (reasonLabel) {
      summaryAr += ` · ${reasonLabel}`;
    }

    const effectAr = [
      decision.summaryAr,
      decision.decidingLayerTitleAr
        ? `مصدر القرار: الطبقة ${decision.decidingLayerOrder} · ${decision.decidingLayerTitleAr}`
        : null,
      ...decision.whyAr,
    ]
      .filter(Boolean)
      .join('\n');

    layers.push({
      key: 'FINAL_RESULT',
      order: 7,
      titleAr: 'النتيجة النهائية المستخدمة في الحجز والطابور',
      descriptionAr: 'هذه هي الحالة التي تستهلكها مسارات الحجز والطابور والجدول الزمني.',
      status: dayPlan.isWorking
        ? blocked.length
          ? 'WARNING'
          : 'APPLIED'
        : dayPlan.denyReasonCode
          ? 'BLOCKING'
          : 'NO_DATA',
      summaryAr,
      effectAr,
      sourceCode: dayPlan.denyReasonCode,
      data: {
        isWorking: dayPlan.isWorking,
        denyReasonCode: dayPlan.denyReasonCode,
        reasonLabelAr: reasonLabel,
        result: explanation.result,
        effectiveWindows: wins,
        blockedIntervals: blocked,
        isOvernight: dayPlan.isOvernight,
        dailyAdjustmentState: dayPlan.dailyAdjustmentState,
        decision,
        equationAr: [
          'الجدول الأساسي',
          '+ النقل / فتح العمل',
          '+ التعديلات القديمة',
          '+ الحضور',
          '+ التعديلات اليومية',
          '= النتيجة النهائية',
        ].join('\n'),
        multiWindowNoteAr:
          wins.length > 1
            ? 'جميع فترات العمل المعروضة تُستخدم فعليًا في الحجز والطابور وإعادة الجدولة.'
            : null,
        runtimeActiveWindowCount: wins.length,
        hasSplitShifts: wins.length > 1,
        bookableWindows: wins.map((w) => ({
          start: w.start,
          end: w.end,
          endDayOffset: w.endDayOffset,
        })),
        gapIntervals: (() => {
          const gaps: Array<{ start: string; end: string }> = [];
          for (let i = 0; i < wins.length - 1; i++) {
            const a = wins[i]!;
            const b = wins[i + 1]!;
            if (b.startMs > a.endMs) {
              gaps.push({ start: a.end, end: b.start });
            }
          }
          return gaps;
        })(),
      },
      warnings: [...dayPlan.warnings],
      actions: [
        controlLayerAction('FINAL_RESULT', true),
        {
          key: 'refresh',
          labelAr: 'تحديث الحساب',
          actionType: 'API_MUTATION',
          enabled: true,
        },
        {
          key: 'copy_tech',
          labelAr: 'نسخ الملخص التقني',
          actionType: 'READ_ONLY',
          enabled: true,
        },
        {
          key: 'tech_details',
          labelAr: 'عرض التفاصيل التقنية',
          actionType: 'READ_ONLY',
          enabled: true,
        },
      ],
      snapshot: snap('FINAL_RESULT'),
      defaultExpanded: true,
      emphasized: true,
    });
  }

  // Mark deciding layer across the pipeline (BASE already set above).
  for (const layer of layers) {
    if (layer.key === 'BASE_SCHEDULE') continue;
    const isDeciding = decision.decidingLayerKey === layer.key;
    if (isDeciding) {
      layer.isDecidingCause = true;
      layer.defaultExpanded = true;
    }
  }

  return layers.sort((a, b) => a.order - b.order);
}

/** Expose decision builder for workforceDay payload without rebuilding layers. */
export function getAvailabilityDecisionFromLayers(
  layers: AvailabilityLayerView[],
): AvailabilityDecisionExplain | null {
  const final = layers.find((l) => l.key === 'FINAL_RESULT');
  const d = final?.data?.decision;
  return d && typeof d === 'object' ? (d as AvailabilityDecisionExplain) : null;
}

export const AVAILABILITY_LAYER_ORDER: AvailabilityLayerKey[] = [
  'EMPLOYMENT',
  'BASE_SCHEDULE',
  'TRANSFER_OR_FREELANCE',
  'LEGACY_OVERRIDES',
  'ATTENDANCE',
  'DAILY_ADJUSTMENTS',
  'FINAL_RESULT',
];

export const DEFAULT_WORKFORCE_LAYER_PERMISSIONS: WorkforceLayerPermissions = {
  canEditDailyAdjustments: true,
  canViewEmployeeProfile: true,
  canEditWeeklySchedule: true,
  canManageTransfers: true,
  canManageAttendance: true,
  canCancelLegacyOverrides: true,
};
