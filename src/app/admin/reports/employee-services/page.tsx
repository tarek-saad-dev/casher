'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Scissors, Receipt, TrendingUp, Award, Star,
  Loader2, RefreshCw, AlertCircle, ChevronDown, ChevronUp,
  Download, Search, Calendar, BarChart3, Edit2, X, ArrowLeftRight,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import {
  aggregateEmployeeServiceBreakdown,
  normalizeEmployeeServiceBreakdown,
  resolveBarberRevenue,
  sumEmployeeServiceBreakdown,
  type EmployeeServiceBreakdown,
} from '@/lib/services/employeeServiceBreakdown';
import { isBarberServiceCategory, type ServiceCategory } from '@/lib/services/classifyService';

type DetailCategoryFilter = 'all' | 'barber' | 'other';

const DETAIL_FILTER_CHIPS: { value: DetailCategoryFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'barber', label: 'شعر / شعر ودقن / دقن' },
  { value: 'other', label: 'خدمات أخرى' },
];

interface TopEmployee {
  empId: number;
  empName: string;
  totalAmount?: number;
  totalServices?: number;
}

interface Summary {
  totalAmount: number;
  totalGrossServiceRevenue?: number;
  totalAllocatedInvoiceDiscount?: number;
  totalActualInvoiceRevenue?: number;
  unattributedInvoiceRevenue?: number;
  treasuryComparableRevenue?: number;
  totalServices: number;
  totalInvoices: number;
  activeEmployees: number;
  topEmployeeByAmount: TopEmployee | null;
  topEmployeeByServices: TopEmployee | null;
}

interface EmployeeRow {
  empId: number;
  empName: string;
  servicesCount: number;
  invoicesCount: number;
  totalAmount: number;
  grossServiceRevenue?: number;
  allocatedInvoiceDiscount?: number;
  actualInvoiceRevenue?: number;
  avgServiceValue: number;
  lastOperationDate: string;
}

interface RevenueTotals {
  totalGrossServiceRevenue: number;
  totalAllocatedInvoiceDiscount: number;
  totalActualInvoiceRevenue: number;
  unattributedInvoiceRevenue: number;
  treasuryComparableRevenue: number;
}

interface ServiceBreakdownRow extends EmployeeServiceBreakdown {
  grossServiceRevenue?: number;
  allocatedInvoiceDiscount?: number;
  actualInvoiceRevenue?: number;
  invoiceCount?: number;
  serviceCount?: number;
}

interface DetailRow {
  empId: number;
  empName: string;
  invoiceId: number;
  invoiceType: string;
  operationDate: string;
  operationTime: string;
  serviceId: number;
  serviceName: string;
  serviceNameAr?: string;
  qty: number;
  unitPrice: number;
  discountValue: number;
  lineTotal: number;
  grossServiceValue?: number;
  allocatedInvoiceDiscount?: number;
  actualInvoiceRevenue?: number;
  invoiceGrandTotal?: number;
  invoiceSubTotal?: number;
  otherEmployeesOnInvoice?: { empId: number; empName: string }[];
  clientName: string;
  notes: string;
  serviceCategory: ServiceCategory;
}

interface ReportData {
  summary: Summary;
  employees: EmployeeRow[];
  serviceBreakdown: ServiceBreakdownRow[];
  revenueTotals?: RevenueTotals;
  details: DetailRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatCurrency(val: number | null | undefined): string {
  const amount = Number(val);
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function exportCsv(
  employees: EmployeeRow[],
  details: DetailRow[],
  breakdown: ServiceBreakdownRow[],
  revenueTotals: RevenueTotals | undefined,
  from: string,
  to: string
) {
  const BOM = '\uFEFF';

  const empLines = [
    [
      'الموظف',
      'عدد الخدمات',
      'عدد الفواتير',
      'قيمة الشغل قبل الخصم',
      'خصومات الفواتير',
      'الإيراد الفعلي',
      'متوسط الخدمة (ج.م)',
      'آخر عملية',
    ],
    ...employees.map(e => [
      e.empName,
      e.servicesCount,
      e.invoicesCount,
      (e.grossServiceRevenue ?? e.totalAmount).toFixed(2),
      (e.allocatedInvoiceDiscount ?? 0).toFixed(2),
      (e.actualInvoiceRevenue ?? e.totalAmount).toFixed(2),
      e.avgServiceValue.toFixed(2),
      e.lastOperationDate,
    ]),
  ];

  const breakdownLines = [
    [
      'الصنايعي',
      'شعر / شعر ودقن / دقن',
      'الخدمات الأخرى',
      'إجمالي قيمة الخدمات',
      'نصيبه من الخصومات',
      'الفعلي بعد الخصم',
    ],
    ...breakdown.map(row => [
      row.employeeName,
      resolveBarberRevenue(row).toFixed(2),
      row.otherRevenue.toFixed(2),
      (row.grossServiceRevenue ?? row.totalRevenue).toFixed(2),
      (row.allocatedInvoiceDiscount ?? 0).toFixed(2),
      (row.actualInvoiceRevenue ?? row.totalRevenue).toFixed(2),
    ]),
  ];

  const detailLines = [
    [
      'الموظف',
      'رقم الفاتورة',
      'نوع الفاتورة',
      'التاريخ',
      'الوقت',
      'الخدمة',
      'الكمية',
      'قيمة الخدمة قبل خصم الفاتورة',
      'نصيب من خصم الفاتورة',
      'الفعلي بعد الخصم',
      'إجمالي الفاتورة',
      'موظفون آخرون',
      'العميل',
      'ملاحظات',
    ],
    ...details.map(d => [
      d.empName,
      d.invoiceId,
      d.invoiceType,
      d.operationDate,
      d.operationTime,
      d.serviceName,
      d.qty,
      (d.grossServiceValue ?? d.lineTotal).toFixed(2),
      (d.allocatedInvoiceDiscount ?? 0).toFixed(2),
      (d.actualInvoiceRevenue ?? d.lineTotal).toFixed(2),
      (d.invoiceGrandTotal ?? 0).toFixed(2),
      (d.otherEmployeesOnInvoice ?? []).map(e => e.empName).join(' | '),
      d.clientName,
      d.notes,
    ]),
  ];

  const totalsLines = revenueTotals
    ? [
        [],
        ['--- إجماليات الإيراد ---'],
        ['إجمالي الخدمات قبل الخصم', revenueTotals.totalGrossServiceRevenue.toFixed(2)],
        ['إجمالي خصومات الفواتير', revenueTotals.totalAllocatedInvoiceDiscount.toFixed(2)],
        ['صافي إيراد الفواتير الفعلي', revenueTotals.totalActualInvoiceRevenue.toFixed(2)],
        ['غير المنسوب للموظفين', revenueTotals.unattributedInvoiceRevenue.toFixed(2)],
        ['مقارنة الخزينة', revenueTotals.treasuryComparableRevenue.toFixed(2)],
      ]
    : [];

  const allLines = [
    [`تقرير خدمات الموظفين من ${from} إلى ${to}`],
    [],
    ['--- ملخص الموظفين ---'],
    ...empLines,
    [],
    ['--- تفصيل الصنايعية ---'],
    ...breakdownLines,
    [],
    ['--- تفاصيل الخدمات ---'],
    ...detailLines,
    ...totalsLines,
  ];

  const csv = BOM + allLines.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `employee-services-${from}-to-${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function EmployeeServicesReportPage() {
  const today = getTodayStr();

  const [fromDate,    setFromDate]    = useState(today);
  const [toDate,      setToDate]      = useState(today);
  const [employeeId,  setEmployeeId]  = useState<string>('all');
  const [data,        setData]        = useState<ReportData | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [expandedEmp, setExpandedEmp] = useState<number | null>(null);
  const [empList,     setEmpList]     = useState<{ EmpID: number; EmpName: string }[]>([]);

  // ── Reassign modal state ────
  const [reassignTarget, setReassignTarget] = useState<DetailRow | null>(null);
  const [reassignNewEmpId, setReassignNewEmpId] = useState<string>('');
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState('');
  const [reassignSuccess, setReassignSuccess] = useState('');
  const [detailCategoryFilter, setDetailCategoryFilter] = useState<DetailCategoryFilter>('all');

  // Load employee dropdown on mount
  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then((list: any[]) => {
        if (Array.isArray(list)) setEmpList(list);
      })
      .catch(() => {});
  }, []);

  const fetchReport = useCallback(async (fDate: string, tDate: string, empId: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ fromDate: fDate, toDate: tDate });
      if (empId !== 'all') params.set('employeeId', empId);
      const res  = await fetch(`/api/reports/employee-services?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'خطأ في تحميل التقرير');
      } else {
        setData(json);
        setExpandedEmp(null);
        setDetailCategoryFilter('all');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount with defaults
  useEffect(() => {
    fetchReport(today, today, 'all');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = () => fetchReport(fromDate, toDate, employeeId);

  // ── Reassign handler ────
  const handleReassign = async () => {
    if (!reassignTarget || !reassignNewEmpId) return;
    setReassignLoading(true);
    setReassignError('');
    setReassignSuccess('');
    try {
      const res = await fetch('/api/reports/employee-services/reassign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: reassignTarget.invoiceId,
          invoiceType: reassignTarget.invoiceType,
          oldEmpId: reassignTarget.empId,
          newEmpId: parseInt(reassignNewEmpId),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setReassignError(json.error || 'خطأ في نقل الفاتورة');
      } else {
        setReassignSuccess(json.message || 'تم النقل بنجاح');
        // Refresh report after short delay
        setTimeout(() => {
          setReassignTarget(null);
          setReassignNewEmpId('');
          setReassignSuccess('');
          fetchReport(fromDate, toDate, employeeId);
        }, 1500);
      }
    } catch {
      setReassignError('خطأ في الاتصال بالخادم');
    } finally {
      setReassignLoading(false);
    }
  };

  const openReassignModal = (detail: DetailRow) => {
    setReassignTarget(detail);
    setReassignNewEmpId('');
    setReassignError('');
    setReassignSuccess('');
  };

  const handleReset = () => {
    setFromDate(today);
    setToDate(today);
    setEmployeeId('all');
    fetchReport(today, today, 'all');
  };

  // Details for expanded employee (optionally filtered by service category)
  const empDetails = (empId: number): DetailRow[] => {
    const rows = data?.details.filter(d => d.empId === empId) ?? [];
    if (detailCategoryFilter === 'all') return rows;
    if (detailCategoryFilter === 'barber') {
      return rows.filter(d => isBarberServiceCategory(d.serviceCategory));
    }
    return rows.filter(d => d.serviceCategory === 'other');
  };

  const breakdownRows = useMemo((): ServiceBreakdownRow[] => {
    if (!data) return [];

    if (data.serviceBreakdown?.length) {
      return data.serviceBreakdown.map((row) => normalizeEmployeeServiceBreakdown(row) as ServiceBreakdownRow);
    }

    if (data.details.length > 0 && data.details[0].serviceCategory) {
      return aggregateEmployeeServiceBreakdown(
        data.details.map((d) => ({
          empId: d.empId,
          empName: d.empName,
          proId: d.serviceId,
          serviceName: d.serviceName,
          serviceNameAr: d.serviceNameAr,
          lineTotal: d.lineTotal,
        }))
      ) as ServiceBreakdownRow[];
    }

    return [];
  }, [data]);

  const revenueTotals: RevenueTotals = useMemo(() => {
    if (!data) {
      return {
        totalGrossServiceRevenue: 0,
        totalAllocatedInvoiceDiscount: 0,
        totalActualInvoiceRevenue: 0,
        unattributedInvoiceRevenue: 0,
        treasuryComparableRevenue: 0,
      };
    }
    if (data.revenueTotals) return data.revenueTotals;
    return {
      totalGrossServiceRevenue: data.summary.totalGrossServiceRevenue ?? data.summary.totalAmount,
      totalAllocatedInvoiceDiscount: data.summary.totalAllocatedInvoiceDiscount ?? 0,
      totalActualInvoiceRevenue: data.summary.totalActualInvoiceRevenue ?? data.summary.totalAmount,
      unattributedInvoiceRevenue: data.summary.unattributedInvoiceRevenue ?? 0,
      treasuryComparableRevenue: data.summary.treasuryComparableRevenue ?? data.summary.totalAmount,
    };
  }, [data]);

  const breakdownTotals = useMemo(() => {
    const base = sumEmployeeServiceBreakdown(breakdownRows);
    const gross = breakdownRows.reduce((sum, row) => sum + (row.grossServiceRevenue ?? row.totalRevenue), 0);
    const discount = breakdownRows.reduce((sum, row) => sum + (row.allocatedInvoiceDiscount ?? 0), 0);
    const actual = breakdownRows.reduce((sum, row) => sum + (row.actualInvoiceRevenue ?? row.totalRevenue), 0);
    return { ...base, grossServiceRevenue: gross, allocatedInvoiceDiscount: discount, actualInvoiceRevenue: actual };
  }, [breakdownRows]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto" dir="rtl">
      <PageHeader
        title="تقرير خدمات الموظفين"
        description="تحليل الخدمات المنفذة لكل موظف خلال الفترة المحددة"
      >
        <Button
          variant="outline"
          onClick={() => data && exportCsv(data.employees, data.details, breakdownRows, data.revenueTotals ?? {
            totalGrossServiceRevenue: data.summary.totalGrossServiceRevenue ?? data.summary.totalAmount,
            totalAllocatedInvoiceDiscount: data.summary.totalAllocatedInvoiceDiscount ?? 0,
            totalActualInvoiceRevenue: data.summary.totalActualInvoiceRevenue ?? data.summary.totalAmount,
            unattributedInvoiceRevenue: data.summary.unattributedInvoiceRevenue ?? 0,
            treasuryComparableRevenue: data.summary.treasuryComparableRevenue ?? data.summary.totalAmount,
          }, fromDate, toDate)}
          disabled={!data || loading}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-10 gap-2"
        >
          <Download className="w-4 h-4" />
          تصدير CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => fetchReport(fromDate, toDate, employeeId)}
          disabled={loading}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-10"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </PageHeader>

      {/* ── Filters ── */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* From Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">من تاريخ</label>
            <Input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white h-10 w-44"
            />
          </div>

          {/* To Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">إلى تاريخ</label>
            <Input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white h-10 w-44"
            />
          </div>

          {/* Employee */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">الموظف</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-10 w-52">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="all" className="text-white text-sm">كل الموظفين</SelectItem>
                {empList.map(e => (
                  <SelectItem key={e.EmpID} value={String(e.EmpID)} className="text-white text-sm">
                    {e.EmpName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Buttons */}
          <div className="flex items-center gap-2 mr-2 mt-5">
            <Button
              onClick={handleApply}
              disabled={loading}
              className="h-10 px-5 bg-[#D6A84F] hover:bg-[#c49640] text-black font-bold rounded-xl"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Search className="w-4 h-4 ml-1" />}
              عرض التقرير
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              className="h-10 px-4 border-zinc-700 text-zinc-300 hover:bg-zinc-800 rounded-xl"
            >
              إعادة ضبط
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setFromDate(today); setToDate(today); fetchReport(today, today, employeeId); }}
              className="h-10 px-3 text-zinc-400 hover:text-zinc-200 text-xs"
            >
              <Calendar className="w-3.5 h-3.5 ml-1" />
              اليوم
            </Button>
          </div>
        </div>
      </div>

      {/* ── Error State ── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium text-sm">{error}</span>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-[#D6A84F]" />
            <p className="mt-3 text-zinc-400 text-sm">جاري تحميل التقرير...</p>
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Revenue Summary Cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard
              title="إجمالي الخدمات قبل الخصم"
              value={formatCurrency(revenueTotals.totalGrossServiceRevenue)}
              icon={<TrendingUp className="w-5 h-5" />}
              variant="default"
            />
            <KpiCard
              title="إجمالي خصومات الفواتير"
              value={formatCurrency(revenueTotals.totalAllocatedInvoiceDiscount)}
              icon={<Receipt className="w-5 h-5" />}
              variant="warning"
            />
            <KpiCard
              title="صافي إيراد الفواتير الفعلي"
              value={formatCurrency(revenueTotals.totalActualInvoiceRevenue)}
              subtitle={
                revenueTotals.unattributedInvoiceRevenue > 0
                  ? `غير منسوب: ${formatCurrency(revenueTotals.unattributedInvoiceRevenue)}`
                  : `مطابق للخزينة: ${formatCurrency(revenueTotals.treasuryComparableRevenue)}`
              }
              icon={<TrendingUp className="w-5 h-5" />}
              variant="success"
            />
          </div>

          {/* ── Summary Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              title="قيمة الخدمات قبل خصم الفاتورة"
              value={formatCurrency(data.summary.totalAmount)}
              icon={<TrendingUp className="w-5 h-5" />}
              variant="primary"
            />
            <KpiCard
              title="عدد الخدمات"
              value={data.summary.totalServices.toLocaleString('ar-EG')}
              icon={<Scissors className="w-5 h-5" />}
              variant="success"
            />
            <KpiCard
              title="عدد الفواتير"
              value={data.summary.totalInvoices.toLocaleString('ar-EG')}
              icon={<Receipt className="w-5 h-5" />}
              variant="default"
            />
            <KpiCard
              title="عدد الموظفين"
              value={data.summary.activeEmployees.toLocaleString('ar-EG')}
              icon={<Users className="w-5 h-5" />}
              variant="default"
            />
            <KpiCard
              title="أعلى موظف (قيمة)"
              value={data.summary.topEmployeeByAmount?.empName ?? '—'}
              subtitle={data.summary.topEmployeeByAmount
                ? formatCurrency(data.summary.topEmployeeByAmount.totalAmount ?? 0)
                : undefined}
              icon={<Award className="w-5 h-5" />}
              variant="warning"
            />
            <KpiCard
              title="أعلى موظف (عدد)"
              value={data.summary.topEmployeeByServices?.empName ?? '—'}
              subtitle={data.summary.topEmployeeByServices
                ? `${data.summary.topEmployeeByServices.totalServices ?? 0} خدمة`
                : undefined}
              icon={<Star className="w-5 h-5" />}
              variant="warning"
            />
          </div>

          {/* ── Service Category Breakdown ── */}
          {breakdownRows.length > 0 && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800/50 flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">تفصيل شغل الصنايعية حسب نوع الخدمة</h2>
                <span className="text-xs text-zinc-500">{breakdownRows.length} صنايعي</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-right p-3 text-zinc-400 font-semibold whitespace-nowrap">الصنايعي</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">شعر / شعر ودقن / دقن</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">الخدمات الأخرى</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">إجمالي قيمة الخدمات</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">الخصومات</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">الفعلي بعد الخصم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownRows.map((row) => (
                      <tr
                        key={row.employeeId}
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors"
                      >
                        <td className="p-3 font-semibold text-white whitespace-nowrap">{row.employeeName}</td>
                        <td className="text-center p-3 font-bold text-emerald-400 whitespace-nowrap">{formatCurrency(resolveBarberRevenue(row))}</td>
                        <td className="text-center p-3 text-zinc-300 whitespace-nowrap">{formatCurrency(row.otherRevenue)}</td>
                        <td className="text-center p-3 text-white whitespace-nowrap">{formatCurrency(row.grossServiceRevenue ?? row.totalRevenue)}</td>
                        <td className="text-center p-3 text-amber-400 whitespace-nowrap">-{formatCurrency(row.allocatedInvoiceDiscount ?? 0)}</td>
                        <td className="text-center p-3 font-bold text-emerald-400 whitespace-nowrap">{formatCurrency(row.actualInvoiceRevenue ?? row.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-900/80 border-t-2 border-zinc-700">
                      <td className="px-3 py-3 font-bold text-white text-sm whitespace-nowrap">الإجمالي</td>
                      <td className="text-center px-3 py-3 font-bold text-[#D6A84F] whitespace-nowrap">{formatCurrency(breakdownTotals.barberRevenue)}</td>
                      <td className="text-center px-3 py-3 font-bold text-[#D6A84F] whitespace-nowrap">{formatCurrency(breakdownTotals.otherRevenue)}</td>
                      <td className="text-center px-3 py-3 font-bold text-white whitespace-nowrap">{formatCurrency(breakdownTotals.grossServiceRevenue)}</td>
                      <td className="text-center px-3 py-3 font-bold text-amber-400 whitespace-nowrap">-{formatCurrency(breakdownTotals.allocatedInvoiceDiscount)}</td>
                      <td className="text-center px-3 py-3 font-bold text-emerald-400 whitespace-nowrap">{formatCurrency(breakdownTotals.actualInvoiceRevenue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── Empty State ── */}
          {data.employees.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <BarChart3 className="w-14 h-14 text-zinc-700 mb-4" />
              <p className="text-zinc-400 text-base font-medium">لا توجد بيانات في هذه الفترة</p>
              <p className="text-zinc-600 text-sm mt-1">جرّب تغيير نطاق التاريخ أو الموظف المحدد</p>
            </div>
          )}

          {/* ── Employee Summary Table ── */}
          {data.employees.length > 0 && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800/50 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-white">ملخص الموظفين</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-500 ml-2">تصفية التفاصيل:</span>
                  {DETAIL_FILTER_CHIPS.map((chip) => (
                    <button
                      key={chip.value}
                      type="button"
                      onClick={() => setDetailCategoryFilter(chip.value)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        detailCategoryFilter === chip.value
                          ? 'bg-[#D6A84F] text-black'
                          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-zinc-500">{data.employees.length} موظف</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-right p-3 text-zinc-400 font-semibold whitespace-nowrap">الموظف</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">عدد الخدمات</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">عدد الفواتير</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">قيمة الشغل قبل الخصم</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">خصومات الفواتير</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">الإيراد الفعلي</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">متوسط الخدمة</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">آخر عملية</th>
                      <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees.map((emp, idx) => {
                      const isExpanded = expandedEmp === emp.empId;
                      const details    = empDetails(emp.empId);
                      const isTop      = idx === 0;

                      return (
                        <>
                          <tr
                            key={emp.empId}
                            className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors ${isExpanded ? 'bg-[#D6A84F]/5' : ''}`}
                          >
                            {/* Employee Name */}
                            <td className="p-3">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${isTop ? 'bg-[#D6A84F]/20 text-[#D6A84F]' : 'bg-zinc-800 text-zinc-400'}`}>
                                  {isTop ? '🥇' : emp.empName?.charAt(0)}
                                </div>
                                <div>
                                  <div className="font-semibold text-white text-sm">{emp.empName}</div>
                                  {isTop && (
                                    <div className="text-[10px] text-[#D6A84F] font-medium">الأفضل أداءً</div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Services Count */}
                            <td className="text-center p-3">
                              <span className="text-white font-bold">{emp.servicesCount.toLocaleString('ar-EG')}</span>
                            </td>

                            {/* Invoices Count */}
                            <td className="text-center p-3">
                              <span className="text-zinc-300">{emp.invoicesCount.toLocaleString('ar-EG')}</span>
                            </td>

                            {/* Gross before invoice discount */}
                            <td className="text-center p-3">
                              <span className={`font-bold ${isTop ? 'text-white' : 'text-zinc-200'}`}>
                                {formatCurrency(emp.grossServiceRevenue ?? emp.totalAmount)}
                              </span>
                            </td>

                            {/* Invoice discounts */}
                            <td className="text-center p-3">
                              <span className="font-bold text-amber-400">
                                -{formatCurrency(emp.allocatedInvoiceDiscount ?? 0)}
                              </span>
                            </td>

                            {/* Actual revenue */}
                            <td className="text-center p-3">
                              <span className={`font-bold ${isTop ? 'text-emerald-400' : 'text-emerald-400'}`}>
                                {formatCurrency(emp.actualInvoiceRevenue ?? emp.totalAmount)}
                              </span>
                            </td>

                            {/* Avg Service */}
                            <td className="text-center p-3">
                              <span className="text-zinc-300 text-xs">{formatCurrency(emp.avgServiceValue)}</span>
                            </td>

                            {/* Last Op Date */}
                            <td className="text-center p-3">
                              <span className="text-zinc-400 text-xs">{formatDate(emp.lastOperationDate)}</span>
                            </td>

                            {/* Toggle Details */}
                            <td className="text-center p-3">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setExpandedEmp(isExpanded ? null : emp.empId)}
                                className={`h-8 px-3 text-xs gap-1 ${isExpanded ? 'text-[#D6A84F] bg-[#D6A84F]/10' : 'text-zinc-400 hover:text-zinc-200'}`}
                              >
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                {isExpanded ? 'إخفاء' : 'التفاصيل'}
                              </Button>
                            </td>
                          </tr>

                          {/* ── Expanded Details Sub-Table ── */}
                          {isExpanded && (
                            <tr key={`details-${emp.empId}`} className="bg-zinc-950/60">
                              <td colSpan={9} className="p-0">
                                <div className="border-t border-[#D6A84F]/20 px-4 pb-4 pt-3">
                                  <div className="text-xs font-bold text-[#D6A84F] mb-2 flex items-center gap-1.5">
                                    <Scissors className="w-3.5 h-3.5" />
                                    تفاصيل خدمات {emp.empName} ({details.length} خدمة)
                                  </div>
                                  {details.length === 0 ? (
                                    <p className="text-zinc-500 text-xs py-2">
                                      {detailCategoryFilter === 'all'
                                        ? 'لا توجد تفاصيل'
                                        : 'لا توجد خدمات في هذا التصنيف'}
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto rounded-lg border border-zinc-800/50">
                                      <table className="w-full text-xs border-collapse">
                                        <thead>
                                          <tr className="bg-zinc-900 border-b border-zinc-800">
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">التاريخ</th>
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">الوقت</th>
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">رقم الفاتورة</th>
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">اسم الخدمة</th>
                                            <th className="text-center px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">الكمية</th>
                                            <th className="text-center px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">قيمة الخدمة قبل خصم الفاتورة</th>
                                            <th className="text-center px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">نصيب خصم الفاتورة</th>
                                            <th className="text-center px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">الفعلي بعد الخصم</th>
                                            <th className="text-center px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">إجمالي الفاتورة</th>
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">موظفون آخرون</th>
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">العميل</th>
                                            <th className="text-right px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">ملاحظات</th>
                                            <th className="text-center px-3 py-2 text-zinc-500 font-semibold whitespace-nowrap">إجراءات</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {details.map((d, di) => (
                                            <tr
                                              key={`${d.invoiceId}-${d.serviceId}-${di}`}
                                              className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                                            >
                                              <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{formatDate(d.operationDate)}</td>
                                              <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{d.operationTime || '—'}</td>
                                              <td className="px-3 py-2">
                                                <span className="bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-[11px] font-mono">
                                                  #{d.invoiceId}
                                                </span>
                                                <span className="text-zinc-600 text-[10px] mr-1">{d.invoiceType}</span>
                                              </td>
                                              <td className="px-3 py-2 text-white font-medium whitespace-nowrap">{d.serviceName || '—'}</td>
                                              <td className="px-3 py-2 text-center text-zinc-300">{d.qty}</td>
                                              <td className="px-3 py-2 text-center text-white whitespace-nowrap">
                                                {formatCurrency(d.grossServiceValue ?? d.lineTotal)}
                                              </td>
                                              <td className="px-3 py-2 text-center">
                                                {(d.allocatedInvoiceDiscount ?? 0) > 0 ? (
                                                  <span className="text-amber-400">-{formatCurrency(d.allocatedInvoiceDiscount ?? 0)}</span>
                                                ) : (
                                                  <span className="text-zinc-600">—</span>
                                                )}
                                              </td>
                                              <td className="px-3 py-2 text-center font-bold text-emerald-400 whitespace-nowrap">
                                                {formatCurrency(d.actualInvoiceRevenue ?? d.lineTotal)}
                                              </td>
                                              <td className="px-3 py-2 text-center text-zinc-300 whitespace-nowrap">
                                                {formatCurrency(d.invoiceGrandTotal ?? 0)}
                                              </td>
                                              <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                                                {(d.otherEmployeesOnInvoice ?? []).length > 0
                                                  ? (d.otherEmployeesOnInvoice ?? []).map((e) => e.empName).join('، ')
                                                  : '—'}
                                              </td>
                                              <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{d.clientName || '—'}</td>
                                              <td className="px-3 py-2 text-zinc-500 max-w-[150px] truncate">{d.notes || '—'}</td>
                                              <td className="px-3 py-2 text-center">
                                                <button
                                                  onClick={() => openReassignModal(d)}
                                                  className="p-1.5 rounded-lg hover:bg-[#D6A84F]/10 text-zinc-400 hover:text-[#D6A84F] transition-colors" 
                                                  title="نقل لموظف آخر"
                                                >
                                                  <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot>
                                          <tr className="bg-zinc-900/80 border-t border-zinc-700">
                                            <td colSpan={5} className="px-3 py-2 text-left text-zinc-400 text-xs font-semibold">
                                              {detailCategoryFilter === 'all' ? 'الإجمالي' : 'إجمالي المعروض'}
                                            </td>
                                            <td className="px-3 py-2 text-center text-white font-bold whitespace-nowrap">
                                              {formatCurrency(details.reduce((sum, d) => sum + (d.grossServiceValue ?? d.lineTotal), 0))}
                                            </td>
                                            <td className="px-3 py-2 text-center text-amber-400 font-bold whitespace-nowrap">
                                              -{formatCurrency(details.reduce((sum, d) => sum + (d.allocatedInvoiceDiscount ?? 0), 0))}
                                            </td>
                                            <td className="px-3 py-2 text-center font-bold text-emerald-400 whitespace-nowrap">
                                              {formatCurrency(details.reduce((sum, d) => sum + (d.actualInvoiceRevenue ?? d.lineTotal), 0))}
                                            </td>
                                            <td colSpan={4} />
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>

                  {/* Table Footer — Grand Total */}
                  <tfoot>
                    <tr className="bg-zinc-900/80 border-t-2 border-zinc-700">
                      <td className="px-3 py-3 font-bold text-white text-sm">الإجمالي الكلي</td>
                      <td className="text-center px-3 py-3 font-bold text-white">
                        {data.summary.totalServices.toLocaleString('ar-EG')}
                      </td>
                      <td className="text-center px-3 py-3 font-bold text-white">
                        {data.summary.totalInvoices.toLocaleString('ar-EG')}
                      </td>
                      <td className="text-center px-3 py-3 font-bold text-white whitespace-nowrap">
                        {formatCurrency(data.employees.reduce((sum, e) => sum + (e.grossServiceRevenue ?? e.totalAmount), 0))}
                      </td>
                      <td className="text-center px-3 py-3 font-bold text-amber-400 whitespace-nowrap">
                        -{formatCurrency(data.employees.reduce((sum, e) => sum + (e.allocatedInvoiceDiscount ?? 0), 0))}
                      </td>
                      <td className="text-center px-3 py-3 font-bold text-emerald-400 text-base whitespace-nowrap">
                        {formatCurrency(data.employees.reduce((sum, e) => sum + (e.actualInvoiceRevenue ?? e.totalAmount), 0))}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {/* ═══ Reassign Modal ═══ */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !reassignLoading && setReassignTarget(null)}>
          <div
            className="bg-zinc-900 border border-zinc-700/50 rounded-2xl w-full max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-[#D6A84F]/10 rounded-xl">
                  <ArrowLeftRight className="w-5 h-5 text-[#D6A84F]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">نقل فاتورة لموظف آخر</h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">فاتورة #{reassignTarget.invoiceId}</p>
                </div>
              </div>
              <button
                onClick={() => !reassignLoading && setReassignTarget(null)}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Current info */}
              <div className="bg-zinc-800/50 rounded-xl p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">الموظف الحالي</span>
                  <span className="text-white font-semibold">{reassignTarget.empName}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">الخدمة</span>
                  <span className="text-zinc-300">{reassignTarget.serviceName || '—'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">القيمة</span>
                  <span className="text-emerald-400 font-bold">{formatCurrency(reassignTarget.lineTotal)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">التاريخ</span>
                  <span className="text-zinc-300">{formatDate(reassignTarget.operationDate)}</span>
                </div>
              </div>

              {/* New employee select */}
              <div>
                <label className="block text-xs text-zinc-400 font-medium mb-1.5">نقل إلى موظف</label>
                <select
                  value={reassignNewEmpId}
                  onChange={(e) => { setReassignNewEmpId(e.target.value); setReassignError(''); }}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#D6A84F]/50 transition-colors"
                >
                  <option value="">اختر الموظف الجديد...</option>
                  {empList
                    .filter(e => e.EmpID !== reassignTarget.empId)
                    .map(e => (
                      <option key={e.EmpID} value={e.EmpID}>{e.EmpName}</option>
                    ))
                  }
                </select>
              </div>

              {/* Error */}
              {reassignError && (
                <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-2.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {reassignError}
                </div>
              )}

              {/* Success */}
              {reassignSuccess && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg p-2.5">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  {reassignSuccess}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-zinc-800">
              <Button
                onClick={handleReassign}
                disabled={!reassignNewEmpId || reassignLoading || !!reassignSuccess}
                className="flex-1 bg-[#D6A84F] hover:bg-[#c49640] text-black font-bold rounded-xl h-10 gap-2"
              >
                {reassignLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowLeftRight className="w-4 h-4" />
                )}
                نقل الفاتورة
              </Button>
              <Button
                variant="outline"
                onClick={() => setReassignTarget(null)}
                disabled={reassignLoading}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 rounded-xl h-10"
              >
                إلغاء
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
