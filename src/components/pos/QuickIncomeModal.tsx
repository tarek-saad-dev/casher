'use client';

import PastDateIncomeModal from '@/components/treasury/PastDateIncomeModal';

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
  const defaultDate = open
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    : undefined;

  return (
    <PastDateIncomeModal
      isOpen={open}
      onClose={onClose}
      onIncomeComplete={onIncomeComplete ?? onClose}
      defaultDate={defaultDate}
      title="إضافة إيراد فوري"
      subtitle="تسجيل إيراد لليوم الحالي"
      entryDateReadOnly
    />
  );
}
