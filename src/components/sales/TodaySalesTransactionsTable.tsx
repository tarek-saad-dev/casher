'use client';

import { useState } from 'react';
import { Search, Receipt, User, Package, CreditCard, Clock, Tag } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { TodaySaleTransaction } from '@/lib/types/today-sales';

interface TodaySalesTransactionsTableProps {
  transactions: TodaySaleTransaction[];
  onInvoiceClick?: (invId: number) => void;
}

export default function TodaySalesTransactionsTable({ 
  transactions, 
  onInvoiceClick 
}: TodaySalesTransactionsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('ar-EG', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  };

  const filteredTransactions = transactions.filter(txn => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      txn.invId.toString().includes(query) ||
      txn.clientName?.toLowerCase().includes(query) ||
      txn.barbers.toLowerCase().includes(query) ||
      txn.services.toLowerCase().includes(query) ||
      txn.paymentMethod.toLowerCase().includes(query)
    );
  });

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد معاملات</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <Input
            placeholder="بحث في الفواتير (رقم، عميل، حلاق، خدمة...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10 bg-zinc-900/60 border-zinc-800/50"
          />
        </div>
        <div className="text-sm text-zinc-400">
          {filteredTransactions.length} من {transactions.length}
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-800/40 border-b border-zinc-700/50">
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">الفاتورة</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">الوقت</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">العميل</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">الحلاقين</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">الخدمات</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">المبلغ</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">الدفع</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-400">الوردية</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((txn) => (
                <tr 
                  key={txn.invId}
                  className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                  onClick={() => onInvoiceClick?.(txn.invId)}
                  style={{ cursor: onInvoiceClick ? 'pointer' : 'default' }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-sm font-bold text-white">#{txn.invId}</span>
                      {txn.discount > 0 && (
                        <Badge variant="outline" className="text-xs bg-rose-500/10 text-rose-400 border-rose-500/20">
                          <Tag className="w-3 h-3 ml-1" />
                          خصم
                        </Badge>
                      )}
                      {txn.isSplitPayment && (
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">
                          دفع متعدد
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <Clock className="w-3 h-3" />
                      <span>{txn.invTime || '-'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-sm text-zinc-300">{txn.clientName || 'بدون عميل'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-sm text-zinc-300 truncate max-w-[150px]" title={txn.barbers}>
                        {txn.barbers}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-sm text-zinc-300 truncate max-w-[200px]" title={txn.services}>
                        {txn.services}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-left">
                      <p className="text-sm font-bold text-emerald-400">{formatCurrency(txn.totalAmount)}</p>
                      {txn.discount > 0 && (
                        <p className="text-xs text-zinc-500">خصم: {formatCurrency(txn.discount)}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-sm text-zinc-300">{txn.paymentMethod}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">{txn.shiftName}</p>
                      <p className="text-xs text-zinc-500">{txn.userName}</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredTransactions.length === 0 && searchQuery && (
          <div className="text-center py-8 text-zinc-500">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">لا توجد نتائج للبحث "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
