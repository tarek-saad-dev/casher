'use client';

import PastDateTransferModal from '@/components/treasury/PastDateTransferModal';
import { getCairoBusinessDate } from '@/lib/businessDate';

interface PaymentTransferModalProps {
  open: boolean;
  onClose: () => void;
  onTransferComplete?: () => void;
}

export default function PaymentTransferModal({
  open,
  onClose,
  onTransferComplete,
}: PaymentTransferModalProps) {
  // Business date (before 04:00 Cairo stays previous day), not calendar midnight.
  const defaultDate = open ? getCairoBusinessDate() : undefined;

  return (
    <PastDateTransferModal
      isOpen={open}
      onClose={onClose}
      onTransferComplete={onTransferComplete ?? onClose}
      defaultDate={defaultDate}
      title="تحويل بين طرق الدفع"
      subtitle="الفلوس بتطلع من طريقة وتتضاف لأخرى"
      transferDateReadOnly
      attachToOpenDay
    />
  );
}
