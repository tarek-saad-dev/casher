# Client Booking API

Public booking contract for external client websites / apps.  
Derived from route handlers under `src/app/api/public/booking/**` and `src/app/api/public/branches`.

| | |
|---|---|
| **Base URL** | `https://{HOST}` (placeholder — do not hardcode secrets or production hosts) |
| **Prefix** | `/api/public/booking` (plus `GET /api/public/branches`) |
| **Auth** | None for public customers (no API keys, no cookies). Ownership for lookup/cancel uses **phone** and/or **booking access token**. |
| **Content-Type** | `application/json` for POST bodies |
| **Dates** | `YYYY-MM-DD` |
| **Times** | `HH:mm` (24h) |
| **Currency / pricing** | `EGP`, `pricingScope: "global"` |
| **Hold TTL** | **5 minutes** (`BOOKING_HOLD_TTL_MS` in `src/lib/booking/bookingHold.ts`) |

---

## Table of contents

1. [Recommended client flow (steps 1–12)](#1-recommended-client-flow-steps-112)
2. [Shared conventions](#2-shared-conventions)
3. [Endpoint reference](#3-endpoint-reference)
4. [Availability reason codes — Arabic UX](#4-availability-reason-codes--arabic-ux)
5. [Frontend rules](#5-frontend-rules)
6. [TypeScript client examples](#6-typescript-client-examples)
7. [Client implementation checklist](#7-client-implementation-checklist)
8. [Gaps & notes](#8-gaps--notes)

---

## 1. Recommended client flow (steps 1–12)

```
 1  GET  /api/public/branches
 2  GET  /api/public/booking/config?branchCode=…
     GET  /api/public/booking/status?branchCode=…     (optional gate)
 3  GET  /api/public/booking/services?branchCode=…
 4  GET  /api/public/booking/barbers?mode=branch&branchCode=…&serviceIds=…
 5  GET  /api/public/booking/available-days?branchCode=…&serviceIds=…[&empId=]
 6  GET  /api/public/booking/available-slots?branchCode=…&date=…&serviceIds=…[&empId=]
 7  POST /api/public/booking/check-slot
     POST /api/public/booking/plan                    (required before create in enforce mode)
 8  POST /api/public/booking/hold                     (optional 5‑min soft lock)
 9  POST /api/public/booking/create                   (+ Idempotency-Key / clientRequestId + planToken)
10  GET  /api/public/booking/{code}?phone=…           (success / confirmation)
11  POST /api/public/booking/upcoming                 (my bookings by phone)
12  POST /api/public/booking/{code}/cancel
     or POST /api/public/booking/cancel               (body.code)
```

| Step | Purpose |
|------|---------|
| 1 Branches | Discover publicly bookable branches only |
| 2 Config / status | Salon settings, modes, horizon; detect paused booking |
| 3 Services | Branch catalog (server prices & durations) |
| 4 Barbers | Eligible barbers for branch (+ optional service filter) |
| 5 Days | Which calendar days have capacity |
| 6 Slots | Exact start times for a day |
| 7 Check / plan | Fresh validation + plan token (no create) |
| 8 Hold | Optional 5‑minute hold before confirm |
| 9 Create | Transactional booking |
| 10 Success | Lookup by code (+ phone/token for full DTO) |
| 11 Upcoming | List future bookings for a phone |
| 12 Cancel | Customer cancel with ownership proof |

---

## 2. Shared conventions

### 2.1 Auth

| Surface | Auth |
|---------|------|
| Discovery, catalog, availability, check-slot, plan, hold, create | **Public** — no login |
| `GET /booking/{code}` | Optional `phone` and/or `accessToken` / `Authorization: Bearer …` for full owner view; code-only → minimal (no services/notes) |
| Cancel / upcoming | Phone and/or access token required (cancel); phone required (upcoming) |
| Internal ops paths on `available-slots` / `create` (`source=operations\|admin`) | **Staff session** — not for client websites |

### 2.2 Rate limits

From `publicBookingRateLimitPolicy.ts` (per IP, 60s window; lookup/upcoming/cancel also subject-aware when digest present). Defaults:

| Family | Limit / min | Routes |
|--------|-------------|--------|
| discovery | 60 | branches, config, status |
| catalog | 45 | services |
| barbers | 45 | barbers list/profile, location |
| availability | 30 | available-slots, barber slots, calendar, cross-branch |
| available-days | 20 | available-days |
| validation | 20 | check-slot |
| plan | 15 | plan |
| create | 8 | create |
| lookup | 30 | GET `/{code}` |
| upcoming | 15 | upcoming |
| cancel | 10 | cancel, `/{code}/cancel` |

On exceed: HTTP **429**, error code `RATE_LIMIT_EXCEEDED`, headers `X-RateLimit-*` / `Retry-After`.

> **Note:** `POST|DELETE /api/public/booking/hold` does **not** currently call `gatePublicBookingRoute` — no shared rate-limit / CORS matrix entry.

### 2.3 Error shape (gated routes)

```json
{
  "ok": false,
  "error": {
    "code": "BRANCH_REQUIRED",
    "message": "اختر الفرع أولًا",
    "technicalMessage": "branchCode is required",
    "metadata": {}
  }
}
```

Hold uses a flatter `{ ok: false, code, messageAr }` shape (see hold section).

### 2.4 CORS

Allowlist via `PUBLIC_BOOKING_ALLOWED_ORIGINS`. Allowed methods/headers per route in `PUBLIC_BOOKING_ROUTE_CORS`. Exposed headers include `X-Request-Id`, `X-RateLimit-*`, `Retry-After`, `X-Booking-Contract-Version`.

### 2.5 Ignored / forbidden client fields

Do **not** send (ignored or rejected): `BranchID` / `branchId`, client `price` / `duration` / `total` / `status` / `bookingCode`, `timezone`, `includeBusy`, `preview` as privilege escalator. Create rejects numeric `bookingId` / `BookingID` on cancel routes.

---

## 3. Endpoint reference

Placeholders: `{BASE}` = `https://{HOST}`.

---

### 3.1 `GET /api/public/branches`

| | |
|---|---|
| **URL** | `{BASE}/api/public/branches` |
| **Auth** | None |
| **Rate limit** | discovery — 60/min |
| **CORS** | GET, OPTIONS |

**Response `200`**

```ts
{
  ok: true;
  branches: Array<{
    branchId: number;
    branchCode: string;
    branchName: string;
    shortName: string | null;
    address: string | null;
    phone: string | null;
    timeZone: string;
  }>;
}
```

Only branches that pass public discovery (`PUBLIC_LIVE` + active + `PublicBookingEnabled` + queue `BookingEnabled`).

---

### 3.2 `GET /api/public/booking/config`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/config?branchCode={CODE}` |
| **Auth** | None |
| **Rate limit** | discovery — 60/min |
| **Query** | `branchCode` **required** (no GLEEM fallback). `preview` ignored for privilege. |

**Response `200` (booking on)**

```ts
{
  ok: true;
  branch: {
    branchId: number;
    branchCode: string;
    branchName: string;
    shortName: string | null;
    address: string | null;
    phone: string | null;
    timeZone: string;
  };
  salon: {
    name: string;
    logoUrl: null;
    timezone: string;
    currency: string;
    bookingEnabled: boolean;
  };
  settings: {
    allowSpecificBarber: boolean;
    allowNearestBarber: boolean;
    defaultMode: "nearest" | "specific";
    slotIntervalMinutes: number;
    maxBookingDaysAhead: number;
    minNoticeMinutes: number;
  };
  operatingHours: { openTime: string | null; closeTime: string | null };
}
```

**When booking paused** (`bookingEnabled` false): same payload plus:

```ts
{
  bookingPaused: true;
  message: string; // PUBLIC_BOOKING_PAUSED_MESSAGE
  code: "BOOKING_PAUSED";
}
```

---

### 3.3 `GET /api/public/booking/status`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/status?branchCode={CODE}` |
| **Auth** | None |
| **Rate limit** | discovery — 60/min |

**Response `200`**

```ts
{
  ok: true;
  bookingEnabled: boolean;
  message?: string; // present when bookingEnabled === false
}
```

---

### 3.4 `GET /api/public/booking/services`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/services?branchCode={CODE}` |
| **Auth** | None |
| **Rate limit** | catalog — 45/min |
| **Errors** | `BRANCH_BOOKING_DISABLED`, `SERVICES_NOT_CONFIGURED`, … |

**Response `200`**

```ts
{
  ok: true;
  branch: { branchCode: string; branchName: string };
  currency: "EGP";
  pricingScope: "global";
  categories: Array<{
    categoryId: string;
    nameAr: string;
    nameEn: string;
    sortOrder: number;
    services: PublicBookingServiceWire[];
  }>;
  services: PublicBookingServiceWire[]; // flat
  groups: Array<{
    categoryId: string;
    categoryName: string;
    categoryNameAr: string;
    categoryNameEn: string;
    services: PublicBookingServiceWire[];
  }>;
  meta: {
    serviceCount: number;
    categoryCount: number;
    generatedAt: string;
    catalogVersion: string;
    contractVersion: string;
    pricingScope: "global";
  };
}

type PublicBookingServiceWire = {
  serviceId: number;
  id: number;
  nameAr: string;
  nameEn: string;
  name: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  price: number;
  durationMinutes: number;
  sortOrder: number;
  bookable: true;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  categoryNameAr: string;
  categoryNameEn: string;
};
```

---

### 3.5 `GET /api/public/booking/barbers`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/barbers` |
| **Auth** | None |
| **Rate limit** | barbers — 45/min |
| **Query** | `mode=global\|branch` (default: branch if `branchCode` present else global); `branchCode`; optional `date` (`YYYY-MM-DD`); optional `serviceIds` (comma-separated) |

**Response `200`**

```ts
{
  ok: true;
  mode: "global" | "branch";
  branch?: { branchCode: string; branchName: string };
  barbers: Array<{
    empId: number;
    id: number;
    nameAr: string;
    nameEn: string | null;
    name: string;
    imageUrl: string | null;
    shortBio: string | null;
    photoUrl: string | null;
    bio: string | null;
    serviceIds: number[];
    branches: Array<{ branchCode: string; branchName: string }>;
    availabilityType: "presence_only";
    isBookableOnline: true;
  }>;
  meta: {
    count: number;
    generatedAt: string;
    contractVersion: string;
    dateFilter: string | null;
  };
}
```

#### Related barber routes

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/public/booking/barbers/{empId}` | Single profile (`barber` + `meta`) |
| GET | `/api/public/booking/barbers/{empId}/location?date=&serviceIds=` | Branch for WorkDate |
| GET | `/api/public/booking/barbers/{empId}/calendar?from=&to=&branchCode=&serviceIds=` | Presence calendar |
| GET | `/api/public/booking/barbers/{empId}/available-slots?branchCode=&date=&serviceIds=` | Same as available-slots with path empId |
| POST | `/api/public/booking/barbers/{empId}/cross-branch-availability` | Body: `serviceIds`, `dateFrom`, `days` → `{ ok, barber, branches, days, slots, meta }` |

---

### 3.6 `GET /api/public/booking/available-days`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/available-days` |
| **Auth** | None |
| **Rate limit** | available-days — 20/min |
| **Cache** | `private, max-age=45, stale-while-revalidate=30` |
| **Query** | **Required:** `branchCode`, `serviceIds`. **Optional:** `empId`, `from` / `fromDate`, `to` / `toDate` |

**Response `200`**

```ts
{
  ok: true;
  branch: { branchCode: string; branchName: string };
  selection: {
    empId: number | null;
    serviceIds: number[];
    totalDurationMinutes: number;
    mode: "specific_barber" | "any_barber";
  };
  days: Array<{
    date: string;
    status:
      | "available"
      | "fully_booked"
      | "barber_day_off"
      | "global_leave"
      | "branch_closed"
      | "not_assigned"
      | "service_not_available"
      | "outside_booking_horizon"
      | "min_notice_not_met"
      | "no_eligible_barber"
      | "barber_at_different_branch"
      | "not_available_publicly";
    isAvailable: boolean;
    availableSlotCount: number;
    firstAvailableTime: string | null;
    firstAvailableDayOffset: 0 | 1 | null;
    eligibleBarberCount?: number;
    availableBarberCount?: number;
    otherBranch?: { branchCode: string; branchName: string };
  }>;
  meta: { dayCount: number; generatedAt: string; contractVersion: string };
}
```

---

### 3.7 `GET /api/public/booking/available-slots`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/available-slots` |
| **Auth** | None (public). Ops/admin: session + `source=operations\|admin` (not for client sites). |
| **Rate limit** | availability — 30/min |
| **Cache** | `private, max-age=30, stale-while-revalidate=20` (public path) |
| **Query (public)** | **Required:** `branchCode`, `date`, `serviceIds`. **Optional:** `empId` |

**Response `200` (public)**

```ts
{
  ok: true;
  branch: { branchCode: string; branchName: string };
  date: string;
  mode: "specific_barber" | "any_barber";
  services: {
    serviceIds: number[];
    totalDurationMinutes: number;
    totalPrice: number;
  };
  slots: Array<{
    time: string;
    dayOffset: 0 | 1;
    startDateTime?: string;
    endDateTime?: string;
    barbers: Array<{ empId: number; nameAr: string }>;
  }>;
  // When slots empty:
  reasonCode?: string | null;
  message?: string | null;
  messageAr?: string | null;
  recoverySuggestionAr?: string | null;
  employeeReasons?: Array<{ empId: number; reasonCode: string; message?: string }>;
  meta: {
    slotCount: number;
    eligibleBarberCount?: number;
    contractVersion: string;
    generatedAt: string;
  };
}
```

Empty-slot UX fields come from `buildEmptySlotsUx` (`emptySlotsUx.ts`).

---

### 3.8 `POST /api/public/booking/check-slot`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/check-slot` |
| **Auth** | None |
| **Rate limit** | validation — 20/min |
| **Body** | `branchCode` (or query), `date`, `time`, `dayOffset?`, `serviceIds`, `empId?`, `mode?` |

Does **not** reserve. Business unavailability → **HTTP 200** with `available: false` (compatibility).

**Available `200`**

```ts
{
  ok: true;
  available: true;
  mode: string;
  assignmentStrategy: string;
  branch: { branchCode: string; branchName: string };
  slot: {
    date: string;
    time: string;
    dayOffset: 0 | 1;
    startDateTime: string | null;
    endDateTime: string | null;
  };
  services: {
    serviceIds: number[];
    totalDurationMinutes: number;
    subtotal: number;
  };
  barber: {
    empId: number;
    nameAr: string;
    nameEn: string | null;
    imageUrl: string | null;
  } | null;
  candidateBarbers: Array<{
    empId: number;
    nameAr: string;
    nameEn: string | null;
    imageUrl: string | null;
  }>;
  meta: { evaluationMode: string; evaluatedAt: string };
}
```

**Unavailable `200`:** same shape with `available: false` and `reason: { code, message }`.

---

### 3.9 `POST /api/public/booking/plan`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/plan` |
| **Auth** | None |
| **Rate limit** | plan — 15/min |
| **Body** | Same selection fields as check-slot (`customer` ignored) |

Read-only. Does **not** create bookings or holds. Returns `planToken` + `planExpiresAt` for create.

**Success `200`**

```ts
{
  ok: true;
  plan: {
    contractVersion: string;
    branch: {
      branchCode: string;
      branchName: string;
      address: string | null;
      phone: string | null;
    };
    mode: string;
    assignmentStrategy: string;
    barber: { empId: number; nameAr: string; nameEn: string | null; imageUrl: string | null } | null;
    candidateBarbers: Array<{ empId: number; nameAr: string; nameEn: string | null; imageUrl: string | null }>;
    date: string;
    time: string;
    dayOffset: 0 | 1;
    startDateTime: string | null;
    endDateTime: string | null;
    services: Array<{
      serviceId: number;
      nameAr: string;
      nameEn: string;
      price: number;
      durationMinutes: number;
    }>;
    totalDurationMinutes: number;
    subtotal: number;
    discount: 0;
    total: number;
    currency: "EGP";
    pricingScope: string;
    planFingerprint: string;
    planToken: string;
    planExpiresAt: string;
    evaluatedAt: string;
    evaluationMode: string;
  };
}
```

Unavailable → catalog error (often `BOOKING_PLAN_UNAVAILABLE`).

---

### 3.10 `POST /api/public/booking/hold` · `DELETE /api/public/booking/hold`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/hold` |
| **Auth** | None |
| **Rate limit / CORS gate** | Not wired through `gatePublicBookingRoute` |
| **TTL** | **5 minutes** (`ttlMs: 300000`) |

**POST body**

| Field | Required | Notes |
|-------|----------|--------|
| `branchCode` | yes | |
| `empId` | yes | positive integer |
| `date` or `businessDate` | yes | business date |
| `startAt` | yes | ISO datetime |
| `endAt` | yes | ISO datetime |
| `holdKey` | yes | client-generated unique key |
| `sessionKey` | no | max 120 chars |
| `clientRequestId` | no | |

**Success**

```ts
{
  ok: true;
  hold: {
    holdId: number;
    holdKey: string;
    expiresAt: string; // ISO
    ttlMs: 300000;
  };
}
```

**Conflict `409`:** `{ ok: false, code: "HOLD_CONFLICT", messageAr, recoverySuggestionAr }`

**DELETE:** `?holdKey=` → `{ ok: true, released: boolean }`

> **Hold on create:** Pass `holdKey` on `POST /create`. The route forwards it to `createPublicBooking`, which consumes the hold after a successful commit.

---

### 3.11 `POST /api/public/booking/create`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/create` |
| **Auth** | None (public). Ops/admin with session when `source=operations\|admin`. |
| **Rate limit** | create — 8/min |
| **Headers** | `Idempotency-Key` (or body `clientRequestId` / `idempotencyKey`) |
| **CORS allowed headers** | `Content-Type`, `Idempotency-Key` |

**Body (public)**

| Field | Required | Notes |
|-------|----------|--------|
| `branchCode` | yes | |
| `date` | yes | |
| `time` | yes | |
| `dayOffset` | optional | `0` \| `1` |
| `serviceIds` | yes | |
| `mode` | optional | `any_barber` / `nearest` / `specific_barber` / `specific` |
| `empId` | for specific | ignored when any_barber |
| `planToken` | **required in enforce mode** | from `/plan` |
| `customer.name` | yes | 2…max length |
| `customer.phone` | yes (public) | normalized EG phone |
| `notes` | no | length-capped |
| `clientRequestId` / `idempotencyKey` | **required in enforce mode** | |
| `suppressNotification` | no | boolean |

**Success `201`**

```ts
{
  ok: true;
  booking: {
    id: number;
    code: string;
    status: "confirmed";
    branch: { branchCode: string; branchName: string; address: string | null; phone: string | null };
    barber: { empId: number; nameAr: string; nameEn: string | null; imageUrl: string | null };
    assignmentStrategy: string;
    date: string;
    calendarDate: string;
    time: string;
    dayOffset: 0 | 1;
    startDateTime: string | null;
    endDateTime: string | null;
    endTime: string;
    services: Array<{
      serviceId: number;
      nameAr: string;
      nameEn: string;
      price: number;
      durationMinutes: number;
    }>;
    totalDurationMinutes: number;
    subtotal: number;
    discount: 0;
    total: number;
    currency: "EGP";
    pricingScope: string;
    bookingAccessToken?: string;
  };
  meta: {
    idempotentReplay: boolean;
    planTokenStatus: string;
    createdAt: string;
    assignmentStrategy: string;
  };
  message: "تم تأكيد الحجز بنجاح";
  whatsapp?: { scheduled: boolean; skipped: boolean; reason: string };
  compatibility?: object;
}
```

---

### 3.12 `GET /api/public/booking/{code}`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/{code}` |
| **Auth** | Optional ownership: `?phone=` and/or `?accessToken=` / `Authorization: Bearer` |
| **Rate limit** | lookup — 30/min (subject-aware) |

**Response `200`**

```ts
{
  ok: true;
  booking: PublicBookingDto; // full | minimal (no services/notes when ownership=minimal)
  bookingAccessToken?: string; // when owner
  meta: { ownership: "owner" | "minimal"; dateSource: string };
}
```

`PublicBookingDto` fields: `code`, `status`, `statusLabel`, `statusLabelAr`, `branch`, `barber`, `assignmentStrategy`, `workDate`, `calendarDate`, `time`, `dayOffset`, `startDateTime`, `endDateTime`, `services`, `servicesSummary`, `totalDurationMinutes`, `subtotal`, `discount`, `total`, `currency`, `notes`, `createdAt`, `canCancel`, `cancellation`, `dateSource`, `meta`.

---

### 3.13 `POST /api/public/booking/upcoming`

| | |
|---|---|
| **URL** | `{BASE}/api/public/booking/upcoming` |
| **Auth** | Phone in body (ownership) |
| **Rate limit** | upcoming — 15/min (subject-aware) |
| **Body** | `phone` (required), `fromDate?`, `limit?` (default 10, max 25) |

**Response `200`**

```ts
{
  ok: true;
  bookings: PublicBookingDto[]; // view mode summary
  meta: { count: number; hasMore: boolean };
}
```

---

### 3.14 Cancel

#### Preferred: `POST /api/public/booking/{code}/cancel`

#### Compatibility: `POST /api/public/booking/cancel` (body `code`)

| | |
|---|---|
| **Auth** | `phone` and/or `bookingAccessToken` / `accessToken` |
| **Rate limit** | cancel — 10/min |
| **Idempotency** | `clientRequestId` / `idempotencyKey` / header `Idempotency-Key` |
| **Body** | `phone?`, `bookingAccessToken?`, `accessToken?`, `reasonCode?`, `reasonText?` |
| **Rejects** | numeric `bookingId` / `BookingID` |

Approved `reasonCode` values: `customer_changed_plans`, `customer_sick`, `scheduling_conflict`, `other`.

Cutoff: **30 minutes** before `AbsoluteStartUtc` (`PUBLIC_CANCELLATION_CUTOFF_MINUTES`).

**Success `200`**

```ts
{
  ok: true;
  cancellation: {
    code: string;
    status: "cancelled";
    statusLabel: string;
    cancelledAt: string | null;
    reasonCode: string | null;
    alreadyCancelled?: true;
    idempotentReplay: boolean;
  };
  booking: {
    code: string;
    branch: { branchCode: string; branchName: string } | null;
    barber: { empId: number | null; nameAr: string | null };
    workDate: string | null;
    calendarDate: string | null;
    time: string | null;
    dayOffset: 0 | 1 | null;
    status: "cancelled";
    canCancel: false;
  };
  slotRelease: unknown;
}
```

---

## 4. Availability reason codes — Arabic UX

Machine codes from `src/lib/availability/reasonCodes.ts`.  
Labels: `AVAILABILITY_REASON_AR` in `workforceUiLabels.ts`.  
Recovery: `RECOVERY_AR` in `emptySlotsUx.ts` (fallback: «اختر موظفًا آخر أو يومًا مختلفًا»).

| `reasonCode` | Message (AR) | Customer action (AR) |
|--------------|--------------|----------------------|
| `BRANCH_CLOSED` | الفرع مغلق | اختر يومًا آخر أو فرعًا آخر |
| `BRANCH_BOOKING_DISABLED` | الحجز متوقف مؤقتاً لهذا الفرع *(API catalog)* | الحجز غير متاح حاليًا — حاول لاحقًا / اختر فرعًا آخر *(aligned with `BOOKING_TEMPORARILY_DISABLED`)* |
| `EMPLOYEE_OFF_DAY` | الموظف في إجازة | اختر يوم عمل أو موظفًا آخر |
| `EMPLOYEE_ABSENT` | الموظف غائب | اختر موظفًا آخر أو يومًا لاحقًا |
| `FREELANCER_NOT_PLANNED` | المستقل لم يسجّل حضوره بعد | انتظر تسجيل حضور المستقل أو اختر موظفًا آخر |
| `FREELANCER_HOURS_NOT_CONFIGURED` | ساعات المستقل غير مضبوطة في الملف | راجع إعداد ساعات المستقل مع الإدارة |
| `SCHEDULE_NOT_CONFIGURED` | لا يوجد جدول عمل | تواصل مع الإدارة لضبط الجدول |
| `SERVICE_NOT_SUPPORTED` | الخدمة غير متاحة لهذا الموظف | اختر خدمة أخرى أو موظفًا يؤدي هذه الخدمة |
| `OUTSIDE_WORKING_WINDOW` | خارج ساعات العمل | اختر وقتًا ضمن ساعات العمل |
| `BLOCKED_BY_BREAK` | محظور بفترة راحة | اختر وقتًا خارج فترة الراحة |
| `BLOCKED_BY_DAILY_ADJUSTMENT` | محظور بتعديل يومي | اختر وقتًا أو يومًا آخر |
| `BOOKING_CONFLICT` | تعارض مع حجز قائم | اختر أقرب وقت متاح أو موظفًا آخر |
| `QUEUE_CONFLICT` | تعارض مع تذكرة طابور | اختر وقتًا لاحقًا |
| `HOLD_CONFLICT` | الفترة محجوزة مؤقتًا لعميل آخر | أعد المحاولة بعد دقائق أو اختر موعدًا آخر |
| `NO_CONTIGUOUS_WINDOW` | لا توجد فترة متصلة كافية | اختر خدمة أقصر أو نافذة عمل أخرى |
| `MIN_NOTICE_NOT_MET` | أقل من الحد الأدنى للإشعار | اختر وقتًا لاحقًا |
| `MAX_ADVANCE_EXCEEDED` | تجاوز أفق الحجز المسموح | اختر يومًا أقرب |
| `SLOT_UNAVAILABLE` | الموعد غير متاح | أعد تحميل المواعيد واختر وقتًا آخر |

**Empty slots response:** prefer `messageAr` + `recoverySuggestionAr` from the API when present; do not invent codes client-side.

Related API catalog codes (not identical to availability list): `BRANCH_CLOSED_ON_WORKDATE`, `BOOKING_HORIZON_EXCEEDED`, `CHECK_SLOT_UNAVAILABLE`, `EMPLOYEE_INTERVAL_BUSY_GLOBAL`, `BARBER_DAY_OFF`, etc.

---

## 5. Frontend rules

1. **Never calculate availability client-side.** Do not invent free slots from opening hours, duration math, or barber calendars alone. Always call `available-days` / `available-slots` / `check-slot` / `plan`.
2. **Never trust client price or duration.** Use catalog / plan / create response totals only.
3. **Never send `BranchID` / internal IDs** to unlock branches. Use `branchCode` only.
4. **Respect `bookingEnabled` / `BRANCH_BOOKING_DISABLED` / `BOOKING_PAUSED`** — hide booking CTA when paused.
5. **Pass through `reasonCode` + Arabic recovery** from empty-slot / check-slot / hold responses.
6. **Always re-validate** with `check-slot` and obtain a fresh `planToken` via `/plan` immediately before create.
7. **Idempotency:** send a stable `Idempotency-Key` (or `clientRequestId`) for create and cancel; reuse the same key only for identical payloads.
8. **Hold TTL is 5 minutes** — if using hold, complete create before `expiresAt`; release with DELETE if the user abandons.
9. **Overnight:** honor `dayOffset: 0 | 1` from the server; do not assume calendar date === work date.
10. **Cancel ownership:** require phone and/or access token; never cancel by numeric BookingID.
11. **Rate limits:** backoff on 429 using `Retry-After` / `X-RateLimit-Reset`.
12. **CORS:** call from an allowlisted origin; no credentials mode required (`Access-Control-Allow-Credentials` is not set).

---

## 6. TypeScript client examples

```ts
// ─── Base wrapper ───────────────────────────────────────────
const BASE_URL = "https://{HOST}"; // placeholder

export class PublicBookingApiError extends Error {
  constructor(
    public code: string,
    public messageAr: string,
    public httpStatus: number,
    public metadata: Record<string, unknown> = {},
  ) {
    super(messageAr);
  }
}

type Json = Record<string, unknown>;

async function pbFetch<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined | null> },
): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || data.ok === false) {
    const err = (data.error as Json) || data;
    throw new PublicBookingApiError(
      String(err.code ?? "UNKNOWN"),
      String(err.message ?? err.messageAr ?? res.statusText),
      res.status,
      (err.metadata as Record<string, unknown>) ?? {},
    );
  }
  return data as T;
}

export const bookingApi = {
  listBranches: () =>
    pbFetch<{ ok: true; branches: Array<{ branchCode: string; branchName: string }> }>(
      "/api/public/branches",
    ),

  getConfig: (branchCode: string) =>
    pbFetch<Json>("/api/public/booking/config", { query: { branchCode } }),

  getStatus: (branchCode: string) =>
    pbFetch<{ ok: true; bookingEnabled: boolean }>("/api/public/booking/status", {
      query: { branchCode },
    }),

  getServices: (branchCode: string) =>
    pbFetch<Json>("/api/public/booking/services", { query: { branchCode } }),

  listBarbers: (q: {
    branchCode?: string;
    mode?: "global" | "branch";
    serviceIds?: number[];
    date?: string;
  }) =>
    pbFetch<Json>("/api/public/booking/barbers", {
      query: {
        branchCode: q.branchCode,
        mode: q.mode,
        date: q.date,
        serviceIds: q.serviceIds?.join(","),
      },
    }),

  availableDays: (q: {
    branchCode: string;
    serviceIds: number[];
    empId?: number;
    from?: string;
    to?: string;
  }) =>
    pbFetch<Json>("/api/public/booking/available-days", {
      query: {
        branchCode: q.branchCode,
        serviceIds: q.serviceIds.join(","),
        empId: q.empId,
        from: q.from,
        to: q.to,
      },
    }),

  availableSlots: (q: {
    branchCode: string;
    date: string;
    serviceIds: number[];
    empId?: number;
  }) =>
    pbFetch<{
      ok: true;
      slots: Array<{ time: string; dayOffset: 0 | 1 }>;
      reasonCode?: string | null;
      messageAr?: string | null;
      recoverySuggestionAr?: string | null;
    }>("/api/public/booking/available-slots", {
      query: {
        branchCode: q.branchCode,
        date: q.date,
        serviceIds: q.serviceIds.join(","),
        empId: q.empId,
      },
    }),

  checkSlot: (body: {
    branchCode: string;
    date: string;
    time: string;
    dayOffset?: 0 | 1;
    serviceIds: number[];
    empId?: number | null;
    mode?: string;
  }) =>
    pbFetch<{ ok: true; available: boolean; reason?: { code: string; message: string } }>(
      "/api/public/booking/check-slot",
      { method: "POST", body: JSON.stringify(body) },
    ),

  plan: (body: {
    branchCode: string;
    date: string;
    time: string;
    dayOffset?: 0 | 1;
    serviceIds: number[];
    empId?: number | null;
    mode?: string;
  }) =>
    pbFetch<{ ok: true; plan: { planToken: string; planExpiresAt: string } }>(
      "/api/public/booking/plan",
      { method: "POST", body: JSON.stringify(body) },
    ),

  hold: (body: {
    branchCode: string;
    empId: number;
    date: string;
    startAt: string;
    endAt: string;
    holdKey: string;
    sessionKey?: string;
  }) =>
    pbFetch<{ ok: true; hold: { holdKey: string; expiresAt: string; ttlMs: number } }>(
      "/api/public/booking/hold",
      { method: "POST", body: JSON.stringify(body) },
    ),

  releaseHold: (holdKey: string) =>
    pbFetch<{ ok: true; released: boolean }>(
      `/api/public/booking/hold?holdKey=${encodeURIComponent(holdKey)}`,
      { method: "DELETE" },
    ),

  create: (
    body: {
      branchCode: string;
      date: string;
      time: string;
      dayOffset?: 0 | 1;
      serviceIds: number[];
      empId?: number | null;
      mode?: string;
      planToken: string;
      customer: { name: string; phone: string };
      notes?: string;
      clientRequestId: string;
    },
    idempotencyKey: string,
  ) =>
    pbFetch<{ ok: true; booking: { code: string; bookingAccessToken?: string } }>(
      "/api/public/booking/create",
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      },
    ),

  getBooking: (code: string, q?: { phone?: string; accessToken?: string }) =>
    pbFetch<Json>(`/api/public/booking/${encodeURIComponent(code)}`, {
      query: { phone: q?.phone, accessToken: q?.accessToken },
      headers: q?.accessToken
        ? { Authorization: `Bearer ${q.accessToken}` }
        : undefined,
    }),

  upcoming: (body: { phone: string; fromDate?: string; limit?: number }) =>
    pbFetch<{ ok: true; bookings: unknown[]; meta: { count: number; hasMore: boolean } }>(
      "/api/public/booking/upcoming",
      { method: "POST", body: JSON.stringify(body) },
    ),

  cancel: (
    code: string,
    body: {
      phone?: string;
      bookingAccessToken?: string;
      reasonCode?: "customer_changed_plans" | "customer_sick" | "scheduling_conflict" | "other";
      reasonText?: string;
      clientRequestId: string;
    },
  ) =>
    pbFetch<Json>(`/api/public/booking/${encodeURIComponent(code)}/cancel`, {
      method: "POST",
      headers: { "Idempotency-Key": body.clientRequestId },
      body: JSON.stringify(body),
    }),
};

/** Map empty-slot / deny UX for the customer */
export function mapSlotDenyUx(reasonCode: string | null | undefined): {
  reasonCode: string;
  messageAr: string;
  recoverySuggestionAr: string;
} {
  // Prefer server messageAr / recoverySuggestionAr when returned by available-slots.
  // Fallback table mirrors emptySlotsUx.ts + workforceUiLabels.ts.
  const RECOVERY: Record<string, string> = {
    BRANCH_CLOSED: "اختر يومًا آخر أو فرعًا آخر",
    EMPLOYEE_OFF_DAY: "اختر يوم عمل أو موظفًا آخر",
    EMPLOYEE_ABSENT: "اختر موظفًا آخر أو يومًا لاحقًا",
    FREELANCER_NOT_PLANNED: "انتظر تسجيل حضور المستقل أو اختر موظفًا آخر",
    FREELANCER_HOURS_NOT_CONFIGURED: "راجع إعداد ساعات المستقل مع الإدارة",
    SCHEDULE_NOT_CONFIGURED: "تواصل مع الإدارة لضبط الجدول",
    SERVICE_NOT_SUPPORTED: "اختر خدمة أخرى أو موظفًا يؤدي هذه الخدمة",
    OUTSIDE_WORKING_WINDOW: "اختر وقتًا ضمن ساعات العمل",
    BLOCKED_BY_BREAK: "اختر وقتًا خارج فترة الراحة",
    BLOCKED_BY_DAILY_ADJUSTMENT: "اختر وقتًا أو يومًا آخر",
    BOOKING_CONFLICT: "اختر أقرب وقت متاح أو موظفًا آخر",
    QUEUE_CONFLICT: "اختر وقتًا لاحقًا",
    HOLD_CONFLICT: "أعد المحاولة بعد دقائق أو اختر موعدًا آخر",
    NO_CONTIGUOUS_WINDOW: "اختر خدمة أقصر أو نافذة عمل أخرى",
    MIN_NOTICE_NOT_MET: "اختر وقتًا لاحقًا",
    MAX_ADVANCE_EXCEEDED: "اختر يومًا أقرب",
    SLOT_UNAVAILABLE: "أعد تحميل المواعيد واختر وقتًا آخر",
    BRANCH_BOOKING_DISABLED: "الحجز غير متاح حاليًا — حاول لاحقًا",
  };
  const code = reasonCode || "SLOT_UNAVAILABLE";
  return {
    reasonCode: code,
    messageAr: code,
    recoverySuggestionAr: RECOVERY[code] ?? "اختر موظفًا آخر أو يومًا مختلفًا",
  };
}
```

---

## 7. Client implementation checklist

- [ ] Base URL configurable (`https://{HOST}`); no secrets in the client bundle  
- [ ] Step 1: load `/api/public/branches` and pick `branchCode`  
- [ ] Step 2: `config` + `status`; block UI when `bookingEnabled === false`  
- [ ] Step 3: render services from catalog only (price/duration from server)  
- [ ] Step 4: barbers list respects `allowSpecificBarber` / `defaultMode` from config  
- [ ] Step 5–6: days then slots from APIs; show `messageAr` / `recoverySuggestionAr` when empty  
- [ ] Step 7: `check-slot` then `plan`; store `planToken` + expiry  
- [ ] Step 8 (optional): create hold with client `holdKey`; show 5‑minute countdown; DELETE on abandon  
- [ ] Step 9: create with `planToken` + `Idempotency-Key` + customer name/phone  
- [ ] Step 10: success page via `GET /{code}` with phone or `bookingAccessToken`  
- [ ] Step 11: upcoming by phone  
- [ ] Step 12: cancel with ownership + approved `reasonCode` + idempotency  
- [ ] Handle 429 with retry-after  
- [ ] Map CORS / network failures to a single Arabic fallback message  
- [ ] Never compute slots locally; never send BranchID/price/duration overrides  

---

## 8. Gaps & notes

| Item | Detail |
|------|--------|
| Hold ↔ create | `POST /create` forwards `body.holdKey` to `createPublicBooking` (consume after commit) |
| Hold gate | Hold route skips shared rate-limit / CORS matrix |
| `BRANCH_CLOSED` vs API | Availability uses `BRANCH_CLOSED`; catalog also has `BRANCH_CLOSED_ON_WORKDATE` |
| `BRANCH_BOOKING_DISABLED` | Public **API error** code (409), not in `AVAILABILITY_REASON_CODES` list (closest: `BOOKING_TEMPORARILY_DISABLED`) |
| `SERVICE_NOT_SUPPORTED` | Availability reason; public catalog often returns `SERVICE_NOT_AVAILABLE_AT_BRANCH` / `BARBER_CANNOT_PERFORM_SERVICE` |
| Ops paths | `available-slots?source=operations\|admin` and create `source=operations\|admin` are staff-only |
| Older doc | `docs/public-booking-api.md` is outdated vs this contract (rate limits, plan token, hold, branches list) |

---

*Generated from source under `src/app/api/public/booking/**`, `src/app/api/public/branches`, `bookingHold.ts`, `emptySlotsUx.ts`, `reasonCodes.ts`, `workforceUiLabels.ts`, and related `publicBooking*` libs.*
