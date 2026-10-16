import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CreditCard, ShieldAlert, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/session';
import { DRVO_MODULES } from '@/platform/modules/registry';
import { listPlatformSubscriptions } from '@/platform/modules/platformSubscriptions';
import { loadPlatformPrincipal } from '@/platform/modules/platformAuthorityRepository';
import { canManageCommercialEntitlements } from '@/platform/modules/platformAuthority';
import PlatformSubscriptionSearch from './PlatformSubscriptionSearch';

export const dynamic = 'force-dynamic';

export default async function DrvoPlatformSubscriptionsPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  let rows: Awaited<ReturnType<typeof listPlatformSubscriptions>> = [];
  let error: 'denied' | 'unavailable' | null = null;
  let canManage = false;
  try {
    rows = await listPlatformSubscriptions(user.UserID);
    const principal = await loadPlatformPrincipal(user.UserID);
    canManage = canManageCommercialEntitlements(principal, user.UserID);
  } catch (cause) {
    error = cause instanceof Error && cause.message === 'PLATFORM_ENTITLEMENT_READ_DENIED'
      ? 'denied' : 'unavailable';
  }
  const groups = Object.values(rows.reduce<Record<string, { id: string; code: string; name: string; status: string; modules: typeof rows }>>((acc, row) => {
    const group = acc[row.tenantId] ??= {
      id: row.tenantId, code: row.tenantCode, name: row.tenantName,
      status: row.tenantStatus, modules: [],
    };
    if (row.moduleKey) group.modules.push(row);
    return acc;
  }, {}));
  const activeCount = rows.filter(row => row.status === 'enabled' &&
    (!row.validUntilUtc || Date.parse(row.validUntilUtc) > Date.now())).length;

  return (
    <main dir="rtl" className="h-full min-h-0 w-full overflow-y-auto overscroll-contain bg-[#080e1a] px-5 py-8 pb-16 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200">
          <ArrowRight className="size-4" /> العودة للوحة التحكم
        </Link>
        <header className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-cyan-400">DRVO ERP / PLATFORM CONTROL PLANE</p>
            <h1 className="mt-3 text-3xl font-black">اشتراكات الشركات</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
              متابعة استحقاقات الوحدات لكل شركة. العرض متاح فقط لمسؤول المنصة الحاصل على صلاحية
              platform.entitlements.read المستقلة عن صلاحيات الشركات.
            </p>
          </div>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-bold text-amber-300">STAGING · {canManage ? 'إدارة الاشتراكات' : 'قراءة فقط'}</span>
        </header>

        {error ? (
          <section role="alert" className="mt-8 rounded-2xl border border-rose-300/20 bg-[#101a2c] p-7">
            <ShieldAlert className="size-6 text-rose-300" />
            <h2 className="mt-3 text-lg font-bold">{error === 'denied' ? 'لا تملك صلاحية إدارة اشتراكات المنصة' : 'تعذر التحقق من بيانات الاشتراكات'}</h2>
            <p className="mt-2 text-sm text-slate-400">لن تُعرض أي بيانات اشتراكات بدون تحقق ناجح من صلاحيات المنصة وقاعدة Staging.</p>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                ['الشركات', String(groups.length)],
                ['الاستحقاقات النشطة', String(activeCount)],
                ['إجمالي الاستحقاقات المسجلة', String(rows.filter(row => row.moduleKey).length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-3 text-3xl font-bold">{value}</p>
                </div>
              ))}
            </section>
            <PlatformSubscriptionSearch
              canManage={canManage}
              companies={groups.map(group => ({
                id: group.id, code: group.code, name: group.name, status: group.status,
                modules: Object.values(DRVO_MODULES).map(module => {
                  const entry = group.modules.find(item => item.moduleKey === module.key);
                  return { key: module.key, title: module.title, status: entry?.status ?? null, validUntilUtc: entry?.validUntilUtc ?? null };
                }),
              }))}
            />
            <footer className="mt-8 flex items-center gap-2 border-t border-white/10 pt-5 text-xs text-slate-400">
              <ShieldCheck className="size-4 text-emerald-300" /> قراءة مباشرة من قاعدة Staging مع صلاحية Platform Admin مستقلة.
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
