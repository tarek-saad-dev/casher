# DRVO-017 — Onboarding, Operator Console & Tenant Shell

Branch: `drvo-017-onboarding-console-tenant-shell` (stacked on `drvo-013-authoritative-tenant-context`) · Migration **11**
`tenant-brand-profile`.

## Status

| Gate | Result |
| --- | --- |
| Code + unit/contract tests | done |
| Build | see PR |
| Runtime staging proof (`last132_agent`) | **PENDING** — no staging credentials on the implementation machine |
| First-sale proof | **PENDING DRVO-015** — master-data tenancy is not merged on this base; not faked here |

Staging proof command (staging only; never reads `.env.local`):

```bash
DRVO_STAGING_DB_PASSWORD=... npx tsx scripts/drvo/drvo-017-onboarding-smoke.ts
```

The script hard-stops unless `DB_NAME() = last132_agent` and `SUSER_SNAME() = drvo_agent`, and removes its
`DRVO017_*` tenant before and after the run. Scenarios: migration 11 verify + CASHER_BOOT brand seed, operator creates a
non-salon (supermarket) tenant, first branch usable, owner login path (credentials → default branch → tenant context →
`admin` role with pages), user limit, suspend blocks, reactivate restores, cleanup.

## Migration 11 — `TenantBrandProfile`

`db/drvo-migrations/011-tenant-brand-profile/schema.sql` · checksum (LF-normalized sha256)
`0ee043c4260234d091457160dfc50953ee88f5da9eee4967162d4e25192210f1`.

- One row per tenant: `DisplayName`, `LogoUrl`, `Phone`, `Address`, `PrimaryColor`, `AccentColor`, `ReceiptFooter`,
  `Timezone`, `PublicBookingOrigins` (JSON array), `Revision`, audit columns. Check constraints on non-empty name and
  timezone, logo URL scheme, `#RRGGBB` colors, origins JSON and revision.
- CASHER_BOOT is seeded with the current CUT output (`Cut Salon`, `/cutsalon.png`, phones, Arabic subtitle line,
  colors, footer) so receipts render the same from data.
- Every other existing tenant is backfilled from its own `Tenant.Name` / `DefaultTimezone` — never CUT values.
- Adds the `/admin/tenant` page (`هوية المنشأة`) granted to the `admin` role.
- **Migration id 10 is reserved** for DRVO-015 (master-data tenancy). `DRVO_RESERVED_MIGRATION_IDS` lets 11 ship before
  10; the contiguity check skips reserved ids only.

## Onboarding fixes

- First branch is created `IsActive = 1`, `LifecycleStatus = INTERNAL_LIVE` (audited), with `PublicBookingEnabled = 0`
  and `ExternalNotificationsEnabled = 0`. Public booking and messaging tenancy are out of scope.
- Owner gets the tenant `admin` role — never `super_admin` (page roles are global; super_admin is platform staff).
  A missing `admin` role fails onboarding with `OWNER_ROLE_MISSING` instead of creating an owner who sees nothing.
- `assertCanAddBranch` / `assertCanAddUser` run inside the onboarding transaction before each insert.
- `QueueBookingSettings` is seeded only when the composition includes `booking` or `queue`.
- A brand row is written in the same transaction. `industryPackCode` is now required (`PACK_REQUIRED`) — onboarding has
  no default industry. `ownerUserLevel`, `ownerRole`, `roles` are rejected from the request body.
- Readiness adds `has_usable_branch`, `owner_admin_role`, `owner_can_login`, `brand_profile`.

## Operator console (`/platform`)

Server layout guarded by `requirePlatformOperator` (super_admin + CASHER_BOOT membership). Pages: tenant list, create
tenant (pack, app toggles with required apps locked, plan/status, owner, first branch, optional brand), tenant detail
(subscription actions with confirmation + `expectedRevision`, plan change, readiness, install/uninstall/apply pack,
branches, members, brand). CASHER_BOOT mutations are disabled in the UI and rejected by the services.

APIs: `GET /api/admin/platform/tenants/[tenantId]`, `PUT /api/admin/platform/tenants/[tenantId]/brand`.

## Permissions hardening

- `/api/admin/permissions/seed` and `/migrate` are platform-operator only (were tenant `requireAdmin`).
- Global role / page editors (`permissions/users`, `pages`, `debug-access`) require a platform operator, not just a
  `super_admin` role inside some tenant.

## Tenant shell

- `GET /api/tenant/context` (`authenticateTenantShell`: session + tenant, **not** subscription-gated so a blocked tenant
  can see why) returns brand, installed apps, subscription state.
- `GET/PUT /api/tenant/brand` (tenant admin; tenant from session; body `tenantId`/`revision` rejected; optimistic
  `expectedRevision`).
- `TenantShellProvider` + `TenantShellGate`: subscription banner (trial ≤ 7 days, past due, cancelled-until-period-end),
  full-screen blocked state for inactive subscriptions, "app not installed" state for gated routes.
- `navAppGating.ts` hides nav entries for apps the tenant does not have. This is UI only; the server gate remains
  `requireTenantApp()` per API. CASHER_BOOT has every app installed, so CUT navigation is unchanged.
- MainNav / root layout: logo, title and club label come from the tenant brand; no hardcoded CUT branding.
- `/admin/tenant`: brand settings, subscription summary, installed apps (read-only).

## Print branding

Receipts, tickets and PDFs read the tenant brand (`toPrintBrand` / `toPrintBrandHtml`, HTML-escaped for string-built
documents) via the client brand store or, on server pages, `getTenantBrandProfileCached(session.TenantId)`.

Known differences / limits:

- Queue ticket subtitle now prints the brand `Address` line (`صالون كت للرجال`) instead of the old literal
  `صالون كَت للحلاقة`.
- Receipt ornaments (scissors glyphs, layout) are still barber-styled; only text identity is tenant-driven.

## Not in scope (unchanged)

- Self-service signup, payment provider, public booking page, messaging tenancy, master-data tenancy, password hashing.
- CUT strings remain in: login page, messaging/WhatsApp templates and test strings, public booking, booking-settings
  defaults, AI concierge prompts. These belong to the out-of-scope surfaces above.
- `PublicBookingOrigins` is stored and validated only; nothing consumes it yet.
- Routes that call only `getSession()` (login, `/api/operations/bootstrap`) are not subscription-gated by design: a
  suspended tenant's users reach the shell and see the blocked screen, while gated APIs answer 403.
