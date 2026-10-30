'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { Loader2, ArrowLeftRight } from 'lucide-react';
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

type BranchSnap = {
  branchId: number;
  branchCode: string;
  branchName: string;
  balance: number;
};

type SettlementPair = {
  source: BranchSnap;
  dest: BranchSnap;
  maxAmount: number;
};

type HistoryRow = {
  settlementId: number;
  sourceBranchCode: string;
  destBranchCode: string;
  amount: number;
  settlementType: string;
  settlementDate: string;
  isVoided: boolean;
  notes: string | null;
};

export interface InterBranchSettlementTarget {
  empId: number;
  empName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  employee: InterBranchSettlementTarget | null;
  dualWriteEnabled: boolean;
  onSuccess: (message: string) => void;
}

function shortCode(code: string): string {
  if (code === 'GLEEM') return 'جليم';
  if (code === 'CAMP_CAESAR') return 'كامب شيزار';
  return code;
}

function todayDateStr(): string {
  return getCairoMonthCloseAwareDate();
}

export default function EmployeeInterBranchSettlementModal({
  open,
  onClose,
  employee,
  dualWriteEnabled,
  onSuccess,
}: Props) {
  const idemBase = useId();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pairs, setPairs] = useState<SettlementPair[]>([]);
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [destBranchId, setDestBranchId] = useState('');
  const [maxAmount, setMaxAmount] = useState(0);
  const [amount, setAmount] = useState('');
  const [settlementDate, setSettlementDate] = useState(todayDateStr());
  const [settlementType, setSettlementType] = useState<'ledger_only' | 'cash_transfer'>('ledger_only');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<Array<{ PaymentID: number; PaymentMethod: string }>>([]);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [sourceBal, setSourceBal] = useState(0);
  const [destBal, setDestBal] = useState(0);
  const [totalBefore, setTotalBefore] = useState(0);

  const reset = useCallback(() => {
    setError('');
    setPairs([]);
    setSourceBranchId('');
    setDestBranchId('');
    setMaxAmount(0);
    setAmount('');
    setSettlementDate(todayDateStr());
    setSettlementType('ledger_only');
    setPaymentMethodId('');
    setNotes('');
    setConfirmOpen(false);
    setHistory([]);
  }, []);

  const loadPreview = useCallback(async (empId: number, src?: number, dst?: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ empId: String(empId) });
      if (src) params.set('sourceBranchId', String(src));
      if (dst) params.set('destBranchId', String(dst));
      const res = await fetch(`/api/admin/hr/employee-ledger/inter-branch-settlement?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل معاينة التسوية');

      setPairs(Array.isArray(data.pairs) ? data.pairs : []);
      const selected = data.selected;
      if (selected) {
        setSourceBranchId(String(selected.source.branchId));
        setDestBranchId(String(selected.dest.branchId));
        setMaxAmount(Number(selected.maxAmount ?? 0));
        setAmount(String(selected.suggestedAmount ?? selected.maxAmount ?? ''));
        setSourceBal(Number(selected.source.balance ?? 0));
        setDestBal(Number(selected.dest.balance ?? 0));
        setTotalBefore(Number(selected.projection?.totalBefore ?? 0));
      } else if (!src && !dst && data.pairs?.[0]) {
        const p = data.pairs[0] as SettlementPair;
        setSourceBranchId(String(p.source.branchId));
        setDestBranchId(String(p.dest.branchId));
        setMaxAmount(p.maxAmount);
        setAmount(String(p.maxAmount));
        setSourceBal(p.source.balance);
        setDestBal(p.dest.balance);
        setTotalBefore(p.source.balance + p.dest.balance);
      } else if (!selected) {
        setMaxAmount(0);
        setAmount('');
      }

      const histRes = await fetch(
        `/api/admin/hr/employee-ledger/inter-branch-settlement?empId=${empId}&list=1`,
      );
      const histData = await histRes.json();
      if (histRes.ok) setHistory(Array.isArray(histData.settlements) ? histData.settlements : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !employee) return;
    reset();
    void loadPreview(employee.empId);
    void (async () => {
      try {
        const res = await fetch('/api/incomes/meta');
        const data = await res.json();
        if (res.ok) setPaymentMethods(data.paymentMethods ?? []);
      } catch {
        /* optional */
      }
    })();
  }, [open, employee, reset, loadPreview]);

  useEffect(() => {
    if (!open || !employee || !sourceBranchId || !destBranchId) return;
    void loadPreview(employee.empId, Number(sourceBranchId), Number(destBranchId));
  }, [sourceBranchId, destBranchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedAmount = amount.trim() === '' ? null : Number(amount);
  const amountValid =
    parsedAmount != null && Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= maxAmount + 0.00001;
  const sourceAfter = amountValid ? sourceBal - (parsedAmount as number) : null;
  const destAfter = amountValid ? destBal + (parsedAmount as number) : null;
  const totalAfter =
    sourceAfter != null && destAfter != null ? sourceAfter + destAfter : null;

  const canSubmit =
    dualWriteEnabled &&
    !!employee &&
    !!sourceBranchId &&
    !!destBranchId &&
    amountValid &&
    maxAmount > 0 &&
    !!settlementDate &&
    (settlementType === 'ledger_only' || !!paymentMethodId) &&
    !submitting &&
    !loading;

  const handleSubmit = async () => {
    if (!employee || !canSubmit || parsedAmount == null) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/inter-branch-settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: employee.empId,
          sourceBranchId: Number(sourceBranchId),
          destBranchId: Number(destBranchId),
          amount: parsedAmount,
          date: settlementDate,
          settlementType,
          paymentMethodId: settlementType === 'cash_transfer' ? Number(paymentMethodId) : undefined,
          notes: notes.trim() || undefined,
          idempotencyKey: `${idemBase}:${employee.empId}:${sourceBranchId}:${destBranchId}:${parsedAmount}:${settlementDate}:${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تنفيذ التسوية');

      onSuccess(
        `تمت تسوية ${fmt(data.amount)} ج.م لـ ${employee.empName} — الإجمالي ${fmt(data.totalAfter)} ج.م (بدون تغيير)`,
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التنفيذ');
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const pairOptions = pairs.length > 0 ? pairs : [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="bg-surface border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="w-5 h-5 text-primary" />
            تسوية بين الفروع
          </DialogTitle>
        </DialogHeader>

        {!dualWriteEnabled ? (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
            تتطلب الميزة تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED
          </div>
        ) : null}

        {employee ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground font-medium">{employee.empName}</p>
            <p className="text-xs text-muted-foreground">
              نقل جزء من المستحقات من فرع دائن إلى فرع مدين دون تغيير الإجمالي. التحويل النقدي اختياري فقط إذا انتقلت النقدية فعليًا.
            </p>

            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…
              </div>
            ) : pairOptions.length === 0 ? (
              <div className="p-3 rounded-lg border border-border text-sm text-muted-foreground">
                لا توجد فرصة تسوية الآن (يلزم رصيد موجب في فرع وسالب في آخر).
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">اتجاه التسوية</label>
                  <Select
                    value={`${sourceBranchId}:${destBranchId}`}
                    onValueChange={(v) => {
                      const [s, d] = v.split(':');
                      setSourceBranchId(s);
                      setDestBranchId(d);
                    }}
                    disabled={submitting}
                  >
                    <SelectTrigger className="bg-surface-muted border-border">
                      <SelectValue placeholder="اختر الاتجاه" />
                    </SelectTrigger>
                    <SelectContent className="bg-surface border-border">
                      {pairOptions.map((p) => (
                        <SelectItem
                          key={`${p.source.branchId}-${p.dest.branchId}`}
                          value={`${p.source.branchId}:${p.dest.branchId}`}
                        >
                          من {shortCode(p.source.branchCode)} ({fmt(p.source.balance)}) →{' '}
                          {shortCode(p.dest.branchCode)} ({fmt(p.dest.balance)}) · أقصى {fmt(p.maxAmount)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <p className="text-xs text-muted-foreground mb-1">المصدر (دائن)</p>
                    <p className="font-semibold">{shortCode(pairOptions.find((p) => String(p.source.branchId) === sourceBranchId)?.source.branchCode ?? '')}</p>
                    <p className="font-mono text-emerald-400">{fmt(sourceBal)} ج.م</p>
                  </div>
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                    <p className="text-xs text-muted-foreground mb-1">المستفيد (مدين)</p>
                    <p className="font-semibold">{shortCode(pairOptions.find((p) => String(p.dest.branchId) === destBranchId)?.dest.branchCode ?? '')}</p>
                    <p className="font-mono text-rose-400">{fmt(destBal)} ج.م</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    مبلغ التسوية (أقصى {fmt(maxAmount)})
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={submitting}
                      className="bg-surface-muted border-border font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting || maxAmount <= 0}
                      onClick={() => setAmount(String(maxAmount))}
                    >
                      كامل
                    </Button>
                  </div>
                </div>

                {sourceAfter != null && destAfter != null && totalAfter != null && (
                  <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 space-y-1.5 text-sm">
                    <p className="font-medium text-sky-200">بعد التسوية</p>
                    <div className="flex justify-between"><span>المصدر</span><span className="font-mono">{fmt(sourceAfter)}</span></div>
                    <div className="flex justify-between"><span>المستفيد</span><span className="font-mono">{fmt(destAfter)}</span></div>
                    <div className="flex justify-between border-t border-border/50 pt-1.5">
                      <span>الإجمالي قبل / بعد</span>
                      <span className="font-mono font-bold">{fmt(totalBefore)} → {fmt(totalAfter)}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">التاريخ</label>
                  <Input
                    type="date"
                    value={settlementDate}
                    onChange={(e) => setSettlementDate(e.target.value)}
                    disabled={submitting}
                    className="bg-surface-muted border-border"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settlementType === 'cash_transfer'}
                      onChange={(e) =>
                        setSettlementType(e.target.checked ? 'cash_transfer' : 'ledger_only')
                      }
                      disabled={submitting}
                    />
                    تم نقل النقدية فعليًا بين خزنتَي الفرعين
                  </label>
                  {settlementType === 'cash_transfer' ? (
                    <Select
                      value={paymentMethodId}
                      onValueChange={setPaymentMethodId}
                      disabled={submitting}
                    >
                      <SelectTrigger className="bg-surface-muted border-border">
                        <SelectValue placeholder="طريقة الدفع" />
                      </SelectTrigger>
                      <SelectContent className="bg-surface border-border">
                        {paymentMethods.map((pm) => (
                          <SelectItem key={pm.PaymentID} value={String(pm.PaymentID)}>
                            {pm.PaymentMethod}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      تسوية دفترية فقط — بدون حركة خزنة وهمية.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">ملاحظات</label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={submitting}
                    className="bg-surface-muted border-border"
                  />
                </div>
              </>
            )}

            {history.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 text-xs font-semibold bg-surface-muted">تسويات سابقة</div>
                <ul className="divide-y divide-border text-xs max-h-36 overflow-y-auto">
                  {history.slice(0, 10).map((h) => (
                    <li key={h.settlementId} className="px-3 py-2 flex justify-between gap-2">
                      <span>
                        #{h.settlementId} · {h.settlementDate} · {shortCode(h.sourceBranchCode)}→
                        {shortCode(h.destBranchCode)}
                        {h.isVoided ? ' (ملغاة)' : ''}
                      </span>
                      <span className="font-mono">{fmt(h.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error ? (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-300 text-sm">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                إلغاء
              </Button>
              {!confirmOpen ? (
                <Button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => setConfirmOpen(true)}
                >
                  متابعة
                </Button>
              ) : (
                <Button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  تأكيد التسوية {parsedAmount != null ? fmt(parsedAmount) : ''}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
