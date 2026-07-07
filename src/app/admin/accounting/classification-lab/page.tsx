'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Beaker,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Filter,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type {
  CashMoveClassification,
  ClassificationAuditSummary,
  ClassificationConfidence,
  PnlImpact,
} from '@/lib/accounting/cashMoveClassification';
import type { CashMoveClassificationAuditMeta } from '@/lib/accounting/cashMoveClassificationAudit';
import {
  RISK_TYPE_LABELS,
  assignLabBucket,
  buildEmployeePayrollGroups,
  buildLabBuckets,
  computeLabKpis,
  computePnlSimulation,
  computeReadiness,
  dedupeRows,
  downloadCsv,
  getRiskTypes,
  isPayrollMissingEmployee,
  isRiskyRow,
  type LabBucketStats,
  type RiskType,
} from '@/lib/accounting/classificationLabMetrics';

interface AuditResponse {
  summary: ClassificationAuditSummary;
  rows: CashMoveClassification[];
  needsReviewRows?: CashMoveClassification[];
  meta: CashMoveClassificationAuditMeta;
  params: { dateFrom?: string; dateTo?: string };
}

const FETCH_LIMIT_OPTIONS = [500, 1000, 2000, 5000];
const ANALYSIS_ROW_CAP = 15000;
const RISK_PAGE_SIZE = 25;

const CONFIDENCE_LABELS: Record<ClassificationConfidence, string> = {
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
};

const PNL_LABELS: Record<PnlImpact | 'mixed', string> = {
  revenue: 'إيراد',
  expense: 'مصروف',
  contra_expense: 'معاكس',
  none: 'بدون أثر',
  mixed: 'متعدد',
};

function formatMoney(n: number) {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function FlowBadge({ value, variant = 'group' }: { value: string; variant?: 'group' | 'kind' | 'pnl' }) {
  const styles = {
    group: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    kind: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    pnl: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px]', styles[variant])}>
      {value}
    </Badge>
  );
}

function ConfidenceBadge({ c }: { c: ClassificationConfidence }) {
  const map = {
    high: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    low: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', map[c])}>
      {CONFIDENCE_LABELS[c]}
    </Badge>
  );
}

function BucketCard({ bucket }: { bucket: LabBucketStats }) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    orange: 'border-orange-500/20 bg-orange-500/5',
    violet: 'border-violet-500/20 bg-violet-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    zinc: 'border-zinc-600/30 bg-zinc-800/30',
    blue: 'border-blue-500/20 bg-blue-500/5',
    rose: 'border-rose-500/20 bg-rose-500/5',
  };

  return (
    <div className={cn('rounded-xl border p-3', colorMap[bucket.color] ?? colorMap.zinc)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-zinc-200 leading-snug">{bucket.label}</h4>
        <FlowBadge
          value={PNL_LABELS[bucket.pnlImpact] ?? bucket.pnlImpact}
          variant="pnl"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-zinc-500">صفوف</p>
          <p className="font-semibold text-white">{bucket.count}</p>
        </div>
        <div>
          <p className="text-zinc-500">مبلغ</p>
          <p className="font-semibold text-white">{formatMoney(bucket.totalAmount)}</p>
        </div>
        <div>
          <p className="text-zinc-500">مراجعة</p>
          <p className={cn('font-semibold', bucket.needsReviewCount > 0 ? 'text-amber-400' : 'text-zinc-400')}>
            {bucket.needsReviewCount}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">ثقة</p>
          <p className="text-[10px] text-zinc-400">
            {bucket.confidence.high}ع / {bucket.confidence.medium}م / {bucket.confidence.low}ض
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({
  row,
  open,
  onClose,
}: {
  row: CashMoveClassification | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!row) return null;
  const risks = getRiskTypes(row);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="fixed inset-y-0 left-0 right-auto h-full w-full max-w-md translate-x-0 translate-y-0 rounded-none sm:max-w-md data-open:slide-in-from-left"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle className="text-right">حركة #{row.cashMoveId}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto text-sm">
          <section className="space-y-2 rounded-lg bg-zinc-900/60 p-3">
            <h4 className="text-xs font-medium text-zinc-500">البيانات الأصلية</h4>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-zinc-500">التاريخ</dt><dd>{row.invDate}</dd></div>
              <div><dt className="text-zinc-500">المبلغ</dt><dd className="font-mono">{formatMoney(row.amount)}</dd></div>
              <div><dt className="text-zinc-500">الاتجاه</dt><dd>{row.inOut === 'in' ? 'وارد' : 'صادر'}</dd></div>
              <div><dt className="text-zinc-500">النوع</dt><dd>{row.invType}</dd></div>
              <div className="col-span-2"><dt className="text-zinc-500">الفئة</dt><dd>{row.categoryName || '—'}</dd></div>
              <div className="col-span-2"><dt className="text-zinc-500">ملاحظات</dt><dd className="text-zinc-400">{row.notes || '—'}</dd></div>
            </dl>
          </section>

          {row.linkedPayrollTxn && (
            <section className="space-y-1 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
              <h4 className="font-medium text-violet-300">ربط المرتبات</h4>
              <p>{row.linkedPayrollTxn.source} #{row.linkedPayrollTxn.id}</p>
              <p>{row.linkedPayrollTxn.empName || `موظف #${row.linkedPayrollTxn.empId}`}</p>
              {row.linkedPayrollTxn.txnType && <p>نوع: {row.linkedPayrollTxn.txnType}</p>}
            </section>
          )}

          <section className="space-y-2 rounded-lg bg-zinc-900/60 p-3">
            <h4 className="text-xs font-medium text-zinc-500">التصنيف المقترح</h4>
            <div className="flex flex-wrap gap-1">
              <FlowBadge value={row.suggestedFlowGroup} />
              <FlowBadge value={row.suggestedFlowKind} variant="kind" />
              <FlowBadge value={row.suggestedPnlImpact} variant="pnl" />
              <ConfidenceBadge c={row.confidence} />
            </div>
            <p className="text-xs text-zinc-400">
              مصدر القاعدة: <span className="font-mono text-cyan-400">{row.matchedRuleSource}</span>
              {row.matchedRuleId != null && ` #${row.matchedRuleId}`}
              {row.matchedKeyword && ` · "${row.matchedKeyword}"`}
            </p>
            <p className="text-xs text-zinc-400">الطرف: {row.suggestedPartyType}</p>
            <p className="text-xs text-zinc-400">موظف: {row.suggestedEmpId ? `#${row.suggestedEmpId}` : '—'}</p>
            {row.fromAdminMapping && (
              <Link href="/admin/accounting/classification-settings" className="text-xs text-amber-400 underline">
                إدارة التعيين
              </Link>
            )}
            {!row.suggestedEmpId && (row.suggestedFlowGroup === 'payroll' || row.suggestedFlowGroup === 'employee_advance') && (
              <Link href="/admin/accounting/classification-settings" className="block text-xs text-rose-400 underline">
                إضافة اسم مستعار للموظف
              </Link>
            )}
          </section>

          <section className="rounded-lg border border-zinc-700/50 p-3 text-xs">
            <h4 className="mb-1 font-medium text-zinc-400">سبب التصنيف</h4>
            <p className="text-zinc-300">{row.reason}</p>
          </section>

          {risks.length > 0 && (
            <section className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
              <h4 className="mb-2 text-xs font-medium text-rose-400">علامات الخطر</h4>
              <div className="flex flex-wrap gap-1">
                {risks.map((r) => (
                  <Badge key={r} variant="outline" className="border-rose-500/30 text-[10px] text-rose-400">
                    {RISK_TYPE_LABELS[r]}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClassificationLabPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [fetchLimit, setFetchLimit] = useState(2000);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ClassificationAuditSummary | null>(null);
  const [meta, setMeta] = useState<CashMoveClassificationAuditMeta | null>(null);
  const [analysisRows, setAnalysisRows] = useState<CashMoveClassification[]>([]);
  const [rowsPartial, setRowsPartial] = useState(false);

  const [selectedRow, setSelectedRow] = useState<CashMoveClassification | null>(null);
  const [riskPage, setRiskPage] = useState(1);

  const [riskTypeFilter, setRiskTypeFilter] = useState<string>('all');
  const [flowGroupFilter, setFlowGroupFilter] = useState<string>('all');
  const [flowKindFilter, setFlowKindFilter] = useState<string>('all');
  const [pnlFilter, setPnlFilter] = useState<string>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = new URLSearchParams();
      if (dateFrom) base.set('dateFrom', dateFrom);
      if (dateTo) base.set('dateTo', dateTo);
      base.set('limit', String(fetchLimit));
      base.set('offset', '0');
      base.set('includeNeedsReviewRows', 'true');

      const firstRes = await fetch(`/api/admin/audit/cash-move-classification?${base}`);
      const first: AuditResponse = await firstRes.json();
      if (!firstRes.ok) throw new Error((first as { error?: string }).error || 'فشل التحميل');

      let collected = [...first.rows];
      const total = first.meta.totalMatchingRows;

      for (
        let offset = fetchLimit;
        offset < total && offset < ANALYSIS_ROW_CAP;
        offset += fetchLimit
      ) {
        const batchParams = new URLSearchParams(base);
        batchParams.set('offset', String(offset));
        batchParams.delete('includeNeedsReviewRows');
        const batchRes = await fetch(`/api/admin/audit/cash-move-classification?${batchParams}`);
        const batch: AuditResponse = await batchRes.json();
        if (!batchRes.ok) break;
        collected.push(...batch.rows);
      }

      const merged = dedupeRows([
        ...collected,
        ...(first.needsReviewRows ?? []),
      ]);

      setSummary(first.summary);
      setMeta(first.meta);
      setAnalysisRows(merged);
      setRowsPartial(total > ANALYSIS_ROW_CAP || merged.length < total);
      setRiskPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, fetchLimit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const readiness = useMemo(
    () => (summary ? computeReadiness(analysisRows, summary) : null),
    [analysisRows, summary],
  );

  const kpis = useMemo(
    () => (summary ? computeLabKpis(analysisRows, summary) : null),
    [analysisRows, summary],
  );

  const buckets = useMemo(() => buildLabBuckets(analysisRows), [analysisRows]);
  const pnlSim = useMemo(() => computePnlSimulation(analysisRows), [analysisRows]);
  const employeeGroups = useMemo(() => buildEmployeePayrollGroups(analysisRows), [analysisRows]);

  const riskyRows = useMemo(
    () => analysisRows.filter(isRiskyRow),
    [analysisRows],
  );

  const filteredRiskRows = useMemo(() => {
    return riskyRows.filter((row) => {
      if (riskTypeFilter !== 'all' && !getRiskTypes(row).includes(riskTypeFilter as RiskType)) {
        return false;
      }
      if (flowGroupFilter !== 'all' && row.suggestedFlowGroup !== flowGroupFilter) return false;
      if (flowKindFilter !== 'all' && row.suggestedFlowKind !== flowKindFilter) return false;
      if (pnlFilter !== 'all' && row.suggestedPnlImpact !== pnlFilter) return false;
      if (confidenceFilter !== 'all' && row.confidence !== confidenceFilter) return false;
      if (employeeFilter === 'has' && !row.suggestedEmpId) return false;
      if (employeeFilter === 'missing' && row.suggestedEmpId) return false;
      return true;
    });
  }, [
    riskyRows,
    riskTypeFilter,
    flowGroupFilter,
    flowKindFilter,
    pnlFilter,
    confidenceFilter,
    employeeFilter,
  ]);

  const riskTotalPages = Math.max(1, Math.ceil(filteredRiskRows.length / RISK_PAGE_SIZE));
  const riskPageRows = filteredRiskRows.slice(
    (riskPage - 1) * RISK_PAGE_SIZE,
    riskPage * RISK_PAGE_SIZE,
  );

  const flowGroupOptions = useMemo(() => {
    const s = new Set(analysisRows.map((r) => r.suggestedFlowGroup));
    return [...s].sort();
  }, [analysisRows]);

  const flowKindOptions = useMemo(() => {
    const s = new Set(analysisRows.map((r) => r.suggestedFlowKind));
    return [...s].sort();
  }, [analysisRows]);

  const readinessColor =
    readiness?.status === 'ready'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : readiness?.status === 'needs_cleanup'
        ? 'border-amber-500/30 bg-amber-500/10'
        : 'border-rose-500/30 bg-rose-500/10';

  const readinessTextColor =
    readiness?.status === 'ready'
      ? 'text-emerald-400'
      : readiness?.status === 'needs_cleanup'
        ? 'text-amber-400'
        : 'text-rose-400';

  const exportNeedsReview = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('includeNeedsReviewRows', 'true');
      params.set('limit', '1');
      params.set('offset', '0');
      const res = await fetch(`/api/admin/audit/cash-move-classification?${params}`);
      const data: AuditResponse = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error);
      const rows = data.needsReviewRows ?? [];
      if (!rows.length) {
        setError('لا توجد صفوف تحتاج مراجعة');
        return;
      }
      downloadCsv(`classification-lab-needs-review-${dateFrom || 'all'}.csv`, rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التصدير');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-6" dir="rtl">
      <PageHeader
        title="معمل التصنيف المحاسبي"
        description="مراجعة آمنة لحركات الخزنة قبل تطبيق الهيكلة الجديدة"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-xs">
            قراءة فقط
          </Badge>
          <Link href="/admin/accounting/classification-settings">
            <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-300">
              <Settings2 className="ml-2 h-4 w-4" />الإعدادات
            </Button>
          </Link>
          <Button variant="outline" size="sm" disabled={!filteredRiskRows.length} onClick={() => downloadCsv(`classification-lab-risky.csv`, filteredRiskRows)} className="border-zinc-700 text-zinc-300">
            <FileSpreadsheet className="ml-2 h-4 w-4" />تصدير الخطر
          </Button>
          <Button variant="outline" size="sm" disabled={exporting} onClick={exportNeedsReview} className="border-zinc-700 text-zinc-300">
            {exporting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="ml-2 h-4 w-4" />}
            تصدير المراجعة
          </Button>
          <Button variant="outline" size="sm" disabled={!riskPageRows.length} onClick={() => downloadCsv(`classification-lab-visible.csv`, riskPageRows)} className="border-zinc-700 text-zinc-300">
            <FileSpreadsheet className="ml-2 h-4 w-4" />تصدير الظاهر
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="border-zinc-700 text-zinc-300">
            <RefreshCw className={cn('ml-2 h-4 w-4', loading && 'animate-spin')} />تحديث
          </Button>
        </div>
      </PageHeader>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-400">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}><X className="h-4 w-4" /></Button>
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-zinc-400">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">نطاق المراجعة</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border-zinc-700 bg-zinc-900 text-white" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border-zinc-700 bg-zinc-900 text-white" />
          <Select value={String(fetchLimit)} onValueChange={(v) => setFetchLimit(parseInt(v, 10))}>
            <SelectTrigger className="border-zinc-700 bg-zinc-900 text-white"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {FETCH_LIMIT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-white">دفعة {n} صف</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={loadData} className="bg-amber-500 text-black hover:bg-amber-600">تطبيق</Button>
          <Button variant="outline" onClick={() => { setDateFrom(''); setDateTo(''); }} className="border-zinc-700 text-zinc-300">مسح</Button>
        </div>
        {meta && (
          <p className="mt-2 text-xs text-zinc-500">
            {meta.totalMatchingRows.toLocaleString('ar-EG')} حركة مطابقة
            {rowsPartial && ` · تحليل الصفوف على ${analysisRows.length.toLocaleString('ar-EG')} صف (عينة)`}
          </p>
        )}
      </div>

      {loading && !summary ? (
        <div className="flex justify-center py-20 text-zinc-400">
          <Loader2 className="ml-2 h-6 w-6 animate-spin" />جاري التحميل...
        </div>
      ) : summary && readiness && kpis ? (
        <div className="space-y-6">
          {/* Readiness */}
          <div className={cn('rounded-xl border p-5', readinessColor)}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Beaker className={cn('h-8 w-8', readinessTextColor)} />
                <div>
                  <p className="text-xs text-zinc-500">جاهزية TblCashMoveClassification</p>
                  <p className={cn('text-2xl font-bold', readinessTextColor)}>{readiness.statusLabel}</p>
                </div>
              </div>
              <div className="text-left">
                <p className={cn('text-4xl font-bold tabular-nums', readinessTextColor)}>{readiness.score}</p>
                <p className="text-xs text-zinc-500">من 100</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <span className="text-zinc-400">مراجعة: −{readiness.deductions.needsReviewPct.toFixed(1)}%</span>
              <span className="text-zinc-400">ثقة منخفضة: −{readiness.deductions.lowConfidencePct.toFixed(1)}%</span>
              <span className="text-zinc-400">غير مصنف: −{readiness.deductions.unclassifiedPct.toFixed(1)}%</span>
              <span className="text-zinc-400">مرتب بدون موظف: −{readiness.deductions.payrollMissingEmployeePct.toFixed(1)}%</span>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard title="إجمالي الصفوف" value={kpis.totalRows.toLocaleString('ar-EG')} variant="info" icon={<BarChart3 className="h-5 w-5" />} />
            <KpiCard title="إجمالي المبلغ" value={`${formatMoney(kpis.totalAmount)} ج.م`} variant="primary" />
            <KpiCard title="يحتاج مراجعة" value={kpis.needsReviewCount} subtitle={`${kpis.needsReviewPct.toFixed(1)}%`} variant="warning" icon={<AlertTriangle className="h-5 w-5" />} />
            <KpiCard title="ثقة منخفضة" value={kpis.lowConfidenceCount} variant="danger" />
            <KpiCard title="غير مصنف" value={kpis.unclassifiedCount} variant="danger" />
            <KpiCard title="مرتب بدون موظف" value={kpis.payrollMissingEmployeeCount} variant="warning" icon={<Users className="h-5 w-5" />} />
            <KpiCard title="تحويلات داخلية" value={`${formatMoney(kpis.internalTransfersTotal)}`} variant="default" />
            <KpiCard title="يؤثر على الأرباح" value={`${formatMoney(kpis.pnlImpactingAmount)}`} variant="success" />
            <KpiCard title="حركة نقدية فقط" value={`${formatMoney(kpis.nonPnlAmount)}`} variant="default" />
          </div>

          {/* Buckets */}
          <section>
            <h2 className="mb-3 text-sm font-medium text-zinc-400">سلال التصنيف المحاسبي</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {buckets.map((b) => (
                <BucketCard key={b.key} bucket={b} />
              ))}
            </div>
          </section>

          {/* PnL Simulation */}
          <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4">
            <h2 className="mb-1 text-sm font-medium text-zinc-300">محاكاة الأثر على الأرباح</h2>
            <p className="mb-4 text-xs text-zinc-500">ليس كل وارد نقدي = إيراد · وليس كل صادر نقدي = مصروف</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              {[
                { label: 'وارد نقدي', value: pnlSim.cashIn, icon: ArrowDownLeft, color: 'text-emerald-400' },
                { label: 'صادر نقدي', value: pnlSim.cashOut, icon: ArrowUpRight, color: 'text-rose-400' },
                { label: 'إيراد محاسبي', value: pnlSim.revenue, color: 'text-emerald-300' },
                { label: 'مصروف محاسبي', value: pnlSim.expense, color: 'text-rose-300' },
                { label: 'مصروف معاكس', value: pnlSim.contraExpense, color: 'text-amber-300' },
                { label: 'بدون أثر أرباح', value: pnlSim.noPnlImpact, color: 'text-zinc-400' },
                { label: 'غير معروف', value: pnlSim.unknown, color: 'text-rose-400' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-zinc-950/50 p-3 text-center">
                  <p className="text-[10px] text-zinc-500">{item.label}</p>
                  <p className={cn('mt-1 text-sm font-semibold tabular-nums', item.color)}>
                    {formatMoney(item.value)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Risk Queue */}
          <section className="rounded-xl border border-rose-500/10 bg-zinc-900/30 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-rose-300">قائمة المخاطر ({riskyRows.length})</h2>
              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-500">انقر صفاً للتفاصيل</Badge>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-6">
              <Select value={riskTypeFilter} onValueChange={(v) => { setRiskTypeFilter(v); setRiskPage(1); }}>
                <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs text-white"><SelectValue placeholder="نوع الخطر" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">كل المخاطر</SelectItem>
                  {(Object.keys(RISK_TYPE_LABELS) as RiskType[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-white">{RISK_TYPE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={flowGroupFilter} onValueChange={(v) => { setFlowGroupFilter(v); setRiskPage(1); }}>
                <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs text-white"><SelectValue placeholder="Flow Group" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">الكل</SelectItem>
                  {flowGroupOptions.map((g) => <SelectItem key={g} value={g} className="text-white font-mono">{g}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={flowKindFilter} onValueChange={(v) => { setFlowKindFilter(v); setRiskPage(1); }}>
                <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs text-white"><SelectValue placeholder="Flow Kind" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">الكل</SelectItem>
                  {flowKindOptions.map((k) => <SelectItem key={k} value={k} className="text-white font-mono">{k}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={pnlFilter} onValueChange={(v) => { setPnlFilter(v); setRiskPage(1); }}>
                <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs text-white"><SelectValue placeholder="PnL" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">الكل</SelectItem>
                  {(['revenue', 'expense', 'contra_expense', 'none'] as PnlImpact[]).map((p) => (
                    <SelectItem key={p} value={p} className="text-white">{PNL_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={confidenceFilter} onValueChange={(v) => { setConfidenceFilter(v); setRiskPage(1); }}>
                <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs text-white"><SelectValue placeholder="الثقة" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">الكل</SelectItem>
                  <SelectItem value="high" className="text-white">مرتفع</SelectItem>
                  <SelectItem value="medium" className="text-white">متوسط</SelectItem>
                  <SelectItem value="low" className="text-white">منخفض</SelectItem>
                </SelectContent>
              </Select>
              <Select value={employeeFilter} onValueChange={(v) => { setEmployeeFilter(v); setRiskPage(1); }}>
                <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs text-white"><SelectValue placeholder="الموظف" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">الكل</SelectItem>
                  <SelectItem value="has" className="text-white">له موظف</SelectItem>
                  <SelectItem value="missing" className="text-white">بدون موظف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="overflow-x-auto rounded-lg border border-zinc-800/50">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    {['التاريخ', 'المبلغ', 'اتجاه', 'نوع', 'فئة', 'ملاحظات', 'Group', 'Kind', 'PnL', 'موظف', 'مصدر', 'ثقة', 'سبب'].map((h) => (
                      <TableHead key={h} className="whitespace-nowrap text-zinc-500 text-[11px]">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {riskPageRows.length === 0 ? (
                    <TableRow><TableCell colSpan={13} className="py-10 text-center text-zinc-500">لا صفوف خطرة مطابقة</TableCell></TableRow>
                  ) : riskPageRows.map((row) => (
                    <TableRow
                      key={row.cashMoveId}
                      className="cursor-pointer border-zinc-800/80 bg-rose-500/5 hover:bg-rose-500/10"
                      onClick={() => setSelectedRow(row)}
                    >
                      <TableCell className="text-xs">{row.invDate}</TableCell>
                      <TableCell className="font-mono text-xs">{formatMoney(row.amount)}</TableCell>
                      <TableCell className="text-xs">{row.inOut === 'in' ? 'وارد' : 'صادر'}</TableCell>
                      <TableCell className="max-w-[80px] truncate text-xs">{row.invType}</TableCell>
                      <TableCell className="max-w-[90px] truncate text-xs">{row.categoryName || '—'}</TableCell>
                      <TableCell className="max-w-[100px] truncate text-xs text-zinc-500">{row.notes || '—'}</TableCell>
                      <TableCell><FlowBadge value={row.suggestedFlowGroup} /></TableCell>
                      <TableCell><FlowBadge value={row.suggestedFlowKind} variant="kind" /></TableCell>
                      <TableCell className="text-xs">{PNL_LABELS[row.suggestedPnlImpact]}</TableCell>
                      <TableCell className="font-mono text-xs">{row.suggestedEmpId ? `#${row.suggestedEmpId}` : '—'}</TableCell>
                      <TableCell className="font-mono text-[10px] text-cyan-400">{row.matchedRuleSource}</TableCell>
                      <TableCell><ConfidenceBadge c={row.confidence} /></TableCell>
                      <TableCell className="max-w-[140px] truncate text-[10px] text-zinc-400">{row.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>{filteredRiskRows.length} صف خطر · صفحة {riskPage}/{riskTotalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={riskPage <= 1} onClick={() => setRiskPage((p) => p - 1)} className="h-7 border-zinc-700"><ChevronRight className="h-3 w-3" /></Button>
                <Button size="sm" variant="outline" disabled={riskPage >= riskTotalPages} onClick={() => setRiskPage((p) => p + 1)} className="h-7 border-zinc-700"><ChevronLeft className="h-3 w-3" /></Button>
              </div>
            </div>
          </section>

          {/* Employee Payroll */}
          <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-300">مراجعة حركات الموظفين</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {employeeGroups.length === 0 ? (
                <p className="text-sm text-zinc-500">لا حركات مرتبات/سلف في العينة</p>
              ) : employeeGroups.map((g) => (
                <div
                  key={g.empId ?? '__missing__'}
                  className={cn(
                    'rounded-lg border p-3',
                    g.empId == null ? 'border-rose-500/30 bg-rose-500/5' : 'border-zinc-700/50 bg-zinc-950/40',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-medium text-zinc-200">{g.empLabel}</p>
                    {g.empId == null && <Badge variant="outline" className="text-[10px] text-rose-400">بدون ربط</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400">
                    <span>سلف: {g.advances.count} ({formatMoney(g.advances.amount)})</span>
                    <span>مرتب: {g.salaryPayouts.count} ({formatMoney(g.salaryPayouts.amount)})</span>
                    <span>عمولة/بونص: {g.bonusCommission.count} ({formatMoney(g.bonusCommission.amount)})</span>
                    <span>خصومات: {g.deductions.count} ({formatMoney(g.deductions.amount)})</span>
                    {g.missingEmployee.count > 0 && (
                      <span className="col-span-2 text-rose-400">بدون موظف: {g.missingEmployee.count}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <DetailDrawer row={selectedRow} open={!!selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
