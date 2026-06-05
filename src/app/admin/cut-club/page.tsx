'use client';

import { useState, useEffect } from 'react';
import {
  Crown, ShoppingBag, Package, Tag, AlertTriangle, Users,
  RefreshCw, ArrowUpRight, Store, Gift, Settings, BarChart3
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import StatCard from '@/components/cut-club/StatCard';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface StoreStats {
  totalItems: number;
  activeItems: number;
  inactiveItems: number;
  featuredItems: number;
  outOfStockItems: number;
  totalCategories: number;
  activeCategories: number;
  totalPurchases: number;
  totalInventoryItems: number;
}

const quickLinks = [
  { label: 'إدارة المتجر', href: '/admin/cut-club/store', icon: Store, color: 'text-blue-400' },
  { label: 'المخزون', href: '/admin/cut-club/inventory', icon: Package, color: 'text-green-400' },
  { label: 'صناديق الغموض', href: '/admin/cut-club/mystery-boxes', icon: Gift, color: 'text-purple-400' },
  { label: 'الإعدادات', href: '/admin/cut-club/settings', icon: Settings, color: 'text-zinc-400' },
];

export default function CutClubOverviewPage() {
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/store/stats');
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      } else {
        setError(data.error || 'Failed to load stats');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatNumber = (num: number) => new Intl.NumberFormat('ar-EG').format(num);

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
            onClick={fetchStats}
            className="border-zinc-700 hover:bg-zinc-800"
          >
            <RefreshCw className="w-4 h-4 ml-2" />
            تحديث
          </Button>
        }
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
            {error}
          </div>
        )}
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
                title="إجمالي المنتجات"
                value={formatNumber(stats?.totalItems || 0)}
                icon={Package}
                iconColor="text-blue-400"
                iconBgColor="bg-blue-500/10"
              />
              <StatCard
                title="المنتجات النشطة"
                value={formatNumber(stats?.activeItems || 0)}
                icon={Tag}
                iconColor="text-green-400"
                iconBgColor="bg-green-500/10"
              />
              <StatCard
                title="المنتجات المميزة"
                value={formatNumber(stats?.featuredItems || 0)}
                icon={Crown}
                iconColor="text-yellow-400"
                iconBgColor="bg-yellow-500/10"
              />
              <StatCard
                title="نفذ من المخزون"
                value={formatNumber(stats?.outOfStockItems || 0)}
                icon={AlertTriangle}
                iconColor="text-red-400"
                iconBgColor="bg-red-500/10"
              />
              <StatCard
                title="إجمالي المشتريات"
                value={formatNumber(stats?.totalPurchases || 0)}
                icon={ShoppingBag}
                iconColor="text-cyan-400"
                iconBgColor="bg-cyan-500/10"
              />
              <StatCard
                title="العناصر في المخزون"
                value={formatNumber(stats?.totalInventoryItems || 0)}
                icon={Users}
                iconColor="text-purple-400"
                iconBgColor="bg-purple-500/10"
              />
            </div>

            <PremiumCard>
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-yellow-500" />
                الوصول السريع
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {quickLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="group">
                    <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:border-yellow-500/50 hover:bg-zinc-800 transition-all">
                      <link.icon className={`h-6 w-6 mb-2 ${link.color}`} />
                      <p className="font-medium text-white group-hover:text-yellow-400 transition-colors">{link.label}</p>
                      <ArrowUpRight className="h-4 w-4 text-zinc-500 group-hover:text-yellow-400 transition-colors mt-2" />
                    </div>
                  </Link>
                ))}
              </div>
            </PremiumCard>
          </>
        )}
      </div>
    </div>
  );
}
