'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AvailabilityStatusBadge } from '@/components/admin/workforce/AvailabilityStatusBadge';
import { AvailabilityTimeChips } from '@/components/admin/workforce/AvailabilityTimeChips';
import {
  BASE_SCHEDULE_SOURCE_AR,
  DAILY_ADJUSTMENT_STATE_AR,
  DAILY_ADJUSTMENT_TYPE_AR,
} from '@/lib/availability/workforceUiLabels';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';
import type { WorkforceUiStatusKey } from '@/lib/availability/workforceUiLabels';
import type { AvailabilityDecisionExplain } from '@/lib/availability/buildAvailabilityDecision';

export type EmployeeCardModel = {
  employeeId: number;
  employeeName: string;
  job?: string | null;
  isActive?: boolean;
  employmentType?: string | null;
  uiStatus: { key: WorkforceUiStatusKey; labelAr: string };
  reasonLabelAr: string | null;
  decision?: AvailabilityDecisionExplain | null;
  layers?: import('@/lib/availability/buildAvailabilityLayers').AvailabilityLayerView[];
  dayPlan: {
    isWorking: boolean;
    baseScheduleSource: string;
    weeklyWindows: {
      startTime?: string | null;
      endTime?: string | null;
      isWorkingDay?: boolean;
    } | null;
    effectiveWindows: Array<{ start: string; end: string; endDayOffset: 0 | 1 }>;
    blockedIntervals: Array<{ startMs: number; endMs: number; reason?: string }>;
    attendanceState: { status?: string | null } | null;
    denyReasonCode: string | null;
    isOvernight: boolean;
    dailyAdjustmentState: string;
  };
  dailyAdjustments: Array<{
    adjustmentId: number;
    adjustmentType: DailyAdjustmentType;
    createdAt: string;
  }>;
};

export function EmployeeAvailabilityCard({
  employee,
  onAction,
  onExplain,
}: {
  employee: EmployeeCardModel;
  onAction: (type: DailyAdjustmentType) => void;
  onExplain: () => void;
}) {
  const weekly = employee.dayPlan.weeklyWindows;
  const weeklyLabel =
    weekly?.isWorkingDay && weekly.startTime && weekly.endTime
      ? `${weekly.startTime} ← ${weekly.endTime}`
      : weekly && weekly.isWorkingDay === false
        ? 'إجازة (حسب الجدول الأسبوعي)'
        : '—';

  const decision = employee.decision;

  return (
    <article
      className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3"
      aria-label={`توافر ${employee.employeeName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-white">{employee.employeeName}</h3>
          {employee.job && <p className="text-xs text-zinc-500">{employee.job}</p>}
        </div>
        <AvailabilityStatusBadge
          statusKey={employee.uiStatus.key}
          labelAr={employee.uiStatus.labelAr}
        />
      </div>

      {decision && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 space-y-1.5"
          role="status"
        >
          <p className="text-[11px] font-medium text-amber-100">{decision.summaryAr}</p>
          {decision.decidingLayerTitleAr && (
            <p className="text-[11px] text-zinc-300">
              مصدر القرار:{' '}
              <span className="text-amber-50">
                الطبقة {decision.decidingLayerOrder} · {decision.decidingLayerTitleAr}
              </span>
            </p>
          )}
          {decision.whyAr[0] && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">{decision.whyAr[0]}</p>
          )}
          {decision.whyAr[1] && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">{decision.whyAr[1]}</p>
          )}
          {decision.howToChangeAr[0] && (
            <p className="text-[11px] text-emerald-200/90 leading-relaxed">
              تحكم: {decision.howToChangeAr[0]}
            </p>
          )}
          <button
            type="button"
            className="text-[11px] text-sky-300 underline-offset-2 hover:underline"
            onClick={onExplain}
          >
            عرض الطبقات بالترتيب
          </button>
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-zinc-500">مصدر الجدول</dt>
          <dd className="text-zinc-200">
            {BASE_SCHEDULE_SOURCE_AR[employee.dayPlan.baseScheduleSource] ??
              employee.dayPlan.baseScheduleSource}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">الجدول الأساسي</dt>
          <dd className="text-zinc-200 font-mono">{weeklyLabel}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-zinc-500 mb-1">النوافذ الفعلية</dt>
          <dd>
            <AvailabilityTimeChips windows={employee.dayPlan.effectiveWindows} />
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">الحضور</dt>
          <dd className="text-zinc-200">
            {employee.dayPlan.attendanceState?.status ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">حالة التعديل</dt>
          <dd className="text-zinc-200">
            {DAILY_ADJUSTMENT_STATE_AR[employee.dayPlan.dailyAdjustmentState] ??
              employee.dayPlan.dailyAdjustmentState}
          </dd>
        </div>
      </dl>

      {employee.dayPlan.blockedIntervals.length > 0 && (
        <p className="text-xs text-amber-200/90">
          فترات محظورة: {employee.dayPlan.blockedIntervals.length}
        </p>
      )}

      {employee.dayPlan.isOvernight && (
        <Badge variant="outline" className="text-amber-200 border-amber-500/40">
          ليلة / ينتهي اليوم التالي
        </Badge>
      )}

      {!decision && (employee.reasonLabelAr || employee.dayPlan.denyReasonCode) && (
        <p className="text-xs text-zinc-400">
          {employee.reasonLabelAr}
          {employee.dayPlan.denyReasonCode ? (
            <span className="font-mono text-zinc-600 ms-2">
              {employee.dayPlan.denyReasonCode}
            </span>
          ) : null}
        </p>
      )}

      {employee.dailyAdjustments.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {employee.dailyAdjustments.map((a) => (
            <Badge key={a.adjustmentId} variant="secondary" className="text-[10px]">
              {DAILY_ADJUSTMENT_TYPE_AR[a.adjustmentType] ?? a.adjustmentType}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={() => onAction('CLOSE_DAY')}>
          إغلاق اليوم
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onAction('REPLACE_WINDOWS')}
        >
          استبدال المواعيد
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onAction('ADD_WINDOW')}>
          إضافة فترة عمل
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onAction('BLOCK_WINDOW')}>
          حظر فترة
        </Button>
        <Button type="button" size="sm" onClick={onExplain}>
          عرض التفاصيل
        </Button>
      </div>
    </article>
  );
}
