'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Coins, DollarSign,
  Users, ShoppingBag, Award
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import StatCard from '@/components/cut-club/StatCard';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton, ChartSkeleton } from '@/components/cut-club/LoadingSkeleton';

interface AnalyticsData {
  coinsGenerated: number;
  coinsSpent: number;
  outstandingLiability: number;
  avgClientBalance: number;
  avgPurchasesPerClient: number;
  vipConversionRate: number;
  monthlyData: {
    month: string;
    issued: number;
    spent: number;
    revenue: number;
  }[];
  tierDistribution: {
    tier: string;
    count: number;
    percentage: number;
  }[];
  topRewards: {
    name: string;
    purchases: number;
    usage: number;
  }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const mockData: AnalyticsData = {
        coinsGenerated: 125840,
        coinsSpent: 45230,
        outstandingLiability: 80610,
        avgClientBalance: 235.7,
        avgPurchasesPerClient: 2.3,
        vipConversionRate: 8.2,
        monthlyData: [
          { month: 'يناير', issued: 18500, spent: 6200, revenue: 124000 },
          { month: 'فبراير', issued: 19200, spent: 6800, revenue: 136000 },
          { month: 'مارس', issued: 21000, spent: 7500, revenue: 148000 },
          { month: 'أبريل', issued: 22300, spent: 8100, revenue: 156000 },
          { month: 'مايو', issued: 23500, spent: 8900, revenue: 168000 },
          { month: 'يونيو', issued: 21340, spent: 7730, revenue: 152000 },
        ],
        tierDistribution: [
          { tier: 'BRONZE', count: 245, percentage: 71.6 },
          { tier: 'SILVER', count: 69, percentage: 20.2 },
          { tier: 'GOLD', count: 28, percentage: 8.2 },
          { tier: 'VIP', count: 12, percentage: 3.5 },
        ],
        topRewards: [
          { name: 'تسريحة مجانية', purchases: 145, usage: 98 },
          { name: 'خصم 20%', purchases: 89, usage: 76 },
          { name: 'ترقية VIP', purchases: 28, usage: 28 },
          { name: 'منتج العناية', purchases: 34, usage: 22 },
        ],
      };

      setData(mockData);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 0,
    }).format(num);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={BarChart3}
        title="تحليلات الاقتصاد"
        description="مراقبة صحة اقتصاد الولاء"
        gradient="from-cyan-500/20 to-blue-600/20"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                title="النقاط الصادرة"
                value={formatNumber(data?.coinsGenerated || 0)}
                icon={Coins}
                trend={{ value: '+12.5%', isPositive: true }}
                iconColor="text-yellow-400"
                iconBgColor="bg-yellow-500/10"
              />
              <StatCard
                title="النقاط المستبدلة"
                value={formatNumber(data?.coinsSpent || 0)}
                icon={ShoppingBag}
                trend={{ value: '+8.3%', isPositive: true }}
                iconColor="text-purple-400"
                iconBgColor="bg-purple-500/10"
              />
              <StatCard
                title="الالتزامات المعلقة"
                value={formatNumber(data?.outstandingLiability || 0)}
                icon={TrendingUp}
                iconColor="text-orange-400"
                iconBgColor="bg-orange-500/10"
              />
              <StatCard
                title="متوسط رصيد العميل"
                value={formatNumber(Math.round(data?.avgClientBalance || 0))}
                icon={Users}
                iconColor="text-blue-400"
                iconBgColor="bg-blue-500/10"
              />
              <StatCard
                title="متوسط المشتريات/عميل"
                value={data?.avgPurchasesPerClient.toFixed(1) || '0'}
                icon={Award}
                iconColor="text-green-400"
                iconBgColor="bg-green-500/10"
              />
              <StatCard
                title="معدل التحويل لـ VIP"
                value={`${data?.vipConversionRate.toFixed(1)}%`}
                icon={TrendingUp}
                trend={{ value: '+2.1%', isPositive: true }}
                iconColor="text-pink-400"
                iconBgColor="bg-pink-500/10"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PremiumCard>
                <h2 className="text-lg font-bold text-white mb-6">النقاط الشهرية</h2>
                <div className="space-y-4">
                  {data?.monthlyData.map((month) => (
                    <div key={month.month} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">{month.month}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-green-400">
                            ↑ {formatNumber(month.issued)}
                          </span>
                          <span className="text-purple-400">
                            ↓ {formatNumber(month.spent)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full flex">
                          <div
                            className="bg-green-500"
                            style={{
                              width: `${(month.issued / (month.issued + month.spent)) * 100}%`,
                            }}
                          />
                          <div
                            className="bg-purple-500"
                            style={{
                              width: `${(month.spent / (month.issued + month.spent)) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </PremiumCard>

              <PremiumCard>
                <h2 className="text-lg font-bold text-white mb-6">الإيرادات المكافئة</h2>
                <div className="h-64 flex items-end justify-between gap-2">
                  {data?.monthlyData.map((month, index) => {
                    const maxRevenue = Math.max(...(data?.monthlyData.map(m => m.revenue) || [0]));
                    const height = (month.revenue / maxRevenue) * 100;
                    
                    return (
                      <div key={month.month} className="flex-1 flex flex-col items-center gap-2">
                        <div className="relative w-full group">
                          <div
                            className="w-full bg-gradient-to-t from-cyan-500 to-blue-500 rounded-t-lg transition-all hover:from-cyan-400 hover:to-blue-400"
                            style={{ height: `${height * 2}px` }}
                          />
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-800 px-2 py-1 rounded text-xs whitespace-nowrap">
                            {formatCurrency(month.revenue)}
                          </div>
                        </div>
                        <span className="text-xs text-zinc-500 rotate-0">
                          {month.month.slice(0, 3)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </PremiumCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PremiumCard>
                <h2 className="text-lg font-bold text-white mb-6">توزيع المستويات</h2>
                <div className="space-y-4">
                  {data?.tierDistribution.map((tier) => {
                    const colors = {
                      BRONZE: 'bg-amber-600',
                      SILVER: 'bg-slate-400',
                      GOLD: 'bg-yellow-500',
                      VIP: 'bg-purple-500',
                    };
                    
                    return (
                      <div key={tier.tier} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-white">{tier.tier}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">
                              {formatNumber(tier.count)}
                            </span>
                            <span className="text-xs text-zinc-500">
                              ({tier.percentage.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${colors[tier.tier as keyof typeof colors]} transition-all`}
                            style={{ width: `${tier.percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PremiumCard>

              <PremiumCard>
                <h2 className="text-lg font-bold text-white mb-6">أفضل المكافآت</h2>
                <div className="space-y-3">
                  {data?.topRewards.map((reward, index) => {
                    const usageRate = (reward.usage / reward.purchases) * 100;
                    
                    return (
                      <div
                        key={reward.name}
                        className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 font-bold text-sm">
                              {index + 1}
                            </div>
                            <span className="font-medium text-white">{reward.name}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-zinc-400 text-xs">المشتريات</p>
                            <p className="font-bold text-white">{formatNumber(reward.purchases)}</p>
                          </div>
                          <div>
                            <p className="text-zinc-400 text-xs">الاستخدام</p>
                            <p className="font-bold text-green-400">{formatNumber(reward.usage)}</p>
                          </div>
                          <div>
                            <p className="text-zinc-400 text-xs">معدل الاستخدام</p>
                            <p className="font-bold text-purple-400">{usageRate.toFixed(0)}%</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PremiumCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
