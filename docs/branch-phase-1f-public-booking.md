# Phase 1F — Public Booking

## Branch discovery

`GET /api/public/branches` → `{ ok, branches: PublicBranchSafe[] }`  
Fields: branchId, branchCode, branchName, shortName, address, phone, timeZone. No cutoff/internal flags.

## Contract: `branchCode` required

Public flows must pass `branchCode` (query or body; also accepts `branch` alias) via `extractPublicBranchCode` + `resolvePublicBranchCode`.

| Missing | Response |
|---|---|
| No code | `400` `BRANCH_REQUIRED` — يجب اختيار الفرع |
| Unknown/inactive | `404` `INVALID_BRANCH` — الفرع غير متاح |

**Never** silent-default to GLEEM.

### Exceptions (global BookingCode)

* `GET /api/public/booking/[code]` — lookup by global unique code; returns nested safe `branch` from persisted BranchID  
* `POST /api/public/booking/[code]/cancel` (and legacy cancel-by-code) — phone match; no branchCode  

## Endpoints requiring branchCode

config, services, barbers, available-days, available-slots, check-slot, create, upcoming (and plan when used publicly).

Internal create (`source=operations|admin`) uses session active branch instead.

## Stamp + WhatsApp

Create stamps `Bookings.BranchID` and schedules WhatsApp with **persisted `branchName`**. Do not rely on `WHATSAPP_DEFAULT_BRANCH_NAME` when BranchID/branch is known (`buildBookingPayload` still falls back to env only if `branchName` omitted).

## Public UI

Widget flow updated in sibling repo **cut-salon-rtl-booking**: Branch → Services → … (branch first). POS repo exposes the API contract above.

## Catalog

Services/prices remain global. No branch service price overrides this phase. Barber list filtered by assignment + CanReceiveBookings for the chosen branch/date.
