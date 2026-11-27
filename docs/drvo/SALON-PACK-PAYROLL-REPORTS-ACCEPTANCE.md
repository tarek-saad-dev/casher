# Salon Pack — Payroll & Reports acceptance slice

Baseline: main@85ba112dc002e9666fc61eb8545049f892af35e7. Agent 2. **Not final Salon Pack E2E approval.**

## Existing implementation and ownership

- `src/apps/payroll/public/index.ts` and `src/apps/reports/public/index.ts` are **skeletons**. Actual payroll lives in `src/lib/payroll`, HR/ledger in `src/lib/hr` and `src/lib/services/employeeLedgerService.ts`. Do not pretend these are independent extracted apps yet.
- Existing `scripts/drvo/drvo-016-hr-payroll-smoke.ts` already creates two independent tenants and runs real **employee → attendance → daily payroll → payout**. It verifies each tenant's employee-ledger summary excludes the other tenant, cleans both, and checks the legacy CASHER_BOOT employee count remains unchanged.
- This PR puts that real-SQL test behind the dedicated, branch-gated GitHub Staging environment. No production writes or automatic merge.

## What success proves

| Acceptance | Proof |
|---|---|
| Employee and attendance isolation | Two independent Salon tenants' employee/branch scope |
| Payroll generation | Daily payroll for one employee of each synthetic tenant |
| Payout | Employee ledger payout recorded using real HR services |
| Tenant-scoped payroll reporting | Ledger summary includes own employee, excludes foreign employee |
| Cleanup / CUT protection | Both synthetic tenants purged and CASHER_BOOT employee count unchanged |

## Still NOT proven by this smoke

1. **Invoice → commission integration.** The smoke pays a daily wage, not commission earned by a sale. A synthetic sale + employee target/commission + ledger proof is required before calling POS→Payroll complete.
2. **Financial reporting projection.** Employee-ledger summary is not salon revenue, treasury reconciliation, partner P&L or management dashboards. Must separately compare sold invoice amount, Treasury posting, daily report total, and target/commission ledger.
3. **Modularity and UI.** Payroll and Reports code is still behind legacy implementation, not independently installable runtime isolation end-to-end; full-pack and minimal-pack proofs are separate.
4. **Temporal and branch guards.** Need cross-date, 2-branch payroll aggregation and retroactive adjustment reversals with immutable audit.
5. **Full acceptance.** Do not label Stage D done until Booking→Queue→POS payment→Treasury→Payroll→Reports one-tenant integrated scenario runs green.

## Merge guidance

Draft until CI and staging are green, then Ready for Review. Human owner must review; main can deploy to production automatically. No merge or deploy by agent.

## Target recalculation staging gate (2026-10-26)

The current invoice-snapshot scenario only queues a recalculation request, **not a persisted POS sale**. It then processes the request but does not seed `TblEmpTargetPlan` / `TblEmpTargetTier` for its smoke employees. A `completed` request can therefore represent a no-op calculation (zero eligible plans) instead of earned commission.

The staging script now **fails closed** unless it finds a non-voided `TblEmpDailyTarget` row with positive net service sales and a positive target amount. This is deliberately a blocking acceptance test until synthetic target-plan + sale fixtures are implemented. Do **not** report that staging passed merely because `RequestedVersion === ProcessedVersion`. Even once these assertions pass, prove the target-linked ledger entry amount and POS/Treasury/daily revenue reconciliation, without touching production.

Next stage: provision per-tenant target plans/tiers; create genuine tenant-owned invoice headers/details using production posting paths; process requests; assert target amount, ledger balance delta, and both tenants' isolated financial reports against independently computed expected values; ensure all financial fixture rows and queued requests are purged after the run.
