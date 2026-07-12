'use client';

import type { ComponentType } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Wallet, Users, Banknote } from 'lucide-react';
import type { ClassifiedTotals, FinancialReportClassificationPayload } from '@/lib/types/financial-report-classification';
import { formatArabicCurrency, formatArabicNumber } from '@/lib/formatArabicNumbers';

export const CLASSIFICATION_BANNER_TEXT =
  'تم تفعيل التصنيف المحاسبي: يتم فصل الإيرادات الحقيقية عن حركات الخزنة غير الربحية.';

interface FinancialClassificationPanelProps {
  payload: Partial<FinancialReportClassificationPayload> | null | undefined;
  loading?: boolean;
  variant?: 'full' | 'income' | 'expense' | 'treasury' | 'profit';
  showCleanNetProfit?: boolean;
  legacyNetProfit?: number;
  partnerSplitExplanation?: string;
}

function fmt(amount: number) {
  return formatArabicCurrency(amount);
}

function ClassifiedCard({
  title,
  amount,
  icon: Icon,
  tone = 'default',
}: {
  title: string;
  amount: number;
  icon: ComponentType<{ className?: string }>;
  tone?: 'default' | 'positive' | 'warning' | 'neutral';
}) {
  const toneClasses = {
    default: 'border-border bg-card',
    positive: 'border-emerald-500/30 bg-emerald-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    neutral: 'border-sky-500/30 bg-sky-500/5',
  };

  return (
    <div className={`p-4 border rounded-lg ${toneClasses[tone]}`}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-sm">{title}</span>
      </div>
      <p className="text-xl font-bold">{fmt(amount)}</p>
    </div>
  );
}

function pickCards(
  totals: ClassifiedTotals,
  variant: FinancialClassificationPanelProps['variant'],
) {
  const cards: Array<{ title: string; amount: number; icon: ComponentType<{ className?: string }>; tone?: 'default' | 'positive' | 'warning' | 'neutral' }> = [];

  if (variant === 'income' || variant === 'full' || variant === 'profit') {
    cards.push(
      { title: 'إيرادات حقيقية', amount: totals.salesRevenue + totals.otherBusinessIncome, icon: TrendingUp, tone: 'positive' },
      { title: 'تدفقات داخلة غير إيراد', amount: totals.nonRevenueCashIn + totals.legacyEmployeeIncomeMirror, icon: Wallet, tone: 'warning' },
    );
  }

  if (variant === 'expense' || variant === 'full' || variant === 'profit') {
    cards.push(
      { title: 'مصروفات تشغيل', amount: totals.operatingExpense, icon: TrendingDown },
      { title: 'سلف موظفين', amount: totals.employeeAdvances, icon: Users, tone: 'warning' },
      { title: 'صرف مستحقات', amount: totals.employeePayouts, icon: Banknote, tone: 'warning' },
      { title: 'تكلفة رواتب من الدفتر', amount: totals.payrollExpenseFromLedger, icon: Users, tone: 'neutral' },
    );
  }

  if (variant === 'treasury' || variant === 'full') {
    cards.push(
      { title: 'إجمالي تدفقات واردة', amount: totals.cashInTotal, icon: TrendingUp },
      { title: 'إجمالي تدفقات صادرة', amount: totals.cashOutTotal, icon: TrendingDown },
    );
  }

  return cards;
}

export default function FinancialClassificationPanel({
  payload,
  loading = false,
  variant = 'full',
  showCleanNetProfit = true,
  legacyNetProfit,
  partnerSplitExplanation,
}: FinancialClassificationPanelProps) {
  if (!payload?.classificationEnabled || !payload.classifiedTotals) {
    return null;
  }

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-lg animate-pulse h-24 bg-muted/30" />
    );
  }

  const totals = payload.classifiedTotals;
  const cards = pickCards(totals, variant);
  const uncategorizedTotal = totals.uncategorizedCashIn + totals.uncategorizedCashOut;

  return (
    <div className="space-y-4">
      <div className="p-4 bg-sky-500/10 border border-sky-500/40 rounded-lg text-sm text-sky-950 dark:text-sky-100">
        {CLASSIFICATION_BANNER_TEXT}
      </div>

      {partnerSplitExplanation && (
        <div className="p-3 bg-muted/50 border border-border rounded-lg text-sm">
          {partnerSplitExplanation}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((card) => (
          <ClassifiedCard key={card.title} {...card} />
        ))}

        {showCleanNetProfit && (variant === 'full' || variant === 'profit') && (
          <ClassifiedCard
            title="صافي ربح نظيف"
            amount={totals.cleanNetProfit}
            icon={TrendingUp}
            tone="positive"
          />
        )}

        {legacyNetProfit != null && (
          <ClassifiedCard
            title="الطريقة القديمة"
            amount={legacyNetProfit}
            icon={Wallet}
            tone="neutral"
          />
        )}
      </div>

      {uncategorizedTotal > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-lg flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              حركات تحتاج مراجعة تصنيف
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {formatArabicNumber(totals.uncategorizedCashIn + totals.uncategorizedCashOut > 0 ? 1 : 0)} فئة —
              {' '}{fmt(uncategorizedTotal)} (واردة: {fmt(totals.uncategorizedCashIn)} / صادرة: {fmt(totals.uncategorizedCashOut)})
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function IncomeRowClassificationBadge({
  reportClassification,
}: {
  reportClassification?: {
    label: string;
    isRealRevenue: boolean;
    treasuryLabel?: string;
  };
}) {
  if (!reportClassification) return null;

  if (reportClassification.isRealRevenue) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
        {reportClassification.label}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-500/15 text-amber-900 dark:text-amber-100"
      title={reportClassification.treasuryLabel}
    >
      {reportClassification.treasuryLabel ?? reportClassification.label}
    </span>
  );
}
