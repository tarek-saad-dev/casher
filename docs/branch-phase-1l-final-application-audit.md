# Phase 1L — Final Application Audit (Runtime Source)

**Date:** 2026-07-25  
**Database:** cloud / `last132`  
**Authority:** current source + tests + verifier (not prior closure prose alone)

---

## Locked model

```text
Employee identity = global (TblEmp)
Writable account = EmpID + BranchID
Global total = read-only SUM of authorized branch balances
```

---

## Write-path matrix (current runtime)

| Operation | Caller | Source BranchID | Target table | Uniqueness | Transaction | Idempotency | Gap (pre-fix) | Final fix |
|---|---|---|---|---|---|---|---|---|
| Manual daily payroll generate | `api/payroll/daily/generate` | Session (`requireBranchOperationAccess`) | `TblEmpDailyPayroll` | Emp+Branch+WorkDate | generate core | upsert by key | Body BranchID / missing branch | Session only; reject body BranchID |
| Auto-generate | `api/payroll/daily/auto-generate` | `listActiveBranches()` | payroll + hourly ledger | Emp+Branch+WorkDate | per branch | skip if posted | Global generate | Iterate active branches |
| Nightly payroll | `nightly-close.service` | active branches | payroll + ledger | Emp+Branch+WorkDate | per branch | countPosted skip | Same | Per-branch generate + ledger sync |
| Nightly targets | same | active branches | `TblEmpDailyTarget` + target ledger | Emp+Branch+WorkDate | per branch | upsert | Same | `generateEmployeeDailyTargets({branchId})` |
| Nightly monthly salary | same | active branches (month-end) | `TblEmpLedgerEntry` | Emp+Branch+PayrollMonth | post service | alreadyPosted | **Missing** | `postMonthlySalaryEntitlements` when last calendar day |
| Operational wage rate | `dailyPayrollGenerateCore` | generation branch | payroll Notes/rate | plan Emp+Branch+EffectiveFrom | generate SQL | plan CROSS APPLY | **TblEmp rates** | `TblEmpBranchPayrollPlan` only; fail `no_branch_payroll_plan` |
| Monthly salary post | `employeeLedgerMonthlySalaryService` | required `branchId` | ledger credit | Emp+Branch+month | TX | alreadyPosted | BaseSalary path | Branch plan `PayType=monthly` |
| Advance ledger | dual-write / sync | CashMove.BranchID | ledger debit | Ref CashMove | with cash | void+rewrite | — | CashMove BranchID |
| Payout | `employeeLedgerPayoutService` | session + CashMove | ledger debit | Ref CashMove | TX | — | Global balance limit | `getEmployeeBranchBalance` |
| Tip / funding | tip + funding services | sale/CashMove | ledger | Ref | TX | — | — | Stamp BranchID |
| Target generate | target generation service | required branchId | daily target | Emp+Branch+WorkDate | service | upsert | — | Invoice `h.BranchID` |
| Target recalc enqueue | sales mutate paths | invoice header BranchID | recalc request | Emp+Branch+WorkDate | enqueue | request version | — | Scope includes BranchID |
| Target plan admin CRUD | target-settings API | session branch | `TblEmpTargetPlan` | Emp+Branch+EffectiveFrom | TX | versioning | **INSERT omitted BranchID** | Session branchId on list/save/insert |
| Reconciliation read | reconciliation API | session branch | n/a | n/a | read | n/a | **Unscoped** | Filter payroll/ledger/cash by BranchID |
| Payroll expense report | `payrollExpenseFromLedger` | optional branchId | n/a | n/a | read | n/a | **Unscoped** | `AND l.BranchID = @branchId` |
| Employee WhatsApp | daily WA report | persisted branch rows | n/a | one msg/emp/day | send | skip empty | **No branchEarnings** | Load + compose branch sections |

---

## Gaps closed in this pass

1. Operational rates → `TblEmpBranchPayrollPlan` (no TblEmp / GLEEM fallback).  
2. Nightly month-end monthly salary per active branch.  
3. Reconciliation + payroll expense BranchID scope.  
4. Employee WhatsApp `branchEarnings` wiring.  
5. `resolveLedgerEntryBranchSource` contract map.  
6. Target plan admin BranchID stamp/filter.  
7. Validate-attendance session branch.  
8. Verifier + Phase 1L tests updated for the above.

---

## Non-goals preserved

- No second-branch activation  
- PH1GTEST inactive  
- Sync stopped  
- Attendance (1K) / inventory (1J) ownership unchanged  
- No writable global ledger account  
- No cross-branch payout / settlement  
- No GLEEM plan fallback for other branches  

---

## Related docs

See `docs/branch-phase-1l-closure.md` and `docs/branch-phase-1l-verification.md` for GO/NO-GO and command results after they are run in this workspace.
