'use client';

import PastDateTransferModal from '@/components/treasury/PastDateTransferModal';

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
  const defaultDate = open
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    : undefined;

  return (
    <PastDateTransferModal
      isOpen={open}
      onClose={onClose}
      onTransferComplete={onTransferComplete ?? onClose}
      defaultDate={defaultDate}
      title="تحويل بين طرق الدفع"
      subtitle="الفلوس بتطلع من طريقة وتتضاف لأخرى"
      transferDateReadOnly
    />
  );
}
