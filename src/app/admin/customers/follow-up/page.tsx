'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Users, Cake, Clock, Search, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, Copy, MessageCircle, History,
  ExternalLink, X, Calendar, RotateCcw, UserPlus, AlertTriangle,
  CheckSquare, Square, PhoneCall,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import ContactDialog, { FollowUpDetailPopover, type FollowUpData } from '@/components/customers/ContactDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'new' | 'birthdays' | 'inactive';

interface Counts {
  newCustomers: number;
  birthdays: number;
  inactiveCustomers: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface NewCustomer {
  clientId: number;
  name: string;
  phone: string | null;
  mobile: string | null;
  registerDate: string;
  cameFrom: string | null;
  visitCount: number;
  totalSpending: number;
  lastVisit: string | null;
}

interface BirthdayCustomer {
  clientId: number;
  name: string;
  phone: string | null;
  mobile: string | null;
  birthDate: string;
  birthDay: number;
  ageThisYear: number;
  daysRemaining: number;
  visitCount: number;
  lastVisit: string | null;
}

interface InactiveCustomer {
  clientId: number;
  name: string;
  phone: string | null;
  mobile: string | null;
  lastVisit: string;
  visitCount: number;
  totalSpending: number;
  inactiveDays: number;
  lastEmpName: string | null;
  lastServiceName: string | null;
  followUp: FollowUpData | null;
}

interface FollowUpSummary {
  contacted: number;
  pending:   number;
}

type Customer = NewCustomer | BirthdayCustomer | InactiveCustomer;

interface ApiResponse {
  success: boolean;
  data: Customer[];
  pagination: Pagination;
  counts: Counts;
  followUpSummary?: FollowUpSummary;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return val; }
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0 }).format(n) + ' ج.م';
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let p = raw.replace(/\D/g, '');
  if (p.startsWith('0')) p = '2' + p;
  if (!p.startsWith('20')) p = '20' + p;
  return p;
}

function getBestPhone(c: { phone?: string | null; mobile?: string | null }): string {
  return c.mobile || c.phone || '';
}

function birthdayBadge(days: number): { text: string; cls: string } {
  if (days === 0)  return { text: 'اليوم 🎂',           cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  if (days === 1)  return { text: 'غداً',               cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
  if (days > 0)    return { text: `بعد ${days} يوم`,    cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
  return { text: `منذ ${Math.abs(days)} يوم`,            cls: 'bg-zinc-700/60 text-zinc-400 border-zinc-600/40' };
}

function inactiveBadge(days: number): { text: string; cls: string } {
  if (days >= 365) return { text: `+سنة (${days} يوم)`,       cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
  if (days >= 180) return { text: `+6 شهور (${days} يوم)`,   cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' };
  if (days >= 90)  return { text: `+3 شهور (${days} يوم)`,   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  return { text: `${days} يوم`,                               cls: 'bg-zinc-700/60 text-zinc-400 border-zinc-600/40' };
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── Row Action Menu ───────────────────────────────────────────────────────────

function ActionMenu({
  customer,
  msgTemplate,
}: {
  customer: { clientId: number; name: string; phone?: string | null; mobile?: string | null };
  msgTemplate: string;
}) {
  const phone = getBestPhone(customer);
  const normalized = normalizePhone(phone);

  const copyPhone = () => {
    if (phone) navigator.clipboard.writeText(phone).catch(() => {});
  };

  const openWhatsApp = () => {
    if (!normalized) return;
    const msg = encodeURIComponent(msgTemplate.replace('{customerName}', customer.name));
    window.open(`https://wa.me/${normalized}?text=${msg}`, '_blank');
  };

  return (
    <div className="flex items-center gap-1" dir="ltr">
      {phone && (
        <button
          onClick={copyPhone}
          title="نسخ رقم الهاتف"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
      {normalized && (
        <button
          onClick={openWhatsApp}
          title="فتح واتساب"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <MessageCircle className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        title="سجل الزيارات"
        className="p-1.5 rounded-lg text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
        onClick={() => {/* future: open visit history modal */}}
      >
        <History className="w-3.5 h-3.5" />
      </button>
      <button
        title="بيانات العميل"
        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Pagination Bar ────────────────────────────────────────────────────────────

function PaginationBar({
  pagination,
  pageSize,
  onPage,
  onPageSize,
}: {
  pagination: Pagination;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const { page, totalPages, total } = pagination;
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-zinc-800/60 text-xs text-zinc-500">
      <span>{start}–{end} من {total} عميل</span>
      <div className="flex items-center gap-2" dir="ltr">
        <select
          value={pageSize}
          onChange={e => onPageSize(Number(e.target.value))}
          className="bg-zinc-800 border border-zinc-700/50 rounded-lg px-2 py-1.5 text-zinc-300 text-xs focus:outline-none"
        >
          {[25, 50, 100].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="px-1">{page} / {totalPages}</span>
        <button
          onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Empty / Error / Loading states ────────────────────────────────────────────

function StateBlock({
  type, onRetry,
}: { type: 'loading' | 'empty' | 'error'; onRetry?: () => void }) {
  if (type === 'loading') return (
    <div className="flex items-center justify-center py-20 text-zinc-500 gap-3">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">جاري التحميل...</span>
    </div>
  );
  if (type === 'error') return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500">
      <AlertTriangle className="w-8 h-8 text-rose-400" />
      <p className="text-sm text-rose-300">حدث خطأ أثناء التحميل</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs border border-zinc-700/50 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
        </button>
      )}
    </div>
  );
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-600">
      <Users className="w-10 h-10 opacity-30" />
      <p className="text-sm">لا توجد بيانات</p>
    </div>
  );
}

// ── Table: New Customers ──────────────────────────────────────────────────────

function NewCustomersTable({ data }: { data: NewCustomer[] }) {
  const MSG = 'مرحباً {customerName}، نرحب بك دائماً في صالون Cut ✂️';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
            <th className="px-4 py-3 text-right font-medium">اسم العميل</th>
            <th className="px-4 py-3 text-right font-medium">رقم الهاتف</th>
            <th className="px-4 py-3 text-right font-medium">تاريخ التسجيل</th>
            <th className="px-4 py-3 text-right font-medium">مصدر المعرفة</th>
            <th className="px-4 py-3 text-right font-medium">آخر زيارة</th>
            <th className="px-4 py-3 text-right font-medium">عدد الزيارات</th>
            <th className="px-4 py-3 text-right font-medium">إجمالي الإنفاق</th>
            <th className="px-4 py-3 text-right font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {data.map(c => (
            <tr key={c.clientId} className="hover:bg-zinc-800/30 transition-colors">
              <td className="px-4 py-3">
                <div>
                  <p className="font-medium text-white">{c.name}</p>
                  <p className="text-[11px] text-zinc-600 font-mono">#{c.clientId}</p>
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-zinc-300 text-xs" dir="ltr">
                {c.mobile || c.phone || <span className="text-zinc-600 not-italic">—</span>}
              </td>
              <td className="px-4 py-3 text-zinc-400">{formatDate(c.registerDate)}</td>
              <td className="px-4 py-3">
                {c.cameFrom
                  ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-400 border border-zinc-700/40">{c.cameFrom}</span>
                  : <span className="text-zinc-600">—</span>}
              </td>
              <td className="px-4 py-3 text-zinc-400">{formatDate(c.lastVisit)}</td>
              <td className="px-4 py-3">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {c.visitCount}
                </span>
              </td>
              <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                {c.totalSpending > 0 ? formatCurrency(c.totalSpending) : <span className="text-zinc-600">—</span>}
              </td>
              <td className="px-4 py-3">
                <ActionMenu customer={c} msgTemplate={MSG} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Table: Birthdays ──────────────────────────────────────────────────────────

function BirthdaysTable({ data }: { data: BirthdayCustomer[] }) {
  const MSG = 'كل سنة وأنت بخير {customerName} 🎉 صالون Cut يتمنى لك عاماً رائعاً.';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
            <th className="px-4 py-3 text-right font-medium">اسم العميل</th>
            <th className="px-4 py-3 text-right font-medium">رقم الهاتف</th>
            <th className="px-4 py-3 text-right font-medium">تاريخ الميلاد</th>
            <th className="px-4 py-3 text-right font-medium">يوم الميلاد</th>
            <th className="px-4 py-3 text-right font-medium">العمر هذا العام</th>
            <th className="px-4 py-3 text-right font-medium">الحالة</th>
            <th className="px-4 py-3 text-right font-medium">آخر زيارة</th>
            <th className="px-4 py-3 text-right font-medium">عدد الزيارات</th>
            <th className="px-4 py-3 text-right font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {data.map(c => {
            const badge = birthdayBadge(c.daysRemaining);
            return (
              <tr key={c.clientId} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-white">{c.name}</p>
                    <p className="text-[11px] text-zinc-600 font-mono">#{c.clientId}</p>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-zinc-300 text-xs" dir="ltr">
                  {c.mobile || c.phone || <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3 text-zinc-400">{formatDate(c.birthDate)}</td>
                <td className="px-4 py-3 text-zinc-300 font-medium">{c.birthDay}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    {c.ageThisYear} سنة
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.cls}`}>
                    {badge.text}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">{formatDate(c.lastVisit)}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {c.visitCount}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ActionMenu customer={c} msgTemplate={MSG} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Table: Inactive ───────────────────────────────────────────────────────────

function InactiveTable({
  data,
  onCheckboxClick,
}: {
  data: InactiveCustomer[];
  followUpMonth: string;
  onCheckboxClick: (customer: InactiveCustomer) => void;
}) {
  const MSG = 'مرحباً {customerName}، اشتقنا إليك في صالون Cut ✂️ يسعدنا رؤيتك مجدداً.';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
            <th className="px-4 py-3 text-right font-medium">تم التواصل</th>
            <th className="px-4 py-3 text-right font-medium">اسم العميل</th>
            <th className="px-4 py-3 text-right font-medium">رقم الهاتف</th>
            <th className="px-4 py-3 text-right font-medium">آخر زيارة</th>
            <th className="px-4 py-3 text-right font-medium">مدة الغياب</th>
            <th className="px-4 py-3 text-right font-medium">عدد الزيارات</th>
            <th className="px-4 py-3 text-right font-medium">إجمالي الإنفاق</th>
            <th className="px-4 py-3 text-right font-medium">آخر موظف</th>
            <th className="px-4 py-3 text-right font-medium">آخر خدمة</th>
            <th className="px-4 py-3 text-right font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {data.map(c => {
            const badge = inactiveBadge(c.inactiveDays);
            const contacted = !!c.followUp;
            return (
              <tr key={c.clientId} className="hover:bg-zinc-800/30 transition-colors">
                {/* Contacted column */}
                <td className="px-4 py-3 w-[150px] align-top">
                  <button
                    type="button"
                    onClick={() => onCheckboxClick(c)}
                    title={contacted ? 'تم التواصل — انقر للتعديل' : 'لم يتم التواصل — انقر للتسجيل'}
                    className="flex flex-col items-start gap-1 w-full text-right group"
                  >
                    {contacted ? (
                      <>
                        <span className="flex items-center gap-1.5 text-emerald-400">
                          <CheckSquare className="w-4 h-4 shrink-0" />
                          <span className="text-[11px] font-medium">تم التواصل</span>
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {c.followUp?.contactedAt
                            ? new Date(c.followUp.contactedAt).toLocaleString('ar-EG', {
                                month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })
                            : ''}
                        </span>
                        <span className="text-[10px] text-zinc-600">{c.followUp?.contactedByUserName || ''}</span>
                        {c.followUp && (
                          <span className="mt-0.5">
                            <FollowUpDetailPopover fu={c.followUp} />
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="flex items-center gap-1.5 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                        <Square className="w-4 h-4 shrink-0" />
                        <span className="text-[11px]">لم يتم التواصل</span>
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-white">{c.name}</p>
                    <p className="text-[11px] text-zinc-600 font-mono">#{c.clientId}</p>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-zinc-300 text-xs" dir="ltr">
                  {c.mobile || c.phone || <span className="text-zinc-600 not-italic">—</span>}
                </td>
                <td className="px-4 py-3 text-zinc-400">{formatDate(c.lastVisit)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.cls}`}>
                    {badge.text}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {c.visitCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                  {c.totalSpending > 0 ? formatCurrency(c.totalSpending) : <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3 text-zinc-400 text-xs">
                  {c.lastEmpName || <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3 text-zinc-400 text-xs max-w-[120px] truncate">
                  {c.lastServiceName || <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  <ActionMenu customer={c} msgTemplate={MSG} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function CustomerFollowUpPage() {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  // ── URL-driven state ──────────────────────────────────────────────────────
  const activeTab  = (searchParams.get('tab') as Tab) || 'new';
  const monthParam = searchParams.get('month') || getCurrentMonth();
  const pageParam  = parseInt(searchParams.get('page') || '1', 10);
  const sizeParam  = parseInt(searchParams.get('pageSize') || '25', 10);
  const searchParam = searchParams.get('search') || '';
  const inactiveMonthsParam = parseInt(searchParams.get('inactiveMonths') || '2', 10);
  const contactStatusParam = (searchParams.get('contactStatus') || 'all') as 'all' | 'pending' | 'contacted';

  // ── Local state ───────────────────────────────────────────────────────────
  const [data,            setData]           = useState<Customer[]>([]);
  const [pagination,      setPagination]     = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [counts,          setCounts]         = useState<Counts>({ newCustomers: 0, birthdays: 0, inactiveCustomers: 0 });
  const [followUpSummary, setFollowUpSummary] = useState<FollowUpSummary>({ contacted: 0, pending: 0 });
  const [loading,         setLoading]        = useState(true);
  const [isError,         setIsError]        = useState(false);
  const [searchInput,     setSearchInput]    = useState(searchParam);

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [dialogOpen,      setDialogOpen]     = useState(false);
  const [dialogCustomer,  setDialogCustomer] = useState<InactiveCustomer | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentMonth = getCurrentMonth();

  // ── URL builder ───────────────────────────────────────────────────────────
  const buildUrl = useCallback((overrides: Record<string, string | number>) => {
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(overrides).forEach(([k, v]) => {
      if (v === '' || v === null || v === undefined) p.delete(k);
      else p.set(k, String(v));
    });
    return `${pathname}?${p.toString()}`;
  }, [pathname, searchParams]);

  const navigate = useCallback((overrides: Record<string, string | number>) => {
    router.push(buildUrl(overrides));
  }, [router, buildUrl]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setIsError(false);
    try {
      const qs = new URLSearchParams({
        tab:            activeTab,
        month:          monthParam,
        page:           String(pageParam),
        pageSize:       String(sizeParam),
        inactiveMonths: String(inactiveMonthsParam),
        ...(searchParam ? { search: searchParam } : {}),
        ...(activeTab === 'inactive' ? { contactStatus: contactStatusParam } : {}),
      });
      const res  = await fetch(`/api/admin/customers/follow-up?${qs}`);
      const json = await res.json() as ApiResponse;
      if (!res.ok || !json.success) throw new Error(json.error || 'خطأ في التحميل');
      setData(json.data);
      setPagination(json.pagination);
      setCounts(json.counts);
      if (json.followUpSummary) setFollowUpSummary(json.followUpSummary);
    } catch {
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTab, monthParam, pageParam, sizeParam, searchParam, inactiveMonthsParam, contactStatusParam]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Dialog handlers ──────────────────────────────────────────────────────
  const openDialog = useCallback((customer: InactiveCustomer) => {
    setDialogCustomer(customer);
    setDialogOpen(true);
  }, []);

  const handleFollowUpSaved = useCallback((clientId: number, followUp: FollowUpData) => {
    setData(prev => prev.map(c => {
      if ((c as InactiveCustomer).clientId === clientId) {
        return { ...c, followUp } as InactiveCustomer;
      }
      return c;
    }));
    setFollowUpSummary(prev => {
      const wasContacted = (data.find(c => (c as InactiveCustomer).clientId === clientId) as InactiveCustomer)?.followUp;
      if (wasContacted) return prev;
      return { contacted: prev.contacted + 1, pending: Math.max(0, prev.pending - 1) };
    });
  }, [data]);

  // ── Debounced search ──────────────────────────────────────────────────────
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      navigate({ search: val, page: 1 });
    }, 400);
  };

  // ── Tabs config ───────────────────────────────────────────────────────────
  const TABS = [
    { id: 'new'       as Tab, label: 'العملاء الجدد هذا الشهر',         icon: UserPlus,  count: counts.newCustomers      },
    { id: 'birthdays' as Tab, label: 'أعياد الميلاد هذا الشهر',         icon: Cake,      count: counts.birthdays         },
    { id: 'inactive'  as Tab, label: 'لم يزورونا منذ أكثر من شهرين',   icon: Clock,     count: counts.inactiveCustomers },
  ];

  const INACTIVE_FILTERS = [
    { months: 2,  label: 'أكثر من شهرين' },
    { months: 3,  label: 'أكثر من 3 شهور' },
    { months: 6,  label: 'أكثر من 6 شهور' },
    { months: 12, label: 'أكثر من سنة' },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5" dir="rtl">

      {/* ── Header ── */}
      <PageHeader
        title="متابعة العملاء"
        description="متابعة العملاء الجدد وأعياد الميلاد والعملاء غير النشطين"
      />

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => navigate({ tab: t.id, page: 1 })}
            className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-right ${
              activeTab === t.id
                ? 'bg-amber-500/10 border-amber-500/30 shadow-sm'
                : 'bg-zinc-900/50 border-zinc-800/50 hover:border-zinc-700/60'
            }`}
          >
            <div className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${
              activeTab === t.id ? 'bg-amber-500/15 text-amber-400' : 'bg-zinc-800/60 text-zinc-500'
            }`}>
              <t.icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-500 leading-tight">{t.label}</p>
              <p className="text-2xl font-bold text-white mt-0.5">{t.count}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Month Picker (hidden for inactive tab) ── */}
      {activeTab !== 'inactive' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              type="month"
              value={monthParam}
              onChange={e => navigate({ month: e.target.value, page: 1 })}
              className="bg-transparent text-zinc-200 text-sm focus:outline-none"
            />
          </div>
          {monthParam !== currentMonth && (
            <button
              onClick={() => navigate({ month: currentMonth, page: 1 })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-400 hover:text-zinc-200 text-xs border border-zinc-700/40 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              العودة للشهر الحالي
            </button>
          )}
        </div>
      )}

      {/* ── Inactive filters ── */}
      {activeTab === 'inactive' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">فلترة سريعة:</span>
            {INACTIVE_FILTERS.map(f => (
              <button
                key={f.months}
                onClick={() => navigate({ inactiveMonths: f.months, page: 1 })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  inactiveMonthsParam === f.months
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-zinc-800/50 text-zinc-500 border-zinc-700/40 hover:border-zinc-600/60 hover:text-zinc-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Contact status filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500 flex items-center gap-1"><PhoneCall className="w-3 h-3" /> حالة التواصل:</span>
            {([['all', 'الكل'], ['pending', 'لم يتم التواصل'], ['contacted', 'تم التواصل']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => navigate({ contactStatus: val, page: 1 })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  contactStatusParam === val
                    ? val === 'contacted'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : val === 'pending'
                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-zinc-800/50 text-zinc-500 border-zinc-700/40 hover:border-zinc-600/60 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Follow-up summary */}
          {!loading && (
            <div className="flex items-center gap-4 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                تم التواصل: <strong className="text-emerald-400">{followUpSummary.contacted}</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
                متبقي للتواصل: <strong className="text-zinc-300">{followUpSummary.pending}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 p-1 bg-zinc-900/60 border border-zinc-800/60 rounded-xl w-fit flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => navigate({ tab: t.id, page: 1 })}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
              activeTab === t.id ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-500'
            }`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── Search + Refresh ── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف أو الرقم..."
            className="w-full bg-zinc-900/60 border border-zinc-800/60 rounded-xl pr-10 pl-9 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); navigate({ search: '', page: 1 }); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-700/40 disabled:opacity-50"
          title="تحديث"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden">
        {loading ? (
          <StateBlock type="loading" />
        ) : isError ? (
          <StateBlock type="error" onRetry={fetchData} />
        ) : data.length === 0 ? (
          <StateBlock type="empty" />
        ) : (
          <>
            {activeTab === 'new'       && <NewCustomersTable data={data as NewCustomer[]} />}
            {activeTab === 'birthdays' && <BirthdaysTable    data={data as BirthdayCustomer[]} />}
            {activeTab === 'inactive'  && <InactiveTable     data={data as InactiveCustomer[]} followUpMonth={getCurrentMonth()} onCheckboxClick={openDialog} />}

            <PaginationBar
              pagination={pagination}
              pageSize={sizeParam}
              onPage={p => navigate({ page: p })}
              onPageSize={s => navigate({ pageSize: s, page: 1 })}
            />
          </>
        )}
      </div>

      {/* ── Contact Dialog ── */}
      <ContactDialog
        open={dialogOpen}
        customer={dialogCustomer}
        followUpMonth={getCurrentMonth()}
        existingFollowUp={dialogCustomer?.followUp ?? null}
        onClose={() => setDialogOpen(false)}
        onSaved={handleFollowUpSaved}
      />
    </div>
  );
}
