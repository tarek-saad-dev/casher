'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Loader2, RefreshCw, Eye, Calendar, User, FileText,
  AlertTriangle, CheckCircle2, XCircle, Search, Filter, ChevronDown,
  Activity,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type ExecutionStatus = 'success' | 'failed';

interface AuditRow {
  AuditID: number;
  ActionType: string;
  ActionLabel: string | null;
  EntityType: string | null;
  EntityID: string | null;
  ActionMethod: string | null;
  EndpointPath: string | null;
  PerformedByUserID: number | null;
  PerformedByUserName: string | null;
  OldData: string | null;
  NewData: string | null;
  ChangedFields: string | null;
  Reason: string | null;
  RiskLevel: RiskLevel;
  ExecutionStatus: ExecutionStatus;
  ErrorMessage: string | null;
  CreatedAt: string;
}

interface AuditResponse {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  edit_expense: 'تعديل مصروف',
  delete_expense: 'حذف مصروف',
  edit_income: 'تعديل إيراد',
  delete_income: 'حذف إيراد',
  edit_invoice: 'تعديل فاتورة مبيعات',
  delete_invoice: 'حذف فاتورة مبيعات',
  treasury_transfer: 'تحويل في الخزنة',
  close_day: 'تقفيل اليوم',
  update_user_roles: 'تعديل صلاحيات مستخدم',
  update_page_access: 'تعديل صلاحيات صفحة',
  create_page: 'إنشاء صفحة جديدة',
  delete_cash_move: 'حذف حركة خزنة',
};

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالي', critical: 'حرج',
};

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
};

const STATUS_LABELS: Record<ExecutionStatus, string> = {
  success: 'تم التنفيذ',
  failed: 'فشل',
};

const PAGE_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  try { return new Date(d).toLocaleString('ar-EG'); } catch { return d; }
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    actionType: '',
    entityType: '',
    entityId: '',
    status: '',
    userId: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  const [detail, setDetail] = useState<AuditRow | null>(null);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (filters.actionType) params.set('actionType', filters.actionType);
    if (filters.entityType) params.set('entityType', filters.entityType);
    if (filters.entityId) params.set('entityId', filters.entityId);
    if (filters.status) params.set('status', filters.status);
    if (filters.userId) params.set('userId', filters.userId);
    return params.toString();
  }, [page, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit-log?${buildParams()}`);
      if (!res.ok) throw new Error('فشل تحميل سجل التدقيق');
      const data: AuditResponse = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
              <h1 className="text-2xl font-bold text-white">سجل التدقيق</h1>
              <p className="text-sm text-zinc-500">سجل غير قابل للتعديل لكل العمليات الحساسة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(s => !s)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-colors text-sm ${
                showFilters ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              <Filter className="h-4 w-4" />
              فلاتر
            </button>
            <button
              onClick={load}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              تحديث
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              value={filters.actionType}
              onChange={e => setFilters(f => ({ ...f, actionType: e.target.value }))}
              placeholder="نوع العملية"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
            <input
              value={filters.entityType}
              onChange={e => setFilters(f => ({ ...f, entityType: e.target.value }))}
              placeholder="نوع الكيان"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
            <input
              value={filters.entityId}
              onChange={e => setFilters(f => ({ ...f, entityId: e.target.value }))}
              placeholder="معرف الكيان"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50"
            >
              <option value="">كل الحالات</option>
              <option value="success">تم التنفيذ</option>
              <option value="failed">فشل</option>
            </select>
            <input
              value={filters.userId}
              onChange={e => setFilters(f => ({ ...f, userId: e.target.value }))}
              placeholder="معرف المستخدم"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
            <button
              onClick={() => { setPage(1); load(); }}
              className="sm:col-span-2 lg:col-span-5 flex items-center justify-center gap-2 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/30 rounded-xl text-sm transition-colors"
            >
              <Search className="h-4 w-4" />
              تطبيق
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-rose-950/30 border border-rose-500/20 rounded-xl p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400/60" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
              <Activity className="h-10 w-10 opacity-30" />
              <p className="text-sm">لا توجد سجلات</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-800/60 border-b border-zinc-700/50 text-zinc-400">
                    <th className="px-4 py-3 text-right font-medium">#</th>
                    <th className="px-4 py-3 text-right font-medium">العملية</th>
                    <th className="px-4 py-3 text-right font-medium">الكيان</th>
                    <th className="px-4 py-3 text-right font-medium">المستخدم</th>
                    <th className="px-4 py-3 text-right font-medium">الخطورة</th>
                    <th className="px-4 py-3 text-right font-medium">الحالة</th>
                    <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-center font-medium">تفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {items.map(r => (
                    <tr key={r.AuditID} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-500">#{r.AuditID}</td>
                      <td className="px-4 py-3 text-white font-medium">
                        {ACTION_LABELS[r.ActionType] ?? r.ActionLabel ?? r.ActionType}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        <span className="text-zinc-500">{r.EntityType}</span>
                        {r.EntityID && <span className="text-zinc-600"> #{r.EntityID}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <User className="h-3 w-3 text-zinc-600" />
                          {r.PerformedByUserName ?? r.PerformedByUserID ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-medium ${RISK_STYLES[r.RiskLevel]}`}>
                          {RISK_LABELS[r.RiskLevel]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLES[r.ExecutionStatus]}`}>
                          {STATUS_LABELS[r.ExecutionStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {fmtDate(r.CreatedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setDetail(r)}
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

        {/* Pagination */}
        {!loading && items.length > 0 && (
          <div className="flex items-center justify-between text-sm text-zinc-400">
            <p>
              عرض {items.length} من {total} سجل
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg text-zinc-300 transition-colors"
              >
                السابق
              </button>
              <span className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg text-zinc-300 transition-colors"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail Modal ── */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          dir="rtl"
          onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-500/10 rounded-xl">
                  <FileText className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    سجل #{detail.AuditID} — {ACTION_LABELS[detail.ActionType] ?? detail.ActionLabel ?? detail.ActionType}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fmtDate(detail.CreatedAt)}
                  </p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLES[detail.ExecutionStatus]}`}>
                {STATUS_LABELS[detail.ExecutionStatus]}
              </span>
            </div>

            <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
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
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 mb-1">المستخدم</p>
                  <p className="text-zinc-200">{detail.PerformedByUserName ?? '—'} (ID: {detail.PerformedByUserID ?? '—'})</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 mb-1">النقطة</p>
                  <p className="text-zinc-200">{detail.ActionMethod} {detail.ActionMethod ? '—' : ''} {detail.EndpointPath ?? ''}</p>
                </div>
                {detail.Reason && (
                  <div className="col-span-2 bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 mb-1">السبب</p>
                    <p className="text-zinc-200">{detail.Reason}</p>
                  </div>
                )}
              </div>

              {detail.OldData && (
                <div className="bg-zinc-800/40 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-zinc-400 mb-2 flex items-center gap-1.5">
                    <ChevronDown className="h-3 w-3" />
                    البيانات السابقة
                  </p>
                  <pre className="text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(safeJson(detail.OldData), null, 2)}
                  </pre>
                </div>
              )}

              {detail.NewData && (
                <div className="bg-zinc-800/40 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-amber-400 mb-2 flex items-center gap-1.5">
                    <ChevronDown className="h-3 w-3" />
                    البيانات الجديدة
                  </p>
                  <pre className="text-[10px] text-amber-300/70 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(safeJson(detail.NewData), null, 2)}
                  </pre>
                </div>
              )}

              {detail.ChangedFields && (
                <div className="bg-zinc-800/40 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
                    <Activity className="h-3 w-3" />
                    الحقول المعدلة
                  </p>
                  <pre className="text-[10px] text-blue-300/70 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(safeJson(detail.ChangedFields), null, 2)}
                  </pre>
                </div>
              )}

              {detail.ErrorMessage && (
                <div className="bg-rose-950/30 border border-rose-500/20 rounded-lg p-3 text-xs text-rose-400">
                  <p className="font-semibold mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    رسالة الخطأ
                  </p>
                  <p>{detail.ErrorMessage}</p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-zinc-800">
              <button
                onClick={() => setDetail(null)}
                className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
