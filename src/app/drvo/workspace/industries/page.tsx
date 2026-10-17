import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Blocks, Building2, Check, LockKeyhole, Scissors, ShieldCheck, ShoppingBasket, Stethoscope } from 'lucide-react';
import { getSession } from '@/lib/session';
import { DRVO_CORE_CAPABILITIES, DRVO_VERTICALS } from '@/platform/verticals/registry';

export const dynamic = 'force-dynamic';

const icons = { barbershop: Scissors, clinic: Stethoscope, retail: ShoppingBasket };

export default async function IndustriesPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-9">
      <div className="mx-auto max-w-7xl space-y-8">
        <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300">
          <ArrowRight className="size-4" /> مساحة العمل
        </Link>
        <header className="rounded-3xl border border-cyan-300/15 bg-gradient-to-l from-[#12324a] to-[#101a2c] p-7 sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-200"><Blocks className="size-4" /> DRVO BUSINESS OS</span>
          <h1 className="mt-5 text-3xl font-black sm:text-4xl">منصة واحدة. أنشطة مختلفة.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300">نفس محرك الشركات والصلاحيات والمبيعات والعملاء لكل نشاط، مع إضافات متخصصة لكل صناعة. ده كتالوج التصميم المعماري الحالي، مش قائمة وحدات تم تفعيلها بالفعل.</p>
        </header>
        <section>
          <h2 className="mb-4 text-xl font-bold">الأساس المشترك بين كل الشركات</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(DRVO_CORE_CAPABILITIES).map(([key, capability]) => (
              <article key={key} className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                <Building2 className="size-6 text-cyan-300" />
                <h3 className="mt-4 text-sm font-bold">{capability.title}</h3>
                <p className="mt-2 text-xs leading-6 text-slate-400">{capability.description}</p>
              </article>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">الأنشطة والامتدادات</h2>
            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-200">مخططات جاهزة للتطوير — ليست وحدات مفعّلة</span>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {Object.values(DRVO_VERTICALS).map(vertical => {
              const Icon = icons[vertical.key];
              return (
                <article key={vertical.key} className="flex flex-col rounded-3xl border border-white/10 bg-[#101a2c] p-6">
                  <div className="flex items-center gap-3">
                    <div className="grid size-12 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300"><Icon className="size-6" /></div>
                    <div><p className="text-xs uppercase tracking-wider text-slate-500">{vertical.key}</p><h3 className="mt-1 text-xl font-black">{vertical.title}</h3></div>
                  </div>
                  <p className="mt-4 min-h-12 text-sm leading-7 text-slate-400">{vertical.description}</p>
                  <p className="mt-5 text-xs font-semibold text-slate-300">وحدات أساسية مقترحة</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {vertical.recommendedModules.map(module => <span key={module} className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-2.5 py-1.5 text-xs text-cyan-200">{module}</span>)}
                  </div>
                  <div className="mt-6 border-t border-white/10 pt-5">
                    <p className="mb-4 text-xs font-semibold text-slate-300">امتدادات النشاط</p>
                    <ul className="space-y-3">
                      {vertical.extensions.map(extension => (
                        <li key={extension.key} className="flex items-start gap-2 text-sm text-slate-300">
                          <Check className="mt-1 size-4 shrink-0 text-cyan-300" />
                          <span>{extension.title}<span className="mr-2 text-xs text-slate-500">({extension.core})</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm leading-7 text-amber-100">
          <LockKeyhole className="size-5 shrink-0" />
          <p>اختيار النشاط لا يمنح صلاحيات أو اشتراكات تلقائيًا. كل عملية تتطلب عضوية شركة فعالة، وصلاحية محددة، واشتراك الوحدة، وعزل البيانات بالفرع. الملفات الطبية تحتاج طبقة خصوصية وتدقيق منفصلة قبل تفعيلها.</p>
        </section>
        <Link href="/drvo/workspace/modules" className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950">
          <ShieldCheck className="size-4" /> استعرض اشتراكات الوحدات الفعلية
        </Link>
      </div>
    </main>
  );
}
