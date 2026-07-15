'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { TargetLikeRow } from '@/lib/payroll/employee-target/merge-daily-payroll-target-rows';

const fmt2 = (n: number | string) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

const fmt6 = (n: number | string) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 6 }).format(Number(n));

interface Props {
  open: boolean;
  onClose: () => void;
  workDate: string;
  target: TargetLikeRow | null;
}

export default function DailyTargetDetailsDialog({ open, onClose, workDate, target }: Props) {
  if (!target) return null;

  const persisted = target.persistenceStatus !== 'not_generated';
  const breakdown = persisted && target.calculationBreakdownJson
    ? (() => {
        try {
          const parsed = JSON.parse(target.calculationBreakdownJson) as {
            breakdown?: Array<{
              from: string;
              to: string | null;
              eligibleAmount: string;
              ratePercent: string;
              targetAmount: string;
            }>;
          };
          return parsed.breakdown ?? [];
        } catch {
          return [];
        }
      })()
    : target.previewBreakdown as Array<{
        from: string;
        to: string | null;
        eligibleAmount: string;
        ratePercent: string;
        targetAmount: string;
      }>;

  const amount = persisted ? target.storedTargetAmount : target.previewTargetAmount;
  const sales = persisted
    ? target.storedNetSalesAfterDiscount
    : target.currentNetSalesAfterDiscount;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>تفاصيل تارجت اليوم — {target.empName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!persisted && (
            <div className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
              معاينة غير محفوظة بعد — اضغط «إعادة حساب التارجت فقط» لحفظ النتيجة.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-zinc-500">التاريخ</span><p>{workDate}</p></div>
            <div><span className="text-zinc-500">خطة</span><p>#{target.targetPlanId}</p></div>
            <div><span className="text-zinc-500">السريان</span><p>{target.planEffectiveFrom}{target.planEffectiveTo ? ` → ${target.planEffectiveTo}` : ' → مفتوح'}</p></div>
            <div><span className="text-zinc-500">أساس الإدخال</span><p>{target.inputBasis === 'monthly' ? 'شهري' : 'يومي'} · {target.conversionDays} يوم</p></div>
            <div><span className="text-zinc-500">مبيعات بعد الخصم</span><p className="text-sky-400">{fmt2(sales ?? 0)}</p></div>
            <div><span className="text-zinc-500">تارجت اليوم</span><p className="text-emerald-400 font-bold">{fmt2(amount ?? 0)}</p></div>
            <div><span className="text-zinc-500">حالة التخزين</span><p>{target.persistenceStatus}</p></div>
            <div><span className="text-zinc-500">آخر حساب</span><p>{target.updatedAt ?? target.generatedAt ?? '—'}</p></div>
          </div>

          <div>
            <p className="text-xs text-zinc-500 mb-1">الشرائح</p>
            <ul className="text-xs space-y-1 text-zinc-300">
              {(target.tiers as Array<{ sortOrder: number; dailyStartAmount: string; ratePercent: string }>).map((t) => (
                <li key={t.sortOrder}>
                  #{t.sortOrder}: من {fmt6(t.dailyStartAmount)} · {fmt6(t.ratePercent)}%
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-700">
                  <th className="py-1 text-right">من</th>
                  <th className="py-1 text-right">إلى</th>
                  <th className="py-1 text-right">المبلغ المحتسب</th>
                  <th className="py-1 text-right">النسبة</th>
                  <th className="py-1 text-right">الناتج</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b, i) => (
                  <tr key={i} className="border-b border-zinc-800">
                    <td className="py-1">{fmt6(b.from)}</td>
                    <td className="py-1">{b.to == null ? '∞' : fmt6(b.to)}</td>
                    <td className="py-1">{fmt6(b.eligibleAmount)}</td>
                    <td className="py-1">{fmt6(b.ratePercent)}%</td>
                    <td className="py-1">{fmt6(b.targetAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            الإجمالي (قرشين): <span className="font-bold text-emerald-400">{fmt2(amount ?? 0)}</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
