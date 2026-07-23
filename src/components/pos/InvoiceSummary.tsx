'use client';

import { Receipt } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import type { SaleTotals } from '@/lib/types';

interface InvoiceSummaryProps {
  totals: SaleTotals;
  /** Non-blocking notice when editing a legacy invoice with header DisVal > 0 */
  legacyHeaderDiscountWarning?: boolean;
  legacyHeaderDiscountValue?: number;
}

export default function InvoiceSummary({
  totals,
  legacyHeaderDiscountWarning = false,
  legacyHeaderDiscountValue = 0,
}: InvoiceSummaryProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-muted-foreground">ملخص الفاتورة</h3>
      </div>

      {legacyHeaderDiscountWarning && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          هذه فاتورة قديمة تحتوي على خصم عام
          {legacyHeaderDiscountValue > 0
            ? ` (${legacyHeaderDiscountValue.toFixed(2)} ج.م)`
            : ''}
          . سيظل الخصم محفوظًا كما هو، لكن لا يمكن إنشاء خصومات عامة جديدة. استخدم خصم كل خدمة
          على حدة.
        </div>
      )}

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">المجموع</span>
          <span className="font-medium">{totals.subTotal.toFixed(2)} ج.م</span>
        </div>

        {totals.discountValue > 0 && (
          <div className="flex justify-between text-destructive">
            <span>إجمالي خصومات الخدمات</span>
            <span>- {totals.discountValue.toFixed(2)} ج.م</span>
          </div>
        )}

        <Separator />

        <div className="flex justify-between text-lg font-bold">
          <span>الإجمالي</span>
          <span className="text-primary">{totals.grandTotal.toFixed(2)} ج.م</span>
        </div>

        {totals.totalBonus > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>إجمالي البونص</span>
            <span>{totals.totalBonus.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
