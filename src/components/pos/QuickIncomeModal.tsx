'use client';

import PastDateIncomeModal from '@/components/treasury/PastDateIncomeModal';
import { getCairoBusinessDate } from '@/lib/businessDate';

export interface QuickIncomeCompleteInfo {
  advanceWhatsApp?: boolean;
  ledgerDualWrite?: boolean;
}

interface QuickIncomeModalProps {
  open: boolean;
  onClose: () => void;
  onIncomeComplete?: (info?: QuickIncomeCompleteInfo) => void;
}

export default function QuickIncomeModal({
  open,
  onClose,
  onIncomeComplete,
}: QuickIncomeModalProps) {
  // Business date (before 04:00 Cairo stays previous day), not calendar midnight.
  const defaultDate = open ? getCairoBusinessDate() : undefined;

  return (
    <PastDateIncomeModal
      isOpen={open}
      onClose={onClose}
      onIncomeComplete={onIncomeComplete ?? onClose}
      defaultDate={defaultDate}
      title="إضافة إيراد فوري"
      subtitle="تسجيل إيراد لليوم الحالي"
      entryDateReadOnly
      attachToOpenDay
    />
  );
}
