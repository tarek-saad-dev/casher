'use client';

import { useState, useEffect } from 'react';
import {
  UserPlus, Users, Gift, TrendingUp, Share2, CheckCircle2,
  Clock, XCircle
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import StatCard from '@/components/cut-club/StatCard';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton, TableSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Badge } from '@/components/ui/badge';

interface ReferralStats {
  invitesSent: number;
  successfulReferrals: number;
  rewardCost: number;
  conversionRate: number;
}

interface Referral {
  id: number;
  referrerName: string;
  referredName: string;
  referredPhone: string;
  status: 'INVITED' | 'REGISTERED' | 'FIRST_VISIT' | 'REWARDED';
  inviteDate: string;
  registrationDate?: string;
  firstVisitDate?: string;
  rewardDate?: string;
  rewardCoins?: number;
}

const statusConfig = {
  INVITED: {
    label: 'تم الإرسال',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    icon: Share2,
  },
  REGISTERED: {
    label: 'مسجل',
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    icon: UserPlus,
  },
  FIRST_VISIT: {
    label: 'زيارة أولى',
    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    icon: Clock,
  },
  REWARDED: {
    label: 'تمت المكافأة',
    color: 'bg-green-500/10 text-green-400 border-green-500/30',
    icon: CheckCircle2,
  },
};

export default function ReferralsPage() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const mockStats: ReferralStats = {
        invitesSent: 156,
        successfulReferrals: 89,
        rewardCost: 17800,
        conversionRate: 57.05,
      };

      const mockReferrals: Referral[] = [
        {
          id: 1,
          referrerName: 'أحمد محمد',
          referredName: 'خالد حسن',
          referredPhone: '0123456789',
          status: 'REWARDED',
          inviteDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          registrationDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
          firstVisitDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
          rewardDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
          rewardCoins: 200,
        },
        {
          id: 2,
          referrerName: 'محمد علي',
          referredName: 'يوسف أحمد',
          referredPhone: '0123456788',
          status: 'FIRST_VISIT',
          inviteDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
          registrationDate: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
          firstVisitDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 3,
          referrerName: 'عمر حسن',
          referredName: 'سامي محمد',
          referredPhone: '0123456787',
          status: 'REGISTERED',
          inviteDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          registrationDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 4,
          referrerName: 'سارة أحمد',
          referredName: 'منى خالد',
          referredPhone: '0123456786',
          status: 'INVITED',
          inviteDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      setStats(mockStats);
      setReferrals(mockReferrals);
    } catch (error) {
      console.error('Failed to fetch referral data:', error);
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const funnelSteps = [
    { label: 'تم الإرسال', count: stats?.invitesSent || 0, color: 'bg-blue-500' },
    { label: 'مسجل', count: 120, color: 'bg-purple-500' },
    { label: 'زيارة أولى', count: 95, color: 'bg-yellow-500' },
    { label: 'تمت المكافأة', count: stats?.successfulReferrals || 0, color: 'bg-green-500' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={UserPlus}
        title="إدارة الإحالات"
        description="تتبع دعوات العملاء والمكافآت"
        gradient="from-green-500/20 to-emerald-600/20"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="الدعوات المرسلة"
                value={formatNumber(stats?.invitesSent || 0)}
                icon={Share2}
                iconColor="text-blue-400"
                iconBgColor="bg-blue-500/10"
              />
              <StatCard
                title="الإحالات الناجحة"
                value={formatNumber(stats?.successfulReferrals || 0)}
                icon={CheckCircle2}
                iconColor="text-green-400"
                iconBgColor="bg-green-500/10"
              />
              <StatCard
                title="تكلفة المكافآت"
                value={formatNumber(stats?.rewardCost || 0)}
                icon={Gift}
                iconColor="text-yellow-400"
                iconBgColor="bg-yellow-500/10"
              />
              <StatCard
                title="معدل التحويل"
                value={`${stats?.conversionRate.toFixed(1)}%`}
                icon={TrendingUp}
                iconColor="text-purple-400"
                iconBgColor="bg-purple-500/10"
              />
            </div>

            <PremiumCard>
              <h2 className="text-lg font-bold text-white mb-6">مسار الإحالة</h2>
              <div className="space-y-3">
                {funnelSteps.map((step, index) => {
                  const percentage = ((step.count / (stats?.invitesSent || 1)) * 100).toFixed(1);
                  const width = `${percentage}%`;
                  
                  return (
                    <div key={step.label} className="relative">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-white">{step.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">
                            {formatNumber(step.count)}
                          </span>
                          <span className="text-xs text-zinc-500">({percentage}%)</span>
                        </div>
                      </div>
                      <div className="h-8 bg-zinc-800 rounded-lg overflow-hidden">
                        <div
                          className={`h-full ${step.color} transition-all duration-500 flex items-center justify-end px-3`}
                          style={{ width }}
                        >
                          {parseFloat(percentage) > 15 && (
                            <span className="text-xs font-semibold text-white">
                              {percentage}%
                            </span>
                          )}
                        </div>
                      </div>
                      {index < funnelSteps.length - 1 && (
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-10">
                          <div className="w-6 h-6 rotate-45 bg-zinc-900 border-2 border-zinc-800" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </PremiumCard>

            <PremiumCard noPadding>
              <div className="p-6 border-b border-zinc-800">
                <h2 className="text-lg font-bold text-white">الإحالات الأخيرة</h2>
              </div>
              {loading ? (
                <div className="p-6">
                  <TableSkeleton rows={5} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-zinc-800/50 border-b border-zinc-800">
                      <tr>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                          المُحيل
                        </th>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                          العميل الجديد
                        </th>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                          رقم الهاتف
                        </th>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                          تاريخ الدعوة
                        </th>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                          الحالة
                        </th>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                          المكافأة
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {referrals.map((referral) => {
                        const StatusIcon = statusConfig[referral.status].icon;
                        return (
                          <tr
                            key={referral.id}
                            className="hover:bg-zinc-800/30 transition-colors"
                          >
                            <td className="px-6 py-4">
                              <p className="font-medium text-white">{referral.referrerName}</p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm text-white">{referral.referredName}</p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm text-zinc-400 font-mono">
                                {referral.referredPhone}
                              </p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm text-zinc-300">
                                {formatDate(referral.inviteDate)}
                              </p>
                            </td>
                            <td className="px-6 py-4">
                              <Badge
                                className={`${statusConfig[referral.status].color} border font-medium`}
                              >
                                <StatusIcon className="h-3 w-3 ml-1" />
                                {statusConfig[referral.status].label}
                              </Badge>
                            </td>
                            <td className="px-6 py-4">
                              {referral.rewardCoins ? (
                                <p className="text-sm font-bold text-yellow-400">
                                  {formatNumber(referral.rewardCoins)} نقطة
                                </p>
                              ) : (
                                <p className="text-sm text-zinc-500">-</p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </PremiumCard>
          </>
        )}
      </div>
    </div>
  );
}
