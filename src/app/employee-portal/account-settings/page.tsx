import { redirect } from 'next/navigation';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
export const dynamic = 'force-dynamic';
export default async function AccountSettingsPage() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) redirect('/employee-portal');
  if (identity.mustChangePassword) redirect('/employee-portal/change-password');
  return <main dir="rtl" className="min-h-screen bg-zinc-950 text-white p-8"><h1 className="text-xl font-bold">إعدادات الحساب</h1><a href="/employee-portal/change-password">تغيير كلمة المرور</a></main>;
}
