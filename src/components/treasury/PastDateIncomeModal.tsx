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
import { CalendarDays, Clock3, Loader2, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import IncomeCategoryPicker, {
  type IncomeCategoryOption,
} from '@/components/incomes/IncomeCategoryPicker';
import ExpensePaymentMethodPicker from '@/components/expenses/ExpensePaymentMethodPicker';
import type { PaymentMethod } from '@/lib/types';
import { getCairoBusinessDate } from '@/lib/businessDate';

interface PastDateIncomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIncomeComplete: (info?: { advanceWhatsApp?: boolean; ledgerDualWrite?: boolean }) => void;
  defaultDate?: string;
  title?: string;
  subtitle?: string;
  entryDateReadOnly?: boolean;
  /** POS current-day mode: POST /api/incomes (open day + shift on active branch). */
  attachToOpenDay?: boolean;
}

interface IncomeFormState {
  incomeDate: string;
  incomeTime: string;
  amount: string;
  categoryId: number | null;
  paymentMethodId: number | null;
  notes: string;
}

const INITIAL_FORM: IncomeFormState = {
  incomeDate: '',
  incomeTime: '',
  amount: '',
  categoryId: null,
  paymentMethodId: null,
  notes: '',
};

function getCurrentTimeValue(date = new Date()): string {
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
    return (
      normalized === 'كاش' ||
      normalized.includes('كاش') ||
      normalized.includes('نقد') ||
      normalized === 'cash'
    );
  });
  return cash?.ID ?? null;
}

function mapMetaPaymentMethods(
  raw: Array<{ PaymentID?: number; ID?: number; PaymentMethod?: string; Name?: string }>,
): PaymentMethod[] {
  return raw
    .map((pm) => ({
      ID: Number(pm.ID ?? pm.PaymentID),
      Name: String(pm.Name ?? pm.PaymentMethod ?? '').trim(),
    }))
    .filter((pm) => Number.isFinite(pm.ID) && pm.ID > 0 && pm.Name);
}

export default function PastDateIncomeModal({
  isOpen,
  onClose,
  onIncomeComplete,
  defaultDate,
  title = 'إضافة إيراد',
  subtitle = 'إضافة إيراد لتاريخ محدد',
  entryDateReadOnly = false,
  attachToOpenDay = false,
}: PastDateIncomeModalProps) {
  const amountInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const [form, setForm] = useState<IncomeFormState>(INITIAL_FORM);
  const [categories, setCategories] = useState<IncomeCategoryOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState({
    amount: false,
    category: false,
    payment: false,
  });
  const [businessToday, setBusinessToday] = useState('');

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM);
    setSubmitError(null);
    setTouched({ amount: false, category: false, payment: false });
  }, []);

  const loadMeta = useCallback(async () => {
    setCategoriesLoading(true);
    setPaymentMethodsLoading(true);
    setCategoriesError(null);
    setPaymentMethodsError(null);
    try {
      const [metaRes, pmRes] = await Promise.all([
        fetch('/api/incomes/meta'),
        fetch('/api/payment-methods'),
      ]);

      if (!metaRes.ok) {
        const data = await metaRes.json().catch(() => ({}));
        throw new Error(data.error || 'تعذر تحميل بيانات الإيراد');
      }
      const meta = await metaRes.json();
      const cats: IncomeCategoryOption[] = Array.isArray(meta.categories)
        ? meta.categories.map((c: { ExpINID: number; CatName: string }) => ({
            ExpINID: Number(c.ExpINID),
            CatName: String(c.CatName ?? ''),
          }))
        : [];
      setCategories(cats.filter((c) => c.ExpINID > 0 && c.CatName));

      let methods: PaymentMethod[] = [];
      if (pmRes.ok) {
        const pmData = await pmRes.json();
        methods = Array.isArray(pmData)
          ? pmData.map((pm: { ID: number; Name: string }) => ({
              ID: Number(pm.ID),
              Name: String(pm.Name ?? ''),
            }))
          : [];
      } else if (Array.isArray(meta.paymentMethods)) {
        methods = mapMetaPaymentMethods(meta.paymentMethods);
      }
      methods = methods.filter((m) => m.ID > 0 && m.Name);
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
      setCategories([]);
      setPaymentMethods([]);
      const message = error instanceof Error ? error.message : 'تعذر تحميل البيانات';
      setCategoriesError(message);
      setPaymentMethodsError(message);
    } finally {
      setCategoriesLoading(false);
      setPaymentMethodsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const now = new Date();
    const today = getCairoBusinessDate(now);
    setBusinessToday(today);

    const lockedDate = defaultDate?.trim() || today;
    setForm({
      ...INITIAL_FORM,
      incomeDate: lockedDate,
      incomeTime: getCurrentTimeValue(now),
    });
    setSubmitError(null);
    setTouched({ amount: false, category: false, payment: false });
    void loadMeta();
  }, [isOpen, defaultDate, loadMeta]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => amountInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, submitting]);

  const amountError = useMemo(
    () => (touched.amount || form.amount ? getAmountValidationError(form.amount) : null),
    [form.amount, touched.amount],
  );
  const categoryError =
    touched.category && !form.categoryId ? 'يجب اختيار تصنيف الإيراد' : null;
  const paymentError =
    touched.payment && !form.paymentMethodId ? 'يجب اختيار طريقة الدفع' : null;

  const parsedAmount = parseAmount(form.amount);
  const selectedCategory = categories.find((c) => c.ExpINID === form.categoryId);
  const selectedPaymentMethod = paymentMethods.find((m) => m.ID === form.paymentMethodId);

  const dateAllowed =
    !!form.incomeDate &&
    (attachToOpenDay || !businessToday || form.incomeDate <= businessToday);

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

  const submitIncome = useCallback(async () => {
    setTouched({ amount: true, category: true, payment: true });

    const currentAmount = parseAmount(form.amount);
    const amountValidation = getAmountValidationError(form.amount);
    const dateOk =
      !!form.incomeDate &&
      (attachToOpenDay || !businessToday || form.incomeDate <= businessToday);

    const ready =
      !amountValidation &&
      currentAmount !== null &&
      currentAmount > 0 &&
      form.categoryId !== null &&
      form.paymentMethodId !== null &&
      dateOk;

    if (!ready || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const endpoint = attachToOpenDay ? '/api/incomes' : '/api/incomes/past-date';
      const notes = form.notes.trim() || undefined;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invDate: form.incomeDate,
          ...(attachToOpenDay ? {} : { invTime: form.incomeTime || '12:00' }),
          amount: currentAmount,
          expInId: form.categoryId,
          paymentMethodId: form.paymentMethodId,
          notes: notes || 'إيراد إضافي',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || 'فشل إضافة الإيراد');
      }

      onIncomeComplete({
        advanceWhatsApp: Boolean(data.advanceWhatsApp),
        ledgerDualWrite: Boolean(data.ledgerDualWrite),
      });
      resetForm();
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'فشل إضافة الإيراد');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [form, attachToOpenDay, businessToday, onClose, onIncomeComplete, resetForm]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitIncome();
  };

  const handleAmountKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    setTouched((current) => ({ ...current, amount: true }));
    if (canSubmit) void submitIncome();
  };

  if (!isOpen) return null;

  const dateHint = attachToOpenDay
    ? 'يوم العمل الحالي (قبل 4 فجرًا يظل نفس اليوم) — على الفرع والوردية المفتوحة'
    : entryDateReadOnly
      ? 'التاريخ مربوط بيوم الصف — غير قابل للتعديل'
      : 'اختر تاريخ الإيراد';

  return (
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
        aria-labelledby="quick-income-title"
        className={cn(
          'relative flex w-full max-w-[calc(100vw-16px)] flex-col overflow-hidden border border-border bg-surface shadow-2xl',
          'max-h-[92svh] rounded-t-2xl md:max-h-[88vh] md:max-w-[720px] md:rounded-2xl',
        )}
      >
        <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface px-4 py-4 md:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <h2 id="quick-income-title" className="text-lg font-semibold text-foreground">
                  {title}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
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
          id="quick-income-form"
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
                {attachToOpenDay ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-foreground">يوم العمل الحالي</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDisplayDate(form.incomeDate)}
                    </p>
                  </div>
                ) : entryDateReadOnly ? (
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {formatDisplayDate(form.incomeDate)}
                  </p>
                ) : (
                  <input
                    type="date"
                    value={form.incomeDate}
                    disabled={submitting}
                    max={businessToday || undefined}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, incomeDate: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                  />
                )}
              </div>
              <div className="rounded-xl border border-border bg-surface-muted/30 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>الوقت</span>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {formatDisplayTime(form.incomeTime)}
                </p>
              </div>
              <p className="sm:col-span-2 text-xs text-muted-foreground">{dateHint}</p>
            </section>

            <section aria-label="المبلغ">
              <label htmlFor="quick-income-amount" className="text-sm font-semibold text-foreground">
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
                    id="quick-income-amount"
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
              <label htmlFor="quick-income-notes" className="text-sm font-semibold text-foreground">
                ملاحظات
              </label>
              <Textarea
                id="quick-income-notes"
                rows={3}
                value={form.notes}
                disabled={submitting}
                placeholder="مثال: إيراد إضافي / تحصيل"
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className="mt-2 min-h-[88px] resize-none border-border bg-surface-muted text-foreground"
              />
            </section>

            <IncomeCategoryPicker
              categories={categories}
              selectedId={form.categoryId}
              loading={categoriesLoading}
              error={categoriesError}
              onRetry={loadMeta}
              disabled={submitting}
              categoryError={categoryError}
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
              onRetry={loadMeta}
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
              form="quick-income-form"
              disabled={!canSubmit}
              className="h-11 flex-1 bg-emerald-600 font-medium text-white hover:bg-emerald-500"
            >
              {submitting ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  جارٍ تسجيل الإيراد...
                </>
              ) : (
                'إضافة الإيراد'
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
