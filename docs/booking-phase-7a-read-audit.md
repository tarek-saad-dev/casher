# Booking Phase 7A — Read Route Audit

**Date:** 2026-07-27 · **DB:** last132

## Matrix

| Route/helper | Ownership | Code validation | Phone norm | Branch | WorkDate | Overnight | Status | Private-data risk | Test/smoke risk | Required migration |
|---|---|---|---|---|---|---|---|---|---|---|
| `GET …/booking/[code]` | **None** (code alone) | Uppercase trim only; **numeric BookingID fallback** | N/A | Loads branch after fetch; no visibility gate | Uses `BookingDate` only | None / Notes may leak `[p6]` | Raw DB status | Name, notes, times | No smoke filter | Canonical reader + ownership |
| `POST …/booking/upcoming` | Phone + **required branchCode** | N/A | Local `+20` only (≠ Phase 6) | Discovery rules applied | `BookingDate >= today` Cairo string | None | PascalCase `Cancelled`/`Completed` | **BookingID**, phone, name, barberId | No smoke filter | Canonical list + rate limit |
| Local cancel helpers | Mixed | ID or code | Divergent | Mixed | Legacy | — | Mixed casing | High | — | Phase 7B |

## Explicit findings

| Finding | Evidence | Severity |
|---|---|---|
| Lookup by BookingID | `[code]/route.ts` catch → `WHERE BookingID=@id` | Critical |
| Booking-code-only full details | GET returns name + notes with no phone/token | Critical |
| Raw / divergent phone comparison | upcoming local normalize vs `normalizePublicBookingPhone` | High |
| Legacy date reconstruction | BookingDate/StartTime only; ignores Absolute* / PublicWorkDate | High |
| Notes metadata exposure | GET returns `Notes` (may include `[p6]…`) | High |
| Internal/smoke leakage | No Source / name / notes smoke filter on READ | High |
| Branch visibility on existing bookings | Upcoming requires public-resolvable branch → hides owned bookings if discovery off | Medium |
| Cancelled/completed as upcoming | Filters PascalCase; DB uses lowercase → leak / wrong filter | Critical |
| No rate limit on upcoming | Enumeration by phone | High |
| Ad-hoc errors | English strings; not error catalog | Medium |

## Frontend compatibility (cutsaloon.com — out of scope to change)

Phase 7A keeps temporary **code-only minimal summary** (no phone, no notes, no customer name) when no ownership proof is supplied, so legacy confirmation pages do not fully break. Full details require phone or `bookingAccessToken`.
