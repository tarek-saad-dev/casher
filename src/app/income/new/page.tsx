'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Plus, Coins, Hash, TrendingUp, RefreshCw,
  Pencil, Trash2, Search, Filter, X, Loader2,
  CheckCircle, AlertTriangle, Info, ChevronDown,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Category   { ExpINID: number; CatName: string; ExpINType: string }
interface PayMethod  { PaymentID: number; PaymentMethod: string }
interface OpenShift  { ShiftMoveID: number; ShiftName: string; UserName: string; NewDay: string }

interface IncomeItem {
  ID: number; invID: number; invDate: string; invTime: string;
  ExpINID: number; CategoryName: string;
  Amount: number; Notes: string | null;
  PaymentMethodID: number; PaymentMethod: string;
  ShiftMoveID: number; ShiftName: string | null; UserName: string | null;
}

interface Summary {
  TotalIncome: number; IncomeCount: number; AverageIncome: number;
  FirstIncomeDate: string | null; LastIncomeDate: string | null;
}

interface Toast { id: number; type: 'success' | 'error' | 'info'; message: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const today = () => new Date().toISOString().split('T')[0];

// ─── Toast Component ─────────────────────────────────────────────────────────

function ToastList({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 w-80" dir="rtl">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium transition-all
            ${t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300' : ''}
            ${t.type === 'error'   ? 'bg-rose-950/90 border-rose-500/40 text-rose-300' : ''}
            ${t.type === 'info'    ? 'bg-zinc-900/90 border-zinc-700/40 text-zinc-300' : ''}
          `}
        >
          {t.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
          {t.type === 'error'   && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {t.type === 'info'    && <Info className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteModal({ item, onConfirm, onCancel, deleting }: {
  item: IncomeItem; onConfirm: () => void; onCancel: () => void; deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-rose-500/15">
            <Trash2 className="w-5 h-5 text-rose-400" />
          </div>
          <h3 className="text-base font-bold">تأكيد الحذف</h3>
        </div>
        <p className="text-sm text-zinc-400 mb-1">سيتم حذف الإيراد التالي نهائياً ولا يمكن التراجع:</p>
        <div className="my-3 p-3 rounded-lg bg-zinc-800/50 text-sm space-y-1">
          <p><span className="text-zinc-500">المبلغ:</span> <span className="font-bold text-white">{fmt(item.Amount)} ج.م</span></p>
          <p><span className="text-zinc-500">التصنيف:</span> {item.CategoryName}</p>
          <p><span className="text-zinc-500">التاريخ:</span> {item.invDate}</p>
          {item.Notes && <p><span className="text-zinc-500">البيان:</span> {item.Notes}</p>}
        </div>
        <div className="flex gap-2 justify-end mt-5" dir="ltr">
          <Button variant="outline" onClick={onCancel} disabled={deleting} className="border-zinc-700">إلغاء</Button>
          <Button onClick={onConfirm} disabled={deleting} className="bg-rose-600 hover:bg-rose-700 gap-2">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {deleting ? 'جاري الحذف...' : 'حذف'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewRevenuePage() {
  // Meta
  const [categories,     setCategories]     = useState<Category[]>([]);
  const [payMethods,     setPayMethods]      = useState<PayMethod[]>([]);
  const [openShift,      setOpenShift]       = useState<OpenShift | null>(null);
  const [metaLoaded,     setMetaLoaded]      = useState(false);

  // Data
  const [items,    setItems]    = useState<IncomeItem[]>([]);
  const [summary,  setSummary]  = useState<Summary | null>(null);
  const [loading,  setLoading]  = useState(false);

  // Filters
  const [fromDate,   setFromDate]   = useState(today());
  const [toDate,     setToDate]     = useState(today());
  const [filterCat,  setFilterCat]  = useState('');
  const [filterPm,   setFilterPm]   = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [showFilters,  setShowFilters]  = useState(false);

  // Form (add/edit)
  const [editingId,    setEditingId]    = useState<number | null>(null);
  const [formDate,     setFormDate]     = useState(today());
  const [formAmount,   setFormAmount]   = useState('');
  const [formCat,      setFormCat]      = useState('');
  const [formPm,       setFormPm]       = useState('');
  const [formNotes,    setFormNotes]    = useState('');
  const [saving,       setSaving]       = useState(false);
  const [formError,    setFormError]    = useState('');

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<IncomeItem | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // Toasts
  const [toasts,   setToasts]   = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts(p => p.filter(t => t.id !== id)), []);

  // Load meta once
  useEffect(() => {
    fetch('/api/incomes/meta')
      .then(r => r.json())
      .then(d => {
        setCategories(d.categories ?? []);
        setPayMethods(d.paymentMethods ?? []);
        setOpenShift(d.openShift ?? null);
        setMetaLoaded(true);
      })
      .catch(() => setMetaLoaded(true));
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (filterCat)    params.set('expInId',         filterCat);
      if (filterPm)     params.set('paymentMethodId', filterPm);
      if (filterSearch) params.set('search',          filterSearch);
      const res  = await fetch(`/api/incomes?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItems(data.items   ?? []);
      setSummary(data.summary ?? null);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, filterCat, filterPm, filterSearch, addToast]);

  useEffect(() => { if (metaLoaded) loadData(); }, [metaLoaded, loadData]);

  // Reset form
  const resetForm = () => {
    setEditingId(null);
    setFormDate(today());
    setFormAmount('');
    setFormCat('');
    setFormPm('');
    setFormNotes('');
    setFormError('');
  };

  // Fill form for edit
  const startEdit = (item: IncomeItem) => {
    setEditingId(item.ID);
    setFormDate(item.invDate?.split('T')[0] ?? today());
    setFormAmount(String(item.Amount));
    setFormCat(String(item.ExpINID));
    setFormPm(String(item.PaymentMethodID));
    setFormNotes(item.Notes ?? '');
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Save (add or edit)
  const handleSave = async () => {
    setFormError('');
    if (!formDate)              return setFormError('التاريخ مطلوب');
    if (!formAmount || Number(formAmount) <= 0) return setFormError('القيمة يجب أن تكون أكبر من صفر');
    if (!formCat)               return setFormError('يجب اختيار التصنيف');
    if (!formPm)                return setFormError('يجب اختيار طريقة الدفع');

    setSaving(true);
    try {
      const payload = {
        invDate:         formDate,
        amount:          Number(formAmount),
        expInId:         Number(formCat),
        paymentMethodId: Number(formPm),
        notes:           formNotes.trim() || null,
        shiftMoveId:     openShift?.ShiftMoveID ?? null,
      };

      const url    = editingId ? `/api/incomes/${editingId}` : '/api/incomes';
      const method = editingId ? 'PATCH' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data   = await res.json();
      if (!res.ok) throw new Error(data.error);

      addToast('success', editingId ? 'تم تعديل الإيراد بنجاح' : 'تم حفظ الإيراد بنجاح');
      resetForm();
      await loadData();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'خطأ في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res  = await fetch(`/api/incomes/${deleteTarget.ID}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addToast('success', 'تم حذف الإيراد بنجاح');
      setDeleteTarget(null);
      await loadData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'خطأ في الحذف');
    } finally {
      setDeleting(false);
    }
  };

  const clearFilters = () => {
    setFilterCat('');
    setFilterPm('');
    setFilterSearch('');
  };

  const hasActiveFilters = filterCat || filterPm || filterSearch;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <ToastList toasts={toasts} dismiss={dismissToast} />
      {deleteTarget && (
        <DeleteModal
          item={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      <PageHeader
        title="إدارة الإيرادات"
        description="إضافة وتعديل وعرض الإيرادات غير المرتبطة بفواتير البيع"
      />

      {/* Open Shift Warning */}
      {metaLoaded && !openShift && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          لا توجد وردية مفتوحة — لن تتمكن من تسجيل إيراد جديد حتى يتم فتح وردية.
        </div>
      )}
      {openShift && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-xs">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>الوردية المفتوحة: <strong>{openShift.ShiftName}</strong> — {openShift.UserName} — يوم {openShift.NewDay}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          title="إجمالي الإيرادات"
          value={summary ? `${fmt(summary.TotalIncome)} ج.م` : '—'}
          icon={<Coins className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="عدد العمليات"
          value={summary?.IncomeCount ?? '—'}
          icon={<Hash className="w-5 h-5" />}
        />
        <KpiCard
          title="متوسط القيمة"
          value={summary ? `${fmt(summary.AverageIncome)} ج.م` : '—'}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
        />
        <KpiCard
          title="آخر تحديث"
          value={new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
          icon={<RefreshCw className="w-5 h-5" />}
        />
      </div>

      {/* ── Form ── */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5 mb-6">
        <h2 className="text-sm font-bold text-zinc-300 mb-4 flex items-center gap-2">
          {editingId ? <Pencil className="w-4 h-4 text-amber-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
          {editingId ? `تعديل إيراد #${editingId}` : 'إضافة إيراد جديد'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="form-date" className="text-xs text-zinc-400">التاريخ *</Label>
            <Input id="form-date" type="date" value={formDate}
              onChange={e => setFormDate(e.target.value)}
              className="bg-zinc-950 border-zinc-700 text-white" dir="ltr" />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="form-amount" className="text-xs text-zinc-400">القيمة (ج.م) *</Label>
            <Input id="form-amount" type="number" min="0.01" step="0.01"
              placeholder="0.00" value={formAmount}
              onChange={e => setFormAmount(e.target.value)}
              className="bg-zinc-950 border-zinc-700 text-white" dir="ltr" />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="form-cat" className="text-xs text-zinc-400">التصنيف *</Label>
            <div className="relative">
              <select id="form-cat" value={formCat}
                onChange={e => setFormCat(e.target.value)}
                className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-950 text-white px-3 text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                <option value="">— اختر التصنيف —</option>
                {categories.map(c => (
                  <option key={c.ExpINID} value={c.ExpINID}>{c.CatName}</option>
                ))}
              </select>
              <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-1.5">
            <Label htmlFor="form-pm" className="text-xs text-zinc-400">طريقة الدفع *</Label>
            <div className="relative">
              <select id="form-pm" value={formPm}
                onChange={e => setFormPm(e.target.value)}
                className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-950 text-white px-3 text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                <option value="">— اختر طريقة الدفع —</option>
                {payMethods.map(p => (
                  <option key={p.PaymentID} value={p.PaymentID}>{p.PaymentMethod}</option>
                ))}
              </select>
              <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="form-notes" className="text-xs text-zinc-400">البيان / الملاحظات</Label>
            <Input id="form-notes" type="text" placeholder="وصف الإيراد..."
              value={formNotes} onChange={e => setFormNotes(e.target.value)}
              className="bg-zinc-950 border-zinc-700 text-white" />
          </div>
        </div>

        {formError && (
          <div className="mt-3 flex items-center gap-2 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {formError}
          </div>
        )}

        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-zinc-800/60" dir="ltr">
          {editingId && (
            <Button variant="outline" onClick={resetForm} className="border-zinc-700 text-zinc-400">
              <X className="w-4 h-4 ml-1" /> إلغاء التعديل
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || (!openShift && !editingId)}
            className={`gap-2 ${editingId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</>
              : editingId
                ? <><Pencil className="w-4 h-4" /> حفظ التعديل</>
                : <><Plus className="w-4 h-4" /> حفظ الإيراد</>
            }
          </Button>
        </div>
      </div>

      {/* ── Filters + Table ── */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800/60">
          <h2 className="text-sm font-bold text-zinc-300">سجل الإيرادات</h2>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded border border-rose-500/20 hover:border-rose-500/40 transition-colors">
                <X className="w-3 h-3" /> مسح الفلاتر
              </button>
            )}
            <button onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors
                ${showFilters ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>
              <Filter className="w-3.5 h-3.5" />
              فلترة
              {hasActiveFilters && <span className="bg-amber-500 text-black rounded-full px-1.5 py-0 text-[10px] font-bold">!</span>}
            </button>
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-600 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="px-5 py-4 border-b border-zinc-800/40 bg-zinc-950/30">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-500">من تاريخ</label>
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  className="h-8 text-xs bg-zinc-950 border-zinc-700" dir="ltr" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-500">إلى تاريخ</label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  className="h-8 text-xs bg-zinc-950 border-zinc-700" dir="ltr" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-500">التصنيف</label>
                <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-700 bg-zinc-950 text-white px-2 text-xs appearance-none focus:outline-none">
                  <option value="">الكل</option>
                  {categories.map(c => <option key={c.ExpINID} value={c.ExpINID}>{c.CatName}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-500">طريقة الدفع</label>
                <select value={filterPm} onChange={e => setFilterPm(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-700 bg-zinc-950 text-white px-2 text-xs appearance-none focus:outline-none">
                  <option value="">الكل</option>
                  {payMethods.map(p => <option key={p.PaymentID} value={p.PaymentID}>{p.PaymentMethod}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-500">بحث في البيان</label>
                <div className="relative">
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
                  <Input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
                    placeholder="بحث..." className="h-8 text-xs bg-zinc-950 border-zinc-700 pr-7" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">جاري التحميل...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
              <Coins className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">لا توجد إيرادات في الفترة المحددة</p>
            </div>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-zinc-800/60 text-xs text-zinc-500">
                  <th className="px-4 py-3 text-right font-medium">#</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-right font-medium">التصنيف</th>
                  <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                  <th className="px-4 py-3 text-right font-medium">طريقة الدفع</th>
                  <th className="px-4 py-3 text-right font-medium">البيان</th>
                  <th className="px-4 py-3 text-right font-medium">الوردية</th>
                  <th className="px-4 py-3 text-center font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.ID}
                    className={`border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors
                      ${editingId === item.ID ? 'bg-amber-500/5 border-r-2 border-r-amber-500/50' : ''}`}>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3 text-zinc-300 whitespace-nowrap text-xs">{item.invDate?.split('T')[0]}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {item.CategoryName}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-emerald-400 whitespace-nowrap">{fmt(item.Amount)} <span className="text-[11px] font-normal text-zinc-500">ج.م</span></td>
                    <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">{item.PaymentMethod}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs max-w-[160px] truncate">{item.Notes ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">{item.UserName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => startEdit(item)}
                          className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-amber-500/40 hover:text-amber-400 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget(item)}
                          className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-rose-500/40 hover:text-rose-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals row */}
              {summary && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                    <td colSpan={3} className="px-4 py-3 text-xs font-bold text-zinc-400">
                      الإجمالي ({summary.IncomeCount} عملية)
                    </td>
                    <td className="px-4 py-3 font-bold text-emerald-400 text-base whitespace-nowrap">
                      {fmt(summary.TotalIncome)} <span className="text-xs font-normal text-zinc-500">ج.م</span>
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
