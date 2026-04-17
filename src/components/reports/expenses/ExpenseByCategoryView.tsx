'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronDown, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EditExpenseCategoryDialog from './EditExpenseCategoryDialog';
import type { ExpenseTransaction } from '@/lib/types';

interface CategoryExpenses {
  CatName: string;
  ExpINID: number;
  TotalAmount: number;
  Count: number;
  transactions: ExpenseTransaction[];
}

interface ExpenseByCategoryViewProps {
  transactions: ExpenseTransaction[];
  loading: boolean;
  onRefresh?: () => void;
}

export default function ExpenseByCategoryView({
  transactions,
  loading,
  onRefresh,
}: ExpenseByCategoryViewProps) {
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [editingExpense, setEditingExpense] = useState<{ id: number; category: string } | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<{ id: number; invID: number } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<{ ExpINID: number; CatName: string; Count: number } | null>(null);
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
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">المصروفات حسب الفئة</h3>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  // Group transactions by category
  const categoryMap = new Map<number, CategoryExpenses>();
  
  transactions.forEach((transaction) => {
    const catId = transaction.ExpINID;
    if (!categoryMap.has(catId)) {
      categoryMap.set(catId, {
        CatName: transaction.CatName,
        ExpINID: catId,
        TotalAmount: 0,
        Count: 0,
        transactions: [],
      });
    }
    const cat = categoryMap.get(catId)!;
    cat.TotalAmount += transaction.GrandTolal;
    cat.Count += 1;
    cat.transactions.push(transaction);
  });

  // Convert to array and sort by total amount descending
  const categories = Array.from(categoryMap.values()).sort(
    (a, b) => b.TotalAmount - a.TotalAmount
  );

  if (categories.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">المصروفات حسب الفئة</h3>
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">لا توجد مصروفات في هذا الشهر</p>
        </div>
      </div>
    );
  }

  const toggleCategory = (catId: number) => {
    setExpandedCategory(expandedCategory === catId ? null : catId);
  };

  const handleEditSuccess = () => {
    setEditingExpense(null);
    if (onRefresh) {
      onRefresh();
    }
  };

  const handleDeleteExpense = async () => {
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

  const handleDeleteCategoryExpenses = async () => {
    if (!deletingCategory) return;

    setDeleting(true);
    try {
      // Get all transaction IDs in this category
      const categoryTransactions = transactions.filter(t => t.ExpINID === deletingCategory.ExpINID);
      
      // Delete each transaction
      for (const transaction of categoryTransactions) {
        const response = await fetch(`/api/expenses/${transaction.ID}/category`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'فشل حذف المصروفات');
        }
      }

      setDeletingCategory(null);
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
      {/* Edit Expense Dialog */}
      {editingExpense && (
        <EditExpenseCategoryDialog
          expenseId={editingExpense.id}
          currentCategory={editingExpense.category}
          onClose={() => setEditingExpense(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Delete Single Expense Confirmation */}
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
                onClick={handleDeleteExpense}
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

      {/* Delete All Category Expenses Confirmation */}
      {deletingCategory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <h3 className="text-lg font-semibold">تحذير: حذف جماعي</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              هل أنت متأكد من حذف <span className="font-bold text-destructive">{deletingCategory.Count}</span> مصروف من فئة{' '}
              <span className="font-bold">"{deletingCategory.CatName}"</span>؟
              <br />
              <br />
              <span className="text-destructive font-semibold">⚠️ سيتم حذف جميع المصروفات تحت هذه الفئة في هذا الشهر!</span>
              <br />
              <span className="text-destructive">لا يمكن التراجع عن هذا الإجراء.</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDeletingCategory(null)}
                disabled={deleting}
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteCategoryExpenses}
                disabled={deleting}
                className="gap-2"
              >
                {deleting ? (
                  <>جاري الحذف...</>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    حذف الكل ({deletingCategory.Count})
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">المصروفات حسب الفئة</h3>
      
      <div className="space-y-2">
        {categories.map((category) => {
          const isExpanded = expandedCategory === category.ExpINID;
          const hasUncategorized = category.transactions.some((t) => t.needsCategorization);

          return (
            <div key={category.ExpINID} className="border border-border rounded-lg overflow-hidden">
              {/* Category Header */}
              <div className={`p-4 transition-colors ${isExpanded ? 'bg-muted' : 'bg-card'}`}>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleCategory(category.ExpINID)}
                    className="flex items-center gap-3 flex-1 text-right hover:opacity-80 transition-opacity"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronLeft className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{category.CatName}</span>
                        {hasUncategorized && (
                          <span className="text-xs bg-amber-500/20 text-amber-700 px-2 py-0.5 rounded-full border border-amber-500/50">
                            ⚠️ يحتاج مراجعة
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {category.Count} {category.Count === 1 ? 'معاملة' : 'معاملات'}
                      </div>
                    </div>
                  </button>
                  
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-lg font-bold text-red-600">
                        {formatCurrency(category.TotalAmount)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingCategory({
                          ExpINID: category.ExpINID,
                          CatName: category.CatName,
                          Count: category.Count,
                        });
                      }}
                      className="gap-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      مسح الكل
                    </Button>
                  </div>
                </div>
              </div>

              {/* Expanded Transactions */}
              {isExpanded && (
                <div className="border-t border-border bg-muted/30">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">#</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">التاريخ</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">الوقت</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">المبلغ</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">طريقة الدفع</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">المستخدم</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">الملاحظات</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {category.transactions.map((transaction) => (
                          <tr
                            key={transaction.ID}
                            className={`border-b border-border last:border-0 ${
                              transaction.needsCategorization ? 'bg-amber-500/5' : 'bg-card'
                            }`}
                          >
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {transaction.invID}
                            </td>
                            <td className="py-2 px-3 text-xs">
                              {formatDate(transaction.invDate)}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {transaction.invTime}
                            </td>
                            <td className="py-2 px-3 text-xs font-bold text-red-600">
                              {formatCurrency(transaction.GrandTolal)}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {transaction.PaymentMethod || '—'}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {transaction.UserName || '—'}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground max-w-xs truncate">
                              {transaction.Notes || '—'}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingExpense({ id: transaction.ID, category: transaction.CatName })}
                                  className="h-7 w-7 p-0"
                                  title="تعديل"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeletingExpense({ id: transaction.ID, invID: transaction.invID })}
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  title="حذف"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </>
  );
}
