import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Blocks, LockKeyhole, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { DRVO_MODULES, canUseDrvoModule } from '@/platform/modules/registry';
import { listTenantModuleEntitlements } from '@/platform/modules/tenantEntitlements';
import { requireTenantPermission } from '@/platform/access/tenantGrants';
import { DRVO_PERMISSIONS } from '@/platform/access/permissions';

export const dynamic = 'force-dynamic';

export default async function DrvoModulesPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  let tenantCode: string | null = null;
  let entitlements: Awaited<ReturnType<typeof listTenantModuleEntitlements>> | null = null;
  try {
    if (user.TenantId && user.MembershipId) {
      const db = await getPool();
      const context = await resolveStaffTenantContextForRequest({
        userId: user.UserID,
        activeBranchId: user.ActiveBranchID,
        preferredTenantId: user.TenantId,
      }, { executor: db });
      if (context.membershipId.toLowerCase() === user.MembershipId.toLowerCase()) {
        await requireTenantPermission(context, DRVO_PERMISSIONS.modulesRead, { executor: db });
        tenantCode = context.tenantCode;
        try {
          entitlements = await listTenantModuleEntitlements(context, { executor: db });
        } catch {
          entitlements = null;
        }
      }
    }
  } catch {
    tenantCode = null;
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200"><ArrowRight className="size-4" /> العودة للوحة التحكم</Link>
        <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-cyan-400">DRVO ERP / MODULE REGISTRY</p>
            <h1 className="mt-3 text-3xl font-black">الوحدات والتطبيقات</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">كتالوج الوحدات المتاحة في منصة DRVO. ظهور الوحدة هنا لا يعني إنها مفعلة لشركتك، والتفعيل الفعلي محتاج اشتراك وصلاحيات موثّقة.</p>
          </div>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-bold text-amber-300">STAGING · كتالوج فقط</span>
        </div>
        {!tenantCode ? (
          <section role="status" className="mt-8 rounded-2xl border border-amber-300/20 bg-[#101a2c] p-8">
            <LockKeyhole className="size-7 text-amber-300" />
            <h2 className="mt-4 text-lg font-bold">تعذر التحقق من عضوية الشركة</h2>
            <p className="mt-2 text-sm text-slate-400">لن يتم عرض كتالوج مساحة العمل قبل التحقق من عضويتك.</p>
          </section>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#101a2c] p-5 text-sm text-slate-300">
              <ShieldCheck className="size-5 text-emerald-300" />
              <span>الشركة الحالية: <strong className="text-white">{tenantCode}</strong></span>
              <span className="mr-auto text-xs text-amber-300">{entitlements === null ? 'بيانات التفعيل غير متاحة' : 'تم تحميل بيانات التفعيل'}</span>
            </div>
            <section aria-label="كتالوج الوحدات" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.values(DRVO_MODULES).map(module => (
                <article key={module.key} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="grid size-12 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><Blocks className="size-6" /></div>
                    <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-3 py-1 text-[11px] text-amber-300">{entitlements === null ? 'الحالة غير معروفة' : canUseDrvoModule(user.TenantId ?? '', module.key, entitlements.find(item => item.moduleKey === module.key)) ? 'مفعّل للشركة' : 'غير مفعّل'}</span>
                  </div>
                  <p className="mt-5 text-xs uppercase tracking-widest text-slate-500">{module.key}</p>
                  <h2 className="mt-2 text-lg font-bold">{module.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{module.description}</p>
                </article>
              ))}
            </section>
            <p className="mt-7 text-xs leading-6 text-slate-500">لا توجد أزرار تفعيل في هذه المرحلة. يتم عرض حالة تفعيل الوحدات للقراءة فقط؛ لا يتم تغيير الاشتراكات أو المدفوعات من هذه الصفحة.</p>
          </>
        )}
      </div>
    </main>
  );
}
