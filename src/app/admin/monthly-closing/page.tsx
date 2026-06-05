'use client';

import { useState } from 'react';
import { 
  CheckCircle2, Circle, AlertCircle, Lock, Unlock,
  Calendar, DollarSign, Users, TrendingUp, FileCheck,
  RefreshCw, Shield, ClipboardCheck, Banknote
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const TABS = [
  { id: 'daily', label: 'طوال الشهر', icon: Calendar },
  { id: 'before', label: 'قبل التقفيل', icon: ClipboardCheck },
  { id: 'start', label: 'بداية التقفيل', icon: RefreshCw },
  { id: 'salaries', label: 'تقفيل المرتبات', icon: Users },
  { id: 'commissions', label: 'التارجت والعمولات', icon: TrendingUp },
  { id: 'review', label: 'المراجعة النهائية', icon: FileCheck },
  { id: 'close', label: 'إغلاق الشهر', icon: Lock },
] as const;

type TabId = typeof TABS[number]['id'];

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  goal?: string;
  checked: boolean;
}

export default function MonthlyClosingPage() {
  const [activeTab, setActiveTab] = useState<TabId>('daily');
  const [monthLocked, setMonthLocked] = useState(false);

  // Daily tasks checklist
  const [dailyTasks, setDailyTasks] = useState<ChecklistItem[]>([
    { id: '1', label: 'مراجعة الفواتير يوميًا', description: 'مراجعة كل الفواتير واكتشاف أي تكرار أو أخطاء أو بيانات ناقصة', goal: 'الحفاظ على جودة البيانات', checked: false },
    { id: '2', label: 'تقفيل اليوم بيومه', description: 'اعتماد اليوم (Verified) بعد مراجعة الإيرادات والمصروفات', goal: 'منع تراكم الأخطاء', checked: false },
    { id: '3', label: 'تجميع الأموال', description: 'تحويل جميع طرق الدفع إلى وسيلة دفع رئيسية في نهاية اليوم', goal: 'توحيد الرصيد', checked: false },
    { id: '4', label: 'تصفير وسائل الدفع الأخرى', description: 'جميع وسائل الدفع الأخرى تصبح صفر بعد التحويل', goal: 'سهولة المطابقة', checked: false },
    { id: '5', label: 'مراجعة السحوبات', description: 'تسجيل أي سحب للموظفين أو الملاك أولًا بأول', goal: 'منع النسيان آخر الشهر', checked: false },
    { id: '6', label: 'مراجعة المصروفات', description: 'تسجيل جميع المصروفات فور حدوثها', goal: 'دقة الربح', checked: false },
    { id: '7', label: 'مراجعة الإيرادات', description: 'التأكد من تسجيل جميع الإيرادات', goal: 'اكتمال البيانات', checked: false },
    { id: '8', label: 'متابعة التارجت', description: 'متابعة أداء كل موظف وتارجته بشكل مستمر', goal: 'سهولة الحساب آخر الشهر', checked: false },
  ]);

  const [beforeClosingTasks, setBeforeClosingTasks] = useState<ChecklistItem[]>([
    { id: '1', label: 'Data Cleanup', description: 'مراجعة جميع فواتير الشهر بالكامل', goal: 'لا توجد أخطاء أو تكرارات', checked: false },
    { id: '2', label: 'مراجعة المصروفات', description: 'التأكد من عدم وجود مصروفات غير مسجلة', goal: 'جميع المصروفات موجودة', checked: false },
    { id: '3', label: 'مراجعة الإيرادات', description: 'التأكد من عدم وجود إيرادات مفقودة', goal: 'جميع الإيرادات موجودة', checked: false },
    { id: '4', label: 'مراجعة الأيام', description: 'التأكد أن كل أيام الشهر Verified', goal: 'جميع الأيام معتمدة', checked: false },
    { id: '5', label: 'مراجعة وسائل الدفع', description: 'مطابقة أرصدة السيستم مع الواقع', goal: 'الفرق = صفر', checked: false },
    { id: '6', label: 'مراجعة الخزنة', description: 'مطابقة رصيد الخزنة الفعلي مع السيستم', goal: 'الفرق = صفر', checked: false },
    { id: '7', label: 'مراجعة البنك والمحافظ', description: 'مطابقة جميع الأرصدة', goal: 'الفرق = صفر', checked: false },
  ]);

  const [startClosingSteps, setStartClosingSteps] = useState<ChecklistItem[]>([
    { id: '1', label: 'مراجعة وسائل الدفع', description: 'التأكد من دقة جميع الأرصدة', checked: false },
    { id: '2', label: 'تجميع الأموال', description: 'تحويل جميع الأرصدة إلى وسيلة الدفع الرئيسية', checked: false },
    { id: '3', label: 'Refresh', description: 'إعادة تحميل الأرصدة بعد التحويل', checked: false },
    { id: '4', label: 'Verification', description: 'التأكد أن وسيلة الدفع الرئيسية تحتوي على كامل المبلغ', checked: false },
    { id: '5', label: 'Verification', description: 'التأكد أن جميع الوسائل الأخرى = صفر', checked: false },
  ]);

  const [salarySteps, setSalarySteps] = useState<ChecklistItem[]>([
    { id: '1', label: 'الموظف له مرتب مستحق', description: 'تسجيل مصروف وتحويل المبلغ فورًا للموظف', checked: false },
    { id: '2', label: 'Refresh', description: 'إعادة تحميل البيانات', checked: false },
    { id: '3', label: 'Verification', description: 'التأكد من صحة الرصيد بعد التحويل', checked: false },
    { id: '4', label: 'الموظف ساحب أكثر من مرتبه', description: 'ترحيل الفرق للشهر الجديد كرصيد مقدم', checked: false },
    { id: '5', label: 'الموظف مستحق جزء من المرتب', description: 'دفع الفرق فقط', checked: false },
    { id: '6', label: 'الموظف مستلم كامل المرتب', description: 'لا يوجد إجراء', checked: false },
  ]);

  const [commissionSteps, setCommissionSteps] = useState<ChecklistItem[]>([
    { id: '1', label: 'حساب التارجت', description: 'حساب نتيجة كل موظف', checked: false },
    { id: '2', label: 'حساب العمولة', description: 'حساب المستحقات', checked: false },
    { id: '3', label: 'تسجيل النتيجة', description: 'حفظ النتيجة في النظام', checked: false },
    { id: '4', label: 'التحويل', description: 'تحويل العمولة فورًا', checked: false },
    { id: '5', label: 'Refresh', description: 'إعادة تحميل البيانات', checked: false },
    { id: '6', label: 'Verification', description: 'التأكد من نجاح التحويل', checked: false },
  ]);

  const [reviewSteps, setReviewSteps] = useState<ChecklistItem[]>([
    { id: '1', label: 'إجمالي الإيرادات', description: 'مراجعة الرقم النهائي', checked: false },
    { id: '2', label: 'إجمالي المصروفات', description: 'مراجعة الرقم النهائي', checked: false },
    { id: '3', label: 'إجمالي المرتبات', description: 'مراجعة الرقم النهائي', checked: false },
    { id: '4', label: 'إجمالي العمولات', description: 'مراجعة الرقم النهائي', checked: false },
    { id: '5', label: 'صافي الربح', description: 'حساب صافي الربح', checked: false },
    { id: '6', label: 'المطابقة الفعلية', description: 'مقارنة السيستم بالواقع', checked: false },
    { id: '7', label: 'التحقق النهائي', description: 'الفرق = صفر', checked: false },
  ]);

  const [closingChecks, setClosingChecks] = useState<ChecklistItem[]>([
    { id: '1', label: 'جميع الأيام Verified', description: 'كل أيام الشهر معتمدة', checked: false },
    { id: '2', label: 'جميع وسائل الدفع مطابقة', description: 'لا يوجد فروقات', checked: false },
    { id: '3', label: 'جميع المصروفات مسجلة', description: 'لا توجد مصروفات مفقودة', checked: false },
    { id: '4', label: 'جميع الإيرادات مسجلة', description: 'لا توجد إيرادات مفقودة', checked: false },
    { id: '5', label: 'جميع المرتبات مسواة', description: 'تم دفع جميع المستحقات', checked: false },
    { id: '6', label: 'جميع التارجتات محسوبة', description: 'تم حساب جميع الأهداف', checked: false },
    { id: '7', label: 'جميع العمولات مدفوعة', description: 'تم دفع جميع العمولات', checked: false },
    { id: '8', label: 'صافي الربح مطابق للواقع', description: 'الأرقام صحيحة', checked: false },
    { id: '9', label: 'لا يوجد فروقات', description: 'كل شيء متطابق', checked: false },
  ]);

  const toggleTask = (taskId: string, setter: React.Dispatch<React.SetStateAction<ChecklistItem[]>>) => {
    setter(prev => prev.map(task => 
      task.id === taskId ? { ...task, checked: !task.checked } : task
    ));
  };

  const getProgress = (tasks: ChecklistItem[]) => {
    const completed = tasks.filter(t => t.checked).length;
    const total = tasks.length;
    return { completed, total, percentage: total > 0 ? (completed / total) * 100 : 0 };
  };

  const renderChecklist = (
    tasks: ChecklistItem[], 
    setter: React.Dispatch<React.SetStateAction<ChecklistItem[]>>,
    showGoal = false
  ) => {
    const progress = getProgress(tasks);
    
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-400">
              التقدم: <span className="font-bold text-white">{progress.completed}</span> / {progress.total}
            </div>
            <div className="w-48 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <span className="text-sm font-bold text-emerald-400">{progress.percentage.toFixed(0)}%</span>
          </div>
        </div>

        <div className="space-y-2">
          {tasks.map((task, idx) => (
            <div
              key={task.id}
              className={`group border rounded-lg p-4 transition-all cursor-pointer ${
                task.checked
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
              }`}
              onClick={() => toggleTask(task.id, setter)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {task.checked ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-500 group-hover:text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500">#{idx + 1}</span>
                        <h4 className={`font-semibold ${task.checked ? 'text-emerald-300' : 'text-white'}`}>
                          {task.label}
                        </h4>
                      </div>
                      <p className="text-sm text-slate-400 mt-1">{task.description}</p>
                      {showGoal && task.goal && (
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant="outline" className="text-xs bg-purple-500/10 border-purple-500/30 text-purple-300">
                            الهدف: {task.goal}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const allTasksCompleted = closingChecks.every(t => t.checked);

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHeader
        title="تقفيل الشهر"
        description="دليل شامل لإجراءات تقفيل الشهر المحاسبي"
      />

      {/* Month Status */}
      <div className={`mb-6 border rounded-xl p-6 ${
        monthLocked 
          ? 'bg-rose-500/10 border-rose-500/30' 
          : 'bg-slate-800/50 border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {monthLocked ? (
              <Lock className="w-8 h-8 text-rose-400" />
            ) : (
              <Unlock className="w-8 h-8 text-emerald-400" />
            )}
            <div>
              <h3 className="text-xl font-bold text-white">
                {monthLocked ? 'الشهر مغلق' : 'الشهر مفتوح'}
              </h3>
              <p className="text-sm text-slate-400">
                {monthLocked 
                  ? 'تم إغلاق الشهر - لا يمكن التعديل'
                  : 'الشهر مفتوح - يمكن التعديل'
                }
              </p>
            </div>
          </div>
          {!monthLocked && allTasksCompleted && (
            <Button
              onClick={() => setMonthLocked(true)}
              className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600"
            >
              <Lock className="w-4 h-4 ml-2" />
              إغلاق الشهر نهائياً
            </Button>
          )}
          {monthLocked && (
            <Button
              onClick={() => setMonthLocked(false)}
              variant="outline"
              className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
            >
              <Unlock className="w-4 h-4 ml-2" />
              إعادة فتح الشهر
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          let progress = { completed: 0, total: 0 };
          if (id === 'daily') progress = getProgress(dailyTasks);
          else if (id === 'before') progress = getProgress(beforeClosingTasks);
          else if (id === 'start') progress = getProgress(startClosingSteps);
          else if (id === 'salaries') progress = getProgress(salarySteps);
          else if (id === 'commissions') progress = getProgress(commissionSteps);
          else if (id === 'review') progress = getProgress(reviewSteps);
          else if (id === 'close') progress = getProgress(closingChecks);

          const isComplete = progress.completed === progress.total && progress.total > 0;

          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === id
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-6">
        {activeTab === 'daily' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-amber-400" />
              المهام اليومية طوال الشهر
            </h2>
            <p className="text-slate-400 mb-6">
              هذه المهام يجب تنفيذها يومياً طوال الشهر لضمان دقة البيانات وسهولة التقفيل
            </p>
            {renderChecklist(dailyTasks, setDailyTasks, true)}
          </div>
        )}

        {activeTab === 'before' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-blue-400" />
              مراجعة ما قبل التقفيل
            </h2>
            <p className="text-slate-400 mb-6">
              تأكد من اكتمال جميع هذه الخطوات قبل البدء في عملية التقفيل
            </p>
            {renderChecklist(beforeClosingTasks, setBeforeClosingTasks, true)}
          </div>
        )}

        {activeTab === 'start' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <RefreshCw className="w-6 h-6 text-purple-400" />
              بداية عملية التقفيل
            </h2>
            <p className="text-slate-400 mb-6">
              خطوات تجميع الأموال والتحقق من الأرصدة
            </p>
            {renderChecklist(startClosingSteps, setStartClosingSteps)}
          </div>
        )}

        {activeTab === 'salaries' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <Users className="w-6 h-6 text-emerald-400" />
              تقفيل المرتبات
            </h2>
            <p className="text-slate-400 mb-6">
              إجراءات تسوية مرتبات الموظفين وسلفهم
            </p>
            {renderChecklist(salarySteps, setSalarySteps)}
          </div>
        )}

        {activeTab === 'commissions' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-teal-400" />
              التارجت والعمولات
            </h2>
            <p className="text-slate-400 mb-6">
              حساب ودفع عمولات الموظفين بناءً على الأهداف المحققة
            </p>
            {renderChecklist(commissionSteps, setCommissionSteps)}
          </div>
        )}

        {activeTab === 'review' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <FileCheck className="w-6 h-6 text-orange-400" />
              المراجعة النهائية
            </h2>
            <p className="text-slate-400 mb-6">
              مراجعة جميع الأرقام والتأكد من دقة البيانات قبل الإغلاق النهائي
            </p>
            {renderChecklist(reviewSteps, setReviewSteps)}
          </div>
        )}

        {activeTab === 'close' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              <Lock className="w-6 h-6 text-rose-400" />
              إغلاق الشهر
            </h2>
            <p className="text-slate-400 mb-6">
              التحقق النهائي من جميع الشروط قبل إغلاق الشهر
            </p>
            {renderChecklist(closingChecks, setClosingChecks)}

            {allTasksCompleted && !monthLocked && (
              <div className="mt-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <Shield className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-emerald-300 mb-2">
                      جاهز للإغلاق النهائي
                    </h3>
                    <p className="text-sm text-emerald-200 mb-4">
                      تم استيفاء جميع الشروط. يمكنك الآن إغلاق الشهر نهائياً.
                    </p>
                    <Button
                      onClick={() => setMonthLocked(true)}
                      className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                    >
                      <Lock className="w-4 h-4 ml-2" />
                      إغلاق الشهر الآن
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
