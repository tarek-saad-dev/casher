'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  Check,
  ChevronDown,
  CreditCard,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PaymentMethod } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ExpensePaymentMethodPickerProps {
  methods: PaymentMethod[];
  selectedId: number | null;
  onSelect: (methodId: number) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
  paymentError?: string | null;
}

const VISIBLE_METHOD_LIMIT = 5;

function renderPaymentMethodIcon(name: string, className?: string) {
  const normalized = name.trim().toLowerCase();

  if (
    normalized.includes('كاش') ||
    normalized.includes('نقد') ||
    normalized.includes('cash')
  ) {
    return <Banknote className={className} />;
  }

  if (
    normalized.includes('فيز') ||
    normalized.includes('visa') ||
    normalized.includes('master') ||
    normalized.includes('card')
  ) {
    return <CreditCard className={className} />;
  }

  if (
    normalized.includes('insta') ||
    normalized.includes('انست') ||
    normalized.includes('فوداف') ||
    normalized.includes('wallet') ||
    normalized.includes('محفظ')
  ) {
    return <Smartphone className={className} />;
  }

  if (
    normalized.includes('بنك') ||
    normalized.includes('تحويل') ||
    normalized.includes('bank')
  ) {
    return <Building2 className={className} />;
  }

  if (normalized.includes('transfer')) {
    return <ArrowLeftRight className={className} />;
  }

  return <Wallet className={className} />;
}

function PaymentMethodSkeleton() {
  return (
    <div className="flex flex-wrap gap-2" aria-hidden>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-12 w-28 animate-pulse rounded-xl bg-surface-muted"
        />
      ))}
    </div>
  );
}

function PaymentMethodCard({
  method,
  selected,
  onSelect,
  disabled,
}: {
  method: PaymentMethod;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'inline-flex min-h-[48px] min-w-30 flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-surface-muted/40 text-foreground hover:border-primary/40 hover:bg-surface-muted',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {renderPaymentMethodIcon(method.Name, 'h-4 w-4 shrink-0')}
      <span className="truncate">{method.Name}</span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
    </button>
  );
}

export default function ExpensePaymentMethodPicker({
  methods,
  selectedId,
  onSelect,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
  paymentError = null,
}: ExpensePaymentMethodPickerProps) {
  const [showMore, setShowMore] = useState(false);

  const { primaryMethods, overflowMethods } = useMemo(() => {
    if (methods.length <= VISIBLE_METHOD_LIMIT) {
      return { primaryMethods: methods, overflowMethods: [] as PaymentMethod[] };
    }

    const selectedMethod = methods.find((method) => method.ID === selectedId);
    const defaultPrimary = methods.slice(0, VISIBLE_METHOD_LIMIT);

    if (
      selectedMethod &&
      !defaultPrimary.some((method) => method.ID === selectedMethod.ID)
    ) {
      return {
        primaryMethods: [...defaultPrimary.slice(0, VISIBLE_METHOD_LIMIT - 1), selectedMethod],
        overflowMethods: methods.filter(
          (method) =>
            method.ID !== selectedMethod.ID &&
            !defaultPrimary.slice(0, VISIBLE_METHOD_LIMIT - 1).some((entry) => entry.ID === method.ID),
        ),
      };
    }

    return {
      primaryMethods: defaultPrimary,
      overflowMethods: methods.slice(VISIBLE_METHOD_LIMIT),
    };
  }, [methods, selectedId]);

  const selectedOverflowMethod = overflowMethods.find((method) => method.ID === selectedId);

  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">طريقة الدفع</p>
        <PaymentMethodSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">طريقة الدفع</p>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              إعادة المحاولة
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">طريقة الدفع</p>
        <div className="rounded-xl border border-border bg-surface-muted/30 p-4 text-center">
          <p className="text-sm text-muted-foreground">لا توجد طرق دفع متاحة</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">طريقة الدفع</p>

      <div role="radiogroup" aria-label="طريقة الدفع" className="flex flex-wrap gap-2">
        {primaryMethods.map((method) => (
          <PaymentMethodCard
            key={method.ID}
            method={method}
            selected={selectedId === method.ID}
            onSelect={() => onSelect(method.ID)}
            disabled={disabled}
          />
        ))}
      </div>

      {overflowMethods.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface-muted/20 p-3">
          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            className="flex w-full items-center justify-between text-sm font-medium text-foreground"
          >
            <span>طرق أخرى</span>
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')}
            />
          </button>

          {showMore || selectedOverflowMethod ? (
            <Select
              value={selectedOverflowMethod ? String(selectedId) : undefined}
              onValueChange={(value) => onSelect(Number(value))}
              disabled={disabled}
            >
              <SelectTrigger className="w-full border-border bg-surface text-foreground">
                <SelectValue placeholder="اختر طريقة دفع أخرى" />
              </SelectTrigger>
              <SelectContent className="border-border bg-surface">
                {overflowMethods.map((method) => (
                  <SelectItem
                    key={method.ID}
                    value={String(method.ID)}
                    className="text-foreground"
                  >
                    {method.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}

      {paymentError ? (
        <p className="text-xs text-destructive" role="alert">
          {paymentError}
        </p>
      ) : null}
    </div>
  );
}
