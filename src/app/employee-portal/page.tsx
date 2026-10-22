import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getEmployeeLedgerEntries } from '@/lib/services/employeeLedgerService';
import EmployeePortalLogin from './portal-login';
import EmployeeDailyChart from './EmployeeDailyChart';
import DailyEfficiency from './DailyEfficiency';
import { getPortalAttendance } from '@/lib/employee-portal/attendance';

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
  const [ledger, attendance] = await Promise.all([
    getEmployeeLedgerEntries({ tenantId: identity.tenantId, empId: identity.empId, month }),
    getPortalAttendance(identity.tenantId, identity.empId, month).catch(error => {
      console.error('[employee-portal] attendance unavailable', error instanceof Error ? error.message : 'unknown');
      return [];
    }),
  ]);
  const sum = (reasons: string[], direction: string) => ledger.entries
    .filter(e => reasons.includes(e.entryReason) && e.entryDirection === direction)
    .reduce((total, e) => total + e.amount, 0);
  const salary = sum(['hourly_wage', 'monthly_salary'], 'credit');
  const bonuses = sum(['target', 'commission', 'bonus', 'tip'], 'credit');
  const advances = sum(['advance'], 'debit');
  const deductions = sum(['deduction', 'settlement', 'adjustment'], 'debit');
  const payouts = sum(['payout'], 'debit');
  return (
    <main dir="rtl" className="h-full overflow-y-auto bg-zinc-950 text-white px-4 pb-8 pt-4 md:px-10 md:pt-7">
      <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
        <header className="relative overflow-hidden rounded-[28px] border border-amber-500/20 bg-gradient-to-bl from-[#282018] via-[#171719] to-[#0d0d11] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.25)] md:p-7">
          <div aria-hidden="true" className="pointer-events-none absolute -left-14 -top-20 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl"/>
          <nav aria-label="التنقل في حساب الموظف" className="relative flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <a href="/employee-portal" className="flex min-w-0 items-center gap-2" aria-label="الصفحة الرئيسية لبوابة الموظفين">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-sm font-black text-amber-300">C</span>
              <span className="min-w-0"><span className="block text-xs font-black tracking-wider text-amber-300" dir="ltr">CUT SALON</span><span className="block text-[11px] text-zinc-400">بوابة الموظفين</span></span>
            </a>
            <div className="flex items-center gap-1.5">
              <a href="/employee-portal/account-settings" className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400" aria-label="إعدادات الحساب">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2 2-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-2.82v-.08a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2-2 .06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 6.09 14H6v-2.82h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06 2-2 .06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V5h2.82v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2 2-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21V14h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
                <span className="hidden min-[370px]:inline">الإعدادات</span>
              </a>
              <form action="/employee-portal/logout" method="post"><button type="submit" className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-rose-400/40 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-amber-400" aria-label="تسجيل الخروج">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>
                <span className="hidden min-[370px]:inline">خروج</span>
              </button></form>
            </div>
          </nav>
          <div className="relative mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-amber-300/90">حسابك الشخصي</p>
              <h1 className="mt-1 text-2xl font-extrabold leading-tight text-white md:text-3xl">أهلاً، {profile.EmpName} <span aria-hidden="true" className="text-amber-400">✦</span></h1>
              <p className="mt-1 text-xs text-zinc-400">{profile.Job || 'موظف'} · تابع مستحقاتك بكل وضوح</p>
            </div>
            <form className="flex w-full items-center gap-2 sm:w-auto" action="/employee-portal">
              <label htmlFor="month" className="sr-only">الشهر</label>
              <input id="month" name="month" type="month" defaultValue={month} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-zinc-950/70 px-3 py-2.5 text-sm text-white focus-visible:outline-2 focus-visible:outline-amber-400 sm:flex-none"/>
              <button className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-extrabold text-zinc-950 transition-colors hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-white">عرض</button>
            </form>
          </div>
        </header>
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
        <DailyEfficiency month={month} today={new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} entries={ledger.entries} attendance={attendance} />
      </div>
    </main>
  );
}
