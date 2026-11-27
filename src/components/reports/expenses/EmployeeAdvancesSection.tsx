'use client';

import { useState, useEffect } from 'react';
import { Users, Loader2, AlertCircle, TrendingUp, TrendingDown, ShieldAlert, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmployeeAdvanceCard from './EmployeeAdvanceCard';
import type { EmployeeAdvanceData } from '@/lib/types';
import {
  formatNumberByScript,
  type NumberScript,
} from '@/lib/formatArabicNumbers';

interface EmployeeAdvancesSectionProps {
  year: number;
  month: number;
}

export default function EmployeeAdvancesSection({ year, month }: EmployeeAdvancesSectionProps) {
  const [data, setData] = useState<EmployeeAdvanceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());
  const [numberScript, setNumberScript] = useState<NumberScript>('arab');

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
      <div className="bg-card border border-border rounded-2xl p-12">
        <div className="flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-warning" />
          <p className="text-muted-foreground">جاري تحميل بيانات سلف الموظفين...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive-soft border border-destructive/20 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <h3 className="font-semibold text-destructive">خطأ في تحميل البيانات</h3>
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-12">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="p-4 bg-muted rounded-full">
            <Users className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2 text-foreground">لا توجد بيانات سلف</h3>
            <p className="text-sm text-muted-foreground max-w-md">
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

  const toggleCardVisibility = (empId: number) => {
    setVisibleCards(prev => {
      const next = new Set(prev);
      if (next.has(empId)) {
        next.delete(empId);
      } else {
        next.add(empId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Premium Summary Header */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-warning-soft rounded-xl">
              <Users className="h-5 w-5 text-warning" />
            </div>
            <h3 className="text-2xl font-bold text-foreground tracking-tight">سلف الموظفين</h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setNumberScript((s) => (s === 'arab' ? 'latin' : 'arab'))}
            className="gap-2 border-border bg-muted text-foreground hover:bg-surface-muted hover:text-foreground shrink-0"
            title={numberScript === 'arab' ? 'التبديل إلى أرقام إنجليزية (0-9)' : 'التبديل إلى أرقام عربية (٠-٩)'}
          >
            <Languages className="h-4 w-4" />
            {numberScript === 'arab' ? '0-9' : '٠-٩'}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Employee Count */}
          <div className="bg-muted border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">عدد الموظفين</p>
            </div>
            <p className="text-3xl font-bold text-foreground tracking-tight">
              {formatNumberByScript(data.length, numberScript)}
            </p>
          </div>

          {/* Total Advances */}
          <div className="bg-destructive-soft border border-destructive/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              <p className="text-xs text-muted-foreground font-medium">إجمالي السلف</p>
            </div>
            <p className="text-2xl font-bold text-destructive tracking-tight">****</p>
          </div>

          {/* Total Revenue */}
          <div className="bg-success-soft border border-success/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <p className="text-xs text-muted-foreground font-medium">إجمالي الإيرادات</p>
            </div>
            <p className="text-2xl font-bold text-success tracking-tight">****</p>
          </div>

          {/* Risk Status */}
          <div className="bg-muted border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">حالات الخطر</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {criticalCount > 0 && (
                <span className="px-2.5 py-1 bg-destructive-soft text-destructive border border-destructive/20 text-xs font-medium rounded-full">
                  حرج: {formatNumberByScript(criticalCount, numberScript)}
                </span>
              )}
              {highRiskCount > 0 && (
                <span className="px-2.5 py-1 bg-warning-soft text-warning border border-warning/20 text-xs font-medium rounded-full">
                  عالي: {formatNumberByScript(highRiskCount, numberScript)}
                </span>
              )}
              {criticalCount === 0 && highRiskCount === 0 && (
                <span className="px-2.5 py-1 bg-success-soft text-success border border-success/20 text-xs font-medium rounded-full">
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
          <EmployeeAdvanceCard
            key={employee.EmpID}
            data={employee}
            isVisible={visibleCards.has(employee.EmpID)}
            onToggleVisibility={() => toggleCardVisibility(employee.EmpID)}
            numberScript={numberScript}
          />
        ))}
      </div>
    </div>
  );
}
