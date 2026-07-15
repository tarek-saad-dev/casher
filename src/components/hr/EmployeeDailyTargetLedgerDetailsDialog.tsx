'use client';

import { useEffect, useState } from 'react';
import { Loader2, Target } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const fmt2 = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fmt6 = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(n);

interface DetailsPayload {
  dailyTarget: {
    id: number;
    empId: number;
    empName: string;
    workDate: string;
    targetPlanId: number;
    netSalesAfterDiscount: number;
    targetAmount: number;
    inputBasis: string | null;
    conversionDays: number | null;
    calculationBreakdownJson: string | null;
    generatedAt: string;
    updatedAt: string | null;
  };
  tiers: Array<{
    sortOrder: number;
    inputStartAmount: number;
    dailyStartAmount: number;
    ratePercent: number;
  }>;
  ledger: {
    id: number;
    amount: number;
    entryDate: string;
    payrollMonth: string | null;
    cashMoveId: number | null;
  } | null;
  match: { status: string; message: string };
  sourceSync?: { status: string; message: string; lastErrorSafe: string | null };
}

interface Props {
  open: boolean;
  dailyTargetId: number | null;
  onClose: () => void;
}

export default function EmployeeDailyTargetLedgerDetailsDialog({
  open,
  dailyTargetId,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<DetailsPayload | null>(null);

  useEffect(() => {
    if (!open || dailyTargetId == null) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    void (async () => {
      try {
        const res = await fetch(`/api/payroll/daily/targets/${dailyTargetId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'فشل تحميل التفاصيل');
        if (!cancelled) setData(json as DetailsPayload);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'فشل التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dailyTargetId]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            تفاصيل تارجت يومي
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري التحميل...
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
            {error}
          </div>
        )}
        {data && !loading && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <p><span className="text-muted-foreground">الموظف:</span> {data.dailyTarget.empName}</p>
              <p><span className="text-muted-foreground">التاريخ:</span> {data.dailyTarget.workDate}</p>
              <p><span className="text-muted-foreground">TargetPlanID:</span> {data.dailyTarget.targetPlanId}</p>
              <p>
                <span className="text-muted-foreground">صافي المبيعات:</span>{' '}
                {fmt6(data.dailyTarget.netSalesAfterDiscount)}
              </p>
              <p>
                <span className="text-muted-foreground">TargetAmount:</span>{' '}
                <span className="font-semibold text-primary">{fmt2(data.dailyTarget.targetAmount)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">أساس الإدخال:</span>{' '}
                {data.dailyTarget.inputBasis ?? '—'}
                {data.dailyTarget.conversionDays != null
                  ? ` · ${data.dailyTarget.conversionDays} يوم`
                  : ''}
              </p>
              <p className="col-span-2 text-xs text-muted-foreground">
                GeneratedAt: {data.dailyTarget.generatedAt}
                {data.dailyTarget.updatedAt ? ` · UpdatedAt: ${data.dailyTarget.updatedAt}` : ''}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold mb-1">الشرائح (من الخطة الحالية للعرض — الحساب من Snapshot)</h4>
              <ul className="text-xs space-y-1 border border-border rounded-lg p-2">
                {data.tiers.map((t) => (
                  <li key={t.sortOrder}>
                    #{t.sortOrder}: يومي {fmt6(t.dailyStartAmount)} · {fmt6(t.ratePercent)}%
                  </li>
                ))}
                {data.tiers.length === 0 && <li className="text-muted-foreground">لا شرائح</li>}
              </ul>
            </div>

            {data.dailyTarget.calculationBreakdownJson && (
              <div>
                <h4 className="text-xs font-semibold mb-1">CalculationBreakdownJson (Snapshot)</h4>
                <pre className="text-[10px] leading-relaxed bg-surface-muted/30 border border-border rounded-lg p-2 overflow-x-auto max-h-40">
                  {data.dailyTarget.calculationBreakdownJson}
                </pre>
              </div>
            )}

            <div className="rounded-lg border border-border p-3 space-y-1">
              <h4 className="text-xs font-semibold">قيد الدفتر</h4>
              {data.ledger ? (
                <>
                  <p>LedgerEntry ID: {data.ledger.id}</p>
                  <p>المبلغ: {fmt2(data.ledger.amount)}</p>
                  <p>التاريخ: {data.ledger.entryDate} · شهر: {data.ledger.payrollMonth ?? '—'}</p>
                  <p>CashMoveID: {data.ledger.cashMoveId ?? 'NULL'}</p>
                </>
              ) : (
                <p className="text-muted-foreground">لا يوجد قيد تارجت مرتبط (مبلغ صفر أو غير مزامن)</p>
              )}
              <p className="text-xs mt-2">
                حالة التطابق:{' '}
                <span className="font-medium">{data.match.status}</span>
                {' — '}
                {data.match.message}
              </p>
              {data.sourceSync && (
                <p className="text-xs mt-1">
                  مزامنة المصدر:{' '}
                  <span className="font-medium">{data.sourceSync.status}</span>
                  {' — '}
                  {data.sourceSync.message}
                  {data.sourceSync.lastErrorSafe
                    ? ` (${data.sourceSync.lastErrorSafe})`
                    : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
