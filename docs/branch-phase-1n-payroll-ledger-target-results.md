# Phase 1N — Payroll / Ledger / Target Results

| Proof | Result |
|---|---|
| Hourly payroll + `hourly_wage` ledger BranchID=3 | PASS (dual-write enabled for process) |
| Monthly `monthly_salary` actual post dryRun=false | PASS amount 3000 |
| Target entitlement > 0 | PASS (30 on 300 net sales @10%) |
| Target ledger credit | PASS |
| Overpay payout reject | PASS |
| Cross-branch BranchID=1 inject | no GLEEM ledger for smoke notes |
| Valid payout BranchID=3 | PASS |

Hourly ledger zero in 1M was because runner called generate-only without dual-write.
