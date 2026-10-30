'use client';

import { useEffect, useState } from 'react';
import { Loader2, Banknote } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatPartnersCurrency } from './partnersReportUtils';

interface PaymentMethod {
  PaymentID: number;
  PaymentMethod: string;
}

export interface AdvanceRepaymentTarget {
  employeeId: number;
  employeeName: string;
  advanceExcess: number;
}

export default function EmployeeAdvanceRepaymentDialog({
  target,
  month,
  onClose,
  onSuccess,
}: {
  target: AdvanceRepaymentTarget | null;
  month: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Persist for retry after a lost HTTP response. A new dialog receives a new id.
  const [repaymentId, setRepaymentId] = useState('');

  useEffect(() => {
    if (!target) return;
    setAmount(String(target.advanceExcess));
    setNotes('');
    setPaymentMethodId('');
    setError('');
    setRepaymentId(crypto.randomUUID());
    setMethods([]);
    setLoading(true);
    fetch('/api/incomes/meta')
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'تعذر تحميل طرق الدفع');
        setMethods(Array.isArray(json.paymentMethods) ? json.paymentMethods : []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذر تحميل طرق الدفع'))
      .finally(() => setLoading(false));
  }, [target]);

  const numericAmount = Number(amount);
  const valid = target && Number.isFinite(numericAmount)
    && numericAmount > 0 && numericAmount <= target.advanceExcess
    && !!paymentMethodId && !!repaymentId && !submitting;

  async function submit() {
    if (!target || !valid) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/advance-repayment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: target.employeeId,
          amount: numericAmount,
          paymentMethodId: Number(paymentMethodId),
          month,
          repaymentId,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر تسجيل السداد');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل السداد');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="bg-surface border-border max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex gap-2 items-center text-lg">
            <Banknote className="w-5 h-5 text-emerald-400" /> سداد سلفة موظف
          </DialogTitle>
          <DialogDescription className="text-right">
            يتم تحصيل النقدية أو التحويل وتخفيض دين الموظف، وليس تسجيل إيراد مبيعات جديد.
          </DialogDescription>
        </DialogHeader>
        {target && <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-muted/40 p-3 text-sm">
            <div className="flex justify-between gap-2"><span>الموظف</span><b>{target.employeeName}</b></div>
            <div className="flex justify-between gap-2 mt-2">
              <span>العجز الظاهر بالشهر</span>
              <b className="text-rose-400">{formatPartnersCurrency(target.advanceExcess)}</b>
            </div>
          </div>
          <label className="block text-sm space-y-2">
            <span>المبلغ المسدد</span>
            <Input type="number" step="0.01" min="0.01" max={target.advanceExcess}
              value={amount} onChange={(e) => { setAmount(e.target.value); setRepaymentId(crypto.randomUUID()); }}
              disabled={submitting} />
          </label>
          <label className="block text-sm space-y-2">
            <span>طريقة استلام المبلغ</span>
            <Select value={paymentMethodId} onValueChange={(v) => { setPaymentMethodId(v); setRepaymentId(crypto.randomUUID()); }} disabled={submitting || loading}>
              <SelectTrigger><SelectValue placeholder={loading ? 'جاري التحميل...' : 'اختر وسيلة التحصيل'} /></SelectTrigger>
              <SelectContent>
                {methods.map((method) => <SelectItem key={method.PaymentID} value={String(method.PaymentID)}>
                  {method.PaymentMethod}
                </SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block text-sm space-y-2">
            <span>ملاحظات (اختياري)</span>
            <Input value={notes} onChange={(e) => { setNotes(e.target.value); setRepaymentId(crypto.randomUUID()); }}
              disabled={submitting} maxLength={300} placeholder="مثلاً: سداد عجز شهر أكتوبر" />
          </label>
          <p className="text-xs text-zinc-500">
            يقل العجز في تقرير التدفق النقدي بعد تحديثه. تحصيل سلفة قديمة ليس ربحًا محاسبيًا جديدًا.
          </p>
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" disabled={submitting} onClick={onClose}>إلغاء</Button>
            <Button className="flex-1" disabled={!valid} onClick={() => void submit()}>
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin ml-2" />جاري التسجيل</> : 'تأكيد استلام السداد'}
            </Button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
