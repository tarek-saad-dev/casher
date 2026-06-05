'use client';

import { useState, useEffect } from 'react';
import {
  Crown, Coins, TrendingUp, Users, Award, ShoppingBag,
  RefreshCw, ArrowUpRight, ArrowDownRight, Sparkles,
  Gift, UserPlus, Package
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import StatCard from '@/components/cut-club/StatCard';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import TierBadge from '@/components/cut-club/TierBadge';

interface DashboardStats {
  totalCoinsIssued: number;
  totalCoinsRedeemed: number;
  coinsInCirculation: number;
  activeMembers: number;
  vipMembers: number;
  storePurchasesThisMonth: number;
  trends: {
    coinsIssued: { value: string; isPositive: boolean };
    coinsRedeemed: { value: string; isPositive: boolean };
    activeMembers: { value: string; isPositive: boolean };
  };
}

interface ActivityItem {
  id: number;
  type: 'purchase' | 'redeem' | 'mystery_box' | 'referral' | 'tier_upgrade';
  clientName: string;
  description: string;
  timestamp: string;
  coins?: number;
}

interface TopReward {
  id: number;
  nameAr: string;
  nameEn: string;
  purchaseCount: number;
  totalCoins: number;
}

interface TopClient {
  id: number;
  name: string;
  tier: string;
  totalCoins: number;
  purchaseCount: number;
}

export default function CutClubOverviewPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [topRewards, setTopRewards] = useState<TopReward[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const mockStats: DashboardStats = {
        totalCoinsIssued: 125840,
        totalCoinsRedeemed: 45230,
        coinsInCirculation: 80610,
        activeMembers: 342,
        vipMembers: 28,
        storePurchasesThisMonth: 156,
        trends: {
          coinsIssued: { value: '+12.5%', isPositive: true },
          coinsRedeemed: { value: '+8.3%', isPositive: true },
          activeMembers: { value: '+5.2%', isPositive: true },
        },
      };

      const mockActivities: ActivityItem[] = [
        {
          id: 1,
          type: 'purchase',
          clientName: 'أحمد محمد',
          description: 'اشترى Free Styling',
          timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
          coins: 500,
        },
        {
          id: 2,
          type: 'tier_upgrade',
          clientName: 'محمد علي',
          description: 'ترقية إلى VIP',
          timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
        },
        {
          id: 3,
          type: 'mystery_box',
          clientName: 'سارة أحمد',
          description: 'فتحت Mystery Box',
          timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
          id: 4,
          type: 'referral',
          clientName: 'خالد حسن',
          description: 'دعوة صديق جديد',
          timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
          coins: 200,
        },
        {
          id: 5,
          type: 'redeem',
          clientName: 'عمر يوسف',
          description: 'استبدل VIP Upgrade',
          timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
          coins: 1000,
        },
      ];

      const mockTopRewards: TopReward[] = [
        { id: 1, nameAr: 'تسريحة مجانية', nameEn: 'Free Styling', purchaseCount: 45, totalCoins: 22500 },
        { id: 2, nameAr: 'ترقية VIP', nameEn: 'VIP Upgrade', purchaseCount: 28, totalCoins: 28000 },
        { id: 3, nameAr: 'خصم 20%', nameEn: '20% Discount', purchaseCount: 67, totalCoins: 20100 },
      ];

      const mockTopClients: TopClient[] = [
        { id: 1, name: 'أحمد محمد علي', tier: 'VIP', totalCoins: 5420, purchaseCount: 12 },
        { id: 2, name: 'محمد حسن', tier: 'GOLD', totalCoins: 4180, purchaseCount: 9 },
        { id: 3, name: 'خالد يوسف', tier: 'VIP', totalCoins: 3950, purchaseCount: 11 },
      ];

      setStats(mockStats);
      setActivities(mockActivities);
      setTopRewards(mockTopRewards);
      setTopClients(mockTopClients);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = now - then;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    if (hours < 24) return `منذ ${hours} ساعة`;
    return new Date(timestamp).toLocaleDateString('ar-EG');
  };

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'purchase':
        return <ShoppingBag className="h-4 w-4 text-blue-400" />;
      case 'redeem':
        return <Gift className="h-4 w-4 text-purple-400" />;
      case 'mystery_box':
        return <Package className="h-4 w-4 text-yellow-400" />;
      case 'referral':
        return <UserPlus className="h-4 w-4 text-green-400" />;
      case 'tier_upgrade':
        return <Award className="h-4 w-4 text-pink-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Crown}
        title="CUT CLUB"
        description="لوحة التحكم الرئيسية لإدارة اقتصاد الولاء"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            className="border-zinc-700 hover:bg-zinc-800"
          >
            <RefreshCw className="w-4 h-4 ml-2" />
            تحديث
          </Button>
        }
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
                title="إجمالي النقاط الصادرة"
                value={formatNumber(stats?.totalCoinsIssued || 0)}
                icon={Coins}
                trend={stats?.trends.coinsIssued}
                iconColor="text-yellow-400"
                iconBgColor="bg-yellow-500/10"
              />
              <StatCard
                title="النقاط المستبدلة"
                value={formatNumber(stats?.totalCoinsRedeemed || 0)}
                icon={TrendingDown}
                trend={stats?.trends.coinsRedeemed}
                iconColor="text-purple-400"
                iconBgColor="bg-purple-500/10"
              />
              <StatCard
                title="النقاط المتداولة"
                value={formatNumber(stats?.coinsInCirculation || 0)}
                icon={TrendingUp}
                iconColor="text-emerald-400"
                iconBgColor="bg-emerald-500/10"
              />
              <StatCard
                title="الأعضاء النشطين"
                value={formatNumber(stats?.activeMembers || 0)}
                icon={Users}
                trend={stats?.trends.activeMembers}
                iconColor="text-blue-400"
                iconBgColor="bg-blue-500/10"
              />
              <StatCard
                title="أعضاء VIP"
                value={formatNumber(stats?.vipMembers || 0)}
                icon={Crown}
                iconColor="text-purple-400"
                iconBgColor="bg-purple-500/10"
              />
              <StatCard
                title="مشتريات المتجر هذا الشهر"
                value={formatNumber(stats?.storePurchasesThisMonth || 0)}
                icon={ShoppingBag}
                iconColor="text-cyan-400"
                iconBgColor="bg-cyan-500/10"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <PremiumCard className="lg:col-span-2">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-yellow-500" />
                    النشاط الأخير
                  </h2>
                </div>
                <div className="space-y-3">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-center gap-4 p-3 rounded-lg bg-zinc-800/30 border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700">
                        {getActivityIcon(activity.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">
                          {activity.clientName}
                        </p>
                        <p className="text-xs text-zinc-400">{activity.description}</p>
                      </div>
                      <div className="text-left">
                        {activity.coins && (
                          <p className="text-sm font-bold text-yellow-400">
                            {formatNumber(activity.coins)} نقطة
                          </p>
                        )}
                        <p className="text-xs text-zinc-500">
                          {formatTimeAgo(activity.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </PremiumCard>

              <PremiumCard>
                <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Award className="h-5 w-5 text-yellow-500" />
                  أفضل المكافآت
                </h2>
                <div className="space-y-3">
                  {topRewards.map((reward, index) => (
                    <div
                      key={reward.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30 border border-zinc-800/50"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 font-bold text-sm">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {reward.nameAr}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {formatNumber(reward.purchaseCount)} عملية شراء
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-yellow-400">
                          {formatNumber(reward.totalCoins)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </PremiumCard>
            </div>

            <PremiumCard>
              <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-400" />
                أفضل العملاء
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {topClients.map((client, index) => (
                  <div
                    key={client.id}
                    className="relative p-4 rounded-lg bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700/50 transition-all"
                  >
                    <div className="absolute top-2 left-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 font-bold text-xs">
                        {index + 1}
                      </div>
                    </div>
                    <div className="mt-6">
                      <p className="font-semibold text-white mb-2">{client.name}</p>
                      <div className="flex items-center justify-between mb-3">
                        <TierBadge tier={client.tier} size="sm" />
                        <p className="text-lg font-bold text-yellow-400">
                          {formatNumber(client.totalCoins)}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-400">
                        {formatNumber(client.purchaseCount)} عملية شراء
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </PremiumCard>
          </>
        )}
      </div>
    </div>
  );
}

function TrendingDown(props: React.SVGProps<SVGSVGElement>) {
  return <ArrowDownRight {...props} />;
}
