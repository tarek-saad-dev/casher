'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Loader2, Plus, Save, Trash2, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ARABIC_MONTHS, REPORT_YEARS } from '@/components/reports/partners/partnersReportUtils';

interface OverrideEntry {
  employeeId: number;
  employeeName: string;
  actualRevenue: string;
  paidSalaryOrAdvance: string;
  note: string;
}

interface OverridesResponse {
  year: number;
  month: number;
  monthKey: string;
  entries: Array<{
    employeeId: number;
    employeeName: string;
    actualRevenue?: number;
    paidSalaryOrAdvance?: number;
    note?: string;
  }>;
  presetEmployees: Array<{ employeeId: number; label: string }>;
  employees: Array<{ employeeId: number; employeeName: string }>;
}

function parseMonthFromParams(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return fallback;
  return parsed;
}

function parseYearFromParams(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function entryToForm(entry: OverridesResponse['entries'][number]): OverrideEntry {
  return {
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    actualRevenue: entry.actualRevenue !== undefined ? String(entry.actualRevenue) : '',
    paidSalaryOrAdvance:
      entry.paidSalaryOrAdvance !== undefined ? String(entry.paidSalaryOrAdvance) : '',
    note: entry.note ?? '',
  };
}

function PartnersOverridesPageContent() {
  const now = new Date();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [year, setYear] = useState(() =>
    parseYearFromParams(searchParams.get('year'), now.getFullYear())
  );
  const [month, setMonth] = useState(() =>
    parseMonthFromParams(searchParams.get('month'), now.getMonth() + 1)
  );
  const [entries, setEntries] = useState<OverrideEntry[]>([]);
  const [employees, setEmployees] = useState<OverridesResponse['employees']>([]);
  const [presets, setPresets] = useState<OverridesResponse['presetEmployees']>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addEmpId, setAddEmpId] = useState('');

  const syncUrl = useCallback((newYear: number, newMonth: number) => {
    router.replace(`${pathname}?year=${newYear}&month=${newMonth}`, { scroll: false });
  }, [pathname, router]);

  const fetchData = useCallback(async (targetYear: number, targetMonth: number) => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(
        `/api/admin/reports/partners-overrides?year=${targetYear}&month=${targetMonth}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تحميل الإعدادات');
      const data = json as OverridesResponse;
      setEntries(data.entries.map(entryToForm));
      setEmployees(data.employees);
      setPresets(data.presetEmployees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'الحسابات الخاصة للشركاء | نظام نقاط البيع';
  }, []);

  useEffect(() => {
    const urlYear = parseYearFromParams(searchParams.get('year'), year);
    const urlMonth = parseMonthFromParams(searchParams.get('month'), month);
    if (urlYear !== year) setYear(urlYear);
    if (urlMonth !== month) setMonth(urlMonth);
    fetchData(urlYear, urlMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const applyPeriod = (newYear: number, newMonth: number) => {
    setYear(newYear);
    setMonth(newMonth);
    syncUrl(newYear, newMonth);
    fetchData(newYear, newMonth);
  };

  const updateEntry = (employeeId: number, patch: Partial<OverrideEntry>) => {
    setEntries((rows) =>
      rows.map((row) => (row.employeeId === employeeId ? { ...row, ...patch } : row))
    );
  };

  const removeEntry = (employeeId: number) => {
    setEntries((rows) => rows.filter((row) => row.employeeId !== employeeId));
  };

  const addPreset = (employeeId: number) => {
    if (entries.some((row) => row.employeeId === employeeId)) return;
    const employee = employees.find((e) => e.employeeId === employeeId);
    setEntries((rows) => [
      ...rows,
      {
        employeeId,
        employeeName: employee?.employeeName ?? `موظف #${employeeId}`,
        actualRevenue: '',
        paidSalaryOrAdvance: '',
        note: '',
      },
    ]);
  };

  const addSelectedEmployee = () => {
    const employeeId = parseInt(addEmpId, 10);
    if (!employeeId) return;
    addPreset(employeeId);
    setAddEmpId('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        year,
        month,
        entries: entries.map((row) => ({
          employeeId: row.employeeId,
          actualRevenue: row.actualRevenue === '' ? undefined : Number(row.actualRevenue),
          paidSalaryOrAdvance:
            row.paidSalaryOrAdvance === '' ? undefined : Number(row.paidSalaryOrAdvance),
          note: row.note.trim() || undefined,
        })),
      };

      const res = await fetch('/api/admin/reports/partners-overrides', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل الحفظ');

      setEntries((json.entries as OverridesResponse['entries']).map(entryToForm));
      setSuccess('تم حفظ الحسابات الخاصة بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const availableEmployees = employees.filter(
    (emp) => !entries.some((row) => row.employeeId === emp.employeeId)
  );

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto" dir="rtl">
      <PageHeader
        title="الحسابات الخاصة للشركاء"
        description="إدخال الأرقام اليدوية التي تظهر في تقرير الشركاء فقط — لا تؤثر على باقي التقارير"
      >
        <Link href={`/admin/reports/partners?year=${year}&month=${month}`}>
          <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-2">
            <ExternalLink className="w-4 h-4" />
            عرض تقرير الشركاء
          </Button>
        </Link>
      </PageHeader>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-zinc-300">
        هذه الصفحة للإدارة فقط. تقرير الشركاء يعرض النتائج النهائية للقراءة فقط ولا يمكن تعديلها من هناك.
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-400">الشهر</label>
          <Select value={String(month)} onValueChange={(v) => applyPeriod(year, parseInt(v, 10))}>
            <SelectTrigger className="w-40 bg-zinc-800 border-zinc-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {ARABIC_MONTHS.map((name, index) => (
                <SelectItem key={index + 1} value={String(index + 1)} className="text-white">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-400">السنة</label>
          <Select value={String(year)} onValueChange={(v) => applyPeriod(parseInt(v, 10), month)}>
            <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {REPORT_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-white">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-[#D6A84F] hover:bg-[#c49640] text-black font-bold gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ الشهر
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-400 text-sm">
          {success}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.employeeId}
            type="button"
            variant="outline"
            size="sm"
            disabled={entries.some((row) => row.employeeId === preset.employeeId)}
            onClick={() => addPreset(preset.employeeId)}
            className="border-zinc-700 text-zinc-300"
          >
            <Plus className="w-3.5 h-3.5 ml-1" />
            إضافة {preset.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[#D6A84F]" />
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="text-right p-3 font-medium">الموظف</th>
                  <th className="text-right p-3 font-medium">دخل للمحل (فعلي)</th>
                  <th className="text-right p-3 font-medium">استلم راتب / سلف</th>
                  <th className="text-right p-3 font-medium">ملاحظة داخلية</th>
                  <th className="text-center p-3 font-medium w-16">حذف</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-zinc-500">
                      لا توجد حسابات خاصة لهذا الشهر — أضف موظفاً للبدء
                    </td>
                  </tr>
                ) : (
                  entries.map((row) => (
                    <tr key={row.employeeId} className="border-b border-zinc-800/60">
                      <td className="p-3 text-white font-medium whitespace-nowrap">
                        {row.employeeName}
                      </td>
                      <td className="p-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.actualRevenue}
                          onChange={(e) =>
                            updateEntry(row.employeeId, { actualRevenue: e.target.value })
                          }
                          placeholder="اتركه فارغاً لعدم التعديل"
                          className="bg-zinc-800 border-zinc-700 text-white h-9"
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.paidSalaryOrAdvance}
                          onChange={(e) =>
                            updateEntry(row.employeeId, { paidSalaryOrAdvance: e.target.value })
                          }
                          placeholder="اتركه فارغاً لعدم التعديل"
                          className="bg-zinc-800 border-zinc-700 text-white h-9"
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          value={row.note}
                          onChange={(e) => updateEntry(row.employeeId, { note: e.target.value })}
                          placeholder="اختياري — لا تظهر للشركاء"
                          className="bg-zinc-800 border-zinc-700 text-white h-9"
                        />
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => removeEntry(row.employeeId)}
                          className="p-2 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-4">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
          <label className="text-xs text-zinc-400">إضافة موظف آخر</label>
          <Select value={addEmpId} onValueChange={setAddEmpId}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
              <SelectValue placeholder="اختر موظفاً" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 max-h-64">
              {availableEmployees.map((emp) => (
                <SelectItem key={emp.employeeId} value={String(emp.employeeId)} className="text-white">
                  {emp.employeeName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={addSelectedEmployee}
          disabled={!addEmpId}
          className="border-zinc-700 text-zinc-300"
        >
          <Plus className="w-4 h-4 ml-1" />
          إضافة
        </Button>
      </div>
    </div>
  );
}

export default function PartnersOverridesPage() {
  return (
    <Suspense fallback={
      <div className="p-6 text-zinc-400" dir="rtl">جاري التحميل...</div>
    }>
      <PartnersOverridesPageContent />
    </Suspense>
  );
}
