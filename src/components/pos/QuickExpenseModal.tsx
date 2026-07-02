'use client';

import PastDateExpenseModal from '@/components/treasury/PastDateExpenseModal';

interface QuickExpenseModalProps {
  open: boolean;
  onClose: () => void;
  onExpenseComplete?: () => void;
}

export default function QuickExpenseModal({
  open,
  onClose,
  onExpenseComplete,
}: QuickExpenseModalProps) {
  const defaultDate = open
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    : undefined;

  return (
    <PastDateExpenseModal
      isOpen={open}
      onClose={onClose}
      onExpenseComplete={onExpenseComplete ?? onClose}
      defaultDate={defaultDate}
      title="إضافة مصروف فوري"
      subtitle="تسجيل مصروف لليوم الحالي"
      entryDateReadOnly
    />
  );
}
