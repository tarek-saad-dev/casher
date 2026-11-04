import EmployeePortalShell from '@/components/employee-portal/EmployeePortalShell';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getEmployeeLedgerEntries } from '@/lib/services/employeeLedgerService';
import EmployeePortalLogin from './portal-login';
import EmployeeDailyChart from './EmployeeDailyChart';
import DailyEfficiency from './DailyEfficiency';
import { getPortalAttendance } from '@/lib/employee-portal/attendance';
import EnablePushNotifications from '@/components/employee-portal/EnablePushNotifications';

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
  const bonuses = sum(['target', 'commission', 'bonus'], 'credit');
  const revenueTips = sum(['tip', 'employee_funding'], 'credit');
  const advances = sum(['advance'], 'debit');
  const deductions = sum(['deduction', 'settlement', 'adjustment'], 'debit');
  const payouts = sum(['payout'], 'debit');
  return (
    <EmployeePortalShell>
        <header className="relative overflow-hidden rounded-[24px] border border-amber-500/20 bg-gradient-to-bl from-[#282018] via-[#171719] to-[#0d0d11] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.25)] md:p-7">
          <div aria-hidden="true" className="pointer-events-none absolute -left-14 -top-20 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl"/>
          <div className="relative flex flex-wrap items-end justify-between gap-3">
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
        <EnablePushNotifications />
        <section aria-label="ملخص مستحقات الشهر" className="space-y-3">
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {[
              ['مستحقات الراتب', salary],
              ['العمولات والمكافآت', bonuses],
              ['الإيراد والـTips', revenueTips],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex min-w-0 flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-2.5 py-3.5 md:p-5">
                <p className="min-h-9 text-[11px] leading-4 text-zinc-400 md:min-h-0 md:text-sm">{label}</p>
                <p className="mt-2 break-words text-base font-bold leading-snug tabular-nums text-white md:text-xl" dir="rtl">{money(Number(value))}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:gap-3">
            {[
              ['السلف', advances],
              ['الخصومات والتسويات', deductions],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:p-5">
                <p className="text-xs text-zinc-400">{label}</p>
                <p className="mt-2 text-xl font-bold tabular-nums">{money(Number(value))}</p>
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
        <EmployeeDailyChart entries={ledger.entries} month={month} attendance={attendance} />
        <DailyEfficiency month={month} today={new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} entries={ledger.entries} attendance={attendance} />
    </EmployeePortalShell>
  );
}
