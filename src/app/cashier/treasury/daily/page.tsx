'use client';

import TreasuryDailyView from '@/components/treasury/TreasuryDailyView';

export default function CashierTreasuryDailyPage() {
  return (
    <TreasuryDailyView
      canCloseDay={false}
      canTransfer={false}
      canAddPastRevenue={false}
      canAddPastExpense={false}
      canDeleteMove={false}
      pageTitle="الخزنة اليومية"
      pageSubtitle="عرض الحركات المالية لليوم — قراءة فقط"
    />
  );
}
