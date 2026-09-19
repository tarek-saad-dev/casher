'use client';

import TreasuryDailyView from '@/components/treasury/TreasuryDailyView';
import { useSession } from '@/hooks/useSession';

export default function CashierTreasuryDailyPage() {
  const { shift } = useSession();

  return (
    <TreasuryDailyView
      canCloseDay={false}
      canCloseShift={true}
      defaultShiftMoveId={shift?.ID ?? null}
      canTransfer={false}
      canAddPastRevenue={false}
      canAddPastExpense={false}
      canDeleteMove={false}
      pageTitle="الخزنة اليومية"
      pageSubtitle="عرض الحركات المالية لليوم وتقفيل الوردية"
    />
  );
}
