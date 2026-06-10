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
    />
  );
}

