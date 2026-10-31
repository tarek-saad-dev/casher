'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { PartnersExpenseCategoryTransaction } from '@/lib/types/partners-report';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatArabicDate, toArabicDigits } from '@/lib/formatArabicNumbers';
import { formatPartnersCurrency, partnersEmployeePaidTotal } from './partnersReportUtils';

interface PartnersEmployeeFlowSectionProps {
  year: number;
  month: number;
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
  /** Profit-affecting «إيراد آخر للمحل» only — already in backend operatingNet once. */
  storeOtherBusinessIncome?: number;
  loading: boolean;
}

function FlowSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.2fr] gap-4 items-stretch animate-pulse">
      <div className="h-24 rounded-xl bg-zinc-800/40" />
      <div className="hidden md:block w-8" />
      <div className="h-24 rounded-xl bg-zinc-800/40" />
      <div className="hidden md:block w-8" />
      <div className="h-24 rounded-xl bg-zinc-800/40" />
      <div className="hidden md:block w-8" />
      <div className="h-28 rounded-xl bg-zinc-800/40" />
    </div>
  );
}

export function calcRemainingAfterEmployees(
  totalEmployeeActualRevenue: number,
  totalPaidSalaryOrAdvance: number,
  storeOtherBusinessIncome = 0,
): number {
  const revenue = Number.isFinite(totalEmployeeActualRevenue) ? totalEmployeeActualRevenue : 0;
  const store = Number.isFinite(storeOtherBusinessIncome) ? storeOtherBusinessIncome : 0;
  const paid = Number.isFinite(totalPaidSalaryOrAdvance) ? totalPaidSalaryOrAdvance : 0;
  return Math.round((revenue + store - paid) * 100) / 100;
}

function formatTxnDate(dateStr: string): string {
  if (!dateStr) return '—';
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatArabicDate(parsed, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTxnTime(time: string | null): string {
  if (!time) return '—';
  return toArabicDigits(time);
}

export default function PartnersEmployeeFlowSection({
  year,
  month,
  totals,
  storeOtherBusinessIncome = 0,
  loading,
}: PartnersEmployeeFlowSectionProps) {
  const totalEmployeeActualRevenue = totals.totalShopRevenue;
  const totalPaidSalaryOrAdvance = partnersEmployeePaidTotal(totals);
  const storeIncome = Number.isFinite(storeOtherBusinessIncome) ? storeOtherBusinessIncome : 0;
  const remaining = calcRemainingAfterEmployees(
    totalEmployeeActualRevenue,
    totalPaidSalaryOrAdvance,
    storeIncome,
  );
  const isNegative = remaining < 0;
  const displayRemaining = Math.abs(remaining);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<PartnersExpenseCategoryTransaction[]>([]);

  useEffect(() => {
    setDetailsOpen(false);
    setDetailsError(null);
    setTransactions([]);
  }, [year, month, storeIncome]);

  const loadDetails = useCallback(async () => {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      });
      const response = await fetch(
        `/api/admin/reports/partners/store-income-details?${params.toString()}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'فشل تحميل تفاصيل الإيرادات الإضافية');
      }
      const data = await response.json();
      setTransactions(data.transactions ?? []);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setDetailsLoading(false);
    }
  }, [year, month]);

  const toggleDetails = () => {
    if (storeIncome <= 0) return;
    const next = !detailsOpen;
    setDetailsOpen(next);
    if (next && transactions.length === 0 && !detailsLoading) {
      void loadDetails();
    }
  };

  return (
    <section className="w-full min-w-0 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 sm:p-4 md:p-6 print:break-inside-avoid print:bg-white print:border-zinc-300">
      <h2 className="text-base sm:text-lg font-bold text-white print:text-black mb-3 sm:mb-5">
        صافي إيراد الصنايعية بعد الرواتب والسلف
      </h2>

      {loading && totalEmployeeActualRevenue === 0 && totalPaidSalaryOrAdvance === 0 ? (
        <FlowSkeleton />
      ) : (
        <>
          <div className="financial-flow flex flex-col md:flex-row md:items-center md:justify-center gap-3 sm:gap-4 md:gap-3 w-full min-w-0">
            <div className="flex-1 min-w-0 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-3 sm:px-5 sm:py-4 text-center print:border-emerald-700 print:bg-emerald-50">
              <span className="block text-xs sm:text-sm text-zinc-400 print:text-zinc-600 mb-1.5 sm:mb-2">
                إيراد الصنايعية الفعلي
              </span>
              <strong className="text-lg sm:text-xl md:text-2xl font-bold text-emerald-400 print:text-emerald-700 tabular-nums">
                {formatPartnersCurrency(totalEmployeeActualRevenue)}
              </strong>
            </div>

            <div
              className="operator flex items-center justify-center text-xl sm:text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0 py-0.5"
              aria-hidden
            >
              +
            </div>

            <button
              type="button"
              onClick={toggleDetails}
              disabled={storeIncome <= 0}
              className={`flex-1 min-w-0 rounded-xl border px-3 py-3 sm:px-5 sm:py-4 text-center transition-colors print:border-sky-700 print:bg-sky-50 ${
                storeIncome > 0
                  ? 'border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10 cursor-pointer'
                  : 'border-zinc-700/40 bg-zinc-900/30 cursor-default'
              }`}
              aria-expanded={detailsOpen}
              title={storeIncome > 0 ? 'عرض تفاصيل الإيرادات الإضافية' : undefined}
            >
              <span className="inline-flex items-center justify-center gap-1 text-xs sm:text-sm text-zinc-400 print:text-zinc-600 mb-1.5 sm:mb-2">
                إيرادات إضافية للمحل
                {storeIncome > 0 ? (
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                  />
                ) : null}
              </span>
              <strong className="block text-lg sm:text-xl md:text-2xl font-bold text-sky-400 print:text-sky-700 tabular-nums">
                {formatPartnersCurrency(storeIncome)}
              </strong>
              <span className="mt-1 block text-[10px] sm:text-[11px] text-zinc-500 print:text-zinc-600">
                إيراد ربحي فقط — بدون تحصيل جمعية أو تمويل موظفين
              </span>
            </button>

            <div
              className="operator flex items-center justify-center text-xl sm:text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0 py-0.5"
              aria-hidden
            >
              −
            </div>

            <div className="flex-1 min-w-0 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-3 sm:px-5 sm:py-4 text-center print:border-amber-700 print:bg-amber-50">
              <span className="block text-xs sm:text-sm text-zinc-400 print:text-zinc-600 mb-1.5 sm:mb-2">
                الرواتب والسلف المدفوعة
              </span>
              <strong className="text-lg sm:text-xl md:text-2xl font-bold text-amber-400 print:text-amber-700 tabular-nums">
                {formatPartnersCurrency(totalPaidSalaryOrAdvance)}
              </strong>
            </div>

            <div
              className="operator flex items-center justify-center text-xl sm:text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0 py-0.5"
              aria-hidden
            >
              =
            </div>

            <div
              className={`flex-[1.2] min-w-0 rounded-xl border px-3 py-4 sm:px-5 sm:py-5 text-center print:border-zinc-400 ${
                isNegative
                  ? 'border-rose-500/30 bg-rose-500/10 print:bg-rose-50'
                  : 'border-emerald-500/35 bg-emerald-500/10 print:bg-emerald-50'
              }`}
            >
              <span className="block text-xs sm:text-sm text-zinc-400 print:text-zinc-600 mb-1.5 sm:mb-2">
                {isNegative ? 'عجز بعد الرواتب والسلف' : 'المتبقي بعد الرواتب والسلف'}
              </span>
              <strong
                className={`text-xl sm:text-2xl md:text-3xl font-bold tabular-nums ${
                  isNegative
                    ? 'text-rose-400 print:text-rose-700'
                    : 'text-emerald-400 print:text-emerald-700'
                }`}
              >
                {formatPartnersCurrency(displayRemaining)}
              </strong>
              <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs leading-relaxed text-zinc-500 print:text-zinc-600">
                المبلغ المتبقي قبل خصم باقي مصروفات التشغيل
                {storeIncome > 0 ? ' (يشمل الإيرادات الإضافية الربحية)' : ''}
              </p>
            </div>
          </div>

          {detailsOpen && storeIncome > 0 ? (
            <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 sm:p-4 space-y-3 print:border-sky-300 print:bg-sky-50">
              <p className="text-xs sm:text-sm font-medium text-sky-200 print:text-sky-800">
                تفاصيل إيرادات إضافية للمحل
              </p>
              {detailsLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري التحميل...
                </div>
              ) : detailsError ? (
                <p className="text-sm text-rose-400">{detailsError}</p>
              ) : transactions.length === 0 ? (
                <p className="text-sm text-zinc-500">لا توجد حركات مسجّلة لهذا البند</p>
              ) : (
                <div className="space-y-2">
                  {transactions.map((txn) => (
                    <div
                      key={txn.id}
                      className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 print:bg-white print:border-zinc-300"
                    >
                      <div className="min-w-0 text-sm text-zinc-300 print:text-zinc-700">
                        <span className="tabular-nums">
                          {formatTxnDate(txn.date)}
                          {txn.time ? ` — ${formatTxnTime(txn.time)}` : ''}
                        </span>
                        <span className="mx-1.5 text-zinc-600">·</span>
                        <span>{txn.notes?.trim() || 'بدون بيان'}</span>
                        <span className="mx-1.5 text-zinc-600">·</span>
                        <span className="text-zinc-500">
                          {txn.paymentMethod?.trim() || 'غير محددة'}
                        </span>
                      </div>
                      <strong className="text-sky-400 print:text-sky-700 tabular-nums shrink-0">
                        {formatPartnersCurrency(txn.amount)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
