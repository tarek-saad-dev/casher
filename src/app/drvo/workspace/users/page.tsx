import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, LockKeyhole, ShieldCheck, UserRound, Users } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { getUserAccess } from '@/lib/permissions-server';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';

export const dynamic = 'force-dynamic';

type MemberRow = {
  MembershipId: string;
  LegacyUserId: number | null;
  UserName: string | null;
  loginName: string | null;
  UserLevel: string | null;
  IsDeleted: number | boolean | null;
};
type RoleRow = { UserID: number; RoleKey: string };

async function loadMembers(user: {
  UserID: number; UserName: string; UserLevel: string;
  ActiveBranchID: number; TenantId?: string; MembershipId?: string;
}) {
  if (!user.TenantId || !user.MembershipId) return null;
  const db = await getPool();
  const context = await resolveStaffTenantContextForRequest({
    userId: user.UserID,
    activeBranchId: user.ActiveBranchID,
    preferredTenantId: user.TenantId,
  }, { executor: db });
  if (context.membershipId.toLowerCase() !== user.MembershipId.toLowerCase()) return null;

  // Membership is not itself a permission to list other users.
  // Legacy administrators / super admins are the only readers until
  // tenant-scoped administrative roles are introduced.
  const access = await getUserAccess(user.UserID, user.UserName, user.UserLevel);
  if (user.UserLevel !== 'admin' && !access.isSuperAdmin) return { forbidden: true as const };

  const members = await db.request()
    .input('tenantId', sql.UniqueIdentifier, context.tenantId)
    .query<MemberRow>(`
      SELECT m.MembershipId, m.LegacyUserId,
             u.UserName, u.loginName, u.UserLevel, u.isDeleted AS IsDeleted
      FROM dbo.TenantMembership m
      INNER JOIN dbo.Tenant t ON t.TenantId = m.TenantId AND t.Status = N'active'
      LEFT JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId
      WHERE m.TenantId = @tenantId
      ORDER BY u.UserName, m.MembershipId
    `);

  // Roles are joined through the tenant's own memberships, not a global
  // unrestricted user list. Never return credentials or password hashes.
  const roles = await db.request()
    .input('tenantId', sql.UniqueIdentifier, context.tenantId)
    .query<RoleRow>(`
      SELECT DISTINCT m.LegacyUserId AS UserID, r.RoleKey
      FROM dbo.TenantMembership m
      INNER JOIN dbo.TblUserRoles ur ON ur.UserID = m.LegacyUserId
      INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.IsActive = 1
      WHERE m.TenantId = @tenantId
    `);
  const roleMap = new Map<number, string[]>();
  for (const role of roles.recordset) {
    const existing = roleMap.get(role.UserID) ?? [];
    existing.push(role.RoleKey);
    roleMap.set(role.UserID, existing);
  }
  return {
    forbidden: false as const,
    tenantCode: context.tenantCode,
    members: members.recordset.map(member => ({
      id: member.MembershipId,
      name: member.UserName?.trim() || 'عضوية بدون مستخدم مرتبط',
      login: member.loginName?.trim() || null,
      level: member.UserLevel,
      active: member.LegacyUserId != null && !Boolean(member.IsDeleted),
      roles: member.LegacyUserId != null ? (roleMap.get(member.LegacyUserId) ?? []) : [],
      self: member.LegacyUserId === user.UserID,
    })),
  };
}

export default async function DrvoUsersPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  let data: Awaited<ReturnType<typeof loadMembers>> = null;
  let unavailable = false;
  try {
    data = await loadMembers(user);
  } catch (error) {
    console.error('[drvo/users] Failed to load scoped memberships:', error instanceof Error ? error.name : 'unknown');
    unavailable = true;
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200"><ArrowRight className="size-4" /> العودة للوحة التحكم</Link>
        <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-cyan-400">DRVO ERP / ACCESS</p>
            <h1 className="mt-3 text-3xl font-black">المستخدمون والصلاحيات</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">عرض عضويات الشركة والأدوار المسجلة حاليًا. الإضافة والتعديل وتغيير الصلاحيات غير متاحة في المعاينة.</p>
          </div>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-bold text-amber-300">STAGING · قراءة فقط</span>
        </div>
        {unavailable || !data ? (
          <section role="status" className="mt-8 rounded-2xl border border-amber-300/20 bg-[#101a2c] p-8">
            <h2 className="text-lg font-bold">بيانات المستخدمين غير متاحة</h2>
            <p className="mt-2 text-sm text-slate-400">تعذر التحقق من عضوية الشركة أو تحميل بياناتها. لا يتم عرض بيانات بدون تحقق.</p>
          </section>
        ) : data.forbidden ? (
          <section role="status" className="mt-8 rounded-2xl border border-white/10 bg-[#101a2c] p-8">
            <LockKeyhole className="size-7 text-amber-300" />
            <h2 className="mt-4 text-lg font-bold">ليس لديك صلاحية عرض المستخدمين</h2>
            <p className="mt-2 text-sm text-slate-400">الصفحة متاحة للمسؤولين فقط خلال المرحلة الحالية.</p>
          </section>
        ) : (
          <>
            <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
              <div className="flex items-center gap-3"><Users className="size-6 text-cyan-300" /><div><p className="text-xs text-slate-400">الشركة</p><p className="mt-1 font-bold">{data.tenantCode}</p></div></div>
              <div className="text-sm text-slate-300">{data.members.length} عضوية</div>
            </section>
            {data.members.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-[#101a2c] p-8 text-sm text-slate-400">لا توجد عضويات مسجلة للشركة.</div>
            ) : (
              <section aria-label="أعضاء الشركة" className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.members.map(member => (
                  <article key={member.id} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="grid size-11 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><UserRound className="size-5" /></div>
                      <span className={`rounded-full px-3 py-1 text-[11px] ${member.active ? 'bg-emerald-300/10 text-emerald-300' : 'bg-slate-400/10 text-slate-400'}`}>{member.active ? 'حساب نشط' : 'حساب غير نشط أو غير مرتبط'}</span>
                    </div>
                    <h2 className="mt-5 break-words text-lg font-bold">{member.name}{member.self ? <span className="mr-2 text-xs font-normal text-cyan-300">(أنت)</span> : null}</h2>
                    <p className="mt-1 break-all text-xs text-slate-400">{member.login ? `اسم الدخول: ${member.login}` : 'لا يوجد اسم دخول مرتبط'}</p>
                    <div className="mt-5 border-t border-white/10 pt-4">
                      <p className="mb-2 text-xs text-slate-500">الأدوار الحالية</p>
                      <div className="flex flex-wrap gap-2">
                        {member.roles.length ? member.roles.map(role => <span key={role} className="rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-2.5 py-1.5 text-xs text-cyan-200">{role}</span>) : <span className="text-xs text-slate-500">لا توجد أدوار مسجلة</span>}
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
            <p className="mt-7 inline-flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="size-4 text-emerald-300" /> البيانات محددة بعضويات الشركة الحالية. الأدوار المعروضة هي أدوار النظام القديم وليست صلاحيات SaaS جديدة.</p>
          </>
        )}
      </div>
    </main>
  );
}
