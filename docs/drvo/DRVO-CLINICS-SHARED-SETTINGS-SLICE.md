# DRVO Clinics — Shared configuration slice

## Product scope

The **Clinic Pack** does not own a second service catalog, doctor schedule or pricing table. It composes core ERP features using existing contracts:

- **Services and pricing**: the tenant-scoped Shared Service Catalog in `TblPro`. The clinic UI at `/clinic/settings` reads the canonical `GET /api/services` response and updates a price through canonical `PUT /api/services/:id`.
- **Doctor hours and absences**: existing Workforce Availability UI at `/admin/workforce/availability`. There is intentionally no clinic-specific schedule writer.
- **Practitioner specialty/login**: the existing clinic setup at `/clinic/setup`.
- **Bookings**: the original Booking app `/bookings`.

## Changes

- New `ClinicServiceSettings`: search, show common clinic candidates based on category or name, reveal all shared services, edit a positive two-decimal price with explicit save, loading/error/success/empty states and responsive layouts.
- `clinicSharedCatalog` contains only **pure view/price validation**, no SQL or duplicated catalog ownership.
- The price update payload includes **all fields required by the existing shared PUT contract**: both names, category, bonus, existing image URL, active state. It does not overwrite service duration. New service creation and duration adjustment intentionally remain in `/admin/services` where their shared workflows already exist.
- One navigation link from clinic reception and one from practitioner/patient setup to `/clinic/settings`.
- No migrations or changes to shared APIs, shared service storage, or production.

## Notes and caveats

- Suggested clinic services are **a UI name/category heuristic only**, not an authoritative specialty/service classification. Users can uncheck the filter to inspect all services. Formal clinic-service tagging is a separate cross-module architecture task.
- This change does **not** add per-doctor working-hour editing in clinic. The link goes to the single shared Workforce source of truth, which also handles shifts/availability for other packs.
- The generic shared service API permissions remain the canonical access authority; a complete role-based permissions review is separately deferred. Existing session/tenant checks are not bypassed.
- PR is stacked on **Clinics MVP #90** (currently unmerged). Agents must not merge, run migrations in production or deploy.

## Targeted QA

```bash
npx vitest run src/apps/medical-records/__tests__/clinicSharedCatalog.test.ts src/apps/medical-records/__tests__/clinicServiceSettings.test.tsx
npm run build
```

Staging smoke: clinic → settings → load tenant price list → modify consultation price → verify identical price in Shared Services and Booking/POS catalog → verify original image/name/category/bonus/duration unchanged → empty and failed updates → doctor hours link. Cross-tenant negative test before any merge.

Next implementation: doctor-specific daily worklist built on existing clinic appointment adapter, followed by clinical encounter/Rx design.
