'use client';

/**
 * Smart Fix modal (Phase 6B) — nested/root-cause resolution from real backend results.
 * Backend readiness remains authority after every successful sub-fix.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Wrench, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import SmartAttendanceFixDialog from '@/components/hr/SmartAttendanceFixDialog';
import type {
  DailyPayrollReadinessBlocker,
  DailyPayrollReadinessResult,
  SmartFixActionResult,
} from '@/lib/hr/dailyPayrollReadiness.types';
import { blockerMessageAr } from '@/lib/hr/dailyPayrollClosingUi';
import {
  applyDiscoveredRootsToParent,
  isClosedImmutableCode,
  mergeDisplayBlockers,
  nestPayrollUnderTargetIfPresent,
  nextAutoContinueBlocker,
  resolutionAttemptKey,
  rootBlockersFromGenerateMissing,
} from '@/lib/hr/dailyPayrollReadiness.chain';

export interface DailyPayrollSmartFixModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readiness: DailyPayrollReadinessResult | null;
  isDayClosed: boolean;
  ensureSessionBranch: (branchId: number) => Promise<boolean>;
  onRefreshAfterFix: () => Promise<DailyPayrollReadinessResult | null>;
  generatePayrollOnly: () => Promise<SmartFixActionResult>;
  generateTargetsOnly: (empIds?: number[]) => Promise<SmartFixActionResult>;
}

export default function DailyPayrollSmartFixModal({
  open,
  onOpenChange,
  readiness,
  isDayClosed,
  ensureSessionBranch,
  onRefreshAfterFix,
  generatePayrollOnly,
  generateTargetsOnly,
}: DailyPayrollSmartFixModalProps) {
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');
  const [localOk, setLocalOk] = useState('');
  const [manualHint, setManualHint] = useState('');
  const [nestedOverride, setNestedOverride] = useState<DailyPayrollReadinessBlocker | null>(null);
  const [extraBlockers, setExtraBlockers] = useState<DailyPayrollReadinessBlocker[]>([]);
  const [attemptedKeys, setAttemptedKeys] = useState<Set<string>>(() => new Set());
  const [autoContinueArmed, setAutoContinueArmed] = useState(false);
  const [preferEmpId, setPreferEmpId] = useState<number | null>(null);
  const [awaitingExternalFix, setAwaitingExternalFix] = useState<{
    parent: DailyPayrollReadinessBlocker;
    openedAt: number;
  } | null>(null);
  const [attendanceTarget, setAttendanceTarget] = useState<{
    empId: number;
    empName: string;
    branchId: number;
    workDate: string;
    parent: DailyPayrollReadinessBlocker;
  } | null>(null);

  const autoRunningRef = useRef(false);
  const contextKey = readiness
    ? `${readiness.branchId}|${readiness.workDate}|${readiness.persistedState}`
    : '';

  // Reset chain state when day/branch changes or modal reopens fresh
  useEffect(() => {
    if (!open) return;
    setNestedOverride(null);
    setExtraBlockers([]);
    setAttemptedKeys(new Set());
    setLocalError('');
    setLocalOk('');
    setManualHint('');
    setAwaitingExternalFix(null);
    setAutoContinueArmed(false);
    setPreferEmpId(null);
  }, [open, contextKey]);

  const displayBlockers = useMemo(
    () => mergeDisplayBlockers(readiness?.blockers ?? [], nestedOverride, extraBlockers),
    [readiness?.blockers, nestedOverride, extraBlockers],
  );

  const remaining = readiness?.summary.blockerCount ?? displayBlockers.length;
  const allResolved =
    Boolean(readiness) &&
    !isDayClosed &&
    (readiness?.summary.blockerCount ?? 0) === 0 &&
    displayBlockers.length === 0;

  const blockerKey = (b: DailyPayrollReadinessBlocker, idx: number) =>
    `${b.code}-${b.empId ?? 'x'}-${idx}`;

  const markAttempted = useCallback((key: string) => {
    setAttemptedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const applyGenerateFailureRoots = useCallback(
    (parent: DailyPayrollReadinessBlocker, result: SmartFixActionResult) => {
      if (!result.missing?.length || !readiness) return false;
      const roots = rootBlockersFromGenerateMissing({
        missing: result.missing,
        branchId: readiness.branchId,
        workDate: readiness.workDate,
        focusEmpId: parent.empId,
      });
      if (roots.length === 0) return false;
      const { nested, extras } = applyDiscoveredRootsToParent(parent, roots);
      setNestedOverride(nested);
      setExtraBlockers((prev) => {
        const merged = [...prev];
        for (const e of extras) {
          if (!merged.some((x) => x.code === e.code && x.empId === e.empId)) merged.push(e);
        }
        return merged;
      });
      setLocalError('');
      setLocalOk('');
      setManualHint(
        `ظهر سبب أعمق من الخادم: ${blockerMessageAr(roots[0].code)} — نفّذ الإجراء التالي`,
      );
      return true;
    },
    [readiness],
  );

  const runInlineAction = useCallback(
    async (
      parent: DailyPayrollReadinessBlocker,
      run: () => Promise<SmartFixActionResult>,
      opts?: { auto?: boolean },
    ) => {
      if (isDayClosed) {
        setLocalError('اليوم مقفل — لا يمكن الإصلاح دون إعادة فتح');
        return;
      }
      const fix = parent.fix;
      const key = resolutionAttemptKey({
        branchId: fix.branchId,
        workDate: fix.workDate,
        empId: parent.empId,
        surfaceCode: parent.code,
        actionType: fix.type,
        rootCode: parent.rootCauseCode ?? parent.causedBy?.code ?? null,
      });

      if (attemptedKeys.has(key) && opts?.auto) {
        setManualHint(
          'توقف التسلسل التلقائي — نفس الخطوة تكررت. راجع الإعدادات يدويًا ثم اضغط «تحديث الجاهزية».',
        );
        return;
      }
      if (attemptedKeys.has(key) && !opts?.auto) {
        setManualHint(
          'تم تنفيذ هذه الخطوة مسبقًا في هذه الجلسة. إن استمرت المشكلة: راجع السبب الجذري يدويًا أو حدّث الجاهزية.',
        );
      }

      setActingKey(blockerKey(parent, 0));
      setLocalError('');
      setLocalOk('');
      markAttempted(key);

      try {
        const okBranch = await ensureSessionBranch(fix.branchId);
        if (!okBranch) throw new Error('تعذر تبديل الفرع قبل الإصلاح');

        const result = await run();

        if (isClosedImmutableCode(result.code)) {
          setLocalError(result.message || 'اليوم مقفل — لا يمكن التعديل');
          return;
        }

        if (!result.ok) {
          const nestedFromMissing = applyGenerateFailureRoots(parent, result);
          if (nestedFromMissing) return;

          // After target failure: refresh and nest payroll if readiness reports it
          if (fix.type === 'generate_target' || fix.type === 'retry_target_sync') {
            const next = await onRefreshAfterFix();
            const withPayroll = nestPayrollUnderTargetIfPresent(parent, next);
            if (withPayroll.causedBy) {
              setNestedOverride(withPayroll);
              setManualHint('الخادم أظهر أن اليومية غير مولّدة — ولّد اليومية أولاً');
              setLocalError('');
              return;
            }
          }

          setLocalError(result.message || 'تعذر تنفيذ الإصلاح');
          return;
        }

        setLocalOk(result.message);
        setNestedOverride(null);
        setExtraBlockers([]);
        setPreferEmpId(parent.empId);
        setAutoContinueArmed(true);
        await onRefreshAfterFix();
      } catch (e: unknown) {
        setLocalError(e instanceof Error ? e.message : 'تعذر تنفيذ الإصلاح');
      } finally {
        setActingKey(null);
      }
    },
    [
      isDayClosed,
      attemptedKeys,
      markAttempted,
      ensureSessionBranch,
      applyGenerateFailureRoots,
      onRefreshAfterFix,
    ],
  );

  // Auto-continue safe generate steps after successful sub-fix
  useEffect(() => {
    if (!open || !autoContinueArmed || actingKey || isDayClosed || autoRunningRef.current) return;
    const next = nextAutoContinueBlocker(readiness, {
      preferEmpId,
      attemptedKeys,
    });
    if (!next) {
      setAutoContinueArmed(false);
      return;
    }
    autoRunningRef.current = true;
    setAutoContinueArmed(false);
    void (async () => {
      try {
        setLocalOk(`متابعة تلقائية: ${next.fix.labelAr}`);
        if (next.fix.type === 'generate_payroll') {
          await runInlineAction(next, () => generatePayrollOnly(), { auto: true });
        } else if (next.fix.type === 'generate_target' || next.fix.type === 'retry_target_sync') {
          // Prefer payroll first if readiness already lists it
          const gated = nestPayrollUnderTargetIfPresent(next, readiness);
          if (gated.causedBy?.code === 'payroll_not_generated') {
            setNestedOverride(gated);
            setManualHint('يلزم توليد اليومية قبل التارجت (حسب الجاهزية)');
            return;
          }
          await runInlineAction(
            next,
            () =>
              generateTargetsOnly(
                next.fix.employeeId != null ? [next.fix.employeeId] : undefined,
              ),
            { auto: true },
          );
        }
      } finally {
        autoRunningRef.current = false;
      }
    })();
  }, [
    open,
    autoContinueArmed,
    actingKey,
    isDayClosed,
    readiness,
    preferEmpId,
    attemptedKeys,
    runInlineAction,
    generatePayrollOnly,
    generateTargetsOnly,
  ]);

  // After external salary/settings tab: on focus / تحديث → retry parent generate when appropriate
  useEffect(() => {
    if (!open || !awaitingExternalFix) return;
    const onFocus = () => {
      setManualHint('عدت من صفحة الإعدادات — اضغط «تحديث الجاهزية» ثم أعد توليد اليومية إن لزم');
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [open, awaitingExternalFix]);

  const openExternal = (url: string | null | undefined, parent: DailyPayrollReadinessBlocker) => {
    if (!url) {
      setLocalError('لا يوجد رابط إصلاح لهذا المانع');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setAwaitingExternalFix({ parent, openedAt: Date.now() });
    setLocalOk('تم فتح صفحة الإصلاح — بعد الحفظ ارجع هنا واضغط «تحديث الجاهزية»');
  };

  const handleFix = (b: DailyPayrollReadinessBlocker) => {
    const fix = b.fix;
    if (!fix) {
      setLocalError('وصف الإصلاح غير متوفر — أعد تحميل الجاهزية');
      return;
    }
    if (isDayClosed && fix.type !== 'open_page') {
      setLocalError('اليوم مقفل — أعد فتح اليوم أولاً قبل الإصلاح');
      return;
    }

    // If nested root exists, prefer fixing the root action when clicking parent generate that already failed
    const actionTarget = b.causedBy ?? b;

    switch (fix.type) {
      case 'attendance_modal': {
        const target = actionTarget.fix.type === 'attendance_modal' ? actionTarget : b;
        if (target.fix.employeeId == null) {
          openExternal(target.fix.targetUrl, b);
          return;
        }
        setAttendanceTarget({
          empId: target.fix.employeeId,
          empName: target.empName ?? `#${target.fix.employeeId}`,
          branchId: target.fix.branchId,
          workDate: target.fix.workDate,
          parent: b,
        });
        return;
      }
      case 'generate_payroll':
        void runInlineAction(b, () => generatePayrollOnly());
        return;
      case 'generate_target':
      case 'retry_target_sync': {
        const gated = nestPayrollUnderTargetIfPresent(b, readiness);
        if (gated.causedBy?.code === 'payroll_not_generated' && fix.type === 'generate_target') {
          setNestedOverride(gated);
          setManualHint('الجاهزية تُظهر أن اليومية غير مولّدة — ولّد اليومية أولاً');
          return;
        }
        void runInlineAction(b, () =>
          generateTargetsOnly(fix.employeeId != null ? [fix.employeeId] : undefined),
        );
        return;
      }
      case 'payroll_settings':
      case 'ledger_reconciliation':
      case 'open_page':
        openExternal(actionTarget.fix.targetUrl ?? fix.targetUrl, b);
        return;
      default:
        openExternal(fix.targetUrl, b);
    }
  };

  const handleRootFix = (root: DailyPayrollReadinessBlocker) => {
    handleFix(root);
  };

  const handleRefresh = async () => {
    setLocalError('');
    const next = await onRefreshAfterFix();
    setNestedOverride(null);
    setExtraBlockers([]);

    if (awaitingExternalFix && next) {
      const parent = awaitingExternalFix.parent;
      const stillSalary = next.blockers.some(
        (b) =>
          b.code === 'salary_config_missing' &&
          (parent.empId == null || b.empId === parent.empId),
      );
      const needsPayroll = next.blockers.some(
        (b) =>
          b.code === 'payroll_not_generated' &&
          (parent.empId == null || b.empId === parent.empId || parent.code === 'payroll_not_generated'),
      );
      if (!stillSalary && needsPayroll && parent.code === 'payroll_not_generated') {
        setAwaitingExternalFix(null);
        setPreferEmpId(parent.empId);
        setAutoContinueArmed(true);
        setLocalOk('إعدادات الراتب لم تعد ضمن الموانع — متابعة توليد اليومية…');
        return;
      }
      if (!stillSalary && awaitingExternalFix.parent.causedBy?.code === 'salary_config_missing') {
        setAwaitingExternalFix(null);
        setPreferEmpId(parent.empId);
        setAutoContinueArmed(true);
      }
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="bg-zinc-900 border-zinc-700 text-white max-w-lg max-h-[85vh] overflow-y-auto"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-300" />
              حل المشاكل
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              {readiness
                ? `${readiness.workDate} · فرع #${readiness.branchId} · المتبقي: ${remaining}`
                : 'لا توجد بيانات جاهزية'}
            </DialogDescription>
          </DialogHeader>

          {isDayClosed && (
            <p className="text-sm text-rose-300 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
              اليوم مقفل — لا يمكن تنفيذ إصلاحات التعديل. أعد فتح اليوم أولاً.
            </p>
          )}

          {allResolved ? (
            <div className="flex flex-col items-center gap-2 py-8 text-emerald-300">
              <CheckCircle2 className="w-10 h-10" />
              <p className="font-bold text-lg">تم حل جميع المشاكل</p>
              <p className="text-sm text-emerald-200/80">
                {readiness?.recommendedState === 'READY_TO_CLOSE'
                  ? 'الجاهزية: جاهز للإقفال (حسب الخادم)'
                  : `التوصية الحالية: ${readiness?.recommendedState ?? '—'}`}
              </p>
            </div>
          ) : (
            <ul className="space-y-2 py-2">
              {displayBlockers.map((b, idx) => {
                const key = blockerKey(b, idx);
                const busy = actingKey === key || actingKey != null;
                const root = b.causedBy;
                return (
                  <li
                    key={key}
                    className="rounded-lg border border-zinc-700/80 bg-zinc-950/50 px-3 py-2.5 space-y-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-white">
                        {b.empName ?? (b.empId != null ? `#${b.empId}` : 'عام')}
                      </span>
                      <span className="text-zinc-400"> — </span>
                      <span className="text-amber-100/90">
                        {blockerMessageAr(b.code, b.message)}
                      </span>
                    </div>

                    {root ? (
                      <div className="mr-3 border-r-2 border-amber-500/40 pr-3 space-y-2">
                        <div className="text-sm text-amber-50/95">
                          <span className="text-zinc-500 text-xs block mb-0.5">└─ سبب أعمق (من الخادم)</span>
                          {root.empName ? (
                            <span className="font-medium text-white">{root.empName} — </span>
                          ) : null}
                          {blockerMessageAr(root.code, root.message)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy || isDayClosed}
                            className="h-8 gap-1.5 bg-amber-700 hover:bg-amber-600"
                            onClick={() => handleRootFix(root)}
                          >
                            {root.fix.type === 'payroll_settings' ||
                            root.fix.type === 'ledger_reconciliation' ||
                            root.fix.type === 'open_page' ? (
                              <ExternalLink className="w-3.5 h-3.5" />
                            ) : null}
                            {root.fix.labelAr}
                          </Button>
                          <span className="text-[10px] text-zinc-500 font-mono">{root.code}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || (isDayClosed && b.fix?.type !== 'open_page')}
                          className="h-8 gap-1.5"
                          onClick={() => handleFix(b)}
                        >
                          {actingKey === key ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : b.fix?.type === 'payroll_settings' ||
                            b.fix?.type === 'ledger_reconciliation' ||
                            b.fix?.type === 'open_page' ? (
                            <ExternalLink className="w-3.5 h-3.5" />
                          ) : null}
                          {b.fix?.labelAr ?? 'إصلاح'}
                        </Button>
                        <span className="text-[10px] text-zinc-500 font-mono">{b.code}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {manualHint && <p className="text-sm text-amber-300/90">{manualHint}</p>}
          {localError && <p className="text-sm text-rose-400">{localError}</p>}
          {localOk && <p className="text-sm text-emerald-400">{localOk}</p>}

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-zinc-600 text-zinc-300"
              disabled={actingKey != null}
              onClick={() => void handleRefresh()}
            >
              تحديث الجاهزية
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {attendanceTarget && (
        <SmartAttendanceFixDialog
          open={Boolean(attendanceTarget)}
          onOpenChange={(o) => {
            if (!o) setAttendanceTarget(null);
          }}
          branchId={attendanceTarget.branchId}
          workDate={attendanceTarget.workDate}
          empId={attendanceTarget.empId}
          empName={attendanceTarget.empName}
          ensureSessionBranch={ensureSessionBranch}
          onSaved={() => {
            const empId = attendanceTarget.empId;
            setAttendanceTarget(null);
            setNestedOverride(null);
            setExtraBlockers([]);
            setPreferEmpId(empId);
            setLocalOk('تم حفظ الحضور');
            setAutoContinueArmed(true);
            void onRefreshAfterFix();
          }}
        />
      )}
    </>
  );
}
