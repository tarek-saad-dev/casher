# Public Booking API — Developer Reference

> **Version:** 1.0  
> **Last updated:** 2026-05-18  
> **Prefix:** `/api/public/booking`  
> **Auth required:** None — public endpoints only

---

## Table of Contents

1. [Overview](#overview)
2. [Base URL](#base-url)
3. [General Notes](#general-notes)
4. [Booking Flow](#booking-flow)
5. [Endpoint Reference](#endpoint-reference)
   - [GET /config](#1-get-config)
   - [GET /services](#2-get-services)
   - [GET /barbers](#3-get-barbers)
   - [GET /available-days](#4-get-available-days)
   - [GET /available-slots](#5-get-available-slots)
   - [POST /check-slot](#6-post-check-slot)
   - [POST /create](#7-post-create)
   - [GET /:bookingCode](#8-get-bookingcode)
   - [POST /:bookingCode/cancel](#9-post-bookingcodecancel)
6. [Error Reference](#error-reference)
7. [CORS & Security](#cors--security)
8. [Frontend Integration Guide](#frontend-integration-guide)
9. [Postman Collection Outline](#postman-collection-outline)
10. [Production Deployment Notes](#production-deployment-notes)

---

## Overview

This API exposes safe, public-facing endpoints for a Calendly-like booking widget on the client website.

It allows customers to:
- Browse available services and barbers
- View available days and time slots
- Check slot availability before confirming
- Create a booking and receive a confirmation code
- View their booking details by code
- Cancel their booking using their phone number

All availability logic is shared with the internal Operations Board and Queue system, ensuring that the public website always reflects the real current state.

---

## Base URL

| Environment | URL |
|---|---|
| Production | `https://YOUR-DOMAIN.com` |
| Local dev  | `http://localhost:5500` |

All endpoints are prefixed with `/api/public/booking`.

**Example:**
```
GET https://YOUR-DOMAIN.com/api/public/booking/config
```

---

## General Notes

- All responses are `application/json`.
- All request bodies must be `application/json` with the header `Content-Type: application/json`.
- Dates use `YYYY-MM-DD` format (e.g. `2026-05-17`).
- Times use `HH:MM` 24-hour format (e.g. `23:00`).
- Timezone is **Africa/Cairo (UTC+3)**.
- All successful responses include `"ok": true`.
- All error responses include `"error"` or `"reason"` string.
- Rate limiting is enforced per IP: **60 requests/minute** for read endpoints, **10 requests/minute** for create.
- CORS is enabled — all public endpoints accept cross-origin requests from any domain.

---

## Booking Flow

The recommended step-by-step flow for a frontend widget:

```
Step 1 ──► GET /config          (load salon settings)
Step 2 ──► GET /services        (show service picker)
Step 3 ──► GET /barbers         (show barber picker — if mode=specific)
Step 4 ──► GET /available-days  (show date picker with enabled/disabled days)
Step 5 ──► GET /available-slots (show time slots grid for selected date)
Step 6 ──► POST /check-slot     (re-validate before showing confirm form)
Step 7 ──► POST /create         (submit booking)
Step 8 ──► GET /:code           (show confirmation page)

Optional:
         POST /:code/cancel     (cancel button on confirmation page)
```

---

## Endpoint Reference

---

### 1. GET /config

**Purpose:** Returns the salon's public configuration for the booking widget. Call this once on page load to determine available modes, slot intervals, and booking window.

**Request:**
```
GET /api/public/booking/config
```
No parameters required.

**Response `200`:**
```json
{
  "ok": true,
  "salon": {
    "name": "Cut Salon",
    "logoUrl": null,
    "timezone": "Africa/Cairo",
    "currency": "EGP",
    "bookingEnabled": true
  },
  "settings": {
    "allowSpecificBarber": true,
    "allowNearestBarber": true,
    "defaultMode": "nearest",
    "slotIntervalMinutes": 15,
    "maxBookingDaysAhead": 14,
    "minNoticeMinutes": 30
  }
}
```

| Field | Type | Description |
|---|---|---|
| `salon.bookingEnabled` | boolean | If `false`, hide the booking widget entirely |
| `settings.defaultMode` | `"nearest"` \| `"specific"` | Default barber selection mode |
| `settings.slotIntervalMinutes` | number | Time grid resolution (e.g. 15 = slots every 15 min) |
| `settings.maxBookingDaysAhead` | number | Max days ahead the calendar should show |
| `settings.minNoticeMinutes` | number | Slots within this many minutes from now are hidden |

---

### 2. GET /services

**Purpose:** Returns all services available for online booking.

**Request:**
```
GET /api/public/booking/services
```
No parameters required.

**Response `200`:**
```json
{
  "ok": true,
  "services": [
    {
      "id": 9,
      "name": "Basic Cut",
      "price": 150,
      "durationMinutes": 30,
      "categoryName": "Hair",
      "isBookableOnline": true
    },
    {
      "id": 10,
      "name": "Beard Trim",
      "price": 80,
      "durationMinutes": 20,
      "categoryName": "Beard",
      "isBookableOnline": true
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | number | Use this as `serviceIds` in subsequent requests |
| `durationMinutes` | number | Used to calculate slot end time |
| `price` | number | In EGP |

> **Note:** If a service does not have a duration set in the database, the system falls back to `settings.defaultServiceDurationMinutes` (typically 30).

---

### 3. GET /barbers

**Purpose:** Returns all active barbers available for online booking. Only required when `mode=specific`.

**Request:**
```
GET /api/public/booking/barbers
```
No parameters required.

**Response `200`:**
```json
{
  "ok": true,
  "barbers": [
    {
      "id": 25,
      "name": "عمر",
      "job": "حلاق",
      "photoUrl": null,
      "bio": null,
      "isBookableOnline": true
    },
    {
      "id": 19,
      "name": "باسم",
      "job": "حلاق",
      "photoUrl": null,
      "bio": null,
      "isBookableOnline": true
    }
  ]
}
```

> **Note:** `photoUrl` and `bio` are reserved for future use. Currently always `null`.

---

### 4. GET /available-days

**Purpose:** Returns the next N days (from today) indicating which days have at least one available barber working. Use this to enable/disable dates in your calendar component.

**Request:**
```
GET /api/public/booking/available-days?serviceIds=9&mode=nearest
```

**Query Parameters:**

| Parameter | Required | Type | Description |
|---|---|---|---|
| `serviceIds` | Yes | `string` | Comma-separated service IDs. Example: `9` or `9,10` |
| `mode` | Yes | `"nearest"` \| `"specific"` | Barber selection mode |
| `empId` | Conditional | `number` | Required when `mode=specific` |
| `fromDate` | No | `YYYY-MM-DD` | Start date (default: today) |

**Examples:**
```
GET /api/public/booking/available-days?serviceIds=9&mode=nearest

GET /api/public/booking/available-days?serviceIds=9,10&mode=specific&empId=25
```

**Response `200`:**
```json
{
  "ok": true,
  "days": [
    {
      "date": "2026-05-17",
      "available": true,
      "label": "الأحد"
    },
    {
      "date": "2026-05-18",
      "available": true,
      "label": "الاثنين"
    },
    {
      "date": "2026-05-19",
      "available": false,
      "label": "الثلاثاء",
      "reason": "لا يوجد حلاق متاح في هذا اليوم"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `available` | boolean | Whether to enable this date in the calendar |
| `label` | string | Arabic day name |
| `reason` | string | Only present when `available=false` |

> **Note:** The number of days returned equals `settings.maxBookingDaysAhead` from `/config`.

---

### 5. GET /available-slots

**Purpose:** Returns time slots for a specific date. Each slot indicates whether it is available and (in nearest mode) which barber is best for that slot.

**Request:**
```
GET /api/public/booking/available-slots?date=2026-05-17&serviceIds=9&mode=nearest
```

**Query Parameters:**

| Parameter | Required | Type | Description |
|---|---|---|---|
| `date` | Yes | `YYYY-MM-DD` | The selected booking date |
| `serviceIds` | Yes | `string` | Comma-separated service IDs |
| `mode` | Yes | `"nearest"` \| `"specific"` | Barber selection mode |
| `empId` | Conditional | `number` | Required when `mode=specific` |

**Examples:**
```
GET /api/public/booking/available-slots?date=2026-05-17&serviceIds=9&mode=nearest

GET /api/public/booking/available-slots?date=2026-05-17&serviceIds=9&mode=specific&empId=25
```

**Response `200` — nearest mode:**
```json
{
  "ok": true,
  "date": "2026-05-17",
  "mode": "nearest",
  "slots": [
    {
      "time": "13:00",
      "available": true,
      "bestBarber": {
        "id": 19,
        "name": "باسم"
      },
      "availableBarbersCount": 3
    },
    {
      "time": "13:15",
      "available": false,
      "reason": "لا يوجد حلاق متاح"
    },
    {
      "time": "13:30",
      "available": true,
      "bestBarber": {
        "id": 25,
        "name": "عمر"
      },
      "availableBarbersCount": 2
    }
  ]
}
```

**Response `200` — specific mode:**
```json
{
  "ok": true,
  "date": "2026-05-17",
  "mode": "specific",
  "empId": 25,
  "slots": [
    {
      "time": "13:00",
      "available": false,
      "reason": "لديه أدوار متوقعة حتى 13:30",
      "nextAvailableTime": "13:30"
    },
    {
      "time": "13:30",
      "available": true
    },
    {
      "time": "13:45",
      "available": true
    }
  ]
}
```

> **Performance note:** This endpoint checks availability for each slot against the live queue and booking database. For days with many slots and many barbers, the response may take 2–5 seconds. Consider calling it only when the user selects a date (lazy load), and optionally show a loading spinner.

---

### 6. POST /check-slot

**Purpose:** Re-validates a specific slot immediately before showing the booking confirmation form. Use this as a final freshness check — slot availability may have changed since `/available-slots` was last loaded.

**Request:**
```
POST /api/public/booking/check-slot
Content-Type: application/json
```

**Body — nearest mode:**
```json
{
  "date": "2026-05-17",
  "time": "23:00",
  "serviceIds": [9],
  "mode": "nearest"
}
```

**Body — specific mode:**
```json
{
  "date": "2026-05-17",
  "time": "23:00",
  "serviceIds": [9],
  "mode": "specific",
  "empId": 25
}
```

| Field | Required | Type | Description |
|---|---|---|---|
| `date` | Yes | `YYYY-MM-DD` | Booking date |
| `time` | Yes | `HH:MM` | Booking time (24h) |
| `serviceIds` | No | `number[]` | Selected service IDs |
| `mode` | No | `"nearest"` \| `"specific"` | Default: `"nearest"` |
| `empId` | Conditional | `number` | Required when `mode=specific` |

**Response `200` — available:**
```json
{
  "ok": true,
  "available": true,
  "barber": {
    "id": 25,
    "name": "عمر"
  },
  "slot": {
    "start": "2026-05-17T23:00:00.000Z",
    "end": "2026-05-17T23:30:00.000Z",
    "durationMinutes": 30
  }
}
```

**Response `200` — unavailable:**
```json
{
  "ok": false,
  "available": false,
  "reason": "لديه أدوار متوقعة حتى 11:30 م",
  "conflictType": "queue",
  "nextAvailableTime": "2026-05-17T20:30:00.000Z"
}
```

| `conflictType` | Meaning |
|---|---|
| `"queue"` | Barber has active queue tickets blocking this time |
| `"booking"` | Barber has another confirmed booking at this time |
| `"working_hours"` | Outside barber's working hours |
| `"day_off"` | Barber is on a day off |

---

### 7. POST /create

**Purpose:** Creates a confirmed booking. The server re-validates availability before inserting — if the slot was taken between check-slot and create, returns `409 Conflict`.

**Request:**
```
POST /api/public/booking/create
Content-Type: application/json
```

**Body — nearest mode:**
```json
{
  "customer": {
    "name": "طارق سعد",
    "phone": "01227072811"
  },
  "serviceIds": [9],
  "mode": "nearest",
  "date": "2026-05-17",
  "time": "23:00",
  "notes": "عايز حلاقة سريعة"
}
```

**Body — specific mode:**
```json
{
  "customer": {
    "name": "طارق سعد",
    "phone": "01227072811"
  },
  "serviceIds": [9],
  "mode": "specific",
  "empId": 25,
  "date": "2026-05-17",
  "time": "23:00",
  "notes": "عايز حلاقة سريعة"
}
```

| Field | Required | Type | Validation |
|---|---|---|---|
| `customer.name` | Yes | `string` | Min 2 characters |
| `customer.phone` | Yes | `string` | 8–20 digits, may include `+`, spaces, dashes |
| `serviceIds` | No | `number[]` | Array of service IDs from `/services` |
| `mode` | No | `"nearest"` \| `"specific"` | Default: `"nearest"` |
| `empId` | Conditional | `number` | Required when `mode=specific` |
| `date` | Yes | `YYYY-MM-DD` | Must be within `maxBookingDaysAhead` |
| `time` | Yes | `HH:MM` | Must be at least `minNoticeMinutes` from now |
| `notes` | No | `string` | Optional customer notes |

**Response `201` — success:**
```json
{
  "ok": true,
  "booking": {
    "id": 142,
    "code": "BK-A3X9KL",
    "status": "confirmed",
    "customerName": "طارق سعد",
    "customerPhone": "01227072811",
    "barberName": "عمر",
    "servicesText": "Basic Cut",
    "date": "2026-05-17",
    "startTime": "23:00",
    "endTime": "23:30"
  },
  "message": "تم تأكيد الحجز بنجاح"
}
```

> **Important:** Save `booking.code` — this is the customer's booking reference used for all subsequent lookups and cancellations.

**Response `409` — slot taken:**
```json
{
  "ok": false,
  "error": "لديه أدوار متوقعة حتى 11:30 م",
  "conflictType": "queue",
  "nextAvailable": "2026-05-17T20:30:00.000Z"
}
```

**Response `409` — no barber available (nearest mode):**
```json
{
  "ok": false,
  "error": "لا يوجد حلاق متاح في هذا الموعد",
  "reason": "no_barber_available"
}
```

**Customer deduplication:** If a customer with the same phone number already exists in the system, the existing record is reused. No duplicate customers are created.

---

### 8. GET /:bookingCode

**Purpose:** Returns public booking details for the confirmation page. Safe to call from the client website — only exposes customer-facing fields.

**Request:**
```
GET /api/public/booking/BK-A3X9KL
```

**Response `200`:**
```json
{
  "ok": true,
  "booking": {
    "code": "BK-A3X9KL",
    "status": "confirmed",
    "customerName": "طارق سعد",
    "customerPhone": "01227072811",
    "barberName": "عمر",
    "servicesText": "Basic Cut",
    "date": "2026-05-17",
    "startTime": "23:00",
    "endTime": "23:30",
    "notes": null
  }
}
```

| `status` | Meaning |
|---|---|
| `confirmed` | Booking is active |
| `cancelled` | Booking was cancelled |
| `arrived` | Customer has arrived |
| `in_service` | Service in progress |
| `completed` | Service completed |
| `no_show` | Customer did not arrive |

**Response `404`:**
```json
{
  "error": "الحجز غير موجود"
}
```

---

### 9. POST /:bookingCode/cancel

**Purpose:** Cancels a booking. The customer must provide the same phone number used when booking — this acts as a lightweight ownership check.

**Request:**
```
POST /api/public/booking/BK-A3X9KL/cancel
Content-Type: application/json
```

**Body:**
```json
{
  "phone": "01227072811",
  "reason": "ظرف طارئ"
}
```

| Field | Required | Description |
|---|---|---|
| `phone` | Yes | Must match the phone number used at booking |
| `reason` | No | Optional cancellation reason |

**Response `200` — success:**
```json
{
  "ok": true,
  "message": "تم إلغاء الحجز بنجاح"
}
```

**Response `403` — phone mismatch:**
```json
{
  "error": "رقم الهاتف غير مطابق"
}
```

**Response `409` — already cancelled or in progress:**
```json
{
  "error": "لا يمكن إلغاء الحجز في الحالة الحالية: cancelled"
}
```

> **Note:** Only bookings with status `pending` or `confirmed` can be cancelled via this endpoint. Bookings that are `in_service`, `completed`, or `no_show` must be cancelled through the internal Operations Board.

---

## Error Reference

| HTTP Status | Meaning | When it occurs |
|---|---|---|
| `200` | OK | Request succeeded |
| `201` | Created | Booking created successfully |
| `204` | No Content | OPTIONS preflight response |
| `400` | Bad Request | Missing or invalid fields (date, time, phone, name) |
| `403` | Forbidden | Phone number does not match booking |
| `404` | Not Found | Booking code not found |
| `409` | Conflict | Slot unavailable, barber busy, or booking already cancelled |
| `429` | Too Many Requests | Rate limit exceeded (60 req/min general, 10 req/min create) |
| `500` | Internal Server Error | Database or unexpected server error |
| `503` | Service Unavailable | `bookingEnabled = false` in settings |

**Standard error body:**
```json
{
  "error": "رسالة الخطأ هنا"
}
```

**Conflict with details:**
```json
{
  "ok": false,
  "error": "لديه أدوار متوقعة حتى 11:30 م",
  "conflictType": "queue",
  "nextAvailable": "2026-05-17T20:30:00.000Z"
}
```

---

## CORS & Security

### CORS
All public endpoints return these headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, x-public-booking-key
```

All endpoints handle `OPTIONS` preflight requests and return `204 No Content`.

### Rate Limiting
- **Read endpoints** (`/config`, `/services`, `/barbers`, `/available-days`, `/available-slots`, `/check-slot`): **60 requests/minute per IP**
- **Create endpoint** (`/create`): **10 requests/minute per IP**
- **Cancel endpoint** (`/:code/cancel`): **20 requests/minute per IP**

Rate limit exceeded returns `429`:
```json
{
  "error": "طلبات كثيرة — حاول لاحقاً"
}
```

### What is NOT exposed
- Internal booking IDs (only the `code` is returned)
- Employee internal data beyond name and job title
- Admin-only financial data
- Session tokens or credentials
- Other customers' data

### Optional future security
The `x-public-booking-key` header is reserved for future use. A salon-specific public API key could be required for multi-tenant deployments.

---

## Frontend Integration Guide

### Recommended flow

```javascript
// 1. Load config once on page load
const config = await fetch('/api/public/booking/config')
  .then(r => r.json());

if (!config.salon.bookingEnabled) {
  showMessage('الحجز الإلكتروني غير متاح حالياً');
  return;
}

// 2. Load services
const { services } = await fetch('/api/public/booking/services')
  .then(r => r.json());

// 3. (Optional) Load barbers if mode=specific is allowed
const { barbers } = config.settings.allowSpecificBarber
  ? await fetch('/api/public/booking/barbers').then(r => r.json())
  : { barbers: [] };

// 4. When user picks services + mode, load available days
const serviceIds = selectedServices.map(s => s.id).join(',');
const { days } = await fetch(
  `/api/public/booking/available-days?serviceIds=${serviceIds}&mode=${mode}&empId=${empId || ''}`
).then(r => r.json());
// days: [{ date, available, label }] — use to build calendar

// 5. When user picks a date, load slots
const { slots } = await fetch(
  `/api/public/booking/available-slots?date=${date}&serviceIds=${serviceIds}&mode=${mode}&empId=${empId || ''}`
).then(r => r.json());
// Render only slots where slot.available === true

// 6. When user picks a slot, check it before showing confirm form
const slotCheck = await fetch('/api/public/booking/check-slot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ date, time, serviceIds: selectedServices.map(s => s.id), mode, empId })
}).then(r => r.json());

if (!slotCheck.available) {
  showMessage(slotCheck.reason);
  refreshSlots(); // reload slots grid
  return;
}

// 7. On form submit, create booking
const result = await fetch('/api/public/booking/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customer: { name, phone },
    serviceIds: selectedServices.map(s => s.id),
    mode,
    empId,       // omit if mode=nearest
    date,
    time,
    notes
  })
}).then(r => r.json());

if (!result.ok) {
  // 409: slot taken — show error and reload slots
  showMessage(result.error);
  return;
}

// 8. Show confirmation page
const bookingCode = result.booking.code;
navigateTo(`/booking/confirmation?code=${bookingCode}`);

// 9. On confirmation page, load booking details
const { booking } = await fetch(`/api/public/booking/${bookingCode}`)
  .then(r => r.json());

// 10. (Optional) Cancel button
const cancel = await fetch(`/api/public/booking/${bookingCode}/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone, reason })
}).then(r => r.json());
```

### UI state recommendations

| API call fails with | Recommended UI action |
|---|---|
| `409` on `/create` | Show error message, reload slots grid, clear selected slot |
| `409` on `/check-slot` | Show "تم حجز هذا الموعد — اختر موعداً آخر", reload slots |
| `503` | Show "الحجز الإلكتروني غير متاح حالياً" and hide widget |
| `429` | Show "الرجاء الانتظار لحظة ثم حاول مجدداً" |
| `500` | Show generic error "حدث خطأ — يرجى المحاولة مجدداً" |

---

## Postman Collection Outline

**Collection name:** `Public Booking API`

**Collection variable:**
```
baseUrl     = http://localhost:5500
serviceId   = 9
empId       = 25
bookingCode = BK-XXXXXX
phone       = 01000000000
```

| # | Folder | Name | Method | Path |
|---|---|---|---|---|
| 1 | Config | Get Config | `GET` | `{{baseUrl}}/api/public/booking/config` |
| 2 | Catalog | Get Services | `GET` | `{{baseUrl}}/api/public/booking/services` |
| 3 | Catalog | Get Barbers | `GET` | `{{baseUrl}}/api/public/booking/barbers` |
| 4 | Availability | Get Available Days (nearest) | `GET` | `{{baseUrl}}/api/public/booking/available-days?serviceIds={{serviceId}}&mode=nearest` |
| 5 | Availability | Get Available Days (specific) | `GET` | `{{baseUrl}}/api/public/booking/available-days?serviceIds={{serviceId}}&mode=specific&empId={{empId}}` |
| 6 | Availability | Get Available Slots (nearest) | `GET` | `{{baseUrl}}/api/public/booking/available-slots?date=2026-05-19&serviceIds={{serviceId}}&mode=nearest` |
| 7 | Availability | Get Available Slots (specific) | `GET` | `{{baseUrl}}/api/public/booking/available-slots?date=2026-05-19&serviceIds={{serviceId}}&mode=specific&empId={{empId}}` |
| 8 | Booking | Check Slot (nearest) | `POST` | `{{baseUrl}}/api/public/booking/check-slot` |
| 9 | Booking | Check Slot (specific) | `POST` | `{{baseUrl}}/api/public/booking/check-slot` |
| 10 | Booking | Create Booking (nearest) | `POST` | `{{baseUrl}}/api/public/booking/create` |
| 11 | Booking | Create Booking (specific) | `POST` | `{{baseUrl}}/api/public/booking/create` |
| 12 | Booking | Get Booking By Code | `GET` | `{{baseUrl}}/api/public/booking/{{bookingCode}}` |
| 13 | Booking | Cancel Booking | `POST` | `{{baseUrl}}/api/public/booking/{{bookingCode}}/cancel` |

**Check Slot body (nearest):**
```json
{
  "date": "2026-05-19",
  "time": "23:00",
  "serviceIds": [{{serviceId}}],
  "mode": "nearest"
}
```

**Create Booking body (nearest):**
```json
{
  "customer": {
    "name": "Test Client",
    "phone": "{{phone}}"
  },
  "serviceIds": [{{serviceId}}],
  "mode": "nearest",
  "date": "2026-05-19",
  "time": "23:00",
  "notes": "test booking"
}
```

**Cancel body:**
```json
{
  "phone": "{{phone}}",
  "reason": "test cancel"
}
```

---

## Production Deployment Notes

### Required environment variables

These must be set on the production server. No new variables were added by the public booking API — it reuses the existing database connection:

| Variable | Description |
|---|---|
| `DB_SERVER` | SQL Server hostname or IP |
| `DB_DATABASE` | Database name |
| `DB_USER` | SQL Server username |
| `DB_PASSWORD` | SQL Server password |
| `DB_PORT` | SQL Server port (default: 1433) |
| `DB_ENCRYPT` | `true` for Azure SQL, `false` for local |
| `DB_TRUST_SERVER_CERTIFICATE` | `true` for self-signed certs (dev only) |

### Middleware
Ensure `/api/public/` is in the allowed list in `src/middleware.ts`:
```ts
const PUBLIC_ROUTES = ['/login', '/api/auth/login', '/api/auth/session', '/api/permissions/my-access', '/api/public/'];
```
This is already configured. Do not remove it.

### Checklist before going live

- [ ] Replace `http://localhost:5500` with your production domain everywhere in frontend code
- [ ] Use HTTPS — never call the API over plain HTTP from a public website
- [ ] Confirm `DB_*` environment variables are set on the server
- [ ] Confirm `bookingEnabled: true` in `QueueBookingSettings` table
- [ ] Test `GET /config` from the production URL to verify connectivity
- [ ] Test `POST /create` end-to-end in staging before opening to public
- [ ] Confirm the Bookings table has `BookingCode` column (run migration if needed)
- [ ] Monitor server logs for `[public/booking/create]` entries after launch

### Rate limiting
The current implementation uses **in-memory rate limiting per Node.js process**. In a multi-instance deployment (e.g. multiple server replicas), rate limits are not shared across instances. For production at scale, replace with Redis-backed rate limiting.

### BookingCode column
The `/create` endpoint tries to save a `BookingCode` to the `Bookings` table. If the column does not exist, it falls back gracefully and the booking is still created — but the `code` returned to the frontend will be a generated code that cannot be retrieved by code (only by internal `BookingID`). 

**Recommended:** Run the following migration on production before launch:
```sql
ALTER TABLE [dbo].[Bookings]
ADD BookingCode NVARCHAR(20) NULL;

CREATE UNIQUE INDEX UX_Bookings_BookingCode
ON [dbo].[Bookings] (BookingCode)
WHERE BookingCode IS NOT NULL;
```
