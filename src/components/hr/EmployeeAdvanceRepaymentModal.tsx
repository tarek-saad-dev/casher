'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Banknote } from 'lucide-react';
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

interface PaymentMethodOption {
  PaymentID: number;
  PaymentMethod: string;
}

export interface EmployeeAdvanceRepaymentTarget {
  empId: number;
  empName: string;
  branchId: number;
  branchLabel: string;
  /** Negative branch balance (all-time / displayed debt magnitude). */
  outstandingDebt: number;
}

interface EmployeeAdvanceRepaymentModalProps {
  open: boolean;
  onClose: () => void;
  employee: EmployeeAdvanceRepaymentTarget | null;
  dualWriteEnabled: boolean;
  defaultDate?: string;
  onSuccess: (message: string) => void;
}

function todayDateStr(): string {
  return getCairoMonthCloseAwareDate();
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `repay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function EmployeeAdvanceRepaymentModal({
  open,
  onClose,
  employee,
  dualWriteEnabled,
  defaultDate,
  onSuccess,
}: EmployeeAdvanceRepaymentModalProps) {
  const [repayDate, setRepayDate] = useState(defaultDate ?? todayDateStr());
  const [amount, setAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDebt, setLoadingDebt] = useState(false);
  const [liveDebt, setLiveDebt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const idempotencyKeyRef = useRef<string>('');

  const debt = Math.max(0, liveDebt ?? employee?.outstandingDebt ?? 0);

  const resetForm = useCallback(() => {
    setNotes('');
    setError('');
    setRepayDate(defaultDate ?? todayDateStr());
    setPaymentMethodId('');
    setLiveDebt(null);
    setAmount('');
    idempotencyKeyRef.current = createIdempotencyKey();
  }, [defaultDate]);

  const loadPaymentMethods = useCallback(async () => {
    setLoadingMethods(true);
    try {
      const res = await fetch('/api/incomes/meta');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل طرق الدفع');
      setPaymentMethods(data.paymentMethods ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تحميل طرق الدفع');
    } finally {
      setLoadingMethods(false);
    }
  }, []);

  const loadDebt = useCallback(async (empId: number) => {
    setLoadingDebt(true);
    try {
      const res = await fetch(
        `/api/admin/hr/employee-ledger/advance-repayment?empId=${empId}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل المديونية');
      const d = Math.max(0, Number(data.outstandingDebt ?? 0));
      setLiveDebt(d);
      setAmount(d > 0 ? String(d) : '');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تحميل المديونية');
      setLiveDebt(employee?.outstandingDebt ?? 0);
      const fallback = Math.max(0, employee?.outstandingDebt ?? 0);
      setAmount(fallback > 0 ? String(fallback) : '');
    } finally {
      setLoadingDebt(false);
    }
  }, [employee?.outstandingDebt]);

  useEffect(() => {
    if (!open) return;
    resetForm();
    void loadPaymentMethods();
  }, [open, employee?.empId, employee?.branchId, resetForm, loadPaymentMethods]);

  useEffect(() => {
    if (!open || !employee?.empId) return;
    void loadDebt(employee.empId);
  }, [open, employee?.empId, loadDebt]);

  const parsedAmount = Number(amount);
  const amountOk =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= debt + 1e-9;
  const canSubmit =
    dualWriteEnabled &&
    !!employee &&
    debt > 0 &&
    amountOk &&
    !!paymentMethodId &&
    !!repayDate &&
    !submitting;

  const handleSubmit = async () => {
    if (!employee || !canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/advance-repayment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: employee.empId,
          amount: parsedAmount,
          paymentMethodId: Number(paymentMethodId),
          date: repayDate,
          notes: notes.trim() || undefined,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تسجيل رد السلفة');
      onSuccess(
        data.idempotentReplay
          ? `تم تأكيد رد سلفة سابق لـ ${data.employeeName}: ${fmt(data.amount)} ج.م`
          : `تم استلام رد سلفة من ${data.employeeName}: ${fmt(data.amount)} ج.م — المديونية المتبقية ${fmt(data.outstandingDebtAfter)} ج.م`,
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تسجيل رد السلفة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 text-white" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Banknote className="w-5 h-5 text-emerald-400" />
            رد سلفة
          </DialogTitle>
        </DialogHeader>

        {!employee ? (
          <p className="text-sm text-zinc-500">لم يُحدد موظف</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">الموظف</span>
                <span className="font-medium">{employee.empName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">الفرع</span>
                <span>{employee.branchLabel}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">المديونية (شاملة المرحّل)</span>
                <span className="font-mono font-bold text-rose-400">
                  {loadingDebt ? '…' : `${fmt(debt)} ج.م`}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">المبلغ المستلم</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-zinc-900 border-zinc-700"
                  dir="ltr"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-zinc-700 text-xs"
                  onClick={() => setAmount(String(debt))}
                  disabled={debt <= 0}
                >
                  كامل
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">تاريخ الاستلام</label>
              <Input
                type="date"
                value={repayDate}
                onChange={(e) => setRepayDate(e.target.value)}
                className="bg-zinc-900 border-zinc-700"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">طريقة الدفع</label>
              <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700">
                  <SelectValue placeholder={loadingMethods ? 'جاري التحميل…' : 'اختر'} />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((pm) => (
                    <SelectItem key={pm.PaymentID} value={String(pm.PaymentID)}>
                      {pm.PaymentMethod}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">ملاحظات (اختياري)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-zinc-900 border-zinc-700"
                placeholder="مثال: سداد جزئي"
              />
            </div>

            <p className="text-[11px] text-zinc-500 leading-relaxed">
              يُسجَّل Cash IN في خزينة الفرع + قيد دائن «رد سلفة» دون حذف السلف الأصلية أو تسجيل إيراد مبيعات.
            </p>

            {error ? <p className="text-sm text-rose-400">{error}</p> : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className="gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                تأكيد الاستلام
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
