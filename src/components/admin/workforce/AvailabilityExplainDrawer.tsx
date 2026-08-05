'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DailyAdjustmentHistory,
  type HistoryAdjustment,
} from '@/components/admin/workforce/DailyAdjustmentHistory';
import { WorkforceConfirmDialog } from '@/components/admin/workforce/WorkforceConfirmDialog';
import { AvailabilityLayersInspector } from '@/components/admin/workforce/layers/AvailabilityLayersInspector';
import type {
  AvailabilityLayerAction,
  AvailabilityLayerView,
} from '@/lib/availability/buildAvailabilityLayers';
import {
  EXPLAIN_RESULT_AR,
  reasonCodeLabelAr,
} from '@/lib/availability/workforceUiLabels';
import type { AvailabilityExplainResult } from '@/lib/availability/explainAvailability';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';

export type ExplainDrawerEmployee = {
  employeeId: number;
  employeeName: string;
  employmentType?: string | null;
  isActive?: boolean;
  job?: string | null;
  dayPlan: {
    baseScheduleSource: string;
    effectiveWindows: Array<{
      start: string;
      end: string;
      endDayOffset: 0 | 1;
    }>;
    blockedIntervals: Array<{ startMs: number; endMs: number; reason?: string }>;
    attendanceState: {
      status?: string | null;
      checkInTime?: string | null;
      checkOutTime?: string | null;
    } | null | unknown;
    denyReasonCode: string | null;
    warnings: string[];
    dailyAdjustmentState: string;
    isOvernight: boolean;
    isWorking?: boolean;
  };
  dailyAdjustments: HistoryAdjustment[];
  explanation: {
    result: AvailabilityExplainResult | string;
    reasonCode: string | null;
    evaluationTimeline: Array<{ step: string; detail: string }>;
    overrides: Array<{ Type?: string } | Record<string, unknown>>;
    layers?: unknown;
  };
  layers?: AvailabilityLayerView[];
  transfer?: unknown;
};

export function AvailabilityExplainDrawer({
  open,
  employee,
  businessDate,
  branchName,
  onClose,
  cancellingId,
  onCancelAdjustment,
  onOpenAdjustmentModal,
  onOpenLayerControl,
  onRefresh,
}: {
  open: boolean;
  employee: ExplainDrawerEmployee | null;
  businessDate: string;
  branchName?: string | null;
  onClose: () => void;
  cancellingId: number | null;
  onCancelAdjustment: (adjustmentId: number) => void;
  onOpenAdjustmentModal?: (type: DailyAdjustmentType) => void;
  onOpenLayerControl?: (layerKey: import('@/lib/availability/buildAvailabilityLayers').AvailabilityLayerKey) => void;
  onRefresh?: () => void;
}) {
  const [tab, setTab] = useState<'layers' | 'history'>('layers');
  const [history, setHistory] = useState<HistoryAdjustment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('layers');
    setHistory([]);
    setHistoryError(null);
  }, [open, employee?.employeeId, businessDate]);

  useEffect(() => {
    if (!open || !employee || tab !== 'history') return;
    let cancelled = false;
    const load = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const res = await fetch(
          `/api/admin/availability/daily-adjustments?date=${encodeURIComponent(businessDate)}&empId=${employee.employeeId}&status=all`,
          { cache: 'no-store' },
        );
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          if (!cancelled) setHistoryError(data?.error || 'فشل تحميل السجل');
          return;
        }
        if (!cancelled) setHistory(data.adjustments ?? []);
      } catch {
        if (!cancelled) setHistoryError('تعذر الاتصال بالخادم');
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, employee, tab, businessDate]);

  const layers = employee?.layers ?? [];

  const attendance =
    employee?.dayPlan.attendanceState &&
    typeof employee.dayPlan.attendanceState === 'object'
      ? (employee.dayPlan.attendanceState as {
          status?: string | null;
          checkInTime?: string | null;
          checkOutTime?: string | null;
        })
      : null;

  const isClosed =
    employee?.dayPlan.denyReasonCode === 'DAY_CLOSED_BY_ADJUSTMENT' ||
    (!employee?.dayPlan.isWorking &&
      (employee?.dayPlan.effectiveWindows.length ?? 0) === 0);

  const resultLabel = employee
    ? EXPLAIN_RESULT_AR[employee.explanation.result as AvailabilityExplainResult] ??
      String(employee.explanation.result)
    : '';

  const footerPrimary = useMemo(() => {
    if (!layers.length) return [];
    const daily = layers.find((l) => l.key === 'DAILY_ADJUSTMENTS');
    if (!daily) return [];
    const working = employee?.dayPlan.isWorking;
    const keys = working
      ? ['adj_REPLACE_WINDOWS', 'adj_BLOCK_WINDOW', 'adj_ADD_WINDOW']
      : ['adj_ADD_WINDOW', 'adj_REPLACE_WINDOWS', 'adj_BLOCK_WINDOW'];
    return daily.actions.filter((a) => keys.includes(a.key));
  }, [layers, employee?.dayPlan.isWorking]);

  const handleAction = (action: AvailabilityLayerAction) => {
    if (!action.enabled) return;
    if (action.actionType === 'OPEN_LAYER_CONTROL' && action.modalType && onOpenLayerControl) {
      onOpenLayerControl(
        action.modalType as import('@/lib/availability/buildAvailabilityLayers').AvailabilityLayerKey,
      );
      return;
    }
    if (action.actionType === 'OPEN_PAGE' && action.href) {
      window.open(action.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.actionType === 'OPEN_MODAL' && action.modalType && onOpenAdjustmentModal) {
      onOpenAdjustmentModal(action.modalType as DailyAdjustmentType);
      return;
    }
    if (action.key === 'refresh' && onRefresh) {
      onRefresh();
      return;
    }
    if (action.key === 'copy_tech' && employee) {
      const payload = {
        employeeId: employee.employeeId,
        businessDate,
        denyReasonCode: employee.dayPlan.denyReasonCode,
        windows: employee.dayPlan.effectiveWindows,
        layers: layers.map((l) => ({
          key: l.key,
          status: l.status,
          summaryAr: l.summaryAr,
        })),
      };
      void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    }
  };

  if (!open || !employee) return null;

  const timelineWindows = employee.dayPlan.effectiveWindows.map((w) => ({
    ...w,
    kind: 'working' as const,
  }));

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="طبقات توافر الموظف">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <aside
        className="absolute inset-y-0 left-0 flex w-full max-w-lg flex-col border-r border-zinc-800 bg-zinc-950 shadow-xl"
        dir="rtl"
      >
        <div className="flex gap-1 border-b border-zinc-800 px-3 pt-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'layers'}
            className={`px-3 py-1.5 text-xs rounded-t ${
              tab === 'layers' ? 'bg-zinc-800 text-white' : 'text-zinc-500'
            }`}
            onClick={() => setTab('layers')}
          >
            الطبقات
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={`px-3 py-1.5 text-xs rounded-t ${
              tab === 'history' ? 'bg-zinc-800 text-white' : 'text-zinc-500'
            }`}
            onClick={() => setTab('history')}
          >
            سجل التعديلات
          </button>
        </div>

        {tab === 'layers' && layers.length > 0 && (
          <AvailabilityLayersInspector
            layers={layers}
            businessDate={businessDate}
            employeeName={employee.employeeName}
            finalStatusLabel={resultLabel}
            branchName={branchName}
            timelineWindows={timelineWindows}
            blockedIntervals={employee.dayPlan.blockedIntervals}
            attendanceCheckIn={attendance?.checkInTime}
            attendanceCheckOut={attendance?.checkOutTime}
            isClosedDay={!!isClosed}
            onAction={handleAction}
            onRefresh={() => onRefresh?.()}
            onClose={onClose}
            footerPrimary={footerPrimary}
          />
        )}

        {tab === 'layers' && layers.length === 0 && (
          <div className="p-4 text-sm text-zinc-400">
            لا تتوفر بيانات الطبقات — أعد تحميل الصفحة.
            {employee.explanation.reasonCode && (
              <p className="mt-2 text-xs font-mono text-zinc-600">
                {reasonCodeLabelAr(employee.explanation.reasonCode) ??
                  employee.explanation.reasonCode}
              </p>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <h3 className="text-sm font-medium text-zinc-200">التعديلات الحالية</h3>
            <DailyAdjustmentHistory
              adjustments={employee.dailyAdjustments}
              cancellingId={cancellingId}
              onRequestCancel={(id) => setPendingCancelId(id)}
              emptyLabel="لا توجد تعديلات يومية نشطة."
            />
            <h3 className="text-sm font-medium text-zinc-200 pt-2">السجل الكامل</h3>
            {historyLoading && (
              <p className="text-xs text-zinc-500" aria-busy="true">
                جاري تحميل السجل…
              </p>
            )}
            {historyError && (
              <p className="text-xs text-rose-300" role="alert">
                {historyError}
              </p>
            )}
            {!historyLoading && !historyError && (
              <DailyAdjustmentHistory
                adjustments={history}
                cancellingId={null}
                showCancel={false}
                emptyLabel="لا يوجد سجل تعديلات لهذا اليوم."
              />
            )}
          </div>
        )}
      </aside>

      <WorkforceConfirmDialog
        open={pendingCancelId != null}
        title="إلغاء التعديل"
        description="هل تريد إلغاء هذا التعديل؟ سيتم إعادة حساب توافر الموظف فورًا."
        confirmLabel="إلغاء التعديل"
        destructive
        confirming={cancellingId === pendingCancelId}
        onCancel={() => setPendingCancelId(null)}
        onConfirm={() => {
          if (pendingCancelId == null) return;
          const id = pendingCancelId;
          setPendingCancelId(null);
          onCancelAdjustment(id);
        }}
      />
    </div>
  );
}
