'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, CalendarDays, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

interface MonthlyEmployeeOption {
  EmpID: number;
  EmpName: string;
  PayrollMethod?: string | null;
  SalaryType?: string | null;
  BaseSalary?: number | null;
}

interface PreviewRow {
  empId: number;
  empName: string;
  amount: number;
  status: string;
  existingLedgerEntryId: number | null;
  existingAmount: number | null;
  notes: string;
  error?: string;
}

interface PostResponse {
  success: boolean;
  dryRun: boolean;
  month: string;
  postingDate: string;
  totalAmount: number;
  counts: {
    eligible: number;
    inserted: number;
    updated: number;
    alreadyPosted: number;
    skipped: number;
    errors: number;
  };
  rows: PreviewRow[];
  error?: string;
}

interface MonthlySalaryPostModalProps {
  open: boolean;
  onClose: () => void;
  defaultMonth: string;
  dualWriteEnabled: boolean;
  onSuccess: (message: string) => void;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'جديد',
    alreadyPosted: 'موجود',
    willUpdate: 'سيتم التحديث',
    skipped: 'مستثنى',
    error: 'خطأ',
  };
  return map[status] ?? status;
}

function isMonthlyEmployee(emp: MonthlyEmployeeOption): boolean {
  if (emp.PayrollMethod === 'monthly') return true;
  if (!emp.PayrollMethod && emp.SalaryType === 'monthly') return true;
  return false;
}

export default function MonthlySalaryPostModal({
  open,
  onClose,
  defaultMonth,
  dualWriteEnabled,
  onSuccess,
}: MonthlySalaryPostModalProps) {
  const [month, setMonth] = useState(defaultMonth);
  const [postingDate, setPostingDate] = useState(lastDayOfMonth(defaultMonth));
  const [empScope, setEmpScope] = useState<'all' | 'one'>('all');
  const [empId, setEmpId] = useState('');
  const [employees, setEmployees] = useState<MonthlyEmployeeOption[]>([]);
  const [preview, setPreview] = useState<PostResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const monthlyEmployees = employees.filter(
    (e) => isMonthlyEmployee(e) && (e.BaseSalary ?? 0) > 0,
  );

  const reset = useCallback(() => {
    setMonth(defaultMonth);
    setPostingDate(lastDayOfMonth(defaultMonth));
    setEmpScope('all');
    setEmpId('');
    setPreview(null);
    setError('');
  }, [defaultMonth]);

  useEffect(() => {
    if (!open) return;
    reset();
    void (async () => {
      try {
        const res = await fetch('/api/employees');
        const data = await res.json();
        if (res.ok && Array.isArray(data)) setEmployees(data);
      } catch {
        /* optional */
      }
    })();
  }, [open, reset]);

  useEffect(() => {
    setPostingDate(lastDayOfMonth(month));
    setPreview(null);
  }, [month]);

  const callPost = async (dryRun: boolean) => {
    const body: Record<string, unknown> = {
      month,
      postingDate,
      dryRun,
    };
    if (empScope === 'one' && empId) body.empId = parseInt(empId, 10);

    const res = await fetch('/api/admin/hr/employee-ledger/monthly-salary/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: PostResponse = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'فشل الترحيل');
    return data;
  };

  const handlePreview = async () => {
    setLoadingPreview(true);
    setError('');
    try {
      const data = await callPost(true);
      setPreview(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل المعاينة');
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError('');
    try {
      const data = await callPost(false);
      setPreview(data);
      const parts: string[] = [];
      if (data.counts.inserted > 0) parts.push(`إضافة ${data.counts.inserted}`);
      if (data.counts.updated > 0) parts.push(`تحديث ${data.counts.updated}`);
      if (data.counts.alreadyPosted > 0) parts.push(`${data.counts.alreadyPosted} موجود مسبقاً`);
      onSuccess(
        parts.length > 0
          ? `تم ترحيل الرواتب الشهرية — ${parts.join(' · ')}`
          : 'لا توجد قيود جديدة للترحيل',
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التنفيذ');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <CalendarDays className="w-5 h-5 text-sky-400" />
            ترحيل الرواتب الشهرية للدفتر
          </DialogTitle>
        </DialogHeader>

        {!dualWriteEnabled && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">
            يتطلب تفعيل <code className="text-amber-200">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code>
          </div>
        )}

        <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            هذا الترحيل لا ينشئ حركة خزنة. يتم تسجيل استحقاق الراتب فقط في دفتر الموظف.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">الشهر</label>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">تاريخ القيد</label>
            <Input
              type="date"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-zinc-500 mb-1 block">الموظفون</label>
          <Select value={empScope} onValueChange={(v) => { setEmpScope(v as 'all' | 'one'); setPreview(null); }}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all">كل الموظفين الشهريين</SelectItem>
              <SelectItem value="one">موظف محدد</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {empScope === 'one' && (
          <Select value={empId} onValueChange={(v) => { setEmpId(v); setPreview(null); }}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700">
              <SelectValue placeholder="اختر موظفاً" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700 max-h-56">
              {monthlyEmployees.map((e) => (
                <SelectItem key={e.EmpID} value={String(e.EmpID)}>
                  {e.EmpName} — {fmt(Number(e.BaseSalary ?? 0))} ج.م
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {error && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <span>إجمالي: {fmt(preview.totalAmount)} ج.م</span>
              <span>· جديد: {preview.counts.inserted}</span>
              <span>· تحديث: {preview.counts.updated}</span>
              <span>· موجود: {preview.counts.alreadyPosted}</span>
            </div>
            <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/80 text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 text-right">الموظف</th>
                    <th className="px-3 py-2 text-left">الراتب</th>
                    <th className="px-3 py-2 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.empId} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-zinc-200">{row.empName}</td>
                      <td className="px-3 py-2 text-left text-emerald-400">{fmt(row.amount)}</td>
                      <td className="px-3 py-2 text-center text-zinc-400">{statusLabel(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
          <Button variant="outline" onClick={onClose} className="border-zinc-700">
            إلغاء
          </Button>
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={!dualWriteEnabled || loadingPreview || applying || (empScope === 'one' && !empId)}
            className="border-sky-600/40 text-sky-400"
          >
            {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : 'معاينة'}
          </Button>
          <Button
            onClick={handleApply}
            disabled={!dualWriteEnabled || !preview || applying || loadingPreview}
            className="bg-sky-700 hover:bg-sky-600"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'تنفيذ الترحيل'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
