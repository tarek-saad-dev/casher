'use client';

import { useState, useEffect } from 'react';
import { Users, Loader2, AlertCircle, TrendingUp, TrendingDown, ShieldAlert } from 'lucide-react';
import EmployeeAdvanceCard from './EmployeeAdvanceCard';
import type { EmployeeAdvanceData } from '@/lib/types';

interface EmployeeAdvancesSectionProps {
  year: number;
  month: number;
}

export default function EmployeeAdvancesSection({ year, month }: EmployeeAdvancesSectionProps) {
  const [data, setData] = useState<EmployeeAdvanceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEmployeeAdvances();
  }, [year, month]);

  const fetchEmployeeAdvances = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/expenses/employee-advances?year=${year}&month=${month}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل تحميل بيانات سلف الموظفين');
      }
      const result: EmployeeAdvanceData[] = await response.json();
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12">
        <div className="flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-amber-500/60" />
          <p className="text-zinc-400">جاري تحميل بيانات سلف الموظفين...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-rose-950/20 to-red-950/10 border border-rose-500/20 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-rose-400" />
          <div>
            <h3 className="font-semibold text-rose-400">خطأ في تحميل البيانات</h3>
            <p className="text-sm text-rose-300/70">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="p-4 bg-zinc-800/40 rounded-full">
            <Users className="h-12 w-12 text-zinc-600" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2 text-white">لا توجد بيانات سلف</h3>
            <p className="text-sm text-zinc-400 max-w-md">
              لم يتم العثور على سلف موظفين في هذا الشهر.
              <br />
              تأكد من ربط فئات المصروفات بالموظفين في جدول TblExpCatEmpMap.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Calculate summary statistics
  const totalAdvances = data.reduce((sum, emp) => sum + emp.TotalAdvances, 0);
  const totalRevenue = data.reduce((sum, emp) => sum + emp.TotalRevenue, 0);
  const criticalCount = data.filter(emp => emp.RiskStatus.level === 'critical').length;
  const highRiskCount = data.filter(emp => emp.RiskStatus.level === 'high').length;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  return (
    <div className="space-y-6">
      {/* Premium Summary Header */}
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-6 shadow-xl shadow-black/10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-amber-500/10 rounded-xl">
            <Users className="h-5 w-5 text-amber-400" />
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight">سلف الموظفين</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Employee Count */}
          <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-zinc-400" />
              <p className="text-xs text-zinc-400 font-medium">عدد الموظفين</p>
            </div>
            <p className="text-3xl font-bold text-white tracking-tight">{data.length}</p>
          </div>

          {/* Total Advances */}
          <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="h-4 w-4 text-rose-400" />
              <p className="text-xs text-zinc-400 font-medium">إجمالي السلف</p>
            </div>
            <p className="text-2xl font-bold text-rose-400 tracking-tight">{formatCurrency(totalAdvances)}</p>
          </div>

          {/* Total Revenue */}
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <p className="text-xs text-zinc-400 font-medium">إجمالي الإيرادات</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400 tracking-tight">{formatCurrency(totalRevenue)}</p>
          </div>

          {/* Risk Status */}
          <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-4 w-4 text-zinc-400" />
              <p className="text-xs text-zinc-400 font-medium">حالات الخطر</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {criticalCount > 0 && (
                <span className="px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-medium rounded-full">
                  حرج: {criticalCount}
                </span>
              )}
              {highRiskCount > 0 && (
                <span className="px-2.5 py-1 bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-medium rounded-full">
                  عالي: {highRiskCount}
                </span>
              )}
              {criticalCount === 0 && highRiskCount === 0 && (
                <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium rounded-full">
                  آمن
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Employee Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {data.map((employee) => (
          <EmployeeAdvanceCard key={employee.EmpID} data={employee} />
        ))}
      </div>
    </div>
  );
}
