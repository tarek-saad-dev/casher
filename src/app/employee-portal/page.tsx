import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getEmployeeLedgerEntries } from '@/lib/services/employeeLedgerService';
import { EMP_LEDGER_REASON_LABELS } from '@/lib/types/employee-ledger';
import EmployeePortalLogin from './portal-login';

export const dynamic = 'force-dynamic';
const money = (value: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value) + ' ج.م';

export default async function EmployeePortalPage({
  searchParams,
}: { searchParams: Promise<{ month?: string }> }) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) return <EmployeePortalLogin />;
  if (identity.mustChangePassword) redirect('/employee-portal/change-password');

  const requested = (await searchParams).month;
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const month = requested && /^20\d\d-(0[1-9]|1[0-2])$/.test(requested) ? requested : current;
  const db = await getPool();
  const employee = await db.request().input('empId', identity.empId).input('tenantId', identity.tenantId).query(`
    SELECT EmpName, Job FROM dbo.TblEmp
    WHERE EmpID = @empId AND TenantId = @tenantId AND isActive = 1
  `);
  const profile = employee.recordset[0] as { EmpName: string; Job: string | null } | undefined;
  if (!profile) redirect('/employee-portal/logout');
  const ledger = await getEmployeeLedgerEntries({ tenantId: identity.tenantId, empId: identity.empId, month });
  const sum = (reasons: string[], direction: string) => ledger.entries
    .filter(e => reasons.includes(e.entryReason) && e.entryDirection === direction)
    .reduce((total, e) => total + e.amount, 0);
  const salary = sum(['hourly_wage', 'monthly_salary'], 'credit');
  const bonuses = sum(['target', 'commission', 'bonus', 'tip'], 'credit');
  const advances = sum(['advance'], 'debit');
  const deductions = sum(['deduction', 'settlement', 'adjustment'], 'debit');
  const payouts = sum(['payout'], 'debit');
  return (
    <main dir="rtl" className="h-full overflow-y-auto bg-zinc-950 text-white px-4 py-8 md:px-10">
      <div className="mx-auto max-w-5xl space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><div className="text-amber-400 text-sm font-bold">CUT SALON · بوابة الموظفين</div>
            <h1 className="text-2xl md:text-3xl font-bold mt-2">أهلاً، {profile.EmpName}</h1>
            <p className="text-zinc-400 mt-1">{profile.Job || 'موظف'} · تفاصيل مستحقاتك الشخصية</p>
          </div>
          <form action="/employee-portal/logout" method="post"><button className="rounded-xl border border-zinc-700 px-4 py-2 text-sm">تسجيل خروج</button></form>
        </header>
        <form className="flex items-center gap-3" action="/employee-portal">
          <label htmlFor="month" className="text-sm text-zinc-300">الشهر</label>
          <input id="month" name="month" type="month" defaultValue={month} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-white" />
          <button className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-zinc-950">عرض</button>
        </form>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            ['مستحقات الراتب', salary],
            ['العمولات والمكافآت', bonuses],
            ['السلف', advances],
            ['الخصومات والتسويات', deductions],
            ['المبالغ المصروفة', payouts],
            ['الرصيد الحالي للشهر', ledger.balance],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <p className="text-xs text-zinc-400">{label}</p><p className="mt-3 text-xl font-bold">{money(Number(value))}</p>
            </div>
          ))}
        </section>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-lg font-bold mb-1">تفاصيل الحركات</h2>
          <p className="text-sm text-zinc-400 mb-5">البيانات المعتمدة في دفتر الموظفين، شاملة حركات جميع الفروع التابعة لنفس المنشأة</p>
          <div className="space-y-2">
            {ledger.entries.length === 0 ? <p className="text-zinc-400 py-8 text-center">لا توجد حركات مسجلة لهذا الشهر</p> :
              ledger.entries.map(row => (
                <div key={row.id} className="flex justify-between gap-4 border-b border-zinc-800 py-3">
                  <div><div className="font-semibold">{EMP_LEDGER_REASON_LABELS[row.entryReason] || row.entryReason}</div>
                    <div className="text-xs text-zinc-400">{row.entryDate} · {row.branchName || 'بدون فرع'}{row.notes ? ' · ' + row.notes : ''}</div></div>
                  <strong className={row.entryDirection === 'credit' ? 'text-emerald-400' : 'text-rose-400'}>
                    {row.entryDirection === 'credit' ? '+' : '−'}{money(row.amount)}
                  </strong>
                </div>
              ))}
          </div>
        </section>
      </div>
    </main>
  );
}
