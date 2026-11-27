'use client';

import { Save, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import DecemberReception from '@/components/pos/DecemberReception';
import DecemberGroupLookup from '@/components/pos/DecemberGroupLookup';
import DecemberEligibilityPreview from '@/components/pos/DecemberEligibilityPreview';
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
  onRemoveMany?: (ids: string[]) => void;
  onUpdateItem: (id: string, patch: Partial<CartItem>) => void;
  onDiscountPercentChange: (v: number) => void;
  onDiscountValueChange: (v: number) => void;
  onPaymentMethodSelect: (id: number) => void;
  onPaymentAllocationsChange: (allocations: SaleState['paymentAllocations']) => void;
  onSave: (forcePrint?: boolean, source?: string) => void;
  decemberCheckout?: {active:boolean;busy:boolean;canApply:boolean;onApply:()=>void;onClear:()=>void};
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
  onRemoveMany,
  onUpdateItem,
  onDiscountPercentChange,
  onDiscountValueChange,
  onPaymentMethodSelect,
  onPaymentAllocationsChange,
  onSave: _onSave,
  decemberCheckout,
  showKeyboardHints = true,
}: PosInvoicePanelProps) {
  const hasSplitAllocations = state.paymentAllocations.some(
    (pa) => pa.amount > 0 && pa.amount !== totals.grandTotal,
  );

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {process.env.NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED === 'true' && state.customer && <DecemberReception key={state.customer.ClientID} clientId={state.customer.ClientID}/>}
      {process.env.NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED === "true" && state.customer && <DecemberEligibilityPreview key={state.customer.ClientID} clientId={state.customer.ClientID} />}
      {decemberCheckout && <div className="rounded-lg border p-3 text-sm space-y-2" dir="rtl">
        <strong>خصم امتحان ديسمبر</strong>
        {decemberCheckout.active ? <button type="button" disabled={_saving} onClick={decemberCheckout.onClear} className="block underline">إلغاء خصم الحملة</button> : <button type="button" disabled={!decemberCheckout.canApply||decemberCheckout.busy} onClick={decemberCheckout.onApply} className="block rounded bg-[#CF252B] px-3 py-2 text-white disabled:opacity-50">{decemberCheckout.busy?'جاري حساب الاستحقاق…':'احسب وطبّق الخصم'}</button>}
        <p className="text-muted-foreground text-xs">يتحقق السيرفر مرة أخرى قبل الحفظ. الفاتورة المجانية تتطلب جاهزية مسار عدم التحصيل في بيئة التشغيل.</p>
      </div>}
      {process.env.NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED === 'true' && <DecemberGroupLookup/>}
      <CartPanel
        items={state.items}
        barbers={barbers}
        onRemove={onRemove}
        onRemoveMany={onRemoveMany}
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
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive-soft p-2.5 text-sm text-destructive">
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
        size="xl"
        className="flex-1 font-bold"
        type="button"
        onClick={() => onSave(false, 'save-button')}
        disabled={saving || disabled}
        aria-busy={saving || undefined}
      >
        {saving ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
            جاري الحفظ...
          </>
        ) : (
          <>
            <Save className="size-5" aria-hidden />
            حفظ (F9)
          </>
        )}
      </Button>
      <Button
        size="xl"
        className="px-5 font-bold"
        aria-label="حفظ سريع (+)"
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
