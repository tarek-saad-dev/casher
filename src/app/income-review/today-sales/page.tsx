'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  TrendingUp,
  Receipt,
  Users,
  CreditCard,
  Search,
  Filter,
  Download,
  Printer,
  Eye,
  Edit3,
  Trash2,
  Calendar,
} from 'lucide-react';

// Mock data - replace with actual API call
const mockSales = [
  { id: 1001, time: '09:30', customer: 'أحمد محمد', barber: 'خالد', amount: 150, method: 'نقدي', items: 2 },
  { id: 1002, time: '10:15', customer: 'محمد علي', barber: 'سامي', amount: 200, method: 'فيزا', items: 3 },
  { id: 1003, time: '11:00', customer: 'فهد عبدالله', barber: 'خالد', amount: 100, method: 'نقدي', items: 1 },
  { id: 1004, time: '11:45', customer: 'سعد أحمد', barber: 'عمر', amount: 300, method: 'إنستاباي', items: 4 },
  { id: 1005, time: '12:30', customer: 'ناصر فهد', barber: 'سامي', amount: 180, method: 'فيزا', items: 2 },
];

export default function TodaySalesPage() {
  const [sales, setSales] = useState(mockSales);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Calculate totals
  const totalSales = sales.reduce((sum, s) => sum + s.amount, 0);
  const totalInvoices = sales.length;
  const avgInvoice = totalInvoices > 0 ? Math.round(totalSales / totalInvoices) : 0;
  const bestBarber = 'خالد'; // Calculate from actual data

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="مبيعات اليوم"
        description="مراجعة وتحليل مبيعات اليوم بشكل مفصل"
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 border-zinc-700">
            <Download className="w-4 h-4" />
            تصدير
          </Button>
          <Button variant="outline" size="sm" className="gap-2 border-zinc-700">
            <Printer className="w-4 h-4" />
            طباعة
          </Button>
        </div>
      </PageHeader>

      {/* Date Display */}
      <div className="flex items-center gap-2 text-zinc-400 mb-6">
        <Calendar className="w-4 h-4" />
        <span className="text-sm">{new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          title="إجمالي المبيعات"
          value={`${totalSales.toLocaleString()} ر.س`}
          subtitle="جميع المبيعات اليوم"
          icon={<TrendingUp className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="عدد الفواتير"
          value={totalInvoices}
          subtitle="عدد العمليات المنجزة"
          icon={<Receipt className="w-5 h-5" />}
          variant="success"
        />
        <KpiCard
          title="متوسط الفاتورة"
          value={`${avgInvoice.toLocaleString()} ر.س`}
          subtitle="متوسط قيمة الفاتورة"
          icon={<CreditCard className="w-5 h-5" />}
        />
        <KpiCard
          title="أفضل موظف"
          value={bestBarber}
          subtitle="الحلاق الأكثر مبيعاً"
          icon={<Users className="w-5 h-5" />}
          variant="warning"
        />
      </div>

      {/* Filters */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="بحث في الفواتير..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-zinc-950 border-zinc-800"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 border-zinc-700">
              <Filter className="w-4 h-4" />
              فلترة
            </Button>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/50 bg-zinc-900/80">
                <th className="px-4 py-3 text-right font-medium text-zinc-400">رقم الفاتورة</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">الوقت</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">العميل</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">الحلاق</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">طريقة الدفع</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">عدد الخدمات</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">القيمة</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale, index) => (
                <tr
                  key={sale.id}
                  className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">#{sale.id}</td>
                  <td className="px-4 py-3 text-zinc-400">{sale.time}</td>
                  <td className="px-4 py-3">{sale.customer}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                      {sale.barber}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        sale.method === 'نقدي'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : sale.method === 'فيزا'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }
                    >
                      {sale.method}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">{sale.items}</td>
                  <td className="px-4 py-3 font-medium text-amber-400">
                    {sale.amount.toLocaleString()} ر.س
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="w-8 h-8 hover:bg-zinc-800">
                        <Eye className="w-4 h-4 text-zinc-400" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-8 h-8 hover:bg-zinc-800">
                        <Edit3 className="w-4 h-4 text-zinc-400" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-8 h-8 hover:bg-zinc-800">
                        <Trash2 className="w-4 h-4 text-rose-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-4 py-3 border-t border-zinc-800/50 bg-zinc-900/30 flex items-center justify-between">
          <span className="text-sm text-zinc-400">
            إجمالي: <span className="font-medium text-white">{sales.length}</span> فاتورة
          </span>
          <span className="text-sm text-zinc-400">
            المجموع: <span className="font-medium text-amber-400">{totalSales.toLocaleString()} ر.س</span>
          </span>
        </div>
      </div>
    </div>
  );
}
