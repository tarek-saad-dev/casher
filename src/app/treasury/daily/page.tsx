'use client';

import TreasuryDailyView from '@/components/treasury/TreasuryDailyView';

export default function DailyTreasuryPage() {
  return (
    <TreasuryDailyView
      canCloseDay
      canTransfer
      canAddPastRevenue
      canAddPastExpense
      canDeleteMove
      pageTitle="الخزنة"
      pageSubtitle="متابعة الحركات المالية ورصيد الخزنة"
    />
  );
}

