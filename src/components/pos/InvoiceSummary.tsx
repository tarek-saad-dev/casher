'use client';

import { Receipt } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { SaleTotals } from '@/lib/types';

interface InvoiceSummaryProps {
  totals: SaleTotals;
  discountPercent: number;
  discountValue: number;
  onDiscountPercentChange: (v: number) => void;
  onDiscountValueChange: (v: number) => void;
}

export default function InvoiceSummary({
  totals,
  discountPercent,
  discountValue,
  onDiscountPercentChange,
  onDiscountValueChange,
}: InvoiceSummaryProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-muted-foreground">ملخص الفاتورة</h3>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">المجموع</span>
          <span className="font-medium">{totals.subTotal.toFixed(2)} ج.م</span>
        </div>

        {/* Discount controls */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs shrink-0">خصم %</span>
          <Input
            type="number"
            min={0}
            max={100}
            step="1"
            value={discountPercent || ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0;
              onDiscountPercentChange(Math.max(0, Math.min(100, v)));
            }}
            className="h-7 text-xs w-16 text-center"
            dir="ltr"
          />
          <span className="text-muted-foreground text-xs shrink-0">أو قيمة</span>
          <Input
            type="number"
            min={0}
            step="1"
            value={discountValue || ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0;
              onDiscountValueChange(Math.max(0, v));
            }}
            className="h-7 text-xs w-20 text-center"
            dir="ltr"
          />
        </div>

        {totals.discountValue > 0 && (
          <div className="flex justify-between text-destructive">
            <span>الخصم</span>
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
