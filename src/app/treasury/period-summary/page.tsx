'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, RefreshCw, Download, TrendingUp, TrendingDown,
  Wallet, Activity, CalendarDays, Users, ChevronUp, ChevronDown,
  ArrowRightLeft, List,
} from 'lucide-react';
import PastDateIncomeModal  from '@/components/treasury/PastDateIncomeModal';
import PastDateExpenseModal from '@/components/treasury/PastDateExpenseModal';
import PastDateTransferModal from '@/components/treasury/PastDateTransferModal';
import PaymentMethodDetailsModal from '@/components/treasury/PaymentMethodDetailsModal';
import type {
  TreasuryPeriodSummaryResponse,
  PeriodDayRow,
  PeriodPaymentMethod,
} from '@/lib/types/treasury';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  const v = isNaN(n) || !isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v) + ' ج.م';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'short', day: 'numeric', weekday: 'short',
    });
  } catch {
    return iso;
  }
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function monthStartISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

function getCell(v: number): { text: string; cls: string } {
  const safe = isNaN(v) || !isFinite(v) ? 0 : v;
  return {
    text: fmt(safe),
    cls: safe > 0 ? 'text-emerald-400' : safe < 0 ? 'text-rose-400' : 'text-zinc-400',
  };
}

function statusBadge(status: PeriodDayRow['status']) {
  if (status === 'open')
    return <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">مفتوح</span>;
  if (status === 'closed')
    return <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-zinc-700/60 text-zinc-400 border border-zinc-600/30">مقفول</span>;
  return <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-zinc-800/60 text-zinc-600 border border-zinc-700/20">—</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  isCount?: boolean;
}

function KpiCard({ label, value, icon, colorClass, bgClass, borderClass, isCount }: KpiCardProps) {
  return (
    <div className={`rounded-xl border p-4 ${bgClass} ${borderClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-lg ${bgClass}`}>{icon}</div>
        <p className="text-xs text-zinc-400">{label}</p>
      </div>
      <p className={`text-lg font-bold ${colorClass}`}>
        {isCount ? value : (typeof value === 'number' ? fmt(value) : value)}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

type SortKey = 'date' | 'totalIncome' | 'totalExpense' | 'netTotal' | 'transactionsCount' | string;

export default function TreasuryPeriodSummaryPage() {
  const [data, setData]       = useState<TreasuryPeriodSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [dateFrom, setDateFrom]   = useState(monthStartISO());
  const [dateTo, setDateTo]       = useState(todayISO());
  const [userId, setUserId]       = useState<string>('all');

  const [sortKey, setSortKey]     = useState<SortKey>('date');
  const [sortAsc, setSortAsc]     = useState(true);

  const tableRef = useRef<HTMLDivElement>(null);

  // ── Action modals state ───────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState<'income' | 'expense' | 'transfer' | null>(null);
  const [modalDate, setModalDate]     = useState<string | undefined>(undefined);
  const [detailsModal, setDetailsModal] = useState<{
    paymentMethodKey: string;
    paymentMethodName: string;
    date: string;
  } | null>(null);

  const openModal = (mode: 'income' | 'expense' | 'transfer', date: string) => {
    setModalDate(date);
    setActiveModal(mode);
  };
  const closeModal = () => { setActiveModal(null); setModalDate(undefined); };
  const onActionSuccess = () => { closeModal(); load(dateFrom, dateTo, userId); };

  useEffect(() => {
    document.title = 'ملخص الخزنة الدوري | نظام نقاط البيع';
  }, []);

  const load = useCallback(async (from: string, to: string, uid: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to });
      if (uid !== 'all') params.append('userId', uid);
      const res = await fetch(`/api/treasury/period-summary?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل التحميل');
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => { load(dateFrom, dateTo, userId); }, []); // eslint-disable-line

  const handleRefresh = () => load(dateFrom, dateTo, userId);

  // ── Sorting ───────────────────────────────────────────────────────────────

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(p => !p);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortedDays = data
    ? [...data.days].sort((a, b) => {
        let av: number | string = 0;
        let bv: number | string = 0;
        if (sortKey === 'date') { av = a.date; bv = b.date; }
        else if (sortKey === 'totalIncome') { av = a.totalIncome; bv = b.totalIncome; }
        else if (sortKey === 'totalExpense') { av = a.totalExpense; bv = b.totalExpense; }
        else if (sortKey === 'netTotal') { av = a.netTotal; bv = b.netTotal; }
        else if (sortKey === 'transactionsCount') { av = a.transactionsCount; bv = b.transactionsCount; }
        else { av = a.paymentTotals[sortKey] ?? 0; bv = b.paymentTotals[sortKey] ?? 0; }
        if (av < bv) return sortAsc ? -1 : 1;
        if (av > bv) return sortAsc ? 1 : -1;
        return 0;
      })
    : [];

  // ── CSV Export ────────────────────────────────────────────────────────────

  const exportCSV = () => {
    if (!data) return;
    const pms: PeriodPaymentMethod[] = data.paymentMethods;
    const headers = [
      'التاريخ', 'الحالة',
      'إجمالي الإيرادات', 'إجمالي المصروفات', 'صافي اليوم',
      ...pms.map(p => p.name),
      'عدد الحركات',
      'تراكمي الشهر - الإيرادات', 'تراكمي الشهر - المصروفات', 'تراكمي الشهر - الصافي',
      ...pms.map(p => `تراكمي - ${p.name}`),
    ];
    const rows = sortedDays.map(d => [
      d.date,
      d.status === 'open' ? 'مفتوح' : d.status === 'closed' ? 'مقفول' : '—',
      d.totalIncome,
      d.totalExpense,
      d.netTotal,
      ...pms.map(p => d.paymentTotals[String(p.id)] ?? 0),
      d.transactionsCount,
      d.monthToDateIncome   ?? 0,
      d.monthToDateExpense  ?? 0,
      d.monthToDateNetTotal ?? 0,
      ...pms.map(p => d.monthToDatePaymentTotals?.[String(p.id)] ?? 0),
    ]);

    const csvContent = [headers, ...rows]
      .map(r => r.map(c => `"${c}"`).join(','))
      .join('\n');

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `treasury-summary-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Th helper ─────────────────────────────────────────────────────────────

  const Th = ({
    label, sKey, sticky = false, colorClass = 'text-zinc-300',
  }: { label: string; sKey: SortKey; sticky?: boolean; colorClass?: string }) => (
    <th
      onClick={() => toggleSort(sKey)}
      className={`px-3 py-3 text-right text-xs font-semibold whitespace-nowrap cursor-pointer select-none
        hover:bg-zinc-800/60 transition-colors
        ${sticky ? 'sticky bg-zinc-900 z-10' : ''}
        ${colorClass}`}
      style={sticky ? (sKey === 'date' ? { right: 0 } : { left: 0 }) : undefined}
    >
      <span className="flex items-center gap-1 justify-end">
        {label}
        {sortKey === sKey
          ? (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <span className="h-3 w-3 opacity-0"><ChevronUp className="h-3 w-3" /></span>}
      </span>
    </th>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 p-4 sm:p-6" dir="rtl">
      <div className="max-w-[1600px] mx-auto space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">ملخص الخزنة الدوري</h1>
            <p className="text-zinc-400 text-sm mt-1">جدول تجميعي لحركات الخزنة يومياً خلال الفترة المحددة</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-zinc-800/60 text-zinc-300 border border-zinc-700/40 rounded-xl text-sm hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <button
              onClick={exportCSV}
              disabled={!data || loading}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-sm hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              تصدير CSV
            </button>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-2xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            {/* dateFrom */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">من تاريخ</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700/50 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            {/* dateTo */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">إلى تاريخ</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700/50 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            {/* User */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">المستخدم</label>
              <select
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700/50 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
              >
                <option value="all">كل المستخدمين</option>
                {data?.users.map(u => (
                  <option key={u.userId} value={String(u.userId)}>{u.userName}</option>
                ))}
              </select>
            </div>
            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-xl text-sm font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                عرض
              </button>
            </div>
          </div>
        </div>

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-rose-950/20 border border-rose-500/20 rounded-2xl p-4">
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        )}

        {/* ── Loading skeleton ─────────────────────────────────────────────── */}
        {loading && !data && (
          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-2xl p-12 flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-500/50" />
            <p className="text-zinc-400 text-sm">جاري تحميل بيانات الخزنة...</p>
          </div>
        )}

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {data && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                label="إجمالي الإيرادات"
                value={data.summary.totalIncome}
                icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
                colorClass="text-emerald-400"
                bgClass="bg-emerald-500/5"
                borderClass="border-emerald-500/15"
              />
              <KpiCard
                label="إجمالي المصروفات"
                value={data.summary.totalExpense}
                icon={<TrendingDown className="h-4 w-4 text-rose-400" />}
                colorClass="text-rose-400"
                bgClass="bg-rose-500/5"
                borderClass="border-rose-500/15"
              />
              <KpiCard
                label="صافي الفترة"
                value={data.summary.netTotal}
                icon={<Wallet className={`h-4 w-4 ${data.summary.netTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />}
                colorClass={data.summary.netTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                bgClass={data.summary.netTotal >= 0 ? 'bg-emerald-500/5' : 'bg-rose-500/5'}
                borderClass={data.summary.netTotal >= 0 ? 'border-emerald-500/15' : 'border-rose-500/15'}
              />
              {data.paymentMethods.slice(0, 2).map(pm => (
                <KpiCard
                  key={pm.id}
                  label={pm.name}
                  value={data.summary.totalByPaymentMethod[String(pm.id)] ?? 0}
                  icon={<Wallet className="h-4 w-4 text-amber-400" />}
                  colorClass="text-amber-400"
                  bgClass="bg-amber-500/5"
                  borderClass="border-amber-500/15"
                />
              ))}
              <KpiCard
                label="عدد الحركات"
                value={data.summary.transactionsCount}
                icon={<Activity className="h-4 w-4 text-zinc-400" />}
                colorClass="text-white"
                bgClass="bg-zinc-800/40"
                borderClass="border-zinc-700/30"
                isCount
              />
            </div>

            {/* ── Table ──────────────────────────────────────────────────── */}
            <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-2xl overflow-hidden">
              {/* table header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-white">
                    تفاصيل الأيام
                  </span>
                  <span className="px-2 py-0.5 text-[10px] bg-zinc-800/60 text-zinc-400 rounded-full border border-zinc-700/30">
                    {data.days.length} يوم
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <Users className="h-3.5 w-3.5" />
                  {data.summary.transactionsCount} حركة
                </div>
              </div>

              {data.days.length === 0 ? (
                <div className="p-12 flex flex-col items-center gap-3">
                  <CalendarDays className="h-10 w-10 text-zinc-700" />
                  <p className="text-zinc-500 text-sm">لا توجد بيانات للفترة المحددة</p>
                </div>
              ) : (
                <div ref={tableRef} className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-zinc-800/30 border-b border-zinc-800/60">
                        {/* Sticky: Date */}
                        <Th label="التاريخ"            sKey="date"              sticky colorClass="text-zinc-200" />
                        <Th label="الحالة"             sKey="status"            colorClass="text-zinc-300" />
                        <Th label="إجمالي الإيرادات"  sKey="totalIncome"       colorClass="text-emerald-400" />
                        <Th label="إجمالي المصروفات"  sKey="totalExpense"      colorClass="text-rose-400" />
                        {/* Sticky: Net */}
                        <Th label="صافي اليوم"        sKey="netTotal"          sticky colorClass="text-sky-400" />
                        {/* Dynamic PM columns */}
                        {data.paymentMethods.map(pm => (
                          <Th key={pm.id} label={pm.name} sKey={String(pm.id)} colorClass="text-amber-400" />
                        ))}
                        <Th label="عدد الحركات"       sKey="transactionsCount" colorClass="text-zinc-300" />
                        {/* Sticky actions column */}
                        <th className="px-3 py-3 text-right text-xs font-semibold text-zinc-400 whitespace-nowrap sticky left-0 bg-zinc-900 z-10 border-r border-zinc-800/40">
                          إجراءات
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDays.map((day, idx) => {
                        const net    = getCell(day.netTotal);
                        const mtdNet = getCell(day.monthToDateNetTotal ?? 0);
                        const isEven   = idx % 2 === 0;
                        // Each day pair (main row + MTD sub-row) shares the same stripe
                        const rowBg    = isEven ? 'bg-zinc-900/50' : 'bg-zinc-800/30';
                        const mtdBg    = rowBg;
                        const stickyBg = isEven ? 'bg-zinc-900'    : 'bg-[#1f1f27]';
                        return (
                          <React.Fragment key={day.date}>
                            {/* ── Main day row ── */}
                            <tr
                              className={`border-b border-zinc-800/20 hover:bg-zinc-800/25 transition-colors ${rowBg}`}
                            >
                              {/* Date — sticky right */}
                              <td
                                className={`px-3 py-2.5 text-right whitespace-nowrap sticky z-10 border-l border-zinc-800/30 ${stickyBg}`}
                                style={{ right: 0 }}
                              >
                                <span className="text-sm font-semibold text-zinc-200">{fmtDate(day.date)}</span>
                              </td>
                              {/* Status */}
                              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                {statusBadge(day.status)}
                              </td>
                              {/* Income */}
                              <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums text-base text-emerald-400 font-semibold">
                                {fmt(day.totalIncome)}
                              </td>
                              {/* Expense */}
                              <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums text-base text-rose-400 font-semibold">
                                {fmt(day.totalExpense)}
                              </td>
                              {/* Net — sticky left */}
                              <td
                                className={`px-4 py-3.5 text-right whitespace-nowrap tabular-nums text-base font-bold sticky z-10 border-r border-zinc-800/30 ${stickyBg} ${net.cls}`}
                                style={{ left: 0 }}
                              >
                                {net.text}
                              </td>
                              {/* Dynamic PM columns */}
                              {data.paymentMethods.map(pm => {
                                const v = day.paymentTotals[String(pm.id)] ?? 0;
                                const c = getCell(v);
                                return (
                                  <td key={pm.id} className="px-3 py-2.5 text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <span className={`tabular-nums text-base ${c.cls}`}>
                                        {v === 0 ? <span className="text-zinc-700">—</span> : c.text}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => setDetailsModal({
                                          paymentMethodKey: String(pm.id),
                                          paymentMethodName: pm.name,
                                          date: day.date,
                                        })}
                                        title={`تفاصيل ${pm.name} — ${fmtDate(day.date)}`}
                                        className="shrink-0 p-1 rounded-md border border-zinc-600/40 bg-zinc-700/30 hover:bg-zinc-700/60 text-zinc-400 hover:text-white transition-colors"
                                      >
                                        <List className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                );
                              })}
                              {/* TX count */}
                              <td className="px-4 py-3.5 text-right text-zinc-300 tabular-nums text-base">
                                {day.transactionsCount}
                              </td>
                              {/* Actions — sticky left */}
                              <td
                                className={`px-2 py-2 text-right whitespace-nowrap sticky left-0 z-10 border-r border-zinc-800/30 ${stickyBg}`}
                              >
                                <div className="flex items-center gap-1 justify-end">
                                  {/* Income */}
                                  <button
                                    onClick={() => openModal('income', day.date)}
                                    title={`إضافة إيراد ليوم ${day.date}`}
                                    className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                                  >
                                    <TrendingUp className="h-3.5 w-3.5" />
                                  </button>
                                  {/* Expense */}
                                  <button
                                    onClick={() => openModal('expense', day.date)}
                                    title={`إضافة مصروف ليوم ${day.date}`}
                                    className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/25 transition-colors"
                                  >
                                    <TrendingDown className="h-3.5 w-3.5" />
                                  </button>
                                  {/* Transfer */}
                                  <button
                                    onClick={() => openModal('transfer', day.date)}
                                    title={`تحويل ليوم ${day.date}`}
                                    className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/25 transition-colors"
                                  >
                                    <ArrowRightLeft className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* ── MTD sub-row ── */}
                            <tr
                              key={`${day.date}-mtd`}
                              className={`border-b-2 border-zinc-600/60 hover:brightness-110 transition-colors ${mtdBg}`}
                            >
                              {/* Date label — sticky right */}
                              <td
                                className={`px-3 py-1.5 text-right whitespace-nowrap sticky z-10 border-l border-zinc-800/20 ${mtdBg}`}
                                style={{ right: 0 }}
                              >
                                <span className="text-xs text-zinc-500 font-normal">
                                  ↩ تراكمي الشهر حتى {fmtDate(day.date)}
                                </span>
                              </td>
                              {/* Status — empty */}
                              <td className="px-3 py-1.5" />
                              {/* MTD Income */}
                              <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums text-sm text-emerald-400/60">
                                {fmt(day.monthToDateIncome ?? 0)}
                              </td>
                              {/* MTD Expense */}
                              <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums text-sm text-rose-400/60">
                                {fmt(day.monthToDateExpense ?? 0)}
                              </td>
                              {/* MTD Net — sticky left */}
                              <td
                                className={`px-4 py-2 text-right whitespace-nowrap tabular-nums text-sm font-semibold sticky z-10 border-r border-zinc-800/20 ${mtdBg} ${mtdNet.cls} opacity-75`}
                                style={{ left: 0 }}
                              >
                                {mtdNet.text}
                              </td>
                              {/* MTD per-PM */}
                              {data.paymentMethods.map(pm => {
                                const v = day.monthToDatePaymentTotals?.[String(pm.id)] ?? 0;
                                const c = getCell(v);
                                return (
                                  <td key={pm.id} className={`px-4 py-2 text-right whitespace-nowrap tabular-nums text-sm ${c.cls} opacity-60`}>
                                    {v === 0 ? <span className="text-zinc-700">—</span> : c.text}
                                  </td>
                                );
                              })}
                              {/* TX count — empty for MTD */}
                              <td className="px-4 py-2" />
                              {/* Actions — empty for MTD sub-row */}
                              <td className={`px-2 py-1.5 sticky left-0 z-10 border-r border-zinc-800/20 ${mtdBg}`} />
                            </tr>
                          </React.Fragment>
                        );
                      })}

                      {/* Totals row */}
                      <tr className="border-t-2 border-zinc-700/50 bg-zinc-800/25 font-semibold">
                        <td className="px-3 py-3 text-right text-xs text-zinc-300 sticky bg-zinc-800/40 z-10 border-l border-zinc-700/30" style={{ right: 0 }}>
                          الإجمالي
                        </td>
                        <td className="px-3 py-3 text-right text-zinc-500 text-xs">{data.days.length} يوم</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-400">{fmt(data.summary.totalIncome)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-400">{fmt(data.summary.totalExpense)}</td>
                        <td
                          className={`px-3 py-3 text-right tabular-nums sticky z-10 border-r border-zinc-700/30 bg-zinc-800/40
                            ${data.summary.netTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                          style={{ left: 0 }}
                        >
                          {fmt(data.summary.netTotal)}
                        </td>
                        {data.paymentMethods.map(pm => {
                          const v = data.summary.totalByPaymentMethod[String(pm.id)] ?? 0;
                          const c = getCell(v);
                          return (
                            <td key={pm.id} className={`px-3 py-3 text-right tabular-nums ${c.cls}`}>
                              {v === 0 ? <span className="text-zinc-700">—</span> : c.text}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-right text-zinc-300 tabular-nums">{data.summary.transactionsCount}</td>
                        <td className="px-3 py-3 sticky left-0 z-10 bg-zinc-800/40 border-r border-zinc-700/30" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── Action Modals ──────────────────────────────────────────────── */}
      {activeModal === 'income' && (
        <PastDateIncomeModal
          isOpen
          onClose={closeModal}
          onIncomeComplete={onActionSuccess}
          defaultDate={modalDate}
        />
      )}
      {activeModal === 'expense' && (
        <PastDateExpenseModal
          isOpen
          onClose={closeModal}
          onExpenseComplete={onActionSuccess}
          defaultDate={modalDate}
        />
      )}
      {activeModal === 'transfer' && (
        <PastDateTransferModal
          isOpen
          onClose={closeModal}
          onTransferComplete={onActionSuccess}
          defaultDate={modalDate}
        />
      )}

      {detailsModal && (
        <PaymentMethodDetailsModal
          paymentMethodKey={detailsModal.paymentMethodKey}
          paymentMethodName={detailsModal.paymentMethodName}
          filters={{
            newDay: null,
            dateFrom: detailsModal.date,
            dateTo: detailsModal.date,
            shiftMoveId: null,
            userId: userId !== 'all' ? Number(userId) : null,
          }}
          onClose={() => setDetailsModal(null)}
        />
      )}
    </div>
  );
}
