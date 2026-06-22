'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Users, TrendingDown, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

interface MonthlySummaryProps {
  isVisible: boolean;
  onToggle: () => void;
}

export default function MonthlySummary({ isVisible, onToggle }: MonthlySummaryProps) {
  const [data, setData] = useState<MonthlySummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedEmployees, setExpandedEmployees] = useState<Set<number>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/deductions/monthly-summary');
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setData(result);
    } catch (err) {
      console.error('Failed to load monthly summary:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible && !data) {
      loadData();
    }
  }, [isVisible, data, loadData]);

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

  if (!isVisible) {
    return (
      <div className="px-3 py-2 border-b border-border bg-zinc-900/40">
        <Button
          onClick={onToggle}
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-zinc-400 hover:text-zinc-300"
        >
          <span className="flex items-center gap-2">
            <Calendar className="w-3 h-3" />
            عرض ملخص الشهر
          </span>
          <ChevronDown className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-border bg-zinc-900/40">
      <Button
        onClick={onToggle}
        variant="ghost"
        size="sm"
        className="w-full justify-between text-xs text-zinc-400 hover:text-zinc-300 mb-3"
      >
        <span className="flex items-center gap-2">
          <Calendar className="w-3 h-3" />
          إخفاء ملخص الشهر
        </span>
        <ChevronUp className="w-3 h-3" />
      </Button>

      {loading && (
        <div className="flex items-center justify-center py-4 text-zinc-500">
          <RefreshCw className="w-4 h-4 animate-spin ml-2" />
          <span className="text-xs">جاري تحميل الملخص...</span>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-3">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
                <Users className="w-3 h-3" />
                <span className="text-[9px]">موظفين</span>
              </div>
              <p className="text-sm font-bold text-zinc-200">{data.summary.UniqueEmployeesCount}</p>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
                <TrendingDown className="w-3 h-3" />
                <span className="text-[9px]">عمليات</span>
              </div>
              <p className="text-sm font-bold text-zinc-200">{data.summary.TotalDeductionCount}</p>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
                <TrendingDown className="w-3 h-3" />
                <span className="text-[9px]">الإجمالي</span>
              </div>
              <p className="text-sm font-bold text-red-400">
                {data.summary.GrandTotalDeductions?.toLocaleString('ar-EG')} ج.م
              </p>
            </div>
          </div>

          {/* Month Header */}
          <div className="text-center">
            <h3 className="text-sm font-bold text-zinc-200">{data.monthName}</h3>
            <p className="text-xs text-zinc-500">ملخص الخصومات الشهرية</p>
          </div>

          {/* Employees List */}
          {data.employees.length === 0 ? (
            <div className="text-center py-4 text-zinc-500">
              <p className="text-xs">لا توجد خصومات هذا الشهر</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {data.employees.map((emp) => (
                <div
                  key={emp.EmpID}
                  className="bg-zinc-800/30 border border-zinc-700 rounded-lg p-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-zinc-200 truncate">
                          {emp.EmpName}
                        </span>
                        {emp.Job && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            {emp.Job}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        <span>{emp.DeductionCount} عملية</span>
                        <span className="text-red-400 font-bold">
                          {emp.TotalDeductions?.toLocaleString('ar-EG')} ج.م
                        </span>
                      </div>
                    </div>
                    <Button
                      onClick={() => toggleEmployeeExpansion(emp.EmpID)}
                      variant="ghost"
                      size="sm"
                      className="p-1 h-6 w-6 text-zinc-400 hover:text-zinc-300"
                    >
                      {expandedEmployees.has(emp.EmpID) ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </Button>
                  </div>

                  {/* Expanded Details */}
                  {expandedEmployees.has(emp.EmpID) && (
                    <div className="mt-2 pt-2 border-t border-zinc-700">
                      <div className="text-[10px] text-zinc-400 space-y-1">
                        <div className="flex justify-between">
                          <span>أول خصم:</span>
                          <span>{new Date(emp.FirstDeductionDate).toLocaleDateString('ar-EG')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>آخر خصم:</span>
                          <span>{new Date(emp.LastDeductionDate).toLocaleDateString('ar-EG')}</span>
                        </div>
                        <div className="mt-2">
                          <div className="font-medium text-zinc-300 mb-1">تفاصيل الخصومات:</div>
                          <div className="text-zinc-400 leading-relaxed">
                            {emp.DeductionDetails}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Refresh Button */}
          <div className="flex justify-center pt-2">
            <Button
              onClick={loadData}
              variant="outline"
              size="sm"
              className="text-xs border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
            >
              <RefreshCw className="w-3 h-3 ml-1" />
              تحديث
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
