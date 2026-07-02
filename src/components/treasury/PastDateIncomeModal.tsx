'use client';

import { useState, useEffect } from 'react';
import { X, TrendingUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface PaymentMethod {
  PaymentID: number;
  PaymentMethod: string;
}

interface IncomeCategory {
  ExpINID: number;
  CatName: string;
}

interface PastDateIncomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIncomeComplete: () => void;
  defaultDate?: string;
  title?: string;
  subtitle?: string;
  entryDateReadOnly?: boolean;
}

export default function PastDateIncomeModal({
  isOpen,
  onClose,
  onIncomeComplete,
  defaultDate,
  title = 'اضافه ايراد في يوم سابق',
  subtitle = 'إضافة إيراد لتاريخ سابق',
  entryDateReadOnly = false,
}: PastDateIncomeModalProps) {
  const [incomeDate, setIncomeDate] = useState('');
  const [incomeTime, setIncomeTime] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load payment methods and categories on mount
  useEffect(() => {
    if (isOpen) {
      loadData();
      // Set default date from props or yesterday
      const defaultDateToUse = defaultDate || (() => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      })();
      setIncomeDate(defaultDateToUse);
      // Set default time to current time
      const now = new Date();
      setIncomeTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
  }, [isOpen, defaultDate]);

  const loadData = async () => {
    try {
      // Load payment methods
      const pmResponse = await fetch('/api/incomes/meta');
      if (pmResponse.ok) {
        const pmData = await pmResponse.json();
        setPaymentMethods(pmData.paymentMethods || []);
      }

      // Load income categories
      const catResponse = await fetch('/api/incomes/meta');
      if (catResponse.ok) {
        const catData = await catResponse.json();
        setCategories(catData.categories || []);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!incomeDate || !amount || !categoryId || !paymentMethodId) {
      setError('جميع الحقول المطلوبة يجب ملؤها');
      return;
    }

    const incomeAmount = parseFloat(amount);
    if (isNaN(incomeAmount) || incomeAmount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }

    // Validate that date is not in the future
    const inputDate = new Date(incomeDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (inputDate > today) {
      setError('لا يمكن إضافة إيراد لتاريخ في المستقبل');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/incomes/past-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invDate: incomeDate,
          invTime: incomeTime || '12:00',
          amount: incomeAmount,
          expInId: parseInt(categoryId),
          paymentMethodId: parseInt(paymentMethodId),
          notes: notes || 'إيراد إضافي'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل إضافة الإيراد');
      }

      const result = await response.json();
      console.log('Income added:', result);

      onIncomeComplete();
      onClose();
      // Reset form
      setIncomeDate('');
      setIncomeTime('');
      setAmount('');
      setCategoryId('');
      setPaymentMethodId('');
      setNotes('');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إضافة الإيراد');
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
            <div className="p-2 bg-emerald-500/15 rounded-lg">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">{title}</h2>
              <p className="text-sm text-zinc-400">{subtitle}</p>
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
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              التاريخ
            </label>
            <Input
              type="date"
              value={incomeDate}
              onChange={(e) => setIncomeDate(e.target.value)}
              readOnly={entryDateReadOnly}
              disabled={entryDateReadOnly}
              className="bg-zinc-800 border-zinc-700 text-white disabled:cursor-not-allowed disabled:opacity-80"
              required
            />
            {entryDateReadOnly && (
              <p className="mt-1.5 text-xs text-zinc-500">تاريخ اليوم الحالي — غير قابل للتعديل من نقطة البيع</p>
            )}
          </div>

          {/* Time */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              الوقت
            </label>
            <Input
              type="time"
              value={incomeTime}
              onChange={(e) => setIncomeTime(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white"
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

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              التصنيف
            </label>
            <Select value={categoryId} onValueChange={setCategoryId} required>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                <SelectValue placeholder="اختر التصنيف" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {categories.map((cat) => (
                  <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()} className="text-white">
                    {cat.CatName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              طريقة الدفع
            </label>
            <Select value={paymentMethodId} onValueChange={setPaymentMethodId} required>
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
              placeholder="ملاحظات الإيراد"
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
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-black font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  جاري الإضافة...
                </>
              ) : (
                'إضافة الإيراد'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
