'use client';

import { useState, useCallback } from 'react';
import {
  Banknote, TrendingUp, Target, ArrowDownCircle,
  CheckCircle2, Loader2, AlertCircle, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import KpiCard    from '@/components/shared/KpiCard';

interface PayrollRow {
  EmpID:                  number;
  EmpName:                string;
  BaseSalary:             number;
  SalaryType:             string;
  TargetCommissionPercent:number;
  TargetMinSales:         number;
  TotalServ:              number;
  MonthlyWorkTotal:       number;
  TargetCommissionAmount: number;
  TotalEmployeeDeductions:number;
  NetSalary:              number;
}

interface PayrollResponse {
  success: boolean;
  from: string;
  to:   string;
  data: PayrollRow[];
  summary: {
    employeesCount:   number;
    totalBaseSalary:  number;
    totalMonthlyWork: number;
    totalCommission:  number;
    totalDeductions:  number;
    totalNetSalary:   number;
  };
}

function fmt(n: number) {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function PayrollSummaryTab() {
  const [from,    setFrom]    = useState(firstOfMonth());
  const [to,      setTo]      = useState(today());
  const [data,    setData]    = useState<PayrollResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/payroll/monthly?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'خطأ في التحميل');
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const s = data?.summary;

  return (
    <div className="space-y-5">
      {/* ── Date range ── */}
      <div className="flex flex-wrap items-end gap-3 p-4 bg-zinc-900/40 border border-zinc-800/60 rounded-xl">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 font-medium">من تاريخ</label>
          <Input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="w-40 bg-zinc-800/50 border-zinc-700 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 font-medium">إلى تاريخ</label>
          <Input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="w-40 bg-zinc-800/50 border-zinc-700 text-sm"
          />
        </div>
        <Button
          onClick={load}
          disabled={loading}
          className="bg-amber-600 hover:bg-amber-700 gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          عرض التقرير
        </Button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── KPI Cards ── */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            title="إجمالي الرواتب الأساسية"
            value={fmt(s.totalBaseSalary)}
            icon={<Banknote className="w-5 h-5" />}
            variant="primary"
          />
          <KpiCard
            title="إجمالي شغل الموظفين"
            value={fmt(s.totalMonthlyWork)}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="default"
          />
          <KpiCard
            title="إجمالي التارجت"
            value={fmt(s.totalCommission)}
            icon={<Target className="w-5 h-5" />}
            variant="warning"
          />
          <KpiCard
            title="إجمالي السلف والخصومات"
            value={fmt(s.totalDeductions)}
            icon={<ArrowDownCircle className="w-5 h-5" />}
            variant="danger"
          />
          <KpiCard
            title="صافي الرواتب المستحقة"
            value={fmt(s.totalNetSalary)}
            icon={<CheckCircle2 className="w-5 h-5" />}
            variant="success"
          />
        </div>
      )}

      {/* ── Table ── */}
      {data && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-300">
              تفاصيل المرتبات — {s?.employeesCount} موظف
            </h3>
            <span className="text-xs text-zinc-500">
              {from} → {to}
            </span>
          </div>

          {data.data.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد بيانات في هذه الفترة</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-right font-medium">الموظف</th>
                    <th className="px-4 py-3 text-right font-medium">الراتب الأساسي</th>
                    <th className="px-4 py-3 text-right font-medium">عدد الخدمات</th>
                    <th className="px-4 py-3 text-right font-medium">إجمالي الشغل</th>
                    <th className="px-4 py-3 text-right font-medium">نسبة التارجت</th>
                    <th className="px-4 py-3 text-right font-medium">قيمة التارجت</th>
                    <th className="px-4 py-3 text-right font-medium">السلف/الخصومات</th>
                    <th className="px-4 py-3 text-right font-medium">صافي الراتب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {data.data.map(row => (
                    <tr key={row.EmpID} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-white">{row.EmpName}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                        {fmt(row.BaseSalary)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 bg-zinc-800/60 rounded text-xs text-zinc-400">
                          {row.TotalServ}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                        {fmt(row.MonthlyWorkTotal)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.TargetCommissionPercent > 0 ? (
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded text-xs font-medium">
                            {row.TargetCommissionPercent}%
                          </span>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {row.TargetCommissionAmount > 0 ? (
                          <span className="text-amber-400">{fmt(row.TargetCommissionAmount)}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {row.TotalEmployeeDeductions > 0 ? (
                          <span className="text-rose-400">{fmt(row.TotalEmployeeDeductions)}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold font-mono text-sm ${
                          row.NetSalary >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {fmt(row.NetSalary)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-700 bg-zinc-900/60">
                    <td className="px-4 py-3 text-xs font-semibold text-zinc-400">الإجمالي</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{fmt(s!.totalBaseSalary)}</td>
                    <td className="px-4 py-3 text-center text-xs text-zinc-500">
                      {data.data.reduce((a, r) => a + r.TotalServ, 0)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{fmt(s!.totalMonthlyWork)}</td>
                    <td />
                    <td className="px-4 py-3 font-mono text-xs text-amber-400">{fmt(s!.totalCommission)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-rose-400">{fmt(s!.totalDeductions)}</td>
                    <td className="px-4 py-3 font-bold font-mono text-sm text-emerald-400">{fmt(s!.totalNetSalary)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Empty initial state ── */}
      {!data && !loading && !error && (
        <div className="p-12 text-center text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
          <Banknote className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">اختر الفترة الزمنية واضغط "عرض التقرير"</p>
        </div>
      )}
    </div>
  );
}
