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
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-rose-500/20 rounded-full">
            <AlertTriangle className="h-6 w-6 text-rose-400" />
          </div>
          <h3 className="text-lg font-bold text-white">تأكيد المسح</h3>
        </div>

        {/* Invoice info */}
        <p className="text-zinc-400 mb-1">
          هل أنت متأكد من مسح الفاتورة{' '}
          <span className="text-white font-bold">#{displayNo}</span>؟
        </p>
        <p className="text-rose-400 text-sm mb-5">
          هذا الإجراء لا يمكن التراجع عنه.
        </p>

        {/* Reason field */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            سبب مسح الفاتورة <span className="text-rose-400">*</span>
          </label>
          <textarea
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
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
            <p className="text-xs text-rose-400 mt-1.5">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={deleting}
            className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting || !reason.trim()}
            className="flex-1 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
