'use client';

import { useMemo, useState } from 'react';
import { CreditCard, Edit2, Package, Receipt, Tag, Trash2, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DataTable, { type DataTableColumn } from '@/components/shared/DataTable';
import Toolbar from '@/components/shared/Toolbar';
import DeleteInvoiceDialog, { type DeleteInvoiceTarget } from '@/components/sales/DeleteInvoiceDialog';
import type { TodaySaleTransaction } from '@/lib/types/today-sales';

interface TodaySalesTransactionsTableProps {
  transactions: TodaySaleTransaction[];
  onInvoiceClick?: (invId: number) => void;
  onEdit?: (txn: TodaySaleTransaction) => void;
  onDelete?: (invId: number) => void;
  canEdit?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function TodaySalesTransactionsTable({
  transactions,
  onInvoiceClick,
  onEdit,
  onDelete,
  canEdit = false,
  loading = false,
  error = null,
  onRetry,
}: TodaySalesTransactionsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteInvoiceTarget | null>(null);

  const sortedTransactions = useMemo(
    () =>
      [...transactions].sort((a, b) => {
        const timeA = a.invTime || '00:00:00';
        const timeB = b.invTime || '00:00:00';
        return timeA.localeCompare(timeB);
      }),
    [transactions],
  );

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedTransactions;
    return sortedTransactions.filter(
      (txn) =>
        txn.invId.toString().includes(query) ||
        txn.clientName?.toLowerCase().includes(query) ||
        txn.barbers.toLowerCase().includes(query) ||
        txn.services.toLowerCase().includes(query) ||
        txn.paymentMethod.toLowerCase().includes(query),
    );
  }, [sortedTransactions, searchQuery]);

  const columns = useMemo<DataTableColumn<TodaySaleTransaction>[]>(() => {
    const cols: DataTableColumn<TodaySaleTransaction>[] = [
      {
        key: 'invId',
        header: 'الفاتورة',
        sortValue: (row) => row.invId,
        cell: (txn) => (
          <div className="flex items-center gap-2">
            <Receipt className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-semibold text-foreground">#{txn.invId}</span>
            {txn.discount > 0 ? (
              <Badge variant="outline" className="gap-1 text-xs text-destructive">
                <Tag className="size-3" aria-hidden />
                خصم
              </Badge>
            ) : null}
            {txn.isSplitPayment ? (
              <Badge variant="outline" className="text-xs text-warning">
                دفع متعدد
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: 'invTime',
        header: 'الوقت',
        sortValue: (row) => row.invTime || '',
        cell: (txn) => <span className="tabular-nums text-muted-foreground">{txn.invTime || '—'}</span>,
      },
      {
        key: 'client',
        header: 'العميل',
        sortValue: (row) => row.clientName || '',
        cell: (txn) => (
          <span className="inline-flex items-center gap-1.5">
            <User className="size-3.5 text-muted-foreground" aria-hidden />
            {txn.clientName || 'بدون عميل'}
          </span>
        ),
      },
      {
        key: 'barbers',
        header: 'الحلاقين',
        sortValue: (row) => row.barbers,
        cell: (txn) => <span className="line-clamp-1 max-w-[10rem]" title={txn.barbers}>{txn.barbers}</span>,
      },
      {
        key: 'services',
        header: 'الخدمات',
        sortValue: (row) => row.services,
        cell: (txn) => (
          <span className="inline-flex max-w-[14rem] items-center gap-1.5">
            <Package className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="line-clamp-1" title={txn.services}>{txn.services}</span>
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'المبلغ',
        numeric: true,
        sortValue: (row) => row.totalAmount,
        cell: (txn) => (
          <div>
            <p className="font-semibold text-success">{formatCurrency(txn.totalAmount)}</p>
            {txn.discount > 0 ? (
              <p className="text-xs text-muted-foreground">خصم: {formatCurrency(txn.discount)}</p>
            ) : null}
          </div>
        ),
      },
      {
        key: 'payment',
        header: 'الدفع',
        sortValue: (row) => row.paymentMethod,
        cell: (txn) => (
          <span className="inline-flex items-center gap-1.5">
            <CreditCard className="size-3.5 text-muted-foreground" aria-hidden />
            {txn.paymentMethod}
          </span>
        ),
      },
      {
        key: 'shift',
        header: 'الوردية',
        sortValue: (row) => row.shiftName,
        cell: (txn) => (
          <div>
            <p className="text-sm text-foreground">{txn.shiftName}</p>
            <p className="text-xs text-muted-foreground">{txn.userName}</p>
          </div>
        ),
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: 'إجراءات',
        align: 'center',
        cell: (txn) => (
          <div className="flex items-center justify-center gap-1">
            {onEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`تعديل الفاتورة ${txn.invId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(txn);
                }}
              >
                <Edit2 className="size-4" />
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                aria-label={`حذف الفاتورة ${txn.invId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget({ invId: txn.invId });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
        ),
      });
    }

    return cols;
  }, [canEdit, onEdit, onDelete]);

  return (
    <div className="space-y-3">
      <Toolbar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'بحث في الفواتير (رقم، عميل، حلاق، خدمة...)',
        }}
        actions={
          <span className="text-sm text-muted-foreground">
            {filteredTransactions.length} من {transactions.length}
          </span>
        }
        chips={
          searchQuery.trim()
            ? [
                {
                  key: 'q',
                  label: `بحث: ${searchQuery.trim()}`,
                  onRemove: () => setSearchQuery(''),
                },
              ]
            : undefined
        }
        onClearAll={() => setSearchQuery('')}
      />

      <DataTable
        columns={columns}
        rows={filteredTransactions}
        rowKey={(row) => row.invId}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={
          searchQuery.trim()
            ? { title: `لا توجد نتائج للبحث "${searchQuery.trim()}"`, kind: 'no-results' }
            : { title: 'لا توجد معاملات', description: 'لم تُسجَّل فواتير لهذا اليوم بعد', kind: 'empty' }
        }
        onRowClick={onInvoiceClick ? (row) => onInvoiceClick(row.invId) : undefined}
        maxHeight="60vh"
        dense
      />

      <DeleteInvoiceDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={(invId) => {
          setDeleteTarget(null);
          onDelete?.(invId);
        }}
      />
    </div>
  );
}
