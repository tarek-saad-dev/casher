# Booking Phase 1 — Public branch context

## Module

`src/lib/booking/publicBookingBranchContext.ts`

```ts
resolvePublicBookingBranchContext({ branchCode, purpose, auth?, previewQueryParam? })
```

### Purposes

| Purpose | Who | Auth |
|---------|-----|------|
| `public_discovery` | Public list semantics | none |
| `public_booking` | Config/status (and future branch-scoped APIs) | none |
| `internal_preview` | Admin/ops only | `auth.userId` + `canManageSettings` or `canOperate` |

`preview=true` query param **never** grants `internal_preview`.

### Normalization

- trim + uppercase
- reject empty → `BRANCH_REQUIRED`
- reject numeric-only (BranchID spoof) → `INVALID_BRANCH_CODE`
- reject malformed → `INVALID_BRANCH_CODE`
- no silent alias mapping

### Public visibility (appear / bookable discovery)

All must pass (`canBranchAppearInPublicBooking`):

1. `LifecycleStatus = PUBLIC_LIVE`
2. `IsActive = 1`
3. `PublicBookingEnabled = 1`
4. `QueueBookingSettings.BookingEnabled = 1`

**GLEEM:** public = true (current DB)  
**CAMP_CAESAR:** public = false  
**Smoke/SETUP:** public = false

### Branch-scoped vs global

**Branch-scoped (require `branchCode`, no GLEEM fallback):**  
config, status, services, available-days, available-slots, check-slot, plan, create

**Global-capable (may omit `branchCode` only in explicit global mode):**  
barbers?mode=global, barber global calendar

Absence of `branchCode` **never** means GLEEM.

### Integrated this task

- `GET /api/public/branches`
- `GET /api/public/booking/config`
- `GET /api/public/booking/status`

### Cache

Keys: `purpose::branchCode::version` where version includes lifecycle, flags, QBS, contact/hours.  
TTL 30s, max 64 entries. Invalidate via `invalidatePublicBookingBranchContextCache(branchCode?)`.  
GLEEM entries cannot be reused for CAMP_CAESAR (different code in key).
