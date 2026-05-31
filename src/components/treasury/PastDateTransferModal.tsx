'use client';

import { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface PaymentMethod {
  PaymentID: number;
  PaymentMethod: string;
}

interface PastDateTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransferComplete: () => void;
  defaultDate?: string;
}

export default function PastDateTransferModal({
  isOpen,
  onClose,
  onTransferComplete,
  defaultDate
}: PastDateTransferModalProps) {
  const [transferDate, setTransferDate] = useState('');
  const [amount, setAmount] = useState('');
  const [fromPaymentMethod, setFromPaymentMethod] = useState('');
  const [toPaymentMethod, setToPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load payment methods on mount
  useEffect(() => {
    if (isOpen) {
      loadPaymentMethods();
      // Set default date from props or yesterday
      const defaultDateToUse = defaultDate || (() => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      })();
      setTransferDate(defaultDateToUse);
    }
  }, [isOpen, defaultDate]);

  const loadPaymentMethods = async () => {
    try {
      const response = await fetch('/api/incomes/meta');
      if (response.ok) {
        const data = await response.json();
        setPaymentMethods(data.paymentMethods || []);
      }
    } catch (err) {
      console.error('Failed to load payment methods:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!transferDate || !amount || !fromPaymentMethod || !toPaymentMethod) {
      setError('جميع الحقول مطلوبة');
      return;
    }

    if (fromPaymentMethod === toPaymentMethod) {
      setError('يجب اختيار طرق دفع مختلفة');
      return;
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }

    // Validate that date is not in the future
    const inputDate = new Date(transferDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (inputDate > today) {
      setError('لا يمكن التحويل لتاريخ في المستقبل');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Use the dedicated transfer API endpoint
      const response = await fetch('/api/treasury/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferDate,
          amount: transferAmount,
          fromPaymentMethodId: parseInt(fromPaymentMethod),
          toPaymentMethodId: parseInt(toPaymentMethod),
          notes: notes || 'تحويل بين طرق الدفع'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل التحويل');
      }

      const result = await response.json();
      console.log('Transfer completed:', result);

      onTransferComplete();
      onClose();
      // Reset form
      setTransferDate('');
      setAmount('');
      setFromPaymentMethod('');
      setToPaymentMethod('');
      setNotes('');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحويل');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setError('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/15 rounded-lg">
              <ArrowRightLeft className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">تحويل في يوم سابق</h2>
              <p className="text-sm text-zinc-400">تحويل مبلغ بين طرق دفع مختلفة</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Transfer Date */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              تاريخ التحويل
            </label>
            <Input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white"
              required
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              المبلغ
            </label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="bg-zinc-800 border-zinc-700 text-white"
              required
            />
          </div>

          {/* From Payment Method */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              من طريقة الدفع
            </label>
            <Select value={fromPaymentMethod} onValueChange={setFromPaymentMethod} required>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                <SelectValue placeholder="اختر طريقة الدفع" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {paymentMethods.map((pm) => (
                  <SelectItem key={pm.PaymentID} value={pm.PaymentID.toString()} className="text-white">
                    {pm.PaymentMethod}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* To Payment Method */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              إلى طريقة الدفع
            </label>
            <Select value={toPaymentMethod} onValueChange={setToPaymentMethod} required>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                <SelectValue placeholder="اختر طريقة الدفع" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {paymentMethods.map((pm) => (
                  <SelectItem key={pm.PaymentID} value={pm.PaymentID.toString()} className="text-white">
                    {pm.PaymentMethod}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              ملاحظات (اختياري)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات التحويل"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg">
              <p className="text-rose-400 text-sm">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  جاري التحويل...
                </>
              ) : (
                'تنفيذ التحويل'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
