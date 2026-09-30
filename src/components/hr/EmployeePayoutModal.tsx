'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Wallet } from 'lucide-react';
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

export interface EmployeePayoutTarget {
  empId: number;
  empName: string;
  payrollMonth: string;
  branchId: number;
  branchLabel: string;
  monthBalance: number;
}

interface EmployeePayoutModalProps {
  open: boolean;
  onClose: () => void;
  employee: EmployeePayoutTarget | null;
  dualWriteEnabled: boolean;
  defaultPayoutDate?: string;
  onSuccess: (message: string) => void;
}

function todayDateStr(): string {
  return getCairoMonthCloseAwareDate();
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `settle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function EmployeePayoutModal({
  open,
  onClose,
  employee,
  dualWriteEnabled,
  defaultPayoutDate,
  onSuccess,
}: EmployeePayoutModalProps) {
  const [payoutDate, setPayoutDate] = useState(defaultPayoutDate ?? todayDateStr());
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKeyRef = useRef<string>('');

  const resetForm = useCallback(() => {
    setNotes('');
    setError('');
    setPayoutDate(defaultPayoutDate ?? todayDateStr());
    setPaymentMethodId('');
    idempotencyKeyRef.current = createIdempotencyKey();
  }, [defaultPayoutDate]);

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

  useEffect(() => {
    if (!open) return;
    resetForm();
    void loadPaymentMethods();
  }, [open, employee?.empId, resetForm, loadPaymentMethods]);

  const settlementAmount = employee?.monthBalance ?? 0;
  const hasPositiveBalance = settlementAmount > 0;
  const canSubmit = dualWriteEnabled
    && !!employee
    && hasPositiveBalance
    && !!paymentMethodId
    && !!payoutDate
    && !submitting
    && !loadingMethods;

  const handleSubmit = async () => {
    if (!employee || !canSubmit) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/hr/employee-ledger/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: employee.empId,
          amount: settlementAmount,
          expectedBalance: settlementAmount,
          payrollMonth: employee.payrollMonth,
          confirmedLedgerBranchId: employee.branchId,
          paymentMethodId: Number(paymentMethodId),
          payoutDate,
          idempotencyKey: idempotencyKeyRef.current,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل صرف المستحقات');
      }

      onSuccess(
        data.idempotentReplay
          ? 'تمت تسوية مستحقات الموظف مسبقاً — لا حركة مكررة'
          : 'تم صرف مستحقات الموظف كسلفة أخيرة للشهر وتسجيلها في الدفتر والخزنة',
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل صرف المستحقات');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="bg-surface border-border text-foreground max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Wallet className="w-5 h-5 text-primary" />
            صرف مستحقات — سلفة أخيرة للشهر
          </DialogTitle>
        </DialogHeader>

        {!dualWriteEnabled ? (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
            ميزة صرف المستحقات تتطلب تفعيل <code className="text-amber-200">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code>
          </div>
        ) : null}

        {employee ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-muted/40 p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">الموظف</span>
                <span className="font-semibold">{employee.empName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">شهر الرواتب</span>
                <span className="font-mono">{employee.payrollMonth}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">الفرع التشغيلي النشط</span>
                <span className="font-semibold">{employee.branchLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                <span className="text-muted-foreground">مبلغ التسوية (رصيد الشهر)</span>
                <span className={`font-mono font-bold ${hasPositiveBalance ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {fmt(settlementAmount)} ج.م
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 text-xs text-sky-200/90 leading-relaxed">
              سيتم تسجيل المبلغ كسلفة أخيرة للشهر {employee.payrollMonth} — صرف مستحقات
              على الفرع التشغيلي النشط ({employee.branchLabel}) فقط،
              مع خصم واحد من الخزنة وقيد مدين واحد في دفتر الموظف (سبب: سلفة).
              لا يُنشأ قيد «صرف» منفصل. عرض كل الفروع أو فرع غير فرع الجلسة لا يفتح هذه التسوية.
            </div>

            {!hasPositiveBalance && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
                لا يوجد مستحقات موجبة لهذا الموظف في هذا الشهر والفرع — لا يمكن تنفيذ صرف مستحقات.
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">طريقة الدفع</label>
              <Select
                value={paymentMethodId}
                onValueChange={setPaymentMethodId}
                disabled={!dualWriteEnabled || submitting || loadingMethods || !hasPositiveBalance}
              >
                <SelectTrigger className="bg-surface-muted border-border">
                  <SelectValue placeholder={loadingMethods ? 'جاري التحميل...' : 'اختر طريقة الدفع'} />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  {paymentMethods.map((pm) => (
                    <SelectItem key={pm.PaymentID} value={String(pm.PaymentID)}>
                      {pm.PaymentMethod}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">تاريخ الصرف</label>
              <Input
                type="date"
                value={payoutDate}
                onChange={(e) => setPayoutDate(e.target.value)}
                className="bg-surface-muted border-border"
                disabled={!dualWriteEnabled || submitting || !hasPositiveBalance}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">ملاحظات (اختياري)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات إضافية"
                className="bg-surface-muted border-border"
                disabled={!dualWriteEnabled || submitting || !hasPositiveBalance}
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-border"
                onClick={onClose}
                disabled={submitting}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    جاري الصرف...
                  </>
                ) : (
                  'تأكيد صرف المستحقات'
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
