'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { HandCoins, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ExpensePaymentMethodPicker from '@/components/expenses/ExpensePaymentMethodPicker';
import { cn } from '@/lib/utils';
import { calculateTipAmount, resolveTipBarberCandidates } from '@/lib/pos/tipMath';
import type { CartItem, PaymentMethod } from '@/lib/types';

export interface TipsCompleteInfo {
  employeeName: string;
  tipAmount: number;
  ledgerDualWrite?: boolean;
  tipWhatsApp?: boolean;
}

interface TipsModalProps {
  open: boolean;
  onClose: () => void;
  invoiceTotal: number;
  items: CartItem[];
  paymentMethods: PaymentMethod[];
  defaultPaymentMethodId?: number | null;
  onTipComplete?: (info: TipsCompleteInfo) => void;
}

function getCairoDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function sanitizeAmountInput(value: string): string {
  let sanitized = value.replace(/[^\d.,]/g, '');
  sanitized = sanitized.replace(/,/g, '.');
  const parts = sanitized.split('.');
  if (parts.length > 2) {
    sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
  }
  return sanitized;
}

function findCashPaymentMethodId(methods: PaymentMethod[]): number | null {
  const cash = methods.find((m) => {
    const name = m.Name.trim().toLowerCase();
    return name.includes('كاش') || name.includes('نقد') || name.includes('cash');
  });
  return cash?.ID ?? methods[0]?.ID ?? null;
}

export default function TipsModal({
  open,
  onClose,
  invoiceTotal,
  items,
  paymentMethods,
  defaultPaymentMethodId,
  onTipComplete,
}: TipsModalProps) {
  const [amountPaidInput, setAmountPaidInput] = useState('');
  const [empId, setEmpId] = useState<number | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const barbers = useMemo(() => resolveTipBarberCandidates(items), [items]);
  const amountPaid = parseAmount(amountPaidInput);
  const tipAmount =
    amountPaid != null ? calculateTipAmount(amountPaid, invoiceTotal) : null;

  useEffect(() => {
    if (!open) return;

    setAmountPaidInput('');
    setError(null);
    setSubmitting(false);
    setEmpId(barbers[0]?.empId ?? null);

    const preferred =
      (defaultPaymentMethodId &&
        paymentMethods.some((m) => m.ID === defaultPaymentMethodId) &&
        defaultPaymentMethodId) ||
      findCashPaymentMethodId(paymentMethods);
    setPaymentMethodId(preferred);
  }, [open, barbers, paymentMethods, defaultPaymentMethodId]);

  const canSubmit =
    !submitting &&
    items.length > 0 &&
    empId != null &&
    paymentMethodId != null &&
    amountPaid != null &&
    tipAmount != null &&
    tipAmount > 0;

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSubmit || empId == null || paymentMethodId == null || amountPaid == null) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const response = await fetch('/api/pos/tips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empId,
            invoiceTotal,
            amountPaid,
            paymentMethodId,
            date: getCairoDateString(),
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data.error === 'string' ? data.error : 'فشل تسجيل التبس',
          );
        }

        onTipComplete?.({
          employeeName: String(data.employeeName ?? ''),
          tipAmount: Number(data.tipAmount ?? tipAmount),
          ledgerDualWrite: Boolean(data.ledgerDualWrite),
          tipWhatsApp: Boolean(data.tipWhatsApp),
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'فشل تسجيل التبس');
      } finally {
        setSubmitting(false);
      }
    },
    [
      canSubmit,
      empId,
      paymentMethodId,
      amountPaid,
      invoiceTotal,
      tipAmount,
      onTipComplete,
      onClose,
    ],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tips-modal-title"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-primary" aria-hidden />
            <div>
              <h2 id="tips-modal-title" className="text-base font-semibold text-foreground">
                تبس
              </h2>
              <p className="text-xs text-muted-foreground">
                أدخل المبلغ اللي دفعه العميل — الفرق يتسجل إيداع للحلاق
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-4 overflow-y-auto px-4 py-4">
            {items.length === 0 ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-warning">
                أضف خدمات للفاتورة أولاً عشان نعرف إجمالي الفاتورة والحلاق.
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">إجمالي الفاتورة</span>
                    <span className="font-semibold tabular-nums">
                      {invoiceTotal.toFixed(2)} ج.م
                    </span>
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    العميل دفع كام؟
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={amountPaidInput}
                    onChange={(e) => setAmountPaidInput(sanitizeAmountInput(e.target.value))}
                    placeholder="مثال: 250"
                    className={cn(
                      'h-11 w-full rounded-lg border border-border bg-surface px-3 text-base tabular-nums',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    )}
                  />
                </label>

                <div
                  className={cn(
                    'rounded-xl border px-3 py-3',
                    tipAmount != null && tipAmount > 0
                      ? 'border-success/40 bg-success/10'
                      : 'border-border bg-muted/30',
                  )}
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">مبلغ التبس (الفرق)</span>
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        tipAmount != null && tipAmount > 0
                          ? 'text-success'
                          : tipAmount != null && tipAmount < 0
                            ? 'text-destructive'
                            : 'text-foreground',
                      )}
                    >
                      {tipAmount == null
                        ? '—'
                        : tipAmount > 0
                          ? `${tipAmount.toFixed(2)} ج.م`
                          : tipAmount < 0
                            ? 'المبلغ أقل من الفاتورة'
                            : 'لا يوجد تبس'}
                    </span>
                  </div>
                </div>

                {barbers.length > 1 ? (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-foreground">
                      إيداع التبس للحلاق
                    </span>
                    <select
                      value={empId ?? ''}
                      onChange={(e) => setEmpId(Number(e.target.value))}
                      className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                    >
                      {barbers.map((b) => (
                        <option key={b.empId} value={b.empId}>
                          {b.empName} ({b.lineTotal.toFixed(2)} ج.م)
                        </option>
                      ))}
                    </select>
                  </label>
                ) : barbers.length === 1 ? (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">الحلاق: </span>
                    <span className="font-medium">{barbers[0].empName}</span>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">طريقة استلام التبس</span>
                  <ExpensePaymentMethodPicker
                    methods={paymentMethods}
                    selectedId={paymentMethodId}
                    onSelect={setPaymentMethodId}
                  />
                </div>
              </>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <footer className="flex gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleClose}
              disabled={submitting}
            >
              إلغاء
            </Button>
            <Button type="submit" className="flex-1 gap-2" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التسجيل...
                </>
              ) : (
                'تسجيل التبس'
              )}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
