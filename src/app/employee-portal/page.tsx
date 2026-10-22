import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getEmployeeLedgerEntries } from '@/lib/services/employeeLedgerService';
import EmployeePortalLogin from './portal-login';
import EmployeeDailyChart from './EmployeeDailyChart';
import DailyEfficiency from './DailyEfficiency';

export const dynamic = 'force-dynamic';
const money = (value: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value) + ' ج.م';

export default async function EmployeePortalPage({
  searchParams,
}: { searchParams: Promise<{ month?: string }> }) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) return <EmployeePortalLogin />;
  if (identity.mustChangePassword) redirect('/employee-portal/change-password');

  const params = await searchParams;
  const requested = params.month;
  const cairoMonthParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const current = `${cairoMonthParts.find(p => p.type === 'year')?.value}-${cairoMonthParts.find(p => p.type === 'month')?.value}`;
  const month = requested && /^20\d\d-(0[1-9]|1[0-2])$/.test(requested) ? requested : current;
  const db = await getPool();
  const employee = await db.request().input('empId', identity.empId).input('tenantId', identity.tenantId).query(`
    SELECT EmpName, Job FROM dbo.TblEmp
    WHERE EmpID = @empId AND TenantId = @tenantId AND isActive = 1
  `);
  const profile = employee.recordset[0] as { EmpName: string; Job: string | null } | undefined;
  if (!profile) redirect('/employee-portal');
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
          <div className="flex gap-2"><a href="/employee-portal/account-settings" className="rounded-xl border border-zinc-700 px-4 py-2 text-sm">إعدادات الحساب</a><form action="/employee-portal/logout" method="post"><button className="rounded-xl border border-zinc-700 px-4 py-2 text-sm">تسجيل خروج</button></form></div>
        </header>
        <form className="flex items-center gap-3" action="/employee-portal">
          <label htmlFor="month" className="text-sm text-zinc-300">الشهر</label>
          <input id="month" name="month" type="month" defaultValue={month} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-white" />
          <button className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-zinc-950">عرض</button>
        </form>
        <section aria-label="ملخص مستحقات الشهر" className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['مستحقات الراتب', salary],
              ['العمولات والمكافآت', bonuses],
              ['السلف', advances],
              ['الخصومات والتسويات', deductions],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:p-5">
                <p className="text-xs text-zinc-400">{label}</p>
                <p className="mt-3 text-xl font-bold">{money(Number(value))}</p>
              </div>
            ))}
          </div>
          <div className="rounded-3xl border border-amber-500/40 bg-gradient-to-bl from-amber-500/15 via-zinc-900 to-zinc-900 p-6 md:p-9">
            <p className="text-sm font-semibold text-amber-300">الرصيد الحالي للشهر</p>
            <p className="mt-3 text-4xl font-extrabold tracking-tight text-white md:text-5xl" dir="auto">{money(ledger.balance)}</p>
            <p className="mt-3 text-sm text-zinc-400">المتبقي من مستحقاتك بعد السلف والخصومات والمبالغ المصروفة خلال الشهر</p>
          </div>
          {month < current && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div>
              <p className="text-sm text-zinc-400">المبالغ المصروفة</p>
              <p className="mt-2 text-2xl font-bold">{money(payouts)}</p>
            </div>
            {payouts > 0 && Math.abs(ledger.balance) < 0.005 ? (
              <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300">
                خالص ✓
              </div>
            ) : payouts > 0 ? (
              <div className="text-sm text-zinc-400">صرف جزئي — لم تتم التسوية بالكامل</div>
            ) : (
              <div className="text-sm text-zinc-500">لم يتم تسجيل صرف لهذا الشهر</div>
            )}
          </div>
          )}
        </section>
        <EmployeeDailyChart entries={ledger.entries} month={month} />
        <DailyEfficiency month={month} today={new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} entries={ledger.entries} />
      </div>
    </main>
  );
}
