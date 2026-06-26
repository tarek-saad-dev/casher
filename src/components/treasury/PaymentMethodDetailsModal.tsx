'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Loader2, ArrowUpRight, ArrowDownRight, Search,
  Filter, Receipt, AlertCircle, Trash2,
} from 'lucide-react';
import type { TreasuryMovement } from '@/lib/types/treasury';
import { getMovementTypeLabel, getMovementTypeSearchText } from '@/lib/treasury';
import DeleteInvoiceDialog, { type DeleteInvoiceTarget } from '@/components/sales/DeleteInvoiceDialog';

interface Props {
  paymentMethodKey: string; // 'unassigned' for NULL PaymentMethodID, else String(paymentMethodId)
  paymentMethodName: string;
  filters: {
    newDay: number | null;
    dateFrom: string | null;
    dateTo: string | null;
    shiftMoveId: number | null;
    userId: number | null;
  };
  onClose: () => void;
  canDelete?: boolean; // default true — set false for cashier view
}

type DirectionFilter = 'all' | 'in' | 'out';

export default function PaymentMethodDetailsModal({
  paymentMethodKey,
  paymentMethodName,
  filters,
  onClose,
  canDelete = true,
}: Props) {
  const [movements, setMovements] = useState<TreasuryMovement[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteInvoiceTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set('paymentMethodKey', paymentMethodKey);
      p.set('pageSize', '500');
      if (filters.newDay !== null)     p.set('newDay',       filters.newDay.toString());
      if (filters.dateFrom)            p.set('dateFrom',     filters.dateFrom);
      if (filters.dateTo)              p.set('dateTo',       filters.dateTo);
      if (filters.shiftMoveId !== null) p.set('shiftMoveId', filters.shiftMoveId.toString());
      if (filters.userId !== null)     p.set('userId',       filters.userId.toString());

      const res  = await fetch(`/api/treasury/movements?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحميل');
      setMovements(data.movements ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [paymentMethodKey, filters]);

  useEffect(() => { load(); }, [load]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    let list = movements;
    if (direction !== 'all') list = list.filter(m => m.inOut === direction);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(m =>
        (m.catName  ?? '').toLowerCase().includes(q) ||
        (m.notes    ?? '').toLowerCase().includes(q) ||
        getMovementTypeSearchText(m).includes(q) ||
        (m.userName ?? '').toLowerCase().includes(q) ||
        String(m.invId ?? '').includes(q)
      );
    }
    return list;
  }, [movements, direction, search]);

  const totalIn  = filtered.filter(m => m.inOut === 'in').reduce((s, m)  => s + m.amount, 0);
  const totalOut = filtered.filter(m => m.inOut === 'out').reduce((s, m) => s + m.amount, 0);
  const net      = totalIn - totalOut;

  const fmt = (n: number) =>
    new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('ar-EG'); } catch { return d; }
  };

  const handleDelete = (invId: number, invType: string) => {
    if (invType !== 'مبيعات') {
      alert('يمكن مسح فواتير المبيعات فقط من هنا');
      return;
    }
    setDeleteTarget({ invId });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      dir="rtl"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <Receipt className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                تفاصيل عمليات {paymentMethodName}
              </h2>
              {!loading && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  {movements.length} عملية إجمالية
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Summary strip ── */}
        {!loading && !error && (
          <div className="grid grid-cols-4 gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-950/40">
            <div className="text-center">
              <p className="text-[11px] text-zinc-500 mb-0.5">إجمالي الوارد</p>
              <p className="text-sm font-bold text-emerald-400">{fmt(totalIn)} ج.م</p>
            </div>
            <div className="text-center">
              <p className="text-[11px] text-zinc-500 mb-0.5">إجمالي الصادر</p>
              <p className="text-sm font-bold text-rose-400">{fmt(totalOut)} ج.م</p>
            </div>
            <div className="text-center">
              <p className="text-[11px] text-zinc-500 mb-0.5">الصافي</p>
              <p className={`text-sm font-bold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(net)} ج.م
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] text-zinc-500 mb-0.5">العمليات المعروضة</p>
              <p className="text-sm font-bold text-white">{filtered.length}</p>
            </div>
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="بحث بالتصنيف أو الوصف أو المستخدم أو رقم العملية..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pr-9 pl-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* Direction filter */}
          <div className="flex items-center gap-1 text-xs">
            <Filter className="h-3.5 w-3.5 text-zinc-500" />
            {(['all', 'in', 'out'] as DirectionFilter[]).map(d => (
              <button key={d}
                onClick={() => setDirection(d)}
                className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                  direction === d
                    ? d === 'in'  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                    : d === 'out' ? 'bg-rose-600/20 border-rose-500/40 text-rose-400'
                    :               'bg-zinc-700/60 border-zinc-600 text-zinc-300'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
                }`}
              >
                {d === 'all' ? 'الكل' : d === 'in' ? 'وارد' : 'صادر'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500/60" />
              <p className="text-sm">جاري تحميل التفاصيل...</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p className="text-sm text-rose-400">{error}</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-600">
              <Receipt className="h-10 w-10 opacity-30" />
              <p className="text-sm">
                {movements.length === 0
                  ? `لا توجد عمليات لطريقة الدفع "${paymentMethodName}" خلال الفترة المحددة`
                  : 'لا توجد نتائج مطابقة للفلتر'}
              </p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-800/60 border-b border-zinc-700/50 text-zinc-400">
                    <th className="px-3 py-2.5 text-right font-medium">#</th>
                    <th className="px-3 py-2.5 text-right font-medium">التاريخ</th>
                    <th className="px-3 py-2.5 text-right font-medium">الوقت</th>
                    <th className="px-3 py-2.5 text-right font-medium">النوع</th>
                    <th className="px-3 py-2.5 text-right font-medium">التصنيف</th>
                    <th className="px-3 py-2.5 text-right font-medium">الوصف</th>
                    <th className="px-3 py-2.5 text-right font-medium">المستخدم</th>
                    <th className="px-3 py-2.5 text-right font-medium text-emerald-400">وارد</th>
                    <th className="px-3 py-2.5 text-right font-medium text-rose-400">صادر</th>
                    <th className="px-3 py-2.5 text-right font-medium">صافي</th>
                    {canDelete && <th className="px-3 py-2.5 text-center font-medium">إجراء</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filtered.map((m) => {
                    const isIn     = m.inOut === 'in';
                    const rowNet   = isIn ? m.amount : -m.amount;
                    return (
                      <tr key={m.id}
                        className="hover:bg-zinc-800/30 transition-colors"
                      >
                        <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                          #{m.invId}
                        </td>
                        <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
                          {fmtDate(m.invDate)}
                        </td>
                        <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                          {m.invTime ?? '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            isIn
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                          }`}>
                            {isIn
                              ? <ArrowUpRight className="h-2.5 w-2.5" />
                              : <ArrowDownRight className="h-2.5 w-2.5" />
                            }
                            {getMovementTypeLabel(m)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-300 max-w-[120px] truncate">
                          {m.catName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 max-w-[160px] truncate">
                          {m.notes ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                          {m.userName ?? m.shiftName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {isIn
                            ? <span className="font-bold text-emerald-400">{fmt(m.amount)}</span>
                            : <span className="text-zinc-700">—</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {!isIn
                            ? <span className="font-bold text-rose-400">{fmt(m.amount)}</span>
                            : <span className="text-zinc-700">—</span>
                          }
                        </td>
                        <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${
                          rowNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {rowNet >= 0 ? '+' : ''}{fmt(rowNet)}
                        </td>
                        {canDelete && (
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            {m.invType === 'مبيعات' && m.invId != null && (
                              <button
                                onClick={() => handleDelete(m.invId!, m.invType ?? '')}
                                disabled={m.invId != null && deletingId === m.invId}
                                className="p-1.5 hover:bg-rose-500/20 rounded-lg transition-colors text-zinc-500 hover:text-rose-400 disabled:opacity-50"
                                title="مسح الفاتورة"
                              >
                                {deletingId === m.invId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>

                {/* Totals footer */}
                <tfoot>
                  <tr className="bg-zinc-800/60 border-t border-zinc-700/50 font-bold text-sm">
                    <td colSpan={7} className="px-3 py-2.5 text-zinc-400">الإجمالي</td>
                    <td className="px-3 py-2.5 text-right text-emerald-400">{fmt(totalIn)}</td>
                    <td className="px-3 py-2.5 text-right text-rose-400">{fmt(totalOut)}</td>
                    <td className={`px-3 py-2.5 text-right ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {net >= 0 ? '+' : ''}{fmt(net)}
                    </td>
                    {canDelete && <td className="px-3 py-2.5"></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      <DeleteInvoiceDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={async (invId) => {
          setDeleteTarget(null);
          setDeletingId(null);
          await load();
          console.log('Deleted invoice', invId);
        }}
      />
    </div>
  );
}
