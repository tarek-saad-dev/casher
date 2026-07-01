'use client';

import { Users } from 'lucide-react';
import type { MonthlyFinancialEquationsResult } from '@/lib/reports/monthlyFinancialEquations';
import { formatPartnerPercentage } from '@/lib/reports/monthlyFinancialEquations';

export interface MonthlyFinancialEquationsProps {
  result: MonthlyFinancialEquationsResult;
  title: string;
  subtitle?: string;
  baseAmountLabel: string;
  distributableLabel: string;
  lossDistributableLabel?: string;
  variant?: 'monthly' | 'partners';
  loading?: boolean;
}

function formatCurrency(amount: number, variant: 'monthly' | 'partners'): string {
  const formatted = new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);

  return `${formatted} ج.م`;
}

function TableSkeleton({ variant }: { variant: 'monthly' | 'partners' }) {
  const rowClass =
    variant === 'partners'
      ? 'h-12 bg-zinc-800/40 rounded animate-pulse'
      : 'h-12 bg-muted rounded animate-pulse';

  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, index) => (
        <div key={index} className={rowClass} />
      ))}
    </div>
  );
}

export default function MonthlyFinancialEquations({
  result,
  title,
  subtitle,
  baseAmountLabel,
  distributableLabel,
  lossDistributableLabel = 'خسارة قابلة للتوزيع',
  variant = 'monthly',
  loading = false,
}: MonthlyFinancialEquationsProps) {
  const isPartners = variant === 'partners';
  const isLoss = result.isLoss;
  const positiveClass = isPartners ? 'text-emerald-400 print:text-emerald-700' : 'text-emerald-500';
  const negativeClass = isPartners ? 'text-rose-400 print:text-rose-700' : 'text-rose-500';
  const amountClass = isLoss ? negativeClass : positiveClass;
  const displayDistributableLabel = isLoss ? lossDistributableLabel : distributableLabel;

  const sectionClass = isPartners
    ? 'w-full min-w-0 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 sm:p-4 md:p-6 print:break-inside-avoid print:bg-white print:border-zinc-300'
    : 'bg-card border border-border rounded-lg p-6';

  const summaryClass = isPartners
    ? `rounded-xl border px-3 py-3 sm:px-5 sm:py-4 mb-4 sm:mb-6 print:border-zinc-300 ${
        isLoss
          ? 'border-rose-500/30 bg-rose-500/10 print:bg-rose-50'
          : 'border-emerald-500/35 bg-emerald-500/10 print:bg-emerald-50'
      }`
    : `mb-6 p-4 rounded-lg ${
        isLoss ? 'bg-rose-500/10 border border-rose-500/30' : 'bg-muted/50'
      }`;

  const tableHeadClass = isPartners
    ? 'border-b border-zinc-800 text-zinc-400 print:border-zinc-300 print:text-zinc-600'
    : 'border-b border-border text-muted-foreground';

  const tableRowClass = isPartners
    ? 'border-b border-zinc-800/60 print:border-zinc-300'
    : 'border-b border-border/50';

  if (loading) {
    return (
      <section className={sectionClass} dir="rtl">
        <div className="h-6 w-56 bg-zinc-800/40 rounded animate-pulse mb-4" />
        <TableSkeleton variant={variant} />
      </section>
    );
  }

  return (
    <section className={sectionClass} dir="rtl">
      <div className="flex items-center gap-3 mb-2">
        <div
          className={
            isPartners
              ? 'p-2 bg-amber-500/10 rounded-lg print:bg-amber-50 shrink-0'
              : 'p-2 bg-primary/10 rounded-lg'
          }
        >
          <Users
            className={
              isPartners
                ? 'h-5 w-5 text-amber-400 print:text-amber-700'
                : 'h-5 w-5 text-primary'
            }
          />
        </div>
        <div className="min-w-0">
          <h2
            className={
              isPartners
                ? 'text-base sm:text-lg font-bold text-white print:text-black'
                : 'text-lg font-semibold'
            }
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              className={
                isPartners
                  ? 'text-xs sm:text-sm text-zinc-500 print:text-zinc-600 mt-1'
                  : 'text-xs text-muted-foreground mt-1'
              }
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      <div className={summaryClass}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="min-w-0">
            <p
              className={
                isPartners
                  ? 'text-xs sm:text-sm text-zinc-400 print:text-zinc-600 mb-1'
                  : 'text-sm text-muted-foreground mb-1'
              }
            >
              {baseAmountLabel}
            </p>
            <p className={`text-lg sm:text-xl font-bold tabular-nums ${amountClass}`}>
              {formatCurrency(result.baseAmount, variant)}
            </p>
          </div>
          <div className="min-w-0">
            <p
              className={
                isPartners
                  ? 'text-xs sm:text-sm text-zinc-400 print:text-zinc-600 mb-1'
                  : 'text-sm text-muted-foreground mb-1'
              }
            >
              {displayDistributableLabel}
            </p>
            <p className={`text-xl sm:text-2xl md:text-3xl font-bold tabular-nums ${amountClass}`}>
              {formatCurrency(Math.abs(result.finalDistributableAmount), variant)}
            </p>
          </div>
        </div>
      </div>

      {isPartners ? (
        <>
          <div className="md:hidden print:hidden space-y-2">
            {result.partnerShares.map((partner) => (
              <article
                key={partner.name}
                className="w-full min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3 sm:p-4"
              >
                <h3 className="text-base font-bold text-white break-words mb-3 border-b border-zinc-800/60 pb-2">
                  {partner.name}
                </h3>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm text-zinc-400">النسبة</span>
                  <span className="text-sm text-zinc-300 tabular-nums">
                    {formatPartnerPercentage(partner.percentage)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-400">نصيب الربح</span>
                  <span className={`text-base font-bold tabular-nums ${amountClass}`}>
                    {formatCurrency(partner.profitShare, variant)}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden md:block print:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="text-right py-3 px-2 font-medium">الشريك</th>
                  <th className="text-center py-3 px-2 font-medium">النسبة</th>
                  <th className="text-center py-3 px-2 font-medium">نصيب الربح</th>
                </tr>
              </thead>
              <tbody>
                {result.partnerShares.map((partner) => (
                  <tr key={partner.name} className={`${tableRowClass} print:break-inside-avoid`}>
                    <td className="py-3 px-2 text-white font-medium print:text-black break-words">
                      {partner.name}
                    </td>
                    <td className="py-3 px-2 text-center text-zinc-400 print:text-zinc-600 tabular-nums">
                      {formatPartnerPercentage(partner.percentage)}
                    </td>
                    <td className="py-3 px-2 text-center tabular-nums">
                      <span className={`font-bold ${amountClass}`}>
                        {formatCurrency(partner.profitShare, variant)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadClass}>
                <th className="text-right py-3 px-2 font-medium">الشريك</th>
                <th className="text-center py-3 px-2 font-medium">النسبة</th>
                <th className="text-center py-3 px-2 font-medium">نصيب الربح</th>
              </tr>
            </thead>
            <tbody>
              {result.partnerShares.map((partner) => (
                <tr key={partner.name} className={`${tableRowClass} print:break-inside-avoid`}>
                  <td className="py-4 px-4 font-medium break-words">{partner.name}</td>
                  <td className="py-4 px-4 text-center text-muted-foreground tabular-nums">
                    {formatPartnerPercentage(partner.percentage)}
                  </td>
                  <td className="py-4 px-4 text-center tabular-nums">
                    <span className={`font-bold ${amountClass}`}>
                      {formatCurrency(partner.profitShare, variant)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        className={
          isPartners
            ? 'mt-4 sm:mt-6 p-3 sm:p-4 bg-zinc-800/40 rounded-lg print:bg-zinc-100 print:border print:border-zinc-300'
            : 'mt-6 p-4 bg-muted/50 rounded-lg'
        }
      >
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-4 min-w-0">
          <span
            className={
              isPartners
                ? 'text-sm text-zinc-400 print:text-zinc-600'
                : 'text-sm text-muted-foreground'
            }
          >
            إجمالي المبالغ الموزعة
          </span>
          <span className={`text-lg sm:text-xl font-bold tabular-nums ${amountClass}`}>
            {formatCurrency(result.finalDistributableAmount, variant)}
          </span>
        </div>
      </div>
    </section>
  );
}
