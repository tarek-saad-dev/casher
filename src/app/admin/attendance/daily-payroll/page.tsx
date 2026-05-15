'use client';

import { useState, useCallback } from 'react';
import {
  CalendarDays, Loader2, Zap, Send, RefreshCw,
  CheckCircle2, AlertCircle, Users, Banknote,
  CheckCheck, Clock4, X, TrendingDown, TrendingUp, AlertTriangle,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatTime12h } from '@/lib/timeUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayrollRow {
  ID: number;
  EmpID: number;
  EmpName: string;
  WorkDate: string;
  AttendanceStatus: string | null;
  DailyWage: number;
  Status: string;
  CashMoveID: number | null;
  EmployeeIncomeCashMoveID: number | null;
  Notes: string | null;
  CheckInTime: string | null;
  LateMinutes: number | null;
  RevenueExpINID: number | null;
  RevenueCatName: string | null;
  needsIncomeRepair: boolean;
}

interface Summary {
  total: number;
  totalWage: number;
  postedCount: number;
  earnedCount: number;
  repairCount: number;
  totalExpenseAmount: number;
  totalEmployeeIncomeAmount: number;
}

interface MissingEmp {
  EmpID: number;
  EmpName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function attendanceBadge(status: string | null) {
  if (!status) return <span className="text-zinc-600 text-xs">—</span>;
  const map: Record<string, string> = {
    Present:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Late:       'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Absent:     'bg-rose-500/15 text-rose-400 border-rose-500/30',
    DayOff:     'bg-blue-500/15 text-blue-400 border-blue-500/30',
    Excused:    'bg-purple-500/15 text-purple-400 border-purple-500/30',
    Pending:    'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    EarlyLeave: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  };
  const label: Record<string, string> = {
    Present: 'حاضر', Late: 'متأخر', Absent: 'غائب',
    DayOff: 'إجازة', Excused: 'بعذر', Pending: 'لم يسجل', EarlyLeave: 'انصراف مبكر',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${map[status] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'}`}>
      {label[status] ?? status}
    </span>
  );
}

function payrollBadge(status: string) {
  if (status === 'PostedToCashMove') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
        <CheckCheck className="w-3 h-3" /> محوّل
      </span>
    );
  }
  if (status === 'Earned') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-500/15 text-amber-400 border-amber-500/30">
        <Clock4 className="w-3 h-3" /> مكتسب
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-zinc-500/15 text-zinc-400 border-zinc-500/30">
      {status}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyPayrollPage() {
  const [date,               setDate]               = useState(getTodayStr());
  const [rows,               setRows]               = useState<PayrollRow[]>([]);
  const [summary,            setSummary]            = useState<Summary | null>(null);
  const [missingMappingEmps, setMissingMappingEmps] = useState<MissingEmp[]>([]);
  const [loaded,             setLoaded]             = useState(false);
  const [loading,            setLoading]            = useState(false);
  const [generating,         setGenerating]         = useState(false);
  const [posting,            setPosting]            = useState(false);
  const [error,              setError]              = useState('');
  const [successMsg,         setSuccessMsg]         = useState('');

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  // Load payroll rows for date
  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/payroll/daily?workDate=${d}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setMissingMappingEmps(data.missingMappingEmps ?? []);
      setLoaded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Generate payroll from attendance
  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res  = await fetch('/api/payroll/daily/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      flash(`تم توليد ${data.generatedCount} يومية بنجاح`);
      await load(date);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // Post earned rows + repair rows to TblCashMove
  const handlePostToCash = async () => {
    setPosting(true);
    setError('');
    try {
      const res  = await fetch('/api/payroll/daily/post-to-cash', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workDate: date }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.missingEmployees
          ? `${data.error}: ${data.missingEmployees.map((e: any) => e.EmpName).join('، ')}`
          : data.error;
        throw new Error(msg);
      }
      const parts = [];
      if (data.postedCount  > 0) parts.push(`ترحيل ${data.postedCount} يومية`);
      if (data.repairedCount > 0) parts.push(`إصلاح ${data.repairedCount} سجل`);
      if (parts.length === 0) parts.push(data.message ?? 'لا توجد بيانات للمعالجة');
      flash(parts.join(' — ') + (parts.some(p => p.includes('ترحيل') || p.includes('إصلاح')) ? ' بنجاح' : ''));
      if (data.skippedCount > 0 && data.missingMappings?.length > 0) {
        setError(`تم تخطي ${data.skippedCount} موظف بدون تصنيف إيراد: ${data.missingMappings.map((e: any) => e.EmpName).join('، ')}`);
      }
      await load(date);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const handleDateChange = (val: string) => {
    setDate(val);
    setLoaded(false);
    setRows([]);
    setSummary(null);
  };

  const earnedCount = summary?.earnedCount  ?? rows.filter(r => r.Status === 'Earned').length;
  const repairCount  = summary?.repairCount  ?? rows.filter(r => r.needsIncomeRepair).length;
  const canPost      = earnedCount > 0 || repairCount > 0;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" dir="rtl">
      <PageHeader
        title="يوميات الموظفين"
        description="توليد وترحيل اليوميات من الحضور إلى الخزنة"
      >
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={e => handleDateChange(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white w-44 h-10"
          />
          <Button
            variant="outline"
            onClick={() => handleDateChange(getTodayStr())}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-10 gap-1.5"
          >
            <CalendarDays className="w-4 h-4" />
            اليوم
          </Button>
          <Button
            variant="outline"
            onClick={() => load(date)}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-10"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </PageHeader>

      {/* Messages */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="bg-amber-600 hover:bg-amber-700 gap-2 h-11 px-6"
        >
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التوليد...</>
            : <><Zap className="w-4 h-4" />توليد اليوميات من الحضور</>
          }
        </Button>
        <Button
          onClick={handlePostToCash}
          disabled={posting || loading || !canPost}
          className="bg-emerald-700 hover:bg-emerald-600 gap-2 h-11 px-6 disabled:opacity-40"
        >
          {posting
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري المعالجة...</>
            : earnedCount > 0
              ? <><Send className="w-4 h-4" />ترحيل اليوميات إلى الخزنة<Badge className="bg-white/20 text-white text-[10px] px-1.5 mr-1">{earnedCount}</Badge></>
              : <><Send className="w-4 h-4" />إصلاح إيرادات الموظفين<Badge className="bg-white/20 text-white text-[10px] px-1.5 mr-1">{repairCount}</Badge></>
          }
        </Button>
        {!loaded && (
          <Button
            onClick={() => load(date)}
            variant="outline"
            disabled={loading}
            className="border-zinc-700 text-zinc-300 gap-2 h-11"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحميل البيانات
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            title="إجمالي الصفوف"
            value={summary.total}
            icon={<Users className="w-5 h-5" />}
            variant="default"
          />
          <KpiCard
            title="إجمالي اليوميات"
            value={`${fmt(summary.totalWage)} ج.م`}
            icon={<Banknote className="w-5 h-5" />}
            variant="primary"
          />
          <KpiCard
            title="محوّل للخزنة"
            value={summary.postedCount}
            icon={<CheckCheck className="w-5 h-5" />}
            variant="success"
          />
          <KpiCard
            title="مكتسب / معلّق"
            value={summary.earnedCount}
            icon={<Clock4 className="w-5 h-5" />}
            variant="warning"
          />
          <KpiCard
            title="إجمالي مصروفات اليوميات"
            value={`${fmt(summary.totalExpenseAmount)} ج.م`}
            icon={<TrendingDown className="w-5 h-5" />}
            variant="danger"
          />
          <KpiCard
            title="إجمالي إيرادات الموظفين"
            value={`${fmt(summary.totalEmployeeIncomeAmount)} ج.م`}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="success"
          />
        </div>
      )}

      {/* Missing mapping warning */}
      {missingMappingEmps.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">تحذير: موظفون بدون تصنيف إيراد مربوط</p>
            <p className="text-xs text-amber-300/80">لن يمكن ترحيل يومياتهم حتى يتم ربط تصنيف إيراد لكل منهم في صفحة الموظفين:</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {missingMappingEmps.map(e => (
                <span key={e.EmpID} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/20 border border-amber-500/30">
                  {e.EmpName}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-300">
            يوميات {date}
          </h2>
          {loaded && (
            <span className="text-xs text-zinc-500">{rows.length} سجل</span>
          )}
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />
              جاري التحميل...
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <CalendarDays className="w-10 h-10 opacity-30" />
              <p className="text-sm">اختر التاريخ واضغط "توليد" أو "تحميل البيانات"</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm">لا توجد يوميات لهذا اليوم</p>
              <p className="text-xs text-zinc-700">اضغط "توليد اليوميات من الحضور" لإنشاء السجلات</p>
            </div>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-center font-medium">تاريخ العمل</th>
                  <th className="px-4 py-3 text-center font-medium">حالة الحضور</th>
                  <th className="px-4 py-3 text-center font-medium">وقت الحضور</th>
                  <th className="px-4 py-3 text-center font-medium">التأخير</th>
                  <th className="px-4 py-3 text-left font-medium">اليومية</th>
                  <th className="px-4 py-3 text-center font-medium">حالة اليومية</th>
                  <th className="px-4 py-3 text-center font-medium">تصنيف إيراد الموظف</th>
                  <th className="px-4 py-3 text-center font-medium">مصروف الخزنة</th>
                  <th className="px-4 py-3 text-center font-medium">إيراد الموظف</th>
                  <th className="px-4 py-3 text-right font-medium">ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr
                    key={row.ID}
                    className={`border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors ${
                      row.Status === 'PostedToCashMove' ? 'opacity-70' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                          {row.EmpName?.charAt(0)}
                        </div>
                        <span className="font-medium text-white text-sm">{row.EmpName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-400 text-xs whitespace-nowrap">
                      {row.WorkDate?.split('T')[0]}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {attendanceBadge(row.AttendanceStatus)}
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-400 text-xs">
                      {formatTime12h(row.CheckInTime)}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.LateMinutes && row.LateMinutes > 0
                        ? <span className="text-amber-400 font-medium">{row.LateMinutes} د</span>
                        : <span className="text-zinc-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-left font-bold text-white whitespace-nowrap">
                      {fmt(row.DailyWage)}
                      <span className="text-[11px] font-normal text-zinc-500 mr-1">ج.م</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {payrollBadge(row.Status)}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.RevenueCatName
                        ? <span className="text-amber-400 text-[11px]">{row.RevenueCatName}</span>
                        : <span className="inline-flex items-center gap-1 text-rose-400 text-[11px]"><AlertTriangle className="w-3 h-3" />غير مربوط</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.CashMoveID
                        ? <span className="text-rose-400 font-mono text-[11px]">#{row.CashMoveID}</span>
                        : <span className="text-zinc-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.EmployeeIncomeCashMoveID
                        ? <span className="text-emerald-400 font-mono text-[11px]">#{row.EmployeeIncomeCashMoveID}</span>
                        : <span className="text-zinc-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs max-w-[160px] truncate">
                      {row.Notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {summary && summary.total > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                    <td colSpan={5} className="px-4 py-3 text-xs font-bold text-zinc-400">
                      الإجمالي ({summary.total} موظف)
                    </td>
                    <td className="px-4 py-3 text-left font-bold text-white text-base whitespace-nowrap">
                      {fmt(summary.totalWage)}
                      <span className="text-xs font-normal text-zinc-500 mr-1">ج.م</span>
                    </td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
