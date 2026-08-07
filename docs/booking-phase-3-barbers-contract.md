# Booking Phase 3 — Barbers contract

**Module:** `src/lib/booking/publicBookingBarbers.ts`  
**Policy:** `src/lib/booking/publicBookingBarberPolicy.ts`

## Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/public/booking/barbers` | `mode=global` (default) or `mode=branch&branchCode=` |
| GET | `/api/public/booking/barbers/{empId}/calendar` | `from`,`to` required; max 31 days |
| GET | `/api/public/booking/barbers/{empId}/location` | `date` required |

`availabilityType` / day `status` for working public days: **`presence_only`** (exact slots = Phase 4).

Compat fields retained: `id`, `name`, `photoUrl`, `bio`, `isBookableOnline`, calendar `isPresent`/`isBookable`.

## Ordering

List responses are sorted by `displaySortOrder` ascending (lower first), then Arabic name, then `empId`.  
Admin control: **الموارد البشرية → الموظفين → ترتيب الظهور في موقع الحجز** (`TblEmp.DisplaySortOrder`). Default `999`.
