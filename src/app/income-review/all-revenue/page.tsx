'use client';

import { useState, useEffect, useCallback } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import FinancialClassificationPanel, {
  IncomeRowClassificationBadge,
} from '@/components/reports/FinancialClassificationPanel';
import { Button } from '@/components/ui/button';
import {
  Coins,
  CalendarDays,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Trash2,
  AlertTriangle,
  Loader2,
  Hash,
  TrendingUp,
  Pencil,
  Save,
  X,
  CheckSquare,
  Square,
  ArrowRight,
  Edit3,
} from 'lucide-react';
import { cashMoveDeleteToastMessage, notifyEmployeeLedgerRefresh } from '@/lib/cashMoveDeleteClient';

/* ────────── types ────────── */
interface RevenueItem {
  ID: number;
  invID: number;
  invDate: string;
  invTime: string;
  ExpINID: number;
  CategoryName: string;
  Amount: number;
  Notes: string | null;
  PaymentMethodID: number;
  PaymentMethod: string;
  ShiftMoveID: number | null;
  UserName: string | null;
  reportClassification?: {
    bucket: string;
    label: string;
    isRealRevenue: boolean;
    treasuryLabel?: string;
  };
}

interface RevenueSummary {
  TotalIncome: number;
  IncomeCount: number;
  AverageIncome: number;
}

interface CategoryGroup {
  ExpINID: number;
  CategoryName: string;
  TotalAmount: number;
  Count: number;
  items: RevenueItem[];
}

interface IncomeCategory {
  ExpINID: number;
  ExpINType: string;
  CatName: string;
}

interface PaymentMethod {
  PaymentID: number;
  PaymentMethod: string;
}

/* ────────── helpers ────────── */
const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ج.م';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });

const toLocalISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/* ────────── component ────────── */
export default function AllRevenuePage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [fromDate, setFromDate] = useState(toLocalISO(firstOfMonth));
  const [toDate, setToDate] = useState(toLocalISO(now));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<RevenueItem[]>([]);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [classificationPayload, setClassificationPayload] = useState<{
    classificationEnabled?: boolean;
    classifiedTotals?: import('@/lib/types/financial-report-classification').ClassifiedTotals;
    classificationBreakdown?: import('@/lib/types/financial-report-classification').ClassificationBreakdownItem[];
  } | null>(null);

  const [expandedCat, setExpandedCat] = useState<number | null>(null);
  const [deletingCat, setDeletingCat] = useState<{ ExpINID: number; name: string; count: number } | null>(null);
  const [deletingId, setDeletingId] = useState<{ ID: number; invID: number } | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  /* ── toast state ── */
  const [toastState, setToastState] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    setToastState({ msg, ok });
    setTimeout(() => setToastState(null), 4500);
  }, []);
  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    showToast(message, type !== 'error');
  }, [showToast]);

  /* ── edit state ── */
  const [editingItem, setEditingItem] = useState<RevenueItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [categoriesList, setCategoriesList] = useState<IncomeCategory[]>([]);
  const [paymentMethodsList, setPaymentMethodsList] = useState<PaymentMethod[]>([]);

  // Bulk selection state
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [quickTransferCategoryId, setQuickTransferCategoryId] = useState('');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    invDate: '',
    invTime: '',
    amount: '',
    expInId: '',
    paymentMethodId: '',
    notes: '',
  });

  /* ── fetch meta (categories & payment methods) ── */
  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/incomes/meta');
      if (res.ok) {
        const data = await res.json();
        setCategoriesList(data.categories || []);
        setPaymentMethodsList(data.paymentMethods || []);
      }
    } catch (err) {
      console.error('Failed to fetch meta:', err);
    }
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  /* ── bulk selection handlers ── */
  const handleSelectItem = (itemId: number) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleSelectAll = (categoryItems: RevenueItem[]) => {
    const allIds = categoryItems.map(item => item.ID);
    const allSelected = allIds.every(id => selectedItems.has(id));

    if (allSelected) {
      // Deselect all in this category
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        allIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    } else {
      // Select all in this category
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        allIds.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedItems(new Set());
    setQuickTransferCategoryId('');
  };

  /* ── quick transfer function ── */
  const handleQuickTransfer = async () => {
    if (selectedItems.size === 0) {
      showToast('يرجى اختيار عنصر واحد على الأقل', false);
      return;
    }

    if (!quickTransferCategoryId) {
      showToast('يرجى اختيار التصنيف', false);
      return;
    }

    setIsBulkUpdating(true);
    try {
      const response = await fetch('/api/incomes/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: Array.from(selectedItems),
          expInId: Number(quickTransferCategoryId)
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'فشل النقل السريع');
      }

      const result = await response.json();
      showToast(`تم نقل ${result.updatedCount} إيراد بنجاح`, true);

      // Reset state
      setSelectedItems(new Set());
      setQuickTransferCategoryId('');
      fetchData();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'حدث خطأ أثناء النقل السريع',
        false
      );
    } finally {
      setIsBulkUpdating(false);
    }
  };

  /* ── bulk category update ── */
  const handleBulkCategoryUpdate = async () => {
    if (selectedItems.size === 0) {
      showToast('يرجى اختيار عنصر واحد على الأقل', false);
      return;
    }

    if (!bulkCategoryId) {
      showToast('يرجى اختيار التصنيف الجديد', false);
      return;
    }

    setIsBulkUpdating(true);
    try {
      const response = await fetch('/api/incomes/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: Array.from(selectedItems),
          expInId: Number(bulkCategoryId)
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'فشل التحديث الجماعي');
      }

      const result = await response.json();
      showToast(`تم تحديث ${result.updatedCount} إيراد بنجاح`, true);

      // Reset state
      setSelectedItems(new Set());
      setBulkCategoryId('');
      setIsBulkEditOpen(false);
      fetchData();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'حدث خطأ أثناء التحديث الجماعي',
        false
      );
    } finally {
      setIsBulkUpdating(false);
    }
  };

  /* ── open edit modal ── */
  const handleEditClick = (item: RevenueItem) => {
    setEditingItem(item);
    setEditForm({
      invDate: item.invDate,
      invTime: item.invTime || '',
      amount: String(item.Amount),
      expInId: String(item.ExpINID),
      paymentMethodId: String(item.PaymentMethodID || ''),
      notes: item.Notes || '',
    });
    setIsEditModalOpen(true);
  };

  /* ── save edit ── */
  const handleSaveEdit = async () => {
    if (!editingItem) return;

    // Validation
    if (!editForm.invDate) {
      showToast('التاريخ مطلوب', false);
      return;
    }
    if (!editForm.amount || Number(editForm.amount) <= 0) {
      showToast('المبلغ يجب أن يكون أكبر من صفر', false);
      return;
    }
    if (!editForm.expInId) {
      showToast('يجب اختيار التصنيف', false);
      return;
    }
    if (!editForm.paymentMethodId) {
      showToast('يجب اختيار طريقة الدفع', false);
      return;
    }

    setIsSaving(true);
    try {
      const res  = await fetch(`/api/incomes/${editingItem.ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invDate: editForm.invDate,
          amount: Number(editForm.amount),
          expInId: Number(editForm.expInId),
          paymentMethodId: Number(editForm.paymentMethodId),
          notes: editForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'فشل تعديل الإيراد', false);
      } else {
        showToast(
          data.ledgerDualWrite
            ? 'تم تعديل الإيراد ومزامنة دفتر الموظفين'
            : 'تم تعديل الإيراد بنجاح',
          true,
        );
        setIsEditModalOpen(false);
        setEditingItem(null);
        fetchData();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء التعديل', false);
    } finally {
      setIsSaving(false);
    }
  };

  /* ── fetch ── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incomes?fromDate=${fromDate}&toDate=${toDate}`);
      if (!res.ok) throw new Error((await res.json()).error || 'فشل تحميل البيانات');
      const data = await res.json();
      setItems(data.items ?? []);
      setSummary(data.summary ?? null);
      setClassificationPayload({
        classificationEnabled: data.classificationEnabled,
        classifiedTotals: data.classifiedTotals,
        classificationBreakdown: data.classificationBreakdown,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── group by category ── */
  const categories: CategoryGroup[] = (() => {
    const map = new Map<number, CategoryGroup>();
    items.forEach((item) => {
      if (!map.has(item.ExpINID)) {
        map.set(item.ExpINID, { ExpINID: item.ExpINID, CategoryName: item.CategoryName, TotalAmount: 0, Count: 0, items: [] });
      }
      const g = map.get(item.ExpINID)!;
      g.TotalAmount += item.Amount;
      g.Count += 1;
      g.items.push(item);
    });
    return Array.from(map.values()).sort((a, b) => b.TotalAmount - a.TotalAmount);
  })();

  /* ── delete single ── */
  const handleDeleteOne = async () => {
    if (!deletingId) return;
    const reason = window.prompt('سبب حذف الإيراد (مطلوب):');
    if (reason === null) { setDeletingId(null); return; }
    if (!reason.trim()) {
      addToast('error', 'يجب إدخال سبب للحذف');
      setBusyDelete(false);
      return;
    }
    setBusyDelete(true);
    try {
      const res  = await fetch(`/api/incomes/${deletingId.ID}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        addToast('error', data.error || 'فشل حذف الإيراد');
      } else {
        addToast('success', cashMoveDeleteToastMessage(data, 'تم حذف الإيراد بنجاح'));
        if (data.ledgerDeletedCount > 0) notifyEmployeeLedgerRefresh();
        setDeletingId(null);
        fetchData();
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setBusyDelete(false);
    }
  };

  /* ── delete all in category ── */
  const handleDeleteCategory = async () => {
    if (!deletingCat) return;
    const reason = window.prompt('سبب حذف الإيرادات في هذا التصنيف (مطلوب):');
    if (reason === null) { setDeletingCat(null); return; }
    if (!reason.trim()) {
      addToast('error', 'يجب إدخال سبب للحذف');
      return;
    }
    setBusyDelete(true);
    try {
      const catItems = items.filter((i) => i.ExpINID === deletingCat.ExpINID);
      let anyLedgerDeleted = false;
      for (const item of catItems) {
        const res = await fetch(`/api/incomes/${item.ID}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        });
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'فشل حذف الإيرادات');
        if (data.ledgerDeletedCount > 0) anyLedgerDeleted = true;
      }
      setDeletingCat(null);
      addToast(
        'success',
        anyLedgerDeleted
          ? 'تم حذف الحركة وحذف تأثيرها من دفتر الموظفين.'
          : 'تم حذف الإيرادات بنجاح',
      );
      if (anyLedgerDeleted) notifyEmployeeLedgerRefresh();
      fetchData();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader title="كل الإيرادات" description="مراجعة جميع الإيرادات حسب الفئة مع فلاتر متقدمة" />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 bg-card border border-border rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">من تاريخ</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">إلى تاريخ</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
          />
        </div>
        <Button onClick={fetchData} disabled={loading} className="gap-2 bg-primary hover:bg-primary/85 text-primary-foreground h-9">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive-soft border border-destructive/30 rounded-lg p-4 text-destructive text-sm font-medium">
          خطأ: {error}
        </div>
      )}

      {/* KPIs */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="إجمالي الإيرادات"
            value={fmt(summary.TotalIncome)}
            icon={<Coins className="w-5 h-5" />}
            variant="primary"
          />
          <KpiCard
            title="عدد العمليات"
            value={String(summary.IncomeCount)}
            icon={<Hash className="w-5 h-5" />}
          />
          <KpiCard
            title="متوسط القيمة"
            value={fmt(summary.AverageIncome)}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="warning"
          />
        </div>
      )}

      <FinancialClassificationPanel
        payload={classificationPayload ?? undefined}
        loading={loading}
        variant="income"
        showCleanNetProfit={false}
      />

      {/* Bulk Selection Controls */}
      {categoriesList.length > 0 && (
        <div className="bg-warning-soft border border-warning/30 rounded-xl p-4">
          <div className="space-y-3">
            {/* Selection Info - only show when items are selected */}
            {selectedItems.size > 0 && (
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckSquare className="h-5 w-5 text-warning" />
                  <span className="text-warning font-medium">
                    تم اختيار {selectedItems.size} {selectedItems.size === 1 ? 'إيراد' : 'إيرادات'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearSelection}
                    className="gap-2 border-border text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                    إلغاء الاختيار
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setIsBulkEditOpen(true)}
                    className="gap-2 bg-muted hover:bg-surface-muted"
                  >
                    <Edit3 className="h-4 w-4" />
                    تعديل مفصل
                  </Button>
                </div>
              </div>
            )}

            {/* Quick Transfer - always visible when categories exist */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-warning">نقل سريع:</span>
              <select
                value={quickTransferCategoryId}
                onChange={(e) => setQuickTransferCategoryId(e.target.value)}
                className="h-8 rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none min-w-[200px]"
              >
                <option value="">اختر التصنيف</option>
                {categoriesList.map((cat) => (
                  <option key={cat.ExpINID} value={cat.ExpINID}>
                    {cat.CatName}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={handleQuickTransfer}
                disabled={isBulkUpdating || !quickTransferCategoryId || selectedItems.size === 0}
                className="gap-2 bg-primary hover:bg-primary/85 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {isBulkUpdating ? 'جاري النقل...' : `نقل ${selectedItems.size > 0 ? `(${selectedItems.size})` : ''}`}
              </Button>
              {selectedItems.size === 0 && (
                <span className="text-xs text-muted-foreground">يرجى اختيار إيرادات أولاً</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category groups */}
      {!loading && categories.length === 0 && (
        <EmptyState
          title="لا توجد إيرادات"
          description="لا توجد إيرادات في الفترة المحددة"
          icon={<CalendarDays className="w-8 h-8 text-warning" />}
        />
      )}

      {loading && categories.length === 0 && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {categories.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">الإيرادات حسب الفئة</h2>
          {categories.map((cat) => {
            const isOpen = expandedCat === cat.ExpINID;
            return (
              <div key={cat.ExpINID} className="border border-border rounded-xl overflow-hidden bg-card">
                {/* Category header */}
                <div className={`p-4 transition-colors ${isOpen ? 'bg-muted' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      {isOpen && (
                        <button
                          onClick={() => handleSelectAll(cat.items)}
                          className="shrink-0 hover:opacity-80 transition-opacity"
                          title="اختر الكل"
                        >
                          {cat.items.every(item => selectedItems.has(item.ID)) ? (
                            <CheckSquare className="h-5 w-5 text-warning" />
                          ) : (
                            <Square className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedCat(isOpen ? null : cat.ExpINID)}
                        className="flex items-center gap-3 flex-1 text-right hover:opacity-80 transition-opacity"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
                        )}
                        <div>
                          <span className="font-medium text-foreground">{cat.CategoryName}</span>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {cat.Count} {cat.Count === 1 ? 'عملية' : 'عمليات'}
                          </div>
                        </div>
                      </button>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-lg font-bold text-success">{fmt(cat.TotalAmount)}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingCat({ ExpINID: cat.ExpINID, name: cat.CategoryName, count: cat.Count });
                        }}
                        className="gap-1.5 text-xs text-destructive border-destructive/30 hover:text-destructive hover:bg-destructive-soft"
                      >
                        <Trash2 className="h-3 w-3" />
                        مسح الكل
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded transactions */}
                {isOpen && (
                  <div className="border-t border-border bg-background">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border bg-card">
                            <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground w-8">
                              {isOpen && (
                                <button
                                  onClick={() => handleSelectAll(cat.items)}
                                  className="hover:opacity-80 transition-opacity"
                                  title="اختر الكل"
                                >
                                  {cat.items.every(item => selectedItems.has(item.ID)) ? (
                                    <CheckSquare className="h-4 w-4 text-warning" />
                                  ) : (
                                    <Square className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </button>
                              )}
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">#</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">التاريخ</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">الوقت</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">المبلغ</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">طريقة الدفع</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">المستخدم</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">الملاحظات</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">إجراء</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.items.map((item) => (
                            <tr key={item.ID} className={`border-b border-border last:border-0 hover:bg-surface-muted transition-colors ${selectedItems.has(item.ID) ? 'bg-warning-soft' : ''}`}>
                              <td className="py-2.5 px-3 text-xs text-center">
                                <button
                                  onClick={() => handleSelectItem(item.ID)}
                                  className="hover:opacity-80 transition-opacity"
                                  title="اختر"
                                >
                                  {selectedItems.has(item.ID) ? (
                                    <CheckSquare className="h-4 w-4 text-warning" />
                                  ) : (
                                    <Square className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </button>
                              </td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground">{item.invID}</td>
                              <td className="py-2.5 px-3 text-xs text-foreground">{fmtDate(item.invDate)}</td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground">{item.invTime || '—'}</td>
                              <td className="py-2.5 px-3 text-xs font-bold text-success">
                                <div className="flex flex-col gap-1">
                                  <span>{fmt(item.Amount)}</span>
                                  <IncomeRowClassificationBadge reportClassification={item.reportClassification} />
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground">{item.PaymentMethod || '—'}</td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground">{item.UserName || '—'}</td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[200px] truncate">{item.Notes || '—'}</td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleEditClick(item)}
                                    className="text-warning hover:text-warning hover:bg-warning-soft"
                                    title="تعديل"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => setDeletingId({ ID: item.ID, invID: item.invID })}
                                    className="text-destructive hover:text-destructive hover:bg-destructive-soft"
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
      )}

      {/* ── Delete single confirmation ── */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-foreground mb-3">تأكيد الحذف</h3>
            <p className="text-sm text-muted-foreground mb-5">
              هل أنت متأكد من حذف الإيراد رقم <span className="font-bold text-foreground">#{deletingId.invID}</span>؟
              <br />
              <span className="text-destructive">لا يمكن التراجع عن هذا الإجراء.</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setDeletingId(null)} disabled={busyDelete}>
                إلغاء
              </Button>
              <Button variant="destructive" onClick={handleDeleteOne} disabled={busyDelete} className="gap-2">
                {busyDelete ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {busyDelete ? 'جاري الحذف...' : 'حذف'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete category confirmation ── */}
      {deletingCat && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <h3 className="text-lg font-semibold text-foreground">تحذير: حذف جماعي</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              هل أنت متأكد من حذف <span className="font-bold text-destructive">{deletingCat.count}</span> إيراد من فئة{' '}
              <span className="font-bold text-foreground">&quot;{deletingCat.name}&quot;</span>؟
              <br /><br />
              <span className="text-destructive font-semibold">⚠️ سيتم حذف جميع الإيرادات تحت هذه الفئة في الفترة المحددة!</span>
              <br />
              <span className="text-destructive">لا يمكن التراجع عن هذا الإجراء.</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setDeletingCat(null)} disabled={busyDelete}>
                إلغاء
              </Button>
              <Button variant="destructive" onClick={handleDeleteCategory} disabled={busyDelete} className="gap-2">
                {busyDelete ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {busyDelete ? 'جاري الحذف...' : `حذف الكل (${deletingCat.count})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {isEditModalOpen && editingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Pencil className="h-5 w-5 text-warning" />
                تعديل الإيراد #{editingItem.invID}
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsEditModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-4">
              {/* Amount */}
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">المبلغ <span className="text-destructive">*</span></label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
                  placeholder="0.00"
                />
              </div>

              {/* Date */}
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">التاريخ <span className="text-destructive">*</span></label>
                <input
                  type="date"
                  value={editForm.invDate}
                  onChange={(e) => setEditForm({ ...editForm, invDate: e.target.value })}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
                />
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">التصنيف <span className="text-destructive">*</span></label>
                <select
                  value={editForm.expInId}
                  onChange={(e) => setEditForm({ ...editForm, expInId: e.target.value })}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
                >
                  <option value="">اختر التصنيف</option>
                  {categoriesList.map((cat) => (
                    <option key={cat.ExpINID} value={cat.ExpINID}>
                      {cat.CatName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Payment Method */}
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">طريقة الدفع <span className="text-destructive">*</span></label>
                <select
                  value={editForm.paymentMethodId}
                  onChange={(e) => setEditForm({ ...editForm, paymentMethodId: e.target.value })}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
                >
                  <option value="">اختر طريقة الدفع</option>
                  {paymentMethodsList.map((pm) => (
                    <option key={pm.PaymentID} value={pm.PaymentID}>
                      {pm.PaymentMethod}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">الملاحظات</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-warning/30 focus:outline-none resize-none"
                  placeholder="أضف ملاحظات..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSaving}
              >
                إلغاء
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="gap-2 bg-primary hover:bg-primary/85 text-primary-foreground"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Edit Modal ── */}
      {isBulkEditOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-warning" />
                نقل {selectedItems.size} {selectedItems.size === 1 ? 'إيراد' : 'إيرادات'}
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsBulkEditOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="bg-warning-soft border border-warning/30 rounded-lg p-3">
                <p className="text-sm text-warning">
                  سيتم نقل {selectedItems.size} {selectedItems.size === 1 ? 'إيراد' : 'إيرادات'} للتصنيف الجديد
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">التصنيف الجديد <span className="text-destructive">*</span></label>
                <select
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-warning/30 focus:outline-none"
                >
                  <option value="">اختر التصنيف الجديد</option>
                  {categoriesList.map((cat) => (
                    <option key={cat.ExpINID} value={cat.ExpINID}>
                      {cat.CatName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setIsBulkEditOpen(false)}
                disabled={isBulkUpdating}
              >
                إلغاء
              </Button>
              <Button
                onClick={handleBulkCategoryUpdate}
                disabled={isBulkUpdating || !bulkCategoryId}
                className="gap-2 bg-primary hover:bg-primary/85 text-primary-foreground"
              >
                {isBulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {isBulkUpdating ? 'جاري النقل...' : `نقل (${selectedItems.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastState && (
        <div
          className="fixed bottom-5 right-1/2 translate-x-1/2 z-[60] px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border transition-all"
          style={{
            background: toastState.ok ? '#141418' : 'rgba(239,68,68,0.15)',
            color: toastState.ok ? '#F7F1E5' : '#EF4444',
            borderColor: toastState.ok ? '#2A2A35' : 'rgba(239,68,68,0.35)',
          }}>
          {toastState.msg}
        </div>
      )}
    </div>
  );
}
