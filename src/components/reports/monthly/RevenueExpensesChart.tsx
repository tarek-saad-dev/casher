'use client';

import { useMemo } from 'react';
import type { DailyRevenueExpensesData } from '@/lib/types/monthly-report';

interface RevenueExpensesChartProps {
  dailyData: DailyRevenueExpensesData[];
  loading: boolean;
}

// Simple bar chart component without external dependencies
export default function RevenueExpensesChart({ dailyData, loading }: RevenueExpensesChartProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDay = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.getDate().toString();
  };

  const chartData = useMemo(() => {
    // Filter out days with no data for cleaner chart
    const activeDays = dailyData.filter(d => d.revenue > 0 || d.expenses > 0);
    
    // If too many days, group by every 3 days for mobile
    return activeDays.length > 0 ? activeDays : dailyData.slice(0, 10);
  }, [dailyData]);

  const maxValue = useMemo(() => {
    const max = Math.max(...chartData.map(d => Math.max(d.revenue, d.expenses)));
    return max > 0 ? max : 1000;
  }, [chartData]);

  if (loading) {
    return (
      <div className="p-6 bg-card border border-border rounded-lg">
        <div className="h-6 bg-muted rounded w-48 mb-6 animate-pulse"></div>
        <div className="h-64 bg-muted rounded animate-pulse"></div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="p-6 bg-card border border-border rounded-lg">
        <h3 className="text-lg font-semibold mb-4">الوارد vs الصادر</h3>
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          لا توجد بيانات للعرض
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-card border border-border rounded-lg">
      <h3 className="text-lg font-semibold mb-6">الوارد vs الصادر - حسب اليوم</h3>
      
      {/* Legend - Using Treasury Terminology */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-success rounded"></div>
          <span className="text-sm text-muted-foreground">الوارد (Incoming)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-destructive rounded"></div>
          <span className="text-sm text-muted-foreground">الصادر (Outgoing)</span>
        </div>
      </div>

      {/* Chart Container */}
      <div className="overflow-x-auto">
        <div className="min-w-full">
          {/* Y-axis labels */}
          <div className="flex items-end gap-2 h-64">
            {/* Bars */}
            <div className="flex-1 flex items-end justify-around gap-1 h-full">
              {chartData.map((day, index) => {
                const revenueHeight = (day.revenue / maxValue) * 100;
                const expensesHeight = (day.expenses / maxValue) * 100;
                
                return (
                  <div key={day.day} className="flex flex-col items-center gap-1 min-w-[24px]">
                    {/* Revenue Bar */}
                    <div className="relative group">
                      <div
                        className="w-3 bg-success rounded-t transition-all duration-300"
                        style={{ height: `${Math.max(revenueHeight, 2)}px` }}
                      ></div>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        وارد: {formatCurrency(day.revenue)} ج.م
                      </div>
                    </div>
                    
                    {/* Expenses Bar */}
                    <div className="relative group">
                      <div
                        className="w-3 bg-destructive rounded-t transition-all duration-300"
                        style={{ height: `${Math.max(expensesHeight, 2)}px` }}
                      ></div>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        صادر: {formatCurrency(day.expenses)} ج.م
                      </div>
                    </div>
                    
                    {/* Day label */}
                    <span className="text-xs text-muted-foreground mt-1">
                      {formatDay(day.day)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats - Treasury Terminology */}
      <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-border">
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-1">متوسط الوارد اليومي</div>
          <div className="text-lg font-semibold text-emerald-600">
            {formatCurrency(
              dailyData.reduce((sum, d) => sum + d.revenue, 0) / dailyData.length
            )} ج.م
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-1">متوسط الصادر اليومي</div>
          <div className="text-lg font-semibold text-rose-600">
            {formatCurrency(
              dailyData.reduce((sum, d) => sum + d.expenses, 0) / dailyData.length
            )} ج.م
          </div>
        </div>
      </div>
    </div>
  );
}
