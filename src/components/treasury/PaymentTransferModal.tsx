'use client';

import { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Loader2, Wallet } from 'lucide-react';

interface PaymentMethod {
  ID: number;
  Name: string;
}

interface PaymentTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PaymentTransferModal({ isOpen, onClose, onSuccess }: PaymentTransferModalProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [fromMethodId, setFromMethodId] = useState<number | ''>('');
  const [toMethodId, setToMethodId] = useState<number | ''>('');
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchingMethods, setFetchingMethods] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load payment methods when modal opens
  useEffect(() => {
    if (isOpen) {
      loadPaymentMethods();
      // Reset form
      setFromMethodId('');
      setToMethodId('');
      setAmount('');
      setNotes('');
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  const loadPaymentMethods = async () => {
    setFetchingMethods(true);
    try {
      const response = await fetch('/api/payment-methods');
      if (response.ok) {
        const data = await response.json();
        setPaymentMethods(data);
      }
    } catch (err) {
      console.error('Failed to load payment methods:', err);
    } finally {
      setFetchingMethods(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validation
    if (!fromMethodId) {
      setError('يجب اختيار طريقة الدفع المصدر (من)');
      return;
    }
    if (!toMethodId) {
      setError('يجب اختيار طريقة الدفع الهدف (إلى)');
      return;
    }
    if (fromMethodId === toMethodId) {
      setError('لا يمكن التحويل لنفس طريقة الدفع');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError('يجب إدخال مبلغ صحيح أكبر من صفر');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/treasury/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          fromPaymentMethodId: fromMethodId,
          toPaymentMethodId: toMethodId,
          notes: notes.trim() || undefined
        })
      });

      const data = await response.json();
      const resetForm = () => { setFromMethodId(''); setToMethodId(''); setAmount(''); setNotes(''); };

      if (!response.ok || !data.success) {
        setError(data.error || 'فشل تنفيذ التحويل');
        return;
      }

      setSuccess('تم التحويل بنجاح');
      resetForm();
      setTimeout(() => { onSuccess?.(); }, 1200);
    } catch (err) {
      setError('حدث خطأ أثناء تنفيذ التحويل');
    } finally {
      setLoading(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const fromMethod = paymentMethods.find(m => m.ID === fromMethodId);
  const toMethod = paymentMethods.find(m => m.ID === toMethodId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-gradient-to-r from-amber-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <ArrowRightLeft className="h-5 w-5 text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-white">تحويل بين طرق الدفع</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Error Message */}
          {error && (
            <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3">
              <p className="text-rose-400 text-sm">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3">
              <p className="text-emerald-400 text-sm">{success}</p>
            </div>
          )}

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              المبلغ <span className="text-amber-500">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="أدخل المبلغ"
                min="0.01"
                step="0.01"
                disabled={loading}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors text-right"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">ج.م</span>
            </div>
          </div>

          {/* From Payment Method */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              تحويل من <span className="text-amber-500">*</span>
            </label>
            <div className="relative">
              <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <select
                value={fromMethodId || ''}
                onChange={(e) => setFromMethodId(e.target.value ? Number(e.target.value) : '')}
                disabled={loading || fetchingMethods}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl pr-10 pl-4 py-3 text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">اختر طريقة الدفع</option>
                {paymentMethods.map((method) => (
                  <option key={method.ID} value={method.ID}>
                    {method.Name}
                  </option>
                ))}
              </select>
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Arrow Icon */}
          <div className="flex justify-center">
            <div className="p-2 bg-zinc-800 rounded-full">
              <ArrowRightLeft className="h-4 w-4 text-amber-400" />
            </div>
          </div>

          {/* To Payment Method */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              تحويل إلى <span className="text-amber-500">*</span>
            </label>
            <div className="relative">
              <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <select
                value={toMethodId || ''}
                onChange={(e) => setToMethodId(e.target.value ? Number(e.target.value) : '')}
                disabled={loading || fetchingMethods}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl pr-10 pl-4 py-3 text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">اختر طريقة الدفع</option>
                {paymentMethods.map((method) => (
                  <option key={method.ID} value={method.ID}>
                    {method.Name}
                  </option>
                ))}
              </select>
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Summary */}
          {fromMethod && toMethod && amount && Number(amount) > 0 && (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3">
              <p className="text-xs text-zinc-400 mb-1">ملخص التحويل:</p>
              <p className="text-sm text-white">
                سيتم خصم <span className="text-rose-400 font-medium">{Number(amount).toFixed(2)} ج.م</span> من{' '}
                <span className="text-zinc-300">{fromMethod.Name}</span>
              </p>
              <p className="text-sm text-white mt-1">
                وإضافتها كـ <span className="text-emerald-400 font-medium">{Number(amount).toFixed(2)} ج.م</span> إلى{' '}
                <span className="text-zinc-300">{toMethod.Name}</span>
              </p>
            </div>
          )}

          {/* Notes Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              ملاحظات (اختياري)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف ملاحظات للتحويل..."
              rows={2}
              disabled={loading}
              className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors resize-none"
            />
          </div>

          {/* Submit Button */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-medium hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading || !amount || !fromMethodId || !toMethodId}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-black rounded-xl font-medium hover:from-amber-400 hover:to-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التحويل...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4" />
                  تنفيذ التحويل
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
