'use client';

import { TrendingUp, Receipt, DollarSign, Calendar, Tag, AlertCircle, CreditCard } from 'lucide-react';
import type { MonthlyExpensesSummary } from '@/lib/types';

interface ExpensesKpiCardsProps {
  summary: MonthlyExpensesSummary;
  loading: boolean;
}

export default function ExpensesKpiCards({ summary, loading }: ExpensesKpiCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="p-4 bg-card border border-border rounded-lg animate-pulse">
            <div className="h-4 bg-muted rounded w-24 mb-2"></div>
            <div className="h-8 bg-muted rounded w-32"></div>
          </div>
        ))}
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const formatPercentage = (percentage: number) => {
    return percentage.toFixed(1) + '%';
  };

  return (
    <div className="space-y-4">
      {/* Warning Card for Uncategorized Expenses */}
      {summary.uncategorizedCount > 0 && (
        <div className="p-4 bg-amber-500/10 border-2 border-amber-500 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-amber-900 dark:text-amber-100 mb-1">
                ⚠️ تحذير: مصروفات تحتاج تصنيف
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                يوجد <span className="font-bold">{summary.uncategorizedCount}</span> معاملة غير مصنفة بشكل واضح 
                بإجمالي <span className="font-bold">{formatCurrency(summary.uncategorizedAmount)}</span>
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                المصروفات المصنفة كـ "تحويلات" أو "سلف" أو "مرتبات الصنايعية" أو "اقساط" تحتاج إلى مراجعة وتصنيف دقيق
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Expenses */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="h-5 w-5 text-red-500" />
          <span className="text-sm text-muted-foreground">إجمالي المصروفات</span>
        </div>
        <div className="text-2xl font-bold text-red-600">
          {formatCurrency(summary.totalExpenses)}
        </div>
      </div>

      {/* Transaction Count */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <Receipt className="h-5 w-5 text-blue-500" />
          <span className="text-sm text-muted-foreground">عدد المعاملات</span>
        </div>
        <div className="text-2xl font-bold">
          {summary.transactionCount}
        </div>
        <div className="text-xs text-muted-foreground mt-1">معاملة</div>
      </div>

      {/* Average Transaction */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-5 w-5 text-purple-500" />
          <span className="text-sm text-muted-foreground">متوسط المعاملة</span>
        </div>
        <div className="text-2xl font-bold">
          {formatCurrency(summary.averageTransaction)}
        </div>
      </div>

      {/* Average Daily Expense */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-5 w-5 text-orange-500" />
          <span className="text-sm text-muted-foreground">متوسط يومي</span>
        </div>
        <div className="text-2xl font-bold">
          {formatCurrency(summary.avgDailyExpense)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {summary.daysInMonth} يوم
        </div>
      </div>

      {/* Top Category */}
      <div className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="h-5 w-5 text-green-500" />
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
            <div className="text-xs text-green-600 font-medium mt-1">
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
          <AlertCircle className="h-5 w-5 text-amber-500" />
          <span className="text-sm text-muted-foreground">أكثر يوم صرفاً</span>
        </div>
        {summary.highestSpendDay ? (
          <>
            <div className="text-lg font-bold">
              {new Date(summary.highestSpendDay.invDate).toLocaleDateString('ar-EG', {
                day: 'numeric',
                month: 'short',
              })}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatCurrency(summary.highestSpendDay.Amount)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {summary.highestSpendDay.Count} معاملة
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
