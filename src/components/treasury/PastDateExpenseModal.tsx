'use client';

import { useState, useEffect } from 'react';
import { X, TrendingDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface ExpenseCategory {
  ExpINID: number;
  CatName: string;
}

interface PaymentMethod {
  PaymentID: number;
  PaymentMethod: string;
}

interface PastDateExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseComplete: () => void;
  defaultDate?: string;
}

export default function PastDateExpenseModal({
  isOpen,
  onClose,
  onExpenseComplete,
  defaultDate
}: PastDateExpenseModalProps) {
  const [expenseDate, setExpenseDate] = useState('');
  const [expenseTime, setExpenseTime] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load expense categories and payment methods on mount
  useEffect(() => {
    if (isOpen) {
      loadData();
      // Set default date from props or yesterday
      const defaultDateToUse = defaultDate || (() => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      })();
      setExpenseDate(defaultDateToUse);
      // Set default time to current time
      const now = new Date();
      setExpenseTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
  }, [isOpen, defaultDate]);

  const loadData = async () => {
    try {
      // Load expense categories
      const response = await fetch('/api/expenses/categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(data || []);
      } else {
        // Fallback: try to get categories from a general endpoint
        const fallbackResponse = await fetch('/api/incomes/meta');
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          // Filter only expense categories
          const expenseCategories = fallbackData.categories?.filter((cat: { ExpINType: string }) =>
            cat.ExpINType === 'مصروفات'
          ) || [];
          setCategories(expenseCategories);
        }
      }

      // Load payment methods
      const pmResponse = await fetch('/api/incomes/meta');
      if (pmResponse.ok) {
        const pmData = await pmResponse.json();
        setPaymentMethods(pmData.paymentMethods || []);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!expenseDate || !amount || !categoryId || !paymentMethodId) {
      setError('جميع الحقول المطلوبة يجب ملؤها');
      return;
    }

    const expenseAmount = parseFloat(amount);
    if (isNaN(expenseAmount) || expenseAmount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }

    // Validate that date is not in the future
    const inputDate = new Date(expenseDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (inputDate > today) {
      setError('لا يمكن إضافة مصروف لتاريخ في المستقبل');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/expenses/past-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invDate: expenseDate,
          invTime: expenseTime || '12:00',
          amount: expenseAmount,
          expINID: parseInt(categoryId),
          paymentMethodId: parseInt(paymentMethodId),
          notes: notes || 'مصروف إضافي'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل إضافة المصروف');
      }

      const result = await response.json();
      console.log('Expense added:', result);

      onExpenseComplete();
      onClose();
      // Reset form
      setExpenseDate('');
      setExpenseTime('');
      setAmount('');
      setCategoryId('');
      setPaymentMethodId('');
      setNotes('');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إضافة المصروف');
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
            <div className="p-2 bg-rose-500/15 rounded-lg">
              <TrendingDown className="h-5 w-5 text-rose-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">اضافه مصروف في يوم سابق</h2>
              <p className="text-sm text-zinc-400">إضافة مصروف لتاريخ سابق</p>
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
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white"
              required
            />
          </div>

          {/* Time */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              الوقت
            </label>
            <Input
              type="time"
              value={expenseTime}
              onChange={(e) => setExpenseTime(e.target.value)}
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
              placeholder="ملاحظات المصروف"
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
              className="flex-1 bg-rose-500 hover:bg-rose-600 text-black font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  جاري الإضافة...
                </>
              ) : (
                'إضافة المصروف'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
