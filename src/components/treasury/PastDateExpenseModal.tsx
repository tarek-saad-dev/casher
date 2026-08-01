'use client';

import QuickExpenseModal from '@/components/pos/QuickExpenseModal';

interface PastDateExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseComplete: () => void;
  defaultDate?: string;
  title?: string;
  subtitle?: string;
  entryDateReadOnly?: boolean;
}

/**
 * Treasury / period-summary expense modal — same UI as POS QuickExpenseModal,
 * with the row/filter date locked when provided.
 */
export default function PastDateExpenseModal({
  isOpen,
  onClose,
  onExpenseComplete,
  defaultDate,
  title = 'إضافة مصروف',
  subtitle = 'إضافة مصروف لتاريخ محدد',
  entryDateReadOnly = true,
}: PastDateExpenseModalProps) {
  return (
    <QuickExpenseModal
      open={isOpen}
      onClose={onClose}
      onExpenseComplete={() => onExpenseComplete()}
      defaultDate={defaultDate}
      entryDateReadOnly={entryDateReadOnly && Boolean(defaultDate)}
      title={title}
      subtitle={subtitle}
    />
  );
}
