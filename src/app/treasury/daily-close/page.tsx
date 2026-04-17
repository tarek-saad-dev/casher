'use client';

import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Lock, TrendingUp, TrendingDown, Wallet, CreditCard, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function DailyClosePage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="تقفيل اليوم"
        description="ملخص شامل لإيرادات ومصروفات اليوم"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Lock className="w-4 h-4" />
          تقفيل اليوم
        </Button>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          title="إجمالي المبيعات"
          value="٠ ر.س"
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
        />
        <KpiCard
          title="إجمالي المصروفات"
          value="٠ ر.س"
          icon={<TrendingDown className="w-5 h-5" />}
          variant="danger"
        />
        <KpiCard
          title="صافي اليوم"
          value="٠ ر.س"
          icon={<Wallet className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="الرصيد المتوقع"
          value="٠ ر.س"
          icon={<Coins className="w-5 h-5" />}
          variant="warning"
        />
      </div>

      {/* Payment Methods Breakdown */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4">تفصيل حسب طريقة الدفع</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-zinc-950/50 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Coins className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">نقدي</p>
                <p className="text-xl font-bold text-white">٠ ر.س</p>
              </div>
            </div>
          </div>
          <div className="bg-zinc-950/50 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">فيزا</p>
                <p className="text-xl font-bold text-white">٠ ر.س</p>
              </div>
            </div>
          </div>
          <div className="bg-zinc-950/50 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">إنستاباي</p>
                <p className="text-xl font-bold text-white">٠ ر.س</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-400">حالة التقفيل</p>
            <Badge variant="outline" className="mt-2 border-yellow-500/30 text-yellow-400">
              لم يتم التقفيل
            </Badge>
          </div>
          <Button variant="outline" className="border-zinc-700 gap-2">
            <Lock className="w-4 h-4" />
            بدء التقفيل
          </Button>
        </div>
      </div>
    </div>
  );
}
