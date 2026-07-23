'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Wallet, Calendar, ChevronDown, Loader2, FileDown, BarChart3 } from 'lucide-react';
import type { MonthlyBusinessReport } from '@/lib/types/monthly-report';
import { calculateMonthlyFinancialEquations } from '@/lib/reports/monthlyFinancialEquations';
import MonthlyFinancialEquations from '@/components/reports/MonthlyFinancialEquations';
import FinancialClassificationPanel from '@/components/reports/FinancialClassificationPanel';
import { generateMonthlyReportPDF, downloadPDF } from '@/lib/services/MonthlyReportPDFService';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

const YEARS = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i);

// Currency formatter
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ج.م';
};

export default function MonthlyBusinessReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MonthlyBusinessReport | null>(null);

  // Set page title
  useEffect(() => {
    document.title = 'تقرير الأرباح الشهرية | نظام Hawai POS';
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/reports/monthly?year=${year}&month=${month}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل تحميل التقرير');
      }

      const data: MonthlyBusinessReport = await response.json();
      setReport(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
      console.error('[MonthlyBusinessReport] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load report on mount
  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdate = () => {
    fetchReport();
  };

  const handleExportPDF = async () => {
    if (!report) return;
    
    setPdfLoading(true);
    try {
      const blob = await generateMonthlyReportPDF({
        month,
        year,
        report,
        generatedBy: 'Hawai POS System',
      });
      
      const fileName = `Monthly-Report-${year}-${String(month).padStart(2, '0')}.pdf`;
      downloadPDF(blob, fileName);
    } catch (err) {
      console.error('[MonthlyBusinessReport] PDF Export Error:', err);
      alert('حدث خطأ أثناء تصدير PDF. يرجى المحاولة مرة أخرى.');
    } finally {
      setPdfLoading(false);
    }
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const partners = report?.partners ?? [];
  const partnerEquations = report && partners.length > 0
    ? calculateMonthlyFinancialEquations({
        year,
        month,
        baseAmount: report.classifiedTotals?.cleanNetProfit ?? report.netProfit,
        mode: 'monthly',
        partners,
      })
    : null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-lg">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">تقرير الأرباح الشهرية</h1>
              <p className="text-sm text-muted-foreground">
                {ARABIC_MONTHS[month - 1]} {year}
                {isCurrentMonth && ' (الشهر الحالي)'}
              </p>
            </div>
          </div>

          {/* Export PDF Button - Enabled */}
          <button
            onClick={handleExportPDF}
            disabled={!report || pdfLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="تصدير التقرير PDF للطباعة أو المشاركة"
          >
            {pdfLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>جاري الإنشاء...</span>
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                <span>Export PDF</span>
              </>
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            {/* Month Picker */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">الشهر:</span>
              <div className="relative">
                <select
                  value={month}
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                  className="appearance-none bg-background border border-border rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary min-w-[140px]"
                >
                  {ARABIC_MONTHS.map((name, index) => (
                    <option key={index + 1} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Year Picker */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">السنة:</span>
              <div className="relative">
                <select
                  value={year}
                  onChange={(e) => setYear(parseInt(e.target.value))}
                  className="appearance-none bg-background border border-border rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary min-w-[100px]"
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Update Button */}
            <button
              onClick={handleUpdate}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>جاري التحميل...</span>
                </>
              ) : (
                <>
                  <BarChart3 className="h-4 w-4" />
                  <span>تحديث التقرير</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
            <p className="text-destructive font-medium">خطأ: {error}</p>
          </div>
        )}

        {/* Report Content - Simplified Version */}
        {report && (
          <div className="space-y-6">
            <FinancialClassificationPanel
              payload={report}
              loading={loading}
              variant="profit"
              legacyNetProfit={report.netProfit}
            />

            {/* 3 Simple Cards: Revenue, Expenses, Net Profit */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Revenue Card */}
              <div className="bg-card border border-border rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <TrendingUp className="h-6 w-6 text-emerald-500" />
                  </div>
                  <span className="text-sm text-muted-foreground">إجمالي الوارد</span>
                </div>
                <div className="text-2xl font-bold text-emerald-500">
                  {formatCurrency(report.totalRevenue)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Revenue</div>
              </div>

              {/* Expenses Card */}
              <div className="bg-card border border-border rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-rose-500/10 rounded-lg">
                    <TrendingDown className="h-6 w-6 text-rose-500" />
                  </div>
                  <span className="text-sm text-muted-foreground">إجمالي المصروف</span>
                </div>
                <div className="text-2xl font-bold text-rose-500">
                  {formatCurrency(report.totalExpenses)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Expenses</div>
              </div>

              {/* Net Profit Card */}
              <div className="bg-card border border-border rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Wallet className="h-6 w-6 text-blue-500" />
                  </div>
                  <span className="text-sm text-muted-foreground">صافي الربح</span>
                </div>
                <div className={`text-2xl font-bold ${report.netProfit >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                  {formatCurrency(report.netProfit)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Net Profit</div>
              </div>
            </div>

            {partnerEquations && (
              <MonthlyFinancialEquations
                result={partnerEquations}
                title="توزيع أرباح الشركاء"
                baseAmountLabel="صافي الربح"
                distributableLabel="المبلغ النهائي القابل للتوزيع"
                lossDistributableLabel="خسارة قابلة للتوزيع"
                variant="monthly"
              />
            )}

            {/* Data Source Info */}
            <div className="bg-muted/30 border border-border/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground text-center">
                مصدر الوارد: تقرير خدمات الموظفين | صافي الربح: الخزنة | المصروفات: محسوبة (الوارد - الصافي)
              </p>
            </div>
          </div>
        )}

        {/* Empty State - No Report Yet */}
        {!report && !loading && !error && (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              اختر الشهر والسنة ثم اضغط &quot;تحديث التقرير&quot; لعرض البيانات
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
