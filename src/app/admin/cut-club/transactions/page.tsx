'use client';

import { useState, useEffect } from 'react';
import {
  Receipt, Search, Calendar, Filter, ChevronRight, ChevronLeft,
  ArrowUpRight, ArrowDownRight, RefreshCw
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

interface Transaction {
  id: number;
  date: string;
  clientId: number;
  clientName: string;
  tier: string;
  movementType: 'EARN' | 'REDEEM' | 'ADJUST_ADD' | 'ADJUST_SUBTRACT' | 'REVERSAL';
  balanceBefore: number;
  change: number;
  balanceAfter: number;
  source: string;
  notes?: string;
}

const movementConfig = {
  EARN: {
    label: 'كسب نقاط',
    color: 'bg-green-500/10 text-green-400 border-green-500/30',
    icon: ArrowUpRight,
  },
  REDEEM: {
    label: 'استبدال',
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    icon: ArrowDownRight,
  },
  ADJUST_ADD: {
    label: 'إضافة يدوية',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    icon: ArrowUpRight,
  },
  ADJUST_SUBTRACT: {
    label: 'خصم يدوي',
    color: 'bg-red-500/10 text-red-400 border-red-500/30',
    icon: ArrowDownRight,
  },
  REVERSAL: {
    label: 'عكس',
    color: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    icon: RefreshCw,
  },
};

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(5);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const mockTransactions: Transaction[] = [
        {
          id: 1,
          date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          clientId: 101,
          clientName: 'أحمد محمد علي',
          tier: 'VIP',
          movementType: 'EARN',
          balanceBefore: 2340,
          change: 150,
          balanceAfter: 2490,
          source: 'فاتورة #5678',
        },
        {
          id: 2,
          date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          clientId: 102,
          clientName: 'محمد حسن',
          tier: 'GOLD',
          movementType: 'REDEEM',
          balanceBefore: 1200,
          change: -500,
          balanceAfter: 700,
          source: 'متجر - تسريحة مجانية',
        },
        {
          id: 3,
          date: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          clientId: 103,
          clientName: 'خالد يوسف',
          tier: 'SILVER',
          movementType: 'ADJUST_ADD',
          balanceBefore: 450,
          change: 200,
          balanceAfter: 650,
          source: 'تعديل يدوي',
          notes: 'تعويض عن خطأ في النظام',
        },
        {
          id: 4,
          date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          clientId: 104,
          clientName: 'عمر أحمد',
          tier: 'BRONZE',
          movementType: 'EARN',
          balanceBefore: 120,
          change: 80,
          balanceAfter: 200,
          source: 'فاتورة #5677',
        },
        {
          id: 5,
          date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          clientId: 105,
          clientName: 'سارة محمود',
          tier: 'GOLD',
          movementType: 'REVERSAL',
          balanceBefore: 890,
          change: -120,
          balanceAfter: 770,
          source: 'عكس فاتورة #5670',
          notes: 'إلغاء فاتورة',
        },
      ];

      setTransactions(mockTransactions);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [currentPage]);

  const filteredTransactions = transactions.filter((tx) => {
    if (searchQuery && !tx.clientName.includes(searchQuery) && !tx.clientId.toString().includes(searchQuery)) {
      return false;
    }
    if (selectedType && tx.movementType !== selectedType) return false;
    return true;
  });

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Receipt}
        title="سجل المعاملات"
        description="استكشاف دفتر الأستاذ الكامل"
        gradient="from-indigo-500/20 to-purple-600/20"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        <PremiumCard>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                placeholder="بحث بالعميل أو المعرف..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10 bg-zinc-800 border-zinc-700"
              />
            </div>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full md:w-48 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="نوع الحركة" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="">الكل</SelectItem>
                <SelectItem value="EARN">كسب نقاط</SelectItem>
                <SelectItem value="REDEEM">استبدال</SelectItem>
                <SelectItem value="ADJUST_ADD">إضافة يدوية</SelectItem>
                <SelectItem value="ADJUST_SUBTRACT">خصم يدوي</SelectItem>
                <SelectItem value="REVERSAL">عكس</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="border-zinc-700 hover:bg-zinc-800"
            >
              <Calendar className="w-4 h-4 ml-2" />
              نطاق التاريخ
            </Button>
          </div>
        </PremiumCard>

        <PremiumCard noPadding>
          {loading ? (
            <div className="p-6">
              <TableSkeleton rows={10} />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="لا توجد معاملات"
              description="لم يتم العثور على معاملات مطابقة للبحث"
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-zinc-800/50 border-b border-zinc-800">
                    <tr>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        التاريخ
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        العميل
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        النوع
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        قبل
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        التغيير
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        بعد
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-400">
                        المصدر
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {filteredTransactions.map((tx) => {
                      const MovementIcon = movementConfig[tx.movementType].icon;
                      const isPositive = tx.change > 0;
                      
                      return (
                        <tr
                          key={tx.id}
                          className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                        >
                          <td className="px-6 py-4">
                            <p className="text-sm text-zinc-300">
                              {formatDateTime(tx.date)}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div>
                                <p className="font-medium text-white">{tx.clientName}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <p className="text-xs text-zinc-500">#{tx.clientId}</p>
                                  <TierBadge tier={tx.tier} size="sm" />
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge
                              className={`${movementConfig[tx.movementType].color} border font-medium`}
                            >
                              <MovementIcon className="h-3 w-3 ml-1" />
                              {movementConfig[tx.movementType].label}
                            </Badge>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-mono text-zinc-400">
                              {formatNumber(tx.balanceBefore)}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <p
                              className={`text-sm font-bold font-mono ${
                                isPositive ? 'text-green-400' : 'text-red-400'
                              }`}
                            >
                              {isPositive ? '+' : ''}
                              {formatNumber(tx.change)}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-mono font-bold text-white">
                              {formatNumber(tx.balanceAfter)}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-sm text-white">{tx.source}</p>
                              {tx.notes && (
                                <p className="text-xs text-zinc-500 mt-1">{tx.notes}</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
                <div className="text-sm text-zinc-400">
                  صفحة {currentPage} من {totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="border-zinc-700 hover:bg-zinc-800"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="border-zinc-700 hover:bg-zinc-800"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </PremiumCard>
      </div>
    </div>
  );
}
