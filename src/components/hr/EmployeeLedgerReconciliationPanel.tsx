'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Scale, Loader2, AlertCircle, RefreshCw, CheckCircle2, AlertTriangle, Search,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { EmployeeLedgerReconciliationResponse, UnresolvedCashAdvanceRow } from '@/lib/types/employee-ledger-reconciliation';
import type { EmployeeLedgerWageSourceAuditResponse } from '@/lib/types/employee-ledger-wage-source-audit';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
}

const DEFAULT_VOID_REASON = 'تصنيف غير تابع لموظف — تم استبعاده من دفتر الموظفين';

function boolLabel(value: boolean): string {
  return value ? 'نعم' : 'لا';
}

function advanceIssueLabel(reason: string): string {
  switch (reason) {
    case 'missing_employee_mapping':
      return 'ربط تصنيف غير واضح — راجع ربط التصنيف بالموظف';
    case 'no_emp_id':
      return 'لا يوجد موظف مرتبط بالتصنيف';
    case 'ledger_entry_missing':
      return 'لا يوجد قيد دفتر';
    case 'amount_mismatch':
      return 'مبلغ الدفتر يختلف عن الخزنة';
    case 'orphan_ledger_debit':
      return 'قيد دفتر بدون حركة خزنة مطابقة';
    case 'unexplained_difference':
      return 'فرق غير مفسَّر';
    default:
      return 'سبب غير معروف';
  }
}

function diffClass(diff: number): string {
  if (Math.abs(diff) < 0.01) return 'text-emerald-400';
  return 'text-amber-400';
}

function SectionTable({
  title,
  emptyText,
  headers,
  children,
}: {
  title: string;
  emptyText: string;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
        <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 text-right font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">{children}</tbody>
        </table>
        {!children && (
          <p className="px-4 py-8 text-center text-zinc-500 text-sm">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

export default function EmployeeLedgerReconciliationPanel() {
  const [month, setMonth] = useState(currentMonthStr);
  const [empId, setEmpId] = useState('all');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [data, setData] = useState<EmployeeLedgerReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncMonth, setSyncMonth] = useState(currentMonthStr);
  const [syncEmpId, setSyncEmpId] = useState('all');
  const [syncPayrollCredits, setSyncPayrollCredits] = useState(true);
  const [syncAdvanceDebits, setSyncAdvanceDebits] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncPreview, setSyncPreview] = useState<{
    counts: Record<string, number>;
    previewRows: Array<{ source: string; refId: number; action: string; amount: number }>;
  } | null>(null);
  const [syncError, setSyncError] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditData, setAuditData] = useState<EmployeeLedgerWageSourceAuditResponse | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingRow, setMappingRow] = useState<UnresolvedCashAdvanceRow | null>(null);
  const [mappingEmpId, setMappingEmpId] = useState('');
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingError, setMappingError] = useState('');
  const [mappingSuccess, setMappingSuccess] = useState('');
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidEntryId, setVoidEntryId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState(DEFAULT_VOID_REASON);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState('');

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees');
      const json = await res.json();
      if (!res.ok) return;
      setEmployees(
        Array.isArray(json)
          ? json.map((e: { EmpID: number; EmpName: string }) => ({
              EmpID: e.EmpID,
              EmpName: e.EmpName,
            }))
          : [],
      );
    } catch {
      /* optional */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month });
      if (empId !== 'all') params.set('empId', empId);
      const res = await fetch(`/api/admin/hr/employee-ledger/reconciliation?${params}`);
      const json: EmployeeLedgerReconciliationResponse & { error?: string } = await res.json();
      if (!res.ok && res.status !== 503) {
        throw new Error(json.error || 'خطأ في تحميل المراجعة');
      }
      setData(json);
      if (json.error) setError(json.error);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل المراجعة');
    } finally {
      setLoading(false);
    }
  }, [month, empId]);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => { void load(); }, [load]);

  const s = data?.summary;
  const healthy = s && s.issueCount === 0;
  const advanceDiffWarning = s && Math.abs(s.advanceLedgerDiff) >= 0.01;

  const openSyncModal = () => {
    setSyncMonth(month);
    setSyncEmpId(empId);
    setSyncPayrollCredits(true);
    setSyncAdvanceDebits(true);
    setSyncPreview(null);
    setSyncError('');
    setSyncOpen(true);
  };

  const runSync = async (dryRun: boolean) => {
    setSyncBusy(true);
    setSyncError('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: syncMonth,
          empId: syncEmpId === 'all' ? undefined : Number(syncEmpId),
          dryRun,
          syncPayrollCredits,
          syncAdvanceDebits,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'فشل تشغيل مزامنة الدفتر');
      }
      if (dryRun) {
        setSyncPreview({
          counts: json.counts ?? {},
          previewRows: (json.previewRows ?? []).slice(0, 8),
        });
      } else {
        setSyncPreview({
          counts: json.counts ?? {},
          previewRows: [],
        });
        await load();
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'فشل تشغيل مزامنة الدفتر');
    } finally {
      setSyncBusy(false);
    }
  };

  const applySync = async () => {
    await runSync(false);
    setSyncOpen(false);
  };

  const openWageAudit = async () => {
    setAuditOpen(true);
    setAuditLoading(true);
    setAuditError('');
    setAuditData(null);
    try {
      const params = new URLSearchParams({ month });
      if (empId !== 'all') params.set('empId', empId);
      const res = await fetch(`/api/admin/hr/employee-ledger/wage-source-audit?${params}`);
      const json: EmployeeLedgerWageSourceAuditResponse & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'فشل فحص مصدر اليوميات');
      }
      setAuditData(json);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : 'فشل فحص مصدر اليوميات');
    } finally {
      setAuditLoading(false);
    }
  };

  const suggestedSourceLabel = (source: EmployeeLedgerWageSourceAuditResponse['suggestedSource']) => {
    if (source === 'TblEmpDailyPayroll') return 'TblEmpDailyPayroll — يوميات مُولَّدة';
    if (source === 'LegacyCashMove') return 'LegacyCashMove — حركات خزنة قديمة';
    return 'NoneFound — لم يُعثر على مصدر';
  };

  const openMappingModal = (row: UnresolvedCashAdvanceRow) => {
    const suggested = row.suggestedEmployeeMatches[0];
    setMappingRow(row);
    setMappingEmpId(
      suggested ? String(suggested.empId)
        : row.cashEmpId ? String(row.cashEmpId)
          : row.mapEmpId ? String(row.mapEmpId) : '',
    );
    setMappingError('');
    setMappingSuccess('');
    setMappingOpen(true);
  };

  const submitAdvanceMapping = async () => {
    if (!mappingRow) return;
    if (!mappingEmpId) {
      setMappingError('اختر موظفاً');
      return;
    }
    setMappingBusy(true);
    setMappingError('');
    setMappingSuccess('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/reconciliation/fix-advance-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expInId: mappingRow.expInId,
          empId: Number(mappingEmpId),
          txnKind: 'advance',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'فشل ربط التصنيف');
      }
      setMappingSuccess(
        `تم ربط التصنيف «${json.categoryName}» بالموظف «${json.empName}». شغّل مزامنة السلف لإنشاء قيد الدفتر.`,
      );
      setSyncMonth(month);
      setSyncEmpId(empId);
      setSyncPayrollCredits(false);
      setSyncAdvanceDebits(true);
      setSyncPreview(null);
      setSyncError('');
      const previewRes = await fetch('/api/admin/hr/employee-ledger/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          empId: empId === 'all' ? undefined : Number(empId),
          dryRun: true,
          syncPayrollCredits: false,
          syncAdvanceDebits: true,
        }),
      });
      const previewJson = await previewRes.json();
      if (previewRes.ok) {
        setSyncPreview({
          counts: previewJson.counts ?? {},
          previewRows: (previewJson.previewRows ?? []).slice(0, 8),
        });
        setSyncOpen(true);
      }
      await load();
    } catch (e) {
      setMappingError(e instanceof Error ? e.message : 'فشل ربط التصنيف');
    } finally {
      setMappingBusy(false);
    }
  };

  const openVoidModal = (ledgerEntryId: number) => {
    setVoidEntryId(ledgerEntryId);
    setVoidReason(DEFAULT_VOID_REASON);
    setVoidError('');
    setVoidOpen(true);
  };

  const submitVoidEntry = async () => {
    if (!voidEntryId) return;
    if (!voidReason.trim()) {
      setVoidError('سبب الإلغاء مطلوب');
      return;
    }
    setVoidBusy(true);
    setVoidError('');
    try {
      const res = await fetch('/api/admin/hr/employee-ledger/void-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ledgerEntryId: voidEntryId,
          reason: voidReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'فشل إلغاء القيد');
      }
      setVoidOpen(false);
      await load();
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : 'فشل إلغاء القيد');
    } finally {
      setVoidBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Scale className="w-4 h-4 text-primary" />
          <span>مراجعة دفتر الموظفين — مقارنة read-only بين اليوميات والدفتر والخزنة</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mr-auto">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40 h-9 text-sm bg-surface border-border"
          />
          <Select value={empId} onValueChange={setEmpId}>
            <SelectTrigger className="w-44 h-9 text-sm bg-surface border-border text-foreground">
              <SelectValue placeholder="الموظف" />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border max-h-64">
              <SelectItem value="all" className="text-foreground text-sm">كل الموظفين</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.EmpID} value={String(e.EmpID)} className="text-foreground text-sm">
                  {e.EmpName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void load()} disabled={loading} variant="outline" className="h-9 gap-2 border-border">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحديث
          </Button>
          <Button onClick={openSyncModal} className="h-9">
            مزامنة دفتر الموظفين
          </Button>
          <Button onClick={() => void openWageAudit()} variant="outline" className="h-9 gap-2 border-border">
            <Search className="w-4 h-4" />
            فحص مصدر اليوميات
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {advanceDiffWarning && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          يوجد فرق في السلف بين الخزنة ودفتر الموظفين. راجع السلف غير المرتبطة أو غير المتزامنة.
        </div>
      )}

      {healthy && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          لا توجد فجوات مسجّلة بين اليوميات والدفتر والسلف والصرف لهذا الشهر.
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <KpiCard title="يوميات مُولَّدة" value={`${fmt(s.payrollGeneratedTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="default" />
            <KpiCard title="دائن راتب بالدفتر" value={`${fmt(s.ledgerSalaryCreditsTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="success" />
            <KpiCard title="فرق اليوميات/الدفتر" value={`${fmt(s.payrollLedgerCreditDiff)} ج.م`} icon={<AlertTriangle className="w-5 h-5" />} variant="warning" />
            <KpiCard title="مشاكل مفتوحة" value={String(s.issueCount)} icon={<AlertCircle className="w-5 h-5" />} variant={s.issueCount > 0 ? 'danger' : 'success'} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <KpiCard title="سلف من الخزنة" value={`${fmt(s.advanceCashMoveTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="default" />
            <KpiCard title="سلف مرتبطة بموظف" value={`${fmt(s.resolvedCashAdvanceTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="default" />
            <KpiCard title="سلف غير مرتبطة" value={`${fmt(s.unresolvedCashAdvanceTotal)} ج.م`} icon={<AlertTriangle className="w-5 h-5" />} variant={s.unresolvedCashAdvanceCount > 0 ? 'warning' : 'default'} />
            <KpiCard title="مدين سلف بالدفتر" value={`${fmt(s.ledgerAdvanceDebitsTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="danger" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <KpiCard title="فرق السلف" value={`${fmt(s.advanceLedgerDiff)} ج.م`} icon={<AlertTriangle className="w-5 h-5" />} variant={Math.abs(s.advanceLedgerDiff) >= 0.01 ? 'warning' : 'success'} />
            <KpiCard title="صرف من الخزنة" value={`${fmt(s.payoutCashMoveTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="default" />
            <KpiCard title="مدين صرف بالدفتر" value={`${fmt(s.ledgerPayoutDebitsTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="danger" />
            <KpiCard title="فرق الصرف" value={`${fmt(s.payoutLedgerDiff)} ج.م`} icon={<AlertTriangle className="w-5 h-5" />} variant="warning" />
            <KpiCard
              title="مرايا إيراد قديمة"
              value={s.legacyColumnsAvailable ? `${fmt(s.legacyPayrollIncomeMirrorTotal)} ج.م` : 'غير متاح'}
              icon={<AlertTriangle className="w-5 h-5" />}
              variant="warning"
            />
            <KpiCard
              title="مرايا مصروف قديمة"
              value={s.legacyColumnsAvailable ? `${fmt(s.legacyPayrollExpenseMirrorTotal)} ج.م` : 'غير متاح'}
              icon={<AlertTriangle className="w-5 h-5" />}
              variant="warning"
            />
          </div>
        </>
      )}

      <SectionTable
        title={`A) يوميات بدون قيد دفتر (${data?.missingPayrollCredits.length ?? 0})`}
        emptyText="لا توجد يوميات ناقصة"
        headers={['اليومية', 'الموظف', 'التاريخ', 'المبلغ']}
      >
        {(data?.missingPayrollCredits ?? []).length === 0 ? (
          <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد يوميات ناقصة</td></tr>
        ) : (
          data?.missingPayrollCredits.map((row) => (
            <tr key={row.payrollId} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">#{row.payrollId}</td>
              <td className="px-4 py-3">{row.empName}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.workDate}</td>
              <td className={`px-4 py-3 font-mono ${diffClass(row.dailyWage)}`}>{fmt(row.dailyWage)}</td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`B) قيود دفتر يتيمة (${data?.orphanLedgerCredits.length ?? 0})`}
        emptyText="لا توجد قيود يتيمة"
        headers={['القيد', 'الموظف', 'التاريخ', 'المبلغ', 'RefID']}
      >
        {(data?.orphanLedgerCredits ?? []).length === 0 ? (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد قيود يتيمة</td></tr>
        ) : (
          data?.orphanLedgerCredits.map((row) => (
            <tr key={row.ledgerEntryId} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">#{row.ledgerEntryId}</td>
              <td className="px-4 py-3">{row.empName}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.entryDate}</td>
              <td className="px-4 py-3 font-mono text-rose-400">{fmt(row.amount)}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.refId}</td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`C) سلف بدون قيد دفتر (${data?.missingAdvanceDebits.length ?? 0})`}
        emptyText="لا توجد سلف ناقصة"
        headers={['CashMove', 'الموظف', 'التاريخ', 'التصنيف', 'المبلغ', 'السبب', 'إجراء']}
      >
        {(data?.missingAdvanceDebits ?? []).length === 0 ? (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد سلف ناقصة</td></tr>
        ) : (
          data?.missingAdvanceDebits.map((row) => (
            <tr key={row.cashMoveId} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">#{row.cashMoveId}</td>
              <td className="px-4 py-3">{row.empName ?? 'غير محدد'}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
              <td className="px-4 py-3">{row.categoryName ?? '—'}</td>
              <td className="px-4 py-3 font-mono text-rose-400">{fmt(row.amount)}</td>
              <td className="px-4 py-3 text-xs text-zinc-400">{advanceIssueLabel(row.issueReason)}</td>
              <td className="px-4 py-3 text-xs text-amber-300">
                {row.issueReason === 'missing_employee_mapping' ? 'راجع ربط التصنيف بالموظف' : '—'}
              </td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`C2) سلف من الخزنة غير مرتبطة بموظف (${data?.unresolvedCashAdvances.length ?? 0})`}
        emptyText="لا توجد سلف غير مرتبطة"
        headers={[
          'CashMove', 'ExpINID', 'التاريخ', 'التصنيف', 'EmpID خزنة', 'EmpID مربوط',
          'قيد دفتر', 'المبلغ', 'اقتراحات', 'السبب', 'إجراء',
        ]}
      >
        {(data?.unresolvedCashAdvances ?? []).length === 0 ? (
          <tr><td colSpan={11} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد سلف غير مرتبطة</td></tr>
        ) : (
          data?.unresolvedCashAdvances.map((row) => (
            <tr key={`unresolved-${row.cashMoveId}`} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">#{row.cashMoveId}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.expInId}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
              <td className="px-4 py-3">{row.categoryName ?? '—'}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.cashEmpId ?? '—'}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.mapEmpId ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{boolLabel(row.hasLedgerEntry)}</td>
              <td className="px-4 py-3 font-mono text-amber-400">{fmt(row.amount)}</td>
              <td className="px-4 py-3 text-xs text-zinc-400">
                {row.suggestedEmployeeMatches.length === 0
                  ? '—'
                  : row.suggestedEmployeeMatches.map((m) => m.empName).join('، ')}
              </td>
              <td className="px-4 py-3 text-xs text-zinc-400">{advanceIssueLabel(row.issueReason)}</td>
              <td className="px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => openMappingModal(row)}
                >
                  ربط التصنيف بموظف
                </Button>
              </td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`C3) فرق مبلغ السلف بين الخزنة والدفتر (${data?.advanceAmountMismatches.length ?? 0})`}
        emptyText="لا توجد فروق مبالغ"
        headers={['CashMove', 'الموظف', 'التاريخ', 'خزنة', 'دفتر', 'السبب']}
      >
        {(data?.advanceAmountMismatches ?? []).length === 0 ? (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد فروق مبالغ</td></tr>
        ) : (
          data?.advanceAmountMismatches.map((row) => (
            <tr key={`mismatch-${row.cashMoveId}`} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">#{row.cashMoveId}</td>
              <td className="px-4 py-3">{row.empName}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
              <td className="px-4 py-3 font-mono text-rose-400">{fmt(row.cashAmount)}</td>
              <td className="px-4 py-3 font-mono text-emerald-400">{fmt(row.ledgerAmount)}</td>
              <td className="px-4 py-3 text-xs text-zinc-400">{advanceIssueLabel(row.issueReason)}</td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`C4) تشخيص فروقات السلف (${data?.advanceDiagnosticRows.length ?? 0})`}
        emptyText="لا توجد فروقات تشخيصية"
        headers={['الوصف', 'المبلغ', 'السبب', 'ملاحظات', 'إجراء']}
      >
        {(data?.advanceDiagnosticRows ?? []).length === 0 ? (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد فروقات تشخيصية</td></tr>
        ) : (
          data?.advanceDiagnosticRows.map((row, idx) => (
            <tr key={`diag-${idx}`} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3">{row.label}</td>
              <td className="px-4 py-3 font-mono text-amber-400">{fmt(row.amount)}</td>
              <td className="px-4 py-3 text-xs text-zinc-400">{advanceIssueLabel(row.issueReason)}</td>
              <td className="px-4 py-3 text-xs text-zinc-500">{row.notes ?? '—'}</td>
              <td className="px-4 py-3">
                {row.issueReason === 'orphan_ledger_debit' && row.ledgerEntryId != null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-rose-500/40 text-rose-300"
                    onClick={() => openVoidModal(row.ledgerEntryId!)}
                  >
                    إلغاء قيد الدفتر
                  </Button>
                ) : (
                  <span className="text-xs text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`D) صرف بدون قيد دفتر (${data?.missingPayoutDebits.length ?? 0})`}
        emptyText="لا توجد عمليات صرف ناقصة"
        headers={['CashMove', 'الموظف', 'التاريخ', 'المبلغ']}
      >
        {(data?.missingPayoutDebits ?? []).length === 0 ? (
          <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد عمليات صرف ناقصة</td></tr>
        ) : (
          data?.missingPayoutDebits.map((row) => (
            <tr key={row.cashMoveId} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">#{row.cashMoveId}</td>
              <td className="px-4 py-3">{row.empName ?? '—'}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
              <td className="px-4 py-3 font-mono text-rose-400">{fmt(row.amount)}</td>
            </tr>
          ))
        )}
      </SectionTable>

      <SectionTable
        title={`E) مرايا ترحيل قديم (مصروف + إيراد) (${data?.legacyMirrorRows.length ?? 0})`}
        emptyText="لا توجد مرايا قديمة في هذا الشهر"
        headers={['التاريخ', 'الموظف', 'إيراد معادلة', 'مصروف يومية', 'عدد الحركات']}
      >
        {(data?.legacyMirrorRows ?? []).length === 0 ? (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد مرايا قديمة</td></tr>
        ) : (
          data?.legacyMirrorRows.map((row, idx) => (
            <tr key={`${row.invDate}-${row.empId ?? 'x'}-${idx}`} className="hover:bg-zinc-800/30">
              <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
              <td className="px-4 py-3">{row.empName ?? '—'}</td>
              <td className="px-4 py-3 font-mono text-amber-400">{fmt(row.incomeMirrorTotal)}</td>
              <td className="px-4 py-3 font-mono text-rose-400">{fmt(row.expenseMirrorTotal)}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.rowCount}</td>
            </tr>
          ))
        )}
      </SectionTable>

      <p className="text-xs text-zinc-600 px-1">
        المراجعة read-only — إجراءات التنظيف الآمن (ربط التصنيف / إلغاء قيد يتيم) لا تحذف حركات الخزنة ولا تعدّل CashMove التاريخية.
      </p>

      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent className="bg-surface border-border text-foreground max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>ربط التصنيف بموظف</DialogTitle>
            <DialogDescription className="text-zinc-400">
              يُحدّث جدول TblExpCatEmpMap فقط — لا يُعدَّل CashMove ولا قيود الدفتر مباشرة.
            </DialogDescription>
          </DialogHeader>

          {mappingRow && (
            <div className="space-y-3 text-sm">
              <p><span className="text-zinc-500">CashMove:</span> #{mappingRow.cashMoveId}</p>
              <p><span className="text-zinc-500">ExpINID:</span> {mappingRow.expInId}</p>
              <p><span className="text-zinc-500">التصنيف:</span> {mappingRow.categoryName ?? '—'}</p>
              <p><span className="text-zinc-500">المبلغ:</span> {fmt(mappingRow.amount)} ج.م</p>
              {mappingRow.suggestedEmployeeMatches.length > 0 && (
                <p className="text-xs text-amber-300">
                  اقتراحات: {mappingRow.suggestedEmployeeMatches.map((m) => m.empName).join('، ')}
                </p>
              )}
              <div>
                <p className="text-sm mb-2">الموظف</p>
                <Select value={mappingEmpId} onValueChange={setMappingEmpId}>
                  <SelectTrigger><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
                  <SelectContent className="bg-surface border-border max-h-64">
                    {employees.map((e) => (
                      <SelectItem key={e.EmpID} value={String(e.EmpID)}>{e.EmpName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mappingError && (
                <div className="p-3 text-sm rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300">
                  {mappingError}
                </div>
              )}
              {mappingSuccess && (
                <div className="p-3 text-sm rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                  {mappingSuccess}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <Button variant="outline" onClick={() => setMappingOpen(false)}>إغلاق</Button>
            <Button disabled={mappingBusy} onClick={() => void submitAdvanceMapping()}>
              {mappingBusy ? '...' : 'تأكيد الربط'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="bg-surface border-border text-foreground max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>إلغاء قيد الدفتر</DialogTitle>
            <DialogDescription className="text-amber-300">
              يُعلَّم القيد كملغى (IsVoided=1) — لا يُحذف من قاعدة البيانات.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-zinc-400">قيد الدفتر #{voidEntryId}</p>
            <div>
              <p className="text-sm mb-2">سبب الإلغاء *</p>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={DEFAULT_VOID_REASON}
              />
            </div>
            {voidError && (
              <div className="p-3 text-sm rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300">
                {voidError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <Button variant="outline" onClick={() => setVoidOpen(false)}>إلغاء</Button>
            <Button
              variant="destructive"
              disabled={voidBusy || !voidReason.trim()}
              onClick={() => void submitVoidEntry()}
            >
              {voidBusy ? '...' : 'تأكيد إلغاء القيد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="bg-surface border-border text-foreground max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>مزامنة دفتر الموظفين</DialogTitle>
            <DialogDescription className="text-amber-300">
              المزامنة لا تعدل حركات الخزنة، فقط تنشئ قيود دفتر الموظفين الناقصة.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm mb-2">الشهر</p>
                <Input type="month" value={syncMonth} onChange={(e) => setSyncMonth(e.target.value)} />
              </div>
              <div>
                <p className="text-sm mb-2">الموظف</p>
                <Select value={syncEmpId} onValueChange={setSyncEmpId}>
                  <SelectTrigger><SelectValue placeholder="كل الموظفين" /></SelectTrigger>
                  <SelectContent className="bg-surface border-border max-h-64">
                    <SelectItem value="all">كل الموظفين</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.EmpID} value={String(e.EmpID)}>{e.EmpName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={syncPayrollCredits} onChange={(e) => setSyncPayrollCredits(e.target.checked)} />
                مزامنة استحقاقات اليوميات (hourly_wage)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={syncAdvanceDebits} onChange={(e) => setSyncAdvanceDebits(e.target.checked)} />
                مزامنة سلف الموظفين من حركات الخزنة
              </label>
            </div>

            {syncError && (
              <div className="p-3 text-sm rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300">
                {syncError}
              </div>
            )}

            {syncPreview && (
              <div className="rounded-lg border border-zinc-700 p-3 text-sm space-y-2">
                <p className="font-semibold">نتيجة المعاينة</p>
                <p>Payroll Insert: {syncPreview.counts.payrollCreditsToInsert ?? 0}</p>
                <p>Payroll Update: {syncPreview.counts.payrollCreditsToUpdate ?? 0}</p>
                <p>Payroll Void: {syncPreview.counts.payrollCreditsToVoid ?? 0}</p>
                <p>Advance Insert: {syncPreview.counts.advanceDebitsToInsert ?? 0}</p>
                <p>Advance Update: {syncPreview.counts.advanceDebitsToUpdate ?? 0}</p>
                <p>Skipped: {syncPreview.counts.skipped ?? 0}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <Button variant="outline" onClick={() => setSyncOpen(false)}>إغلاق</Button>
            <Button variant="outline" disabled={syncBusy} onClick={() => void runSync(true)}>
              {syncBusy ? '...' : 'معاينة فقط'}
            </Button>
            <Button disabled={syncBusy || !syncPreview} onClick={() => void applySync()}>
              {syncBusy ? '...' : 'تنفيذ المزامنة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="bg-surface border-border text-foreground max-w-5xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>فحص مصدر اليوميات — {month}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              مراجعة read-only لمصادر استحقاق اليوميات قبل إيقاف الترحيل القديم للخزنة.
            </DialogDescription>
          </DialogHeader>

          {auditLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-6">
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري الفحص...
            </div>
          )}

          {auditError && (
            <div className="p-3 text-sm rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300">
              {auditError}
            </div>
          )}

          {auditData && !auditLoading && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard title="يوميات مُولَّدة" value={`${fmt(auditData.dailyPayrollGeneratedTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="default" />
                <KpiCard title="مصروف يوميات بالخزنة" value={`${fmt(auditData.cashWageExpenseTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="warning" />
                <KpiCard title="مرايا إيراد محتملة" value={`${fmt(auditData.possibleIncomeMirrorTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="warning" />
                <KpiCard title="دائن راتب بالدفتر" value={`${fmt(auditData.ledgerSalaryCreditTotal)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="success" />
                <KpiCard title="المصدر المقترح" value={suggestedSourceLabel(auditData.suggestedSource)} icon={<Search className="w-5 h-5" />} variant="default" />
              </div>

              <SectionTable
                title={`TblEmpDailyPayroll حسب الحالة (${auditData.dailyPayroll.byStatus.length})`}
                emptyText="لا توجد يوميات"
                headers={['الحالة', 'عدد الصفوف', 'إجمالي اليومية']}
              >
                {auditData.dailyPayroll.byStatus.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد يوميات</td></tr>
                ) : (
                  auditData.dailyPayroll.byStatus.map((row) => (
                    <tr key={row.status} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-3">{row.status}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.rowCount}</td>
                      <td className="px-4 py-3 font-mono">{fmt(row.dailyWageTotal)}</td>
                    </tr>
                  ))
                )}
              </SectionTable>

              <SectionTable
                title={`مصروفات يوميات محتملة بالخزنة (${auditData.cashWageExpenses.length})`}
                emptyText="لا توجد حركات مصروف يوميات"
                headers={['CashMove', 'التاريخ', 'الموظف', 'التصنيف', 'المبلغ', 'السبب']}
              >
                {auditData.cashWageExpenses.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد حركات</td></tr>
                ) : (
                  auditData.cashWageExpenses.map((row) => (
                    <tr key={row.cashMoveId} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-mono text-xs">#{row.cashMoveId}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
                      <td className="px-4 py-3">{row.empName ?? '—'}</td>
                      <td className="px-4 py-3">{row.categoryName ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-rose-400">{fmt(row.amount)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-400">{row.matchReason}</td>
                    </tr>
                  ))
                )}
              </SectionTable>

              <SectionTable
                title={`مرايا إيراد محتملة (${auditData.incomeMirrors.length})`}
                emptyText="لا توجد مرايا إيراد"
                headers={['CashMove', 'التاريخ', 'الموظف', 'التصنيف', 'المبلغ', 'مطابقة مصروف']}
              >
                {auditData.incomeMirrors.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد مرايا</td></tr>
                ) : (
                  auditData.incomeMirrors.map((row) => (
                    <tr key={row.cashMoveId} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-mono text-xs">#{row.cashMoveId}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.invDate}</td>
                      <td className="px-4 py-3">{row.empName ?? '—'}</td>
                      <td className="px-4 py-3">{row.categoryName ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-amber-400">{fmt(row.amount)}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {row.matchedExpenseCashMoveId != null ? `#${row.matchedExpenseCashMoveId}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </SectionTable>

              <SectionTable
                title={`قيود دفتر راتب/يومية (${auditData.ledgerSalaryCredits.entryCount})`}
                emptyText="لا توجد قيود دفتر"
                headers={['الموظف', 'hourly_wage', 'monthly_salary', 'الإجمالي', 'عدد القيود']}
              >
                {auditData.ledgerSalaryCredits.byEmployee.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500 text-sm">لا توجد قيود</td></tr>
                ) : (
                  auditData.ledgerSalaryCredits.byEmployee.map((row) => (
                    <tr key={row.empId} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-3">{row.empName}</td>
                      <td className="px-4 py-3 font-mono">{fmt(row.hourlyWageTotal)}</td>
                      <td className="px-4 py-3 font-mono">{fmt(row.monthlySalaryTotal)}</td>
                      <td className="px-4 py-3 font-mono text-emerald-400">{fmt(row.totalAmount)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.entryCount}</td>
                    </tr>
                  ))
                )}
              </SectionTable>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
