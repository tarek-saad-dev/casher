'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Clock, Loader2, Store } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ShiftDef {
  ShiftID: number;
  ShiftName: string;
}

/**
 * Blocks POS/expenses/deductions until the active branch has an open day
 * and this user has an open shift on that branch.
 * Offers inline open (and close-other-branch) instead of navigating away.
 */
export default function ShiftRequiredOverlay() {
  const {
    hasActiveDay,
    hasActiveShift,
    loading,
    isAuthenticated,
    user,
    shift,
    activeBranch,
    defaultShiftId,
    openMyShift,
    closeMyShift,
    refresh,
  } = useSession();
  const canOpenDay = usePermission('day.open');
  const canOpenShift = usePermission('shift.open');
  const canCloseShift = usePermission('shift.close');

  const [shiftDefs, setShiftDefs] = useState<ShiftDef[]>([]);
  const [selectedShift, setSelectedShift] = useState('');
  const [loadingDefs, setLoadingDefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const shiftOnOtherBranch =
    !!user &&
    !!shift &&
    shift.Status === true &&
    shift.UserID === user.UserID &&
    !!activeBranch &&
    shift.BranchID != null &&
    shift.BranchID !== activeBranch.branchId;

  const needsGate =
    isAuthenticated && !loading && (!hasActiveDay || !hasActiveShift || shiftOnOtherBranch);

  const needsShiftPicker = needsGate && hasActiveDay && canOpenShift;

  useEffect(() => {
    if (!needsShiftPicker) return;

    let cancelled = false;
    async function loadDefs() {
      setLoadingDefs(true);
      try {
        const res = await fetch('/api/shift/definitions');
        if (!res.ok) return;
        const data = await res.json();
        const list: ShiftDef[] = data.shifts || [];
        if (cancelled) return;
        setShiftDefs(list);
        const preferred =
          (defaultShiftId && list.some((s) => s.ShiftID === defaultShiftId)
            ? String(defaultShiftId)
            : null) ||
          (shift?.ShiftID && list.some((s) => s.ShiftID === shift.ShiftID)
            ? String(shift.ShiftID)
            : null) ||
          (list[0] ? String(list[0].ShiftID) : '');
        setSelectedShift((prev) => prev || preferred);
      } catch {
        // open action will surface errors
      } finally {
        if (!cancelled) setLoadingDefs(false);
      }
    }
    void loadDefs();
    return () => {
      cancelled = true;
    };
  }, [needsShiftPicker, defaultShiftId, shift?.ShiftID]);

  if (!needsGate) return null;

  const branchLabel =
    activeBranch?.shortName || activeBranch?.branchName || activeBranch?.branchCode || 'الفرع الحالي';

  async function handleOpenDay() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/day/open', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل فتح يوم العمل');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل فتح يوم العمل');
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenShift() {
    const shiftId = selectedShift ? parseInt(selectedShift, 10) : defaultShiftId;
    if (!shiftId) {
      setError('يرجى اختيار الوردية');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await openMyShift(shiftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل فتح الوردية');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseOtherAndOpen() {
    const shiftId = selectedShift
      ? parseInt(selectedShift, 10)
      : defaultShiftId || shift?.ShiftID;
    if (!shiftId) {
      setError('يرجى اختيار الوردية');
      return;
    }
    if (!shift?.ID) {
      setError('لا توجد وردية سابقة لإغلاقها');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await closeMyShift(shift.ID);
      await openMyShift(shiftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل نقل الوردية للفرع الحالي');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-required-title"
        className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg space-y-4"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
            {!hasActiveDay ? (
              <Store className="w-7 h-7 text-destructive" />
            ) : shiftOnOtherBranch ? (
              <AlertTriangle className="w-7 h-7 text-amber-500" />
            ) : (
              <Clock className="w-7 h-7 text-primary" />
            )}
          </div>

          <h2 id="shift-required-title" className="text-xl font-bold">
            {!hasActiveDay
              ? 'لا يوجد يوم عمل مفتوح'
              : shiftOnOtherBranch
                ? 'وردية مفتوحة في فرع آخر'
                : 'لا توجد وردية مفتوحة'}
          </h2>

          <p className="text-sm text-muted-foreground">
            {!hasActiveDay
              ? `يجب فتح يوم عمل في «${branchLabel}» قبل البيع.`
              : shiftOnOtherBranch
                ? `لديك وردية مفتوحة في فرع آخر. أغلقها وافتح وردية في «${branchLabel}» للمتابعة.`
                : `افتح وردية في «${branchLabel}» للبدء في البيع.`}
          </p>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 text-center">
            {error}
          </div>
        )}

        {!hasActiveDay && (
          <div className="space-y-3">
            {canOpenDay ? (
              <Button onClick={handleOpenDay} disabled={busy} className="w-full h-11">
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري الفتح...
                  </>
                ) : (
                  <>
                    <CalendarDays className="w-4 h-4 ml-2" />
                    فتح يوم عمل في {branchLabel}
                  </>
                )}
              </Button>
            ) : (
              <div className="bg-destructive/10 rounded-lg p-3 text-center text-sm">
                برجاء التواصل مع المدير لفتح يوم العمل في هذا الفرع.
              </div>
            )}
          </div>
        )}

        {hasActiveDay && (shiftOnOtherBranch || !hasActiveShift) && (
          <div className="space-y-3">
            {canOpenShift ? (
              <>
                {loadingDefs ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : shiftDefs.length > 0 ? (
                  <div className="space-y-2 text-right">
                    <label className="text-sm font-medium">اختيار الوردية</label>
                    <Select
                      value={selectedShift}
                      onValueChange={setSelectedShift}
                      disabled={busy}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="اختر الوردية" />
                      </SelectTrigger>
                      <SelectContent>
                        {shiftDefs.map((s) => (
                          <SelectItem key={s.ShiftID} value={String(s.ShiftID)}>
                            {s.ShiftName}
                            {s.ShiftID === defaultShiftId ? ' (افتراضي)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {shiftOnOtherBranch ? (
                  <Button
                    onClick={handleCloseOtherAndOpen}
                    disabled={
                      busy ||
                      (!selectedShift && !defaultShiftId && !shift?.ShiftID) ||
                      !canCloseShift
                    }
                    className="w-full h-11"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        جاري النقل...
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 ml-2" />
                        إغلاق السابقة وفتح وردية هنا
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleOpenShift}
                    disabled={busy || (!selectedShift && !defaultShiftId)}
                    className="w-full h-11"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        جاري الفتح...
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 ml-2" />
                        فتح وردية في {branchLabel}
                      </>
                    )}
                  </Button>
                )}
              </>
            ) : (
              <div className="bg-destructive/10 rounded-lg p-3 text-center text-sm">
                غير مصرح بفتح وردية — تواصل مع المدير.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
