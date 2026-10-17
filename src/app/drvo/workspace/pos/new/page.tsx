import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CheckCircle2, ClipboardList, LockKeyhole, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/session';
import { authorizeDrvoPosRead } from '@/platform/pos/authorizePosRead';

export const dynamic = 'force-dynamic';

export default async function NewPosInvoicePage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  if (!await getSession()) redirect('/login');
  const access = await authorizeDrvoPosRead();

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-9">
      <div className="mx-auto max-w-5xl space-y-7">
        <Link href="/drvo/workspace/pos" className="inline-flex items-center gap-2 text-sm text-cyan-300">
          <ArrowRight className="size-4" /> الرجوع للمبيعات
        </Link>
        <div className="rounded-3xl border border-white/10 bg-[#101a2c] p-7 sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            <LockKeyhole className="size-4" /> الحفظ غير متاح حاليًا
          </span>
          <h1 className="mt-5 text-3xl font-black">إنشاء فاتورة جديدة</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            مسار البيع الجديد قيد التجهيز. لن يتم إرسال أو حفظ أي فاتورة قبل ربط كتالوج الخدمات
            والأسعار والموظفين المعتمدين بالفرع الحالي، وتفعيل معاملة الحفظ الآمنة.
          </p>
          {access.ok ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
              <ShieldCheck className="size-5" /> الفرع الحالي: {access.context.activeLocation.branchCode}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
              لا توجد صلاحية للوصول لهذه الوحدة: {access.code}
            </p>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: 'اختيار الخدمات', detail: 'الخدمات والأسعار من كتالوج الفرع المعتمد', icon: ClipboardList },
            { title: 'العميل والموظف', detail: 'ربط العميل والموظف بالشركة والفرع', icon: ShieldCheck },
            { title: 'المراجعة والدفع', detail: 'إجمالي موثوق وحفظ دون تكرار', icon: CheckCircle2 },
          ].map((step, i) => (
            <section key={step.title} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6">
              <step.icon className="size-7 text-cyan-300" />
              <p className="mt-5 text-xs text-slate-500">المرحلة {i + 1}</p>
              <h2 className="mt-2 text-lg font-bold">{step.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">{step.detail}</p>
            </section>
          ))}
        </div>
        <div className="rounded-2xl border border-amber-400/20 p-5 text-sm text-amber-200">
          لا توجد فاتورة محفوظة. لن نستخدم بيانات أو أسعارًا افتراضية لتجربة البيع.
        </div>
      </div>
    </main>
  );
}
