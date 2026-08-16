'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Destination = {
  branchId: number;
  branchCode: string;
  branchName: string;
};

type Preview = {
  ok: boolean;
  empName: string;
  workDate: string;
  fromBranch: { branchId: number; branchCode: string; branchName: string } | null;
  toBranch: { branchId: number; branchCode: string; branchName: string } | null;
  willMove: {
    attendance: boolean;
    payrollIds: number[];
    targetIds: number[];
  };
  blockers: Array<{ code: string; message: string }>;
  warnings: string[];
};

export type MoveEmployeeDayBranchTarget = {
  empId: number;
  empName: string;
  workDate: string;
  fromBranchId: number;
  fromBranchName?: string;
};

type Props = {
  open: boolean;
  target: MoveEmployeeDayBranchTarget | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export default function MoveEmployeeDayBranchModal({
  open,
  target,
  onClose,
  onSuccess,
}: Props) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [toBranchId, setToBranchId] = useState<number | ''>('');
  const [reason, setReason] = useState('تصحيح فرع الحضور/اليومية لهذا اليوم');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setDestinations([]);
    setToBranchId('');
    setReason('تصحيح فرع الحضور/اليومية لهذا اليوم');
    setPreview(null);
    setError('');
    setPreviewing(false);
    setSaving(false);
  }, []);

  useEffect(() => {
    if (!open || !target) {
      reset();
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingMeta(true);
      setError('');
      try {
        const res = await fetch(
          `/api/admin/hr/daily-payroll/relocate-branch?fromBranchId=${target.fromBranchId}`,
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'فشل تحميل الفروع');
        if (!cancelled) setDestinations(Array.isArray(data.destinations) ? data.destinations : []);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'فشل تحميل الفروع');
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target, reset]);

  const runPreview = async () => {
    if (!target || !toBranchId) return;
    setPreviewing(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/daily-payroll/relocate-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: target.empId,
          workDate: target.workDate,
          fromBranchId: target.fromBranchId,
          toBranchId,
          previewOnly: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'فشل المعاينة');
      setPreview(data.preview as Preview);
    } catch (e: unknown) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'فشل المعاينة');
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    if (!open || !target || !toBranchId) {
      setPreview(null);
      return;
    }
    const t = window.setTimeout(() => {
      void runPreview();
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preview when destination changes
  }, [open, target?.empId, target?.workDate, target?.fromBranchId, toBranchId]);

  const apply = async () => {
    if (!target || !toBranchId || !preview?.ok || !reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/daily-payroll/relocate-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: target.empId,
          workDate: target.workDate,
          fromBranchId: target.fromBranchId,
          toBranchId,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.preview) setPreview(data.preview as Preview);
        throw new Error(data.error || 'فشل النقل');
      }
      const msg =
        data.message ||
        `تم نقل يوم ${target.workDate} لـ ${data.preview?.toBranch?.branchName ?? 'الفرع الوجهة'}`;
      onSuccess(msg);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل النقل');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <ArrowLeftRight className="w-5 h-5 text-violet-400" />
            نقل هذا اليوم لفرع آخر
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm">
            يصحّح تسجيل الحضور/اليومية/التارجت لو اتحطوا على فرع غلط في نفس اليوم — بدون إنشاء نقل
            جدول مؤقت.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border border-zinc-700/80 bg-zinc-800/40 px-3 py-2 text-sm space-y-1">
              <p>
                <span className="text-zinc-500">الموظف: </span>
                <span className="font-medium text-white">{target.empName}</span>
              </p>
              <p>
                <span className="text-zinc-500">اليوم: </span>
                <span className="tabular-nums">{target.workDate}</span>
              </p>
              <p>
                <span className="text-zinc-500">من فرع: </span>
                <span>
                  {target.fromBranchName ?? preview?.fromBranch?.branchName ?? `#${target.fromBranchId}`}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">إلى فرع</label>
              {loadingMeta ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  تحميل الفروع…
                </div>
              ) : (
                <select
                  className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
                  value={toBranchId === '' ? '' : String(toBranchId)}
                  onChange={(e) =>
                    setToBranchId(e.target.value ? Number(e.target.value) : '')
                  }
                >
                  <option value="">— اختر الفرع الصحيح —</option>
                  {destinations.map((d) => (
                    <option key={d.branchId} value={d.branchId}>
                      {d.branchName} ({d.branchCode})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">سبب التصحيح</label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="bg-zinc-950 border-zinc-700"
                placeholder="مثال: حضور بالغلط على جليم"
              />
            </div>

            {previewing && (
              <p className="text-xs text-zinc-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                جاري المعاينة…
              </p>
            )}

            {preview && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/50 px-3 py-2 space-y-2 text-sm">
                {preview.ok ? (
                  <div className="flex items-start gap-2 text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">جاهز للنقل</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {[
                          preview.willMove.attendance ? 'حضور' : null,
                          preview.willMove.payrollIds.length
                            ? `يومية (${preview.willMove.payrollIds.length})`
                            : null,
                          preview.willMove.targetIds.length
                            ? `تارجت (${preview.willMove.targetIds.length})`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-rose-300 font-medium">
                      <AlertTriangle className="w-4 h-4" />
                      لا يمكن النقل
                    </div>
                    {preview.blockers.map((b) => (
                      <p key={b.code} className="text-xs text-rose-200/90">
                        {b.message}
                      </p>
                    ))}
                  </div>
                )}
                {preview.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-300/90">
                    {w}
                  </p>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={() => void apply()}
            disabled={
              saving ||
              !toBranchId ||
              !reason.trim() ||
              !preview?.ok ||
              previewing ||
              loadingMeta
            }
            className="bg-violet-700 hover:bg-violet-600"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : null}
            تأكيد النقل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
