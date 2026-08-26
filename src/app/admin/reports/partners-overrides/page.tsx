'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Loader2, Plus, RotateCcw, Save, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ARABIC_MONTHS, REPORT_YEARS, formatPartnersCurrency } from '@/components/reports/partners/partnersReportUtils';
import {
  applyFieldAdjust,
  describeFieldAdjust,
  normalizeFieldAdjust,
  PARTNERS_FIELD_ADJUST_MODE_LABELS,
  type PartnersFieldAdjust,
  type PartnersFieldAdjustMode,
} from '@/lib/reports/partnersEmployeeOverrides';

interface ControlLive {
  shopRevenue: number | null;
  salaryAndTarget: number;
  advanceExcess: number;
  ledgerSalary: number;
  ledgerTarget: number;
}

interface ControlOverride {
  actualRevenue?: number | PartnersFieldAdjust;
  salaryAndTarget?: number | PartnersFieldAdjust;
  advanceExcess?: number | PartnersFieldAdjust;
  note?: string;
}

interface ControlEmployee {
  employeeId: number;
  employeeName: string;
  isServiceWorker: boolean;
  live: ControlLive;
  override: ControlOverride | null;
}

interface FieldFormState {
  mode: PartnersFieldAdjustMode;
  value: string;
}

interface FormRow {
  employeeId: number;
  employeeName: string;
  shopRevenue: FieldFormState;
  salaryAndTarget: FieldFormState;
  advanceExcess: FieldFormState;
  note: string;
  live: ControlLive;
}

interface OverridesResponse {
  year: number;
  month: number;
  monthKey: string;
  branchId: number;
  branchCode: string;
  branchName: string;
  employees: ControlEmployee[];
  presetEmployees: Array<{ employeeId: number; label: string }>;
  catalog: Array<{ employeeId: number; employeeName: string }>;
}

const MODE_OPTIONS: PartnersFieldAdjustMode[] = [
  'live',
  'static',
  'subtract_pct',
  'keep_pct',
  'subtract_amt',
  'add_amt',
  'add_pct',
];

function parseMonthFromParams(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return fallback;
  return parsed;
}

function parseYearFromParams(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function liveFieldState(): FieldFormState {
  return { mode: 'live', value: '' };
}

function adjustToForm(raw: number | PartnersFieldAdjust | undefined): FieldFormState {
  const rule = normalizeFieldAdjust(raw);
  if (!rule) return liveFieldState();
  return { mode: rule.mode, value: String(rule.value) };
}

function formToAdjust(state: FieldFormState): PartnersFieldAdjust | undefined {
  if (state.mode === 'live') return undefined;
  const trimmed = state.value.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return { mode: state.mode, value: n };
}

function employeeToForm(emp: ControlEmployee): FormRow {
  return {
    employeeId: emp.employeeId,
    employeeName: emp.employeeName,
    shopRevenue: adjustToForm(emp.override?.actualRevenue),
    salaryAndTarget: adjustToForm(emp.override?.salaryAndTarget),
    advanceExcess: adjustToForm(emp.override?.advanceExcess),
    note: emp.override?.note ?? '',
    live: emp.live,
  };
}

function fieldIsActive(state: FieldFormState): boolean {
  return formToAdjust(state) !== undefined;
}

function valuePlaceholder(mode: PartnersFieldAdjustMode): string {
  switch (mode) {
    case 'static':
      return 'المبلغ الثابت';
    case 'subtract_pct':
    case 'keep_pct':
    case 'add_pct':
      return 'النسبة %';
    case 'subtract_amt':
    case 'add_amt':
      return 'المبلغ';
    default:
      return '';
  }
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
  const [rows, setRows] = useState<FormRow[]>([]);
  const [catalog, setCatalog] = useState<OverridesResponse['catalog']>([]);
  const [presets, setPresets] = useState<OverridesResponse['presetEmployees']>([]);
  const [branchName, setBranchName] = useState('');
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
      setRows(data.employees.map(employeeToForm));
      setCatalog(data.catalog);
      setPresets(data.presetEmployees);
      setBranchName(data.branchName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'تعديل | نظام نقاط البيع';
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

  const updateRow = (employeeId: number, patch: Partial<FormRow>) => {
    setRows((current) =>
      current.map((row) => (row.employeeId === employeeId ? { ...row, ...patch } : row))
    );
  };

  const updateField = (
    employeeId: number,
    key: 'shopRevenue' | 'salaryAndTarget' | 'advanceExcess',
    patch: Partial<FieldFormState>
  ) => {
    setRows((current) =>
      current.map((row) => {
        if (row.employeeId !== employeeId) return row;
        const next = { ...row[key], ...patch };
        if (patch.mode === 'live') next.value = '';
        return { ...row, [key]: next };
      })
    );
  };

  const resetRow = (employeeId: number) => {
    setRows((current) =>
      current.map((row) =>
        row.employeeId === employeeId
          ? {
              ...row,
              shopRevenue: liveFieldState(),
              salaryAndTarget: liveFieldState(),
              advanceExcess: liveFieldState(),
              note: '',
            }
          : row
      )
    );
  };

  const addEmployee = (employeeId: number) => {
    if (rows.some((row) => row.employeeId === employeeId)) return;
    const employee = catalog.find((e) => e.employeeId === employeeId);
    setRows((current) => [
      ...current,
      {
        employeeId,
        employeeName: employee?.employeeName ?? `موظف #${employeeId}`,
        shopRevenue: liveFieldState(),
        salaryAndTarget: liveFieldState(),
        advanceExcess: liveFieldState(),
        note: '',
        live: {
          shopRevenue: null,
          salaryAndTarget: 0,
          advanceExcess: 0,
          ledgerSalary: 0,
          ledgerTarget: 0,
        },
      },
    ]);
  };

  const addSelectedEmployee = () => {
    const employeeId = parseInt(addEmpId, 10);
    if (!employeeId) return;
    addEmployee(employeeId);
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
        entries: rows.map((row) => ({
          employeeId: row.employeeId,
          actualRevenue: formToAdjust(row.shopRevenue),
          salaryAndTarget: formToAdjust(row.salaryAndTarget),
          advanceExcess: formToAdjust(row.advanceExcess),
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

      const employees = (json.employees as ControlEmployee[] | undefined) ?? [];
      setRows(employees.map(employeeToForm));
      setSuccess('تم حفظ التعديلات — تقرير الشركاء هيتحسب بالقيم الجديدة');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const availableEmployees = catalog.filter(
    (emp) => !rows.some((row) => row.employeeId === emp.employeeId)
  );

  const overriddenCount = rows.filter((row) =>
    fieldIsActive(row.shopRevenue) ||
    fieldIsActive(row.salaryAndTarget) ||
    fieldIsActive(row.advanceExcess) ||
    row.note.trim() !== ''
  ).length;

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto" dir="rtl">
      <PageHeader
        title="تعديل"
        description="طبقة وسط بين أرقام النظام وتقرير الشركاء — ثبّت الرقم أو خصم/أضف نسبة أو مبلغ، والحسابات هناك تتبع النتيجة"
      >
        <Link href={`/admin/reports/partners?year=${year}&month=${month}`}>
          <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-2">
            <ExternalLink className="w-4 h-4" />
            عرض تقرير الشركاء
          </Button>
        </Link>
      </PageHeader>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-zinc-300 space-y-1">
        <p>
          مثال: ديناميك 10,000 + خصم نسبة 10% = 9,000 · أو خصم مبلغ 3,000 = 7,000 · أو رقم ثابت 8,500.
        </p>
        <p className="text-zinc-500 text-xs">
          التعديل يظهر في تقرير الشركاء فقط ولا يغيّر الخزنة أو دفتر الموظف.
          {branchName ? ` · الفرع الحالي: ${branchName}` : ''}
        </p>
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
          حفظ وتطبيق على التقرير
        </Button>

        {!loading && (
          <span className="text-xs text-zinc-500">
            {overriddenCount > 0 ? `${overriddenCount} موظف بتعديل` : 'كل الأرقام من النظام'}
          </span>
        )}
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
            disabled={rows.some((row) => row.employeeId === preset.employeeId)}
            onClick={() => addEmployee(preset.employeeId)}
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
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="text-right p-3 font-medium">الموظف</th>
                  <th className="text-right p-3 font-medium">دخل للمحل</th>
                  <th className="text-right p-3 font-medium">استلم راتب (راتب + تارجت)</th>
                  <th className="text-right p-3 font-medium">سلف</th>
                  <th className="text-right p-3 font-medium">ملاحظة داخلية</th>
                  <th className="text-center p-3 font-medium w-16">إعادة</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-zinc-500">
                      لا يوجد موظفون في هذا الشهر — أضف موظفاً للبدء
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const shopOver = fieldIsActive(row.shopRevenue);
                    const salaryOver = fieldIsActive(row.salaryAndTarget);
                    const advanceOver = fieldIsActive(row.advanceExcess);
                    const isOver = shopOver || salaryOver || advanceOver || row.note.trim() !== '';
                    return (
                      <tr
                        key={row.employeeId}
                        className={`border-b border-zinc-800/60 ${isOver ? 'bg-amber-500/5' : ''}`}
                      >
                        <td className="p-3 text-white font-medium whitespace-nowrap align-top">
                          <div className="flex items-center gap-2 pt-1">
                            {row.employeeName}
                            {isOver && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                معدّل
                              </span>
                            )}
                          </div>
                        </td>
                        <FieldAdjustCell
                          state={row.shopRevenue}
                          live={row.live.shopRevenue}
                          onChange={(patch) => updateField(row.employeeId, 'shopRevenue', patch)}
                        />
                        <FieldAdjustCell
                          state={row.salaryAndTarget}
                          live={row.live.salaryAndTarget}
                          hint={`راتب ${formatPartnersCurrency(row.live.ledgerSalary)} + تارجت ${formatPartnersCurrency(row.live.ledgerTarget)}`}
                          onChange={(patch) => updateField(row.employeeId, 'salaryAndTarget', patch)}
                        />
                        <FieldAdjustCell
                          state={row.advanceExcess}
                          live={row.live.advanceExcess}
                          onChange={(patch) => updateField(row.employeeId, 'advanceExcess', patch)}
                        />
                        <td className="p-3 align-top">
                          <Input
                            value={row.note}
                            onChange={(e) => updateRow(row.employeeId, { note: e.target.value })}
                            placeholder="اختياري — لا تظهر للشركاء"
                            className="bg-zinc-800 border-zinc-700 text-white h-9"
                          />
                        </td>
                        <td className="p-3 text-center align-top">
                          <button
                            type="button"
                            onClick={() => resetRow(row.employeeId)}
                            disabled={!isOver}
                            className="p-2 rounded-lg text-zinc-500 hover:text-amber-300 hover:bg-amber-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="إعادة لأرقام النظام"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-4">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
          <label className="text-xs text-zinc-400">إضافة موظف غير ظاهر في الشهر</label>
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

function FieldAdjustCell({
  state,
  live,
  hint,
  onChange,
}: {
  state: FieldFormState;
  live: number | null;
  hint?: string;
  onChange: (patch: Partial<FieldFormState>) => void;
}) {
  const active = fieldIsActive(state);
  const preview = applyFieldAdjust(live, formToAdjust(state)).value;
  const formula = describeFieldAdjust(live, formToAdjust(state));

  return (
    <td className="p-3 align-top min-w-[220px]">
      <div className="space-y-2">
        <Select
          value={state.mode}
          onValueChange={(v) => onChange({ mode: v as PartnersFieldAdjustMode })}
        >
          <SelectTrigger
            className={`h-9 text-xs bg-zinc-800 border-zinc-700 text-white ${
              active ? 'border-amber-500/40' : ''
            }`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-700">
            {MODE_OPTIONS.map((mode) => (
              <SelectItem key={mode} value={mode} className="text-white text-xs">
                {PARTNERS_FIELD_ADJUST_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {state.mode !== 'live' && (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={state.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={valuePlaceholder(state.mode)}
            className={`h-9 text-white ${
              active
                ? 'bg-amber-500/10 border-amber-500/40'
                : 'bg-zinc-800 border-zinc-700'
            }`}
          />
        )}

        <p className="text-[11px] text-zinc-500 leading-relaxed">
          من النظام: {live == null ? '—' : formatPartnersCurrency(live)}
          {hint ? ` · ${hint}` : ''}
        </p>
        {active && state.value.trim() !== '' && (
          <p className="text-[11px] text-amber-300/90 leading-relaxed">
            النتيجة: {formatPartnersCurrency(preview)}
            {formula ? ` · ${formula}` : ''}
          </p>
        )}
      </div>
    </td>
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
