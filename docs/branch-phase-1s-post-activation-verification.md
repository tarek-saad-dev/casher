# Phase 1S-R — Post-activation verification

## SUPERSEDED

Previous **N/A — branch still SETUP** is **SUPERSEDED**. Branch is **INTERNAL_LIVE**.

## Live proofs (cloud / last132)

| Check | Result |
|-------|--------|
| LifecycleStatus | INTERNAL_LIVE |
| IsActive | 1 |
| PublicBookingEnabled | 0 |
| ExternalNotificationsEnabled | **1** |
| QBS.BookingEnabled | 0 |
| listActiveBranches includes CAMP_CAESAR | **yes** (with GLEEM) |
| listPublicActiveBranches includes CAMP_CAESAR | **no** (GLEEM only) |
| Production nightly | uses `listActiveBranches` → **includes** CC |
| Authorized switcher | active + CanOperate users see CC |
| Unauthorized | no operate access → not switchable |
| /operations BranchID=3 | open for INTERNAL_LIVE active |
| Friday staff | Ziad EmpID=12 |
| Non-Friday | no working schedule rows → no staff that day |
| Public CAMP_CAESAR booking | rejected |
| GLEEM | remains PUBLIC_LIVE |

## Verdict

Post-activation flags: **GO** for isolation/public exclusion.  
Operational staffing coverage: **NO-GO** (see weekly coverage blocker).
