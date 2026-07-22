# Phase 1B Verification

**Scripts:**

* `scripts/run-multi-branch-foundation-migration.ts`
* `scripts/verify-multi-branch-foundation.ts`
* `scripts/audit-branches/06-capture-legacy-state.cjs`

## Runner gates

* Mode must be `cloud` for the default target
* Connected database must be `last132` unless `--expected-database=` override is provided
* Open shifts are **not** a refusal — warning only
* Secrets / passwords / connection strings are never printed

## Verifier pass criteria

* GLEEM exists exactly once
* Every current user has exactly one valid default mapping
* Every active employee has an active GLEEM home assignment
* Deleted users received no new active mapping
* Inactive employees received no active assignment
* No invalid FKs
* No operational/financial `BranchID` columns added
* Legacy `TblNewDay` / `TblShiftMove` / invoice / cash / attendance / booking / queue fingerprints unchanged vs pre-migration capture

## Open shifts

Reported as:

```text
Legacy warning — unchanged, outside Phase 1B ownership scope
```

Not a verification failure.

## Observed after migration (cloud / last132)

| Check | Result |
|---|---|
| Branch count | 1 (GLEEM) |
| Users with valid GLEEM mapping | 9 / 9 |
| Active employees with GLEEM home | 13 / 13 |
| Operational BranchID columns | 0 |
| Open shifts | 3 (unchanged warning) |
| Open NewDay | 1 (unchanged) |
| Invoice / cash / attendance / booking / queue counts | Identical to pre-capture |
| Idempotent second run | Passed |
