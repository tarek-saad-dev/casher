'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { CalendarDays, Clock3, Loader2, TrendingDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import ExpenseCategoryPicker, {
  type ExpenseCategoryOption,
} from '@/components/expenses/ExpenseCategoryPicker';
import ExpensePaymentMethodPicker from '@/components/expenses/ExpensePaymentMethodPicker';
import ExpenseReceiptPopup, {
  type ExpenseReceiptData,
} from '@/components/expenses/ExpenseReceiptPopup';
import type { PaymentMethod } from '@/lib/types';

interface QuickExpenseCompleteInfo {
  advanceWhatsApp?: boolean;
  ledgerDualWrite?: boolean;
}

interface QuickExpenseModalProps {
  open: boolean;
  onClose: () => void;
  onExpenseComplete?: (info?: QuickExpenseCompleteInfo) => void;
}

function getCairoDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Yesterday relative to a YYYY-MM-DD calendar day (Cairo date string). */
function getPreviousDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function getCurrentTimeValue(date = new Date()): string {
  const cairoTime = date.toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return cairoTime;
}

function formatDisplayDate(dateValue: string): string {
  const [year, month, day] = dateValue.split('-');
  if (!year || !month || !day) return dateValue;
  return `${month}/${day}/${year}`;
}

function formatDisplayTime(timeValue: string): string {
  const [hoursPart, minutesPart] = timeValue.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return timeValue;

  const period = hours >= 12 ? 'م' : 'ص';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getAmountValidationError(value: string): string | null {
  if (!value.trim()) return 'يجب إدخال المبلغ';
  const parsed = parseAmount(value);
  if (parsed === null) return 'المبلغ غير صالح';
  if (parsed <= 0) return 'المبلغ يجب أن يكون أكبر من صفر';
  return null;
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
  const cash = methods.find((method) => {
    const normalized = method.Name.trim().toLowerCase();
    return normalized === 'كاش' || normalized.includes('كاش') || normalized.includes('نقد') || normalized === 'cash';
  });
  return cash?.ID ?? null;
}

interface QuickExpenseFormState {
  expenseDate: string;
  expenseTime: string;
  amount: string;
  categoryId: number | null;
  paymentMethodId: number | null;
  notes: string;
}

const INITIAL_FORM_STATE: QuickExpenseFormState = {
  expenseDate: '',
  expenseTime: '',
  amount: '',
  categoryId: null,
  paymentMethodId: null,
  notes: '',
};

interface PastDateExpenseRecord {
  invID: number;
  invDate?: string;
  invTime?: string;
  Amount?: number;
  Notes?: string;
  CategoryName?: string;
}

function normalizeReceiptDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.includes('T') ? value.split('T')[0] : value;
}

function buildExpenseReceiptData(
  record: PastDateExpenseRecord,
  form: QuickExpenseFormState,
  currentAmount: number,
  categoryName: string,
  paymentMethodName: string | null,
  ledgerDualWrite?: boolean,
): ExpenseReceiptData {
  return {
    invID: record.invID,
    invDate: normalizeReceiptDate(record.invDate, form.expenseDate),
    invTime: record.invTime ?? form.expenseTime,
    CatName: record.CategoryName ?? categoryName,
    GrandTolal: Number(record.Amount ?? currentAmount),
    PaymentMethod: paymentMethodName,
    Notes: record.Notes ?? (form.notes.trim() || null),
    UserName: null,
    ledgerNote: ledgerDualWrite ? 'تم تسجيل السلفة في دفتر الموظف' : null,
  };
}

export default function QuickExpenseModal({
  open,
  onClose,
  onExpenseComplete,
}: QuickExpenseModalProps) {
  const amountInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const [form, setForm] = useState<QuickExpenseFormState>(INITIAL_FORM_STATE);
  const [categories, setCategories] = useState<ExpenseCategoryOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receiptExpense, setReceiptExpense] = useState<ExpenseReceiptData | null>(null);
  const [touched, setTouched] = useState({
    amount: false,
    category: false,
    payment: false,
  });
  const [allowedDateMin, setAllowedDateMin] = useState('');
  const [allowedDateMax, setAllowedDateMax] = useState('');

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setSubmitError(null);
    setTouched({ amount: false, category: false, payment: false });
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      const response = await fetch('/api/expenses/categories');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'تعذر تحميل تصنيفات المصروف');
      }
      const data: ExpenseCategoryOption[] = await response.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (error) {
      setCategories([]);
      setCategoriesError(
        error instanceof Error ? error.message : 'تعذر تحميل تصنيفات المصروف',
      );
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  const loadPaymentMethods = useCallback(async () => {
    setPaymentMethodsLoading(true);
    setPaymentMethodsError(null);
    try {
      const response = await fetch('/api/payment-methods');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'تعذر تحميل طرق الدفع');
      }
      const data: PaymentMethod[] = await response.json();
      const methods = Array.isArray(data) ? data : [];
      setPaymentMethods(methods);

      const cashId = findCashPaymentMethodId(methods);
      if (cashId !== null) {
        setForm((current) =>
          current.paymentMethodId === null
            ? { ...current, paymentMethodId: cashId }
            : current,
        );
      }
    } catch (error) {
      setPaymentMethods([]);
      setPaymentMethodsError(
        error instanceof Error ? error.message : 'تعذر تحميل طرق الدفع',
      );
    } finally {
      setPaymentMethodsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const now = new Date();
    const today = getCairoDateString(now);
    const yesterday = getPreviousDateString(today);
    setAllowedDateMin(yesterday);
    setAllowedDateMax(today);
    setForm({
      ...INITIAL_FORM_STATE,
      expenseDate: today,
      expenseTime: getCurrentTimeValue(now),
    });
    setSubmitError(null);
    setTouched({ amount: false, category: false, payment: false });
    void loadCategories();
    void loadPaymentMethods();
  }, [open, loadCategories, loadPaymentMethods]);

  useEffect(() => {
    if (!open) return;

    const timer = window.setTimeout(() => {
      amountInputRef.current?.focus();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose, submitting]);

  const amountError = useMemo(
    () => (touched.amount || form.amount ? getAmountValidationError(form.amount) : null),
    [form.amount, touched.amount],
  );

  const categoryError = touched.category && !form.categoryId
    ? 'يجب اختيار تصنيف المصروف'
    : null;

  const paymentError = touched.payment && !form.paymentMethodId
    ? 'يجب اختيار طريقة الدفع'
    : null;

  const parsedAmount = parseAmount(form.amount);
  const selectedCategory = categories.find((category) => category.ExpINID === form.categoryId);
  const selectedPaymentMethod = paymentMethods.find(
    (method) => method.ID === form.paymentMethodId,
  );

  const dateAllowed =
    !!form.expenseDate &&
    !!allowedDateMin &&
    !!allowedDateMax &&
    form.expenseDate >= allowedDateMin &&
    form.expenseDate <= allowedDateMax;

  const canSubmit =
    !amountError &&
    parsedAmount !== null &&
    parsedAmount > 0 &&
    form.categoryId !== null &&
    form.paymentMethodId !== null &&
    dateAllowed &&
    !submitting &&
    !categoriesLoading &&
    !paymentMethodsLoading;

  const showSummary =
    parsedAmount !== null &&
    parsedAmount > 0 &&
    !!selectedCategory &&
    !!selectedPaymentMethod;

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const submitExpense = useCallback(async () => {
    setTouched({ amount: true, category: true, payment: true });

    const currentAmount = parseAmount(form.amount);
    const amountValidation = getAmountValidationError(form.amount);
    const dateAllowed =
      !!form.expenseDate &&
      !!allowedDateMin &&
      !!allowedDateMax &&
      form.expenseDate >= allowedDateMin &&
      form.expenseDate <= allowedDateMax;

    const readyToSubmit =
      !amountValidation &&
      currentAmount !== null &&
      currentAmount > 0 &&
      form.categoryId !== null &&
      form.paymentMethodId !== null &&
      dateAllowed;

    if (!readyToSubmit || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const isToday = form.expenseDate === allowedDateMax;
      const notes = form.notes.trim() || undefined;

      // Today → same /api/expenses path as /expenses (shift + advance WhatsApp)
      // Yesterday → past-date API (also sends advance WhatsApp)
      const response = await fetch(isToday ? '/api/expenses' : '/api/expenses/past-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isToday
            ? {
                expINID: form.categoryId,
                amount: currentAmount,
                paymentMethodId: form.paymentMethodId,
                notes,
              }
            : {
                invDate: form.expenseDate,
                invTime: form.expenseTime || '12:00',
                amount: currentAmount,
                expINID: form.categoryId,
                paymentMethodId: form.paymentMethodId,
                notes,
              },
        ),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || 'فشل إضافة المصروف');
      }

      const categoryName =
        (isToday ? data.catName : undefined) ||
        categories.find((category) => category.ExpINID === form.categoryId)?.CatName ||
        '';
      const paymentMethodName =
        paymentMethods.find((method) => method.ID === form.paymentMethodId)?.Name ?? null;
      const ledgerDualWrite = Boolean(data.ledgerDualWrite);
      const advanceWhatsApp = Boolean(data.advanceWhatsApp);

      const record: PastDateExpenseRecord | undefined = isToday
        ? data.invID
          ? {
              invID: data.invID as number,
              invDate: form.expenseDate,
              invTime: form.expenseTime,
              Amount: Number(data.amount ?? currentAmount),
              Notes: notes,
              CategoryName: categoryName,
            }
          : undefined
        : (data.data as PastDateExpenseRecord | undefined);

      if (record?.invID) {
        setReceiptExpense(
          buildExpenseReceiptData(
            record,
            form,
            currentAmount,
            categoryName,
            paymentMethodName,
            ledgerDualWrite,
          ),
        );
      }

      onExpenseComplete?.({ advanceWhatsApp, ledgerDualWrite });
      resetForm();
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'فشل إضافة المصروف');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [form, allowedDateMin, allowedDateMax, categories, paymentMethods, onClose, onExpenseComplete, resetForm]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitExpense();
  };

  const handleAmountKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    setTouched((current) => ({ ...current, amount: true }));
    if (canSubmit) {
      void submitExpense();
    }
  };

  if (!open && !receiptExpense) return null;

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row">
      <Button
        type="button"
        variant="outline"
        onClick={handleClose}
        disabled={submitting}
        className="h-11 flex-1 border-border text-foreground hover:bg-surface-muted"
      >
        إلغاء
      </Button>
      <Button
        type="submit"
        form="quick-expense-form"
        disabled={!canSubmit}
        className="h-11 flex-1 bg-destructive font-medium text-destructive-foreground hover:bg-destructive/90"
      >
        {submitting ? (
          <>
            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            جارٍ تسجيل المصروف...
          </>
        ) : (
          'إضافة المصروف'
        )}
      </Button>
    </div>
  );

  return (
    <>
      {open ? (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4" dir="rtl">
      <button
        type="button"
        aria-label="إغلاق"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        disabled={submitting}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-expense-title"
        className={cn(
          'relative flex w-full max-w-[calc(100vw-16px)] flex-col overflow-hidden border border-border bg-surface shadow-2xl',
          'max-h-[92svh] rounded-t-2xl md:max-h-[88vh] md:max-w-[720px] md:rounded-2xl',
        )}
      >
        <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface px-4 py-4 md:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <h2 id="quick-expense-title" className="text-lg font-semibold text-foreground">
                  إضافة مصروف فوري
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  تسجيل مصروف لليوم أو يوم أمس
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              aria-label="إغلاق"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <form
          id="quick-expense-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 scrollbar-luxury-v"
        >
          <div className="space-y-5">
            <section aria-label="التاريخ والوقت" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-muted/30 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>التاريخ</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={submitting || !allowedDateMax}
                    onClick={() =>
                      setForm((current) => ({ ...current, expenseDate: allowedDateMax }))
                    }
                    className={cn(
                      'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                      form.expenseDate === allowedDateMax
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                    )}
                  >
                    اليوم
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !allowedDateMin}
                    onClick={() =>
                      setForm((current) => ({ ...current, expenseDate: allowedDateMin }))
                    }
                    className={cn(
                      'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                      form.expenseDate === allowedDateMin
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                    )}
                  >
                    أمس
                  </button>
                </div>
                <p className="mt-1.5 text-sm font-medium text-foreground">
                  {formatDisplayDate(form.expenseDate)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-muted/30 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>الوقت</span>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {formatDisplayTime(form.expenseTime)}
                </p>
              </div>
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                متاح لليوم الحالي أو يوم أمس فقط
              </p>
            </section>

            <section aria-label="المبلغ">
              <label htmlFor="quick-expense-amount" className="text-sm font-semibold text-foreground">
                المبلغ
              </label>
              <div
                className={cn(
                  'mt-2 rounded-2xl border bg-surface-muted/30 px-4 py-3 transition-colors',
                  amountError
                    ? 'border-destructive/60 ring-1 ring-destructive/20'
                    : 'border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    ref={amountInputRef}
                    id="quick-expense-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.amount}
                    disabled={submitting}
                    placeholder="0.00"
                    onBlur={() => setTouched((current) => ({ ...current, amount: true }))}
                    onKeyDown={handleAmountKeyDown}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        amount: sanitizeAmountInput(event.target.value),
                      }))
                    }
                    className="min-w-0 flex-1 bg-transparent text-3xl font-semibold text-foreground placeholder:text-muted-foreground/50 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="shrink-0 text-base font-medium text-muted-foreground">جنيه</span>
                </div>
              </div>
              {amountError ? (
                <p className="mt-1.5 text-xs text-destructive" role="alert">
                  {amountError}
                </p>
              ) : null}
            </section>

            <section aria-label="ملاحظات">
              <label htmlFor="quick-expense-notes" className="text-sm font-semibold text-foreground">
                ملاحظات
              </label>
              <Textarea
                id="quick-expense-notes"
                rows={3}
                value={form.notes}
                disabled={submitting}
                placeholder="مثال: شراء مستلزمات تنظيف للفرع"
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className="mt-2 min-h-[88px] resize-none border-border bg-surface-muted text-foreground"
              />
            </section>

            <ExpenseCategoryPicker
              categories={categories}
              selectedId={form.categoryId}
              loading={categoriesLoading}
              error={categoriesError}
              onRetry={loadCategories}
              disabled={submitting}
              categoryError={categoryError}
              variant="quick"
              onSelect={(categoryId) => {
                setForm((current) => ({ ...current, categoryId }));
                setTouched((current) => ({ ...current, category: true }));
              }}
            />

            <ExpensePaymentMethodPicker
              methods={paymentMethods}
              selectedId={form.paymentMethodId}
              loading={paymentMethodsLoading}
              error={paymentMethodsError}
              onRetry={loadPaymentMethods}
              disabled={submitting}
              paymentError={paymentError}
              onSelect={(paymentMethodId) => {
                setForm((current) => ({ ...current, paymentMethodId }));
                setTouched((current) => ({ ...current, payment: true }));
              }}
            />

            {showSummary ? (
              <section
                aria-live="polite"
                className="rounded-xl border border-border bg-surface-muted/40 px-4 py-3"
              >
                <p className="text-sm font-semibold text-foreground">
                  سيتم تسجيل {parsedAmount?.toLocaleString('ar-EG')} جنيه
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{selectedCategory?.CatName}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  طريقة الدفع: {selectedPaymentMethod?.Name}
                </p>
              </section>
            ) : null}

            {submitError ? (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3"
              >
                <p className="text-sm text-destructive">{submitError}</p>
              </div>
            ) : null}
          </div>
        </form>

        <footer className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          {footer}
        </footer>
      </div>
    </div>
      ) : null}

      <ExpenseReceiptPopup
        open={!!receiptExpense}
        expense={receiptExpense}
        onClose={() => setReceiptExpense(null)}
      />
    </>
  );
}
