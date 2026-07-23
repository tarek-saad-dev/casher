'use client';

import { Users } from 'lucide-react';
import type { Partner } from '@/lib/types/monthly-report';

interface PartnerDistributionProps {
  netProfit: number;
  loading: boolean;
  /** Phase 1E: effective branch partner shares from the API response. */
  partners: Partner[];
}

export default function PartnerDistribution({ netProfit, loading, partners }: PartnerDistributionProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const formatPercentage = (percentage: number) => {
    return percentage.toFixed(4) + '%';
  };

  // Calculate profit share for each partner
  const partnerShares = partners.map(partner => ({
    ...partner,
    profitShare: netProfit * (partner.percentage / 100),
  }));

  if (loading) {
    return (
      <div className="p-6 bg-card border border-border rounded-lg">
        <div className="h-6 bg-muted rounded w-48 mb-6 animate-pulse"></div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <div className="p-6 bg-card border border-border rounded-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Users className="h-5 w-5 text-blue-500" />
          </div>
          <h3 className="text-lg font-semibold">توزيع أرباح الشركاء</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          لا توجد نسب شركاء مفعّلة لهذا الفرع في هذا التاريخ.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-500/10 rounded-lg">
          <Users className="h-5 w-5 text-blue-500" />
        </div>
        <h3 className="text-lg font-semibold">توزيع أرباح الشركاء</h3>
      </div>

      {/* Net Amount Summary - Using Treasury Terminology */}
      <div className="mb-6 p-4 bg-muted/50 rounded-lg">
        <div className="text-sm text-muted-foreground mb-1">الصافي القابل للتوزيع</div>
        <div className={`text-2xl font-bold ${netProfit >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>
          {formatCurrency(netProfit)}
        </div>
        {netProfit < 0 && (
          <div className="text-xs text-amber-600 mt-2">
            ⚠️ الصافي سالب - لا يوجد ربح للتوزيع
          </div>
        )}
      </div>

      {/* Partners Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                الشريك
              </th>
              <th className="text-center py-3 px-2 text-sm font-medium text-muted-foreground">
                النسبة
              </th>
              <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                نصيب الربح
              </th>
            </tr>
          </thead>
          <tbody>
            {partnerShares.map((partner, index) => (
              <tr 
                key={partner.name} 
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="py-4 px-2">
                  <div className="flex items-center gap-3">
                    <div 
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0 ? 'bg-emerald-500/20 text-emerald-600' :
                        index === 1 ? 'bg-blue-500/20 text-blue-600' :
                        'bg-purple-500/20 text-purple-600'
                      }`}
                    >
                      {partner.name.charAt(0)}
                    </div>
                    <span className="font-medium">{partner.name}</span>
                  </div>
                </td>
                <td className="py-4 px-2 text-center">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-muted">
                    {formatPercentage(partner.percentage)}
                  </span>
                </td>
                <td className="py-4 px-2 text-left">
                  <span className={`text-lg font-bold ${
                    partner.profitShare >= 0 ? 'text-emerald-600' : 'text-amber-600'
                  }`}>
                    {formatCurrency(partner.profitShare)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30">
              <td className="py-4 px-2 font-bold">الإجمالي</td>
              <td className="py-4 px-2 text-center">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-bold bg-primary/10 text-primary">
                  {formatPercentage(partners.reduce((sum, p) => sum + p.percentage, 0))}
                </span>
              </td>
              <td className="py-4 px-2 text-left">
                <span className={`text-lg font-bold ${
                  netProfit >= 0 ? 'text-emerald-600' : 'text-amber-600'
                }`}>
                  {formatCurrency(netProfit)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* TODO Phase 2 Notice */}
      <div className="mt-6 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <div className="text-amber-500 text-lg">⚠️</div>
          <div>
            <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
              TODO - المرحلة الثانية
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              سيتم إضافة تقارير تحليلية متقدمة للشركاء ومقارنات شهرية ورسوم بيانية تفصيلية
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
