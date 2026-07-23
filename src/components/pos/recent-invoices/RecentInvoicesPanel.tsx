'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import DeleteInvoiceDialog, { type DeleteInvoiceTarget } from '@/components/sales/DeleteInvoiceDialog';
import RecentInvoiceCard from '@/components/pos/recent-invoices/RecentInvoiceCard';
import { useRecentInvoices } from '@/hooks/useRecentInvoices';
import { useSession } from '@/hooks/useSession';
import {
  DEFAULT_RECENT_INVOICES_FILTERS,
  type RecentInvoiceDatePreset,
  type RecentInvoiceStatusFilter,
  type RecentInvoicesFilterState,
} from '@/lib/recentInvoices.types';
import {
  countActiveRecentInvoiceFilters,
  hasActiveRecentInvoiceFilters,
} from '@/lib/recentInvoicesQuery';
import { invalidateRecentInvoicesCache } from '@/lib/recentInvoicesCache';
import type { Barber } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PaymentMethodOption {
  ID: number;
  Name: string;
}

interface RecentInvoicesPanelProps {
  enabled: boolean;
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number) => void;
  onRefresh?: () => void;
  refreshToken?: number;
}

const DATE_PRESETS: { id: RecentInvoiceDatePreset; label: string }[] = [
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: 'last7', label: 'آخر 7 أيام' },
  { id: 'thisMonth', label: 'هذا الشهر' },
  { id: 'custom', label: 'فترة مخصصة' },
];

function InvoiceCardSkeleton() {
  return <div className="h-44 animate-pulse rounded-lg border border-border bg-surface" />;
}

export default function RecentInvoicesPanel({
  enabled,
  onEditSale,
  onDeleteSale,
  onRefresh,
  refreshToken,
}: RecentInvoicesPanelProps) {
  const [filters, setFilters] = useState<RecentInvoicesFilterState>(DEFAULT_RECENT_INVOICES_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [employees, setEmployees] = useState<Barber[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteInvoiceTarget | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { user } = useSession();

  const {
    items,
    total,
    hasMore,
    isInitialLoading,
    isFetching,
    isLoadingMore,
    error,
    refetch,
    loadMore,
  } = useRecentInvoices({
    enabled,
    filters,
    debouncedQuery,
    branchId: user?.ActiveBranchID,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(filters.invoiceSearchQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.invoiceSearchQuery]);

  useEffect(() => {
    if (!enabled) return;

    void Promise.all([
      fetch('/api/payment-methods').then((r) => r.json()),
      fetch('/api/barbers').then((r) => r.json()),
    ]).then(([methods, barbers]) => {
      if (Array.isArray(methods)) setPaymentMethods(methods);
      if (Array.isArray(barbers)) setEmployees(barbers);
    });
  }, [enabled]);

  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      invalidateRecentInvoicesCache();
      void refetch();
    }
  }, [refreshToken, refetch]);

  useEffect(() => {
    if (!enabled) return;

    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [enabled]);

  const activeFilterCount = useMemo(() => countActiveRecentInvoiceFilters(filters), [filters]);
  const filtersActive = hasActiveRecentInvoiceFilters(filters);
  const isSearchPending =
    filters.invoiceSearchQuery.trim() !== debouncedQuery.trim() || (isFetching && !isLoadingMore);

  const clearSearch = useCallback(() => {
    setFilters((current) => ({ ...current, invoiceSearchQuery: '' }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_RECENT_INVOICES_FILTERS);
  }, []);

  const togglePaymentMethod = (id: number) => {
    setFilters((current) => {
      const exists = current.selectedPaymentMethodIds.includes(id);
      return {
        ...current,
        selectedPaymentMethodIds: exists
          ? current.selectedPaymentMethodIds.filter((value) => value !== id)
          : [...current.selectedPaymentMethodIds, id],
      };
    });
  };

  const toggleEmployee = (id: number) => {
    setFilters((current) => {
      const exists = current.selectedEmployeeIds.includes(id);
      return {
        ...current,
        selectedEmployeeIds: exists
          ? current.selectedEmployeeIds.filter((value) => value !== id)
          : [...current.selectedEmployeeIds, id],
      };
    });
  };

  const filterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];

    filters.selectedPaymentMethodIds.forEach((id) => {
      const method = paymentMethods.find((item) => item.ID === id);
      chips.push({
        key: `pm-${id}`,
        label: method?.Name ?? `طريقة ${id}`,
        onRemove: () => togglePaymentMethod(id),
      });
    });

    filters.selectedEmployeeIds.forEach((id) => {
      const employee = employees.find((item) => item.EmpID === id);
      chips.push({
        key: `emp-${id}`,
        label: employee?.EmpName ?? `موظف ${id}`,
        onRemove: () => toggleEmployee(id),
      });
    });

    if (filters.selectedDatePreset) {
      const preset = DATE_PRESETS.find((item) => item.id === filters.selectedDatePreset);
      chips.push({
        key: 'date',
        label: preset?.label ?? 'تاريخ',
        onRemove: () =>
          setFilters((current) => ({
            ...current,
            selectedDatePreset: null,
            customDateFrom: '',
            customDateTo: '',
          })),
      });
    }

    if (filters.minAmount || filters.maxAmount) {
      chips.push({
        key: 'amount',
        label: `المبلغ: ${filters.minAmount || '0'} - ${filters.maxAmount || '∞'}`,
        onRemove: () => setFilters((current) => ({ ...current, minAmount: '', maxAmount: '' })),
      });
    }

    if (filters.selectedStatus) {
      chips.push({
        key: 'status',
        label: filters.selectedStatus === 'complete' ? 'مكتملة' : 'غير مكتملة',
        onRemove: () => setFilters((current) => ({ ...current, selectedStatus: null })),
      });
    }

    return chips;
  }, [filters, paymentMethods, employees]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      searchInputRef.current?.blur();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="search"
            value={filters.invoiceSearchQuery}
            onChange={(event) =>
              setFilters((current) => ({ ...current, invoiceSearchQuery: event.target.value }))
            }
            onKeyDown={handleSearchKeyDown}
            placeholder="ابحث برقم الفاتورة، العميل، الموبايل أو الخدمة..."
            aria-label="بحث في الفواتير"
            dir="rtl"
            className={cn(
              'h-10 w-full rounded-xl border border-border bg-surface py-2 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground',
              'focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25',
            )}
          />
          {filters.invoiceSearchQuery ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="مسح البحث"
              className="absolute top-1/2 left-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted/80"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          {isSearchPending ? (
            <Loader2 className="absolute top-1/2 left-10 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">طريقة الدفع</span>
            <select
              value=""
              onChange={(event) => {
                const id = Number(event.target.value);
                if (id) togglePaymentMethod(id);
                event.target.value = '';
              }}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground"
            >
              <option value="">اختر طريقة الدفع</option>
              {paymentMethods.map((method) => (
                <option key={method.ID} value={method.ID}>
                  {method.Name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">الصنايعي</span>
            <select
              value=""
              onChange={(event) => {
                const id = Number(event.target.value);
                if (id) toggleEmployee(id);
                event.target.value = '';
              }}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground"
            >
              <option value="">الكل</option>
              {employees.map((employee) => (
                <option key={employee.EmpID} value={employee.EmpID}>
                  {employee.EmpName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowMoreFilters((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" />
            المزيد من الفلاتر
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
            {showMoreFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {filtersActive ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-primary hover:underline"
            >
              مسح الكل
            </button>
          ) : null}
        </div>

        {showMoreFilters ? (
          <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
            <div className="flex flex-wrap gap-2">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      selectedDatePreset:
                        current.selectedDatePreset === preset.id ? null : preset.id,
                    }))
                  }
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs',
                    filters.selectedDatePreset === preset.id
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-muted-foreground',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {filters.selectedDatePreset === 'custom' ? (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={filters.customDateFrom}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, customDateFrom: event.target.value }))
                  }
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                />
                <input
                  type="date"
                  value={filters.customDateTo}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, customDateTo: event.target.value }))
                  }
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                />
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                placeholder="الحد الأدنى"
                value={filters.minAmount}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, minAmount: event.target.value }))
                }
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              />
              <input
                type="number"
                min="0"
                placeholder="الحد الأقصى"
                value={filters.maxAmount}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, maxAmount: event.target.value }))
                }
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              />
            </div>

            <select
              value={filters.selectedStatus ?? ''}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  selectedStatus: (event.target.value as RecentInvoiceStatusFilter) || null,
                }))
              }
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">كل الحالات</option>
              <option value="complete">مكتملة</option>
              <option value="incomplete">غير مكتملة</option>
            </select>
          </div>
        ) : null}

        {filterChips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-foreground"
              >
                {chip.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span aria-live="polite">
            {filtersActive ? `${total} فاتورة مطابقة` : `${total} فاتورة`}
          </span>
          {isFetching && !isInitialLoading ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              جاري التحديث...
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3 scrollbar-luxury-v">
        {isInitialLoading ? (
          <div className="space-y-3">
            <InvoiceCardSkeleton />
            <InvoiceCardSkeleton />
            <InvoiceCardSkeleton />
          </div>
        ) : error ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-base font-semibold text-foreground">تعذر تحميل الفواتير</p>
            <Button variant="outline" onClick={() => void refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-base font-semibold text-foreground">
              {filtersActive ? 'لا توجد فواتير مطابقة' : 'لا توجد فواتير حديثة'}
            </p>
            {filtersActive ? (
              <>
                <p className="text-sm text-muted-foreground">
                  جرّب تغيير كلمات البحث أو إزالة بعض الفلاتر.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={clearSearch}>
                    مسح البحث
                  </Button>
                  <Button variant="outline" onClick={clearAllFilters}>
                    مسح كل الفلاتر
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((sale) => (
              <RecentInvoiceCard
                key={sale.InvID}
                sale={sale}
                onEditSale={onEditSale}
                onDeleteSale={(saleId, invNo) => setDeleteTarget({ invId: saleId, invNo })}
              />
            ))}

            {hasMore ? (
              <Button
                variant="outline"
                className="w-full border-border text-foreground"
                disabled={isLoadingMore}
                onClick={() => void loadMore()}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جاري التحميل...
                  </>
                ) : (
                  'تحميل المزيد'
                )}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <DeleteInvoiceDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={async () => {
          const deletedId = deleteTarget?.invId;
          setDeleteTarget(null);
          invalidateRecentInvoicesCache();
          await refetch();
          onRefresh?.();
          if (deletedId) onDeleteSale?.(deletedId);
        }}
      />
    </div>
  );
}
