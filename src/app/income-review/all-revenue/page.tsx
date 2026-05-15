'use client';

import { useState, useEffect, useCallback } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
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
} from 'lucide-react';

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

  const [expandedCat, setExpandedCat] = useState<number | null>(null);
  const [deletingCat, setDeletingCat] = useState<{ ExpINID: number; name: string; count: number } | null>(null);
  const [deletingId, setDeletingId] = useState<{ ID: number; invID: number } | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

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
    setBusyDelete(true);
    try {
      const res = await fetch(`/api/incomes/${deletingId.ID}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'فشل الحذف');
      setDeletingId(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setBusyDelete(false);
    }
  };

  /* ── delete all in category ── */
  const handleDeleteCategory = async () => {
    if (!deletingCat) return;
    setBusyDelete(true);
    try {
      const catItems = items.filter((i) => i.ExpINID === deletingCat.ExpINID);
      for (const item of catItems) {
        const res = await fetch(`/api/incomes/${item.ID}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error || 'فشل حذف الإيرادات');
      }
      setDeletingCat(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader title="كل الإيرادات" description="مراجعة جميع الإيرادات حسب الفئة مع فلاتر متقدمة" />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">من تاريخ</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">إلى تاريخ</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
        <Button onClick={fetchData} disabled={loading} className="gap-2 bg-amber-600 hover:bg-amber-700 h-9">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4 text-rose-400 text-sm font-medium">
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

      {/* Category groups */}
      {!loading && categories.length === 0 && (
        <EmptyState
          title="لا توجد إيرادات"
          description="لا توجد إيرادات في الفترة المحددة"
          icon={<CalendarDays className="w-8 h-8 text-amber-500" />}
        />
      )}

      {loading && categories.length === 0 && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-zinc-800/40 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {categories.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">الإيرادات حسب الفئة</h2>
          {categories.map((cat) => {
            const isOpen = expandedCat === cat.ExpINID;
            return (
              <div key={cat.ExpINID} className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
                {/* Category header */}
                <div className={`p-4 transition-colors ${isOpen ? 'bg-zinc-800/60' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setExpandedCat(isOpen ? null : cat.ExpINID)}
                      className="flex items-center gap-3 flex-1 text-right hover:opacity-80 transition-opacity"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-5 w-5 text-zinc-400 shrink-0" />
                      ) : (
                        <ChevronLeft className="h-5 w-5 text-zinc-400 shrink-0" />
                      )}
                      <div>
                        <span className="font-medium text-white">{cat.CategoryName}</span>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {cat.Count} {cat.Count === 1 ? 'عملية' : 'عمليات'}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-lg font-bold text-emerald-400">{fmt(cat.TotalAmount)}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingCat({ ExpINID: cat.ExpINID, name: cat.CategoryName, count: cat.Count });
                        }}
                        className="gap-1.5 text-xs text-rose-400 border-rose-500/30 hover:text-rose-300 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        مسح الكل
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded transactions */}
                {isOpen && (
                  <div className="border-t border-zinc-800 bg-zinc-950/40">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-zinc-800 bg-zinc-900/60">
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">#</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">التاريخ</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">الوقت</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">المبلغ</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">طريقة الدفع</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">المستخدم</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">الملاحظات</th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">إجراء</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.items.map((item) => (
                            <tr key={item.ID} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition-colors">
                              <td className="py-2.5 px-3 text-xs text-zinc-500">{item.invID}</td>
                              <td className="py-2.5 px-3 text-xs text-zinc-300">{fmtDate(item.invDate)}</td>
                              <td className="py-2.5 px-3 text-xs text-zinc-500">{item.invTime || '—'}</td>
                              <td className="py-2.5 px-3 text-xs font-bold text-emerald-400">{fmt(item.Amount)}</td>
                              <td className="py-2.5 px-3 text-xs text-zinc-400">{item.PaymentMethod || '—'}</td>
                              <td className="py-2.5 px-3 text-xs text-zinc-400">{item.UserName || '—'}</td>
                              <td className="py-2.5 px-3 text-xs text-zinc-500 max-w-[200px] truncate">{item.Notes || '—'}</td>
                              <td className="py-2.5 px-3">
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => setDeletingId({ ID: item.ID, invID: item.invID })}
                                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                                  title="حذف"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
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
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-white mb-3">تأكيد الحذف</h3>
            <p className="text-sm text-zinc-400 mb-5">
              هل أنت متأكد من حذف الإيراد رقم <span className="font-bold text-white">#{deletingId.invID}</span>؟
              <br />
              <span className="text-rose-400">لا يمكن التراجع عن هذا الإجراء.</span>
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
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="h-6 w-6 text-rose-400" />
              <h3 className="text-lg font-semibold text-white">تحذير: حذف جماعي</h3>
            </div>
            <p className="text-sm text-zinc-400 mb-5">
              هل أنت متأكد من حذف <span className="font-bold text-rose-400">{deletingCat.count}</span> إيراد من فئة{' '}
              <span className="font-bold text-white">"{deletingCat.name}"</span>؟
              <br /><br />
              <span className="text-rose-400 font-semibold">⚠️ سيتم حذف جميع الإيرادات تحت هذه الفئة في الفترة المحددة!</span>
              <br />
              <span className="text-rose-400">لا يمكن التراجع عن هذا الإجراء.</span>
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
    </div>
  );
}
