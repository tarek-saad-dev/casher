'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import type { PartnersExpenseCategoryTransaction } from '@/lib/types/partners-report';
import { formatArabicDate, toArabicDigits } from '@/lib/formatArabicNumbers';
import { formatPartnersCurrency, formatPartnersPercent } from './partnersReportUtils';

interface ExpensesByCategorySectionProps {
  year: number;
  month: number;
  rows: PartnersMonthlyReportResponse['expensesByCategory'];
  totalOperatingExpenses: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

type CategoryRow = PartnersMonthlyReportResponse['expensesByCategory'][number];

interface CategoryDetailsCacheEntry {
  transactions: PartnersExpenseCategoryTransaction[];
  loading: boolean;
  error: string | null;
}

function getCategoryKey(row: CategoryRow): string {
  return `${row.categoryId ?? 'null'}::${row.categoryName}`;
}

function formatExpenseDate(dateStr: string): string {
  if (!dateStr) return '—';
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatArabicDate(parsed, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatExpenseTime(time: string | null): string {
  if (!time) return '—';
  return toArabicDigits(time);
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-10 bg-zinc-800/40 rounded animate-pulse" />
      ))}
    </div>
  );
}

export default function ExpensesByCategorySection({
  year,
  month,
  rows,
  totalOperatingExpenses,
  loading,
  error,
  onRetry,
}: ExpensesByCategorySectionProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, CategoryDetailsCacheEntry>>({});

  useEffect(() => {
    setExpandedKey(null);
    setDetailsCache({});
  }, [year, month]);

  const fetchCategoryDetails = useCallback(
    async (row: CategoryRow, cacheKey: string) => {
      setDetailsCache((prev) => ({
        ...prev,
        [cacheKey]: {
          transactions: prev[cacheKey]?.transactions ?? [],
          loading: true,
          error: null,
        },
      }));

      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
          categoryId: row.categoryId == null ? 'null' : String(row.categoryId),
          categoryName: row.categoryName,
        });

        const response = await fetch(
          `/api/admin/reports/partners/expense-category-details?${params.toString()}`
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || 'فشل تحميل تفاصيل الفئة');
        }

        const data = await response.json();
        setDetailsCache((prev) => ({
          ...prev,
          [cacheKey]: {
            transactions: data.transactions ?? [],
            loading: false,
            error: null,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
        setDetailsCache((prev) => ({
          ...prev,
          [cacheKey]: {
            transactions: prev[cacheKey]?.transactions ?? [],
            loading: false,
            error: message,
          },
        }));
      }
    },
    [year, month]
  );

  const toggleCategory = useCallback(
    (row: CategoryRow) => {
      const cacheKey = getCategoryKey(row);

      if (expandedKey === cacheKey) {
        setExpandedKey(null);
        return;
      }

      setExpandedKey(cacheKey);

      const cached = detailsCache[cacheKey];
      if (!cached || (!cached.transactions.length && !cached.loading && !cached.error)) {
        void fetchCategoryDetails(row, cacheKey);
      }
    },
    [detailsCache, expandedKey, fetchCategoryDetails]
  );

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: CategoryRow
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCategory(row);
    }
  };

  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid print:bg-white print:border-zinc-300">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white print:text-black">
          مصروفات التشغيل الأخرى
        </h2>
        <p className="text-xs text-zinc-500 print:text-zinc-600 mt-1">
          بعد استبعاد الرواتب والسلف والتسويات الخاصة بالموظفين
        </p>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            className="print:hidden border-zinc-700"
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-500 print:text-zinc-600">
          لا توجد مصروفات تشغيل أخرى في الشهر المحدد
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 print:border-zinc-300 print:text-zinc-600">
                <th className="text-right py-3 px-2 font-medium">الفئة</th>
                <th className="text-right py-3 px-2 font-medium">عدد المعاملات</th>
                <th className="text-right py-3 px-2 font-medium">المبلغ</th>
                <th className="text-right py-3 px-2 font-medium">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cacheKey = getCategoryKey(row);
                const isExpanded = expandedKey === cacheKey;
                const cacheEntry = detailsCache[cacheKey];

                return (
                  <Fragment key={cacheKey}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() => toggleCategory(row)}
                      onKeyDown={(event) => handleRowKeyDown(event, row)}
                      className="border-b border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer transition-colors print:break-inside-avoid print:hover:bg-transparent"
                    >
                      <td className="py-3 px-2 text-white font-medium print:text-black">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex transition-transform duration-200 ${
                              isExpanded ? 'rotate-90' : ''
                            }`}
                            aria-hidden
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-zinc-400 print:text-zinc-600" />
                            ) : (
                              <ChevronLeft className="h-4 w-4 text-zinc-400 print:text-zinc-600" />
                            )}
                          </span>
                          <span>{row.categoryName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-zinc-400 print:text-zinc-600">
                        {row.transactionCount}
                      </td>
                      <td className="py-3 px-2 text-rose-400 font-bold print:text-rose-700">
                        {formatPartnersCurrency(row.totalAmount)}
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden print:hidden">
                            <div
                              className="h-full bg-rose-500/80"
                              style={{ width: `${Math.min(row.percentage, 100)}%` }}
                            />
                          </div>
                          <span className="text-zinc-400 min-w-[3rem] print:text-zinc-600">
                            {formatPartnersPercent(row.percentage)}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="print:hidden">
                        <td colSpan={4} className="p-0 border-b border-zinc-800/60">
                          <div className="mr-3 border-r-2 border-rose-500/30 bg-zinc-950/60 px-4 py-4 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="mb-3">
                              <p className="text-sm font-semibold text-zinc-200">
                                تفاصيل فئة: {row.categoryName}
                              </p>
                              <p className="text-xs text-zinc-500 mt-1">
                                {row.transactionCount} عملية — بإجمالي{' '}
                                {formatPartnersCurrency(row.totalAmount)}
                              </p>
                            </div>

                            {cacheEntry?.loading ? (
                              <div className="flex items-center justify-center gap-2 py-8 text-zinc-500">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm">جاري تحميل المعاملات...</span>
                              </div>
                            ) : cacheEntry?.error ? (
                              <div className="flex flex-col items-center gap-3 py-6">
                                <div className="flex items-center gap-2 text-rose-400 text-sm">
                                  <AlertCircle className="h-4 w-4" />
                                  <span>{cacheEntry.error}</span>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="border-zinc-700"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void fetchCategoryDetails(row, cacheKey);
                                  }}
                                >
                                  إعادة المحاولة
                                </Button>
                              </div>
                            ) : cacheEntry?.transactions.length ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-zinc-800/80 text-zinc-500">
                                      <th className="text-right py-2 px-2 font-medium">التاريخ</th>
                                      <th className="text-right py-2 px-2 font-medium">الوقت</th>
                                      <th className="text-right py-2 px-2 font-medium">
                                        البيان / الملاحظة
                                      </th>
                                      <th className="text-right py-2 px-2 font-medium">
                                        طريقة الدفع
                                      </th>
                                      <th className="text-right py-2 px-2 font-medium">المبلغ</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cacheEntry.transactions.map((transaction) => (
                                      <tr
                                        key={transaction.id}
                                        className="border-b border-zinc-800/40 last:border-0"
                                      >
                                        <td className="py-2 px-2 text-zinc-300 whitespace-nowrap">
                                          {formatExpenseDate(transaction.date)}
                                        </td>
                                        <td className="py-2 px-2 text-zinc-400 whitespace-nowrap">
                                          {formatExpenseTime(transaction.time)}
                                        </td>
                                        <td className="py-2 px-2 text-zinc-400 max-w-xs">
                                          {transaction.notes?.trim() || 'بدون بيان'}
                                        </td>
                                        <td className="py-2 px-2 text-zinc-400 whitespace-nowrap">
                                          {transaction.paymentMethod?.trim() || 'غير محددة'}
                                        </td>
                                        <td className="py-2 px-2 text-rose-400 font-semibold whitespace-nowrap">
                                          {formatPartnersCurrency(transaction.amount)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="py-6 text-center text-sm text-zinc-500">
                                لا توجد معاملات لهذه الفئة في الشهر المحدد
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="bg-zinc-800/40 font-bold print:break-inside-avoid">
                <td className="py-3 px-2 text-white print:text-black">الإجمالي</td>
                <td className="py-3 px-2 text-zinc-300 print:text-zinc-700">
                  {rows.reduce((sum, r) => sum + r.transactionCount, 0)}
                </td>
                <td className="py-3 px-2 text-rose-400 print:text-rose-700">
                  {formatPartnersCurrency(totalOperatingExpenses)}
                </td>
                <td className="py-3 px-2 text-zinc-300 print:text-zinc-700">
                  {totalOperatingExpenses > 0 ? '100%' : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
