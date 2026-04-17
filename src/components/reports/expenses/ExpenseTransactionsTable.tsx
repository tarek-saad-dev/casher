'use client';

import { useState } from 'react';
import type { ExpenseTransaction } from '@/lib/types';
import { ChevronLeft, ChevronRight, AlertTriangle, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EditExpenseCategoryDialog from './EditExpenseCategoryDialog';

interface ExpenseTransactionsTableProps {
  transactions: ExpenseTransaction[];
  loading: boolean;
  onRefresh?: () => void;
}

export default function ExpenseTransactionsTable({
  transactions,
  loading,
  onRefresh,
}: ExpenseTransactionsTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(25);
  const [showOnlyUncategorized, setShowOnlyUncategorized] = useState(false);
  const [editingExpense, setEditingExpense] = useState<{ id: number; category: string } | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<{ id: number; invID: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      month: '2-digit',
      day: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">تفاصيل المعاملات</h3>
        <div className="space-y-2">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  // Filter transactions based on uncategorized flag
  const filteredTransactions = showOnlyUncategorized
    ? transactions.filter((t) => t.needsCategorization)
    : transactions;

  const uncategorizedCount = transactions.filter((t) => t.needsCategorization).length;

  if (filteredTransactions.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">تفاصيل المعاملات</h3>
          {uncategorizedCount > 0 && (
            <Button
              variant={showOnlyUncategorized ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowOnlyUncategorized(!showOnlyUncategorized)}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              غير مصنفة ({uncategorizedCount})
            </Button>
          )}
        </div>
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">
            {showOnlyUncategorized ? 'لا توجد معاملات غير مصنفة' : 'لا توجد معاملات في هذا الشهر'}
          </p>
          <p className="text-sm mt-2">
            {showOnlyUncategorized ? 'جميع المعاملات مصنفة بشكل صحيح' : 'جرب اختيار شهر آخر'}
          </p>
        </div>
      </div>
    );
  }

  // Pagination
  const totalPages = Math.ceil(filteredTransactions.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentTransactions = filteredTransactions.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handleEditSuccess = () => {
    setEditingExpense(null);
    if (onRefresh) {
      onRefresh();
    }
  };

  const handleDelete = async () => {
    if (!deletingExpense) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/expenses/${deletingExpense.id}/category`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل حذف المصروف');
      }

      setDeletingExpense(null);
      if (onRefresh) {
        onRefresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      alert(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {editingExpense && (
        <EditExpenseCategoryDialog
          expenseId={editingExpense.id}
          currentCategory={editingExpense.category}
          onClose={() => setEditingExpense(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {deletingExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold mb-3">تأكيد الحذف</h3>
            <p className="text-sm text-muted-foreground mb-4">
              هل أنت متأكد من حذف المصروف رقم <span className="font-bold">#{deletingExpense.invID}</span>؟
              <br />
              <span className="text-destructive">لا يمكن التراجع عن هذا الإجراء.</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDeletingExpense(null)}
                disabled={deleting}
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                className="gap-2"
              >
                {deleting ? (
                  <>جاري الحذف...</>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">تفاصيل المعاملات</h3>
        <div className="flex items-center gap-3">
          {uncategorizedCount > 0 && (
            <Button
              variant={showOnlyUncategorized ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setShowOnlyUncategorized(!showOnlyUncategorized);
                setCurrentPage(1); // Reset to first page when filtering
              }}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              {showOnlyUncategorized ? 'عرض الكل' : `غير مصنفة (${uncategorizedCount})`}
            </Button>
          )}
          <div className="text-sm text-muted-foreground">
            {showOnlyUncategorized 
              ? `${filteredTransactions.length} معاملة غير مصنفة`
              : `إجمالي: ${transactions.length} معاملة`
            }
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">#</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">التاريخ</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">الوقت</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">الفئة</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">المبلغ</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">طريقة الدفع</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">المستخدم</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">الملاحظات</th>
              <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {currentTransactions.map((transaction) => (
              <tr
                key={transaction.ID}
                className={`border-b border-border hover:bg-muted/50 transition-colors ${
                  transaction.needsCategorization ? 'bg-amber-500/5' : ''
                }`}
              >
                <td className="py-3 px-2 text-sm text-muted-foreground">
                  {transaction.invID}
                </td>
                <td className="py-3 px-2 text-sm">
                  {formatDate(transaction.invDate)}
                </td>
                <td className="py-3 px-2 text-sm text-muted-foreground">
                  {transaction.invTime}
                </td>
                <td className="py-3 px-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
                      transaction.needsCategorization 
                        ? 'bg-amber-500/20 text-amber-700 border border-amber-500/50' 
                        : 'bg-blue-500/10 text-blue-600'
                    }`}>
                      {transaction.CatName}
                    </span>
                    {transaction.needsCategorization && (
                      <span className="text-xs text-amber-600 font-medium">⚠️ يحتاج تصنيف</span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-2 text-sm font-bold text-red-600">
                  {formatCurrency(transaction.GrandTolal)}
                </td>
                <td className="py-3 px-2 text-sm text-muted-foreground">
                  {transaction.PaymentMethod || '—'}
                </td>
                <td className="py-3 px-2 text-sm text-muted-foreground">
                  {transaction.UserName || '—'}
                </td>
                <td className="py-3 px-2 text-sm text-muted-foreground max-w-xs truncate">
                  {transaction.Notes || '—'}
                </td>
                <td className="py-3 px-2">
                  {transaction.needsCategorization && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingExpense({ id: transaction.ID, category: transaction.CatName })}
                        className="gap-2 text-xs"
                      >
                        <Edit2 className="h-3 w-3" />
                        تعديل
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeletingExpense({ id: transaction.ID, invID: transaction.invID })}
                        className="gap-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        مسح
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <div className="text-sm text-muted-foreground">
            صفحة {currentPage} من {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
