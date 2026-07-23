'use client';

import MobileBottomSheet from '@/components/pos/mobile/MobileBottomSheet';
import PosInvoicePanel, { PosInvoiceSaveActions } from '@/components/pos/PosInvoicePanel';
import type { Barber, CartItem, PaymentMethod, SaleState, SaleTotals } from '@/lib/types';

interface MobileInvoiceSheetProps {
  open: boolean;
  onClose: () => void;
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
  onDiscountPercentChange?: (v: number) => void;
  onDiscountValueChange?: (v: number) => void;
  onPaymentMethodSelect: (id: number) => void;
  onPaymentAllocationsChange: (allocations: SaleState['paymentAllocations']) => void;
  onSave: (forcePrint?: boolean, source?: string) => void;
  legacyHeaderDiscountWarning?: boolean;
  legacyHeaderDiscountValue?: number;
}

export default function MobileInvoiceSheet({
  open,
  onClose,
  ...panelProps
}: MobileInvoiceSheetProps) {
  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="الفاتورة"
      footer={
        <PosInvoiceSaveActions
          saving={panelProps.saving}
          disabled={panelProps.state.items.length === 0}
          onSave={panelProps.onSave}
        />
      }
    >
      <PosInvoicePanel {...panelProps} showKeyboardHints={false} />
    </MobileBottomSheet>
  );
}
