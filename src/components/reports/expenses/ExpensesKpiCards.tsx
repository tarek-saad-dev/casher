'use client';

import { TrendingUp, Receipt, DollarSign, Calendar, Tag, AlertCircle, CreditCard } from 'lucide-react';
import type { MonthlyExpensesSummary } from '@/lib/types';
import {
  formatArabicCurrency,
  formatArabicDate,
  formatArabicNumber,
  formatArabicPercent,
} from '@/lib/formatArabicNumbers';

interface ExpensesKpiCardsProps {
  summary: MonthlyExpensesSummary;
  loading: boolean;
}

export default function ExpensesKpiCards({ summary, loading }: ExpensesKpiCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="p-4 bg-card border border-border rounded-lg animate-pulse">
            <div className="h-4 bg-muted rounded w-24 mb-2"></div>
            <div className="h-8 bg-muted rounded w-32"></div>
          </div>
        ))}
      </div>
    );
  }

  const formatCurrency = (amount: number) => formatArabicCurrency(amount);

  const formatPercentage = (percentage: number) => formatArabicPercent(percentage);

  return (
    <div className="space-y-4">
      {/* Warning Card for Uncategorized Expenses */}
      {summary.uncategorizedCount > 0 && (
        <div className="p-4 bg-warning-soft border-2 border-warning/40 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-warning mb-1">
                ⚠️ تحذير: مصروفات تحتاج تصنيف
              </h3>
              <p className="text-sm text-warning mb-2">
                يوجد <span className="font-bold">{formatArabicNumber(summary.uncategorizedCount)}</span> معاملة غير مصنفة بشكل واضح
                بإجمالي <span className="font-bold">{formatCurrency(summary.uncategorizedAmount)}</span>
              </p>
              <p className="text-xs text-warning">
                المصروفات المصنفة كـ "تحويلات" أو "سلف" أو "مرتبات الصنايعية" أو "اقساط" تحتاج إلى مراجعة وتصنيف دقيق
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* Total Expenses */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="h-5 w-5 text-destructive" />
          <span className="text-sm text-muted-foreground">إجمالي المصروفات</span>
        </div>
        <div className="text-2xl font-bold text-destructive">
          {formatCurrency(summary.totalExpenses)}
        </div>
      </div>

      {/* Transaction Count */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <Receipt className="h-5 w-5 text-info" />
          <span className="text-sm text-muted-foreground">عدد المعاملات</span>
        </div>
        <div className="text-2xl font-bold">
          {formatArabicNumber(summary.transactionCount)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">معاملة</div>
      </div>

      {/* Average Transaction */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-5 w-5 text-brand" />
          <span className="text-sm text-muted-foreground">متوسط المعاملة</span>
        </div>
        <div className="text-2xl font-bold">
          {formatCurrency(summary.averageTransaction)}
        </div>
      </div>

      {/* Average Daily Expense */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-5 w-5 text-warning" />
          <span className="text-sm text-muted-foreground">متوسط يومي</span>
        </div>
        <div className="text-2xl font-bold">
          {formatCurrency(summary.avgDailyExpense)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {formatArabicNumber(summary.daysInMonth)} يوم
        </div>
      </div>

      {/* Top Category */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="h-5 w-5 text-success" />
          <span className="text-sm text-muted-foreground">أكبر فئة</span>
        </div>
        {summary.topCategory ? (
          <>
            <div className="text-lg font-bold truncate">
              {summary.topCategory.CatName}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatCurrency(summary.topCategory.Amount)}
            </div>
            <div className="text-xs text-success font-medium mt-1">
              {formatPercentage(summary.topCategory.Percentage)}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">لا توجد بيانات</div>
        )}
      </div>

      {/* Highest Spend Day */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-5 w-5 text-warning" />
          <span className="text-sm text-muted-foreground">أكثر يوم صرفاً</span>
        </div>
        {summary.highestSpendDay ? (
          <>
            <div className="text-lg font-bold">
              {formatArabicDate(summary.highestSpendDay.invDate, {
                day: 'numeric',
                month: 'short',
              })}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatCurrency(summary.highestSpendDay.Amount)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatArabicNumber(summary.highestSpendDay.Count)} معاملة
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">لا توجد بيانات</div>
        )}
      </div>

      {/* Top Payment Method */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow col-span-1 md:col-span-2 lg:col-span-2">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="h-5 w-5 text-cyan-500" />
          <span className="text-sm text-muted-foreground">طريقة الدفع الأكثر</span>
        </div>
        {summary.topPaymentMethod ? (
          <>
            <div className="text-lg font-bold">
              {summary.topPaymentMethod.PaymentMethod}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatCurrency(summary.topPaymentMethod.Amount)}
            </div>
            <div className="text-xs text-cyan-600 font-medium mt-1">
              {formatPercentage(summary.topPaymentMethod.Percentage)}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">لا توجد بيانات</div>
        )}
      </div>
      </div>
    </div>
  );
}
