'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import PageHeader from '@/components/shared/PageHeader';

const STEPS = [
  {
    n: 1,
    title: 'الموظف والتعيين',
    body: 'اختر EmpID من TblEmp العام — لا تنشئ موظفاً مكرراً. حدّد الحالة وتاريخ السريان وأهلية الحجز/التشغيل.',
  },
  {
    n: 2,
    title: 'جدول العمل',
    body: 'أيام وساعات الفرع. لا يُسمح بالتشغيل بدون جدول.',
  },
  {
    n: 3,
    title: 'الخدمات المؤهلة',
    body: 'الخدمات التي يمكن للموظف تنفيذها في هذا الفرع فقط.',
  },
  {
    n: 4,
    title: 'خطة الرواتب',
    body: 'hourly | daily | monthly + القيم + تاريخ السريان. لا يوجد fallback على خطة جليم.',
  },
  {
    n: 5,
    title: 'سياسة التarget',
    body: 'خطة تarget خاصة بالفرع أو NO_TARGET صريح. إلزامي.',
  },
  {
    n: 6,
    title: 'مراجعة وتثبيت',
    body: 'commitEmployeeBranchAssignment يثبّت الكل في معاملة واحدة. الرفض عند تداخل فترات الرواتب أو نقص أي خطوة.',
  },
];

export default function BranchSetupEmployeesPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;

  return (
    <div className="mx-auto max-w-3xl p-6" dir="rtl">
      <PageHeader
        title="تعيين موظف للفرع"
        description="معالج التعيين الذري — هوية TblEmp عامة؛ التشغيل والرواتب والتarget ملك الفرع"
      />
      <p className="mt-2 text-sm text-muted-foreground">BranchID: {branchId}</p>
      <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        Phase 1O: لا تُعيَّن موظفون إنتاجيون هنا حتى تُعتمد الخطط والقيم. التعيينات الحقيقية تبقى{' '}
        <strong>OPEN</strong>.
      </p>

      <ol className="mt-6 list-decimal space-y-3 pr-5 text-sm">
        {STEPS.map((step) => (
          <li key={step.n} className="rounded-lg border border-border/60 bg-surface px-3 py-3">
            <div className="font-semibold">
              خطوة {step.n}: {step.title}
            </div>
            <p className="mt-1 text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>

      <ul className="mt-6 list-disc space-y-1 pr-5 text-sm text-muted-foreground">
        <li>لا تكرار لصفوف TblEmp</li>
        <li>لا fallback رواتب/تارجِت من جليم</li>
        <li>لا حضور بدون خطة راتب سارية لهذا الفرع</li>
        <li>لا حجز بدون تعيين + أهلية</li>
        <li>إزالة التعيين لا تحذف سجلات الرواتب/الدفتر التاريخية</li>
      </ul>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/admin/branches/${branchId}/setup`}
          className="rounded-xl border border-border px-4 py-2 text-sm"
        >
          العودة للإعداد
        </Link>
        <Link
          href={`/admin/branches/${branchId}/setup/opening-inventory`}
          className="rounded-xl border border-border px-4 py-2 text-sm"
        >
          خيارات المخزون الافتتاحي
        </Link>
        <Link
          href={`/admin/branches/${branchId}/readiness`}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          الجاهزية
        </Link>
      </div>
    </div>
  );
}
