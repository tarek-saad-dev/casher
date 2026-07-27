# Phase 1S — Opening cash

## Decision model

Persisted on `TblBranchSetupPolicy`:

- `OpeningCashDecision` = `ZERO` | `AMOUNT`
- `OpeningCashAmount`, `OpeningCashEffectiveDate`, `OpeningCashReason`
- `OpeningCashApprovedAt`, `OpeningCashApprovedByUserID`

## Clearance

`biz.opening_cash` passes only when `isOpeningCashResolved(branchId)` is true (explicit approval).

## Option A — ZERO

Requires UI checkbox confirmation. No CashMove / no fake sales income.

## Option B — AMOUNT

Requires amount > 0, effective date, reason. Policy audited; no invented GLEEM balance copy.

## API / UI

- `GET/POST /api/admin/branches/[id]/setup/opening-cash`
- `/admin/branches/[id]/setup/opening-cash`
