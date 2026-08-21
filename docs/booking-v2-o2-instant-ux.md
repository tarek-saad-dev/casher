# Booking V2 — Phase O2 Instant Booking UX (Hawai `/operations`)

## Goal

Open and complete booking inside `/operations` **without a blocking waterfall**,
on top of the O1 data layer. No reimplementation of availability rules. No
`available-slots` per step.

---

## Instant open

| Event | Behavior |
|---|---|
| Click «إضافة حجز» | Modal mounts immediately (`setShowBookingDrawer(true)`) |
| Prefetch | `void openBookingV2Flow(...)` — fire-and-forget |
| Bootstrap | Used if already cached from `/operations` entry; modal does not wait |
| Availability | Skeleton **only** inside appointment step |
| Services | Skeleton on services step if bootstrap still loading |

UX marks: `add_click` → `modal_visible` (target perceived &lt;100ms).

---

## Local selection (zero network)

| Change | Network |
|---|---|
| Employee (matrix already for that emp) | Prefetch only if new scope miss |
| Service / duration | Local `generateStartsFromFree` |
| Date inside 14-day window | Local filter + generate |
| Branch when days cached (Zeyad GLEEM↔CAMP) | Local filter |
| Back to previous step | Local |

Removed from modal happy path:

- `GET /api/services` per open (bootstrap covers catalog)
- `GET /api/services/resolve-durations` (bootstrap duration)
- `GET /api/public/booking/available-slots` on service/date change

Legacy route files remain; modal simply does not call them.

---

## Slot presentation

- `generateStartsFromFree` via O1 store
- Nearest slot highlighted separately
- Remaining slots grouped (overnight buckets labeled)
- Branch chip on each start
- Overnight stays under the same **BusinessDate**

### States (never conflated)

| State | Copy |
|---|---|
| Loading | جاري تحميل المواعيد + skeleton |
| Empty | لا توجد مواعيد متاحة |
| Error | تعذر تحميل المواعيد + Retry |
| Soft refresh fail | Banner over **cached** starts (not empty) |

Stale revision refresh: soft revalidate — modal selection/services/customer kept.
If the selected start disappears → clear that slot only + warning.

---

## Network log — journey (expected)

Assumes `/operations` already warm-bootstrapped.

```
# page already loaded
GET /api/public/booking/v2/bootstrap          (earlier; 200 or 304)

# click Add Booking → modal visible (no await)
POST /api/public/booking/v2/availability
  body: {
    employeeId: 12,                          # Zeyad
    branchCodes: ["GLEEM", "CAMP_CAESAR"],  # one shot
    fromBusinessDate, toBusinessDate         # 14 days
  }

# choose Zeyad (if not pre-selected) → same matrix scope → NO new request
# change service → NO request (local starts)
# change date → NO request (local day filter)
# switch branch GLEEM → CAMP_CAESAR → NO request (cached days)
# confirm
POST /api/public/booking/create              # legacy write only
```

**Requests that must NOT appear in this journey:**

- `/api/public/booking/available-slots`
- `/api/services/resolve-durations`
- `/api/services?bookable=true` (unless bootstrap previously failed)

---

## Acceptance

| Gate | Status |
|---|---|
| OPERATIONS INSTANT BOOKING UX VERIFIED | Yes |
| MODAL OPENS IMMEDIATELY | Yes |
| NO STEP-BY-STEP AVAILABILITY WATERFALL | Yes |
| SERVICE CHANGE ZERO NETWORK | Yes |
| DATE CHANGE ZERO NETWORK | Yes |
| CACHED BRANCH CHANGE ZERO NETWORK | Yes |
| MULTI-BRANCH BARBER INSTANT | Yes |
| LOADING ERROR EMPTY STATES SEPARATED | Yes |
| BUSINESSDATE OVERNIGHT VERIFIED | Yes |
| LEGACY WRITE PRESERVED | Yes |
| REDUNDANT READ CALLS REMOVED | Yes |

```bash
npx vitest run src/lib/__tests__/bookingV2OpsInstantUx.test.ts
```

Related: [O1 data layer](./booking-v2-o1-ops-data-layer.md)
