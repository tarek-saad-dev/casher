'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Users, Plus, CheckCircle2, AlertCircle,
  Loader2, UserPlus, Link2, Scissors, X, Zap, Settings, Clock, UserX, UserCheck,
  Banknote, CalendarCheck, Wallet, UsersRound, BookOpen, Scale, MessageCircle,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { parseTimeToMinutes } from '@/lib/timeUtils';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { JobType } from '@/lib/types';

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground/70">
      <Loader2 className="w-5 h-5 animate-spin ml-2" />
      <span className="text-sm">جاري التحميل...</span>
    </div>
  );
}

const PayrollSettingsTab = dynamic(() => import('@/components/payroll/PayrollSettingsTab'), { ssr: false, loading: () => <TabLoader /> });
const AttendancePanel        = dynamic(() => import('@/components/hr/AttendancePanel'),                              { ssr: false, loading: () => <TabLoader /> });
const DailyPayrollPanel      = dynamic(() => import('@/components/hr/DailyPayrollPanel'),                            { ssr: false, loading: () => <TabLoader /> });
const EmployeeAdvancesSection = dynamic(() => import('@/components/reports/expenses/EmployeeAdvancesSection'),       { ssr: false, loading: () => <TabLoader /> });
const EmployeeLedgerPanel     = dynamic(() => import('@/components/hr/EmployeeLedgerPanel'),                        { ssr: false, loading: () => <TabLoader /> });
const EmployeeLedgerReconciliationPanel = dynamic(
  () => import('@/components/hr/EmployeeLedgerReconciliationPanel'),
  { ssr: false, loading: () => <TabLoader /> },
);

/* ─── types ─────────────────────────────────────────── */
interface Employee {
  EmpID: number;
  EmpName: string;
  Job: JobType | string | null;
  isActive: boolean;
  BaseSalary: number | null;
  TargetCommissionPercent: number | null;
  TargetMinSales: number | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  WorkScheduleNotes: string | null;
  IsPayrollEnabled: boolean | null;
  HourlyRate: number | null;
  AdvanceExpINID: number | null;
  AdvanceCatName: string | null;
  RevenueExpINID: number | null;
  RevenueCatName: string | null;
  WhatsApp?: string | null;
  Mobile?: string | null;
}

/* ─── main tabs ──────────────────────────────────────── */

const MAIN_TABS = [
  { id: 'employees',        label: 'الموظفون',          icon: UsersRound },
  { id: 'attendance',      label: 'متابعة الحضور',     icon: CalendarCheck },
  { id: 'daily-payroll',   label: 'يوميات الموظفين',   icon: Banknote },
  { id: 'emp-advances',    label: 'سلف الموظفين',     icon: Wallet },
  { id: 'employee-ledger', label: 'دفتر الموظفين',    icon: BookOpen },
  { id: 'employee-ledger-reconciliation', label: 'مراجعة الدفتر', icon: Scale },
  { id: 'employee-settings', label: 'إعدادات الموظفين', icon: Settings },
] as const;
type MainTabId = typeof MAIN_TABS[number]['id'];

// Legacy query-param values that should map to the new employee-settings tab
const LEGACY_TAB_ALIASES: Record<string, MainTabId> = {
  payroll: 'employee-settings',
  salaries: 'employee-settings',
  settings: 'employee-settings',
  'employee-settings': 'employee-settings',
};

/* ══════════════════════════════════════════════════════ */
export default function HRPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mainTab, setMainTab] = useState<MainTabId>(() => {
    const t = searchParams.get('tab');
    const resolved = t ? LEGACY_TAB_ALIASES[t] || (MAIN_TABS.find(tab => tab.id === t)?.id) : undefined;
    return resolved ?? 'employees';
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const t = searchParams.get('tab');
    const resolved = t ? LEGACY_TAB_ALIASES[t] || (MAIN_TABS.find(tab => tab.id === t)?.id) : undefined;
    if (resolved && resolved !== mainTab) setMainTab(resolved);
  }, [searchParams, mainTab]);

  const handleTabChange = useCallback((id: MainTabId) => {
    setMainTab(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', id);
    router.replace(`/admin/hr?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  if (!mounted) {
    return (
      <div className="p-6 max-w-7xl mx-auto" dir="rtl">
        <PageHeader
          title="إدارة الموارد البشرية"
          description="إدارة الموظفين، الرواتب، الحضور، والسلف في مكان واحد"
        />
        <div className="flex items-center justify-center py-24 text-muted-foreground/70">
          <Loader2 className="w-6 h-6 animate-spin ml-2" />
          <span className="text-sm">جاري التحميل...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-0" dir="rtl">
      {/* ── Page Header ── */}
      <PageHeader
        title="إدارة الموارد البشرية"
        description="إدارة الموظفين، الرواتب، الحضور، والسلف في مكان واحد"
      />

      {/* ── Main Tab Switcher ── */}
      <div className="flex gap-1 p-1 bg-surface/60 border border-border/60 rounded-xl w-fit mb-6">
        {MAIN_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mainTab === id
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted/60'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab Panels ── */}
      {mainTab === 'employees'        && <EmployeesPanel />}
      {mainTab === 'attendance'         && <AttendancePanel />}
      {mainTab === 'daily-payroll'    && <DailyPayrollPanel />}
      {mainTab === 'emp-advances'     && <AdvancesReportPanel />}
      {mainTab === 'employee-ledger'  && <EmployeeLedgerPanel />}
      {mainTab === 'employee-ledger-reconciliation' && <EmployeeLedgerReconciliationPanel />}
      {mainTab === 'employee-settings' && <EmployeeSettingsPanel />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PANEL 1 — Employees
   ══════════════════════════════════════════════════════ */
function EmployeesPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('');

  const [open,      setOpen]     = useState(false);
  const [empName,   setEmpName]  = useState('');
  const [saving,    setSaving]   = useState(false);
  const [saveErr,   setSaveErr]  = useState('');
  const [lastAdded, setLastAdded] = useState<Employee | null>(null);

  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [advanceCategories, setAdvanceCategories] = useState<any[]>([]);
  const [revenueCategories, setRevenueCategories] = useState<any[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<string>('');
  const [selectedRevenue, setSelectedRevenue] = useState<string>('');
  const [financeSaving, setFinanceSaving] = useState(false);
  const [financeError, setFinanceError] = useState('');

  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMappingResult, setAutoMappingResult] = useState<any>(null);
  const [showAutoMappingModal, setShowAutoMappingModal] = useState(false);

  const [workHoursModalOpen, setWorkHoursModalOpen] = useState(false);
  const [selectedWorkHoursEmployee, setSelectedWorkHoursEmployee] = useState<Employee | null>(null);
  const [workHoursSaving, setWorkHoursSaving] = useState(false);
  const [workHoursError, setWorkHoursError] = useState('');
  const [workHoursSuccess, setWorkHoursSuccess] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [workNotes, setWorkNotes] = useState('');

  const [inactiveModalOpen, setInactiveModalOpen] = useState(false);
  const [inactiveEmployees, setInactiveEmployees] = useState<Employee[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const [statusTab, setStatusTab] = useState<'inactive' | 'active'>('inactive');
  const [savingWhatsAppId, setSavingWhatsAppId] = useState<number | null>(null);
  const [whatsappDrafts, setWhatsappDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/employees');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في التحميل');
      setEmployees(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredEmployees = employees.filter(emp => {
    if (!jobTypeFilter || jobTypeFilter === 'all') return true;
    return emp.Job === jobTypeFilter;
  });

  const saveEmployeeWhatsApp = async (empId: number) => {
    const draft = whatsappDrafts[empId];
    const employee = employees.find((e) => e.EmpID === empId);
    const current = employee?.WhatsApp ?? employee?.Mobile ?? '';
    if (draft === undefined || draft.trim() === String(current).trim()) return;

    setSavingWhatsAppId(empId);
    try {
      const res = await fetch(`/api/employees/${empId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsApp: draft.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ رقم الواتساب');
      setEmployees((prev) =>
        prev.map((emp) =>
          emp.EmpID === empId ? { ...emp, WhatsApp: (data.WhatsApp ?? draft.trim()) || null } : emp,
        ),
      );
      setWhatsappDrafts((prev) => {
        const next = { ...prev };
        delete next[empId];
        return next;
      });
    } catch (e: unknown) {
      console.error('Failed to save employee WhatsApp:', e instanceof Error ? e.message : e);
    } finally {
      setSavingWhatsAppId(null);
    }
  };

  const loadFinanceCategories = useCallback(async () => {
    try {
      const [advRes, revRes] = await Promise.all([
        fetch('/api/finance/categories?type=مصروفات'),
        fetch('/api/finance/categories?type=ايرادات')
      ]);
      const advData = await advRes.json();
      const revData = await revRes.json();
      if (advRes.ok) setAdvanceCategories(Array.isArray(advData) ? advData : []);
      if (revRes.ok) setRevenueCategories(Array.isArray(revData) ? revData : []);
    } catch (e: any) { console.error('Failed to load finance categories:', e.message); }
  }, []);

  const openFinanceModal = async (employee: Employee) => {
    setSelectedEmployee(employee);
    setSelectedAdvance(employee.AdvanceExpINID?.toString() || '');
    setSelectedRevenue(employee.RevenueExpINID?.toString() || '');
    setFinanceError('');
    await loadFinanceCategories();
    setFinanceModalOpen(true);
  };

  const closeFinanceModal = () => {
    setFinanceModalOpen(false); setSelectedEmployee(null);
    setSelectedAdvance(''); setSelectedRevenue(''); setFinanceError('');
  };

  const saveFinanceMapping = async () => {
    if (!selectedEmployee) return;
    setFinanceSaving(true); setFinanceError('');
    try {
      const payload: any = {};
      if (selectedAdvance) payload.advanceExpINID = parseInt(selectedAdvance);
      if (selectedRevenue) payload.revenueExpINID = parseInt(selectedRevenue);
      const res = await fetch(`/api/admin/employees/${selectedEmployee.EmpID}/finance-map`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في تحديث الربط المالي');
      await load(); closeFinanceModal();
    } catch (e: any) { setFinanceError(e.message); }
    finally { setFinanceSaving(false); }
  };

  const deleteFinanceMapping = async (type: 'advance' | 'revenue') => {
    if (!selectedEmployee) return;
    try {
      const res = await fetch(`/api/admin/employees/${selectedEmployee.EmpID}/finance-map`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في حذف الربط المالي');
      if (type === 'advance') setSelectedAdvance('');
      if (type === 'revenue') setSelectedRevenue('');
      await load();
    } catch (e: any) { setFinanceError(e.message); }
  };

  const openWorkHoursModal = (employee: Employee) => {
    setSelectedWorkHoursEmployee(employee);
    setCheckInTime(employee.DefaultCheckInTime || '');
    setCheckOutTime(employee.DefaultCheckOutTime || '');
    setWorkNotes(employee.WorkScheduleNotes || '');
    setWorkHoursError(''); setWorkHoursSuccess('');
    setWorkHoursModalOpen(true);
  };

  const loadInactiveEmployees = async () => {
    setLoadingInactive(true);
    try {
      const res = await fetch('/api/employees?inactive=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في التحميل');
      setInactiveEmployees(Array.isArray(data) ? data : []);
    } catch (e: any) { console.error('Failed to load inactive employees:', e.message); }
    finally { setLoadingInactive(false); }
  };

  const openInactiveModal = async () => { setInactiveModalOpen(true); await loadInactiveEmployees(); };

  const activateEmployee = async (empId: number) => {
    setActivatingId(empId);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/activate`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في تفعيل الموظف');
      await load(); await loadInactiveEmployees();
    } catch (e: any) { console.error('Failed to activate employee:', e.message); }
    finally { setActivatingId(null); }
  };

  const deactivateEmployee = async (empId: number) => {
    setDeactivatingId(empId);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/deactivate`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في إيقاف الموظف');
      await load(); await loadInactiveEmployees();
    } catch (e: any) { console.error('Failed to deactivate employee:', e.message); }
    finally { setDeactivatingId(null); }
  };

  const handleWorkHoursSave = async () => {
    if (!selectedWorkHoursEmployee) return;
    if ((checkInTime && !checkOutTime) || (!checkInTime && checkOutTime)) {
      setWorkHoursError('يجب تحديد وقت البدء والانتهاء معاً'); return;
    }
    setWorkHoursSaving(true); setWorkHoursError(''); setWorkHoursSuccess('');
    try {
      const response = await fetch(`/api/admin/employees/${selectedWorkHoursEmployee.EmpID}/work-hours`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          DefaultCheckInTime: checkInTime || null,
          DefaultCheckOutTime: checkOutTime || null,
          WorkScheduleNotes: workNotes || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشل حفظ مواعيد العمل');
      setEmployees(prev => prev.map(emp =>
        emp.EmpID === selectedWorkHoursEmployee.EmpID ? { ...emp, ...data.employee } : emp
      ));
      setWorkHoursSuccess('تم حفظ مواعيد العمل بنجاح');
      setTimeout(() => { setWorkHoursModalOpen(false); setWorkHoursSuccess(''); }, 1500);
    } catch (error: any) { setWorkHoursError(error.message); }
    finally { setWorkHoursSaving(false); }
  };

  const previewAutoMapping = async () => {
    try {
      const res = await fetch('/api/admin/employees/auto-revenue-map');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في جلب المعاينة');
      setAutoMappingResult(data); setShowAutoMappingModal(true);
    } catch (e: any) { console.error('Preview auto mapping error:', e.message); }
  };

  const executeAutoMapping = async () => {
    setAutoMapping(true);
    try {
      const res = await fetch('/api/admin/employees/auto-revenue-map', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في الربط التلقائي');
      setAutoMappingResult(data); await load();
    } catch (e: any) { console.error('Auto mapping error:', e.message); }
    finally { setAutoMapping(false); }
  };

  async function handleAdd() {
    if (!empName.trim()) { setSaveErr('اسم الموظف مطلوب'); return; }
    setSaving(true); setSaveErr('');
    try {
      const res  = await fetch('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empName: empName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في الحفظ');
      setLastAdded(data); setEmpName(''); setOpen(false); await load();
    } catch (e: any) { setSaveErr(e.message); }
    finally { setSaving(false); }
  }

  const total        = employees.length;
  const active       = employees.filter(e => e.isActive).length;
  const advanceMapped  = employees.filter(e => e.AdvanceExpINID !== null).length;
  const revenueMapped  = employees.filter(e => e.RevenueExpINID !== null).length;
  const fullyMapped  = employees.filter(e => e.AdvanceExpINID !== null && e.RevenueExpINID !== null).length;

  return (
    <div className="space-y-6">
      {/* ── Action Bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <UsersRound className="w-4 h-4 text-primary" />
          <span>إدارة بيانات وملفات الموظفين</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2 border-border hover:bg-surface-muted" onClick={openInactiveModal}>
            <UserX className="w-4 h-4" />
            غير النشطين
          </Button>
          {revenueMapped < total && (
            <Button className="gap-2 bg-info hover:bg-info/90" onClick={previewAutoMapping} disabled={autoMapping}>
              {autoMapping ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الربط...</> : <><Zap className="w-4 h-4" /> ربط تلقائي</>}
            </Button>
          )}
          <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={() => { setOpen(true); setSaveErr(''); setEmpName(''); setLastAdded(null); }}>
            <Plus className="w-4 h-4" />
            موظف جديد
          </Button>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard title="إجمالي الموظفين" value={total}        icon={<Users        className="w-5 h-5" />} variant="default" />
        <KpiCard title="نشطون"            value={active}       icon={<Scissors     className="w-5 h-5" />} variant="primary" />
        <KpiCard title="مربوطون بسلفة"    value={advanceMapped} icon={<Link2       className="w-5 h-5" />} variant="success" />
        <KpiCard title="مربوطون بإيراد"   value={revenueMapped} icon={<Link2       className="w-5 h-5" />} variant="primary" />
        <KpiCard title="كامل الربط"       value={fullyMapped}  icon={<CheckCircle2 className="w-5 h-5" />} variant={fullyMapped === total && total > 0 ? 'success' : 'warning'} />
      </div>

      {/* ── Success Toast ── */}
      {lastAdded && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-success/30 bg-success/5">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-success">تم إضافة الموظف بنجاح</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{lastAdded.EmpName}</span>
              {' '}&mdash; تم إنشاء بند السلفة تلقائياً:{' '}
              <span className="font-mono text-primary">{lastAdded.AdvanceCatName}</span>
            </p>
          </div>
          <button onClick={() => setLastAdded(null)} className="text-muted-foreground/70 hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface/40">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">قائمة الموظفين</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">الوظيفة:</label>
                <Select
                    value={jobTypeFilter}
                    onValueChange={setJobTypeFilter}
                  >
                    <SelectTrigger className="w-40 h-8 text-xs bg-surface-muted border-border text-foreground">
                      <SelectValue placeholder="الكل" />
                    </SelectTrigger>
                    <SelectContent className="bg-surface-muted border-border">
                      <SelectItem value="all" className="text-foreground text-xs">الكل</SelectItem>
                      <SelectItem value={JobType.BARBER}           className="text-foreground text-xs">{JobType.BARBER}</SelectItem>
                      <SelectItem value={JobType.SKIN_CARE}        className="text-foreground text-xs">{JobType.SKIN_CARE}</SelectItem>
                      <SelectItem value={JobType.ASSISTANT}        className="text-foreground text-xs">{JobType.ASSISTANT}</SelectItem>
                      <SelectItem value={JobType.ADMINISTRATIVE}   className="text-foreground text-xs">{JobType.ADMINISTRATIVE}</SelectItem>
                      <SelectItem value={JobType.MANAGER}          className="text-foreground text-xs">{JobType.MANAGER}</SelectItem>
                      <SelectItem value={JobType.RECEPTIONIST}     className="text-foreground text-xs">{JobType.RECEPTIONIST}</SelectItem>
                      <SelectItem value={JobType.BEAUTICIAN}       className="text-foreground text-xs">{JobType.BEAUTICIAN}</SelectItem>
                      <SelectItem value={JobType.MASSAGE_THERAPIST} className="text-foreground text-xs">{JobType.MASSAGE_THERAPIST}</SelectItem>
                      <SelectItem value={JobType.NAIL_TECHNICIAN}  className="text-foreground text-xs">{JobType.NAIL_TECHNICIAN}</SelectItem>
                      <SelectItem value={JobType.MAKEUP_ARTIST}    className="text-foreground text-xs">{JobType.MAKEUP_ARTIST}</SelectItem>
                      <SelectItem value={JobType.HAIR_STYLIST}     className="text-foreground text-xs">{JobType.HAIR_STYLIST}</SelectItem>
                      <SelectItem value={JobType.ESTHETICIAN}      className="text-foreground text-xs">{JobType.ESTHETICIAN}</SelectItem>
                      <SelectItem value={JobType.OTHER}            className="text-foreground text-xs">{JobType.OTHER}</SelectItem>
                    </SelectContent>
                  </Select>
              </div>
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/70" />}
            </div>
          </div>
        </div>

        {error && <div className="p-6 text-center text-sm text-destructive">{error}</div>}

        {!loading && !error && filteredEmployees.length === 0 && (
          <div className="p-12 text-center text-muted-foreground/70">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{jobTypeFilter ? `لا يوجد موظفون بهذه الوظيفة: ${jobTypeFilter}` : 'لا يوجد موظفون بعد'}</p>
          </div>
        )}

        {filteredEmployees.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground/70 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-right font-medium">#</th>
                <th className="px-4 py-3 text-right font-medium">الموظف</th>
                <th className="px-4 py-3 text-right font-medium">الوظيفة</th>
                <th className="px-4 py-3 text-right font-medium">واتساب</th>
                <th className="px-4 py-3 text-right font-medium">الحالة</th>
                <th className="px-4 py-3 text-right font-medium">تصنيف السلفة</th>
                <th className="px-4 py-3 text-right font-medium">تصنيف الإيراد</th>
                <th className="px-4 py-3 text-right font-medium">الربط المالي</th>
                <th className="px-4 py-3 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredEmployees.map((emp) => (
                <tr key={emp.EmpID} className="hover:bg-surface-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground/70 font-mono text-xs">{emp.EmpID}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
                        <Scissors className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{emp.EmpName}</span>
                        {emp.Job && <p className="text-xs text-muted-foreground/70">{emp.Job}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {emp.Job
                      ? <span className="text-xs text-muted-foreground">{emp.Job}</span>
                      : <span className="text-xs text-muted-foreground/60 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="w-3.5 h-3.5 text-success shrink-0" />
                      <Input
                        value={whatsappDrafts[emp.EmpID] ?? emp.WhatsApp ?? emp.Mobile ?? ''}
                        onChange={(e) =>
                          setWhatsappDrafts((prev) => ({ ...prev, [emp.EmpID]: e.target.value }))
                        }
                        onBlur={() => { void saveEmployeeWhatsApp(emp.EmpID); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="01xxxxxxxxx"
                        className="h-8 text-xs font-mono"
                        dir="ltr"
                        disabled={savingWhatsAppId === emp.EmpID}
                      />
                      {savingWhatsAppId === emp.EmpID && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {emp.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success border border-success/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-success" /> نشط
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-muted/50 text-muted-foreground border border-border">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" /> غير نشط
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.AdvanceCatName
                      ? <span className="text-xs text-foreground font-mono">{emp.AdvanceCatName}</span>
                      : <span className="inline-flex items-center gap-1.5 text-xs text-primary"><AlertCircle className="w-3 h-3" />غير مربوط</span>}
                  </td>
                  <td className="px-4 py-3">
                    {emp.RevenueCatName
                      ? <span className="text-xs text-foreground font-mono">{emp.RevenueCatName}</span>
                      : <span className="inline-flex items-center gap-1.5 text-xs text-primary"><AlertCircle className="w-3 h-3" />غير مربوط</span>}
                  </td>
                  <td className="px-4 py-3">
                    {emp.AdvanceExpINID && emp.RevenueExpINID ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="w-3.5 h-3.5" />كامل</span>
                    ) : emp.AdvanceExpINID || emp.RevenueExpINID ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-primary"><AlertCircle className="w-3.5 h-3.5" />جزئي</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-destructive"><X className="w-3.5 h-3.5" />لا يوجد</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-left">
                    {/* TODO: Rebuild employee profile management flow later with reliable data sources. */}
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openFinanceModal(emp)} className="flex items-center gap-1">
                        <Link2 className="w-3 h-3" />الربط المالي
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add Employee Modal ── */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              إضافة موظف جديد
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-border/50 bg-surface-muted/40 p-3 space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground text-sm mb-2">ما سيحدث تلقائياً عند الإضافة:</p>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">١</span>
                <span>إنشاء الموظف في قاعدة البيانات</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">٢</span>
                <span>إنشاء بند مصروف سلفة باسم: <span className="font-mono text-primary">سلفه ( اسم الموظف )</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">٣</span>
                <span>ربط الموظف بالبند تلقائياً لتتبع السلف</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">اسم الموظف *</label>
              <Input placeholder="مثال: أحمد محمد" value={empName} onChange={(e) => setEmpName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} autoFocus />
              {empName.trim() && (
                <p className="text-xs text-muted-foreground/70">سيُنشأ بند السلفة باسم:{' '}<span className="font-mono text-primary">سلفه ( {empName.trim()} )</span></p>
              )}
            </div>
            {saveErr && <p className="text-sm text-destructive">{saveErr}</p>}
            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button>
              <Button onClick={handleAdd} disabled={saving || !empName.trim()} className="bg-primary hover:bg-primary/90 gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الحفظ...</> : <><UserPlus className="w-4 h-4" />إضافة وربط</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Finance Mapping Modal ── */}
      <Dialog open={financeModalOpen} onOpenChange={(v) => { if (!v) closeFinanceModal(); }}>
        <DialogContent className="sm:max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" />
              تعديل الربط المالي - {selectedEmployee?.EmpName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 pt-1">
            {financeError && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">{financeError}</div>}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">تصنيف السلفة</label>
                {selectedAdvance && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => deleteFinanceMapping('advance')}>
                    <X className="w-3 h-3" />حذف
                  </Button>
                )}
              </div>
              <Select value={selectedAdvance} onValueChange={setSelectedAdvance}>
                <SelectTrigger className="text-right"><SelectValue placeholder="اختر تصنيف السلفة" /></SelectTrigger>
                <SelectContent>{advanceCategories.map(cat => <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()}>{cat.CatName}</SelectItem>)}</SelectContent>
              </Select>
              {selectedEmployee?.AdvanceCatName && <p className="text-xs text-muted-foreground/70">الحالي: <span className="font-mono text-primary">{selectedEmployee.AdvanceCatName}</span></p>}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">تصنيف الإيراد</label>
                {selectedRevenue && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => deleteFinanceMapping('revenue')}>
                    <X className="w-3 h-3" />حذف
                  </Button>
                )}
              </div>
              <Select value={selectedRevenue} onValueChange={setSelectedRevenue}>
                <SelectTrigger className="text-right"><SelectValue placeholder="اختر تصنيف الإيراد" /></SelectTrigger>
                <SelectContent>{revenueCategories.map(cat => <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()}>{cat.CatName}</SelectItem>)}</SelectContent>
              </Select>
              {selectedEmployee?.RevenueCatName && <p className="text-xs text-muted-foreground/70">الحالي: <span className="font-mono text-primary">{selectedEmployee.RevenueCatName}</span></p>}
            </div>
            <div className="rounded-lg border border-border/50 bg-surface-muted/40 p-3 space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground text-sm mb-2">ملاحظات هامة:</p>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-info/10 text-info flex items-center justify-center text-[10px] font-bold shrink-0">!</span><span>السلفة تستخدم لتتبع سلف الموظفين من المصروفات</span></div>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-success/10 text-success flex items-center justify-center text-[10px] font-bold shrink-0">!</span><span>الإيراد يستخدم لتصنيف إيرادات الموظف في التقارير المالية</span></div>
            </div>
            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={closeFinanceModal} disabled={financeSaving}>إلغاء</Button>
              <Button onClick={saveFinanceMapping} disabled={financeSaving || (!selectedAdvance && !selectedRevenue)} className="bg-primary hover:bg-primary/90 gap-2">
                {financeSaving ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الحفظ...</> : <><CheckCircle2 className="w-4 h-4" />حفظ التعديلات</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Auto Mapping Modal ── */}
      <Dialog open={showAutoMappingModal} onOpenChange={(v) => { if (!v) setShowAutoMappingModal(false); }}>
        <DialogContent className="sm:max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-info" />الربط التلقائي للإيرادات</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 pt-1">
            {autoMappingResult && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-surface-muted/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-foreground">{autoMappingResult?.unmappedCount || 0}</p>
                    <p className="text-xs text-muted-foreground">موظف بدون ربط</p>
                  </div>
                  {autoMappingResult?.statistics && (
                    <>
                      <div className="bg-info/10 rounded-lg p-3 text-center border border-info/30">
                        <p className="text-2xl font-bold text-info">{autoMappingResult.statistics?.smartMappings}</p>
                        <p className="text-xs text-muted-foreground">ربط ذكي</p>
                      </div>
                      <div className="bg-primary/10 rounded-lg p-3 text-center border border-primary/30">
                        <p className="text-2xl font-bold text-primary">{autoMappingResult.statistics?.individualMappings}</p>
                        <p className="text-xs text-muted-foreground">ربط فردي</p>
                      </div>
                      <div className="bg-success/10 rounded-lg p-3 text-center border border-success/30">
                        <p className="text-2xl font-bold text-success">{autoMappingResult.statistics?.coverage}%</p>
                        <p className="text-xs text-muted-foreground">نسبة التغطية</p>
                      </div>
                    </>
                  )}
                </div>
                {autoMappingResult?.previewMappings && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">معاينة الربط المقترح:</h3>
                    <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-surface/50 sticky top-0">
                          <tr className="text-muted-foreground/70 text-xs uppercase tracking-wider">
                            <th className="px-3 py-2 text-right">الموظف</th>
                            <th className="px-3 py-2 text-right">الوظيفة</th>
                            <th className="px-3 py-2 text-right">تصنيف الإيراد</th>
                            <th className="px-3 py-2 text-right">نوع الربط</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {autoMappingResult.previewMappings.map((mapping: any, idx: number) => (
                            <tr key={idx} className="hover:bg-surface-muted/30">
                              <td className="px-3 py-2 font-medium text-foreground">{mapping.empName}</td>
                              <td className="px-3 py-2 text-muted-foreground">{mapping.job || '—'}</td>
                              <td className="px-3 py-2 text-foreground">{mapping.category}</td>
                              <td className="px-3 py-2">
                                {mapping.type === 'smart'
                                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-info/10 text-info border border-info/20"><span className="w-1.5 h-1.5 rounded-full bg-info" />ذكي</span>
                                  : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"><span className="w-1.5 h-1.5 rounded-full bg-primary" />فردي</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
            {!autoMappingResult?.mappings && (
              <div className="rounded-lg border border-border/50 bg-surface-muted/40 p-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground text-sm mb-2">كيف يعمل الربط التلقائي:</p>
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-info/10 text-info flex items-center justify-center text-[10px] font-bold shrink-0">1</span><span>يبحث عن تطابق اسم الموظف مع تصنيفات الإيرادات الموجودة</span></div>
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-info/10 text-info flex items-center justify-center text-[10px] font-bold shrink-0">2</span><span>إذا وجد تطابق، يستخدم التصنيف المطابق (ربط ذكي)</span></div>
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">3</span><span>إذا لم يجد تطابق، ينشئ "ايراد (اسم الموظف)" (ربط فردي)</span></div>
              </div>
            )}
            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={() => setShowAutoMappingModal(false)}>إغلاق</Button>
              {!autoMappingResult?.mappings && autoMappingResult?.previewMappings && (
                <Button onClick={executeAutoMapping} disabled={autoMapping} className="bg-info hover:bg-info/90 gap-2">
                  {autoMapping ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التنفيذ...</> : <><Zap className="w-4 h-4" />تنفيذ الربط التلقائي</>}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Work Hours Modal ── */}
      <Dialog open={workHoursModalOpen} onOpenChange={setWorkHoursModalOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock className="w-5 h-5 text-info" />تعديل مواعيد العمل</DialogTitle>
          </DialogHeader>
          {selectedWorkHoursEmployee && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">الموظف: <span className="font-medium text-foreground">{selectedWorkHoursEmployee.EmpName}</span></div>
              {workHoursError && <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm"><AlertCircle className="w-4 h-4" />{workHoursError}</div>}
              {workHoursSuccess && <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/30 rounded-lg text-success text-sm"><CheckCircle2 className="w-4 h-4" />{workHoursSuccess}</div>}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">وقت بداية العمل</label>
                  <Input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className="bg-surface-muted border-border text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">وقت نهاية العمل</label>
                  <Input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className="bg-surface-muted border-border text-foreground" />
                </div>
                {checkInTime && checkOutTime && (parseTimeToMinutes(checkOutTime) ?? 0) < (parseTimeToMinutes(checkInTime) ?? 0) && (
                  <div className="flex items-center gap-2 p-2 bg-info/10 border border-info/30 rounded-lg text-info text-xs"><AlertCircle className="w-3 h-3" />هذا الموعد يمتد لليوم التالي</div>
                )}
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">ملاحظات (اختياري)</label>
                  <textarea value={workNotes} onChange={(e) => setWorkNotes(e.target.value)} placeholder="أي ملاحظات حول مواعيد العمل..." className="w-full px-3 py-2 bg-surface-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground/70 resize-none h-20 text-sm" maxLength={250} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleWorkHoursSave} disabled={workHoursSaving} className="flex-1 bg-info hover:bg-info/90">
                  {workHoursSaving ? <><Loader2 className="w-4 h-4 animate-spin ml-2" />جاري الحفظ...</> : <><CheckCircle2 className="w-4 h-4 ml-2" />حفظ</>}
                </Button>
                <Button variant="outline" onClick={() => setWorkHoursModalOpen(false)} disabled={workHoursSaving} className="flex-1">إلغاء</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Employee Status Modal ── */}
      <Dialog open={inactiveModalOpen} onOpenChange={setInactiveModalOpen}>
        <DialogContent className="sm:max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              إدارة نشاط الموظفين
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-surface/60 border border-border/60 rounded-xl w-fit">
              <button
                onClick={() => setStatusTab('inactive')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusTab === 'inactive'
                    ? 'bg-surface-muted/80 text-foreground border border-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted/60'
                }`}
              >
                <UserX className="w-4 h-4" />
                غير النشطين
                {inactiveEmployees.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs bg-muted-foreground text-foreground">{inactiveEmployees.length}</span>
                )}
              </button>
              <button
                onClick={() => setStatusTab('active')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusTab === 'active'
                    ? 'bg-success/20 text-success border border-success/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted/60'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                النشطون
                <span className="px-1.5 py-0.5 rounded-full text-xs bg-success/20 text-success">{employees.length}</span>
              </button>
            </div>

            {loadingInactive ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/70" /></div>
            ) : statusTab === 'inactive' ? (
              inactiveEmployees.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-border rounded-xl">
                  <UserCheck className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground/70">جميع الموظفين نشطون</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface/40 text-muted-foreground/70 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3 text-right font-medium">#</th>
                        <th className="px-4 py-3 text-right font-medium">الموظف</th>
                        <th className="px-4 py-3 text-right font-medium">الوظيفة</th>
                        <th className="px-4 py-3 text-right font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {inactiveEmployees.map((emp) => (
                        <tr key={emp.EmpID} className="hover:bg-surface-muted/30 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground/70 font-mono text-xs">{emp.EmpID}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-muted/50 text-muted-foreground/70 shrink-0"><UserX className="w-3.5 h-3.5" /></div>
                              <span className="font-medium text-foreground">{emp.EmpName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {emp.Job ? <span className="text-xs text-muted-foreground">{emp.Job}</span> : <span className="text-xs text-muted-foreground/60 italic">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Button size="sm" onClick={() => activateEmployee(emp.EmpID)} disabled={activatingId === emp.EmpID} className="gap-1.5 bg-success hover:bg-success/90 text-xs">
                              {activatingId === emp.EmpID ? <><Loader2 className="w-3 h-3 animate-spin" />جاري...</> : <><UserCheck className="w-3 h-3" />تفعيل</>}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              employees.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-border rounded-xl">
                  <UserX className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground/70">لا يوجد موظفون نشطون</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface/40 text-muted-foreground/70 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3 text-right font-medium">#</th>
                        <th className="px-4 py-3 text-right font-medium">الموظف</th>
                        <th className="px-4 py-3 text-right font-medium">الوظيفة</th>
                        <th className="px-4 py-3 text-right font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {employees.map((emp) => (
                        <tr key={emp.EmpID} className="hover:bg-surface-muted/30 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground/70 font-mono text-xs">{emp.EmpID}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/10 text-success shrink-0"><UserCheck className="w-3.5 h-3.5" /></div>
                              <span className="font-medium text-foreground">{emp.EmpName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {emp.Job ? <span className="text-xs text-muted-foreground">{emp.Job}</span> : <span className="text-xs text-muted-foreground/60 italic">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deactivateEmployee(emp.EmpID)}
                              disabled={deactivatingId === emp.EmpID}
                              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive/80 text-xs"
                            >
                              {deactivatingId === emp.EmpID ? <><Loader2 className="w-3 h-3 animate-spin" />جاري...</> : <><UserX className="w-3 h-3" />إيقاف</>}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setInactiveModalOpen(false)}>إغلاق</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PANEL — Employee Advances Report
   ══════════════════════════════════════════════════════ */
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function AdvancesReportPanel() {
  const now   = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-5">
      {/* ── Header + Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="w-4 h-4 text-primary" />
          <span>سلف وإيرادات الموظفين حسب الشهر</span>
        </div>
        <div className="flex items-center gap-2 mr-auto">
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-36 h-9 text-sm bg-surface border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              {ARABIC_MONTHS.map((label, i) => (
                <SelectItem key={i + 1} value={String(i + 1)} className="text-foreground text-sm">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-28 h-9 text-sm bg-surface border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              {years.map(y => (
                <SelectItem key={y} value={String(y)} className="text-foreground text-sm">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <EmployeeAdvancesSection year={year} month={month} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PANEL 5 — Employee Settings
   ══════════════════════════════════════════════════════ */
function EmployeeSettingsPanel() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Settings className="w-4 h-4 text-primary" />
        <span>إعدادات الرواتب والتارجت والحضور للموظفين</span>
      </div>
      <PayrollSettingsTab />
    </div>
  );
}
