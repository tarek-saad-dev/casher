'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Save, Loader2, AlertTriangle, CheckCircle2,
  Banknote, CreditCard, Wallet, Receipt,
  TrendingDown, Filter, RotateCcw, Search, Zap, Edit2, Trash2, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ShiftRequiredOverlay from '@/components/session/ShiftRequiredOverlay';
import EditExpenseModal from '@/components/expenses/EditExpenseModal';
import ExpenseReceiptPopup from '@/components/expenses/ExpenseReceiptPopup';
import { useSession } from '@/hooks/useSession';
import type { ExpenseCategory, ExpenseRecord, PaymentMethod } from '@/lib/types';

// ═══════════════════════════════════════════════════════════
// EXPENSES PAGE — New Expense Form + History + Summary
// ═══════════════════════════════════════════════════════════

// ──── Category Group Definitions ────
const CATEGORY_GROUPS: { key: string; label: string; catNames: string[] }[] = [
  {
    key: 'ops', label: 'تشغيل',
    catNames: ['بوفيه', 'تنظيف', 'توصيل', 'كهرباء', 'مياه كارت', 'مصاريف قانونيه', 'تكاليف سحب فلوس', 'اشتراكات شهريه', 'اقساط', 'نسبة ادارة'],
  },
  {
    key: 'stock', label: 'بضاعة',
    catNames: ['بضاعة', 'بضاعة من امازون', 'بضاعة من غازي', 'بضاعة من فؤاد', 'assets'],
  },
  {
    key: 'salary', label: 'رواتب',
    catNames: ['مرتبات اليوم', 'مرتبات الصنايعية', 'مرتبات المساعدين', 'تارجت'],
  },
  {
    key: 'loans', label: 'سلف',
    catNames: ['سلف', 'سلف ( أستاذ محمد )', 'سلف (طارق)', 'سلف باسم', 'سلفة ( ذياد المساعد )', 'سلفة (يوسف الجو)', 'سلفة يوسف المساعد(خيري)', 'سلفة(خيري)', 'سلفة(زين)', 'سلفة(كريم)', 'سلفة(محمد الدمياطي)', 'سلفه ( احمد المساعد )', 'سلفه ( ذياد )', 'سلفه ( محمد )', 'سلفه ( هدى )'],
  },
  {
    key: 'transfers', label: 'تحويلات',
    catNames: ['تحويلات', 'جمعيات'],
  },
  {
    key: 'finance', label: 'تسويات',
    catNames: ['صافي الربح', 'صافي ربح', 'عجز'],
  },
];

const QUICK_PICK_NAMES = ['بوفيه', 'توصيل', 'تنظيف', 'مرتبات اليوم', 'بضاعة', 'سلف', 'كهرباء'];

// Groups that use keyword matching instead of exact names
const KEYWORD_GROUPS: { key: string; keywords: string[] }[] = [
  { key: 'loans', keywords: ['سلف', 'سلفه', 'سلفة'] },
];

// Build a fast lookup: trimmed CatName → group key
// Exact matches first, then keyword fallback
function buildGroupLookup(): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of CATEGORY_GROUPS) {
    for (const name of g.catNames) {
      map.set(name.trim(), g.key);
    }
  }
  return map;
}
const GROUP_LOOKUP = buildGroupLookup();

function getCatGroupKey(catName: string): string {
  const trimmed = catName.trim();
  // Exact match first
  const exact = GROUP_LOOKUP.get(trimmed);
  if (exact) return exact;
  // Keyword match fallback
  const lower = trimmed.toLowerCase();
  for (const kg of KEYWORD_GROUPS) {
    if (kg.keywords.some(kw => lower.startsWith(kw) || lower.includes(kw))) {
      return kg.key;
    }
  }
  return '';
}

export default function ExpensesPage() {
  const { shift, hasActiveShift } = useSession();

  // ──── Lookup data ────
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // ──── Category UI state ────
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [catSearch, setCatSearch] = useState('');

  // ──── Form state ────
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // ──── Date helpers (local time, not UTC) ────
  function getLocalDateString(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ──── History / filter state ────
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeDatePreset, setActiveDatePreset] = useState<'today' | 'yesterday' | 'last7' | 'thisMonth' | 'all' | 'custom'>('today');
  const [dateFrom, setDateFrom] = useState<string>(() => getLocalDateString(new Date()));
  const [dateTo, setDateTo] = useState<string>(() => getLocalDateString(new Date()));
  const [filterCatId, setFilterCatId] = useState<string>('');
  const [filterPaymentMethodId, setFilterPaymentMethodId] = useState<string>(''); // 'all' or specific ID
  const [dateError, setDateError] = useState<string>('');
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [sortByAmountDesc, setSortByAmountDesc] = useState(false); // Toggle for amount sorting

  // ──── Edit state ────
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);

  // ──── Receipt state ────
  const [receiptExpense, setReceiptExpense] = useState<{
    invID: number;
    invDate: string;
    invTime: string;
    CatName: string;
    GrandTolal: number;
    PaymentMethod: string | null;
    Notes: string | null;
    UserName: string | null;
  } | null>(null);

  // ──── Set page title ────
  useEffect(() => {
    document.title = 'المصروفات | نظام نقاط البيع';
  }, []);

  // ──── Load lookup data on mount ────
  useEffect(() => {
    fetch('/api/expenses/categories')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCategories(d); })
      .catch(() => { });
    fetch('/api/payment-methods')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPaymentMethods(d); })
      .catch(() => { });
  }, []);

  // ──── Quick date presets ────
  const applyPreset = useCallback((preset: typeof activeDatePreset) => {
    const today = new Date();
    setDateError('');
    setActiveDatePreset(preset);
    setShowCustomRange(preset === 'custom');
    switch (preset) {
      case 'today': {
        const t = getLocalDateString(today);
        setDateFrom(t); setDateTo(t); break;
      }
      case 'yesterday': {
        const y = new Date(today); y.setDate(today.getDate() - 1);
        const ys = getLocalDateString(y);
        setDateFrom(ys); setDateTo(ys); break;
      }
      case 'last7': {
        const f = new Date(today); f.setDate(today.getDate() - 6);
        setDateFrom(getLocalDateString(f)); setDateTo(getLocalDateString(today)); break;
      }
      case 'thisMonth': {
        const f = new Date(today.getFullYear(), today.getMonth(), 1);
        setDateFrom(getLocalDateString(f)); setDateTo(getLocalDateString(today)); break;
      }
      case 'all':
        setDateFrom(''); setDateTo(''); break;
      case 'custom':
        break;
    }
  }, [activeDatePreset]);

  // ──── Load expenses history ────
  const loadExpenses = useCallback(() => {
    if (dateError) return;
    setLoadingHistory(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (filterCatId) params.set('catId', filterCatId);
    if (filterPaymentMethodId && filterPaymentMethodId !== 'all') {
      params.set('paymentMethodId', filterPaymentMethodId);
    }
    fetch(`/api/expenses?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setExpenses(d); })
      .catch(() => { })
      .finally(() => setLoadingHistory(false));
  }, [dateFrom, dateTo, filterCatId, filterPaymentMethodId, dateError]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  // ──── Summary calculations ────
  // Sort expenses by amount when toggle is on
  const sortedExpenses = useMemo(() => {
    if (sortByAmountDesc) {
      return [...expenses].sort((a, b) => (b.GrandTolal || 0) - (a.GrandTolal || 0));
    }
    return expenses;
  }, [expenses, sortByAmountDesc]);

  const totalExpenses = sortedExpenses.reduce((sum, e) => sum + (e.GrandTolal || 0), 0);
  const totalCash = sortedExpenses.filter(e => e.PaymentMethod === 'كاش').reduce((sum, e) => sum + (e.GrandTolal || 0), 0);
  const totalVisa = sortedExpenses.filter(e => e.PaymentMethod === 'فيزا').reduce((sum, e) => sum + (e.GrandTolal || 0), 0);

  // ──── Handle custom date input ────
  const handleCustomFrom = (val: string) => {
    setDateFrom(val); setActiveDatePreset('custom'); setDateError('');
    if (dateTo && val > dateTo) setDateError('تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية');
  };
  const handleCustomTo = (val: string) => {
    setDateTo(val); setActiveDatePreset('custom'); setDateError('');
    if (dateFrom && val < dateFrom) setDateError('تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية');
  };

  // ──── Reset filters ────
  const handleResetFilters = useCallback(() => {
    applyPreset('today');
    setFilterCatId('');
    setFilterPaymentMethodId('');
    setDateError('');
    setShowCustomRange(false);
  }, [applyPreset]);

  // ──── Friendly period label ────
  const periodLabel = useMemo(() => {
    switch (activeDatePreset) {
      case 'today': return 'عرض مصروفات اليوم';
      case 'yesterday': return 'عرض مصروفات أمس';
      case 'last7': return 'آخر 7 أيام';
      case 'thisMonth': return 'هذا الشهر';
      case 'all': return 'عرض كل المصروفات';
      case 'custom':
        if (dateFrom && dateTo && dateFrom === dateTo) return `مصروفات ${dateFrom}`;
        if (dateFrom && dateTo) return `من ${dateFrom} إلى ${dateTo}`;
        if (dateFrom) return `من ${dateFrom}`;
        if (dateTo) return `حتى ${dateTo}`;
        return 'فترة مخصصة';
    }
  }, [activeDatePreset, dateFrom, dateTo]);

  // ──── Reset form ────
  const resetForm = useCallback(() => {
    setSelectedCatId(null);
    setAmount('');
    setNotes('');
    setSaveError('');
    setSaveSuccess('');
  }, []);

  // ──── Save expense ────
  const handleSave = useCallback(async () => {
    setSaveError('');
    setSaveSuccess('');

    if (!selectedCatId) { setSaveError('يجب اختيار فئة المصروف'); return; }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { setSaveError('يجب إدخال مبلغ صحيح أكبر من صفر'); return; }
    if (!paymentMethodId) { setSaveError('يجب اختيار طريقة الدفع'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expINID: selectedCatId,
          amount: amountNum,
          paymentMethodId,
          notes,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || 'خطأ في حفظ المصروف');
        return;
      }

      const result = await res.json();
      setSaveSuccess(`✅ تم تسجيل المصروف بنجاح — #${result.invID} (${result.catName}: ${result.amount} ج.م)`);

      // Get current date and time for receipt
      const now = new Date();
      const currentDate = now.toISOString().split('T')[0];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Get payment method name
      const paymentMethod = paymentMethods.find(pm => pm.ID === paymentMethodId);

      // Show receipt modal
      setReceiptExpense({
        invID: result.invID,
        invDate: currentDate,
        invTime: currentTime,
        CatName: result.catName,
        GrandTolal: result.amount,
        PaymentMethod: paymentMethod?.Name || null,
        Notes: notes || null,
        UserName: null, // Will be populated from server if needed
      });

      resetForm();
      setPaymentMethodId(null);
      loadExpenses();

      // Clear success after 5s
      setTimeout(() => setSaveSuccess(''), 5000);
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }, [selectedCatId, amount, paymentMethodId, notes, paymentMethods, resetForm, loadExpenses]);

  // ──── Delete expense ────
  const handleDelete = useCallback(async (id: number, invID: number) => {
    if (!confirm(`هل أنت متأكد من حذف المصروف #${invID}؟`)) return;

    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'خطأ في حذف المصروف');
        return;
      }

      loadExpenses();
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  }, [loadExpenses]);

  // ──── Filtered categories by group + search ────
  const filteredCategories = useMemo(() => {
    let filtered = categories;

    if (activeGroup !== 'all') {
      filtered = filtered.filter(c => getCatGroupKey(c.CatName) === activeGroup);
    }

    if (catSearch.trim()) {
      const q = catSearch.trim().toLowerCase();
      filtered = filtered.filter(c => c.CatName.toLowerCase().includes(q));
    }

    return filtered;
  }, [categories, activeGroup, catSearch]);

  // ──── Quick pick categories (resolved from loaded data) ────
  const quickPicks = useMemo(() => {
    return QUICK_PICK_NAMES
      .map(name => categories.find(c => c.CatName.trim() === name))
      .filter((c): c is ExpenseCategory => !!c);
  }, [categories]);

  // ──── Payment method icons ────
  const PAYMENT_ICONS: Record<string, React.ReactNode> = {
    'كاش': <Banknote className="w-4 h-4" />,
    'فيزا': <CreditCard className="w-4 h-4" />,
  };

  // ──── Format date ────
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('ar-EG'); } catch { return d; }
  };

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden relative" dir="rtl">
      <ShiftRequiredOverlay />

      {/* ═══════════ LEFT PANEL: History + Summary ═══════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background order-1 lg:order-1 min-h-0">
        {/* Summary Cards */}
        <div className="p-2 sm:p-3 border-b border-border bg-gradient-to-br from-muted/30 to-muted/10 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <div className="rounded-lg border border-border p-2 sm:p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground mb-1">
                <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-[9px] sm:text-[10px] font-medium">إجمالي</span>
              </div>
              <p className="text-sm sm:text-lg font-black truncate">{totalExpenses.toLocaleString('ar-EG')} ج.م</p>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">{expenses.length} عملية</p>
            </div>
            <div className="rounded-lg border border-border p-2 sm:p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground mb-1">
                <Banknote className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-[9px] sm:text-[10px] font-medium">كاش</span>
              </div>
              <p className="text-sm sm:text-lg font-bold truncate">{totalCash.toLocaleString('ar-EG')} ج.م</p>
            </div>
            <div className="rounded-lg border border-border p-2 sm:p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground mb-1">
                <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-[9px] sm:text-[10px] font-medium">فيزا</span>
              </div>
              <p className="text-sm sm:text-lg font-bold truncate">{totalVisa.toLocaleString('ar-EG')} ج.م</p>
            </div>
          </div>
        </div>

        {/* ═══ Filters Bar ═══ */}
        <div className="px-2 sm:px-3 pt-2 sm:pt-2.5 pb-2 border-b border-border bg-zinc-900/60 space-y-2 shrink-0">

          {/* Row 1: Preset buttons + category */}
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-500 shrink-0" />

            {([
              { key: 'today', label: 'اليوم', fullLabel: 'اليوم' },
              { key: 'yesterday', label: 'أمس', fullLabel: 'أمس' },
              { key: 'last7', label: 'آخر 7', fullLabel: 'آخر 7 أيام' },
              { key: 'thisMonth', label: 'الشهر', fullLabel: 'هذا الشهر' },
              { key: 'all', label: 'الكل', fullLabel: 'الكل' },
            ] as const).map(({ key, label, fullLabel }) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-1 rounded-md border font-semibold transition-all ${activeDatePreset === key
                  ? 'border-primary bg-primary/15 text-primary shadow-sm shadow-primary/20'
                  : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground hover:bg-accent'
                  }`}
                title={fullLabel}
              >
                {label}
              </button>
            ))}

            {/* Custom range toggle */}
            <button
              onClick={() => { setShowCustomRange(v => !v); if (activeDatePreset !== 'custom') setActiveDatePreset('custom'); }}
              className={`text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-1 rounded-md border font-semibold transition-all flex items-center gap-1 ${activeDatePreset === 'custom'
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-400'
                : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground hover:bg-accent'
                }`}
            >
              <span className="hidden sm:inline">فترة مخصصة</span>
              <span className="sm:hidden">مخصص</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showCustomRange ? 'rotate-180' : ''}`} />
            </button>

            <div className="flex-1" />

            {/* Category filter */}
            <select
              value={filterCatId}
              onChange={(e) => setFilterCatId(e.target.value)}
              className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground max-w-[100px] sm:max-w-[140px] truncate"
            >
              <option value="">كل الفئات</option>
              {categories.map(c => (
                <option key={c.ExpINID} value={c.ExpINID}>{c.CatName}</option>
              ))}
            </select>

            {/* Payment Method filter */}
            <select
              value={filterPaymentMethodId}
              onChange={(e) => setFilterPaymentMethodId(e.target.value)}
              className="text-[11px] px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground max-w-[140px] truncate"
            >
              <option value="">كل وسائل الدفع</option>
              {paymentMethods.map(pm => (
                <option key={pm.ID} value={pm.ID}>{pm.Name}</option>
              ))}
            </select>

            {/* Reset */}
            <button
              onClick={handleResetFilters}
              className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-all flex items-center gap-1"
              title="إعادة تعيين"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">إعادة تعيين</span>
            </button>
          </div>

          {/* Row 2: Custom date range (collapsible) */}
          {showCustomRange && (
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <span className="text-[10px] sm:text-[11px] text-zinc-500">من</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => handleCustomFrom(e.target.value)}
                className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground"
              />
              <span className="text-[10px] sm:text-[11px] text-zinc-500">إلى</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => handleCustomTo(e.target.value)}
                className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground"
              />
              {dateError && (
                <span className="text-[9px] sm:text-[10px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{dateError}
                </span>
              )}
            </div>
          )}

          {/* Period label */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-500">
              <span className="text-zinc-400 font-medium">{periodLabel}</span>
              {expenses.length > 0 && !loadingHistory && (
                <span className="mr-1.5 text-zinc-600">— {expenses.length} عملية</span>
              )}
            </p>
            <button
              onClick={loadExpenses}
              disabled={!!dateError}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              تحديث
            </button>
          </div>
        </div>

        {/* Expenses List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3">
            {loadingHistory && (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 mx-auto animate-spin mb-2" />
                جاري التحميل...
              </div>
            )}

            {!loadingHistory && expenses.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {filterPaymentMethodId && filterPaymentMethodId !== 'all'
                    ? `لا توجد مصروفات بهذه الوسيلة في الفترة المحددة`
                    : 'لا توجد مصروفات'}
                </p>
                <p className="text-xs mt-1">
                  {filterPaymentMethodId && filterPaymentMethodId !== 'all'
                    ? 'جرب وسيلة دفع أخرى أو غيّر الفترة'
                    : 'سجّل مصروف جديد من النموذج على اليسار'}
                </p>
              </div>
            )}

            {/* List Header */}
            {!loadingHistory && sortedExpenses.length > 0 && (
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">
                    {activeDatePreset === 'today' ? 'مصروفات اليوم' :
                      activeDatePreset === 'yesterday' ? 'مصروفات أمس' :
                        activeDatePreset === 'last7' ? 'آخر 7 أيام' :
                          activeDatePreset === 'thisMonth' ? 'مصروفات الشهر' : 'عرض المصروفات'}
                  </span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {sortedExpenses.length} عملية
                  </span>
                </div>
                <button
                  onClick={() => setSortByAmountDesc(!sortByAmountDesc)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${sortByAmountDesc
                      ? 'bg-amber-500/10 border-amber-500/50 text-amber-400'
                      : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-300'
                    }`}
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  {sortByAmountDesc ? 'الأعلى للأقل' : 'ترتيب'}
                </button>
              </div>
            )}

            {!loadingHistory && sortedExpenses.length > 0 && (
              <div className="space-y-2">
                {sortedExpenses.map((exp, index) => {
                  const rank = sortByAmountDesc ? index + 1 : null;

                  return (
                    <div
                      key={exp.ID}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors"
                      style={{ scrollMarginTop: '10px' }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${rank === 1 ? 'bg-amber-500 text-amber-950' :
                            rank === 2 ? 'bg-zinc-300 text-zinc-900' :
                              rank === 3 ? 'bg-orange-500 text-orange-950' :
                                'bg-destructive/10 text-destructive'
                          }`}>
                          {rank && rank <= 3 ? (
                            <span className="text-lg font-black">{rank}</span>
                          ) : (
                            <TrendingDown className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-sm font-bold truncate">{exp.CatName}</span>
                            <Badge variant="outline" className="text-[9px] h-4 px-1">
                              #{exp.invID}
                            </Badge>
                            {sortByAmountDesc && rank && rank <= 3 && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] h-5 px-2 font-bold ${rank === 1 ? 'bg-amber-500/20 border-amber-500 text-amber-400' :
                                    rank === 2 ? 'bg-zinc-400/20 border-zinc-400 text-zinc-300' :
                                      'bg-orange-500/20 border-orange-500 text-orange-400'
                                  }`}
                              >
                                {rank === 1 ? '🥇 الأعلى' : rank === 2 ? '🥈' : '🥉'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span>{fmtDate(exp.invDate)}</span>
                            {exp.UserName && (
                              <>
                                <span>·</span>
                                <span>{exp.UserName}</span>
                              </>
                            )}
                            {exp.PaymentMethod && (
                              <>
                                <span>·</span>
                                <span>{exp.PaymentMethod}</span>
                              </>
                            )}
                          </div>
                          {exp.Notes && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[250px]">
                              {exp.Notes}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 mr-2">
                        <button
                          onClick={() => setEditingExpense(exp)}
                          className="p-1.5 hover:bg-accent rounded-lg transition-colors"
                          title="تعديل"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                        <button
                          onClick={() => handleDelete(exp.ID, exp.invID)}
                          className="p-1.5 hover:bg-red-100 rounded-lg transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500 hover:text-red-600" />
                        </button>
                        <span className="text-sm font-black text-destructive">
                          {exp.GrandTolal?.toLocaleString('ar-EG')} ج.م
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════ RIGHT PANEL: New Expense Form ═══════════ */}
      <aside className="w-full lg:w-[380px] border-r border-border flex flex-col shrink-0 bg-muted/5 order-2 lg:order-2 h-[45vh] lg:h-auto">
        <div className="p-3 border-b border-border bg-muted/20">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            تسجيل مصروف جديد
          </h2>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {/* ──── Quick Picks ──── */}
            {quickPicks.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  الأكثر استخداماً
                </h3>
                <div className="flex flex-wrap gap-1">
                  {quickPicks.map((cat) => {
                    const isSelected = selectedCatId === cat.ExpINID;
                    return (
                      <button
                        key={cat.ExpINID}
                        onClick={() => { setSelectedCatId(cat.ExpINID); setSaveError(''); }}
                        className={`
                        px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all
                        ${isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-muted/40 hover:bg-accent text-foreground'
                          }
                      `}
                      >
                        {cat.CatName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Separator />

            {/* ──── Category Selection (Grouped) ──── */}
            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-muted-foreground">فئة المصروف</h3>

              {/* Group tabs */}
              <div className="flex flex-wrap gap-1">
                {[{ key: 'all', label: 'الكل' }, ...CATEGORY_GROUPS].map((g) => {
                  const isActive = activeGroup === g.key;
                  return (
                    <button
                      key={g.key}
                      onClick={() => { setActiveGroup(g.key); setCatSearch(''); }}
                      className={`
                      px-2.5 py-1 rounded-md text-[11px] font-bold transition-all border
                      ${isActive
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                        }
                    `}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="بحث في الفئات..."
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  className="h-8 text-xs pr-8"
                />
              </div>

              {/* Filtered category buttons */}
              <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
                {filteredCategories.map((cat) => {
                  const isSelected = selectedCatId === cat.ExpINID;
                  return (
                    <button
                      key={cat.ExpINID}
                      onClick={() => { setSelectedCatId(cat.ExpINID); setSaveError(''); }}
                      className={`
                      flex items-center justify-center px-2 py-2 rounded-lg border transition-all text-xs font-bold leading-tight
                      ${isSelected
                          ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
                          : 'border-border hover:border-muted-foreground/30 hover:bg-accent text-foreground'
                        }
                    `}
                    >
                      {cat.CatName}
                    </button>
                  );
                })}
              </div>

              {categories.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">جاري تحميل الفئات...</p>
              )}
              {categories.length > 0 && filteredCategories.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">لا توجد فئات مطابقة</p>
              )}
            </div>

            <Separator />

            {/* Amount */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">المبلغ (ج.م)</h3>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="أدخل المبلغ"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setSaveError(''); }}
                className="text-lg font-bold text-center h-12"
                dir="ltr"
              />
            </div>

            <Separator />

            {/* Payment Method */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">طريقة الدفع</h3>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">
                {paymentMethods.map((m) => {
                  const isSelected = paymentMethodId === m.ID;
                  const icon = PAYMENT_ICONS[m.Name] || <Wallet className="w-4 h-4" />;
                  return (
                    <button
                      key={m.ID}
                      onClick={() => { setPaymentMethodId(m.ID); setSaveError(''); }}
                      className={`
                      flex-shrink-0 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-sm font-medium whitespace-nowrap
                      ${isSelected
                          ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
                          : 'border-border hover:border-muted-foreground/30 hover:bg-accent text-muted-foreground'
                        }
                    `}
                    >
                      {icon}
                      {m.Name}
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Notes */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">ملاحظات (اختياري)</h3>
              <Input
                placeholder="وصف المصروف..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-sm"
              />
            </div>

            {/* Error */}
            {saveError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2.5 font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {saveError}
              </div>
            )}

            {/* Success */}
            {saveSuccess && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 rounded-lg p-2.5 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {saveSuccess}
              </div>
            )}

            {/* Save Button */}
            <Button
              size="lg"
              className="w-full text-base font-bold py-6"
              onClick={handleSave}
              disabled={saving || !hasActiveShift}
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5 ml-2" />
                  حفظ المصروف
                </>
              )}
            </Button>

            {/* Reset */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => { resetForm(); setPaymentMethodId(null); }}
            >
              <RotateCcw className="w-4 h-4 ml-2" />
              مسح النموذج
            </Button>
          </div>
        </ScrollArea>
      </aside>

      {/* Edit Modal */}
      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          categories={categories}
          paymentMethods={paymentMethods}
          onClose={() => setEditingExpense(null)}
          onSaved={() => {
            setEditingExpense(null);
            loadExpenses();
          }}
        />
      )}

      {/* Receipt Popup */}
      <ExpenseReceiptPopup
        open={!!receiptExpense}
        expense={receiptExpense}
        onClose={() => setReceiptExpense(null)}
      />
    </div>
  );
}
