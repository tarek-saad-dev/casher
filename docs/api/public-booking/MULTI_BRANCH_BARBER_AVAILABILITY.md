# Multi-Branch Barber Availability API

**Status:** Public · Phase 1C backend  
**Auth:** None (public customer booking)  
**Timezone:** Branch timezone (default `Africa/Cairo`)  
**Prefix:** `/api/public/booking`

---

## Purpose

Support a client booking flow where a customer choosing a **multi-branch barber** can:

1. Search that barber’s available appointments across **all public** branches where the barber has an active bookable assignment.
2. Search at **one specific** public branch.

Availability is aggregated by an orchestration layer that calls the **same** branch-specific AvailabilityEngine used by:

- `GET /api/public/booking/available-days`
- `GET /api/public/booking/available-slots`

Plan and create are **unchanged** and remain mandatory before booking.

---

## Routes

| Method | Path | Rate family |
|--------|------|-------------|
| `POST` | `/api/public/booking/barbers/:empId/availability/days` | `available-days` (20/min default) |
| `POST` | `/api/public/booking/barbers/:empId/availability/slots` | `availability` (30/min default) |
| `OPTIONS` | same paths | CORS preflight |

Related legacy aggregate (Phase 10C, flat slots contract — still available):

| Method | Path |
|--------|------|
| `POST` | `/api/public/booking/barbers/:empId/cross-branch-availability` |

---

## Authentication / public status

- No API key, cookie, or session required.
- Returns **public booking data only** (no salary, attendance notes, internal BranchID, schedule admin fields).
- Client-supplied `branchName`, `duration`, `price`, or barber display name are ignored.

---

## Available days

### Request

`POST /api/public/booking/barbers/:empId/availability/days`

```json
{
  "serviceIds": [10],
  "dateFrom": "2026-08-06",
  "days": 14,
  "scope": "all_public",
  "branchCode": null
}
```

```json
{
  "serviceIds": [10],
  "dateFrom": "2026-08-06",
  "days": 14,
  "scope": "specific_branch",
  "branchCode": "GLEEM"
}
```

| Field | Rules |
|-------|--------|
| `empId` | Path param; active public-bookable barber |
| `serviceIds` | Non-empty, deduplicated; max 12; each public-bookable |
| `dateFrom` | `YYYY-MM-DD` |
| `days` | Integer 1…31 (aligned with public calendar / `MAX_PUBLIC_BARBER_CALENDAR_DAYS`) |
| `scope` | `all_public` \| `specific_branch` |
| `branchCode` | Required for `specific_branch`; identity is **code**, never name |

### Response

Every requested calendar date is returned in ascending order (including unavailable days).

```json
{
  "ok": true,
  "barber": {
    "id": 12,
    "name": "Ziad",
    "nameAr": "زياد",
    "nameEn": "Ziad"
  },
  "scope": "all_public",
  "branches": [
    {
      "branchCode": "GLEEM",
      "branchName": "جليم – سابا باشا",
      "branchNameAr": "جليم – سابا باشا",
      "branchNameEn": "Gleem – Saba Pasha"
    },
    {
      "branchCode": "CAMP_CAESAR",
      "branchName": "كامب شيزار",
      "branchNameAr": "كامب شيزار",
      "branchNameEn": "Camp Caesar"
    }
  ],
  "days": [
    {
      "date": "2026-08-06",
      "available": true,
      "branches": [
        {
          "branchCode": "GLEEM",
          "slotsCount": 8,
          "earliestTime": "22:00",
          "earliestDayOffset": 0,
          "hasOvernightSlots": true
        },
        {
          "branchCode": "CAMP_CAESAR",
          "slotsCount": 4,
          "earliestTime": "23:00",
          "earliestDayOffset": 0,
          "hasOvernightSlots": false
        }
      ]
    }
  ],
  "partial": false,
  "warnings": []
}
```

---

## Available slots

### Request

`POST /api/public/booking/barbers/:empId/availability/slots`

```json
{
  "serviceIds": [10],
  "date": "2026-08-06",
  "scope": "all_public",
  "branchCode": null
}
```

```json
{
  "serviceIds": [10],
  "date": "2026-08-06",
  "scope": "specific_branch",
  "branchCode": "CAMP_CAESAR"
}
```

### Response

```json
{
  "ok": true,
  "barber": {
    "id": 12,
    "name": "Ziad",
    "nameAr": "زياد",
    "nameEn": "Ziad"
  },
  "date": "2026-08-06",
  "scope": "all_public",
  "slots": [
    {
      "slotId": "12:GLEEM:2026-08-06:22:00:0",
      "empId": 12,
      "barberName": "Ziad",
      "branchCode": "GLEEM",
      "branchName": "جليم – سابا باشا",
      "branchNameAr": "جليم – سابا باشا",
      "branchNameEn": "Gleem – Saba Pasha",
      "date": "2026-08-06",
      "time": "22:00",
      "dayOffset": 0,
      "startDateTime": "2026-08-06T19:00:00.000Z",
      "endDateTime": "2026-08-06T19:30:00.000Z",
      "duration": 30,
      "price": 200,
      "currency": "EGP"
    }
  ],
  "partial": false,
  "warnings": []
}
```

`startDateTime` / `endDateTime` are absolute ISO-8601 instants (UTC `Z`), same family as plan.

---

## Validation

- Employee exists, active, barber job, not hidden from public booking.
- `serviceIds` non-empty / deduped / public-bookable; barber may perform them (active catalog services).
- `scope` must be `all_public` or `specific_branch`.
- `specific_branch` requires `branchCode`; branch must be active + public-bookable; barber must have an **active** `CanReceiveBookings` assignment overlapping the window.
- `all_public` includes only active public branches with such an assignment (inactive assignments and non-public branches excluded).
- Date / horizon limits match public booking settings (max **31** days window on these routes; engine still clips to each branch `maxBookingDaysAhead`).

---

## Error codes

| Code | Typical HTTP | When |
|------|--------------|------|
| `BARBER_NOT_FOUND` | 404 | Missing / inactive / hidden employee |
| `BARBER_NOT_BOOKABLE` | 409 | Not a bookable barber job |
| `INVALID_SERVICE_IDS` | 400 | Empty / malformed / oversized service list |
| `BARBER_CANNOT_PERFORM_SERVICE` | 409 | Service not supported (equiv. “not allowed”) |
| `SERVICE_NOT_AVAILABLE_AT_BRANCH` | 409 | Not in public catalog at requested branch |
| `INVALID_AVAILABILITY_SCOPE` | 400 | Bad `scope` |
| `BRANCH_REQUIRED` | 400 | Missing `branchCode` for `specific_branch` |
| `BRANCH_NOT_PUBLIC` | 404 | Branch not publicly bookable |
| `BARBER_NOT_ASSIGNED` | 409 | Barber not assigned to requested branch |
| `NO_PUBLIC_BRANCHES_FOR_BARBER` | 409 | No public bookable assignments |
| `INVALID_DATE` / `INVALID_DATE_RANGE` / `DATE_RANGE_TOO_LARGE` | 400 | Date window issues |
| `BRANCH_AVAILABILITY_UNAVAILABLE` | 503 | Specific-branch engine failure (hard fail) |
| `AVAILABILITY_UNAVAILABLE` | 500 | All branches failed under `all_public` |
| `RATE_LIMIT_EXCEEDED` | 429 | Public rate limit |

Nested error envelope matches other public booking routes (`ok: false`, `error.code`, …).

---

## Partial response behavior

**`all_public`**

- If **every** requested branch fails internally → non-2xx (`AVAILABILITY_UNAVAILABLE`).
- If **some** succeed and some fail → HTTP 200 with:

```json
{
  "partial": true,
  "warnings": [
    { "branchCode": "CAMP_CAESAR", "code": "BRANCH_AVAILABILITY_UNAVAILABLE" }
  ]
}
```

Warnings use stable language-neutral codes only (no internal stacks).

**`specific_branch`**

- Any failure is a **request failure**, never partial success.

---

## dayOffset (client notes)

- `dayOffset: 0` — wall-clock time on the selected business `date`.
- `dayOffset: 1` — after-midnight continuation of an overnight shift still booked under that business date.
- Clients must send the same `dayOffset` to `plan` / `create` with `branchCode` from the selected slot.
- Sorting uses **absolute** `startDateTime`, so evening slots sort before their after-midnight continuations.

---

## Sorting guarantees

- **Days:** ascending `date`.
- **Day branch summaries:** ascending `branchCode`.
- **Slots:** ascending absolute `startDateTime`, then `branchCode`.
- Same clock time at two branches → **two** slots (never deduped by time alone).

---

## Stable slot identity

```text
slotId = "{empId}:{branchCode}:{date}:{time}:{dayOffset}"
```

Example: `12:GLEEM:2026-08-06:22:00:0`

Duration and price are resolved with the same catalog rules as **plan**. Plan remains the final validation authority (assignment, compatibility, freshness, conflicts, holds, recalculated price/duration).

---

## Examples

### all_public — both branches on one day

See days response above (`GLEEM` + `CAMP_CAESAR` under one `date`).

### specific_branch — Gleem only

Request `scope: "specific_branch", branchCode: "GLEEM"`. Response `branches` and day/slot payloads never include Camp.

### Same time at two branches

Two slots with identical `time` / `dayOffset` but different `branchCode` / `slotId`.

### Overnight

A `22:00` (`dayOffset: 0`) slot sorts before `00:30` (`dayOffset: 1`) on the same business date.

### Partial result

`partial: true` with `warnings[].code = "BRANCH_AVAILABILITY_UNAVAILABLE"` when one of several public branches fails.

---

## Plan / create remain mandatory

After the customer picks a slot:

1. `POST /api/public/booking/plan` with `branchCode`, `empId`, `serviceIds`, `date`, `time`, `dayOffset`
2. `POST /api/public/booking/create` with plan token + idempotency key

Do **not** trust aggregated list price/duration as final. Stale or conflicting aggregated slots are rejected by plan.

---

## Implementation pointers

| Concern | Module |
|---------|--------|
| Orchestration | `src/lib/booking/publicBarberMultiBranchAvailability.ts` |
| Pure helpers | `src/lib/booking/publicBarberMultiBranchAvailabilityPure.ts` |
| Engine | `listSpecificEmpPublicSlotsMultiDate` in `bookingAvailabilityEngine.ts` |
| Routes | `…/barbers/[empId]/availability/{days,slots}/route.ts` |
