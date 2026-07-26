# Phase 1O — Focused Smoke Results

**Status:** PASSED → CLEANED

| Item | Value |
|---|---|
| SmokeRunID | **13** |
| Purpose | Phase 1O Camp Caesar focused real-configuration smoke |
| Database | cloud / `last132` |
| Runner | `scripts/branch-smoke/run-phase1o-focused-smoke.ts` |
| Artifact | `scripts/branch-smoke/_phase1o-focused-smoke-result.json` |

## Configuration proofs

| Proof | Result |
|---|---|
| Overnight hours 11:00 / 01:30 / dayOffset | PASS |
| Service parity (global catalog) | mismatches=0 |
| Prepared user access | PASS |
| SETUP hidden from switcher | PASS |
| Payment methods (global catalog) | PASS (9) |
| Receipt identity فرع كامب شيزار + 01012126899 | PASS · prints=0 |
| WhatsApp template render (5 templates) | PASS · sends=0 |
| GLEEM isolation | PASS |

## Retained technical proofs (SmokeRunID 11)

Merged into SmokeRunID 13 `ResultJson.proofs` so INTERNAL_LIVE technical keys were **not** invalidated:

`inventory.adjustment`, `inventory.consumption`, `pos.cashInvoice`, `pos.cardInvoice`, `payroll.hourlyLedgerCredit`, `payroll.monthlySalaryPost`, `target.positiveEntitlement`, `target.ledgerCredit`, `advance.payout`, `gleem.isolation`, `cleanup.completed`

## Cleanup

- Smoke emp/assignment/payroll/target/schedule/service soft-cleaned
- Real CC setup config preserved (identity, hours, SalonName, user access, partner draft, policies)
- Lifecycle restored: SETUP · IsActive=0 · PublicBooking=0 · ExternalNotifications=0 · BookingEnabled=0

## GO / NO-GO

| Gate | Verdict |
|---|---|
| Config foundation | **GO** |
| INTERNAL_LIVE | **NO-GO** (opening cash/inventory, real employees, partner EffectiveFrom) |
| PUBLIC_LIVE | **NO-GO** |
