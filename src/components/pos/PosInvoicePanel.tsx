'use client';

import { Save, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import CartPanel from '@/components/pos/CartPanel';
import InvoiceSummary from '@/components/pos/InvoiceSummary';
import PaymentMethodSelect from '@/components/pos/PaymentMethodSelect';
import SplitPaymentInput from '@/components/pos/SplitPaymentInput';
import type { Barber, CartItem, PaymentMethod, SaleState, SaleTotals } from '@/lib/types';

interface PosInvoicePanelProps {
  state: SaleState;
  totals: SaleTotals;
  barbers: Barber[];
  paymentMethods: PaymentMethod[];
  splitPaymentActive: boolean;
  setSplitPaymentActive: (active: boolean) => void;
  saveError: string;
  saving: boolean;
  onRemove: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<CartItem>) => void;
  onDiscountPercentChange: (v: number) => void;
  onDiscountValueChange: (v: number) => void;
  onPaymentMethodSelect: (id: number) => void;
  onPaymentAllocationsChange: (allocations: SaleState['paymentAllocations']) => void;
  onSave: (forcePrint?: boolean, source?: string) => void;
  showKeyboardHints?: boolean;
}

export default function PosInvoicePanel({
  state,
  totals,
  barbers,
  paymentMethods,
  splitPaymentActive,
  setSplitPaymentActive,
  saveError,
  saving: _saving,
  onRemove,
  onUpdateItem,
  onDiscountPercentChange,
  onDiscountValueChange,
  onPaymentMethodSelect,
  onPaymentAllocationsChange,
  onSave: _onSave,
  showKeyboardHints = true,
}: PosInvoicePanelProps) {
  const hasSplitAllocations = state.paymentAllocations.some(
    (pa) => pa.amount > 0 && pa.amount !== totals.grandTotal,
  );

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <CartPanel
        items={state.items}
        barbers={barbers}
        onRemove={onRemove}
        onUpdateItem={onUpdateItem}
      />
      <Separator />
      <InvoiceSummary
        totals={totals}
        discountPercent={state.discountPercent}
        discountValue={state.discountValue}
        onDiscountPercentChange={onDiscountPercentChange}
        onDiscountValueChange={onDiscountValueChange}
      />
      <Separator />
      {paymentMethods.length > 0 && (
        <>
          {!hasSplitAllocations ? (
            <PaymentMethodSelect
              methods={paymentMethods}
              selected={state.paymentMethodId}
              onSelect={onPaymentMethodSelect}
            />
          ) : null}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">دفع مختلط</span>
            <button
              type="button"
              onClick={() => {
                if (splitPaymentActive) {
                  const currentMethod = state.paymentMethodId || paymentMethods[0]?.ID;
                  const newAllocations = paymentMethods.map((m) => ({
                    paymentMethodId: m.ID,
                    amount: m.ID === currentMethod ? totals.grandTotal : 0,
                  }));
                  onPaymentAllocationsChange(newAllocations);
                  setSplitPaymentActive(false);
                } else {
                  const currentMethod = state.paymentMethodId || paymentMethods[0]?.ID;
                  const newAllocations = paymentMethods.map((m) => ({
                    paymentMethodId: m.ID,
                    amount: m.ID === currentMethod ? totals.grandTotal : 0,
                  }));
                  onPaymentAllocationsChange(newAllocations);
                  setSplitPaymentActive(true);
                }
              }}
              className={`min-h-11 rounded px-3 py-2 text-xs transition-colors ${
                splitPaymentActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {splitPaymentActive ? 'إلغاء' : 'تفعيل'}
            </button>
          </div>

          {splitPaymentActive && (
            <SplitPaymentInput
              methods={paymentMethods}
              grandTotal={totals.grandTotal}
              allocations={state.paymentAllocations}
              onChange={onPaymentAllocationsChange}
            />
          )}
        </>
      )}

      {saveError && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      {showKeyboardHints && (
        <div className="hidden space-y-1 text-xs text-muted-foreground md:block">
          <p>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">F9</kbd> حفظ
            الفاتورة
          </p>
          <p>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">+</kbd> حفظ
            (ضغطة) / حفظ وطباعة (ضغطتين)
          </p>
        </div>
      )}
    </div>
  );
}

interface PosInvoiceSaveActionsProps {
  saving: boolean;
  disabled: boolean;
  onSave: (forcePrint?: boolean, source?: string) => void;
}

export function PosInvoiceSaveActions({ saving, disabled, onSave }: PosInvoiceSaveActionsProps) {
  return (
    <div className="flex gap-2">
      <Button
        size="lg"
        className="min-h-11 flex-1 py-6 text-base font-bold"
        type="button"
        onClick={() => onSave(false, 'save-button')}
        disabled={saving || disabled}
      >
        {saving ? (
          <>
            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
            جاري الحفظ...
          </>
        ) : (
          <>
            <Save className="ml-2 h-5 w-5" />
            حفظ (F9)
          </>
        )}
      </Button>
      <Button
        size="lg"
        className="min-h-11 px-6 py-6 text-base font-bold"
        type="button"
        onClick={() => onSave(false, 'plus-button')}
        disabled={saving || disabled}
        variant="outline"
      >
        <span className="text-xl font-bold">+</span>
      </Button>
    </div>
  );
}
