'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Tags,
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
import { cn } from '@/lib/utils';
import type {
  CashMoveClassification,
  ClassificationAuditSummary,
  ClassificationConfidence,
  LinkedPayrollTxn,
  PnlImpact,
} from '@/lib/accounting/cashMoveClassification';
import type { CashMoveClassificationAuditMeta } from '@/lib/accounting/cashMoveClassificationAudit';

interface AuditResponse {
  params: { dateFrom?: string; dateTo?: string; limit: number; offset: number };
  totalMatchingRows: number;
  rows: CashMoveClassification[];
  summary: ClassificationAuditSummary;
  needsReviewRows?: CashMoveClassification[];
  meta: CashMoveClassificationAuditMeta;
}

const LIMIT_OPTIONS = [50, 100, 200, 500, 1000];

const CONFIDENCE_LABELS: Record<ClassificationConfidence, string> = {
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
};

const PNL_LABELS: Record<PnlImpact, string> = {
  revenue: 'إيراد',
  expense: 'مصروف',
  contra_expense: 'مصروف معاكس',
  none: 'بدون أثر',
};

const CSV_HEADERS = [
  'cashMoveId',
  'invDate',
  'amount',
  'inOut',
  'invType',
  'categoryName',
  'notes',
  'linkedPayrollTxn',
  'suggestedFlowGroup',
  'suggestedFlowKind',
  'suggestedPnlImpact',
  'suggestedPartyType',
  'suggestedEmpId',
  'confidence',
  'needsReview',
  'reason',
  'matchedRuleSource',
  'matchedRuleId',
  'matchedKeyword',
  'fromAdminMapping',
];

function formatMoney(value: number): string {
  return value.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function bucketCount(summary: ClassificationAuditSummary, group: keyof ClassificationAuditSummary, key: string): number {
  const buckets = summary[group];
  if (!Array.isArray(buckets)) return 0;
  return buckets.find((b) => b.key === key)?.count ?? 0;
}

function summaryTotalAmount(summary: ClassificationAuditSummary): number {
  return summary.byFlowGroup.reduce((sum, b) => sum + b.totalAmount, 0);
}

function formatLinkedPayroll(txn: LinkedPayrollTxn | null): string {
  if (!txn) return '';
  const name = txn.empName ? ` · ${txn.empName}` : '';
  const type = txn.txnType ? ` (${txn.txnType})` : '';
  return `${txn.source} #${txn.id}${name}${type}`;
}

function rowToCsvCells(row: CashMoveClassification): string[] {
  return [
    String(row.cashMoveId),
    row.invDate,
    String(row.amount),
    row.inOut,
    row.invType,
    row.categoryName ?? '',
    row.notes ?? '',
    formatLinkedPayroll(row.linkedPayrollTxn),
    row.suggestedFlowGroup,
    row.suggestedFlowKind,
    row.suggestedPnlImpact,
    row.suggestedPartyType,
    row.suggestedEmpId != null ? String(row.suggestedEmpId) : '',
    row.confidence,
    row.needsReview ? 'true' : 'false',
    row.reason,
    row.matchedRuleSource,
    row.matchedRuleId != null ? String(row.matchedRuleId) : '',
    row.matchedKeyword ?? '',
    row.fromAdminMapping ? 'true' : 'false',
  ];
}

function downloadCsv(filename: string, rows: CashMoveClassification[]) {
  const csv = [
    CSV_HEADERS.join(','),
    ...rows.map((row) =>
      rowToCsvCells(row)
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ConfidenceBadge({ confidence }: { confidence: ClassificationConfidence }) {
  const styles: Record<ClassificationConfidence, string> = {
    high: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    low: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };
  return (
    <Badge variant="outline" className={cn('text-xs whitespace-nowrap', styles[confidence])}>
      {CONFIDENCE_LABELS[confidence]}
    </Badge>
  );
}

function InOutBadge({ inOut }: { inOut: string }) {
  const isIn = inOut === 'in';
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs font-medium',
        isIn ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
      )}
    >
      {isIn ? 'وارد' : 'صادر'}
    </Badge>
  );
}

function formatLinkedPayrollDisplay(txn: LinkedPayrollTxn | null): string {
  if (!txn) return '—';
  return formatLinkedPayroll(txn) || '—';
}

function isRevenueOrExpenseInvType(invType: string): boolean {
  const t = invType.trim();
  return t === 'مصروفات' || t === 'ايرادات';
}

function isRiskyRow(row: CashMoveClassification): boolean {
  if (row.confidence === 'low') return true;
  if (row.needsReview) return true;
  if (
    (row.suggestedFlowGroup === 'payroll' || row.suggestedFlowGroup === 'employee_advance') &&
    !row.suggestedEmpId
  ) {
    return true;
  }
  if (
    isRevenueOrExpenseInvType(row.invType) &&
    (row.suggestedFlowGroup === 'unclassified' || row.suggestedFlowKind === 'unknown')
  ) {
    return true;
  }
  return false;
}

function riskReasons(row: CashMoveClassification): string[] {
  const reasons: string[] = [];
  if (row.confidence === 'low') reasons.push('ثقة منخفضة');
  if (row.needsReview) reasons.push('يحتاج مراجعة');
  if (
    (row.suggestedFlowGroup === 'payroll' || row.suggestedFlowGroup === 'employee_advance') &&
    !row.suggestedEmpId
  ) {
    reasons.push('مرتبط بالمرتبات بدون موظف');
  }
  if (
    isRevenueOrExpenseInvType(row.invType) &&
    (row.suggestedFlowGroup === 'unclassified' || row.suggestedFlowKind === 'unknown')
  ) {
    reasons.push('إيراد/مصروف غير مصنف');
  }
  return reasons;
}

function SummaryBucketList({
  title,
  buckets,
  icon,
}: {
  title: string;
  buckets: ClassificationAuditSummary['byFlowGroup'];
  icon: ReactNode;
}) {
  if (!buckets.length) {
    return (
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-zinc-400">
          {icon}
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        <p className="text-xs text-zinc-500">لا توجد بيانات مطابقة</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-zinc-400">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
        {buckets.map((bucket) => (
          <div
            key={bucket.key}
            className="flex items-center justify-between gap-2 rounded-lg bg-zinc-950/50 px-3 py-2 text-xs"
          >
            <span className="font-mono text-zinc-300 truncate">{bucket.key}</span>
            <div className="flex shrink-0 items-center gap-3 text-zinc-500">
              <span>{bucket.count} صف</span>
              <span className="text-zinc-300">{formatMoney(bucket.totalAmount)} ج.م</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CashMoveClassificationAuditPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(200);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exportingNeedsReview, setExportingNeedsReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);

  const [filterConfidence, setFilterConfidence] = useState<string>('all');
  const [filterNeedsReview, setFilterNeedsReview] = useState<string>('all');
  const [filterFlowGroup, setFilterFlowGroup] = useState<string>('all');
  const [filterFlowKind, setFilterFlowKind] = useState<string>('all');
  const [riskyOnly, setRiskyOnly] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String((page - 1) * limit));
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const response = await fetch(
        `/api/admin/audit/cash-move-classification?${params.toString()}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشل في تحميل بيانات التدقيق');
      setAudit(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, limit, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const globalStats = useMemo(() => {
    if (!audit) return null;
    const { summary } = audit;
    const needsReviewCount = bucketCount(summary, 'byNeedsReview', 'true');
    const totalRows = summary.totalRows || audit.meta.totalMatchingRows;
    return {
      totalAmount: summaryTotalAmount(summary),
      totalRows,
      needsReviewCount,
      needsReviewPct: totalRows ? (needsReviewCount / totalRows) * 100 : 0,
      confidenceCounts: {
        high: bucketCount(summary, 'byConfidence', 'high'),
        medium: bucketCount(summary, 'byConfidence', 'medium'),
        low: bucketCount(summary, 'byConfidence', 'low'),
      },
    };
  }, [audit]);

  const flowGroupOptions = useMemo(() => {
    const keys = new Set<string>();
    audit?.summary.byFlowGroup.forEach((b) => keys.add(b.key));
    audit?.rows.forEach((r) => keys.add(r.suggestedFlowGroup));
    return [...keys].sort();
  }, [audit]);

  const flowKindOptions = useMemo(() => {
    const keys = new Set<string>();
    audit?.summary.byFlowKind.forEach((b) => keys.add(b.key));
    audit?.rows.forEach((r) => keys.add(r.suggestedFlowKind));
    return [...keys].sort();
  }, [audit]);

  const filteredRows = useMemo(() => {
    if (!audit) return [];
    return audit.rows.filter((row) => {
      if (filterConfidence !== 'all' && row.confidence !== filterConfidence) return false;
      if (filterNeedsReview === 'yes' && !row.needsReview) return false;
      if (filterNeedsReview === 'no' && row.needsReview) return false;
      if (filterFlowGroup !== 'all' && row.suggestedFlowGroup !== filterFlowGroup) return false;
      if (filterFlowKind !== 'all' && row.suggestedFlowKind !== filterFlowKind) return false;
      if (riskyOnly && !isRiskyRow(row)) return false;
      return true;
    });
  }, [audit, filterConfidence, filterNeedsReview, filterFlowGroup, filterFlowKind, riskyOnly]);

  const pageRiskyCount = useMemo(
    () => audit?.rows.filter(isRiskyRow).length ?? 0,
    [audit?.rows],
  );

  const totalPages = audit
    ? Math.max(1, Math.ceil(audit.meta.totalMatchingRows / limit))
    : 1;

  const resetFilters = () => {
    setFilterConfidence('all');
    setFilterNeedsReview('all');
    setFilterFlowGroup('all');
    setFilterFlowKind('all');
    setRiskyOnly(false);
  };

  const applyDateFilters = () => {
    setPage(1);
    loadData();
  };

  const exportVisibleCsv = () => {
    if (!filteredRows.length) return;
    const stamp = new Date().toISOString().split('T')[0];
    downloadCsv(`cash-move-audit-visible-${stamp}.csv`, filteredRows);
  };

  const exportNeedsReviewCsv = async () => {
    setExportingNeedsReview(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('includeNeedsReviewRows', 'true');
      params.set('limit', '1');
      params.set('offset', '0');
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const response = await fetch(
        `/api/admin/audit/cash-move-classification?${params.toString()}`,
      );
      const data: AuditResponse = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || 'فشل التصدير');

      const rows = data.needsReviewRows ?? [];
      if (!rows.length) {
        setError('لا توجد صفوف تحتاج مراجعة في النطاق المحدد');
        return;
      }

      const stamp = new Date().toISOString().split('T')[0];
      downloadCsv(`cash-move-audit-needs-review-${stamp}.csv`, rows);

      if (data.meta.needsReviewRowsCapped) {
        setError(
          `تم تصدير أول ${data.meta.needsReviewRowsReturned?.toLocaleString('ar-EG')} صف فقط (الحد الأقصى). ضيّق نطاق التاريخ إن لزم.`,
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'فشل تصدير صفوف المراجعة');
    } finally {
      setExportingNeedsReview(false);
    }
  };

  const dateRangeLabel = audit
    ? [audit.params.dateFrom || 'البداية', audit.params.dateTo || 'اليوم'].join(' → ')
    : '';

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-6" dir="rtl">
      <PageHeader
        title="تدقيق تصنيف حركات الخزنة"
        description="مراجعة قراءة فقط لتصنيف TblCashMove — لا يتم تعديل أي بيانات"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-xs">
            قراءة فقط
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={exportVisibleCsv}
            disabled={!filteredRows.length}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <FileSpreadsheet className="w-4 h-4 ml-2" />
            تصدير الصفوف الظاهرة
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportNeedsReviewCsv}
            disabled={exportingNeedsReview || loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            {exportingNeedsReview ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 ml-2" />
            )}
            تصدير يحتاج مراجعة (الكل)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={cn('w-4 h-4 ml-2', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </PageHeader>

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-400" />
          <p className="text-sm text-rose-400">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError(null)}
            className="mr-auto text-rose-400"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
        <div className="mb-4 flex items-center gap-2 text-zinc-400">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">نطاق البيانات</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white"
          />
          <Select
            value={String(limit)}
            onValueChange={(v) => {
              setLimit(parseInt(v, 10));
              setPage(1);
            }}
          >
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
              <SelectValue placeholder="عدد الصفوف" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {LIMIT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-white">
                  {n} صف / صفحة
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={applyDateFilters} className="bg-amber-500 text-black hover:bg-amber-600">
            تطبيق
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setPage(1);
            }}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            مسح التواريخ
          </Button>
        </div>
        {audit && (
          <p className="mt-3 text-xs text-zinc-500">
            {audit.meta.totalMatchingRows.toLocaleString('ar-EG')} حركة مطابقة
            {audit.meta.hasTblEmpPayrollTxn ? ' · TblEmpPayrollTxn متاح' : ' · TblEmpPayrollTxn غير موجود'}
          </p>
        )}
      </div>

      {loading && !audit ? (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Loader2 className="ml-2 h-6 w-6 animate-spin" />
          جاري تحميل التدقيق...
        </div>
      ) : audit && globalStats ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-amber-300 text-xs">
              ملخص لكل الصفوف المطابقة
            </Badge>
            <span className="text-xs text-zinc-500">{dateRangeLabel}</span>
            {loading && <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="إجمالي المبلغ"
              value={`${formatMoney(globalStats.totalAmount)} ج.م`}
              subtitle={`ملخص لكل ${globalStats.totalRows.toLocaleString('ar-EG')} صف مطابق`}
              icon={<BarChart3 className="h-5 w-5" />}
              variant="primary"
            />
            <KpiCard
              title="إجمالي الصفوف"
              value={globalStats.totalRows.toLocaleString('ar-EG')}
              subtitle="كل الصفوف المطابقة في النطاق"
              icon={<Layers className="h-5 w-5" />}
              variant="info"
            />
            <KpiCard
              title="يحتاج مراجعة"
              value={globalStats.needsReviewCount.toLocaleString('ar-EG')}
              subtitle={`${globalStats.needsReviewPct.toFixed(1)}% من كل الصفوف المطابقة`}
              icon={<AlertTriangle className="h-5 w-5" />}
              variant="warning"
            />
            <KpiCard
              title="الثقة (كل المطابق)"
              value={`${globalStats.confidenceCounts.high} / ${globalStats.confidenceCounts.medium} / ${globalStats.confidenceCounts.low}`}
              subtitle="مرتفع · متوسط · منخفض"
              icon={<Tags className="h-5 w-5" />}
              variant="danger"
            />
          </div>

          <div className="mb-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              تجميعات الملخص — لكل الصفوف المطابقة
            </p>
          </div>
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SummaryBucketList
              title="suggestedFlowGroup"
              buckets={audit.summary.byFlowGroup}
              icon={<Layers className="h-4 w-4" />}
            />
            <SummaryBucketList
              title="suggestedFlowKind"
              buckets={audit.summary.byFlowKind}
              icon={<Tags className="h-4 w-4" />}
            />
            <SummaryBucketList
              title="suggestedPnlImpact"
              buckets={audit.summary.byPnlImpact}
              icon={<BarChart3 className="h-4 w-4" />}
            />
          </div>

          <div className="mb-4 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-zinc-400">
              <Filter className="h-4 w-4" />
              <span className="text-sm font-medium">فلاتر الجدول</span>
              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-500">
                paginated · {audit.meta.returnedRows} صف في الصفحة {page}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="mr-auto text-xs text-zinc-500"
              >
                إعادة ضبط
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Select value={filterConfidence} onValueChange={setFilterConfidence}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue placeholder="الثقة" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">كل مستويات الثقة</SelectItem>
                  <SelectItem value="high" className="text-white">مرتفع</SelectItem>
                  <SelectItem value="medium" className="text-white">متوسط</SelectItem>
                  <SelectItem value="low" className="text-white">منخفض</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterNeedsReview} onValueChange={setFilterNeedsReview}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue placeholder="المراجعة" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">الكل</SelectItem>
                  <SelectItem value="yes" className="text-white">يحتاج مراجعة</SelectItem>
                  <SelectItem value="no" className="text-white">لا يحتاج مراجعة</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterFlowGroup} onValueChange={setFilterFlowGroup}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue placeholder="Flow Group" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">كل المجموعات</SelectItem>
                  {flowGroupOptions.map((key) => (
                    <SelectItem key={key} value={key} className="text-white font-mono text-xs">
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterFlowKind} onValueChange={setFilterFlowKind}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue placeholder="Flow Kind" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="all" className="text-white">كل الأنواع</SelectItem>
                  {flowKindOptions.map((key) => (
                    <SelectItem key={key} value={key} className="text-white font-mono text-xs">
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={riskyOnly ? 'default' : 'outline'}
                onClick={() => setRiskyOnly((v) => !v)}
                className={cn(
                  riskyOnly
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800',
                )}
              >
                <AlertTriangle className="ml-2 h-4 w-4" />
                الصفوف الخطرة ({pageRiskyCount})
              </Button>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              عرض {filteredRows.length} من {audit.meta.returnedRows} صف في الصفحة الحالية
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800/50 bg-zinc-900/30">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400 whitespace-nowrap">التاريخ</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">المبلغ</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">الاتجاه</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">النوع</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">الفئة</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap min-w-[140px]">ملاحظات</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap min-w-[160px]">مرتبط بالمرتبات</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">Flow Group</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">Flow Kind</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">أثر الأرباح</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">الطرف</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">موظف</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">الثقة</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap">مراجعة</TableHead>
                    <TableHead className="text-zinc-400 whitespace-nowrap min-w-[200px]">السبب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={15} className="py-12 text-center text-zinc-500">
                        لا توجد صفوف مطابقة للفلاتر
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((row) => {
                      const risky = isRiskyRow(row);
                      const risks = riskReasons(row);
                      return (
                        <TableRow
                          key={row.cashMoveId}
                          className={cn(
                            'border-zinc-800/80',
                            risky
                              ? 'bg-rose-500/5 hover:bg-rose-500/10'
                              : 'hover:bg-zinc-800/30',
                          )}
                        >
                          <TableCell className="whitespace-nowrap text-zinc-300 text-xs">
                            {row.invDate}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-sm text-white">
                            {formatMoney(row.amount)}
                          </TableCell>
                          <TableCell>
                            <InOutBadge inOut={row.inOut} />
                          </TableCell>
                          <TableCell className="text-xs text-zinc-300 max-w-[100px] truncate">
                            {row.invType}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-400 max-w-[120px] truncate">
                            {row.categoryName || '—'}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-500 max-w-[160px] truncate" title={row.notes ?? ''}>
                            {row.notes || '—'}
                          </TableCell>
                          <TableCell className="text-[11px] text-zinc-400 max-w-[180px] truncate" title={formatLinkedPayrollDisplay(row.linkedPayrollTxn)}>
                            {formatLinkedPayrollDisplay(row.linkedPayrollTxn)}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-cyan-400">{row.suggestedFlowGroup}</span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-violet-400">{row.suggestedFlowKind}</span>
                          </TableCell>
                          <TableCell className="text-xs text-zinc-300">
                            {PNL_LABELS[row.suggestedPnlImpact] ?? row.suggestedPnlImpact}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-400">{row.suggestedPartyType}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.suggestedEmpId ? (
                              <span className="text-emerald-400">#{row.suggestedEmpId}</span>
                            ) : (
                              <span className="text-rose-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <ConfidenceBadge confidence={row.confidence} />
                          </TableCell>
                          <TableCell>
                            {row.needsReview ? (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
                                نعم
                              </Badge>
                            ) : (
                              <span className="text-xs text-zinc-600">لا</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-400 max-w-[220px]">
                            <div className="space-y-1">
                              <p className="line-clamp-2" title={row.reason}>{row.reason}</p>
                              {risks.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {risks.map((r) => (
                                    <Badge
                                      key={r}
                                      variant="outline"
                                      className="border-rose-500/20 bg-rose-500/10 text-[10px] text-rose-400"
                                    >
                                      {r}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              جدول paginated · صفحة {page} من {totalPages} · offset {audit.meta.offset}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="border-zinc-700 text-zinc-300"
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="border-zinc-700 text-zinc-300"
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
