import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Blocks, CalendarClock, CircleCheck, CircleOff, LockKeyhole, ShieldCheck, ShieldAlert } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { DRVO_MODULES, canUseDrvoModule, type DrvoModuleEntitlement } from '@/platform/modules/registry';
import { listTenantModuleEntitlements } from '@/platform/modules/tenantEntitlements';
import { loadTenantPermissionActor } from '@/platform/access/tenantGrants';
import { canDrvo, DRVO_PERMISSIONS } from '@/platform/access/permissions';

export const dynamic = 'force-dynamic';

function formatExpiry(value: string | null | undefined): string {
  if (!value) return 'بدون تاريخ انتهاء محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تاريخ انتهاء غير صالح';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function moduleState(tenantId: string, key: string, entry: DrvoModuleEntitlement | undefined) {
  if (!entry) return { label: 'غير مشترك', tone: 'text-slate-300 bg-slate-400/10 border-slate-400/20', reason: 'لا يوجد استحقاق مسجل لهذه الوحدة.' };
  if (entry.status === 'suspended') return { label: 'موقوف', tone: 'text-rose-300 bg-rose-400/10 border-rose-400/20', reason: 'الاستحقاق موقوف. لا يمكن تشغيل الوحدة.' };
  if (entry.status === 'disabled') return { label: 'غير مفعّل', tone: 'text-amber-300 bg-amber-400/10 border-amber-400/20', reason: 'الوحدة معطّلة على مستوى الاستحقاق.' };
  if (canUseDrvoModule(tenantId, key, entry)) return { label: 'مفعّل للشركة', tone: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20', reason: 'الاستحقاق صالح. تشغيل وظائف الوحدة يتطلب أيضًا فحص صلاحيات العمليات وعزل بيانات الشركة.' };
  return { label: 'منتهي الصلاحية', tone: 'text-rose-300 bg-rose-400/10 border-rose-400/20', reason: 'انتهت صلاحية الاستحقاق أو تاريخ الانتهاء غير صالح.' };
}

export default async function DrvoModulesPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  let tenantCode: string | null = null;
  let tenantId: string | null = null;
  let canManage = false;
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
        const actor = await loadTenantPermissionActor(context, { executor: db });
        if (canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.modulesRead)) {
          tenantCode = context.tenantCode;
          tenantId = context.tenantId;
          canManage = canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.modulesManage);
          try {
            entitlements = await listTenantModuleEntitlements(context, { executor: db });
          } catch {
            entitlements = null;
          }
        }
      }
    }
  } catch {
    tenantCode = null;
    tenantId = null;
    canManage = false;
    entitlements = null;
  }

  const modules = Object.values(DRVO_MODULES);
  const enabledCount = tenantId && entitlements
    ? modules.filter(module => canUseDrvoModule(tenantId, module.key, entitlements?.find(item => item.moduleKey === module.key))).length
    : 0;

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200"><ArrowRight className="size-4" /> العودة للوحة التحكم</Link>
        <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-cyan-400">DRVO ERP / MODULE MANAGEMENT</p>
            <h1 className="mt-3 text-3xl font-black">إدارة الوحدات والتطبيقات</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">استعرض الوحدات المشمولة في استحقاقات شركتك وحالتها وتاريخ انتهائها. تفعيل الاشتراكات يتم من نظام الفوترة أو إدارة المنصة، وليس من صلاحية مدير الشركة وحدها.</p>
          </div>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-bold text-cyan-300">STAGING · إدارة الاستحقاقات V1</span>
        </div>

        {!tenantCode || !tenantId ? (
          <section role="status" className="mt-8 rounded-2xl border border-amber-300/20 bg-[#101a2c] p-8">
            <LockKeyhole className="size-7 text-amber-300" />
            <h2 className="mt-4 text-lg font-bold">تعذر التحقق من صلاحية عرض الوحدات</h2>
            <p className="mt-2 text-sm text-slate-400">يجب التحقق من عضوية الشركة وصلاحية modules.read قبل عرض أي استحقاقات.</p>
          </section>
        ) : (
          <>
            <section aria-label="ملخص الوحدات" className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                <p className="text-sm text-slate-400">الشركة الحالية</p>
                <p className="mt-2 text-lg font-bold" dir="ltr">{tenantCode}</p>
                <p className="mt-2 flex items-center gap-2 text-xs text-emerald-300"><ShieldCheck className="size-4" /> عضوية وصلاحية موثّقتان</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                <p className="text-sm text-slate-400">الوحدات الفعّالة</p>
                <p className="mt-2 text-3xl font-bold">{entitlements === null ? '—' : enabledCount} <span className="text-sm font-normal text-slate-400">/ {modules.length}</span></p>
                <p className="mt-2 text-xs text-slate-500">بناءً على الاستحقاقات الحالية</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                <p className="text-sm text-slate-400">صلاحية إدارة الوحدات</p>
                <p className="mt-2 text-lg font-bold">{canManage ? 'متاحة للحساب' : 'عرض فقط'}</p>
                <p className="mt-2 text-xs text-slate-500">لا تسمح بمنح استحقاقات مدفوعة دون موافقة المنصة</p>
              </div>
            </section>

            {entitlements === null ? (
              <section role="alert" className="mt-6 flex gap-3 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-5 text-sm text-rose-200">
                <ShieldAlert className="size-5 shrink-0" />
                <p>تعذّر تحميل بيانات الاستحقاقات. تم إخفاء الحالات بدلًا من عرض بيانات قديمة أو السماح بالوصول.</p>
              </section>
            ) : (
              <section aria-label="الوحدات واستحقاقاتها" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {modules.map(module => {
                  const entitlement = entitlements.find(item => item.moduleKey === module.key);
                  const state = moduleState(tenantId, module.key, entitlement);
                  const enabled = canUseDrvoModule(tenantId, module.key, entitlement);
                  return (
                    <article key={module.key} className="flex flex-col rounded-2xl border border-white/10 bg-[#101a2c] p-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="grid size-12 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><Blocks className="size-6" /></div>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${state.tone}`}>{state.label}</span>
                      </div>
                      <p className="mt-5 text-xs uppercase tracking-widest text-slate-500" dir="ltr">{module.key}</p>
                      <h2 className="mt-2 text-lg font-bold">{module.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{module.description}</p>
                      <div className="mt-auto border-t border-white/10 pt-4">
                        <p className="flex items-center gap-2 text-xs text-slate-300">
                          <CalendarClock className="size-4 text-slate-500" />
                          {entitlement ? formatExpiry(entitlement.validUntilUtc) : 'لا يوجد اشتراك مسجّل'}
                        </p>
                        <p className="mt-3 flex items-start gap-2 text-xs leading-6 text-slate-400">
                          {enabled ? <CircleCheck className="mt-1 size-4 shrink-0 text-emerald-300" /> : <CircleOff className="mt-1 size-4 shrink-0 text-slate-500" />}
                          {state.reason}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
            <div className="mt-7 rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-5 text-sm leading-7 text-slate-300">
              <strong className="text-cyan-200">سياسة إدارة الوحدات:</strong> استحقاقات الوحدات لا تتغير من هذه الصفحة. التفعيل والتجديد والإيقاف المالي من مسؤولية طبقة الاشتراكات/إدارة المنصة. إدارة إعدادات كل وحدة ستكون متاحة فقط بعد تطبيق بوابة الصلاحيات والاستحقاق على الـBackend.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
