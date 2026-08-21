# Booking V2 — Phase B9 Frontend Read APIs

## Goal

Thin, cache-friendly read contracts for **Hawai `/operations`** and
**cutsaloon.com** on top of Booking V2 — **without** changing v7 legacy routes
or write authority (create / hold / cancel / reschedule).

| Surface | Route | Live availability? |
|---|---|---|
| Bootstrap catalog | `GET /api/public/booking/v2/bootstrap` | **No** |
| Availability matrix | `POST /api/public/booking/v2/availability` | Yes (FreeMask only) |

Contract id: `booking-v2-frontend-read-v1`

Shared pure util (Node / bundled browser):

```ts
import { generateStartsFromFree } from '@/lib/booking/v2Frontend';
// FreeMask/FreeRanges + duration + slotInterval = Available Start Times
```

---

## Exact contracts

### 1) Hawai `/operations`

**Bootstrap (once per session / on ETag change)**

```http
GET /api/public/booking/v2/bootstrap
If-None-Match: W/"<revision>"
```

Use:

- `branches`, `employees`, `employeeBranchMappings`
- `servicesByBranch[branchCode]`, `settingsByBranch[branchCode]`
- `capability`, `revision`

**Matrix — specific barber (Zeyad multi-branch)**

```http
POST /api/public/booking/v2/availability
Content-Type: application/json

{
  "employeeId": 12,
  "branchCodes": ["GLEEM", "CAMP_CAESAR"],
  "fromBusinessDate": "2026-08-17",
  "toBusinessDate": "2026-08-30"
}
```

Client filters locally:

- all Zeyad days → all `days`
- Zeyad @ GLEEM → `days.filter(d => d.branchCode === 'GLEEM')`
- Zeyad @ CAMP_CAESAR → `days.filter(d => d.branchCode === 'CAMP_CAESAR')`

**Matrix — branch roster / any-barber**

```json
{
  "branchCode": "GLEEM",
  "fromBusinessDate": "2026-08-17",
  "toBusinessDate": "2026-08-30"
}
```

Omitting `employeeId(s)` loads **public bookable roster for those branches only**
(global EmpID occupancy still applied server-side). Does **not** force
company-wide employee load.

**Local starts (after user picks service)**

```ts
const { starts } = generateStartsFromFree({
  freeRanges: day.freeRanges, // or freeMaskB64
  durationMinutes: selectedService.durationMinutes,
  slotIntervalMinutes: settings.slotIntervalMinutes,
  businessDate: day.businessDate,
  nowMs: Date.now(),
  minNoticeMinutes: settings.minNoticeMinutes,
});
```

`dayOffset` on starts is **derived** from the 48h timeline; **BusinessDate** is
authoritative. Do not invent BusinessDate from dayOffset.

Refresh a single day when `availabilityRevision` for that Emp×Branch×Date
changes. Revision is **not** booking authority.

---

### 2) cutsaloon.com

Same endpoints. Typical flow:

1. `GET .../v2/bootstrap` → CDN / browser cache (`ETag`, `Cache-Control: public, max-age=30, stale-while-revalidate=120`)
2. User picks branch (+ optional barber) + date range ≤ `maxBookingDaysAhead`
3. `POST .../v2/availability` with scoped employees/branches
4. Client generates starts from FreeMask + chosen service duration
5. Existing v7 **create / hold / cancel** write routes unchanged

Optional convenience (does **not** create a service-specific availability cache):

```json
{
  "employeeId": 12,
  "branchCode": "GLEEM",
  "fromBusinessDate": "2026-08-17",
  "toBusinessDate": "2026-08-30",
  "serviceIds": [101]
}
```

Response may echo `durationMinutes` for client convenience; FreeMask is still
duration-agnostic.

---

## Response shapes (public-safe)

### Bootstrap

```ts
{
  ok: true,
  contract: 'booking-v2-frontend-read-v1',
  capability: { /* matrix + local slot gen + overnight hours */ },
  revision: string,
  generatedAt: string,
  timezone: string,
  branches: [{ branchId, branchCode, branchName, shortName, address, phone, timeZone }],
  employees: [{ employeeId, nameAr, nameEn, name, imageUrl, photoUrl, shortBio, displaySortOrder, serviceIds, branchCodes }],
  employeeBranchMappings: [{ employeeId, branchId, branchCode }],
  servicesByBranch: { [branchCode]: [{ serviceId, names, price, durationMinutes, media, category*, bookable: true }] },
  settingsByBranch: { [branchCode]: { minNoticeMinutes, maxBookingDaysAhead, slotIntervalMinutes, allowSpecificBarber, allowNearestBarber, defaultMode, timezone, currency, bookingEnabled } },
  media: [{ kind: 'service'|'barber', id, imageUrl }]
}
```

**Forbidden:** salary/payroll, private notes, admin-only branch config.

### Matrix day cell

```ts
{
  employeeId, branchId, branchCode, businessDate,
  availabilityRevision,
  freeRanges: [{ startMin, endMin }], // 48h timeline minutes
  freeMaskB64,                       // 72-byte bitmap
  timezone,
  businessDayStartAtMs,
  timelineEndAtMs,
  hasOvernightFree,                  // derived
  isAvailable
}
```

No thousands of service-specific slots.

---

## Cache policy

| API | Cache |
|---|---|
| Bootstrap | HTTP/CDN friendly; `ETag` = revision; separate `StaticBootstrapCache`; admin catalog changes call `invalidatePublicBookingV2Bootstrap()` |
| Matrix | Short private SWR (`max-age=15, stale-while-revalidate=30`); **not** keyed by service/duration |

---

## Acceptance

| Gate | Status |
|---|---|
| BOOKING V2 FRONTEND READ API VERIFIED | Yes |
| SINGLE BOOTSTRAP API VERIFIED | Yes |
| 14-DAY MATRIX API VERIFIED | Yes |
| NO SERVICE-SPECIFIC AVAILABILITY CACHE | Yes |
| LOCAL SLOT GENERATION CONTRACT VERIFIED | Yes (15/30/45/60 parity) |
| MULTI-BRANCH BARBER VERIFIED | Yes (request shape + harness) |
| ANY-BARBER VERIFIED | Yes (branch roster scope) |
| OVERNIGHT BUSINESSDATE CONTRACT VERIFIED | Yes |
| REVISION PER DAY VERIFIED | Yes |
| PUBLIC-SAFE DTO VERIFIED | Yes |
| LEGACY V7 UNCHANGED | Yes |

### Perf snapshot (live harness, cloud DB — 2026-08-16)

| Scenario | JSON | gzip | wall | db | queries |
|---|---|---|---|---|---|
| Bootstrap cold | 29.7 KB | **2.7 KB** | 21103 ms | — | catalog |
| Bootstrap warm | same | same | **0 ms** (cache HIT) | — | 0 |
| 1 barber × 14 days | 5.8 KB | **0.6 KB** | 2640 ms | 2798 ms | 9 |
| Branch × all barbers × 14d | 11.6 KB | **0.8 KB** | 1825 ms | 2320 ms | 9 |
| Emp × 2 branches × 14d (Zeyad) | 11.5 KB | **0.8 KB** | 1974 ms | 3222 ms | 11 |

Run:

```bash
npx tsx scripts/verify-booking-v2-frontend-read.ts
```

---

## Out of scope (B9)

- No frontend UI changes
- No v7 route / write-path changes
- No reimplementation of availability inside route handlers
