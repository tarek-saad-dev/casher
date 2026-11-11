'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  UserPlus, Users, Gift, CheckCircle2, RotateCcw, Ticket, Search,
  RefreshCw, ChevronLeft, ChevronRight, AlertTriangle, BadgeCheck,
  XCircle, Clock,
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton, TableSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type View = 'claims' | 'codes';
type ClaimStatus = 'APPLIED' | 'REVERSED' | 'PENDING' | 'CANCELLED';
type VoucherStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
type CodeFilter = 'active' | 'inactive';
type Status = ClaimStatus | CodeFilter | 'all';

type Summary = {
  issuedCodes: number;
  activeCodes: number;
  successfulReferrals: number;
  refundedReferrals: number;
  rewardsIssued: number;
  rewardsAvailable: number;
  rewardsUsed: number;
};
type Claim = {
  id: number;
  code: string;
  referrerName: string;
  referredName: string;
  status: ClaimStatus;
  originalInvoiceId: number | null;
  claimedAtUtc: string;
  appliedAtUtc: string | null;
  reversedAtUtc: string | null;
  rewardStatus: VoucherStatus | null;
};
type Code = {
  id: number;
  code: string;
  customerName: string;
  activatedAtUtc: string | null;
  createdAtUtc: string;
  referrals: number;
  refunded: number;
  availableRewards: number;
  usedRewards: number;
};
export type ReferralAdminDashboard = {
  summary: Summary;
  view: View;
  status: Status;
  search: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  claims: Claim[];
  codes: Code[];
};

const claimLabels: Record<ClaimStatus, string> = {
  APPLIED: 'ناجحة',
  REVERSED: 'الفاتورة مسترجعة',
  PENDING: 'قيد التنفيذ',
  CANCELLED: 'ملغاة',
};
const rewardLabels: Record<VoucherStatus, string> = {
  ACTIVE: 'مُصدرة',
  USED: 'مستخدمة',
  EXPIRED: 'منتهية',
  REVOKED: 'ملغاة',
};
const statusOptions: Record<View, Array<{ value: Status; label: string }>> = {
  claims: [
    { value: 'all', label: 'كل الحالات' },
    { value: 'APPLIED', label: 'ناجحة' },
    { value: 'REVERSED', label: 'مسترجعة' },
    { value: 'PENDING', label: 'قيد التنفيذ' },
    { value: 'CANCELLED', label: 'ملغاة' },
  ],
  codes: [
    { value: 'all', label: 'كل الأكواد' },
    { value: 'active', label: 'مفعّلة' },
    { value: 'inactive', label: 'غير مفعّلة' },
  ],
};

const countFormat = new Intl.NumberFormat('ar-EG');
function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** Refuse to render malformed or cross-view data; no fake-number fallback. */
export function parseReferralAdminResponse(body: unknown, view: View, page: number): ReferralAdminDashboard {
  if (!body || typeof body !== 'object') throw new Error('INVALID_DASHBOARD');
  const payload = body as Record<string, unknown>;
  if (payload.ok !== true || !payload.dashboard || typeof payload.dashboard !== 'object') {
    throw new Error('INVALID_DASHBOARD');
  }
  const d = payload.dashboard as Record<string, unknown>;
  const s = d.summary as Record<string, unknown> | undefined;
  if (d.view !== view || d.page !== page ||
      !s || typeof s !== 'object' ||
      !Array.isArray(d.claims) || !Array.isArray(d.codes) ||
      !isCount(d.total) || !isCount(d.totalPages) ||
      !isCount(d.pageSize) || d.pageSize !== 20 ||
      !['all', 'APPLIED', 'REVERSED', 'PENDING', 'CANCELLED', 'active', 'inactive'].includes(String(d.status)) ||
      typeof d.search !== 'string') throw new Error('INVALID_DASHBOARD');
  for (const k of ['issuedCodes', 'activeCodes', 'successfulReferrals', 'refundedReferrals',
    'rewardsIssued', 'rewardsAvailable', 'rewardsUsed']) {
    if (!isCount(s[k])) throw new Error('INVALID_DASHBOARD');
  }
  if ((s.activeCodes as number) > (s.issuedCodes as number) ||
      (s.rewardsAvailable as number) + (s.rewardsUsed as number) > (s.rewardsIssued as number) ||
      d.totalPages !== Math.ceil((d.total as number) / 20) ||
      d.claims.length > 20 || d.codes.length > 20 ||
      (view === 'claims' && d.codes.length !== 0) ||
      (view === 'codes' && d.claims.length !== 0)) {
    throw new Error('INVALID_DASHBOARD');
  }
  const rows = (view === 'claims' ? d.claims : d.codes) as Array<Record<string, unknown>>;
  for (const row of rows) {
    if (!row || !isCount(row.id) || Number(row.id) === 0 ||
        typeof row.code !== 'string' || !/^CUT-[0-9A-F]{24}$/.test(row.code)) {
      throw new Error('INVALID_DASHBOARD');
    }
    if (view === 'claims') {
      if (typeof row.referrerName !== 'string' || typeof row.referredName !== 'string' ||
          !['APPLIED', 'REVERSED', 'PENDING', 'CANCELLED'].includes(String(row.status)) ||
          !(row.rewardStatus === null || ['ACTIVE', 'USED', 'EXPIRED', 'REVOKED'].includes(String(row.rewardStatus)))) {
        throw new Error('INVALID_DASHBOARD');
      }
    } else if (typeof row.customerName !== 'string' ||
      !isCount(row.referrals) || !isCount(row.refunded) ||
      !isCount(row.availableRewards) || !isCount(row.usedRewards)) {
      throw new Error('INVALID_DASHBOARD');
    }
  }
  return d as ReferralAdminDashboard;
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
}
function numberLabel(n: number) {
  return countFormat.format(n);
}
function StatTile({
  title, value, icon: Icon, detail,
}: { title: string; value: number; icon: typeof Gift; detail?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-2 text-sm text-zinc-400">
        <span>{title}</span><Icon className="h-5 w-5 text-emerald-400" />
      </div>
      <p className="mt-3 text-2xl font-bold text-white">{numberLabel(value)}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
    </div>
  );
}

/** Manager dashboard: sourced exclusively from DRVO-023 (never the legacy mock). */
export default function ReferralsPage() {
  const [view, setView] = useState<View>('claims');
  const [status, setStatus] = useState<Status>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [dashboard, setDashboard] = useState<ReferralAdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDashboard(null);
    const params = new URLSearchParams({
      view, status, page: String(page), search,
    });
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/cut-club/referrals?${params.toString()}`,
          { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal },
        );
        if (!response.ok) {
          if (response.status === 503) {
            throw new Error('لوحة الإحالات غير مفعّلة حاليًا أو قاعدة بياناتها غير جاهزة.');
          }
          if (response.status === 401 || response.status === 403) {
            throw new Error('حسابك غير مخوّل لعرض بيانات الإحالات.');
          }
          throw new Error('تعذر تحميل بيانات الإحالات من الخادم.');
        }
        const data: unknown = await response.json();
        const parsed = parseReferralAdminResponse(data, view, page);
        if (!controller.signal.aborted) setDashboard(parsed);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error && !['INVALID_DASHBOARD'].includes(e.message)
            ? e.message
            : 'الاستجابة غير صالحة؛ لم يتم عرض أي بيانات قديمة أو تجريبية.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [view, status, search, page, refreshToken]);

  const changeView = (next: View) => {
    setView(next); setStatus('all'); setPage(1);
  };
  const applyStatus = (next: Status) => { setStatus(next); setPage(1); };
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(searchDraft.trim().slice(0, 80));
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white" dir="rtl">
      <PageHeader icon={UserPlus} title="إدارة الإحالات"
        description="أكواد العملاء والإحالات ومكافآت 20% الفعلية"
        gradient="from-green-500/20 to-emerald-600/20" />
      <div className="space-y-5 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-400">
            البيانات من سجل الإحالات الفعلي؛ مشاركة WhatsApp ليست دعوة مسجلة.
          </p>
          <Button type="button" size="sm" variant="outline"
            data-testid="admin-referral-refresh"
            className="shrink-0 gap-2"
            onClick={() => setRefreshToken(value => value + 1)}>
            <RefreshCw className="h-4 w-4" /> تحديث
          </Button>
        </div>

        {error && (
          <div role="alert" data-testid="admin-referral-error"
            className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-900/10 p-4 text-sm text-amber-300">
            <AlertTriangle className="h-5 w-5 shrink-0" /> {error}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="admin-referral-loading">
            {Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)}
          </div>
        )}

        {!loading && dashboard && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"
              data-testid="admin-referral-summary">
              <StatTile title="أكواد مفعّلة" value={dashboard.summary.activeCodes}
                icon={Ticket} detail={`من ${numberLabel(dashboard.summary.issuedCodes)} كود مسجّل`} />
              <StatTile title="إحالات ناجحة" value={dashboard.summary.successfulReferrals}
                icon={CheckCircle2} detail="فواتير مُسددة ولم تُسترجع" />
              <StatTile title="إحالات مسترجعة" value={dashboard.summary.refundedReferrals}
                icon={RotateCcw} detail="المكافأة المُكتسبة تظل صالحة" />
              <StatTile title="مكافآت 20% متاحة" value={dashboard.summary.rewardsAvailable}
                icon={Gift} detail={`مستخدمة: ${numberLabel(dashboard.summary.rewardsUsed)} • صادرة: ${numberLabel(dashboard.summary.rewardsIssued)}`} />
            </div>
          </>
        )}

        <PremiumCard>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-lg border border-zinc-700 bg-zinc-900 p-1"
                aria-label="أقسام الإحالات">
                <button type="button" data-testid="admin-referral-tab-claims"
                  aria-pressed={view === 'claims'}
                  className={`rounded-md px-4 py-2 text-sm ${view === 'claims' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400'}`}
                  onClick={() => changeView('claims')}>
                  <Users className="ml-1 inline h-4 w-4" /> سجل الإحالات
                </button>
                <button type="button" data-testid="admin-referral-tab-codes"
                  aria-pressed={view === 'codes'}
                  className={`rounded-md px-4 py-2 text-sm ${view === 'codes' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400'}`}
                  onClick={() => changeView('codes')}>
                  <Ticket className="ml-1 inline h-4 w-4" /> أكواد العملاء
                </button>
              </div>
              <span className="text-xs text-zinc-400">
                {dashboard ? `${numberLabel(dashboard.total)} سجل` : '—'}
              </span>
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <form className="flex flex-1 gap-2" onSubmit={onSearch}>
                <Input data-testid="admin-referral-search"
                  value={searchDraft} maxLength={80}
                  onChange={e => setSearchDraft(e.target.value)}
                  placeholder={view === 'claims' ? 'اسم المُحيل أو العميل الجديد أو الكود...' : 'اسم صاحب الكود أو الكود...'}
                  className="min-w-0 flex-1 border-zinc-700 bg-zinc-900" />
                <Button type="submit" variant="outline"
                  data-testid="admin-referral-search-submit" className="gap-1">
                  <Search className="h-4 w-4" /> بحث
                </Button>
              </form>
              <select value={status}
                data-testid="admin-referral-status"
                onChange={e => applyStatus(e.target.value as Status)}
                className="min-h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100">
                {statusOptions[view].map(o => (
                  <option value={o.value} key={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <TableSkeleton rows={5} />
            ) : dashboard ? (
              <>
                <div className="overflow-x-auto" data-testid="admin-referral-table">
                  <table className="w-full min-w-[750px] text-right text-sm">
                    <thead className="border-b border-zinc-800 bg-zinc-800/50 text-zinc-400">
                      {view === 'claims' ? (
                        <tr>
                          <th className="px-3 py-3">المُحيل</th>
                          <th className="px-3 py-3">العميل المُحال</th>
                          <th className="px-3 py-3">الكود</th>
                          <th className="px-3 py-3">تاريخ التسجيل</th>
                          <th className="px-3 py-3">الفاتورة</th>
                          <th className="px-3 py-3">حالة الإحالة</th>
                          <th className="px-3 py-3">مكافأة 20%</th>
                        </tr>
                      ) : (
                        <tr>
                          <th className="px-3 py-3">صاحب الكود</th>
                          <th className="px-3 py-3">الكود</th>
                          <th className="px-3 py-3">التفعيل</th>
                          <th className="px-3 py-3">إجمالي الإحالات</th>
                          <th className="px-3 py-3">المسترجعة</th>
                          <th className="px-3 py-3">مكافآت متاحة</th>
                          <th className="px-3 py-3">مستخدمة</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {view === 'claims' ? dashboard.claims.map(claim => (
                        <tr key={claim.id} data-testid="admin-referral-claim-row" className="hover:bg-zinc-800/30">
                          <td className="px-3 py-3">{claim.referrerName}</td>
                          <td className="px-3 py-3">{claim.referredName}</td>
                          <td className="px-3 py-3 font-mono text-xs" dir="ltr">{claim.code}</td>
                          <td className="px-3 py-3 text-zinc-400">{dateLabel(claim.appliedAtUtc ?? claim.claimedAtUtc)}</td>
                          <td className="px-3 py-3">{claim.originalInvoiceId ?? '—'}</td>
                          <td className="px-3 py-3">
                            <Badge variant="outline" className={claim.status === 'APPLIED'
                              ? 'border-emerald-600/60 text-emerald-300'
                              : claim.status === 'REVERSED'
                                ? 'border-amber-600/60 text-amber-300'
                                : 'border-zinc-600 text-zinc-300'}>
                              {claim.status === 'APPLIED' && <BadgeCheck className="ml-1 h-3 w-3" />}
                              {claim.status === 'REVERSED' && <RotateCcw className="ml-1 h-3 w-3" />}
                              {claim.status === 'CANCELLED' && <XCircle className="ml-1 h-3 w-3" />}
                              {claim.status === 'PENDING' && <Clock className="ml-1 h-3 w-3" />}
                              {claimLabels[claim.status]}
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            {claim.rewardStatus ? rewardLabels[claim.rewardStatus] : 'لم تُصدر'}
                          </td>
                        </tr>
                      )) : dashboard.codes.map(customerCode => (
                        <tr key={customerCode.id} data-testid="admin-referral-code-row" className="hover:bg-zinc-800/30">
                          <td className="px-3 py-3">{customerCode.customerName}</td>
                          <td className="px-3 py-3 font-mono text-xs" dir="ltr">{customerCode.code}</td>
                          <td className="px-3 py-3">
                            {customerCode.activatedAtUtc
                              ? <span className="text-emerald-300">مفعّل · {dateLabel(customerCode.activatedAtUtc)}</span>
                              : <span className="text-amber-300">غير مفعّل</span>}
                          </td>
                          <td className="px-3 py-3">{numberLabel(customerCode.referrals)}</td>
                          <td className="px-3 py-3">{numberLabel(customerCode.refunded)}</td>
                          <td className="px-3 py-3">{numberLabel(customerCode.availableRewards)}</td>
                          <td className="px-3 py-3">{numberLabel(customerCode.usedRewards)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(view === 'claims' ? dashboard.claims : dashboard.codes).length === 0 && (
                    <div className="px-3 py-8 text-center text-sm text-zinc-400"
                      data-testid="admin-referral-empty">
                      مفيش سجلات مطابقة للبحث والفلاتر الحالية.
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
                  <span className="text-xs text-zinc-400">
                    {dashboard.totalPages === 0 ? 'لا توجد صفحات'
                      : `صفحة ${numberLabel(page)} من ${numberLabel(dashboard.totalPages)}`}
                  </span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline"
                      data-testid="admin-referral-prev"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}>
                      <ChevronRight className="h-4 w-4" /> السابق
                    </Button>
                    <Button type="button" size="sm" variant="outline"
                      data-testid="admin-referral-next"
                      disabled={page >= dashboard.totalPages}
                      onClick={() => setPage(p => p + 1)}>
                      التالي <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              !error && <p className="text-sm text-zinc-400">لا توجد بيانات معروضة.</p>
            )}
          </div>
        </PremiumCard>
        <p className="text-xs text-zinc-500">
          صفحة متابعة فقط؛ لا تمنح أو تلغي خصومات أو نقاطًا. المكافآت المكتسبة تستمر بعد استرجاع فاتورة الإحالة الأصلية.
        </p>
      </div>
    </div>
  );
}
