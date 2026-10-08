# DRVO-019 — Public booking tenancy and hosted `/book/[branchCode]`

## Tenant resolution
- Every public booking route resolves its tenant from the request through
  `src/lib/booking/publicBookingTenancy.ts` (wired in routes by
  `requirePublicBookingRouteTenancy` / `requirePublicBookingCodeTenancy` in `publicBookingRouteGate.ts`).
- `branchCode` → active `TblBranch` → active `Location` → `Tenant`. No env default tenant.
- Booking-code routes (lookup / cancel) take the tenant from the booking's own branch.
- Booking is an optional app: a tenant without `booking` installed (or with a blocked
  subscription) answers exactly like an unknown branch (404 `BRANCH_NOT_FOUND` /
  `BOOKING_NOT_FOUND`). The hosted page calls `notFound()`.

## CUT (CASHER_BOOT) compatibility
- Named seam `public-booking-cut-compat` (`legacyBootstrapSeam.ts`, pinned in drvo013StaticGuards).
- Used only when **branchCode is absent**, the route historically allowed that (barbers,
  barber profile/location/calendar/availability, upcoming-by-phone, v2 bootstrap/availability,
  `/api/public/branches`), **and** the request has no `Origin` or one of the legacy
  `PUBLIC_BOOKING_ALLOWED_ORIGINS`. Any other origin must send `branchCode`.
- Branch-scoped routes (config, services, status, slots/days, check-slot, plan, create) always
  require `branchCode`. cutsaloon.com already sends it there, so its behaviour is unchanged.

## Data scoping
- Catalogue (`TblPro`/`TblCat`), staff (`TblEmp`), clients (`TblClient`) and package queries carry
  `TenantId = @tenantId`. `Bookings` is scoped via `tenantLocationBranchSql` (the tenant's active Locations).
- Branch context, services, availability, bootstrap and cross-branch caches are keyed by tenant + branch.
- create / check-slot / plan pass `expectedTenantId`, so another tenant's branch, service or
  employee is rejected. Hold also verifies that the employee belongs to the tenant.
- upcoming-by-phone pre-gates with `lookupClientIdByPhone(tenantId, phone)`.

## CORS
- Responses use the bound tenant's `TenantBrandProfile.PublicBookingOrigins`. CASHER_BOOT also
  keeps the env allowlist. Preflight admits the union of the env allowlist and active tenants'
  origins (it returns no tenant data). `*` is never used.

## Hosted page
- `src/app/book/[branchCode]/page.tsx` (server, async `params`) + `HostedBookingFlow.tsx`
  (client, Arabic/RTL, tenant brand name, logo and colours). Flow: service → slot → customer
  details → confirm. It uses the same public APIs, same-origin.
- `/book/` was added to the proxy anonymous allowlist. `AuthLayout` renders it without the staff shell.

## Verification
- Unit tests: `drvo019PublicBookingTenancy.test.ts` (two tenants, mocked DB) and `drvo019StaticGuards.test.ts`.
- Staging smoke: `npm run drvo-019:smoke` (staging only; refuses `last132`; needs `DRVO_STAGING_DB_PASSWORD`).
- No DB migrations.
