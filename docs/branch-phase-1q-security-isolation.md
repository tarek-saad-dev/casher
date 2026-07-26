# Phase 1Q — Security / Isolation

**Date:** 2026-07-26  
**Visibility:** `src/lib/branch/publicBranchVisibility.ts`

---

## Public discoverability

Branch appears in public booking / public schedule union only if:

```text
LifecycleStatus = PUBLIC_LIVE
AND IsActive = 1
AND PublicBookingEnabled = 1
AND QueueBookingSettings.BookingEnabled = 1
```

| Branch | Public schedule / barbers |
|---|---|
| GLEEM | Visible when gates true |
| CAMP_CAESAR | **Hidden** (SETUP; no activation) |
| PH1GTEST | **Hidden** |

---

## Isolation invariants

- Backfill writes GLEEM only; CC / PH1GTEST real schedule counts stay **0**  
- Legacy fallback only when `branchCode === 'GLEEM'`  
- Public calendar/location/slots use `publicOnly` / `canBranchAppearInPublicBooking`  
- Admin schedule UI may see non-public branches; public APIs must not  
- Body BranchID spoof on attendance/session paths still rejected (1K/1B)  
- No Camp Caesar INTERNAL_LIVE / PUBLIC_LIVE in this phase  

---

## Error surface (no cross-branch leak)

Wrong-branch create/slots → `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` (does not book into hidden/SETUP branches).
