'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

interface PaymentMethodOption {
  PaymentID: number;
  PaymentMethod: string;
}

export interface EmployeePayoutTarget {
  empId: number;
  empName: string;
  monthBalance?: number;
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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EmployeePayoutModal({
  open,
  onClose,
  employee,
  dualWriteEnabled,
  defaultPayoutDate,
  onSuccess,
}: EmployeePayoutModalProps) {
  const [amount, setAmount] = useState('');
  const [payoutDate, setPayoutDate] = useState(defaultPayoutDate ?? todayDateStr());
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [allTimeBalance, setAllTimeBalance] = useState<number | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setAmount('');
    setNotes('');
    setError('');
    setPayoutDate(defaultPayoutDate ?? todayDateStr());
    setPaymentMethodId('');
    setAllTimeBalance(null);
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

  const loadAllTimeBalance = useCallback(async (empId: number) => {
    setLoadingBalance(true);
    try {
      const res = await fetch(`/api/admin/hr/employee-ledger?empId=${empId}`);
      const data = await res.json();
      if (!res.ok && res.status !== 503) {
        throw new Error(data.error || 'فشل تحميل رصيد الموظف');
      }
      setAllTimeBalance(Number(data.balance ?? 0));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تحميل رصيد الموظف');
      setAllTimeBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    void loadPaymentMethods();
    if (employee?.empId) {
      void loadAllTimeBalance(employee.empId);
    }
  }, [open, employee?.empId, resetForm, loadPaymentMethods, loadAllTimeBalance]);

  const parsedAmount = amount.trim() === '' ? null : Number(amount);
  const balanceForValidation = allTimeBalance ?? 0;
  const amountValid = parsedAmount != null && parsedAmount > 0 && parsedAmount <= balanceForValidation;
  const canSubmit = dualWriteEnabled
    && !!employee
    && amountValid
    && !!paymentMethodId
    && !!payoutDate
    && !submitting
    && !loadingBalance;

  const handleFullBalance = () => {
    if (allTimeBalance != null && allTimeBalance > 0) {
      setAmount(String(allTimeBalance));
    }
  };

  const handleSubmit = async () => {
    if (!employee || !canSubmit || parsedAmount == null) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/hr/employee-ledger/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: employee.empId,
          amount: parsedAmount,
          paymentMethodId: Number(paymentMethodId),
          payoutDate,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل صرف المستحقات');
      }

      onSuccess('تم صرف مستحقات الموظف وتسجيلها في دفتر الموظفين');
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
            صرف مستحقات
          </DialogTitle>
        </DialogHeader>

        {!dualWriteEnabled ? (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
            ميزة صرف المستحقات تتطلب تفعيل <code className="text-amber-200">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code>
          </div>
        ) : null}

        {employee ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-muted/40 p-3 space-y-1">
              <p className="text-sm text-muted-foreground">الموظف</p>
              <p className="font-semibold">{employee.empName}</p>
              <div className="flex items-center justify-between text-sm pt-1">
                <span className="text-muted-foreground">الرصيد الحالي (إجمالي)</span>
                {loadingBalance ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="font-mono font-bold text-amber-400">
                    {fmt(allTimeBalance ?? 0)} ج.م
                  </span>
                )}
              </div>
              {employee.monthBalance != null && (
                <p className="text-xs text-muted-foreground">
                  رصيد الشهر المعروض: {fmt(employee.monthBalance)} ج.م
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">المبلغ</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="bg-surface-muted border-border"
                  disabled={!dualWriteEnabled || submitting}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-border"
                  onClick={handleFullBalance}
                  disabled={!dualWriteEnabled || loadingBalance || (allTimeBalance ?? 0) <= 0}
                >
                  صرف كامل الرصيد
                </Button>
              </div>
              {parsedAmount != null && parsedAmount > balanceForValidation && (
                <p className="text-xs text-destructive mt-1">المبلغ أكبر من رصيد الموظف الحالي</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">طريقة الدفع</label>
              <Select
                value={paymentMethodId}
                onValueChange={setPaymentMethodId}
                disabled={!dualWriteEnabled || submitting || loadingMethods}
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
                disabled={!dualWriteEnabled || submitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">ملاحظات (اختياري)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات إضافية"
                className="bg-surface-muted border-border"
                disabled={!dualWriteEnabled || submitting}
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
                  'تأكيد الصرف'
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
