'use client';

import { useState, useEffect } from 'react';
import { FileText, BarChart3, TrendingUp, List, Users } from 'lucide-react';
import ExpensesReportFilters from '@/components/reports/expenses/ExpensesReportFilters';
import ExpensesKpiCards from '@/components/reports/expenses/ExpensesKpiCards';
import ExpenseCategoryBreakdown from '@/components/reports/expenses/ExpenseCategoryBreakdown';
import ExpenseDailyTrend from '@/components/reports/expenses/ExpenseDailyTrend';
import ExpenseByCategoryView from '@/components/reports/expenses/ExpenseByCategoryView';
import ExpenseTransactionsTable from '@/components/reports/expenses/ExpenseTransactionsTable';
import EmployeeAdvancesSection from '@/components/reports/expenses/EmployeeAdvancesSection';
import type { MonthlyExpensesReport } from '@/lib/types';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

type TabType = 'summary' | 'category-breakdown' | 'daily-trend' | 'employee-advances' | 'transactions';

export default function MonthlyExpensesReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [report, setReport] = useState<MonthlyExpensesReport | null>(null);

  // Set page title
  useEffect(() => {
    document.title = 'تقرير المصروفات الشهري | نظام نقاط البيع';
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/reports/expenses/monthly?year=${year}&month=${month}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل تحميل التقرير');
      }

      const data: MonthlyExpensesReport = await response.json();
      setReport(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
      console.error('[MonthlyExpensesReport] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load report on mount and when filters change
  useEffect(() => {
    fetchReport();
  }, []); // Only on mount

  const handleUpdate = () => {
    fetchReport();
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 rounded-lg">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">تقرير المصروفات الشهرية</h1>
            <p className="text-sm text-muted-foreground">
              {ARABIC_MONTHS[month - 1]} {year}
              {isCurrentMonth && ' (الشهر الحالي)'}
            </p>
          </div>
        </div>

        {/* Filters */}
        <ExpensesReportFilters
          month={month}
          year={year}
          onMonthChange={setMonth}
          onYearChange={setYear}
          onUpdate={handleUpdate}
          loading={loading}
        />

        {/* Error State */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
            <p className="text-destructive font-medium">خطأ: {error}</p>
          </div>
        )}

        {/* Tab Navigation */}
        {report && (
          <div className="bg-card border border-border rounded-lg p-2">
            <div className="flex gap-2 overflow-x-auto">
              <button
                onClick={() => setActiveTab('summary')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'summary'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                الملخص
              </button>
              <button
                onClick={() => setActiveTab('category-breakdown')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'category-breakdown'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <List className="h-4 w-4" />
                حسب الفئة
              </button>
              <button
                onClick={() => setActiveTab('daily-trend')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'daily-trend'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <TrendingUp className="h-4 w-4" />
                الاتجاه اليومي
              </button>
              <button
                onClick={() => setActiveTab('employee-advances')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'employee-advances'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <Users className="h-4 w-4" />
                سلف الموظفين
              </button>
              <button
                onClick={() => setActiveTab('transactions')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'transactions'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <FileText className="h-4 w-4" />
                المعاملات
              </button>
            </div>
          </div>
        )}

        {/* Report Content */}
        {report && (
          <>
            {/* Summary Tab */}
            {activeTab === 'summary' && (
              <ExpensesKpiCards summary={report.summary} loading={loading} />
            )}

            {/* Category Breakdown Tab */}
            {activeTab === 'category-breakdown' && (
              <>
                <ExpenseCategoryBreakdown
                  categories={report.categoryBreakdown}
                  totalExpenses={report.summary.totalExpenses}
                  loading={loading}
                />
                <ExpenseByCategoryView
                  transactions={report.transactions}
                  loading={loading}
                  onRefresh={fetchReport}
                />
              </>
            )}

            {/* Daily Trend Tab */}
            {activeTab === 'daily-trend' && (
              <ExpenseDailyTrend
                dailyTrend={report.dailyTrend}
                highestDay={report.summary.highestSpendDay}
                loading={loading}
              />
            )}

            {/* Employee Advances Tab */}
            {activeTab === 'employee-advances' && (
              <EmployeeAdvancesSection year={year} month={month} />
            )}

            {/* Transactions Tab */}
            {activeTab === 'transactions' && (
              <ExpenseTransactionsTable
                transactions={report.transactions}
                loading={loading}
                onRefresh={fetchReport}
              />
            )}
          </>
        )}

        {/* Empty State - No Report Yet */}
        {!report && !loading && !error && (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              اختر الشهر والسنة ثم اضغط "تحديث" لعرض التقرير
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
