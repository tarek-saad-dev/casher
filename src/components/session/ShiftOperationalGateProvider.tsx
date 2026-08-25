'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CalendarDays, Clock, Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import HandoffConfirmDialog from '@/components/session/HandoffConfirmDialog';
import { useOperationalToast } from '@/components/session/OperationalToast';
import {
  branchDisplayName,
  mapOperationalError,
} from '@/lib/operations/viewOperationalState';
import {
  classifyShiftWriteGate,
  shiftWriteReady,
  type ShiftWriteGateReason,
} from '@/lib/operations/shiftOperationalGate';

interface ShiftDef {
  ShiftID: number;
  ShiftName: string;
}

function parseShiftDefinitions(data: unknown): ShiftDef[] {
  if (Array.isArray(data)) {
    return data.filter(
      (s): s is ShiftDef =>
        s != null &&
        typeof s === 'object' &&
        Number.isFinite(Number((s as ShiftDef).ShiftID)),
    );
  }
  if (data && typeof data === 'object' && Array.isArray((data as { shifts?: unknown }).shifts)) {
    return parseShiftDefinitions((data as { shifts: unknown }).shifts);
  }
  return [];
}

type ShiftOperationalGateContextValue = {
  gateReason: ShiftWriteGateReason;
  canShiftWrite: boolean;
  ensureShiftWrite: () => Promise<boolean>;
};

const ShiftOperationalGateContext = createContext<ShiftOperationalGateContextValue>({
  gateReason: 'loading',
  canShiftWrite: false,
  ensureShiftWrite: async () => false,
});

export function useShiftOperationalGate(): ShiftOperationalGateContextValue {
  return useContext(ShiftOperationalGateContext);
}

export default function ShiftOperationalGateProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const canOpenDay = usePermission('day.open');
  const canOpenShift = usePermission('shift.open');
  const { showToast } = useOperationalToast();

  const [activeGate, setActiveGate] = useState<ShiftWriteGateReason | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [shiftDefs, setShiftDefs] = useState<ShiftDef[]>([]);
  const [selectedShift, setSelectedShift] = useState('');
  const [loadingDefs, setLoadingDefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const gateReason = classifyShiftWriteGate({
    loading: session.loading,
    isAuthenticated: session.isAuthenticated,
    hasActiveDay: session.hasActiveDay,
    hasOpenShift: session.hasOpenShift,
    viewBranchId: session.viewBranch?.branchId,
    operationalBranchId: session.operationalBranch?.branchId,
  });

  const viewLabel = branchDisplayName(session.viewBranch);
  const operationalLabel = branchDisplayName(session.operationalBranch);
  const isAdmin = session.user?.UserLevel === 'admin';

  const effectiveShiftId =
    (selectedShift && Number.parseInt(selectedShift, 10)) ||
    session.defaultShiftId ||
    session.shift?.ShiftID ||
    shiftDefs[0]?.ShiftID ||
    null;

  const finishGate = useCallback((ok: boolean) => {
    setActiveGate(null);
    setHandoffOpen(false);
    setError('');
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(ok);
  }, []);

  const ensureShiftWrite = useCallback(async (): Promise<boolean> => {
    const reason = classifyShiftWriteGate({
      loading: session.loading,
      isAuthenticated: session.isAuthenticated,
      hasActiveDay: session.hasActiveDay,
      hasOpenShift: session.hasOpenShift,
      viewBranchId: session.viewBranch?.branchId,
      operationalBranchId: session.operationalBranch?.branchId,
    });

    if (shiftWriteReady(reason)) return true;
    if (reason === 'loading' || reason === 'unauthenticated') return false;

    if (resolverRef.current) {
      return new Promise<boolean>((resolve) => {
        const prior = resolverRef.current!;
        resolverRef.current = (ok) => {
          prior(ok);
          resolve(ok);
        };
      });
    }

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setError('');
      setActiveGate(reason);
    });
  }, [
    session.loading,
    session.isAuthenticated,
    session.hasActiveDay,
    session.hasOpenShift,
    session.viewBranch?.branchId,
    session.operationalBranch?.branchId,
  ]);

  useEffect(() => {
    if (activeGate !== 'no_shift' || !canOpenShift) return;

    let cancelled = false;
    async function loadDefs() {
      setLoadingDefs(true);
      setError('');
      try {
        const res = await fetch('/api/shift/definitions');
        if (!res.ok) {
          if (!cancelled) setError('تعذر تحميل قائمة الورديات');
          return;
        }
        const data = await res.json();
        const list = parseShiftDefinitions(data);
        if (cancelled) return;
        setShiftDefs(list);
        const preferred =
          (session.defaultShiftId && list.some((s) => s.ShiftID === session.defaultShiftId)
            ? String(session.defaultShiftId)
            : null) ||
          (session.shift?.ShiftID && list.some((s) => s.ShiftID === session.shift?.ShiftID)
            ? String(session.shift.ShiftID)
            : null) ||
          (list[0] ? String(list[0].ShiftID) : '');
        setSelectedShift(preferred);
      } catch {
        if (!cancelled) setError('تعذر تحميل قائمة الورديات');
      } finally {
        if (!cancelled) setLoadingDefs(false);
      }
    }
    void loadDefs();
    return () => {
      cancelled = true;
    };
  }, [activeGate, canOpenShift, session.defaultShiftId, session.shift?.ShiftID]);

  async function handleOpenDay() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/day/open', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw Object.assign(new Error(data.error || 'فشل فتح يوم العمل'), { code: data.code });
      }
      await session.refresh();
      const next = classifyShiftWriteGate({
        loading: false,
        isAuthenticated: true,
        hasActiveDay: true,
        hasOpenShift: session.hasOpenShift,
        viewBranchId: session.viewBranch?.branchId,
        operationalBranchId: session.operationalBranch?.branchId,
      });
      if (next === 'ready') {
        finishGate(true);
      } else {
        setActiveGate(next === 'no_day' || next === 'no_shift' || next === 'handoff_required' ? next : null);
        if (next !== 'no_day' && next !== 'no_shift' && next !== 'handoff_required') {
          finishGate(false);
        }
      }
    } catch (err) {
      setError(mapOperationalError(err, 'تعذر تجهيز يوم العمل الحالي. حاول مرة أخرى.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenShift() {
    if (!effectiveShiftId) {
      setError('يرجى اختيار الوردية');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await session.openMyShift(effectiveShiftId);
      showToast(`تم بدء وردية ${viewLabel}`);
      finishGate(true);
    } catch (err) {
      setError(mapOperationalError(err, 'فشل بدء الوردية'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmHandoff() {
    if (!session.viewBranch || !session.shift?.ShiftID) {
      setError('لا يمكن نقل التشغيل الآن');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await session.handoffMyShift({
        targetBranchId: session.viewBranch.branchId,
        shiftId: session.shift.ShiftID,
      });
      showToast(`تم نقل الوردية إلى ${viewLabel}`);
      finishGate(true);
    } catch (err) {
      setError(mapOperationalError(err, 'فشل نقل التشغيل'));
      await session.refresh();
    } finally {
      setBusy(false);
    }
  }

  const contextValue = useMemo(
    () => ({
      gateReason,
      canShiftWrite: shiftWriteReady(gateReason),
      ensureShiftWrite,
    }),
    [gateReason, ensureShiftWrite],
  );

  const openDisabled = busy || loadingDefs || !effectiveShiftId;

  return (
    <ShiftOperationalGateContext.Provider value={contextValue}>
      {children}

      <Dialog
        open={activeGate === 'no_day'}
        onOpenChange={(next) => {
          if (!next && !busy) finishGate(false);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!busy} dir="rtl">
          <DialogHeader className="text-right">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <CalendarDays className="h-7 w-7 text-muted-foreground" />
            </div>
            <DialogTitle>اليوم التشغيلي غير جاهز</DialogTitle>
            <DialogDescription className="text-right pt-2">
              تعذر بدء الوردية لأن اليوم التشغيلي غير جاهز في «{viewLabel}».
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button variant="outline" onClick={() => void session.refresh()} disabled={busy} className="w-full h-11">
              إعادة المحاولة
            </Button>
            {isAdmin && canOpenDay ? (
              <Button onClick={() => void handleOpenDay()} disabled={busy} className="w-full h-11">
                {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
                تجهيز اليوم التشغيلي (إدارة)
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => finishGate(false)} disabled={busy} className="w-full h-11">
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeGate === 'no_shift'}
        onOpenChange={(next) => {
          if (!next && !busy) finishGate(false);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!busy} dir="rtl">
          <DialogHeader className="text-right">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Clock className="h-7 w-7 text-primary" />
            </div>
            <DialogTitle>ابدأ العمل في {viewLabel}</DialogTitle>
            <DialogDescription className="text-right pt-2">
              لا توجد وردية مفتوحة حاليًا.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {canOpenShift ? (
            <div className="space-y-3">
              {loadingDefs ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : shiftDefs.length > 1 ? (
                <div className="space-y-2 text-right">
                  <label className="text-sm font-medium">اختيار الوردية</label>
                  <Select value={selectedShift || undefined} onValueChange={setSelectedShift} disabled={busy}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="اختر الوردية" />
                    </SelectTrigger>
                    <SelectContent>
                      {shiftDefs.map((s) => (
                        <SelectItem key={s.ShiftID} value={String(s.ShiftID)}>
                          {s.ShiftName}
                          {s.ShiftID === session.defaultShiftId ? ' (افتراضي)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <Button onClick={() => void handleOpenShift()} disabled={openDisabled} className="w-full h-11">
                {busy || loadingDefs ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    {loadingDefs ? 'جاري التحميل...' : 'جاري البدء...'}
                  </>
                ) : (
                  <>بدء وردية {viewLabel}</>
                )}
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">غير مصرح ببدء وردية — تواصل مع المدير.</p>
          )}
          <Button variant="ghost" onClick={() => finishGate(false)} disabled={busy} className="w-full h-11">
            إلغاء
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeGate === 'handoff_required' && !handoffOpen}
        onOpenChange={(next) => {
          if (!next && !busy) finishGate(false);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!busy} dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>أنت تعمل حاليًا في فرع {operationalLabel}</DialogTitle>
            <DialogDescription className="space-y-2 pt-2 text-right">
              <p>
                لنقل التشغيل إلى {viewLabel}
                <br />
                يجب نقل الوردية أولًا.
              </p>
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button variant="ghost" onClick={() => finishGate(false)} disabled={busy} className="w-full h-11">
              إلغاء
            </Button>
            {canOpenShift ? (
              <Button
                onClick={() => setHandoffOpen(true)}
                disabled={busy || !session.shift?.ShiftID}
                className="w-full h-11"
              >
                نقل التشغيل إلى {viewLabel}
              </Button>
            ) : (
              <p className="text-center text-sm text-muted-foreground">غير مصرح بنقل التشغيل — تواصل مع المدير.</p>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HandoffConfirmDialog
        open={handoffOpen}
        fromLabel={operationalLabel}
        toLabel={viewLabel}
        busy={busy}
        onCancel={() => {
          if (busy) return;
          setHandoffOpen(false);
        }}
        onConfirm={() => void confirmHandoff()}
      />
    </ShiftOperationalGateContext.Provider>
  );
}
