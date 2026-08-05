'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getOperationalDate } from '@/lib/businessDate';
import { WorkforceAvailabilityHeader } from '@/components/admin/workforce/WorkforceAvailabilityHeader';
import { EmployeeAvailabilityGrid } from '@/components/admin/workforce/EmployeeAvailabilityGrid';
import { DailyAdjustmentModal } from '@/components/admin/workforce/DailyAdjustmentModal';
import { AvailabilityExplainDrawer } from '@/components/admin/workforce/AvailabilityExplainDrawer';
import { LayerControlModal } from '@/components/admin/workforce/layer-controls/LayerControlModal';
import { TemporaryBranchTransferModal } from '@/components/operations/TemporaryBranchTransferModal';
import type { TransferAssignmentContext } from '@/components/operations/TemporaryBranchTransferModal';
import EmployeeHrFormModal from '@/components/hr/EmployeeHrFormModal';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';
import type { EmployeeCardModel } from '@/components/admin/workforce/EmployeeAvailabilityCard';
import type { WindowDraft } from '@/lib/availability/timeWindowEditorUtils';
import type { AvailabilityLayerKey } from '@/lib/availability/buildAvailabilityLayers';
import type { HrEmployeeListRow } from '@/components/hr/employee-hr-form-utils';
import {
  AVAILABILITY_LAYER_TITLE_AR,
  BASE_SCHEDULE_SOURCE_AR,
} from '@/lib/availability/workforceUiLabels';
import {
  emitAvailabilityChanged,
  subscribeAvailabilityChanged,
} from '@/lib/availability/availabilityChangedEvent';

function buildTransferAssignmentContext(
  emp: WorkforceDayResponse['employees'][number] | null,
  activeBranchName: string,
  activeBranchId: number | null,
): TransferAssignmentContext | null {
  if (!emp) return null;

  const elsewhere = (
    emp as {
      scheduledElsewhere?: {
        branchId: number;
        branchName: string;
        startTime: string | null;
        endTime: string | null;
      } | null;
    }
  ).scheduledElsewhere;

  const transfer = (
    emp as {
      transfer?: {
        direction: string;
        toBranchName?: string | null;
        fromBranchName?: string | null;
        startTime?: string | null;
        endTime?: string | null;
      };
    }
  ).transfer;

  const source = emp.dayPlan?.baseScheduleSource ?? 'NONE';
  const weekly = emp.dayPlan?.weeklyWindows as {
    isWorkingDay?: boolean;
    startTime?: string | null;
    endTime?: string | null;
  } | null;

  const hoursFromWeekly =
    weekly?.isWorkingDay && weekly.startTime && weekly.endTime
      ? `${weekly.startTime}–${weekly.endTime}`
      : null;

  if (transfer?.direction === 'away') {
    return {
      employeeName: emp.employeeName,
      assignedLayerTitleAr: AVAILABILITY_LAYER_TITLE_AR.TRANSFER_OR_FREELANCE,
      assignedBranchName: transfer.toBranchName ?? 'فرع آخر',
      fromBranchName: activeBranchName || transfer.fromBranchName || 'الفرع الحالي',
      fromBranchId: activeBranchId,
      assignedHoursLabel:
        transfer.startTime && transfer.endTime
          ? `${transfer.startTime}–${transfer.endTime}`
          : hoursFromWeekly,
      baseScheduleSourceAr: BASE_SCHEDULE_SOURCE_AR.TEMPORARY_TRANSFER,
    };
  }

  if (elsewhere) {
    return {
      employeeName: emp.employeeName,
      assignedLayerTitleAr: AVAILABILITY_LAYER_TITLE_AR.BASE_SCHEDULE,
      assignedBranchName: elsewhere.branchName,
      fromBranchName: elsewhere.branchName,
      fromBranchId: elsewhere.branchId,
      assignedHoursLabel:
        elsewhere.startTime && elsewhere.endTime
          ? `${elsewhere.startTime}–${elsewhere.endTime}`
          : null,
      baseScheduleSourceAr: BASE_SCHEDULE_SOURCE_AR.BRANCH_WEEKLY,
    };
  }

  if (transfer?.direction === 'in') {
    return {
      employeeName: emp.employeeName,
      assignedLayerTitleAr: AVAILABILITY_LAYER_TITLE_AR.TRANSFER_OR_FREELANCE,
      assignedBranchName: activeBranchName || 'هذا الفرع',
      fromBranchName: transfer.fromBranchName || activeBranchName || 'هذا الفرع',
      fromBranchId: activeBranchId,
      assignedHoursLabel:
        transfer.startTime && transfer.endTime
          ? `${transfer.startTime}–${transfer.endTime}`
          : hoursFromWeekly,
      baseScheduleSourceAr: BASE_SCHEDULE_SOURCE_AR.TEMPORARY_TRANSFER,
    };
  }

  const layerTitle =
    source === 'TEMPORARY_TRANSFER' || source === 'FREELANCE_UNLOCK'
      ? AVAILABILITY_LAYER_TITLE_AR.TRANSFER_OR_FREELANCE
      : AVAILABILITY_LAYER_TITLE_AR.BASE_SCHEDULE;

  return {
    employeeName: emp.employeeName,
    assignedLayerTitleAr: layerTitle,
    assignedBranchName: activeBranchName || 'هذا الفرع',
    fromBranchName: activeBranchName || 'هذا الفرع',
    fromBranchId: activeBranchId,
    assignedHoursLabel: hoursFromWeekly,
    baseScheduleSourceAr: BASE_SCHEDULE_SOURCE_AR[source] ?? source,
  };
}

type WorkforceDayResponse = {
  ok: true;
  branch: { id: number; code: string; name: string };
  businessDate: string;
  timezone: string;
  cutoffHour: number;
  employees: Array<
    EmployeeCardModel & {
      decision?: import('@/lib/availability/buildAvailabilityDecision').AvailabilityDecisionExplain | null;
      layers?: import('@/lib/availability/buildAvailabilityLayers').AvailabilityLayerView[];
      dailyAdjustments: Array<{
        adjustmentId: number;
        adjustmentType: DailyAdjustmentType;
        reasonCode: string | null;
        reasonText: string | null;
        source: string;
        windows: Array<{ start: string; end: string; endDayOffset: 0 | 1 }>;
        createdBy: number | null;
        createdAt: string;
        version: number;
      }>;
      explanation: {
        result: import('@/lib/availability/explainAvailability').AvailabilityExplainResult;
        reasonCode: string | null;
        evaluationTimeline: Array<{ step: string; detail: string }>;
        overrides: Array<{ Type?: string }>;
      };
    }
  >;
};

export function WorkforceAvailabilityPage() {
  const todayDate = getOperationalDate();
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branchName, setBranchName] = useState('');
  const [employees, setEmployees] = useState<WorkforceDayResponse['employees']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [activeModal, setActiveModal] = useState<DailyAdjustmentType | null>(null);
  const [layerControlKey, setLayerControlKey] = useState<AvailabilityLayerKey | null>(null);
  const [hrFormOpen, setHrFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalErrorCode, setModalErrorCode] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const selectedEmployee =
    employees.find((e) => e.employeeId === selectedEmployeeId) ?? null;

  const loadDay = useCallback(async (date: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch(
        `/api/admin/availability/workforce-day?date=${encodeURIComponent(date)}`,
        { cache: 'no-store', signal: ac.signal },
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'فشل تحميل بيانات التوافر');
        setErrorCode(data?.code ?? String(res.status));
        setEmployees([]);
        return;
      }
      const payload = data as WorkforceDayResponse;
      setBranchId(payload.branch?.id ?? null);
      setBranchName(payload.branch?.name ?? '');
      setEmployees(payload.employees ?? []);
      setLastRefreshAt(
        new Intl.DateTimeFormat('ar-EG', {
          timeZone: payload.timezone || 'Africa/Cairo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      );
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError('تعذر الاتصال بالخادم');
      setErrorCode('NETWORK');
      setEmployees([]);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(selectedDate);
    return () => abortRef.current?.abort();
  }, [selectedDate, loadDay]);

  useEffect(() => {
    return subscribeAvailabilityChanged((detail) => {
      if (detail.businessDate !== selectedDateRef.current) return;
      void loadDay(selectedDateRef.current);
    });
  }, [loadDay]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const openModal = (emp: EmployeeCardModel, type: DailyAdjustmentType) => {
    setSelectedEmployeeId(emp.employeeId);
    setModalError(null);
    setModalErrorCode(null);
    setActiveModal(type);
  };

  const openExplain = (emp: EmployeeCardModel) => {
    setSelectedEmployeeId(emp.employeeId);
    setDrawerOpen(true);
  };

  const submitAdjustment = async (payload: {
    adjustmentType: DailyAdjustmentType;
    reasonText: string;
    reasonCode: string;
    windows?: WindowDraft[];
  }) => {
    if (!selectedEmployee || saving) return;
    setSaving(true);
    setModalError(null);
    setModalErrorCode(null);
    try {
      const body: Record<string, unknown> = {
        empId: selectedEmployee.employeeId,
        businessDate: selectedDate,
        adjustmentType: payload.adjustmentType,
        reasonText: payload.reasonText || null,
        reasonCode: payload.reasonCode || null,
      };
      if (payload.windows) body.windows = payload.windows;

      const res = await fetch('/api/admin/availability/daily-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setModalError(data?.error || 'فشل إنشاء التعديل');
        setModalErrorCode(data?.code ?? null);
        return;
      }
      setActiveModal(null);
      setToast('تم حفظ التعديل اليومي');
      emitAvailabilityChanged({
        businessDate: selectedDate,
        branchId: branchId ?? undefined,
        employeeIds: [selectedEmployee.employeeId],
        source: 'create',
      });
      await loadDay(selectedDate);
    } catch {
      setModalError('تعذر الاتصال بالخادم');
      setModalErrorCode('NETWORK');
    } finally {
      setSaving(false);
    }
  };

  const cancelAdjustment = async (adjustmentId: number) => {
    if (cancellingId) return;
    setCancellingId(adjustmentId);
    try {
      const res = await fetch(
        `/api/admin/availability/daily-adjustments/${adjustmentId}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setToast(data?.error || 'فشل إلغاء التعديل');
        return;
      }
      setToast('تم إلغاء التعديل');
      emitAvailabilityChanged({
        businessDate: selectedDate,
        branchId: branchId ?? undefined,
        employeeIds: selectedEmployeeId != null ? [selectedEmployeeId] : undefined,
        source: 'cancel',
      });
      await loadDay(selectedDate);
    } catch {
      setToast('تعذر الاتصال بالخادم');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="min-h-[70vh]" dir="rtl">
      <WorkforceAvailabilityHeader
        branchName={branchName}
        selectedDate={selectedDate}
        todayDate={todayDate}
        loading={loading}
        lastRefreshAt={lastRefreshAt}
        onDateChange={setSelectedDate}
        onRefresh={() => void loadDay(selectedDate)}
      />

      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-center space-y-3"
          role="alert"
        >
          <p className="text-sm text-rose-200">{error}</p>
          {errorCode && (
            <details className="text-[11px] text-rose-300/80">
              <summary className="cursor-pointer">تفاصيل تقنية</summary>
              <code>{errorCode}</code>
            </details>
          )}
          <button
            type="button"
            className="text-sm underline text-rose-100"
            onClick={() => void loadDay(selectedDate)}
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {!loading && !error && (
        <EmployeeAvailabilityGrid
          employees={employees}
          onAction={openModal}
          onExplain={openExplain}
        />
      )}

      {activeModal && selectedEmployee && (
        <DailyAdjustmentModal
          open={!!activeModal}
          onClose={() => !saving && setActiveModal(null)}
          employeeName={selectedEmployee.employeeName}
          businessDate={selectedDate}
          adjustmentType={activeModal}
          saving={saving}
          error={
            modalError
              ? modalErrorCode
                ? `${modalError}`
                : modalError
              : null
          }
          onSubmit={submitAdjustment}
        />
      )}

      <AvailabilityExplainDrawer
        open={drawerOpen}
        businessDate={selectedDate}
        branchName={branchName}
        employee={
          selectedEmployee as import('@/components/admin/workforce/AvailabilityExplainDrawer').ExplainDrawerEmployee | null
        }
        onClose={() => setDrawerOpen(false)}
        cancellingId={cancellingId}
        onCancelAdjustment={(id) => void cancelAdjustment(id)}
        onOpenAdjustmentModal={(type) => {
          if (selectedEmployeeId == null) return;
          setActiveModal(type);
        }}
        onOpenLayerControl={(key) => {
          if (selectedEmployeeId == null) return;
          setLayerControlKey(key);
        }}
        onRefresh={() => void loadDay(selectedDate)}
      />

      {selectedEmployee && (
        <LayerControlModal
          open={layerControlKey != null}
          layerKey={layerControlKey}
          layer={
            selectedEmployee.layers?.find((l) => l.key === layerControlKey) ?? null
          }
          employeeId={selectedEmployee.employeeId}
          employeeName={selectedEmployee.employeeName}
          employmentType={
            (selectedEmployee as { employmentType?: string | null }).employmentType
          }
          isActive={(selectedEmployee as { isActive?: boolean }).isActive ?? true}
          job={selectedEmployee.job}
          businessDate={selectedDate}
          branchName={branchName}
          dailyAdjustments={selectedEmployee.dailyAdjustments}
          cancellingId={cancellingId}
          onClose={() => setLayerControlKey(null)}
          onSaved={() => {
            emitAvailabilityChanged({
              businessDate: selectedDate,
              branchId: branchId ?? undefined,
              employeeIds: [selectedEmployee.employeeId],
              source: 'create',
            });
            void loadDay(selectedDate);
          }}
          onOpenHrForm={() => setHrFormOpen(true)}
          onOpenTransfer={() => setTransferOpen(true)}
          onOpenDailyAdjustment={(type) => {
            setLayerControlKey(null);
            setActiveModal(type);
          }}
          onCancelAdjustment={(id) => void cancelAdjustment(id)}
          onRefresh={() => void loadDay(selectedDate)}
        />
      )}

      <TemporaryBranchTransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        workDate={selectedDate}
        initialEmpId={selectedEmployeeId}
        assignmentContext={buildTransferAssignmentContext(
          selectedEmployee,
          branchName,
          branchId,
        )}
        onTransferred={() => {
          setTransferOpen(false);
          emitAvailabilityChanged({
            businessDate: selectedDate,
            branchId: branchId ?? undefined,
            employeeIds: selectedEmployeeId != null ? [selectedEmployeeId] : undefined,
            source: 'create',
          });
          void loadDay(selectedDate);
        }}
      />

      <EmployeeHrFormModal
        open={hrFormOpen}
        onOpenChange={setHrFormOpen}
        mode="edit"
        employee={
          selectedEmployee
            ? ({
                EmpID: selectedEmployee.employeeId,
                EmpName: selectedEmployee.employeeName,
                Job: selectedEmployee.job,
                isActive:
                  (selectedEmployee as { isActive?: boolean }).isActive ?? true,
                EmploymentType:
                  (selectedEmployee as { employmentType?: string | null })
                    .employmentType ?? null,
              } as HrEmployeeListRow)
            : null
        }
        onSaved={() => {
          setHrFormOpen(false);
          setToast('تم حفظ بيانات الموظف');
          void loadDay(selectedDate);
        }}
      />

      {toast && (
        <div
          className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-zinc-100 px-4 py-2 text-sm text-zinc-900 shadow-lg"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
