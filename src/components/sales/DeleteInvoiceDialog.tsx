'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { deleteSalesInvoice } from '@/lib/deleteSalesInvoice';

export interface DeleteInvoiceTarget {
  invId: number;
  invNo?: number;
}

interface DeleteInvoiceDialogProps {
  target: DeleteInvoiceTarget | null;
  onClose: () => void;
  onSuccess: (invId: number) => void;
}

/**
 * Shared delete-invoice confirmation dialog.
 * Shows invoice number, irreversible warning, required reason textarea,
 * inline error, loading state, cancel and confirm buttons.
 *
 * Usage:
 *   const [deleteTarget, setDeleteTarget] = useState<DeleteInvoiceTarget | null>(null);
 *   <DeleteInvoiceDialog
 *     target={deleteTarget}
 *     onClose={() => setDeleteTarget(null)}
 *     onSuccess={(invId) => { setDeleteTarget(null); refresh(); }}
 *   />
 */
export default function DeleteInvoiceDialog({
  target,
  onClose,
  onSuccess,
}: DeleteInvoiceDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!target) return null;

  const displayNo = target.invNo ?? target.invId;

  const handleClose = () => {
    if (deleting) return;
    setReason('');
    setError('');
    onClose();
  };

  const handleConfirm = async () => {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setError('سبب مسح فاتورة المبيعات مطلوب');
      return;
    }

    setDeleting(true);
    setError('');
    try {
      await deleteSalesInvoice(target.invId, normalizedReason);
      setReason('');
      setError('');
      onSuccess(target.invId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      dir="rtl"
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative bg-surface border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-destructive/20 rounded-full">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="text-lg font-bold text-foreground">تأكيد المسح</h3>
        </div>

        {/* Invoice info */}
        <p className="text-muted-foreground mb-1">
          هل أنت متأكد من مسح الفاتورة{' '}
          <span className="text-foreground font-bold">#{displayNo}</span>؟
        </p>
        <p className="text-destructive text-sm mb-5">
          هذا الإجراء لا يمكن التراجع عنه.
        </p>

        {/* Reason field */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            سبب مسح الفاتورة <span className="text-destructive">*</span>
          </label>
          <textarea
            className="w-full bg-surface-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            rows={3}
            placeholder="اكتب سبب مسح الفاتورة..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError('');
            }}
            disabled={deleting}
          />
          {error && (
            <p className="text-xs text-destructive mt-1.5">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={deleting}
            className="flex-1 px-4 py-2 bg-surface-muted hover:bg-surface-muted/80 text-foreground/80 rounded-xl transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting || !reason.trim()}
            className="flex-1 px-4 py-2 bg-destructive/20 hover:bg-destructive/30 text-destructive border border-destructive/30 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري المسح...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                مسح الفاتورة
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
