import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import UsernameForm from './username-form';
export const dynamic = 'force-dynamic';
export default async function AccountSettingsPage() {
 const identity = await getEmployeePortalIdentity();
 if(!identity) redirect('/employee-portal');
 if(identity.mustChangePassword) redirect('/employee-portal/change-password');
 const db=await getPool();
 const result=await db.request().input('id',identity.accountId).input('tenantId',identity.tenantId).input('empId',identity.empId)
  .query('SELECT LoginName FROM dbo.TblEmployeePortalAccount WHERE ID=@id AND TenantId=@tenantId AND EmpID=@empId AND IsEnabled=1');
 const loginName=result.recordset[0]?.LoginName as string|undefined;
 if(!loginName)redirect('/employee-portal');
 return <main dir="rtl" className="min-h-screen bg-zinc-950 text-white p-5 md:p-10">
  <div className="max-w-lg mx-auto space-y-5">
   <a href="/employee-portal" className="text-amber-400 text-sm">← الرجوع لحسابي</a>
   <h1 className="text-2xl font-bold">إعدادات الحساب</h1>
   <UsernameForm currentUsername={loginName}/>
   <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
    <h2 className="text-lg font-bold">كلمة المرور</h2>
    <p className="text-sm text-zinc-400">تقدر تغيّر كلمة المرور في أي وقت، بعد التأكد من كلمة المرور الحالية.</p>
    <a href="/employee-portal/change-password" className="inline-block px-5 py-3 rounded-lg bg-zinc-800 text-white">تغيير كلمة المرور</a>
   </section>
  </div>
 </main>;
}
