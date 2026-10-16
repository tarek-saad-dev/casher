import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { DRVO_PERMISSIONS, DRVO_ROLE_TEMPLATES } from '@/platform/access/permissions';

export const dynamic = 'force-dynamic';

const permissionLabels: Record<string, string> = {
  [DRVO_PERMISSIONS.organizationRead]: 'عرض الشركة',
  [DRVO_PERMISSIONS.organizationManage]: 'إدارة الشركة',
  [DRVO_PERMISSIONS.locationsRead]: 'عرض الفروع',
  [DRVO_PERMISSIONS.locationsManage]: 'إدارة الفروع',
  [DRVO_PERMISSIONS.membersRead]: 'عرض المستخدمين',
  [DRVO_PERMISSIONS.membersInvite]: 'دعوة المستخدمين',
  [DRVO_PERMISSIONS.membersManage]: 'إدارة المستخدمين',
  [DRVO_PERMISSIONS.rolesRead]: 'عرض الصلاحيات',
  [DRVO_PERMISSIONS.rolesManage]: 'إدارة الصلاحيات',
  [DRVO_PERMISSIONS.modulesRead]: 'عرض الوحدات',
  [DRVO_PERMISSIONS.modulesManage]: 'إدارة الوحدات',
  [DRVO_PERMISSIONS.billingRead]: 'عرض الفواتير',
  [DRVO_PERMISSIONS.billingManage]: 'إدارة الفواتير',
  [DRVO_PERMISSIONS.auditRead]: 'عرض سجل المراجعة',
};

export default async function DrvoRolesPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  let verified = false;
  try {
    if (user.TenantId && user.MembershipId) {
      const db = await getPool();
      const context = await resolveStaffTenantContextForRequest({
        userId: user.UserID,
        activeBranchId: user.ActiveBranchID,
        preferredTenantId: user.TenantId,
      }, { executor: db });
      verified = context.membershipId.toLowerCase() === user.MembershipId.toLowerCase();
    }
  } catch {
    verified = false;
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/drvo/workspace/users" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200"><ArrowRight className="size-4" /> المستخدمون والصلاحيات</Link>
        <div className="mt-8">
          <p className="text-xs font-semibold tracking-widest text-cyan-400">DRVO ERP / ACCESS CONTROL</p>
          <h1 className="mt-3 text-3xl font-black">نظام الأدوار والصلاحيات</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">دي قوالب الأدوار المقترحة لنظام DRVO المستقل عن Casher. لا يتم منح أي صلاحية من القوالب تلقائيًا، ولا يمكن تعديل الأدوار أو تعيينها حاليًا.</p>
        </div>
        {!verified ? (
          <section role="status" className="mt-8 rounded-2xl border border-amber-300/20 bg-[#101a2c] p-8">
            <LockKeyhole className="size-7 text-amber-300" />
            <h2 className="mt-4 text-lg font-bold">تعذر التحقق من عضوية الشركة</h2>
            <p className="mt-2 text-sm text-slate-400">لن يتم عرض تفاصيل إعداد الصلاحيات قبل التحقق من عضويتك الحالية.</p>
          </section>
        ) : (
          <>
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-5 text-sm text-cyan-100">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan-300" />
              <p className="leading-7">قوالب تعريفية فقط — نظام التفويض الجديد يبدأ بالرفض الافتراضي، ويتطلب عضوية نشطة ومنح صلاحيات فعلية مرتبطة بنفس الشركة.</p>
            </div>
            <section aria-label="قوالب الأدوار" className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(DRVO_ROLE_TEMPLATES).map(([key, role]) => (
                <article key={key} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6">
                  <p className="text-xs uppercase tracking-widest text-cyan-400">{key}</p>
                  <h2 className="mt-2 text-xl font-bold">{role.label}</h2>
                  <p className="mt-2 text-xs text-slate-500">{role.permissions.length} صلاحية مقترحة</p>
                  <ul className="mt-5 space-y-2 border-t border-white/10 pt-4">
                    {role.permissions.map(permission => <li key={permission} className="text-sm text-slate-300">{permissionLabels[permission]}</li>)}
                  </ul>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
