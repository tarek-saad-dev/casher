# Payroll Agreements V2 — staged rollout / financial QA

**Do not merge the implementation PR or enable posting on production solely because CI passes.**

## Scope of this first rollout
- Existing employee switching from hourly/daily to **VIP monthly per branch**.
- Backdating **within the current Cairo business month**, any calendar day in that month.
- Calendar-day proration: monthly branch commitment × remaining days (inclusive) ÷ days in month.
- Existing employee switching to future VIP via effective-dated plans (no early method change).
- Outside current month, already posted monthly salary, settled/cash-posted daily wages, overlapping agreements, and mixed historical branch ownership are refused for manual review.
- Generic return from VIP to hourly/daily and retroactive changes across closed accounting periods are **not implemented** in V2 first stage.

## Production prerequisites
1. Make an off-host COPY_ONLY SQL backup. Run RESTORE VERIFYONLY **using SQL Server admin**, plus a staging restore drill. Store backup path/checksum, release SHA and test evidence.
2. Keep PAYROLL_RETROACTIVE_ENABLED **unset or false** in production until all tests pass.
3. Apply db/migrations/add-payroll-agreement-v2-retroactive.sql in staging database last132_agent using sqlcmd -b -I. The migration is idempotent and intentionally restricted to last132_agent/last132.
4. On staging, run:
   npx vitest run src/lib/payroll/__tests__/payrollAgreementMath.test.ts
   npm run build
5. Validate with a non-production employee across GLEEM/CAMP CAESAR:
   - Day 1 backdated agreement replaces existing Generated daily wage credits with a full monthly salary credit per enabled branch.
   - Day 15 in a 31-day month credits 17/31 monthly salary.
   - A repeated same requestKey returns the same revision without new rows or credits.
   - The old TblEmpDailyPayroll rows and attendance are preserved with SupersededByPayrollRevisionID.
   - Only matching old hourly_wage ledger credits become IsVoided=1, with reason and revision.
   - No TblCashMove, advance, deduction or payout entry is deleted/modified.
   - Running payroll generation and ledger sync for affected dates does NOT reintroduce old wages.
   - The monthly posting flow finds existing monthly credit and leaves it unchanged.
   - The employee monthly report and ledger reconciliation show no double counting.
   - Non-Generated/post-cash daily wages, prior posted monthly salary, inactive assignments and older closed periods must block approval.
   - Existing hourly staff scheduled for a future VIP switch remain hourly today and become monthly by effective branch plans later.
6. Before any production application, capture count and sum of active hourly_wage/monthly_salary/payout/advance/deduction rows per EmpID+BranchID+PayrollMonth. Save immutable before and after snapshots and compare with preview.

## Apply safely on VPS (operator only, after staging)
- Execute migration only with a verified backup, explicit target DB last132 and sqlcmd -b -I. Never run as part of normal app deploy.
- Once schema and integration smoke are clean, explicitly set PAYROLL_RETROACTIVE_ENABLED=true on the application service and restart it according to the deployment runbook.
- A failed apply transaction must roll back agreement, supersession markers, ledger voids, monthly credits and audit; the original cash balance remains untouched.
- Capture the RevisionID and reconcile payroll ledger amounts before enabling the feature for general use.

## Invariants
- Never DELETE attendance, historical daily payroll, TblCashMove, payout or advance rows.
- Transactionality per employee, idempotency via RequestKey, tenant-scoped authorization, independent branch balances.
- Existing ledger cash entries are immutable. Cash changes require independent accounting corrections/approvals.
