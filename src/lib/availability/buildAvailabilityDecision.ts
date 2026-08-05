/**
 * Pure decision narrative for workforce availability cards / layers inspector.
 * Maps deny/result → deciding layer + Arabic why/how-to-change.
 */

import type { EmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import {
  AVAILABILITY_LAYER_TITLE_AR,
  reasonCodeLabelAr,
  WORKFORCE_UI_STATUS_AR,
  type WorkforceUiStatusKey,
} from '@/lib/availability/workforceUiLabels';

export type DecisionLayerKey =
  | 'EMPLOYMENT'
  | 'BASE_SCHEDULE'
  | 'TRANSFER_OR_FREELANCE'
  | 'LEGACY_OVERRIDES'
  | 'ATTENDANCE'
  | 'DAILY_ADJUSTMENTS'
  | 'FINAL_RESULT';

export type AvailabilityDecisionExplain = {
  outcomeKey: WorkforceUiStatusKey | 'available';
  outcomeAr: string;
  reasonCode: string | null;
  reasonLabelAr: string | null;
  decidingLayerKey: DecisionLayerKey | null;
  decidingLayerOrder: number | null;
  decidingLayerTitleAr: string | null;
  /** Short one-liner for cards */
  summaryAr: string;
  /** Ordered explanation bullets */
  whyAr: string[];
  howToChangeAr: string[];
  /** Compact chain for drawer header */
  chainAr: string[];
};

type TransferLike = {
  direction: 'none' | 'in' | 'away';
  toBranchName?: string | null;
};

type ElsewhereLike = {
  branchId: number;
  branchCode: string;
  branchName: string;
  startTime: string | null;
  endTime: string | null;
};

const LAYER_ORDER: Record<DecisionLayerKey, number> = {
  EMPLOYMENT: 1,
  BASE_SCHEDULE: 2,
  TRANSFER_OR_FREELANCE: 3,
  LEGACY_OVERRIDES: 4,
  ATTENDANCE: 5,
  DAILY_ADJUSTMENTS: 6,
  FINAL_RESULT: 7,
};

function layerMeta(key: DecisionLayerKey) {
  return {
    decidingLayerKey: key,
    decidingLayerOrder: LAYER_ORDER[key],
    decidingLayerTitleAr: AVAILABILITY_LAYER_TITLE_AR[key],
  };
}

function hasDayOffOverride(plan: EmployeeDayPlan): boolean {
  return (plan.appliedOverrides ?? []).some(
    (o) => o.IsActive !== false && o.Type === 'day_off',
  );
}

function elsewhereHours(e: ElsewhereLike): string {
  if (e.startTime && e.endTime) return `${e.startTime}–${e.endTime}`;
  return 'بمواعيد محددة';
}

/**
 * Explain *why* the employee is available / unavailable and which layer decided it.
 */
export function buildAvailabilityDecision(args: {
  dayPlan: EmployeeDayPlan;
  isActive: boolean;
  transfer?: TransferLike | null;
  scheduledElsewhere?: ElsewhereLike | null;
  activeBranchName?: string | null;
  uiStatusKey?: WorkforceUiStatusKey;
}): AvailabilityDecisionExplain {
  const { dayPlan, isActive, transfer, scheduledElsewhere, activeBranchName } = args;
  const code = dayPlan.denyReasonCode;
  const reasonLabelAr = reasonCodeLabelAr(code);
  const weekly = dayPlan.weeklyWindows;
  const outcomeKey = (args.uiStatusKey ??
    (dayPlan.isWorking ? 'available' : 'unavailable')) as WorkforceUiStatusKey;
  const outcomeAr = WORKFORCE_UI_STATUS_AR[outcomeKey] ?? outcomeKey;

  const chainAr = [
    '١ بيانات الموظف',
    '٢ الجدول الأساسي',
    '٣ نقل / فتح استثنائي',
    '٤ تعديلات قديمة',
    '٥ حضور',
    '٦ تعديلات يومية',
    '٧ نتيجة نهائية',
  ];

  if (dayPlan.isWorking && dayPlan.effectiveWindows.length > 0) {
    const wins = dayPlan.effectiveWindows
      .map((w) =>
        w.endDayOffset === 1 ? `${w.start}–${w.end}+1` : `${w.start}–${w.end}`,
      )
      .join(' · ');
    const fromDaily = dayPlan.dailyAdjustments.length > 0;
    const meta = fromDaily
      ? layerMeta('DAILY_ADJUSTMENTS')
      : layerMeta('BASE_SCHEDULE');
    return {
      outcomeKey: 'available',
      outcomeAr: WORKFORCE_UI_STATUS_AR.available,
      reasonCode: null,
      reasonLabelAr: null,
      ...meta,
      summaryAr: `متاح · ${wins}`,
      whyAr: [
        fromDaily
          ? 'التوافر النهائي جاء بعد تطبيق التعديلات اليومية على أساس الجدول.'
          : 'التوافر النهائي مأخوذ من الجدول الأساسي (بعد أي طبقات لاحقة إن وُجدت).',
        `النوافذ المستخدمة في الحجز والطابور: ${wins}`,
      ],
      howToChangeAr: [
        'لتغيير اليوم فقط: استخدم التعديلات اليومية (استبدال / إضافة / حظر / إغلاق).',
        'لتغيير كل أسبوع: عدّل الجدول الأسبوعي للفرع.',
      ],
      chainAr,
    };
  }

  if (!isActive || code === 'EMPLOYEE_INACTIVE') {
    return {
      outcomeKey: 'unavailable',
      outcomeAr: WORKFORCE_UI_STATUS_AR.unavailable,
      reasonCode: code ?? 'EMPLOYEE_INACTIVE',
      reasonLabelAr: reasonLabelAr ?? 'الموظف غير نشط',
      ...layerMeta('EMPLOYMENT'),
      summaryAr: 'غير متاح لأن حساب الموظف غير نشط',
      whyAr: [
        'طبقة بيانات الموظف أوقفت التوافر بالكامل.',
        'أي جدول أو تعديل لاحق لن يفتح الحجوزات بينما الموظف غير نشط.',
      ],
      howToChangeAr: ['فعّل الموظف من ملفه في الموارد البشرية ثم أعد التحميل.'],
      chainAr,
    };
  }

  if (code === 'EMPLOYEE_ABSENT') {
    return {
      outcomeKey: 'absent',
      outcomeAr: WORKFORCE_UI_STATUS_AR.absent,
      reasonCode: code,
      reasonLabelAr,
      ...layerMeta('ATTENDANCE'),
      summaryAr: 'غائب — الحضور أغلق التوافر لهذا اليوم',
      whyAr: [
        'القرار جاء من طبقة الحضور الفعلي.',
        'تسجيل الغياب يمنع الحجوزات ولا يمكن إعادة فتح اليوم عبر التعديلات اليومية.',
      ],
      howToChangeAr: [
        'أزل الغياب / صحّح الحضور من شاشة الحضور، ثم أعد حساب التوافر.',
      ],
      chainAr,
    };
  }

  if (transfer?.direction === 'away') {
    return {
      outcomeKey: 'unavailable',
      outcomeAr: WORKFORCE_UI_STATUS_AR.unavailable,
      reasonCode: code,
      reasonLabelAr: reasonLabelAr ?? 'منقول لفرع آخر',
      ...layerMeta('TRANSFER_OR_FREELANCE'),
      summaryAr: `غير متاح هنا — منقول إلى ${transfer.toBranchName ?? 'فرع آخر'}`,
      whyAr: [
        'القرار جاء من طبقة النقل المؤقت.',
        'الموظف يعمل اليوم على فرع آخر، لذلك لا تظهر له نوافذ على هذا الفرع.',
      ],
      howToChangeAr: [
        'ألغِ النقل المؤقت أو راجع فرع الوجهة إن كان هذا هو الفرع المقصود.',
      ],
      chainAr,
    };
  }

  // Split-week: working on another branch today (not a true day off).
  if (!dayPlan.isWorking && scheduledElsewhere) {
    const hours = elsewhereHours(scheduledElsewhere);
    const here = activeBranchName ? `فرع ${activeBranchName}` : 'هذا الفرع';
    return {
      outcomeKey: 'scheduled_elsewhere',
      outcomeAr: WORKFORCE_UI_STATUS_AR.scheduled_elsewhere,
      reasonCode: code ?? 'EMPLOYEE_OFF_DAY',
      reasonLabelAr: `مجدول على ${scheduledElsewhere.branchName}`,
      ...layerMeta('BASE_SCHEDULE'),
      summaryAr: `على فرع آخر اليوم · ${scheduledElsewhere.branchName} · ${hours}`,
      whyAr: [
        'القرار جاء من الطبقة ٢ · الجدول الأساسي للفرع.',
        `الجدول الأسبوعي يضع الموظف اليوم على «${scheduledElsewhere.branchName}» (${hours})، لذلك هو غير متاح للحجز على ${here}.`,
        'هذا ليس إجازة عامة — اليوم يوم عمل، لكن على فرع مختلف حسب توزيعك الأسبوعي.',
        'صفحة التوافر تعرض فرعًا واحدًا فقط (الفرع النشط في أعلى الصفحة).',
      ],
      howToChangeAr: [
        `لمتابعة توافره اليوم: بدّل الفرع النشط إلى «${scheduledElsewhere.branchName}».`,
        'لتغيير التوزيع الأسبوعي: افتح «إدارة الجدول الأسبوعي» وانقل هذا اليوم إلى الفرع الحالي أو غيّر المواعيد.',
        'لهذا اليوم فقط على الفرع الحالي: استخدم «إضافة فترة عمل» (بدون تغيير باقي الأسابيع).',
      ],
      chainAr,
    };
  }

  if (code === 'DAY_CLOSED_BY_ADJUSTMENT') {
    return {
      outcomeKey: 'day_closed',
      outcomeAr: WORKFORCE_UI_STATUS_AR.day_closed,
      reasonCode: code,
      reasonLabelAr,
      ...layerMeta('DAILY_ADJUSTMENTS'),
      summaryAr: 'اليوم مغلق بتعديل يومي',
      whyAr: [
        'القرار جاء من طبقة التعديلات اليومية (إغلاق اليوم).',
        'كان هناك أساس جدول، لكن الإغلاق اليومي أزال كل النوافذ لهذا التاريخ فقط.',
      ],
      howToChangeAr: [
        'ألغِ تعديل إغلاق اليوم من سجل التعديلات، أو أضف فترة عمل جديدة لهذا اليوم.',
      ],
      chainAr,
    };
  }

  if (
    code === 'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS' ||
    code === 'BLOCKED_BY_DAILY_ADJUSTMENT'
  ) {
    return {
      outcomeKey: outcomeKey === 'unavailable' ? 'unavailable' : outcomeKey,
      outcomeAr,
      reasonCode: code,
      reasonLabelAr,
      ...layerMeta('DAILY_ADJUSTMENTS'),
      summaryAr: 'لا توجد نوافذ صالحة بعد التعديلات اليومية',
      whyAr: [
        'القرار جاء من طبقة التعديلات اليومية.',
        'التعديلات (استبدال / حظر / إغلاق) أزالت أو حجبت كل فترات العمل الصالحة.',
      ],
      howToChangeAr: [
        'راجع التعديلات النشطة وألغِ ما يلزم، أو استبدل المواعيد بفترة صالحة.',
      ],
      chainAr,
    };
  }

  if (code === 'BLOCKED_BY_OVERRIDE' || hasDayOffOverride(dayPlan)) {
    return {
      outcomeKey: 'day_off',
      outcomeAr: WORKFORCE_UI_STATUS_AR.day_off,
      reasonCode: code ?? 'BLOCKED_BY_OVERRIDE',
      reasonLabelAr: reasonLabelAr ?? 'تجاوز جدول قديم',
      ...layerMeta('LEGACY_OVERRIDES'),
      summaryAr: 'إجازة / حظر من نظام التعديلات القديمة',
      whyAr: [
        'القرار جاء من طبقة التعديلات القديمة (نظام قديم).',
        'يوجد تجاوز يومي قديم (مثل إجازة يوم) يغلق العمل لهذا التاريخ.',
      ],
      howToChangeAr: [
        'ألغِ التجاوز القديميم من إدارة مواعيد اليوم، أو أضف فترة عمل عبر التعديلات اليومية الجديدة.',
      ],
      chainAr,
    };
  }

  if (code === 'FREELANCER_NOT_PLANNED') {
    return {
      outcomeKey: 'no_schedule',
      outcomeAr: WORKFORCE_UI_STATUS_AR.no_schedule,
      reasonCode: code,
      reasonLabelAr,
      ...layerMeta('TRANSFER_OR_FREELANCE'),
      summaryAr: 'مستقل بدون فتح عمل لهذا اليوم',
      whyAr: [
        'القرار جاء من طبقة النقل / فتح العمل الاستثنائي.',
        'الموظف فري لانس ولا يوجد فتح عمل صريح أو جدول لهذا اليوم.',
      ],
      howToChangeAr: [
        'افتح عملًا استثنائيًا من الحضور/التخطيط، أو أضف فترة عبر التعديلات اليومية.',
      ],
      chainAr,
    };
  }

  if (code === 'SCHEDULE_NOT_CONFIGURED' || (!weekly && !dayPlan.isWorking)) {
    return {
      outcomeKey: 'no_schedule',
      outcomeAr: WORKFORCE_UI_STATUS_AR.no_schedule,
      reasonCode: code ?? 'SCHEDULE_NOT_CONFIGURED',
      reasonLabelAr: reasonLabelAr ?? 'لا يوجد جدول عمل',
      ...layerMeta('BASE_SCHEDULE'),
      summaryAr: 'بدون جدول — لم يُضبط جدول أسبوعي لهذا اليوم',
      whyAr: [
        'القرار جاء من طبقة الجدول الأساسي للفرع.',
        'لا توجد صفوف جدول فعّالة لهذا الموظف/الفرع/اليوم، لذلك لا تُفتح نوافذ.',
      ],
      howToChangeAr: [
        'اضبط الجدول الأسبوعي من صفحة مواعيد الفروع.',
        'أو أضف فترة عمل لهذا اليوم فقط عبر «إضافة فترة عمل».',
      ],
      chainAr,
    };
  }

  if (
    code === 'EMPLOYEE_OFF_DAY' ||
    (weekly && weekly.isWorkingDay === false)
  ) {
    const scheduledOff = weekly && weekly.isWorkingDay === false;
    return {
      outcomeKey: 'day_off',
      outcomeAr: WORKFORCE_UI_STATUS_AR.day_off,
      reasonCode: code ?? 'EMPLOYEE_OFF_DAY',
      reasonLabelAr: reasonLabelAr ?? 'الموظف في إجازة',
      ...layerMeta('BASE_SCHEDULE'),
      summaryAr: scheduledOff
        ? 'إجازة أسبوعية حقيقية — اليوم محدد كإجازة في الجدول'
        : 'إجازة / يوم غير عامل',
      whyAr: [
        'القرار جاء من الطبقة ٢ · الجدول الأساسي للفرع.',
        scheduledOff
          ? 'في صفحة الجدول الأسبوعي هذا اليوم مضبوط على «إجازة» — مش شغال على فرع تاني.'
          : 'لا توجد ساعات عمل فعّالة لهذا اليوم بعد حلّ الجدول الأساسي.',
        'هذا يؤثر على نفس اليوم من كل أسبوع إلى أن تعدّل الجدول الأسبوعي.',
      ],
      howToChangeAr: [
        'لتشغيل هذا اليوم كل أسبوع: افتح الجدول الأسبوعي، اختر فرعًا، وحدّد من/إلى، ثم احفظ.',
        'لتشغيل هذا التاريخ فقط: استخدم «إضافة فترة عمل» من التعديلات اليومية.',
      ],
      chainAr,
    };
  }

  return {
    outcomeKey,
    outcomeAr,
    reasonCode: code,
    reasonLabelAr,
    ...layerMeta('FINAL_RESULT'),
    summaryAr: reasonLabelAr
      ? `${outcomeAr} · ${reasonLabelAr}`
      : `${outcomeAr} · لا توجد نوافذ`,
    whyAr: [
      'النتيجة النهائية بلا نوافذ عمل صالحة.',
      code ? `رمز السبب: ${code}` : 'لم يُحدَّد رمز سبب تفصيلي.',
    ],
    howToChangeAr: [
      'راجع الطبقات بالترتيب من أعلى لأسفل لمعرفة أين أُغلقت النوافذ.',
    ],
    chainAr,
  };
}
