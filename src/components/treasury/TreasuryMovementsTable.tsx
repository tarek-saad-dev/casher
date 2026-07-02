'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { TreasuryMovement } from '@/lib/types/treasury';
import { getMovementTypeLabel, getMovementTypeSearchText } from '@/lib/treasury';

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
    getMovementTypeSearchText(m).includes(searchTerm.toLowerCase()) ||
    m.paymentMethodName?.includes(searchTerm) ||
    m.notes?.includes(searchTerm) ||
    m.userName?.includes(searchTerm)
  );

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-surface to-surface/50 backdrop-blur-sm border border-border rounded-2xl p-5 shadow-xl shadow-background/10">
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-xl"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-surface to-surface/50 backdrop-blur-sm border border-border rounded-2xl p-5 shadow-xl shadow-background/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xl font-bold text-foreground tracking-tight">تفاصيل الحركات</h3>

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-muted border border-border rounded-xl pr-10 pl-4 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">ID</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">النوع</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">التاريخ</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">الوقت</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">طريقة الدفع</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">الاتجاه</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">المبلغ</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">المستخدم</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground">
                  لا توجد حركات
                </td>
              </tr>
            ) : (
              filteredMovements.map((movement) => (
                <tr
                  key={movement.id}
                  className="border-b border-border/60 hover:bg-muted/50 transition-colors"
                >
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    #{movement.invId}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-foreground font-medium">
                      {getMovementTypeLabel(movement)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {formatDate(movement.invDate)}
                  </td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {movement.invTime}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-foreground">
                      {movement.paymentMethodName}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {movement.inOut === 'in' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-success/10 text-success border border-success/20 rounded-full text-xs font-medium">
                        <ArrowUpRight className="h-3 w-3" />
                        وارد
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-full text-xs font-medium">
                        <ArrowDownRight className="h-3 w-3" />
                        صادر
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-sm font-bold ${
                      movement.inOut === 'in' ? 'text-success' : 'text-destructive'
                    }`}>
                      {formatCurrency(movement.amount)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {movement.userName || '—'}
                  </td>
                  <td className="py-3 px-4 text-sm text-muted-foreground max-w-xs truncate">
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
        <div className="flex items-center justify-between mt-5 pt-5 border-t border-border">
          <div className="text-sm text-muted-foreground">
            صفحة {pagination.page} من {pagination.totalPages} ({pagination.total} حركة)
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="p-2 bg-muted border border-border rounded-lg text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-muted text-muted-foreground border border-border hover:bg-muted/80'
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
              className="p-2 bg-muted border border-border rounded-lg text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
