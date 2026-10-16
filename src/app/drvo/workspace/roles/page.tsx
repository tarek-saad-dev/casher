import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Check, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { DRVO_PERMISSIONS, DRVO_ROLE_TEMPLATES } from '@/platform/access/permissions';
import { requireTenantPermission } from '@/platform/access/tenantGrants';

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
      if (context.membershipId.toLowerCase() === user.MembershipId.toLowerCase()) {
        await requireTenantPermission(context, DRVO_PERMISSIONS.rolesRead, { executor: db });
        verified = true;
      }
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
            <section aria-labelledby="permission-matrix-title" className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-[#101a2c]">
              <div className="border-b border-white/10 p-5 sm:p-6">
                <h2 id="permission-matrix-title" className="text-xl font-bold">مقارنة الصلاحيات بين الأدوار</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">دي مقارنة للقوالب المقترحة فقط، مش الصلاحيات الفعلية لأي مستخدم. اسحب الجدول أفقيًا على الموبايل.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-right text-sm">
                  <thead className="bg-white/[0.04]">
                    <tr>
                      <th scope="col" className="sticky right-0 z-10 min-w-44 border-b border-l border-white/10 bg-[#172235] px-4 py-4 font-semibold">الصلاحية</th>
                      {Object.entries(DRVO_ROLE_TEMPLATES).map(([key, role]) => (
                        <th key={key} scope="col" className="min-w-28 border-b border-white/10 px-3 py-4 text-center font-semibold">
                          <span className="block">{role.label}</span>
                          <span className="mt-1 block text-[11px] font-normal text-slate-500" dir="ltr">{key}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(DRVO_PERMISSIONS).map((permission, index) => (
                      <tr key={permission} className={index % 2 === 0 ? 'bg-white/[0.015]' : ''}>
                        <th scope="row" className="sticky right-0 z-10 border-b border-l border-white/5 bg-[#101a2c] px-4 py-3 font-medium text-slate-200">
                          <span className="block">{permissionLabels[permission]}</span>
                          <span className="mt-0.5 block text-[11px] text-slate-500" dir="ltr">{permission}</span>
                        </th>
                        {Object.entries(DRVO_ROLE_TEMPLATES).map(([key, role]) => {
                          const allowed = (role.permissions as readonly string[]).includes(permission);
                          return (
                            <td key={key} className="border-b border-white/5 px-3 py-3 text-center">
                              <span className="inline-flex items-center justify-center" aria-label={allowed ? 'مسموح في القالب' : 'غير مسموح في القالب'} title={allowed ? 'مسموح في القالب' : 'غير مسموح في القالب'}>
                                {allowed ? <Check aria-hidden="true" className="mx-auto size-5 text-emerald-300" /> : <X aria-hidden="true" className="mx-auto size-4 text-slate-600" />}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <h2 className="mt-10 text-lg font-bold">تفاصيل القوالب</h2>
            <section aria-label="قوالب الأدوار" className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
