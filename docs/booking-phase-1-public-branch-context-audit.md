# Booking Phase 1 — Public branch context audit

**Scope:** Casher backend only. cutsaloon.com unchanged.  
**Date:** 2026-07-27

## Current state (authoritative)

| Branch | Lifecycle | PublicBookingEnabled | QBS.BookingEnabled | Public? |
|--------|-----------|----------------------|--------------------|---------|
| GLEEM | PUBLIC_LIVE | 1 | 1 | yes |
| CAMP_CAESAR | INTERNAL_LIVE | 0 | 0 | **no** |

## Pre-Phase-1 findings

| Issue | Detail |
|-------|--------|
| Dual visibility helpers | `isPubliclyDiscoverable` (3 flags) vs `canBranchAppearInPublicBooking` (+ QBS) used inconsistently |
| `listPublicActiveBranches` | Previously used only 3 flags — could list a PUBLIC_LIVE branch with QBS off |
| `resolvePublicBranchCode` | Missing `branchCode` → single-public-branch fallback (effectively GLEEM today) |
| Error shapes | Flat `{ error, message }` mixed with codes; not nested Phase 1 contract |
| Camp Caesar | Correctly not discoverable via lifecycle, but rejection codes/messages varied |
| Cache | Settings cache by branchId only; no purpose/versioned branch-context cache |

## Route matrix (before → after Phase 1)

| Route | branchCode accepted? | Required? | Prior fallback | Visibility | Leak risk | Phase 1 migration |
|-------|---------------------|-----------|----------------|------------|-----------|-------------------|
| GET `/api/public/branches` | n/a | n/a | list active+discoverable | 3 flags → **4 flags** | Low | **Done** — `listPublicDiscoverableBranches` |
| GET `/api/public/booking/config` | yes | **yes** | single-public fallback | discoverable then QBS pause | Medium (fallback) | **Done** — central resolver, no fallback |
| GET `/api/public/booking/status` | yes | **yes** | single-public fallback | same | Medium | **Done** |
| GET `.../services` | yes | **yes** | single-public fallback | old resolver | Medium | **Done (Phase 2)** — central resolver + public bookable policy |
| GET `.../barbers` | optional | no if global | global list / branch resolve | barber filters | Medium | **Done (Phase 3)** |
| GET `.../barbers/{id}/calendar` | optional | no | global schedule | publicOnly + privacy | Medium | **Done (Phase 3)** |
| GET `.../barbers/{id}/location` | n/a | date | global schedule | hide non-public | Medium | **Done (Phase 3)** |
| GET `.../available-days` | yes | **yes** | fallback | old | Medium | **Done (Phase 4)** |
| GET `.../available-slots` | yes | **yes** | fallback | old | Medium | **Done (Phase 4)** |
| GET `.../barbers/{id}/available-slots` | yes | **yes** | engine | public | Medium | **Done (Phase 4)** |
| GET `.../barbers/{id}/calendar` | optional | no | global + slots when serviceIds | privacy | Medium | **Done (Phase 4 enrich)** |
| POST `.../check-slot` | yes | **yes** | none | central + evaluator | Low | **Done (Phase 5)** |
| POST `.../plan` | yes | **yes** | none | central + evaluator (read-only) | Low | **Done (Phase 5)** |
| POST `.../create` | yes | **yes** | none | Phase-6 transactional create | Low | **Done (Phase 6)** |
| POST `.../upcoming` | phone | n/a | booking BranchID | OK | Low | **Pending Phase 7** |
| POST `.../cancel` | n/a | n/a | booking BranchID | OK | Low | later |

## Shared helpers inspected

- `publicBranchVisibility.canBranchAppearInPublicBooking`
- `lifecycle.isPubliclyDiscoverable`
- `bookingQueueOwnership.resolvePublicBranchCode` / `extractPublicBranchCode` (legacy; still used by unmigrated routes)
- `publicBookingHelpers` CORS + settings cache
- Proxy: public `/api/public/*` remains unauthenticated (unchanged this task)
