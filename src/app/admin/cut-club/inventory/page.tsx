'use client';

import { useState, useEffect } from 'react';
import {
  Package, Search, Calendar, CheckCircle2, XCircle, Clock,
  Eye, Ban, Filter as FilterIcon
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import EmptyState from '@/components/cut-club/EmptyState';
import { TableSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TierBadge from '@/components/cut-club/TierBadge';

interface InventoryItem {
  id: number;
  clientId: number;
  clientName: string;
  itemNameAr: string;
  itemNameEn: string;
  voucherCode: string;
  purchaseDate: string;
  expiryDate: string;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  usageDate?: string;
  priceCoins: number;
}

const statusConfig = {
  ACTIVE: {
    label: 'نشط',
    color: 'bg-green-500/10 text-green-400 border-green-500/30',
    icon: CheckCircle2,
  },
  USED: {
    label: 'مستخدم',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    icon: CheckCircle2,
  },
  EXPIRED: {
    label: 'منتهي',
    color: 'bg-red-500/10 text-red-400 border-red-500/30',
    icon: XCircle,
  },
  CANCELLED: {
    label: 'ملغي',
    color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
    icon: Ban,
  },
};

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const mockItems: InventoryItem[] = [
        {
          id: 1,
          clientId: 101,
          clientName: 'أحمد محمد علي',
          itemNameAr: 'تسريحة مجانية',
          itemNameEn: 'Free Styling',
          voucherCode: 'FS-2024-001',
          purchaseDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          expiryDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'ACTIVE',
          priceCoins: 500,
        },
        {
          id: 2,
          clientId: 102,
          clientName: 'محمد حسن',
          itemNameAr: 'خصم 20%',
          itemNameEn: '20% Discount',
          voucherCode: 'DC-2024-045',
          purchaseDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'ACTIVE',
          priceCoins: 300,
        },
        {
          id: 3,
          clientId: 103,
          clientName: 'خالد يوسف',
          itemNameAr: 'تسريحة مجانية',
          itemNameEn: 'Free Styling',
          voucherCode: 'FS-2024-002',
          purchaseDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
          expiryDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'USED',
          usageDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          priceCoins: 500,
        },
      ];

      setItems(mockItems);
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const filteredItems = items.filter((item) => {
    if (searchQuery && !item.clientName.includes(searchQuery) && !item.voucherCode.includes(searchQuery)) {
      return false;
    }
    if (selectedStatus && item.status !== selectedStatus) return false;
    return true;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Package}
        title="مخزون العملاء"
        description="عرض جميع المكافآت المشتراة وحالتها"
        gradient="from-purple-500/20 to-pink-600/20"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        <PremiumCard>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                placeholder="بحث بالعميل أو رمز القسيمة..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10 bg-zinc-800 border-zinc-700"
              />
            </div>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="">الكل</SelectItem>
                <SelectItem value="ACTIVE">نشط</SelectItem>
                <SelectItem value="USED">مستخدم</SelectItem>
                <SelectItem value="EXPIRED">منتهي</SelectItem>
                <SelectItem value="CANCELLED">ملغي</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PremiumCard>

        <PremiumCard noPadding>
          {loading ? (
            <div className="p-6">
              <TableSkeleton rows={8} />
            </div>
          ) : filteredItems.length === 0 ? (
            <EmptyState
              icon={Package}
              title="لا توجد عناصر"
              description="لم يتم العثور على عناصر مطابقة للبحث"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50 border-b border-zinc-800">
                  <tr>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                      العميل
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                      المنتج
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                      رمز القسيمة
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                      تاريخ الشراء
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                      تاريخ الانتهاء
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                      الحالة
                    </th>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-zinc-400">
                      إجراءات
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredItems.map((item) => {
                    const StatusIcon = statusConfig[item.status].icon;
                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-zinc-800/30 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-white">{item.clientName}</p>
                            <p className="text-xs text-zinc-500">#{item.clientId}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-sm font-medium text-white">
                              {item.itemNameAr}
                            </p>
                            <p className="text-xs text-zinc-400">{item.itemNameEn}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <code className="text-sm font-mono text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">
                            {item.voucherCode}
                          </code>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-zinc-300">
                            <Calendar className="h-4 w-4 text-zinc-500" />
                            {formatDate(item.purchaseDate)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-zinc-300">
                            <Clock className="h-4 w-4 text-zinc-500" />
                            {formatDate(item.expiryDate)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            className={`${statusConfig[item.status].color} border font-medium`}
                          >
                            <StatusIcon className="h-3 w-3 ml-1" />
                            {statusConfig[item.status].label}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {item.status === 'ACTIVE' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-400 hover:text-green-300 hover:bg-green-400/10"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                >
                                  <Ban className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PremiumCard>
      </div>
    </div>
  );
}
