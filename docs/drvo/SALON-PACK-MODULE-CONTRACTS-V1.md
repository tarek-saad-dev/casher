# Salon module contracts — Phase B, slice 1

Baseline: `main@784c5501d424bec942597fd516d55bb47fa1868a` (2026-10-26). Agent 2 implementation. This document supplements `DRVO-002-BOUNDARY-CONTRACTS.md` and `SALON-PACK-AGENT2-ARCHITECTURE-AUDIT.md`; it does not replace them.

## Contract rules enforced by this slice

1. **Booking is not POS.** `src/apps/booking/application/convertBooking.ts` depends on `BookingConversionPort` from `src/contracts/bookingConversion.ts`. A POS-owned adapter implements it in `src/apps/pos/internal/legacyBookingConversionAdapter.ts`. Booking must not import `src/apps/pos/internal` or the POS SQL tables directly.
2. **Atomic booking conversion.** `convertBooking` opens one `withUnitOfWork`; calendar context, invoice creation, marking `ConvertedInv` and transactional outbox must all use the same transaction. The POS adapter must **not** create a second transaction. Replays return the previously linked invoice.
3. **Queue doesn't own employee identity, customer masters or occupancy.** Public queue contracts expose Customers, Catalog, Workforce occupancy and Operational Calendar, with a transactional outbox callback. Queue implementation may temporarily call legacy composition adapters while port extraction continues.
4. **POS-Treasury handoff uses a typed port in the composition root.** `src/lib/posSaleTreasuryComposition.ts` constructs the cash-posting callback consumed by POS. `src/apps/pos/application/createSale.ts` performs invoice and posting in the *same* SQL transaction when `isPosSaleTreasuryPostingEnabled()`. The legacy trigger coexistence must be reviewed before enabling the new posting mode.
5. **Treasury owns money movements.** `src/apps/treasury/application/createIncome.ts` receives a shared transaction and checks tenant-owned category and payment method before posting. Treasury cannot close the shared Operational Calendar behind its port (#148 remains open).
6. **Platform owns business identity and outbox.** The Salon Pack is only a recipe. Event publication is in the same shared unit of work, without relying on WhatsApp. Tenant/branch and entitlement guards must be verified in actual API routes, not inferred merely from type declarations.

## Compatibility rule

Contract changes add or adapt a versioned port at a composition root; never ask Booking to import POS internals, nor Queue to directly mutate invoices, nor Treasury to mutate `TblNewDay` as an alternate close path.

## P0/P1 unresolved

- **P0:** Treasury direct business-day close bypasses calendar and pending-queue/open-shift invariants, issue #148. Dedicated transactional fix + staging proof, not silently implemented here.
- **P1:** Conversion invoice type `خدمة` does not match the legacy sale cash posting trigger rules. Need business decision whether conversion is *unpaid service invoice* or *paid sale*, then implement only the required Treasury posting, atomically. Do not assume zero cash movement is a defect before agreeing payment semantics.
- **P1:** Enabled POS/Treasury posting flag and legacy trigger coexistence requires controlled staging checks (no duplicate cash posting).
- **P1:** Hard install-time dependency registry currently encodes `purchasing → inventory` only. That is intentional; calendar/occupancy/cash posting are shared infrastructure, not necessarily separately installable modules. Prove minimal pack runs without POS and payroll.
- **P1:** `closeReadiness` manager UI is informational, not an approved financial close; #145 review separately.

## Stage B acceptance criteria

- Contract tests enforce names, import boundaries, shared transaction threading and publish semantics.
- Fixture-free unit verification succeeds in CI.
- Core owner reviews shared port changes; POS/Treasury owner reviews payment posting semantics.
- Before declaring **Stage B Done**, add fresh-tenant cross-module staging proof (Booking→POS→Treasury + Queue), tenant isolation, business-day guard and module disable/re-enable behavior.

**Current status:** Stage B **In progress** (boundary tests and decision log only). No production change, no merge by agent.
