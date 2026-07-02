'use client';

import MobileBottomSheet from '@/components/pos/mobile/MobileBottomSheet';
import RecentSalesSidebar from '@/components/pos/RecentSalesSidebar';

interface MobileRecentSalesSheetProps {
  open: boolean;
  onClose: () => void;
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number) => void;
  onRefresh?: () => void;
}

export default function MobileRecentSalesSheet({
  open,
  onClose,
  onEditSale,
  onDeleteSale,
  onRefresh,
}: MobileRecentSalesSheetProps) {
  return (
    <MobileBottomSheet open={open} onClose={onClose} title="آخر عمليات بيع">
      <RecentSalesSidebar
        onEditSale={(saleId) => {
          onEditSale?.(saleId);
          onClose();
        }}
        onDeleteSale={onDeleteSale}
        onRefresh={onRefresh}
      />
    </MobileBottomSheet>
  );
}
