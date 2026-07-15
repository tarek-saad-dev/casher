'use client';

import { useState, useEffect } from 'react';
import {
  X, ArrowRightLeft, Loader2, ArrowDownLeft, ArrowUpRight, Repeat2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface PaymentMethod {
  PaymentID: number;
  PaymentMethod: string;
}

interface PastDateTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransferComplete: () => void;
  defaultDate?: string;
  title?: string;
  subtitle?: string;
  transferDateReadOnly?: boolean;
}

function formatAmount(value: string): string {
  const n = parseFloat(value);
  if (!value || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function PastDateTransferModal({
  isOpen,
  onClose,
  onTransferComplete,
  defaultDate,
  title = 'تحويل في يوم سابق',
  subtitle = 'تحويل مبلغ بين طرق دفع مختلفة',
  transferDateReadOnly = false,
}: PastDateTransferModalProps) {
  const [transferDate, setTransferDate] = useState('');
  const [amount, setAmount] = useState('');
  const [fromPaymentMethod, setFromPaymentMethod] = useState('');
  const [toPaymentMethod, setToPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadPaymentMethods();
      const defaultDateToUse = defaultDate || (() => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      })();
      setTransferDate(defaultDateToUse);
      setAmount('');
      setFromPaymentMethod('');
      setToPaymentMethod('');
      setNotes('');
      setError('');
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

  const fromName =
    paymentMethods.find(pm => String(pm.PaymentID) === fromPaymentMethod)?.PaymentMethod ?? null;
  const toName =
    paymentMethods.find(pm => String(pm.PaymentID) === toPaymentMethod)?.PaymentMethod ?? null;

  const amountNum = parseFloat(amount);
  const hasValidAmount = !Number.isNaN(amountNum) && amountNum > 0;
  const canPreview = Boolean(fromName && toName && fromPaymentMethod !== toPaymentMethod);

  const handleSwap = () => {
    setFromPaymentMethod(toPaymentMethod);
    setToPaymentMethod(fromPaymentMethod);
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

    const inputDate = new Date(transferDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (inputDate > today) {
      setError('لا يمكن التحويل لتاريخ في المستقبل');
      return;
    }

    setLoading(true);
    setError('');

    const resetForm = () => {
      setTransferDate('');
      setAmount('');
      setFromPaymentMethod('');
      setToPaymentMethod('');
      setNotes('');
    };

    try {
      const response = await fetch('/api/treasury/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferDate,
          amount: transferAmount,
          fromPaymentMethodId: parseInt(fromPaymentMethod),
          toPaymentMethodId: parseInt(toPaymentMethod),
          notes: notes || 'تحويل بين طرق الدفع',
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'فشل التحويل');
      }

      onTransferComplete();
      onClose();
      resetForm();
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2.5">
              <ArrowRightLeft className="h-5 w-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-foreground">{title}</h2>
              <p className="text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label="إغلاق"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Amount */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground/80">
              المبلغ
            </label>
            <div className="relative">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-12 bg-surface-muted border-border text-lg font-semibold text-foreground"
                required
              />
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ج.م
              </span>
            </div>
          </div>

          {/* From / To */}
          <div className="relative grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
            {/* FROM — money out */}
            <div className="rounded-xl border-2 border-rose-500/40 bg-rose-500/10 p-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 text-rose-400">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-400">
                    خصم من
                  </p>
                  <p className="text-[11px] text-rose-300/70">الفلوس هتطلع من هنا</p>
                </div>
              </div>
              <Select
                value={fromPaymentMethod || undefined}
                onValueChange={(v) => setFromPaymentMethod(v ?? '')}
                required
              >
                <SelectTrigger className="border-rose-500/30 bg-rose-950/40 text-foreground hover:bg-rose-950/55">
                  <SelectValue placeholder="اختَر المصدر" />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  {paymentMethods
                    .filter(pm => String(pm.PaymentID) !== toPaymentMethod)
                    .map((pm) => (
                      <SelectItem
                        key={pm.PaymentID}
                        value={pm.PaymentID.toString()}
                        className="text-foreground"
                      >
                        {pm.PaymentMethod}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {fromName && (
                <p className="mt-2 truncate text-sm font-semibold text-rose-300">
                  − {hasValidAmount ? formatAmount(amount) : '…'} ج.م
                </p>
              )}
            </div>

            {/* Swap */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={handleSwap}
                disabled={!fromPaymentMethod && !toPaymentMethod}
                title="تبديل الاتجاه"
                aria-label="تبديل الاتجاه"
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border border-border',
                  'bg-surface-muted text-muted-foreground transition-colors',
                  'hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-400',
                  'disabled:opacity-40',
                )}
              >
                <Repeat2 className="h-4 w-4" />
              </button>
            </div>

            {/* TO — money in */}
            <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 p-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <ArrowDownLeft className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-400">
                    إضافة إلى
                  </p>
                  <p className="text-[11px] text-emerald-300/70">الفلوس هتتضاف هنا</p>
                </div>
              </div>
              <Select
                value={toPaymentMethod || undefined}
                onValueChange={(v) => setToPaymentMethod(v ?? '')}
                required
              >
                <SelectTrigger className="border-emerald-500/30 bg-emerald-950/40 text-foreground hover:bg-emerald-950/55">
                  <SelectValue placeholder="اختَر الوجهة" />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  {paymentMethods
                    .filter(pm => String(pm.PaymentID) !== fromPaymentMethod)
                    .map((pm) => (
                      <SelectItem
                        key={pm.PaymentID}
                        value={pm.PaymentID.toString()}
                        className="text-foreground"
                      >
                        {pm.PaymentMethod}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {toName && (
                <p className="mt-2 truncate text-sm font-semibold text-emerald-300">
                  + {hasValidAmount ? formatAmount(amount) : '…'} ج.م
                </p>
              )}
            </div>
          </div>

          {/* Live preview */}
          <div
            className={cn(
              'rounded-xl border px-4 py-3 text-sm transition-colors',
              canPreview
                ? 'border-amber-500/30 bg-amber-500/10 text-foreground'
                : 'border-border/60 bg-surface-muted/50 text-muted-foreground',
            )}
          >
            {canPreview ? (
              <p className="leading-relaxed">
                <span className="font-medium text-rose-300">هيطلع </span>
                <span className="font-bold text-rose-200">
                  {hasValidAmount ? `${formatAmount(amount)} ج.م` : 'المبلغ'}
                </span>
                <span className="font-medium text-rose-300"> من </span>
                <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-200">
                  {fromName}
                </span>
                <span className="mx-1.5 text-muted-foreground">←</span>
                <span className="font-medium text-emerald-300">ويتضاف لـ </span>
                <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 font-bold text-emerald-200">
                  {toName}
                </span>
              </p>
            ) : (
              <p>اختَر المصدر والوجهة عشان تشوف ملخص التحويل</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground/80">
              تاريخ التحويل
            </label>
            <Input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              readOnly={transferDateReadOnly}
              disabled={transferDateReadOnly}
              className="bg-surface-muted border-border text-foreground disabled:cursor-not-allowed disabled:opacity-80"
              required
            />
            {transferDateReadOnly && (
              <p className="mt-1.5 text-xs text-muted-foreground/70">
                تاريخ اليوم الحالي — غير قابل للتعديل من نقطة البيع
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground/80">
              ملاحظات <span className="font-normal text-muted-foreground">(اختياري)</span>
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="سبب التحويل…"
              className="bg-surface-muted border-border text-foreground"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 border-border text-foreground/80 hover:bg-surface-muted"
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={loading || !canPreview || !hasValidAmount}
              className="flex-1 bg-primary font-medium text-primary-foreground hover:bg-primary-hover"
            >
              {loading ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  جاري التحويل...
                </>
              ) : canPreview && hasValidAmount ? (
                `حوّل ${formatAmount(amount)} ج.م`
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
