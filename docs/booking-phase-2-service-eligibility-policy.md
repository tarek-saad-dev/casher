# Booking Phase 2 — Service eligibility policy

**Entry:** `isServiceEligibleForPublicBooking` / `evaluateServiceEligibility`  
**File:** `src/lib/booking/publicBookingServicePolicy.ts`

A row is publicly bookable only when all pass:

1. Not soft-deleted (`isDeleted` false/0/null)
2. Not `HideFromPublicBooking` (future flag; absent = allowed)
3. Not `[TEST]` / `[SMOKE…]` name markers (literal string match, not broken SQL `LIKE`)
4. Not retail product (`ProType` pro/product, `CatType` pro, or product category name patterns)
5. Not excluded internal category/service name patterns (إداريات، عائد خزنة، …)
6. Valid positive `DurationMinutes` ≤ 480 (no system fallback)
7. Valid `SPrice1` finite and **> 0** (zero not approved without explicit flag)

Filtering lives only in this policy module (and assembly that calls it) — not duplicated inside `route.ts`.

Restore admin action flips `isDeleted` only; public visibility still requires the full policy.
