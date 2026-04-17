'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { TreasuryMovement } from '@/lib/types/treasury';

interface TreasuryMovementsTableProps {
  movements: TreasuryMovement[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  loading?: boolean;
  onPageChange: (page: number) => void;
}

export default function TreasuryMovementsTable({ 
  movements, 
  pagination,
  loading,
  onPageChange 
}: TreasuryMovementsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const filteredMovements = movements.filter(m => 
    searchTerm === '' ||
    m.invType.includes(searchTerm) ||
    m.paymentMethodName.includes(searchTerm) ||
    m.notes?.includes(searchTerm) ||
    m.userName?.includes(searchTerm)
  );

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-5 shadow-xl shadow-black/10">
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-zinc-800/40 rounded-xl"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-5 shadow-xl shadow-black/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xl font-bold text-white tracking-tight">تفاصيل الحركات</h3>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="بحث..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl pr-10 pl-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/50">
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">ID</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">النوع</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">التاريخ</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">الوقت</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">طريقة الدفع</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">الاتجاه</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">المبلغ</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">المستخدم</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-zinc-400">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-zinc-500">
                  لا توجد حركات
                </td>
              </tr>
            ) : (
              filteredMovements.map((movement) => (
                <tr 
                  key={movement.id}
                  className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                >
                  <td className="py-3 px-4 text-sm text-zinc-400">
                    #{movement.invId}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-white font-medium">
                      {movement.invType}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-zinc-400">
                    {formatDate(movement.invDate)}
                  </td>
                  <td className="py-3 px-4 text-sm text-zinc-400">
                    {movement.invTime}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-white">
                      {movement.paymentMethodName}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {movement.inOut === 'in' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-medium">
                        <ArrowUpRight className="h-3 w-3" />
                        وارد
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-xs font-medium">
                        <ArrowDownRight className="h-3 w-3" />
                        صادر
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-sm font-bold ${
                      movement.inOut === 'in' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {formatCurrency(movement.amount)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-zinc-400">
                    {movement.userName || '—'}
                  </td>
                  <td className="py-3 px-4 text-sm text-zinc-500 max-w-xs truncate">
                    {movement.notes || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-5 border-t border-zinc-800/50">
          <div className="text-sm text-zinc-400">
            صفحة {pagination.page} من {pagination.totalPages} ({pagination.total} حركة)
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="p-2 bg-zinc-800/40 border border-zinc-700/30 rounded-lg text-zinc-400 hover:bg-zinc-800/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            
            <div className="flex items-center gap-1">
              {[...Array(Math.min(5, pagination.totalPages))].map((_, i) => {
                const pageNum = i + 1;
                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange(pageNum)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      pagination.page === pageNum
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-zinc-800/40 text-zinc-400 border border-zinc-700/30 hover:bg-zinc-800/60'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="p-2 bg-zinc-800/40 border border-zinc-700/30 rounded-lg text-zinc-400 hover:bg-zinc-800/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
