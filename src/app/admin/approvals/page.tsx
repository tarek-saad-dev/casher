'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, AlertTriangle,
  Loader2, RefreshCw, ChevronDown, Eye, ThumbsUp, ThumbsDown,
  FileText, User, Calendar, Activity,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'cancelled';
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface ApprovalRow {
  ApprovalID: number;
  RequestType: string;
  EntityType: string;
  EntityID: string | null;
  ActionMethod: string;
  Status: Status;
  RiskLevel: RiskLevel;
  Reason: string | null;
  CreatedAt: string;
  ReviewedAt: string | null;
  ExecutedAt: string | null;
  ErrorMessage: string | null;
  ReviewNote: string | null;
  RequestedByName: string;
  ReviewedByName: string | null;
}

interface ApprovalDetail extends ApprovalRow {
  OldData: Record<string, unknown> | null;
  NewData: Record<string, unknown> | null;
}

type TabKey = 'pending' | 'executed' | 'rejected' | 'failed' | 'all';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  delete_cash_move:   'حذف حركة خزنة',
  delete_invoice:     'حذف فاتورة',
  delete_expense:     'حذف مصروف',
  delete_income:      'حذف إيراد',
  close_day:          'تقفيل اليوم',
  treasury_transfer:  'تحويل خزنة',
  update_user_roles:  'تعديل صلاحيات مستخدم',
  update_page_access: 'تعديل صلاحيات صفحة',
};

const RISK_STYLES: Record<RiskLevel, string> = {
  low:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  medium:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالي', critical: 'حرج',
};

const STATUS_STYLES: Record<Status, string> = {
  pending:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  rejected:  'bg-rose-500/10 text-rose-400 border-rose-500/20',
  executed:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed:    'bg-red-900/20 text-red-400 border-red-500/20',
  cancelled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

const STATUS_LABELS: Record<Status, string> = {
  pending:   'بانتظار الموافقة',
  approved:  'تمت الموافقة',
  rejected:  'مرفوض',
  executed:  'تم التنفيذ',
  failed:    'فشل',
  cancelled: 'ملغي',
};

const TABS: { key: TabKey; label: string; icon: typeof Clock }[] = [
  { key: 'pending',  label: 'قيد الانتظار', icon: Clock },
  { key: 'executed', label: 'منفذة',         icon: CheckCircle2 },
  { key: 'rejected', label: 'مرفوضة',        icon: XCircle },
  { key: 'failed',   label: 'فاشلة',         icon: AlertTriangle },
  { key: 'all',      label: 'الكل',          icon: Activity },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const [requests,  setRequests]  = useState<ApprovalRow[]>([]);
  const [summary,   setSummary]   = useState<Record<string, number>>({});
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');

  const [detail,    setDetail]    = useState<ApprovalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectNote, setRejectNote]       = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const load = useCallback(async (tab: TabKey) => {
    setLoading(true);
    try {
      const params = tab !== 'all' ? `?status=${tab}` : '';
      const res = await fetch(`/api/admin/approvals${params}`);
      if (!res.ok) throw new Error('فشل التحميل');
      const data = await res.json();
      setRequests(data.requests ?? []);
      setSummary(data.summary ?? {});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeTab); }, [activeTab, load]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    setShowRejectInput(false);
    setRejectNote('');
    try {
      const res = await fetch(`/api/admin/approvals/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!detail) return;
    const risk = detail.RiskLevel;
    if ((risk === 'high' || risk === 'critical') &&
      !confirm(`⚠️ تنبيه: هذه العملية ذات خطورة "${RISK_LABELS[risk]}"\nهل أنت متأكد من الموافقة؟`)
    ) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/approvals/${detail.ApprovalID}/approve`, { method: 'POST' });
      const data = await res.json();
      alert(data.message);
      if (data.ok) { setDetail(null); load(activeTab); }
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!detail) return;
    if (!showRejectInput) { setShowRejectInput(true); return; }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/approvals/${detail.ApprovalID}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: rejectNote }),
      });
      const data = await res.json();
      alert(data.message);
      if (data.ok) { setDetail(null); load(activeTab); }
    } finally {
      setActionLoading(false);
    }
  };

  const fmt = (d: string) => {
    try { return new Date(d).toLocaleString('ar-EG'); } catch { return d; }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-violet-500/10 rounded-xl border border-violet-500/20">
              <ShieldCheck className="h-7 w-7 text-violet-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">طلبات الموافقة</h1>
              <p className="text-sm text-zinc-500">مراجعة العمليات الحساسة التي تتطلب موافقة السوبر أدمن</p>
            </div>
          </div>
          <button
            onClick={() => load(activeTab)}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'قيد الانتظار', key: 'pending',  icon: Clock,         color: 'amber' },
            { label: 'تم التنفيذ',    key: 'executed', icon: CheckCircle2,  color: 'emerald' },
            { label: 'مرفوضة',        key: 'rejected', icon: XCircle,       color: 'rose' },
            { label: 'فاشلة',         key: 'failed',   icon: AlertTriangle, color: 'red' },
          ].map(({ label, key, icon: Icon, color }) => (
            <div key={key}
              onClick={() => { setActiveTab(key as TabKey); }}
              className={`bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 cursor-pointer hover:border-${color}-500/30 transition-colors`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 text-${color}-400`} />
                <div>
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className={`text-xl font-bold text-${color}-400`}>{summary[key] ?? 0}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800 rounded-xl p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === key
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400/60" />
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
              <ShieldCheck className="h-10 w-10 opacity-30" />
              <p className="text-sm">لا توجد طلبات</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-800/60 border-b border-zinc-700/50 text-zinc-400">
                    <th className="px-4 py-3 text-right font-medium">#</th>
                    <th className="px-4 py-3 text-right font-medium">نوع العملية</th>
                    <th className="px-4 py-3 text-right font-medium">الكيان</th>
                    <th className="px-4 py-3 text-right font-medium">الطالب</th>
                    <th className="px-4 py-3 text-right font-medium">الخطورة</th>
                    <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-right font-medium">الحالة</th>
                    <th className="px-4 py-3 text-center font-medium">تفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {requests.map(r => (
                    <tr key={r.ApprovalID} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-500">#{r.ApprovalID}</td>
                      <td className="px-4 py-3 text-white font-medium">
                        {ACTION_LABELS[r.RequestType] ?? r.RequestType}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        <span className="text-zinc-500">{r.EntityType}</span>
                        {r.EntityID && <span className="text-zinc-600"> #{r.EntityID}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <User className="h-3 w-3 text-zinc-600" />
                          {r.RequestedByName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-medium ${RISK_STYLES[r.RiskLevel]}`}>
                          {RISK_LABELS[r.RiskLevel]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {fmt(r.CreatedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLES[r.Status]}`}>
                          {STATUS_LABELS[r.Status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openDetail(r.ApprovalID)}
                          className="p-1.5 hover:bg-violet-500/20 rounded-lg text-zinc-500 hover:text-violet-400 transition-colors"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {(detailLoading || detail) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          dir="rtl"
          onClick={e => { if (e.target === e.currentTarget) { setDetail(null); setShowRejectInput(false); } }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl overflow-hidden">

            {detailLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-violet-400/60" />
              </div>
            ) : detail ? (
              <>
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-500/10 rounded-xl">
                      <FileText className="h-5 w-5 text-violet-400" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white">
                        طلب #{detail.ApprovalID} — {ACTION_LABELS[detail.RequestType] ?? detail.RequestType}
                      </h2>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        بواسطة {detail.RequestedByName} — {fmt(detail.CreatedAt)}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLES[detail.Status]}`}>
                    {STATUS_LABELS[detail.Status]}
                  </span>
                </div>

                {/* Modal Body */}
                <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">

                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-zinc-800/50 rounded-lg p-3">
                      <p className="text-zinc-500 mb-1">الكيان</p>
                      <p className="text-zinc-200 font-medium">{detail.EntityType}{detail.EntityID ? ` #${detail.EntityID}` : ''}</p>
                    </div>
                    <div className="bg-zinc-800/50 rounded-lg p-3">
                      <p className="text-zinc-500 mb-1">الخطورة</p>
                      <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-medium ${RISK_STYLES[detail.RiskLevel]}`}>
                        {RISK_LABELS[detail.RiskLevel]}
                      </span>
                    </div>
                    {detail.Reason && (
                      <div className="col-span-2 bg-zinc-800/50 rounded-lg p-3">
                        <p className="text-zinc-500 mb-1">السبب</p>
                        <p className="text-zinc-200">{detail.Reason}</p>
                      </div>
                    )}
                  </div>

                  {/* OldData */}
                  {detail.OldData && (
                    <div className="bg-zinc-800/40 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-zinc-400 mb-2 flex items-center gap-1.5">
                        <ChevronDown className="h-3 w-3" />
                        البيانات قبل التعديل
                      </p>
                      <pre className="text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(detail.OldData, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* NewData */}
                  {detail.NewData && (
                    <div className="bg-zinc-800/40 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-amber-400 mb-2 flex items-center gap-1.5">
                        <ChevronDown className="h-3 w-3" />
                        البيانات الجديدة المطلوبة
                      </p>
                      <pre className="text-[10px] text-amber-300/70 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(detail.NewData, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Review info */}
                  {detail.ReviewedByName && (
                    <div className="bg-zinc-800/40 rounded-lg p-3 text-xs">
                      <p className="text-zinc-500 mb-1">تمت المراجعة بواسطة</p>
                      <p className="text-zinc-200">{detail.ReviewedByName} — {detail.ReviewedAt ? fmt(detail.ReviewedAt) : '—'}</p>
                      {detail.ReviewNote && <p className="text-zinc-400 mt-1">ملاحظة: {detail.ReviewNote}</p>}
                    </div>
                  )}

                  {/* Error */}
                  {detail.ErrorMessage && (
                    <div className="bg-red-950/30 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                      <p className="font-semibold mb-1">رسالة الخطأ:</p>
                      <p>{detail.ErrorMessage}</p>
                    </div>
                  )}

                  {/* Reject note input */}
                  {showRejectInput && (
                    <div className="space-y-2">
                      <label className="text-xs text-zinc-400">سبب الرفض (اختياري)</label>
                      <textarea
                        value={rejectNote}
                        onChange={e => setRejectNote(e.target.value)}
                        rows={3}
                        placeholder="اكتب سبب الرفض..."
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-rose-500/50 resize-none"
                      />
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                {detail.Status === 'pending' && (
                  <div className="flex gap-3 px-5 py-4 border-t border-zinc-800">
                    <button
                      onClick={() => { setDetail(null); setShowRejectInput(false); }}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm transition-colors"
                    >
                      إغلاق
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-xl text-sm transition-colors disabled:opacity-50"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
                      {showRejectInput ? 'تأكيد الرفض' : 'رفض'}
                    </button>
                    <button
                      onClick={handleApprove}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-sm transition-colors disabled:opacity-50"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                      موافقة وتنفيذ
                    </button>
                  </div>
                )}
                {detail.Status !== 'pending' && (
                  <div className="px-5 py-4 border-t border-zinc-800">
                    <button
                      onClick={() => { setDetail(null); setShowRejectInput(false); }}
                      className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm transition-colors"
                    >
                      إغلاق
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
