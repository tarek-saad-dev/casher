'use client';

import { useState, useEffect, useCallback } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar, Users, TrendingDown, RefreshCw, Download, Search, Filter } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmployeeMonthlySummary {
  EmpID: number;
  EmpName: string;
  Job: string;
  DeductionCount: number;
  TotalDeductions: number;
  FirstDeductionDate: string;
  LastDeductionDate: string;
  DeductionDetails: string;
}

interface MonthlySummaryData {
  month: string;
  monthName: string;
  employees: EmployeeMonthlySummary[];
  summary: {
    TotalDeductionCount: number;
    GrandTotalDeductions: number;
    UniqueEmployeesCount: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const currentMonth = () => new Date().toISOString().slice(0, 7);

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeductionsMonthlyReportPage() {
  // State
  const [data, setData] = useState<MonthlySummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedEmployees, setExpandedEmployees] = useState<Set<number>>(new Set());

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth) params.set('month', selectedMonth);
      
      const res = await fetch(`/api/deductions/monthly-summary?${params.toString()}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setData(result);
    } catch (e) {
      console.error('Failed to load monthly summary:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter employees based on search
  const filteredEmployees = data?.employees.filter(emp => 
    emp.EmpName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.Job?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Toggle employee expansion
  const toggleEmployeeExpansion = (empId: number) => {
    setExpandedEmployees(prev => {
      const newSet = new Set(prev);
      if (newSet.has(empId)) {
        newSet.delete(empId);
      } else {
        newSet.add(empId);
      }
      return newSet;
    });
  };

  // Export to CSV
  const exportToCSV = () => {
    if (!data) return;
    
    const csvContent = [
      ['الموظف', 'الوظيفة', 'عدد الخصومات', 'إجمالي الخصومات', 'أول خصم', 'آخر خصم'],
      ...filteredEmployees.map(emp => [
        emp.EmpName,
        emp.Job || '',
        emp.DeductionCount.toString(),
        emp.TotalDeductions.toString(),
        emp.FirstDeductionDate,
        emp.LastDeductionDate
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `deductions-report-${selectedMonth}.csv`;
    link.click();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHeader
        title="تقرير الخصومات الشهري"
        description="عرض وتحليل خصومات الموظفين الشهرية"
      />

      {/* Controls */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Month Selector */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">الشهر</label>
            <Input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-zinc-950 border-zinc-700 text-white"
            />
          </div>

          {/* Search */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">بحث في الموظفين</label>
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
              <Input
                placeholder="بحث باسم الموظف أو الوظيفة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-zinc-950 border-zinc-700 text-white pr-7"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">إجراءات</label>
            <div className="flex gap-2">
              <Button
                onClick={loadData}
                disabled={loading}
                variant="outline"
                className="border-zinc-700 text-zinc-300"
              >
                <RefreshCw className={`w-4 h-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
              <Button
                onClick={exportToCSV}
                disabled={!data || filteredEmployees.length === 0}
                variant="outline"
                className="border-zinc-700 text-zinc-300"
              >
                <Download className="w-4 h-4 ml-1" />
                تصدير
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            title="إجمالي الخصومات"
            value={`${fmt(data.summary.GrandTotalDeductions)} ج.م`}
            icon={<TrendingDown className="w-5 h-5" />}
            variant="primary"
          />
          <KpiCard
            title="عدد العمليات"
            value={data.summary.TotalDeductionCount}
            icon={<Calendar className="w-5 h-5" />}
          />
          <KpiCard
            title="عدد الموظفين"
            value={data.summary.UniqueEmployeesCount}
            icon={<Users className="w-5 h-5" />}
            variant="success"
          />
          <KpiCard
            title="متوسط الخصم"
            value={`${fmt(data.summary.GrandTotalDeductions / Math.max(data.summary.TotalDeductionCount, 1))} ج.م`}
            icon={<TrendingDown className="w-5 h-5" />}
            variant="info"
          />
        </div>
      )}

      {/* Content */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800/60">
          <h2 className="text-sm font-bold text-zinc-300">
            {data?.monthName || 'تقرير الشهر'}
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            {filteredEmployees.length} موظف {searchTerm && '(تمت فلترة النتائج)'}
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <RefreshCw className="w-5 h-5 animate-spin ml-2" />
            <span className="text-sm">جاري التحميل...</span>
          </div>
        )}

        {/* No Data */}
        {!loading && (!data || data.employees.length === 0) && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
            <TrendingDown className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">لا توجد خصومات في الشهر المحدد</p>
          </div>
        )}

        {/* No Search Results */}
        {!loading && data && data.employees.length > 0 && filteredEmployees.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
            <Search className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">لا توجد نتائج للبحث</p>
          </div>
        )}

        {/* Employees List */}
        {!loading && filteredEmployees.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-zinc-800/60 text-xs text-zinc-500">
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-right font-medium">الوظيفة</th>
                  <th className="px-4 py-3 text-center font-medium">عدد الخصومات</th>
                  <th className="px-4 py-3 text-right font-medium">إجمالي الخصومات</th>
                  <th className="px-4 py-3 text-right font-medium">فترة الخصومات</th>
                  <th className="px-4 py-3 text-center font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp, idx) => (
                  <tr key={emp.EmpID} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-300">{emp.EmpName}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{emp.Job || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-1 rounded-full text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                        {emp.DeductionCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-red-400 whitespace-nowrap">
                      {fmt(emp.TotalDeductions)} <span className="text-[11px] font-normal text-zinc-500">ج.م</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      <div>من: {new Date(emp.FirstDeductionDate).toLocaleDateString('ar-EG')}</div>
                      <div>إلى: {new Date(emp.LastDeductionDate).toLocaleDateString('ar-EG')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          onClick={() => toggleEmployeeExpansion(emp.EmpID)}
                          variant="ghost"
                          size="sm"
                          className="text-xs px-2 py-1 h-7 text-zinc-400 hover:text-zinc-300"
                        >
                          {expandedEmployees.has(emp.EmpID) ? 'إخفاء' : 'تفاصيل'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Expanded Details */}
              {expandedEmployees.size > 0 && (
                <tbody>
                  {filteredEmployees.map((emp) => 
                    expandedEmployees.has(emp.EmpID) && (
                      <tr key={`details-${emp.EmpID}`}>
                        <td colSpan={6} className="px-4 py-3 bg-zinc-800/30">
                          <div className="text-xs text-zinc-400 space-y-2">
                            <div className="font-medium text-zinc-300">تفاصيل الخصومات:</div>
                            <div className="bg-zinc-900/50 rounded-lg p-3 text-zinc-300 leading-relaxed">
                              {emp.DeductionDetails}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              )}
              {/* Totals row */}
              {data && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                    <td colSpan={2} className="px-4 py-3 text-xs font-bold text-zinc-400">
                      الإجمالي ({filteredEmployees.length} موظف)
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-zinc-300">
                      {filteredEmployees.reduce((sum, emp) => sum + emp.DeductionCount, 0)}
                    </td>
                    <td className="px-4 py-3 font-bold text-red-400 text-base whitespace-nowrap">
                      {fmt(filteredEmployees.reduce((sum, emp) => sum + emp.TotalDeductions, 0))} <span className="text-xs font-normal text-zinc-500">ج.م</span>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
