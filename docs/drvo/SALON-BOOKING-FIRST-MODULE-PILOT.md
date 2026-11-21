# Salon Booking — first modular extraction pilot

Status: CONTRACT BASELINE (not standalone production acceptance).

## Goal
Reuse the existing booking behavior, do **not** fork/copy the cashier booking engine. Existing booking API and Cut Salon must continue to work throughout extraction.

## Existing implementation seams (verified on main)
- `src/apps/booking/public/ports.ts` defines `BookingSchedulingPorts`.
- `src/apps/booking/internal/schedulingPortAdapter.ts` adapts the public ports to legacy scheduling flows.
- `src/lib/booking/publicBookingCreate.ts` performs transactional public booking creation.
- `scripts/drvo/salon-booking-e2e-staging.ts` verifies a disposable salon lifecycle.

## Owned capabilities
Service/barber/date selection; availability; plan/slot claims; booking creation; idempotent retries; reschedule and cancel; booking state and occupancy consistency; public booking restrictions; booking notifications dispatched after commit.

## External dependencies, NOT Booking-owned
- Platform: derived tenant/branch identity and authorization; SaaS installation/entitlements.
- Shared Customers: customer upsert and lookup via port.
- Workforce: barber availability and occupancy locks.
- Catalog: bookable service details.
- Operational Calendar: business dates and schedules.
- POS/Queue: conversion and handoff contracts.
- Outbox/Messaging: durable post-commit side effects.

## Pilot acceptance matrix
| Check | Definition of done | Current evidence |
| --- | --- | --- |
| Existing CUT behavior | All regression tests pass; no change to public routes | NOT VERIFIED |
| Independent salon | Disposable tenant service/barber/slot/booking flow | Prior staging body passed; workflow exit requires rerun (#125) |
| Idempotency | Same client request does not duplicate booking | Prior staging proof; green workflow pending |
| Lifecycle | Reschedule/cancel preserve ownership and releases | Prior staging proof; green workflow pending |
| Isolation | Distinct tenant/branch cannot read/write another's bookings | Requires explicit two-tenant SQL acceptance |
| Feature parity | Every legacy booking route, setting, integration and report mapped | NOT COMPLETE — inventory required |
| Composition | booking installs without POS/payroll; optional integrations degrade safely | Requires executable composition acceptance |

## Extraction sequence
1. Inventory booking routes, jobs, settings, data and callers with file evidence.
2. Freeze existing behavior via regression tests and staging acceptance.
3. Route legacy scheduling through published ports while preserving atomic writes.
4. Add two-tenant isolation acceptance and verify optional Queue/POS disabled.
5. Only then mark Booking modular extraction READY; never infer success from manifest alone.

## Non-goals
No production deployment, schema migration, automatic merge, new duplicated Booking implementation or unrelated refactor.

## Other capabilities
Full Casher inventory must also discover loyalty, memberships, rewards, gift cards, marketing, and all other actual functionality from source. This booking pilot does not declare overall Salon Pack feature completeness.
