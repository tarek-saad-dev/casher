'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Gift } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { getCairoMonthCloseAwareDate } from '@/lib/businessDate';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
}

interface BranchOption {
  branchId: number;
  branchCode: string;
  branchName: string;
}

interface PreviewState {
  dayTargetTotal: number;
  monthTargetTotal: number;
  dayTargetEarned: number;
  dayAdditionalTarget: number;
  empName: string;
  branchCode: string;
}

interface EmployeeAdditionalTargetModalProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeOption[];
  branches: BranchOption[];
  dualWriteEnabled: boolean;
  defaultEmpId?: number | null;
  defaultBranchId?: number | null;
  defaultDate?: string;
  onSuccess: (message: string) => void;
}

function todayDateStr(): string {
  return getCairoMonthCloseAwareDate();
}

function shortBranch(b: BranchOption): string {
  if (b.branchCode === 'GLEEM') return 'جليم';
  if (b.branchCode === 'CAMP_CAESAR') return 'كامب شيزار';
  return b.branchName || b.branchCode;
}

export default function EmployeeAdditionalTargetModal({
  open,
  onClose,
  employees,
  branches,
  dualWriteEnabled,
  defaultEmpId,
  defaultBranchId,
  defaultDate,
  onSuccess,
}: EmployeeAdditionalTargetModalProps) {
  const [empId, setEmpId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState(defaultDate ?? todayDateStr());
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setEmpId(defaultEmpId != null ? String(defaultEmpId) : '');
    setBranchId(defaultBranchId != null ? String(defaultBranchId) : '');
    setAmount('');
    setNotes('');
    setError('');
    setPreview(null);
    setEntryDate(defaultDate ?? todayDateStr());
  }, [defaultEmpId, defaultBranchId, defaultDate]);

  const loadPreview = useCallback(async (selectedEmpId: number, selectedBranchId: number, date: string) => {
    setLoadingPreview(true);
    setError('');
    try {
      const params = new URLSearchParams({
        empId: String(selectedEmpId),
        branchId: String(selectedBranchId),
        date,
      });
      const res = await fetch(`/api/admin/hr/employee-ledger/additional-target?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل التارجت الحالي');
      setPreview({
        dayTargetTotal: Number(data.dayTargetTotal ?? 0),
        monthTargetTotal: Number(data.monthTargetTotal ?? 0),
        dayTargetEarned: Number(data.dayTargetEarned ?? 0),
        dayAdditionalTarget: Number(data.dayAdditionalTarget ?? 0),
        empName: String(data.empName ?? ''),
        branchCode: String(data.branchCode ?? ''),
      });
    } catch (e: unknown) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'فشل تحميل التارجت الحالي');
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
  }, [open, resetForm]);

  useEffect(() => {
    if (!open || !empId || !branchId || !entryDate) {
      setPreview(null);
      return;
    }
    void loadPreview(Number(empId), Number(branchId), entryDate);
  }, [open, empId, branchId, entryDate, loadPreview]);

  const parsedAmount = amount.trim() === '' ? null : Number(amount);
  const amountValid = parsedAmount != null && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const projectedDay =
    preview && amountValid ? preview.dayTargetTotal + (parsedAmount as number) : null;
  const projectedMonth =
    preview && amountValid ? preview.monthTargetTotal + (parsedAmount as number) : null;

  const canSubmit = dualWriteEnabled
    && !!empId
    && !!branchId
    && amountValid
    && !!entryDate
    && !submitting
    && !loadingPreview
    && !!preview;

  const handleSubmit = async () => {
    if (!canSubmit || parsedAmount == null) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/additional-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: Number(empId),
          branchId: Number(branchId),
          amount: parsedAmount,
          date: entryDate,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تسجيل التارجت الإضافي');

      onSuccess(
        `تم إضافة تارجت إضافي ${fmt(data.amountAdded)} ج.م لـ ${data.empName} — تارجت اليوم أصبح ${fmt(data.newDayTargetTotal)} ج.م`,
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تسجيل التارجت الإضافي');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="bg-surface border-border text-foreground max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Gift className="w-5 h-5 text-primary" />
            تارجت إضافي (بونص)
          </DialogTitle>
        </DialogHeader>

        {!dualWriteEnabled ? (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
            الميزة تتطلب تفعيل <code className="text-amber-200">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code>
          </div>
        ) : null}

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            يُضاف المبلغ على تارجت الموظف في الفرع والتاريخ المختار، ويُسجَّل في الدفتر كـ«تارجت إضافي» (بدون حركة خزنة).
          </p>

          <div>
            <label className="block text-sm font-medium mb-2">الموظف</label>
            <Select
              value={empId}
              onValueChange={setEmpId}
              disabled={!dualWriteEnabled || submitting}
            >
              <SelectTrigger className="bg-surface-muted border-border">
                <SelectValue placeholder="اختر الموظف" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border max-h-64">
                {employees.map((e) => (
                  <SelectItem key={e.EmpID} value={String(e.EmpID)}>
                    {e.EmpName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">الفرع</label>
            <Select
              value={branchId}
              onValueChange={setBranchId}
              disabled={!dualWriteEnabled || submitting}
            >
              <SelectTrigger className="bg-surface-muted border-border">
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                {branches.map((b) => (
                  <SelectItem key={b.branchId} value={String(b.branchId)}>
                    {shortBranch(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">تاريخ القيد</label>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              disabled={!dualWriteEnabled || submitting}
              className="bg-surface-muted border-border"
            />
          </div>

          {empId && branchId && (
            <div className="rounded-lg border border-border bg-surface-muted/40 p-3 space-y-1.5 text-sm">
              {loadingPreview ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري تحميل التارجت الحالي…
                </div>
              ) : preview ? (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">تارجت اليوم (مكتوب)</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      {fmt(preview.dayTargetTotal)} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">منه تارجت محسوب</span>
                    <span className="font-mono text-zinc-300">{fmt(preview.dayTargetEarned)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">منه تارجت إضافي سابق</span>
                    <span className="font-mono text-zinc-300">{fmt(preview.dayAdditionalTarget)}</span>
                  </div>
                  <div className="flex justify-between gap-2 pt-1 border-t border-border/60">
                    <span className="text-muted-foreground">تارجت الشهر حتى اليوم</span>
                    <span className="font-mono text-sky-300 font-semibold">
                      {fmt(preview.monthTargetTotal)} ج.م
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">اختر موظفاً وفرعاً لعرض التارجت الحالي</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">المبلغ الإضافي</label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!dualWriteEnabled || submitting}
              placeholder="مثلاً 100"
              className="bg-surface-muted border-border font-mono"
            />
          </div>

          {projectedDay != null && projectedMonth != null && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-emerald-200/80">تارجت اليوم بعد الإضافة</span>
                <span className="font-mono text-emerald-300 font-bold">{fmt(projectedDay)} ج.م</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-emerald-200/80">تارجت الشهر بعد الإضافة</span>
                <span className="font-mono text-emerald-300 font-bold">{fmt(projectedMonth)} ج.م</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">ملاحظات (اختياري)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!dualWriteEnabled || submitting}
              placeholder="سبب البونص…"
              className="bg-surface-muted border-border"
            />
          </div>

          {error ? (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-300 text-sm">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              إلغاء
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              إضافة التارجت
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
