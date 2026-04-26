'use client';

import { useState, useEffect } from 'react';
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
import { 
  User, Calendar, Clock, DollarSign, Link2, 
  Save, Plus, Edit2, Trash2, Loader2, CheckCircle2, AlertCircle
} from 'lucide-react';
import type { Employee, WorkSchedule, DayOff } from '@/lib/types';

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
  NationalID?: string;
  Address?: string;
  EmergencyContactName?: string;
  EmergencyContactPhone?: string;
  BirthDate?: string;
  HireDate?: string;
  PersonalNotes?: string;
  BaseSalary?: number;
  TargetCommissionPercent?: number;
  TargetMinSales?: number;
  DefaultCheckInTime?: string;
  DefaultCheckOutTime?: string;
  IsPayrollEnabled?: boolean;
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

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const OFF_TYPE_LABELS = {
  day_off: 'إجازة',
  sick: 'مرضي',
  emergency: 'طارئة',
  annual: 'سنوية'
};

export default function EmployeeManagementModal({ 
  employee, open, onClose, onRefresh, onOpenWorkHours 
}: EmployeeManagementModalProps) {
  // Profile state
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Schedule state
  const [schedule, setSchedule] = useState<WorkScheduleItem[]>([]);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSuccess, setScheduleSuccess] = useState('');

  // Days off state
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [newDayOff, setNewDayOff] = useState({
    OffDate: '',
    OffType: 'day_off',
    Reason: '',
    IsPaid: false
  });
  const [dayOffSaving, setDayOffSaving] = useState(false);
  const [dayOffError, setDayOffError] = useState('');
  const [dayOffSuccess, setDayOffSuccess] = useState('');

  // Finance categories state
  const [advanceCategories, setAdvanceCategories] = useState<any[]>([]);
  const [revenueCategories, setRevenueCategories] = useState<any[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<string>('');
  const [selectedRevenue, setSelectedRevenue] = useState<string>('');
  const [financeError, setFinanceError] = useState('');
  const [financeSuccess, setFinanceSuccess] = useState('');
  const [financeSaving, setFinanceSaving] = useState(false);

  // Load employee data when modal opens
  useEffect(() => {
    if (open && employee) {
      loadEmployeeData();
      loadFinanceCategories();
    }
  }, [open, employee]);

  const loadEmployeeData = async () => {
    if (!employee) return;

    try {
      const response = await fetch(`/api/admin/employees/${employee.EmpID}/profile`);
      const data = await response.json();
      
      if (data.success) {
        setProfile(data.employee);
        setSchedule(data.schedule);
        setDaysOff(data.daysOff);
        setSelectedAdvance(data.employee.AdvanceExpINID?.toString() || '');
        setSelectedRevenue(data.employee.RevenueExpINID?.toString() || '');
      }
    } catch (error) {
      console.error('Error loading employee data:', error);
    }
  };

  const loadFinanceCategories = async () => {
    try {
      const response = await fetch('/api/finance/categories');
      const data = await response.json();
      
      if (data.success) {
        setAdvanceCategories(data.categories.filter((c: any) => c.ExpINType === 'مصروفات'));
        setRevenueCategories(data.categories.filter((c: any) => c.ExpINType === 'ايرادات'));
      }
    } catch (error) {
      console.error('Error loading finance categories:', error);
    }
  };

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
        body: JSON.stringify(profile)
      });

      const data = await response.json();
      
      if (data.success) {
        setProfileSuccess('تم حفظ البيانات الشخصية بنجاح');
        setProfile(data.employee);
        onRefresh();
      } else {
        setProfileError(data.error || 'خطأ في حفظ البيانات');
      }
    } catch (error) {
      setProfileError('خطأ في الاتصال بالخادم');
    } finally {
      setProfileSaving(false);
    }
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

      const data = await response.json();
      
      if (data.success) {
        setScheduleSuccess('تم حفظ جدول المواعيد بنجاح');
        setSchedule(data.schedule);
      } else {
        setScheduleError(data.error || 'خطأ في حفظ جدول المواعيد');
      }
    } catch (error) {
      setScheduleError('خطأ في الاتصال بالخادم');
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleScheduleChange = (dayIndex: number, field: keyof WorkScheduleItem, value: any) => {
    const updatedSchedule = [...schedule];
    updatedSchedule[dayIndex] = {
      ...updatedSchedule[dayIndex],
      [field]: value
    };
    setSchedule(updatedSchedule);
  };

  // Days off handlers
  const handleAddDayOff = async () => {
    if (!profile || !newDayOff.OffDate) return;

    setDayOffSaving(true);
    setDayOffError('');
    setDayOffSuccess('');

    try {
      const response = await fetch(`/api/admin/employees/${profile.EmpID}/days-off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDayOff)
      });

      const data = await response.json();
      
      if (data.success) {
        setDayOffSuccess('تم إضافة الإجازة بنجاح');
        setNewDayOff({ OffDate: '', OffType: 'day_off', Reason: '', IsPaid: false });
        loadEmployeeData(); // Reload to get updated list
      } else {
        setDayOffError(data.error || 'خطأ في إضافة الإجازة');
      }
    } catch (error) {
      setDayOffError('خطأ في الاتصال بالخادم');
    } finally {
      setDayOffSaving(false);
    }
  };

  const handleDeleteDayOff = async (dayOffId: number) => {
    if (!profile) return;

    try {
      const response = await fetch(`/api/admin/employees/${profile.EmpID}/days-off/${dayOffId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      
      if (data.success) {
        setDaysOff(daysOff.filter(d => d.ID !== dayOffId));
      }
    } catch (error) {
      console.error('Error deleting day off:', error);
    }
  };

  // Finance mapping handlers
  const handleFinanceMappingSave = async () => {
    if (!profile) return;

    try {
      const response = await fetch(`/api/admin/employees/${profile.EmpID}/finance-map`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          advanceExpINID: selectedAdvance ? parseInt(selectedAdvance) : null,
          revenueExpINID: selectedRevenue ? parseInt(selectedRevenue) : null
        })
      });

      const data = await response.json();
      
      if (data.success) {
        onRefresh();
      }
    } catch (error) {
      console.error('Error updating finance mapping:', error);
    }
  };

  const handleFinanceSave = async () => {
    if (!employee) return;
    
    try {
      setFinanceSaving(true);
      setFinanceError('');
      setFinanceSuccess('');

      const response = await fetch(`/api/admin/employees/${employee.EmpID}/finance-map`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          advanceExpINID: selectedAdvance ? parseInt(selectedAdvance) : null,
          revenueExpINID: selectedRevenue ? parseInt(selectedRevenue) : null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'فشل حفظ الربط المالي');
      }

      setFinanceSuccess('تم حفظ الربط المالي بنجاح');
      onRefresh();
    } catch (error: any) {
      setFinanceError(error.message);
    } finally {
      setFinanceSaving(false);
    }
  };

  const updateScheduleDay = (dayOfWeek: number, field: string, value: any) => {
    setSchedule(prev => prev.map(day => 
      day.DayOfWeek === dayOfWeek 
        ? { ...day, [field]: value }
        : day
    ));
  };

  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  if (!employee || !profile) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="!w-screen !h-screen !max-w-none !max-h-screen !overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 !border-slate-700 !shadow-2xl !m-0 !rounded-none !p-0" dir="rtl">
        <DialogHeader className="!bg-gradient-to-r from-amber-600/20 to-orange-600/20 !p-8 !border-b !border-slate-700">
          <DialogTitle className="flex items-center gap-4 text-3xl font-bold text-white">
            <div className="p-3 bg-amber-500/20 rounded-xl">
              <User className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <div>إدارة الموظف</div>
              <div className="text-xl font-normal text-slate-300">{profile.EmpName}</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 px-12 pt-8 pb-8 overflow-hidden">
          <Tabs defaultValue="profile" className="w-full h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-5 h-20 bg-slate-800/50 border border-slate-700 rounded-xl p-3 mb-10">
              <TabsTrigger value="profile" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-200">
                <User className="w-4 h-4" />
                <span className="font-medium">البيانات الشخصية</span>
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-200">
                <Clock className="w-4 h-4" />
                <span className="font-medium">مواعيد العمل</span>
              </TabsTrigger>
              <TabsTrigger value="days-off" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-200">
                <Calendar className="w-4 h-4" />
                <span className="font-medium">أيام الإجازة</span>
              </TabsTrigger>
              <TabsTrigger value="finance" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-200">
                <Link2 className="w-4 h-4" />
                <span className="font-medium">الربط المالي</span>
              </TabsTrigger>
              <TabsTrigger value="payroll" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-red-500 data-[state=active]:to-rose-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-200">
                <DollarSign className="w-4 h-4" />
                <span className="font-medium">إعدادات المرتب</span>
              </TabsTrigger>
            </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="flex-1 mt-10 overflow-y-auto pr-4 space-y-10">
            <div className="bg-slate-800/50 rounded-xl p-10 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-amber-400" />
                المعلومات الأساسية
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <Label htmlFor="empName" className="text-slate-300 font-medium text-lg">الاسم *</Label>
                  <Input
                    id="empName"
                    value={profile.EmpName || ''}
                    onChange={(e) => setProfile({...profile, EmpName: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-amber-500 focus:ring-amber-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="job" className="text-slate-300 font-medium text-lg">الوظيفة</Label>
                  <Input
                    id="job"
                    value={profile.Job || ''}
                    onChange={(e) => setProfile({...profile, Job: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-amber-500 focus:ring-amber-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="mobile" className="text-slate-300 font-medium text-lg">رقم الموبايل</Label>
                  <Input
                    id="mobile"
                    value={profile.Mobile || ''}
                    onChange={(e) => setProfile({...profile, Mobile: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-amber-500 focus:ring-amber-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="cardNo" className="text-slate-300 font-medium text-lg">رقم الكارت</Label>
                  <Input
                    id="cardNo"
                    value={profile.CardNO || ''}
                    onChange={(e) => setProfile({...profile, CardNO: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-amber-500 focus:ring-amber-500/20 h-12 text-lg"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-xl p-10 border border-slate-700">
              <h3 className="text-xl font-semibold text-white mb-8 flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <User className="w-6 h-6 text-blue-400" />
                </div>
                المعلومات الشخصية
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <Label htmlFor="nationalId" className="text-slate-300 font-medium text-lg">الرقم القومي</Label>
                  <Input
                    id="nationalId"
                    value={profile.NationalID || ''}
                    onChange={(e) => setProfile({...profile, NationalID: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="address" className="text-slate-300 font-medium text-lg">العنوان</Label>
                  <Input
                    id="address"
                    value={profile.Address || ''}
                    onChange={(e) => setProfile({...profile, Address: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="emergencyContactName" className="text-slate-300 font-medium text-lg">اسم شخص للطوارئ</Label>
                  <Input
                    id="emergencyContactName"
                    value={profile.EmergencyContactName || ''}
                    onChange={(e) => setProfile({...profile, EmergencyContactName: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="emergencyContactPhone" className="text-slate-300 font-medium text-lg">رقم الطوارئ</Label>
                  <Input
                    id="emergencyContactPhone"
                    value={profile.EmergencyContactPhone || ''}
                    onChange={(e) => setProfile({...profile, EmergencyContactPhone: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="birthDate" className="text-slate-300 font-medium text-lg">تاريخ الميلاد</Label>
                  <Input
                    id="birthDate"
                    type="date"
                    value={profile.BirthDate || ''}
                    onChange={(e) => setProfile({...profile, BirthDate: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-12 text-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="hireDate" className="text-slate-300 font-medium text-lg">تاريخ التعيين</Label>
                  <Input
                    id="hireDate"
                    type="date"
                    value={profile.HireDate || ''}
                    onChange={(e) => setProfile({...profile, HireDate: e.target.value})}
                    className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-12 text-lg"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-xl p-10 border border-slate-700">
              <Label htmlFor="personalNotes" className="text-slate-300 font-medium text-xl block mb-6">ملاحظات شخصية</Label>
              <Textarea
                id="personalNotes"
                value={profile.PersonalNotes || ''}
                onChange={(e) => setProfile({...profile, PersonalNotes: e.target.value})}
                rows={6}
                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 resize-none text-lg p-4"
                placeholder="أي ملاحظات إضافية عن الموظف..."
              />
            </div>

            {/* Work Hours Section */}
            <div className="bg-slate-800/50 rounded-xl p-10 border border-slate-700">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-semibold text-white flex items-center gap-3">
                  <Clock className="w-6 h-6 text-blue-400" />
                  مواعيد العمل المتفق عليها
                </h3>
                <Button
                  onClick={() => {
                    if (employee && onOpenWorkHours) {
                      onOpenWorkHours(employee);
                    }
                  }}
                  variant="outline"
                  className="bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30"
                >
                  <Clock className="w-4 h-4 ml-2" />
                  تعديل المواعيد
                </Button>
              </div>
              
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label className="text-slate-300 font-medium text-lg block mb-3">وقت البدء</Label>
                  <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                    <span className="text-white text-lg font-mono">
                      {employee?.DefaultCheckInTime || 'غير محدد'}
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-slate-300 font-medium text-lg block mb-3">وقت الانتهاء</Label>
                  <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                    <span className="text-white text-lg font-mono">
                      {employee?.DefaultCheckOutTime || 'غير محدد'}
                    </span>
                  </div>
                </div>
              </div>

              {employee?.DefaultCheckInTime && employee?.DefaultCheckOutTime && (
                <div className="mt-6">
                  {employee.DefaultCheckOutTime < employee.DefaultCheckInTime && (
                    <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-blue-400" />
                      <span className="text-blue-400 text-sm">الدوام يمتد لليوم التالي</span>
                    </div>
                  )}
                  
                  {employee.WorkScheduleNotes && (
                    <div className="mt-3">
                      <Label className="text-slate-300 font-medium text-sm block mb-2">ملاحظات العمل</Label>
                      <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3">
                        <p className="text-slate-300 text-sm">{employee.WorkScheduleNotes}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!employee?.DefaultCheckInTime && !employee?.DefaultCheckOutTime && (
                <div className="mt-6 flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-400 text-sm">لم يتم تحديد مواعيد عمل بعد</span>
                </div>
              )}
            </div>

            {profileError && (
              <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{profileError}</span>
              </div>
            )}

            {profileSuccess && (
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{profileSuccess}</span>
              </div>
            )}

            <Button 
              onClick={handleProfileSave} 
              disabled={profileSaving} 
              className="w-full h-12 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {profileSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin ml-2" /> 
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5 ml-2" /> 
                  حفظ البيانات الشخصية
                </>
              )}
            </Button>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="flex-1 mt-10 overflow-y-auto pr-4 space-y-10">
            <div className="bg-slate-800/50 rounded-xl p-10 border border-slate-700">
              <h3 className="text-xl font-semibold text-white mb-8 flex items-center gap-3">
                <Clock className="w-6 h-6 text-blue-400" />
                جدول العمل الأسبوعي
              </h3>
              
              {/* Quick Actions */}
              <div className="flex gap-4 mb-8">
                <Button
                  onClick={() => {
                    const updatedSchedule = schedule.map(day => ({
                      ...day,
                      IsWorkingDay: true,
                      StartTime: '09:00',
                      EndTime: '17:00',
                      BreakStartTime: '13:00',
                      BreakEndTime: '14:00'
                    }));
                    setSchedule(updatedSchedule);
                  }}
                  className="bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30"
                >
                  <Clock className="w-4 h-4 ml-2" />
                  تطبيق جدول قياسي
                </Button>
                <Button
                  onClick={() => {
                    const updatedSchedule = schedule.map(day => ({
                      ...day,
                      IsWorkingDay: false,
                      StartTime: '',
                      EndTime: '',
                      BreakStartTime: '',
                      BreakEndTime: ''
                    }));
                    setSchedule(updatedSchedule);
                  }}
                  className="bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30"
                >
                  <Calendar className="w-4 h-4 ml-2" />
                  إجازة الأسبوع كله
                </Button>
              </div>

              {/* Weekly Schedule Table */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-600">
                      <th className="text-right p-4 text-slate-300 font-semibold">اليوم</th>
                      <th className="text-center p-4 text-slate-300 font-semibold">الحالة</th>
                      <th className="text-center p-4 text-slate-300 font-semibold">وقت البدء</th>
                      <th className="text-center p-4 text-slate-300 font-semibold">وقت الانتهاء</th>
                      <th className="text-center p-4 text-slate-300 font-semibold">بداية الراحة</th>
                      <th className="text-center p-4 text-slate-300 font-semibold">نهاية الراحة</th>
                      <th className="text-right p-4 text-slate-300 font-semibold">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((day, index) => (
                      <tr key={day.DayOfWeek} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${!day.IsWorkingDay ? 'opacity-60' : ''}`}>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={day.IsWorkingDay}
                              onCheckedChange={(checked) => updateScheduleDay(day.DayOfWeek, 'IsWorkingDay', checked)}
                              className="data-[state=checked]:bg-blue-500"
                            />
                            <span className={`font-semibold text-lg ${day.IsWorkingDay ? 'text-white' : 'text-slate-400'}`}>
                              {dayNames[day.DayOfWeek]}
                            </span>
                          </div>
                        </td>
                        <td className="text-center p-4">
                          {day.IsWorkingDay ? (
                            <span className="px-3 py-1 bg-green-500/20 text-green-400 text-sm rounded-full font-medium">عمل</span>
                          ) : (
                            <span className="px-3 py-1 bg-red-500/20 text-red-400 text-sm rounded-full font-medium">إجازة</span>
                          )}
                        </td>
                        <td className="text-center p-4">
                          <Input
                            type="time"
                            value={day.StartTime || ''}
                            onChange={(e) => updateScheduleDay(day.DayOfWeek, 'StartTime', e.target.value)}
                            disabled={!day.IsWorkingDay}
                            className="bg-slate-600/50 border-slate-500 text-white focus:border-blue-500 focus:ring-blue-500/20 h-10 text-center disabled:opacity-50"
                          />
                        </td>
                        <td className="text-center p-4">
                          <Input
                            type="time"
                            value={day.EndTime || ''}
                            onChange={(e) => updateScheduleDay(day.DayOfWeek, 'EndTime', e.target.value)}
                            disabled={!day.IsWorkingDay}
                            className="bg-slate-600/50 border-slate-500 text-white focus:border-blue-500 focus:ring-blue-500/20 h-10 text-center disabled:opacity-50"
                          />
                        </td>
                        <td className="text-center p-4">
                          <Input
                            type="time"
                            value={day.BreakStartTime || ''}
                            onChange={(e) => updateScheduleDay(day.DayOfWeek, 'BreakStartTime', e.target.value)}
                            disabled={!day.IsWorkingDay}
                            className="bg-slate-600/50 border-slate-500 text-white focus:border-blue-500 focus:ring-blue-500/20 h-10 text-center disabled:opacity-50"
                          />
                        </td>
                        <td className="text-center p-4">
                          <Input
                            type="time"
                            value={day.BreakEndTime || ''}
                            onChange={(e) => updateScheduleDay(day.DayOfWeek, 'BreakEndTime', e.target.value)}
                            disabled={!day.IsWorkingDay}
                            className="bg-slate-600/50 border-slate-500 text-white focus:border-blue-500 focus:ring-blue-500/20 h-10 text-center disabled:opacity-50"
                          />
                        </td>
                        <td className="p-4">
                          <Input
                            value={day.Notes || ''}
                            onChange={(e) => updateScheduleDay(day.DayOfWeek, 'Notes', e.target.value)}
                            disabled={!day.IsWorkingDay}
                            placeholder="ملاحظات..."
                            className="bg-slate-600/50 border-slate-500 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 h-10 disabled:opacity-50"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary Statistics */}
              <div className="mt-8 grid grid-cols-3 gap-6">
                <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-400">
                    {schedule.filter(day => day.IsWorkingDay).length}
                  </div>
                  <div className="text-slate-400 text-sm">أيام العمل</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-400">
                    {schedule.filter(day => day.IsWorkingDay && day.StartTime && day.EndTime).length}
                  </div>
                  <div className="text-slate-400 text-sm">أيام محددة الأوقات</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-orange-400">
                    {schedule.filter(day => day.IsWorkingDay && day.BreakStartTime && day.BreakEndTime).length}
                  </div>
                  <div className="text-slate-400 text-sm">أيام محددة الراحة</div>
                </div>
              </div>
            </div>

            {scheduleError && (
              <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{scheduleError}</span>
              </div>
            )}

            {scheduleSuccess && (
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{scheduleSuccess}</span>
              </div>
            )}

            <Button 
              onClick={handleScheduleSave} 
              disabled={scheduleSaving} 
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scheduleSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin ml-2" /> 
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5 ml-2" /> 
                  حفظ مواعيد العمل
                </>
              )}
            </Button>
          </TabsContent>

          {/* Days Off Tab */}
          <TabsContent value="days-off" className="mt-8 max-h-[65vh] overflow-y-auto pr-4 space-y-8">
            <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-8 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-400" />
                إدارة الإجازات
              </h3>
              
              <div className="bg-slate-700/30 rounded-xl p-6 border border-slate-600/50 mb-8">
                <h4 className="font-semibold text-white mb-4">إضافة إجازة جديدة</h4>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <Label className="text-slate-300 font-medium">التاريخ</Label>
                    <Input
                      type="date"
                      value={newDayOff.OffDate}
                      onChange={(e) => setNewDayOff({...newDayOff, OffDate: e.target.value})}
                      className="bg-slate-600/50 border-slate-500 text-white focus:border-purple-500 focus:ring-purple-500/20"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300 font-medium">نوع الإجازة</Label>
                    <Select value={newDayOff.OffType} onValueChange={(value) => setNewDayOff({...newDayOff, OffType: value})}>
                      <SelectTrigger className="bg-slate-600/50 border-slate-500 text-white focus:border-purple-500 focus:ring-purple-500/20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600">
                        <SelectItem value="day_off" className="text-white">إجازة</SelectItem>
                        <SelectItem value="sick" className="text-white">إجازة مرضية</SelectItem>
                        <SelectItem value="emergency" className="text-white">إجازة طارئة</SelectItem>
                        <SelectItem value="annual" className="text-white">إجازة سنوية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-slate-300 font-medium">السبب</Label>
                    <Input
                      value={newDayOff.Reason || ''}
                      onChange={(e) => setNewDayOff({...newDayOff, Reason: e.target.value})}
                      placeholder="سبب الإجازة..."
                      className="bg-slate-600/50 border-slate-500 text-white placeholder:text-slate-400 focus:border-purple-500 focus:ring-purple-500/20"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button 
                      onClick={handleAddDayOff} 
                      disabled={dayOffSaving}
                      className="w-full h-10 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium rounded-lg shadow-lg hover:shadow-xl transition-all duration-200"
                    >
                      {dayOffSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-white">الإجازات المسجلة</h4>
                {daysOff.map((dayOff) => (
                  <div key={dayOff.ID} className="bg-slate-700/30 rounded-xl p-4 border border-slate-600/50 hover:border-purple-500/30 transition-all duration-200">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-semibold text-white">{dayOff.OffDate}</span>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            dayOff.OffType === 'sick' ? 'bg-red-500/20 text-red-400' :
                            dayOff.OffType === 'emergency' ? 'bg-orange-500/20 text-orange-400' :
                            dayOff.OffType === 'annual' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {dayOff.OffType === 'day_off' ? 'إجازة' :
                             dayOff.OffType === 'sick' ? 'إجازة مرضية' :
                             dayOff.OffType === 'emergency' ? 'إجازة طارئة' :
                             'إجازة سنوية'}
                          </span>
                        </div>
                        {dayOff.Reason && (
                          <div className="text-slate-400 text-sm">{dayOff.Reason}</div>
                        )}
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleDeleteDayOff(dayOff.ID)}
                        className="bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-all duration-200"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {daysOff.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>لا توجد إجازات مسجلة</p>
                  </div>
                )}
              </div>
            </div>

            {dayOffError && (
              <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{dayOffError}</span>
              </div>
            )}

            {dayOffSuccess && (
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{dayOffSuccess}</span>
              </div>
            )}
          </TabsContent>

          {/* Finance Tab */}
          <TabsContent value="finance" className="mt-8 max-h-[65vh] overflow-y-auto pr-4 space-y-8">
            <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-8 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-green-400" />
                الربط المالي
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <Label className="text-slate-300 font-medium">تصنيف السلفة</Label>
                  <Select value={selectedAdvance?.toString() || ''} onValueChange={(value) => setSelectedAdvance(value)}>
                    <SelectTrigger className="bg-slate-600/50 border-slate-500 text-white focus:border-green-500 focus:ring-green-500/20">
                      <SelectValue placeholder="اختر تصنيف السلفة" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-600">
                      {advanceCategories?.map(cat => (
                        <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()} className="text-white">
                          {cat.CatName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-300 font-medium">تصنيف الإيراد</Label>
                  <Select value={selectedRevenue?.toString() || ''} onValueChange={(value) => setSelectedRevenue(value)}>
                    <SelectTrigger className="bg-slate-600/50 border-slate-500 text-white focus:border-green-500 focus:ring-green-500/20">
                      <SelectValue placeholder="اختر تصنيف الإيراد" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-600">
                      {revenueCategories?.map(cat => (
                        <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()} className="text-white">
                          {cat.CatName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {financeError && (
              <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{financeError}</span>
              </div>
            )}

            {financeSuccess && (
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{financeSuccess}</span>
              </div>
            )}

            <Button 
              onClick={handleFinanceSave} 
              disabled={financeSaving} 
              className="w-full h-12 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {financeSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin ml-2" /> 
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5 ml-2" /> 
                  حفظ الربط المالي
                </>
              )}
            </Button>
          </TabsContent>

          {/* Payroll Tab */}
          <TabsContent value="payroll" className="mt-8 max-h-[65vh] overflow-y-auto pr-4 space-y-8">
            <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-8 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-red-400" />
                إعدادات المرتب
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <Label className="text-slate-300 font-medium">الراتب الأساسي</Label>
                  <Input
                    type="number"
                    value={profile.BaseSalary || ''}
                    onChange={(e) => setProfile({...profile, BaseSalary: parseFloat(e.target.value) || 0})}
                    className="bg-slate-600/50 border-slate-500 text-white focus:border-red-500 focus:ring-red-500/20"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 font-medium">نسبة العمولة المستهدفة (%)</Label>
                  <Input
                    type="number"
                    value={profile.TargetCommissionPercent || ''}
                    onChange={(e) => setProfile({...profile, TargetCommissionPercent: parseFloat(e.target.value) || 0})}
                    className="bg-slate-600/50 border-slate-500 text-white focus:border-red-500 focus:ring-red-500/20"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 font-medium">الحد الأدنى للمبيعات المستهدف</Label>
                  <Input
                    type="number"
                    value={profile.TargetMinSales || ''}
                    onChange={(e) => setProfile({...profile, TargetMinSales: parseFloat(e.target.value) || 0})}
                    className="bg-slate-600/50 border-slate-500 text-white focus:border-red-500 focus:ring-red-500/20"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 font-medium">تسجيل المرتب</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Switch
                      checked={profile.IsPayrollEnabled || false}
                      onCheckedChange={(checked) => setProfile({...profile, IsPayrollEnabled: checked})}
                      className="data-[state=checked]:bg-red-500"
                    />
                    <span className="text-slate-300">تفعيل حساب المرتب</span>
                  </div>
                </div>
              </div>
            </div>

            <Button 
              onClick={handleProfileSave} 
              disabled={profileSaving} 
              className="w-full h-12 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {profileSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin ml-2" /> 
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5 ml-2" /> 
                  حفظ إعدادات المرتب
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
