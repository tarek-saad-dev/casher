# Booking Phase 3 — Verification

**Date:** 2026-07-27 · **DB:** last132

## Tests executed

| Suite | Result |
|-------|--------|
| Phase 3 barber catalog/calendar/security/branch/global | **PASS** |
| Phase 2 services suites | **PASS** |
| Phase 1 branch context + 1F + 1M + 1Q | **PASS** |
| Combined Phase 1–3 sample | **86 PASS** (+20 Phase 2 extras) |

## Build / ESLint

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| ESLint Phase 3 touched files | **PASS** |

## Live probe

| Probe | Result |
|-------|--------|
| Global barbers | 5 unique EmpIDs, 0 dupes, 0 test leak, branches=`GLEEM`, cold~5.2s / warm~0.5s |
| Branch GLEEM | 5 barbers |
| Branch CAMP_CAESAR | `BRANCH_NOT_PUBLIC` |
| Ziad calendar 2026-08-01..07 | `presence_only` + overnight `endDayOffset=1`; Fri `global_leave` |
| Ziad location working | GLEEM 13:00→01:00 |
| Ziad location off | `branch: null` |
| Test EmpID direct | `BARBER_NOT_FOUND` |

## Cache

TTL 20s, max 32. Key includes mode/branch/date/serviceIds/contract version. `invalidatePublicBookingBarbersCache()`.
