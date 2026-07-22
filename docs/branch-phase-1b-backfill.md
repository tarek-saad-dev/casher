# Phase 1B Backfill

**Date:** 2026-07-22  
**Target:** `last132` founding branch `GLEEM`

## Operator decisions (final)

* Database mode: cloud
* Database name: `last132`
* All existing historical operational and financial records belong to GLEEM

## User backfill

Active rule: `ISNULL(TblUser.isDeleted, 0) = 0`

Authoritative admin: legacy `UserLevel = admin` **or** active `admin` / `super_admin` role.

| Role class | IsDefault | CanOperate | CanViewReports | CanSwitch |
|---|---|---|---|---|
| Admin | true | true | true | true |
| Non-admin | true | true | false | false |

Rules:

* Do not map deleted users
* Do not modify `TblUser`
* Do not overwrite existing mappings on rerun
* `ValidFrom` = migration execution timestamp

## Employee backfill

Active rule: `ISNULL(TblEmp.isActive, 1) = 1`

Each active employee without a GLEEM assignment receives:

* `IsHomeBranch = true`
* `CanReceiveBookings = true`
* `IsActive = true`
* `EffectiveFrom` = migration execution date

This does **not** reconstruct historical employee locations.

## Live result (first execution)

| Metric | Value |
|---|---:|
| GLEEM rows | 1 |
| Current users mapped | 9 |
| Deleted users newly mapped | 0 |
| Active employees assigned | 13 |
| Inactive employees newly assigned | 0 |

Counts are live-derived, not hardcoded in the verifier.
