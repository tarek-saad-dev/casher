'use client';

import type { CategoryBreakdown } from '@/lib/types';

interface ExpenseCategoryBreakdownProps {
  categories: CategoryBreakdown[];
  totalExpenses: number;
  loading: boolean;
}

export default function ExpenseCategoryBreakdown({
  categories,
  totalExpenses,
  loading,
}: ExpenseCategoryBreakdownProps) {
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

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">التوزيع حسب الفئة</h3>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">التوزيع حسب الفئة</h3>
        <div className="text-center py-8 text-muted-foreground">
          لا توجد بيانات للعرض
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">التوزيع حسب الفئة</h3>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">#</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">الفئة</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">المبلغ</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">العدد</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">المتوسط</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">النسبة</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => {
              const isTop3 = index < 3;
              const barWidth = category.Percentage;
              
              return (
                <tr
                  key={category.ExpINID}
                  className={`border-b border-border hover:bg-muted/50 transition-colors ${
                    isTop3 ? 'bg-primary/5' : ''
                  }`}
                >
                  <td className="py-3 px-2 text-sm">
                    {isTop3 && (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold">
                        {index + 1}
                      </span>
                    )}
                    {!isTop3 && <span className="text-muted-foreground">{index + 1}</span>}
                  </td>
                  <td className="py-3 px-2 text-sm font-medium">{category.CatName}</td>
                  <td className="py-3 px-2 text-sm font-bold text-red-600">
                    {formatCurrency(category.Amount)}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {category.Count}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {formatCurrency(category.AvgTransaction)}
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-500"
                          style={{ width: `${Math.min(barWidth, 100)}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium text-muted-foreground min-w-[3rem] text-left">
                        {formatPercentage(category.Percentage)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
