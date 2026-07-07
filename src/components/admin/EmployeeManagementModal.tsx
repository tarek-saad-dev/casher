'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs, TabsContent, TabsList, TabsTrigger
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  User, Calendar, Clock, DollarSign, Link2, 
  Save, Loader2, CheckCircle2, AlertCircle, Copy, X, Briefcase, Phone, CreditCard, FileText
} from 'lucide-react';
import type { Employee } from '@/lib/types';
import { JobType } from '@/lib/types';

interface EmployeeManagementModalProps {
  employee: Employee | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOpenWorkHours?: (employee: Employee) => void;
}

interface EmployeeProfile {
  EmpID: number;
  EmpName: string;
  Job?: string;
  Mobile?: string;
  CardNO?: string;
  Notes?: string;
  isActive?: boolean;
  BaseSalary?: number;
  TargetCommissionPercent?: number;
  TargetMinSales?: number;
  DefaultCheckInTime?: string;
  DefaultCheckOutTime?: string;
  WorkScheduleNotes?: string;
  IsPayrollEnabled?: boolean;
  HourlyRate?: number;
  AdvanceExpINID?: number;
  AdvanceCatName?: string;
  RevenueExpINID?: number;
  RevenueCatName?: string;
}

interface WorkScheduleItem {
  DayOfWeek: number;
  IsWorkingDay: boolean;
  StartTime?: string;
  EndTime?: string;
  BreakStartTime?: string;
  BreakEndTime?: string;
  Notes?: string;
}

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const normalizeTime = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return '';
  const str = String(value).trim();
  if (!str || str === '0') return '';
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '';
  const h = match[1].padStart(2, '0');
  const m = match[2];
  if (Number(h) > 23 || Number(m) > 59) return '';
  return `${h}:${m}`;
};

const normalizeSchedule = (rawSchedule: WorkScheduleItem[]): WorkScheduleItem[] => {
  return rawSchedule.map(day => ({
    ...day,
    StartTime: normalizeTime(day.StartTime),
    EndTime: normalizeTime(day.EndTime),
    BreakStartTime: normalizeTime(day.BreakStartTime),
    BreakEndTime: normalizeTime(day.BreakEndTime),
  }));
};

interface FinanceCategory {
  ExpINID: number;
  CatName: string;
}

// Hidden temporarily until leave management is connected to a reliable backend source.
// Days-off handlers and API calls remain available in the backend at:
//   /api/admin/employees/:id/days-off

export default function EmployeeManagementModal({ 
  employee, open, onClose, onRefresh, onOpenWorkHours 
}: EmployeeManagementModalProps) {
  const [activeTab, setActiveTab] = useState('profile');
  
  // Profile state
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Schedule state
  const [schedule, setSchedule] = useState<WorkScheduleItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSuccess, setScheduleSuccess] = useState('');
  const [hasSchedule, setHasSchedule] = useState(false);

  // Finance categories state
  const [advanceCategories, setAdvanceCategories] = useState<FinanceCategory[]>([]);
  const [revenueCategories, setRevenueCategories] = useState<FinanceCategory[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<string>('');
  const [selectedRevenue, setSelectedRevenue] = useState<string>('');
  const [financeError, setFinanceError] = useState('');
  const [financeSuccess, setFinanceSuccess] = useState('');
  const [financeSaving, setFinanceSaving] = useState(false);

  // Payroll state
  const [payrollError, setPayrollError] = useState('');
  const [payrollSuccess, setPayrollSuccess] = useState('');
  const [payrollSaving, setPayrollSaving] = useState(false);

  // Copy schedule modal state
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [sourceDay, setSourceDay] = useState<WorkScheduleItem | null>(null);
  const [selectedTargetDays, setSelectedTargetDays] = useState<number[]>([]);

  const resetState = useCallback(() => {
    setProfile(null);
    setSchedule([]);
    setHasSchedule(false);
    setSelectedAdvance('');
    setSelectedRevenue('');
    setProfileError('');
    setProfileSuccess('');
    setScheduleError('');
    setScheduleSuccess('');
    setFinanceError('');
    setFinanceSuccess('');
    setPayrollError('');
    setPayrollSuccess('');
    setCopyModalOpen(false);
    setSourceDay(null);
    setSelectedTargetDays([]);
  }, []);

  const loadFinanceCategories = useCallback(async () => {
    try {
      const [advRes, revRes] = await Promise.all([
        fetch('/api/finance/categories?type=مصروفات'),
        fetch('/api/finance/categories?type=ايرادات')
      ]);
      if (advRes.ok) {
        const advData = await advRes.json();
        setAdvanceCategories(Array.isArray(advData) ? advData : []);
      }
      if (revRes.ok) {
        const revData = await revRes.json();
        setRevenueCategories(Array.isArray(revData) ? revData : []);
      }
    } catch (error) {
      console.error('Error loading finance categories:', error);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    if (!employee) return;
    setProfileLoading(true);
    setProfileError('');
    try {
      const response = await fetch(`/api/admin/employees/${employee.EmpID}/profile`);
      if (!response.ok) throw new Error('فشل تحميل بيانات الموظف');
      const data = await response.json();
      if (data.success) {
        setProfile({
          ...data.employee,
          DefaultCheckInTime: normalizeTime(data.employee.DefaultCheckInTime),
          DefaultCheckOutTime: normalizeTime(data.employee.DefaultCheckOutTime),
        });
        setSelectedAdvance(data.employee.AdvanceExpINID?.toString() || '');
        setSelectedRevenue(data.employee.RevenueExpINID?.toString() || '');
      } else {
        throw new Error(data.error || 'فشل تحميل بيانات الموظف');
      }
    } catch (error) {
      setProfileError('فشل تحميل بيانات الموظف');
      console.error(error);
    } finally {
      setProfileLoading(false);
    }
  }, [employee]);

  const loadSchedule = useCallback(async () => {
    if (!employee) return;
    setScheduleLoading(true);
    setScheduleError('');
    try {
      const response = await fetch(`/api/admin/employees/${employee.EmpID}/schedule`);
      if (!response.ok) throw new Error('فشل تحميل جدول العمل');
      const data = await response.json();
      if (data.success && Array.isArray(data.schedule)) {
        const normalized = normalizeSchedule(data.schedule);
        setSchedule(normalized);
        setHasSchedule(normalized.some((d: WorkScheduleItem) => d.StartTime || d.EndTime));
      } else {
        throw new Error(data.error || 'فشل تحميل جدول العمل');
      }
    } catch (error) {
      setScheduleError('فشل تحميل جدول العمل');
      console.error(error);
    } finally {
      setScheduleLoading(false);
    }
  }, [employee]);

  // Load employee data when modal opens or employee changes
  useEffect(() => {
    if (open && employee) {
      resetState();
      setActiveTab('profile');
      loadProfile();
      loadSchedule();
      loadFinanceCategories();
    }
  }, [open, employee, resetState, loadProfile, loadSchedule, loadFinanceCategories]);

  // Profile handlers
  const handleProfileSave = async () => {
    if (!profile) return;

    setProfileSaving(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      const response = await fetch(`/api/admin/employees/${profile.EmpID}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          EmpName: profile.EmpName,
          Job: profile.Job,
          Mobile: profile.Mobile,
          CardNO: profile.CardNO,
          Notes: profile.Notes,
          isActive: profile.isActive,
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setProfileSuccess('تم حفظ البيانات الأساسية بنجاح');
        setProfile({
          ...data.employee,
          DefaultCheckInTime: normalizeTime(data.employee.DefaultCheckInTime),
          DefaultCheckOutTime: normalizeTime(data.employee.DefaultCheckOutTime),
        });
        onRefresh();
      } else {
        setProfileError(data.error || 'خطأ في حفظ البيانات');
      }
    } catch {
      setProfileError('خطأ في الاتصال بالخادم');
    } finally {
      setProfileSaving(false);
    }
  };

  // Schedule helpers
  const updateScheduleDay = (dayOfWeek: number, field: keyof WorkScheduleItem, value: WorkScheduleItem[keyof WorkScheduleItem]) => {
    setSchedule(prev => prev.map(day => 
      day.DayOfWeek === dayOfWeek 
        ? { ...day, [field]: value }
        : day
    ));
    setHasSchedule(true);
  };

  const applyStandardSchedule = () => {
    setSchedule(prev => prev.map((day, index) => {
      if (index === 5) {
        return { ...day, IsWorkingDay: false, StartTime: '', EndTime: '', BreakStartTime: '', BreakEndTime: '', Notes: 'جمعة - إجازة أسبوعية' };
      }
      return { ...day, IsWorkingDay: true, StartTime: '09:00', EndTime: '17:00', BreakStartTime: '13:00', BreakEndTime: '14:00', Notes: '' };
    }));
    setHasSchedule(true);
  };

  const copyFromSunday = () => {
    const sunday = schedule.find(d => d.DayOfWeek === 0);
    if (!sunday) return;
    setSchedule(prev => prev.map(day => {
      if (day.DayOfWeek === 0) return day;
      return {
        ...day,
        IsWorkingDay: sunday.IsWorkingDay,
        StartTime: sunday.StartTime,
        EndTime: sunday.EndTime,
        BreakStartTime: sunday.BreakStartTime,
        BreakEndTime: sunday.BreakEndTime,
        Notes: sunday.Notes,
      };
    }));
    setHasSchedule(true);
  };

  const setAllWeekOff = () => {
    setSchedule(prev => prev.map(day => ({ ...day, IsWorkingDay: false, StartTime: '', EndTime: '', BreakStartTime: '', BreakEndTime: '', Notes: '' })));
    setHasSchedule(true);
  };

  const openCopyModal = (day: WorkScheduleItem) => {
    setSourceDay(day);
    setSelectedTargetDays([]);
    setCopyModalOpen(true);
  };

  const handleCopySchedule = () => {
    if (!sourceDay || selectedTargetDays.length === 0) return;

    setSchedule(prev => prev.map(day => {
      if (selectedTargetDays.includes(day.DayOfWeek)) {
        return {
          ...day,
          IsWorkingDay: sourceDay.IsWorkingDay,
          StartTime: sourceDay.StartTime,
          EndTime: sourceDay.EndTime,
          BreakStartTime: sourceDay.BreakStartTime,
          BreakEndTime: sourceDay.BreakEndTime,
          Notes: sourceDay.Notes
        };
      }
      return day;
    }));
    setHasSchedule(true);
    setCopyModalOpen(false);
    setSourceDay(null);
    setSelectedTargetDays([]);
  };

  const toggleTargetDay = (dayOfWeek: number) => {
    setSelectedTargetDays(prev => 
      prev.includes(dayOfWeek) 
        ? prev.filter(d => d !== dayOfWeek)
        : [...prev, dayOfWeek]
    );
  };

  // Schedule handlers
  const handleScheduleSave = async () => {
    if (!profile) return;

    setScheduleSaving(true);
    setScheduleError('');
    setScheduleSuccess('');

    try {
      const response = await fetch(`/api/admin/employees/${profile.EmpID}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule })
      });

      if (!response.ok) {
        let errMsg = 'خطأ في حفظ جدول العمل';
        try { const d = await response.json(); errMsg = d.error || errMsg; } catch {}
        setScheduleError(errMsg);
        return;
      }
      const data = await response.json();
      
      if (data.success) {
        setScheduleSuccess('تم حفظ جدول العمل بنجاح');
        const normalized = normalizeSchedule(data.schedule);
        setSchedule(normalized);
        setHasSchedule(normalized.some((d: WorkScheduleItem) => d.StartTime || d.EndTime));
      } else {
        setScheduleError(data.error || 'خطأ في حفظ جدول العمل');
      }
    } catch {
      setScheduleError('خطأ في الاتصال بالخادم');
    } finally {
      setScheduleSaving(false);
    }
  };

  // Finance mapping handlers
  const handleFinanceSave = async () => {
    if (!profile) return;

    setFinanceSaving(true);
    setFinanceError('');
    setFinanceSuccess('');

    try {
      const response = await fetch(`/api/admin/employees/${profile.EmpID}/finance-map`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          advanceExpINID: selectedAdvance ? parseInt(selectedAdvance) : null,
          revenueExpINID: selectedRevenue ? parseInt(selectedRevenue) : null,
        })
      });

      if (!response.ok) {
        let errMsg = 'خطأ في حفظ الربط المالي';
        try { const d = await response.json(); errMsg = d.error || errMsg; } catch {}
        setFinanceError(errMsg);
        return;
      }

      const data = await response.json();
      
      if (data.success) {
        setFinanceSuccess('تم حفظ الربط المالي بنجاح');
        setProfile(prev => prev ? {
          ...prev,
          AdvanceExpINID: data.employee.AdvanceExpINID,
          AdvanceCatName: data.employee.AdvanceCatName,
          RevenueExpINID: data.employee.RevenueExpINID,
          RevenueCatName: data.employee.RevenueCatName,
        } : null);
        onRefresh();
      } else {
        setFinanceError(data.error || 'خطأ في حفظ الربط المالي');
      }
    } catch {
      setFinanceError('خطأ في الاتصال بالخادم');
    } finally {
      setFinanceSaving(false);
    }
  };

  // Payroll handlers
  const handlePayrollSave = async () => {
    if (!profile) return;

    setPayrollSaving(true);
    setPayrollError('');
    setPayrollSuccess('');

    try {
      const response = await fetch(`/api/payroll/employees/${profile.EmpID}/salary-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyWage: profile.BaseSalary ?? 0,
          isPayrollEnabled: profile.IsPayrollEnabled ?? false,
          defaultCheckInTime: profile.DefaultCheckInTime || null,
          defaultCheckOutTime: profile.DefaultCheckOutTime || null,
          workScheduleNotes: profile.WorkScheduleNotes || null,
        })
      });

      if (!response.ok) {
        let errMsg = 'خطأ في حفظ إعدادات المرتب';
        try { const d = await response.json(); errMsg = d.error || errMsg; } catch {}
        setPayrollError(errMsg);
        return;
      }

      const data = await response.json();
      
      if (data.success && data.employee) {
        setPayrollSuccess('تم حفظ إعدادات المرتب بنجاح');
        setProfile(prev => prev ? {
          ...prev,
          BaseSalary: data.employee.BaseSalary ?? data.employee.Salary,
          IsPayrollEnabled: data.employee.IsPayrollEnabled,
          DefaultCheckInTime: normalizeTime(data.employee.DefaultCheckInTime),
          DefaultCheckOutTime: normalizeTime(data.employee.DefaultCheckOutTime),
          WorkScheduleNotes: data.employee.WorkScheduleNotes,
          HourlyRate: data.employee.HourlyRate,
        } : null);
        onRefresh();
      } else {
        setPayrollError(data.error || 'خطأ في حفظ إعدادات المرتب');
      }
    } catch {
      setPayrollError('خطأ في الاتصال بالخادم');
    } finally {
      setPayrollSaving(false);
    }
  };

  if (!employee) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="w-[95vw] max-w-7xl max-h-[90vh] h-[90vh] p-0 overflow-hidden border border-zinc-800 bg-zinc-900 flex flex-col" dir="rtl">
          <DialogHeader className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <User className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-white">
                    {profileLoading ? 'جاري التحميل...' : (profile?.EmpName || employee.EmpName)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400 mt-0.5">
                    <Briefcase className="w-3.5 h-3.5" />
                    <span>{profile?.Job || employee.Job || '—'}</span>
                    <Badge 
                      variant={profile?.isActive ? 'default' : 'secondary'}
                      className={profile?.isActive 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                        : 'bg-zinc-700 text-zinc-400 border-zinc-600'
                      }
                    >
                      {profile?.isActive ? 'نشط' : 'غير نشط'}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onClose} 
                className="text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col flex-1 min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
              <TabsList className="mx-6 mt-4 mb-0 w-full flex-wrap justify-start bg-zinc-800/50 border border-zinc-800 p-1 rounded-lg shrink-0">
                <TabsTrigger value="profile" className="flex items-center gap-2 data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 px-4 py-2 rounded-md text-sm transition-all">
                  <User className="w-4 h-4" />
                  <span>البيانات الأساسية</span>
                </TabsTrigger>
                <TabsTrigger value="schedule" className="flex items-center gap-2 data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 px-4 py-2 rounded-md text-sm transition-all">
                  <Clock className="w-4 h-4" />
                  <span>مواعيد العمل</span>
                </TabsTrigger>
                <TabsTrigger value="finance" className="flex items-center gap-2 data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 px-4 py-2 rounded-md text-sm transition-all">
                  <Link2 className="w-4 h-4" />
                  <span>الربط المالي</span>
                </TabsTrigger>
                <TabsTrigger value="payroll" className="flex items-center gap-2 data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 px-4 py-2 rounded-md text-sm transition-all">
                  <DollarSign className="w-4 h-4" />
                  <span>إعدادات المرتب</span>
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-hidden p-6">
                {/* Profile Tab */}
                <TabsContent value="profile" className="h-full overflow-y-auto pr-2 mt-0 data-[state=inactive]:hidden">
                  <div className="space-y-6 max-w-4xl">
                    {profileLoading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                      </div>
                    ) : (
                      <>
                        <div className="bg-zinc-800/50 rounded-lg p-6 border border-zinc-800">
                          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                            <User className="w-5 h-5 text-amber-500" />
                            البيانات الأساسية
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="empName" className="text-zinc-300">الاسم *</Label>
                              <Input
                                id="empName"
                                value={profile?.EmpName || ''}
                                onChange={(e) => setProfile(prev => prev ? { ...prev, EmpName: e.target.value } : null)}
                                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-amber-500 h-11"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="job" className="text-zinc-300">الوظيفة</Label>
                              <Select
                                value={profile?.Job || ''}
                                onValueChange={(value) => setProfile(prev => prev ? { ...prev, Job: value } : null)}
                              >
                                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white h-11">
                                  <SelectValue placeholder="اختر الوظيفة" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 max-h-72">
                                  {Object.values(JobType).map(job => (
                                    <SelectItem key={job} value={job} className="text-white">{job}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="mobile" className="text-zinc-300 flex items-center gap-1">
                                <Phone className="w-3.5 h-3.5" />
                                رقم الموبايل
                              </Label>
                              <Input
                                id="mobile"
                                value={profile?.Mobile || ''}
                                onChange={(e) => setProfile(prev => prev ? { ...prev, Mobile: e.target.value } : null)}
                                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 h-11"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="cardNo" className="text-zinc-300 flex items-center gap-1">
                                <CreditCard className="w-3.5 h-3.5" />
                                رقم الكارت
                              </Label>
                              <Input
                                id="cardNo"
                                value={profile?.CardNO || ''}
                                onChange={(e) => setProfile(prev => prev ? { ...prev, CardNO: e.target.value } : null)}
                                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 h-11"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label htmlFor="notes" className="text-zinc-300 flex items-center gap-1">
                                <FileText className="w-3.5 h-3.5" />
                                ملاحظات
                              </Label>
                              <Textarea
                                id="notes"
                                value={profile?.Notes || ''}
                                onChange={(e) => setProfile(prev => prev ? { ...prev, Notes: e.target.value } : null)}
                                rows={3}
                                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 resize-none"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-zinc-300">الحالة</Label>
                              <div className="flex items-center gap-3 h-11">
                                <Switch
                                  checked={profile?.isActive ?? true}
                                  onCheckedChange={(checked) => setProfile(prev => prev ? { ...prev, isActive: checked } : null)}
                                  className="data-[state=checked]:bg-emerald-500"
                                />
                                <span className="text-zinc-300">{profile?.isActive ? 'نشط' : 'غير نشط'}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {profileError && (
                          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <span className="font-medium">{profileError}</span>
                          </div>
                        )}

                        {profileSuccess && (
                          <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                            <span className="font-medium">{profileSuccess}</span>
                          </div>
                        )}

                        <Button 
                          onClick={handleProfileSave} 
                          disabled={profileSaving || !profile} 
                          className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50"
                        >
                          {profileSaving ? (
                            <><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري الحفظ...</>
                          ) : (
                            <><Save className="w-5 h-5 ml-2" /> حفظ البيانات الأساسية</>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </TabsContent>

                {/* Schedule Tab */}
                <TabsContent value="schedule" className="h-full overflow-y-auto pr-2 mt-0 data-[state=inactive]:hidden">
                  <div className="space-y-6">
                    {scheduleLoading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                      </div>
                    ) : schedule.length === 0 ? (
                      <div className="text-center py-16 bg-zinc-800/30 rounded-lg border border-zinc-800">
                        <Clock className="w-12 h-12 mx-auto mb-4 text-zinc-500" />
                        <p className="text-zinc-400 mb-4">لا يوجد جدول عمل محفوظ لهذا الموظف</p>
                        <Button onClick={applyStandardSchedule} className="bg-amber-600 hover:bg-amber-700 text-white">
                          <Clock className="w-4 h-4 ml-2" />
                          تطبيق جدول قياسي
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {onOpenWorkHours && (
                            <Button 
                              variant="outline" 
                              onClick={() => employee && onOpenWorkHours(employee)}
                              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                            >
                              <Clock className="w-4 h-4 ml-2" />
                              تعديل المواعيد السريع
                            </Button>
                          )}
                          <Button 
                            variant="outline" 
                            onClick={applyStandardSchedule}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                          >
                            <Clock className="w-4 h-4 ml-2" />
                            تطبيق جدول قياسي
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={copyFromSunday}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                          >
                            <Copy className="w-4 h-4 ml-2" />
                            نسخ الأحد لباقي الأسبوع
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={setAllWeekOff}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                          >
                            <Calendar className="w-4 h-4 ml-2" />
                            إجازة الأسبوع كله
                          </Button>
                        </div>

                        {!hasSchedule && (
                          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            <span>لم يتم تحديد مواعيد عمل بعد. اضبط الأيام والأوقات ثم احفظ.</span>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {schedule.map((day) => (
                            <div 
                              key={day.DayOfWeek} 
                              className={`bg-zinc-800/50 rounded-lg p-4 border border-zinc-800 transition-opacity ${!day.IsWorkingDay ? 'opacity-75' : ''}`}
                            >
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={day.IsWorkingDay}
                                    onCheckedChange={(checked) => updateScheduleDay(day.DayOfWeek, 'IsWorkingDay', checked)}
                                    className="data-[state=checked]:bg-emerald-500"
                                  />
                                  <span className={`font-medium ${day.IsWorkingDay ? 'text-white' : 'text-zinc-400'}`}>
                                    {DAY_NAMES[day.DayOfWeek]}
                                  </span>
                                </div>
                                <Badge 
                                  variant={day.IsWorkingDay ? 'default' : 'secondary'}
                                  className={day.IsWorkingDay 
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                    : 'bg-zinc-700 text-zinc-400 border-zinc-600'
                                  }
                                >
                                  {day.IsWorkingDay ? 'عمل' : 'إجازة'}
                                </Badge>
                              </div>
                              
                              {day.IsWorkingDay && (
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-zinc-400">وقت البدء</Label>
                                    <Input
                                      type="time"
                                      value={normalizeTime(day.StartTime)}
                                      onChange={(e) => updateScheduleDay(day.DayOfWeek, 'StartTime', e.target.value)}
                                      className="bg-zinc-900 border-zinc-700 text-white h-9 text-center focus:border-amber-500"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-zinc-400">وقت الانتهاء</Label>
                                    <Input
                                      type="time"
                                      value={normalizeTime(day.EndTime)}
                                      onChange={(e) => updateScheduleDay(day.DayOfWeek, 'EndTime', e.target.value)}
                                      className="bg-zinc-900 border-zinc-700 text-white h-9 text-center focus:border-amber-500"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-zinc-400">بداية الراحة</Label>
                                    <Input
                                      type="time"
                                      value={normalizeTime(day.BreakStartTime)}
                                      onChange={(e) => updateScheduleDay(day.DayOfWeek, 'BreakStartTime', e.target.value)}
                                      className="bg-zinc-900 border-zinc-700 text-white h-9 text-center focus:border-amber-500"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-zinc-400">نهاية الراحة</Label>
                                    <Input
                                      type="time"
                                      value={normalizeTime(day.BreakEndTime)}
                                      onChange={(e) => updateScheduleDay(day.DayOfWeek, 'BreakEndTime', e.target.value)}
                                      className="bg-zinc-900 border-zinc-700 text-white h-9 text-center focus:border-amber-500"
                                    />
                                  </div>
                                </div>
                              )}
                              
                              <div className="space-y-1">
                                <Label className="text-xs text-zinc-400">ملاحظات</Label>
                                <Input
                                  value={day.Notes || ''}
                                  onChange={(e) => updateScheduleDay(day.DayOfWeek, 'Notes', e.target.value)}
                                  placeholder="ملاحظات..."
                                  disabled={!day.IsWorkingDay}
                                  className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 h-9 disabled:opacity-50"
                                />
                              </div>
                              
                              <div className="mt-3 flex justify-end">
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  onClick={() => openCopyModal(day)}
                                  disabled={!day.IsWorkingDay}
                                  className="text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-50"
                                >
                                  <Copy className="w-4 h-4 ml-1" />
                                  نسخ
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {scheduleError && (
                      <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{scheduleError}</span>
                      </div>
                    )}

                    {scheduleSuccess && (
                      <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{scheduleSuccess}</span>
                      </div>
                    )}

                    <Button 
                      onClick={handleScheduleSave} 
                      disabled={scheduleSaving || scheduleLoading || schedule.length === 0} 
                      className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50"
                    >
                      {scheduleSaving ? (
                        <><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري الحفظ...</>
                      ) : (
                        <><Save className="w-5 h-5 ml-2" /> حفظ مواعيد العمل</>
                      )}
                    </Button>
                  </div>
                </TabsContent>

                {/* Finance Tab */}
                <TabsContent value="finance" className="h-full overflow-y-auto pr-2 mt-0 data-[state=inactive]:hidden">
                  <div className="space-y-6 max-w-4xl">
                    <div className="bg-zinc-800/50 rounded-lg p-6 border border-zinc-800">
                      <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-emerald-500" />
                        الربط المالي
                      </h3>
                      
                      <div className="mb-6">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm text-zinc-400">حالة الربط:</span>
                          {profile?.AdvanceExpINID && profile?.RevenueExpINID ? (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">كامل</Badge>
                          ) : profile?.AdvanceExpINID || profile?.RevenueExpINID ? (
                            <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">جزئي</Badge>
                          ) : (
                            <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20">غير مربوط</Badge>
                          )}
                        </div>
                        {(!profile?.AdvanceExpINID || !profile?.RevenueExpINID) && (
                          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>الربط المالي ناقص. اختر تصنيف السلفة والإيراد لإكمال الربط.</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-zinc-300">تصنيف السلفة</Label>
                          <Select value={selectedAdvance} onValueChange={setSelectedAdvance}>
                            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white h-11">
                              <SelectValue placeholder="اختر تصنيف السلفة" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-700 max-h-72">
                              {advanceCategories.map(cat => (
                                <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()} className="text-white">
                                  {cat.CatName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {profile?.AdvanceCatName && (
                            <p className="text-xs text-zinc-400">الحالي: {profile.AdvanceCatName}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-300">تصنيف الإيراد</Label>
                          <Select value={selectedRevenue} onValueChange={setSelectedRevenue}>
                            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white h-11">
                              <SelectValue placeholder="اختر تصنيف الإيراد" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-700 max-h-72">
                              {revenueCategories.map(cat => (
                                <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()} className="text-white">
                                  {cat.CatName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {profile?.RevenueCatName && (
                            <p className="text-xs text-zinc-400">الحالي: {profile.RevenueCatName}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {financeError && (
                      <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{financeError}</span>
                      </div>
                    )}

                    {financeSuccess && (
                      <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{financeSuccess}</span>
                      </div>
                    )}

                    <Button 
                      onClick={handleFinanceSave} 
                      disabled={financeSaving || !profile} 
                      className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50"
                    >
                      {financeSaving ? (
                        <><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري الحفظ...</>
                      ) : (
                        <><Save className="w-5 h-5 ml-2" /> حفظ الربط المالي</>
                      )}
                    </Button>
                  </div>
                </TabsContent>

                {/* Payroll Tab */}
                <TabsContent value="payroll" className="h-full overflow-y-auto pr-2 mt-0 data-[state=inactive]:hidden">
                  <div className="space-y-6 max-w-4xl">
                    <div className="bg-zinc-800/50 rounded-lg p-6 border border-zinc-800">
                      <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-rose-500" />
                        إعدادات المرتب
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-zinc-300">الراتب اليومي / الأساسي</Label>
                          <Input
                            type="number"
                            value={profile?.BaseSalary || ''}
                            onChange={(e) => setProfile(prev => prev ? { ...prev, BaseSalary: parseFloat(e.target.value) || 0 } : null)}
                            className="bg-zinc-900 border-zinc-700 text-white h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-300">سعر الساعة</Label>
                          <Input
                            type="number"
                            value={profile?.HourlyRate || ''}
                            disabled
                            className="bg-zinc-900 border-zinc-700 text-zinc-400 h-11 disabled:opacity-70"
                          />
                          <p className="text-xs text-zinc-500">يُحسب تلقائيًا من الراتب اليومي</p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-300">وقت الحضور الافتراضي</Label>
                          <Input
                            type="time"
                            value={normalizeTime(profile?.DefaultCheckInTime)}
                            onChange={(e) => setProfile(prev => prev ? { ...prev, DefaultCheckInTime: e.target.value } : null)}
                            className="bg-zinc-900 border-zinc-700 text-white h-11 text-center"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-300">وقت الانصراف الافتراضي</Label>
                          <Input
                            type="time"
                            value={normalizeTime(profile?.DefaultCheckOutTime)}
                            onChange={(e) => setProfile(prev => prev ? { ...prev, DefaultCheckOutTime: e.target.value } : null)}
                            className="bg-zinc-900 border-zinc-700 text-white h-11 text-center"
                          />
                          {profile?.DefaultCheckInTime && profile?.DefaultCheckOutTime && normalizeTime(profile.DefaultCheckOutTime) < normalizeTime(profile.DefaultCheckInTime) && (
                            <p className="text-xs text-blue-400 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              الدوام يمتد لليوم التالي
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-300">حالة تفعيل الرواتب</Label>
                          <div className="flex items-center gap-3 h-11">
                            <Switch
                              checked={profile?.IsPayrollEnabled || false}
                              onCheckedChange={(checked) => setProfile(prev => prev ? { ...prev, IsPayrollEnabled: checked } : null)}
                              className="data-[state=checked]:bg-emerald-500"
                            />
                            <span className="text-zinc-300">{profile?.IsPayrollEnabled ? 'مفعل' : 'معطل'}</span>
                          </div>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label className="text-zinc-300">ملاحظات جدول العمل</Label>
                          <Textarea
                            value={profile?.WorkScheduleNotes || ''}
                            onChange={(e) => setProfile(prev => prev ? { ...prev, WorkScheduleNotes: e.target.value } : null)}
                            rows={2}
                            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 resize-none"
                          />
                        </div>
                      </div>
                    </div>

                    {payrollError && (
                      <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{payrollError}</span>
                      </div>
                    )}

                    {payrollSuccess && (
                      <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{payrollSuccess}</span>
                      </div>
                    )}

                    <Button 
                      onClick={handlePayrollSave} 
                      disabled={payrollSaving || !profile} 
                      className="w-full h-11 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50"
                    >
                      {payrollSaving ? (
                        <><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري الحفظ...</>
                      ) : (
                        <><Save className="w-5 h-5 ml-2" /> حفظ إعدادات المرتب</>
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {/* Copy Schedule Modal */}
      <Dialog open={copyModalOpen} onOpenChange={setCopyModalOpen}>
        <DialogContent className="sm:max-w-md border border-zinc-800 bg-zinc-900" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Copy className="w-5 h-5 text-amber-500" />
              نسخ مواعيد العمل
            </DialogTitle>
          </DialogHeader>

          {sourceDay && (
            <div className="space-y-4">
              <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-800">
                <h4 className="font-semibold text-white mb-2">مصدر النسخ:</h4>
                <div className="text-sm text-zinc-300">
                  <p><span className="font-medium">اليوم:</span> {DAY_NAMES[sourceDay.DayOfWeek]}</p>
                  {sourceDay.IsWorkingDay ? (
                    <>
                      <p><span className="font-medium">وقت العمل:</span> {normalizeTime(sourceDay.StartTime)} - {normalizeTime(sourceDay.EndTime)}</p>
                      {sourceDay.BreakStartTime && sourceDay.BreakEndTime && (
                        <p><span className="font-medium">وقت الراحة:</span> {normalizeTime(sourceDay.BreakStartTime)} - {normalizeTime(sourceDay.BreakEndTime)}</p>
                      )}
                      {sourceDay.Notes && <p><span className="font-medium">ملاحظات:</span> {sourceDay.Notes}</p>}
                    </>
                  ) : (
                    <p className="text-amber-400">إجازة</p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-white">اختر الأيام التي تريد النسخ إليها:</h4>
                <div className="grid grid-cols-2 gap-2">
                  {schedule
                    .filter(day => day.DayOfWeek !== sourceDay.DayOfWeek)
                    .map(day => (
                      <Button
                        key={day.DayOfWeek}
                        variant={selectedTargetDays.includes(day.DayOfWeek) ? "default" : "outline"}
                        onClick={() => toggleTargetDay(day.DayOfWeek)}
                        className={`justify-start h-auto p-3 ${
                          selectedTargetDays.includes(day.DayOfWeek)
                            ? 'bg-amber-600 hover:bg-amber-700 text-white'
                            : 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <div className="text-right">
                          <div className="font-medium">{DAY_NAMES[day.DayOfWeek]}</div>
                          <div className="text-xs opacity-70">
                            {day.IsWorkingDay ? `${normalizeTime(day.StartTime) || '--'} - ${normalizeTime(day.EndTime) || '--'}` : 'إجازة'}
                          </div>
                        </div>
                      </Button>
                    ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const workDays = schedule
                      .filter(day => day.DayOfWeek !== sourceDay.DayOfWeek && day.IsWorkingDay)
                      .map(day => day.DayOfWeek);
                    setSelectedTargetDays(workDays);
                  }}
                  className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  أيام العمل فقط
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedTargetDays([])}
                  className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  إلغاء التحديد
                </Button>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setCopyModalOpen(false)}
                  className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  إلغاء
                </Button>
                <Button
                  onClick={handleCopySchedule}
                  disabled={selectedTargetDays.length === 0}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  نسخ إلى {selectedTargetDays.length} يوم
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
