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
  low: 'bg-success-soft text-success border-success/20',
  medium: 'bg-warning-soft text-warning border-warning/20',
  high: 'bg-warning-soft text-warning border-warning/20',
  critical: 'bg-destructive-soft text-destructive border-destructive/20',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالي', critical: 'حرج',
};

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  success: 'bg-success-soft text-success border-success/20',
  failed: 'bg-destructive-soft text-destructive border-destructive/20',
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
    <div className="min-h-full bg-background p-3 sm:p-6" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-brand-soft rounded-xl border border-brand/20">
              <ShieldCheck className="h-7 w-7 text-brand" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">سجل التدقيق</h1>
              <p className="text-sm text-muted-foreground">سجل غير قابل للتعديل لكل العمليات الحساسة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(s => !s)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-colors text-sm ${
                showFilters ? 'bg-brand-soft text-brand border border-brand/30' : 'bg-muted hover:bg-surface-muted text-foreground'
              }`}
            >
              <Filter className="h-4 w-4" />
              فلاتر
            </button>
            <button
              onClick={load}
              className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-surface-muted text-foreground rounded-xl transition-colors text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              تحديث
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              value={filters.actionType}
              onChange={e => setFilters(f => ({ ...f, actionType: e.target.value }))}
              placeholder="نوع العملية"
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
            <input
              value={filters.entityType}
              onChange={e => setFilters(f => ({ ...f, entityType: e.target.value }))}
              placeholder="نوع الكيان"
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
            <input
              value={filters.entityId}
              onChange={e => setFilters(f => ({ ...f, entityId: e.target.value }))}
              placeholder="معرف الكيان"
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
            >
              <option value="">كل الحالات</option>
              <option value="success">تم التنفيذ</option>
              <option value="failed">فشل</option>
            </select>
            <input
              value={filters.userId}
              onChange={e => setFilters(f => ({ ...f, userId: e.target.value }))}
              placeholder="معرف المستخدم"
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
            <button
              onClick={() => { setPage(1); load(); }}
              className="sm:col-span-2 lg:col-span-5 flex items-center justify-center gap-2 px-4 py-2 bg-brand-soft hover:bg-brand-soft text-brand border border-brand/30 rounded-xl text-sm transition-colors"
            >
              <Search className="h-4 w-4" />
              تطبيق
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-destructive-soft border border-destructive/20 rounded-xl p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-brand" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Activity className="h-10 w-10 opacity-30" />
              <p className="text-sm">لا توجد سجلات</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted border-b border-border text-muted-foreground">
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
                <tbody className="divide-y divide-border">
                  {items.map(r => (
                    <tr key={r.AuditID} className="hover:bg-surface-muted transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">#{r.AuditID}</td>
                      <td className="px-4 py-3 text-foreground font-medium">
                        {ACTION_LABELS[r.ActionType] ?? r.ActionLabel ?? r.ActionType}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="text-muted-foreground">{r.EntityType}</span>
                        {r.EntityID && <span className="text-muted-foreground"> #{r.EntityID}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-foreground">
                          <User className="h-3 w-3 text-muted-foreground" />
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
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {fmtDate(r.CreatedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setDetail(r)}
                          className="p-1.5 hover:bg-brand-soft rounded-lg text-muted-foreground hover:text-brand transition-colors"
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
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              عرض {items.length} من {total} سجل
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 bg-muted hover:bg-surface-muted disabled:opacity-40 rounded-lg text-foreground transition-colors"
              >
                السابق
              </button>
              <span className="px-3 py-1.5 bg-card border border-border rounded-lg">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 bg-muted hover:bg-surface-muted disabled:opacity-40 rounded-lg text-foreground transition-colors"
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
          <div className="relative w-full max-w-2xl max-h-[85dvh] overflow-y-auto bg-card border border-border rounded-2xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-soft rounded-xl">
                  <FileText className="h-5 w-5 text-brand" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    سجل #{detail.AuditID} — {ACTION_LABELS[detail.ActionType] ?? detail.ActionLabel ?? detail.ActionType}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
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
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-muted-foreground mb-1">الكيان</p>
                  <p className="text-foreground font-medium">{detail.EntityType}{detail.EntityID ? ` #${detail.EntityID}` : ''}</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-muted-foreground mb-1">الخطورة</p>
                  <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-medium ${RISK_STYLES[detail.RiskLevel]}`}>
                    {RISK_LABELS[detail.RiskLevel]}
                  </span>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-muted-foreground mb-1">المستخدم</p>
                  <p className="text-foreground">{detail.PerformedByUserName ?? '—'} (ID: {detail.PerformedByUserID ?? '—'})</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-muted-foreground mb-1">النقطة</p>
                  <p className="text-foreground">{detail.ActionMethod} {detail.ActionMethod ? '—' : ''} {detail.EndpointPath ?? ''}</p>
                </div>
                {detail.Reason && (
                  <div className="col-span-2 bg-muted rounded-lg p-3">
                    <p className="text-muted-foreground mb-1">السبب</p>
                    <p className="text-foreground">{detail.Reason}</p>
                  </div>
                )}
              </div>

              {detail.OldData && (
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ChevronDown className="h-3 w-3" />
                    البيانات السابقة
                  </p>
                  <pre className="text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(safeJson(detail.OldData), null, 2)}
                  </pre>
                </div>
              )}

              {detail.NewData && (
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-warning mb-2 flex items-center gap-1.5">
                    <ChevronDown className="h-3 w-3" />
                    البيانات الجديدة
                  </p>
                  <pre className="text-[10px] text-warning overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(safeJson(detail.NewData), null, 2)}
                  </pre>
                </div>
              )}

              {detail.ChangedFields && (
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-info mb-2 flex items-center gap-1.5">
                    <Activity className="h-3 w-3" />
                    الحقول المعدلة
                  </p>
                  <pre className="text-[10px] text-info overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(safeJson(detail.ChangedFields), null, 2)}
                  </pre>
                </div>
              )}

              {detail.ErrorMessage && (
                <div className="bg-destructive-soft border border-destructive/20 rounded-lg p-3 text-xs text-destructive">
                  <p className="font-semibold mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    رسالة الخطأ
                  </p>
                  <p>{detail.ErrorMessage}</p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-border">
              <button
                onClick={() => setDetail(null)}
                className="w-full px-4 py-2 bg-muted hover:bg-surface-muted text-foreground rounded-xl text-sm transition-colors"
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
