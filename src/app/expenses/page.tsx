'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Save, Loader2, AlertTriangle, CheckCircle2,
  Banknote, CreditCard, Wallet, Receipt,
  TrendingDown, Filter, RotateCcw, Search, Zap, Edit2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ShiftRequiredOverlay from '@/components/session/ShiftRequiredOverlay';
import EditExpenseModal from '@/components/expenses/EditExpenseModal';
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

// Build a fast lookup: trimmed CatName → group key
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

  // ──── History state ────
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [filterToday, setFilterToday] = useState(true);
  const [filterCatId, setFilterCatId] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  
  // ──── Edit state ────
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);

  // ──── Set page title ────
  useEffect(() => {
    document.title = 'المصروفات | نظام نقاط البيع';
  }, []);

  // ──── Load lookup data on mount ────
  useEffect(() => {
    fetch('/api/expenses/categories')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCategories(d); })
      .catch(() => {});
    fetch('/api/payment-methods')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPaymentMethods(d); })
      .catch(() => {});
  }, []);

  // ──── Quick date helpers ────
  const setQuickDate = useCallback((type: 'yesterday' | 'last7' | 'last30' | 'thisMonth') => {
    const today = new Date();
    let from = new Date();
    let to = new Date();

    switch (type) {
      case 'yesterday':
        from.setDate(today.getDate() - 1);
        to = new Date(from);
        break;
      case 'last7':
        from.setDate(today.getDate() - 7);
        break;
      case 'last30':
        from.setDate(today.getDate() - 30);
        break;
      case 'thisMonth':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
    }

    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
    setFilterToday(false);
    setFilterDate('');
  }, []);

  // ──── Load expenses history ────
  const loadExpenses = useCallback(() => {
    setLoadingHistory(true);
    const params = new URLSearchParams();
    
    if (filterToday) {
      params.set('today', '1');
    } else if (filterDate) {
      // Filter by specific date
      params.set('dateFrom', filterDate);
      params.set('dateTo', filterDate);
    } else if (dateFrom || dateTo) {
      // Filter by date range
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
    }
    
    if (filterCatId) params.set('catId', filterCatId);

    fetch(`/api/expenses?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setExpenses(d); })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [filterToday, filterCatId, filterDate, dateFrom, dateTo]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  // ──── Summary calculations ────
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.GrandTolal || 0), 0);
  const totalCash = expenses.filter(e => e.PaymentMethod === 'كاش').reduce((sum, e) => sum + (e.GrandTolal || 0), 0);
  const totalVisa = expenses.filter(e => e.PaymentMethod === 'فيزا').reduce((sum, e) => sum + (e.GrandTolal || 0), 0);

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
  }, [selectedCatId, amount, paymentMethodId, notes, resetForm, loadExpenses]);

  // ──── Filtered categories by group + search ────
  const filteredCategories = useMemo(() => {
    let filtered = categories;

    if (activeGroup !== 'all') {
      filtered = filtered.filter(c => {
        const groupKey = GROUP_LOOKUP.get(c.CatName.trim());
        return groupKey === activeGroup;
      });
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
    <div className="flex h-screen overflow-hidden relative" dir="rtl">
      <ShiftRequiredOverlay />

      {/* ═══════════ LEFT PANEL: History + Summary ═══════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {/* Summary Cards */}
        <div className="p-3 border-b border-border bg-gradient-to-br from-muted/30 to-muted/10">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <TrendingDown className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">إجمالي</span>
              </div>
              <p className="text-lg font-black">{totalExpenses.toLocaleString('ar-EG')} ج.م</p>
              <p className="text-[10px] text-muted-foreground">{expenses.length} عملية</p>
            </div>
            <div className="rounded-lg border border-border p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <Banknote className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">كاش</span>
              </div>
              <p className="text-lg font-bold">{totalCash.toLocaleString('ar-EG')} ج.م</p>
            </div>
            <div className="rounded-lg border border-border p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <CreditCard className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">فيزا</span>
              </div>
              <p className="text-lg font-bold">{totalVisa.toLocaleString('ar-EG')} ج.م</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-3 py-2 border-b border-border bg-muted/5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <button
              onClick={() => {
                setFilterToday(true);
                setFilterDate('');
                setDateFrom('');
                setDateTo('');
              }}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-all font-medium ${
                filterToday ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              اليوم
            </button>
            <button
              onClick={() => setQuickDate('yesterday')}
              className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent transition-all font-medium"
            >
              أمس
            </button>
            <button
              onClick={() => setQuickDate('last7')}
              className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent transition-all font-medium"
            >
              آخر 7 أيام
            </button>
            <button
              onClick={() => setQuickDate('last30')}
              className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent transition-all font-medium"
            >
              آخر 30 يوم
            </button>
            <button
              onClick={() => setQuickDate('thisMonth')}
              className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent transition-all font-medium"
            >
              هذا الشهر
            </button>
            <button
              onClick={() => {
                setFilterToday(false);
                setFilterDate('');
                setDateFrom('');
                setDateTo('');
              }}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-all font-medium ${
                !filterToday && !filterDate && !dateFrom && !dateTo ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              الكل
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={filterDate}
              onChange={(e) => {
                setFilterDate(e.target.value);
                setFilterToday(false);
                setDateFrom('');
                setDateTo('');
              }}
              placeholder="يوم محدد"
              className="text-[11px] px-2 py-1 rounded-md border border-border bg-background text-foreground"
            />
            <select
              value={filterCatId}
              onChange={(e) => setFilterCatId(e.target.value)}
              className="text-[11px] px-2 py-1 rounded-md border border-border bg-background text-foreground"
            >
              <option value="">كل الفئات</option>
              {categories.map(c => (
                <option key={c.ExpINID} value={c.ExpINID}>{c.CatName}</option>
              ))}
            </select>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={loadExpenses} className="text-[11px] h-6 px-2">
              <RotateCcw className="w-3 h-3 ml-1" />
              تحديث
            </Button>
          </div>
        </div>

        {/* Expenses List */}
        <ScrollArea className="flex-1">
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
                <p className="text-sm font-medium">لا توجد مصروفات</p>
                <p className="text-xs mt-1">سجّل مصروف جديد من النموذج على اليسار</p>
              </div>
            )}

            {!loadingHistory && expenses.length > 0 && (
              <div className="space-y-2">
                {expenses.map((exp) => (
                  <div
                    key={exp.ID}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-destructive/10 text-destructive shrink-0">
                        <TrendingDown className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-sm font-bold truncate">{exp.CatName}</span>
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            #{exp.invID}
                          </Badge>
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
                      <span className="text-sm font-black text-destructive">
                        {exp.GrandTolal?.toLocaleString('ar-EG')} ج.م
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ═══════════ RIGHT PANEL: New Expense Form ═══════════ */}
      <aside className="w-[380px] border-r border-border flex flex-col shrink-0 bg-muted/5">
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
    </div>
  );
}
