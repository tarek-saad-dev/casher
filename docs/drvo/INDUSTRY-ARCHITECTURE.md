# DRVOERP Industry Architecture

Status: V1 contract — 2026-10

## Goal

DRVOERP is one business operating system. Industries are composed from shared capabilities; they are not code forks.

Adding a new industry should normally require:

1. one source-controlled Industry Pack,
2. optional industry-specific extension app only for genuinely industry-specific data,
3. tests proving composition, tenancy and boundaries.

It must not require copying Booking, POS, Workforce, Treasury, Reports or onboarding code.

## Layers

### 1. Platform Core

Tenant, identity/auth, memberships, RBAC, locations, subscription/commercial state, installed apps, config, events/outbox, audit and security.

This layer never knows what a salon, clinic or supermarket is.

### 2. Shared Domains

- Party / Customer
- Catalog
- Workforce
- Operational Calendar
- Money / payment foundations

Industry terminology is presentation only: Customer can be shown as Client, Patient or Customer without changing the underlying tenant-scoped identity.

### 3. Installable Apps

Booking, Queue, POS, Inventory, Purchasing, Attendance, Payroll, Treasury, Messaging, AI Receptionist and Reports.

Apps expose generic contracts. Industry Packs select/configure apps; they do not duplicate them.

### 4. Industry Pack

A source-controlled recipe containing:

- required / recommended / optional apps,
- shared-surface composition,
- catalog kind,
- industry terminology,
- staff job options,
- jobs that can receive bookings,
- onboarding defaults,
- public-signup metadata,
- optional safe demo preset.

Pack code must not contain transactional business logic that belongs to a shared app.

### 5. Industry Extension App

Create an extension app only when the data cannot honestly live in a shared domain.

Example: Clinic clinical records.

A future `clinical-records` app owns encounters, clinical notes, diagnoses, prescriptions, allergies, vitals and medical attachments. It references shared Patient/Customer and Booking identifiers but never stores those records inside generic customer or booking tables.

## Current Packs

### Salon

Shared apps: Booking, Queue, POS, Workforce/Attendance, Payroll, Treasury, Reports.
Optional Inventory/Purchasing, Messaging and AI.

### Clinic

Shared apps: Booking, Queue, POS, Workforce/Attendance, Payroll, Treasury, Reports.
Optional Inventory/Purchasing, Messaging and AI.

Terminology:
- Customer -> Patient
- Bookable provider -> Doctor / Dentist
- Catalog service -> Consultation / Procedure
- Location -> Clinic / Branch

Clinical records are explicitly outside the V1 Pack.

### Supermarket

Shared apps: POS, Inventory, Purchasing, Treasury, Reports.
Optional Attendance, Payroll and Messaging.
No Booking requirement.

## Non-negotiable rules

1. No `SalonBooking`, `ClinicBooking` or duplicated vertical POS/HR modules.
2. No new tenant-global table without TenantId or a proven branch/location ownership join.
3. No public signup industry switch scattered through UI/services. The pack registry is authoritative.
4. No plan logic inside Industry Packs. Plans control commercial capacity/state; packs control composition.
5. No CUT/DRVOWA channel inheritance by new tenants.
6. Public booking and external messaging are never auto-enabled by onboarding/signup.
7. Industry-specific sensitive data stays in its own extension app and permission boundary.
8. Legacy domain names such as "barber" may remain as compatibility routes temporarily, but new policy must use generic provider semantics underneath.
9. Every new Pack must pass composition, onboarding, signup and tenant-isolation tests before release.
10. An industry must be removable/addable without changing Platform Core.

## Next architecture seams

- Introduce a generic Provider facade over legacy Barber naming while preserving old API aliases for CUT.
- Introduce neutral Catalog/Party UI labels sourced from the active Pack.
- Add an extension-app registry for vertical modules such as `clinical-records`.
- Keep cross-app integration event-driven where possible: booking -> sale -> treasury/reporting rather than vertical imports.
- Add a reusable Pack contract test suite so future Gym / Workshop / Restaurant packs get the same architecture gates automatically.

## Definition of a healthy new industry

A new industry is healthy when its first working tenant can be created by registering a Pack, without copying an existing vertical folder and without modifying core tenant/auth/subscription code.
