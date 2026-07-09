'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, HandCoins } from 'lucide-react';
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

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
}

interface EmployeeFundingModalProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeOption[];
  dualWriteEnabled: boolean;
  defaultDate?: string;
  onSuccess: (message: string) => void;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EmployeeFundingModal({
  open,
  onClose,
  employees,
  dualWriteEnabled,
  defaultDate,
  onSuccess,
}: EmployeeFundingModalProps) {
  const [empId, setEmpId] = useState('');
  const [amount, setAmount] = useState('');
  const [fundingDate, setFundingDate] = useState(defaultDate ?? todayDateStr());
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [allTimeBalance, setAllTimeBalance] = useState<number | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setEmpId('');
    setAmount('');
    setNotes('');
    setError('');
    setFundingDate(defaultDate ?? todayDateStr());
    setPaymentMethodId('');
    setAllTimeBalance(null);
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

  const loadAllTimeBalance = useCallback(async (selectedEmpId: number) => {
    setLoadingBalance(true);
    try {
      const res = await fetch(`/api/admin/hr/employee-ledger?empId=${selectedEmpId}`);
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
  }, [open, resetForm, loadPaymentMethods]);

  useEffect(() => {
    if (!open || !empId) {
      setAllTimeBalance(null);
      return;
    }
    void loadAllTimeBalance(Number(empId));
  }, [open, empId, loadAllTimeBalance]);

  const parsedAmount = amount.trim() === '' ? null : Number(amount);
  const amountValid = parsedAmount != null && parsedAmount > 0;
  const canSubmit = dualWriteEnabled
    && !!empId
    && amountValid
    && !!paymentMethodId
    && !!fundingDate
    && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || parsedAmount == null) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/hr/employee-ledger/employee-funding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: Number(empId),
          amount: parsedAmount,
          paymentMethodId: Number(paymentMethodId),
          date: fundingDate,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تسجيل التمويل');
      }

      onSuccess(
        `تم تسجيل تمويل ${fmt(data.amount)} ج.م من ${data.employeeName} — الرصيد الجديد ${fmt(data.newBalance)} ج.م`,
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تسجيل التمويل');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="bg-surface border-border text-foreground max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <HandCoins className="w-5 h-5 text-primary" />
            تمويل من موظف
          </DialogTitle>
        </DialogHeader>

        {!dualWriteEnabled ? (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
            ميزة تمويل الموظف تتطلب تفعيل <code className="text-amber-200">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code>
          </div>
        ) : null}

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            تسجيل مبلغ يُودعه الموظف للمحل مؤقتاً — يزيد الخزنة ويُسجَّل التزام في دفتر الموظف (ليس إيراد مبيعات).
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

          {empId && (
            <div className="flex items-center justify-between text-sm rounded-lg border border-border bg-surface-muted/40 p-3">
              <span className="text-muted-foreground">الرصيد الحالي (إجمالي)</span>
              {loadingBalance ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="font-mono font-bold text-amber-400">
                  {fmt(allTimeBalance ?? 0)} ج.م
                </span>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">المبلغ</label>
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
            <label className="block text-sm font-medium mb-2">التاريخ</label>
            <Input
              type="date"
              value={fundingDate}
              onChange={(e) => setFundingDate(e.target.value)}
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
                  جاري التسجيل...
                </>
              ) : (
                'تأكيد التمويل'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
