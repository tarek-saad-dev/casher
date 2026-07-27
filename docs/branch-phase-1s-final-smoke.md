# Phase 1S-R — Final current-config smoke

## SUPERSEDED

Previous text claiming **NOT RUN** / blocked on employees is **SUPERSEDED**.  
SmokeRun **18** is **not** accepted as final (retained proofs from SmokeRun 13).

## Authoritative result

| Field | Value |
|-------|-------|
| SmokeRunID | **22** |
| Phase | `1S-R-final` |
| Status | CLEANED |
| CleanupStatus | COMPLETED |
| Artifacts | 26 |
| Script | `scripts/branch-smoke/run-phase1s-r-final-current-config-smoke.ts` |
| Result artifact | `scripts/branch-smoke/_phase1s-r-final-smoke-result.json` |

## Proofs executed on live INTERNAL_LIVE config

- Camp Caesar access / INTERNAL_LIVE preconditions
- Opening cash ZERO acknowledged
- Ziad roster preserved (EmpID=12)
- Attendance, queue start/finish
- Inventory adjustment + consumption
- Cash + card POS invoices; CashMoves BranchID=3
- Hourly payroll + ledger; monthly salary post
- Target positive entitlement (smoke emp) + Ziad NO_TARGET zero
- Advance payout; printer/WhatsApp identity
- Public booking disabled; GLEEM isolation; cleanup; `final.current_config`

## Explicitly rejected

- SmokeRun **18** retained-only proofs (`prior.smoke_run_11_retained`, `retainedFromSmokeRunId: 13`)

## Verdict

**Final current-config smoke: GO** (SmokeRun 22)
