# DRVO Clinics — Completed Encounter → Shared POS Invoice (Agent 3)

## Product scope and outcome
- A **completed booked clinical encounter** can be handed off to the **existing Shared POS** via `/income/pos?clinicEncounterId=<uuid>`.
- The clinic's existing Booking services, patient ID and assigned practitioner are retrieved server-side. The POS form preloads exactly those services, current catalog prices, customer and practitioner; cashier still selects/reviews payment details and uses the existing POS Save action.
- A unique **one-per-encounter invoice link** is committed in the SAME POS transaction that writes `TblinvServHead`, detail lines, payments, cash moves and stock/payroll work. If link insert/validation fails, all sale data rolls back.
- Parent branch: `feature/drvo-clinics-mvp`, parent PR #90. No production deploy from agent.

## Cross-module design (Odoo-style)
- `medical-records` owns only the encounter status and `ClinicEncounterBillingLink` relation. This link is NOT an invoice, payment or financial ledger.
- `Booking` and `TblPro` own appointment services, doctor and current catalog fee.
- `POS` owns invoice creation, shift/payment validation, taxes/discounts and all financial/stock consequences. This change extends **both** the modern `apps/pos/internal/legacySaleCreateAdapter` and the legacy `lib/sales/legacyRouteSaleCreate` path, while reusing existing `POST /api/sales` and `createSale`.
- The linking contract is exported from `apps/medical-records/public/billing.ts`, used by POS server code within the current SQL transaction.

## API
- `GET /api/clinic/encounters/:uuid/billing` (medical-records entitlement): administrative billing metadata only. Returns `billingState` (`ready` / `not_ready` / `already_billed`), patient / doctor IDs, booked service IDs, names, prices, bonus, existing `invoiceId`; **no** diagnosis, clinical history or Rx data. Branch/tenant restricted on SQL joins. Cache disabled.
- `POST /api/sales` optionally accepts `clinicEncounterId` as part of the existing sale payload. The route checks medical-records entitlement, authenticated tenant and active branch. It never trusts a supplied doctor, tenant or branch.
- Both POS transaction paths lock the scoped completed encounter and ensure the same patient, booking, branch, doctor, and the exact set of booked services at their current catalog price. Extra/removed/substituted lines reject with `INVALID_ITEMS`.
- Inserting a second link violates `PK_ClinicEncounterBillingLink(TenantId,EncounterId)`. Error maps to HTTP 409 `ALREADY_BILLED` and the **entire POS transaction rolls back**. Migration missing gives a protected failure, not a new invoice in normal rollout.

## Migration and rollout safety
- **Required before enabling this code**: apply `db/drvo-migrations/014-clinic-core/schema.sql` and then **015** `db/drvo-migrations/015-clinic-billing-link/schema.sql` in staging. Migration is idempotent, creates a small link table with primary key by tenant/encounter and unique invoice index. No legacy POS schema changes.
- Do not merge to main, deploy or apply production migrations until tests, staging billing reconciliation and human approval. Parent Clinics PR #90 remains unmerged.
- If a POS invoice is later voided/deleted, the immutable billing link remains as an audit protection until an explicit documented refund/reconciliation workflow is introduced. Do **not** bypass that guard manually to rebill.
- These links only prevent duplicate **clinic-linked** invoices. Unrelated manually created POS sales remain outside this first slice.

## First release restrictions (deliberate)
- Only already **completed** booked encounters; visits without BookingRef or zero/missing/nonpositive booked services don't show an automated charge action. The existing POS can be used manually for walk-in services until an explicit walk-in billing contract is implemented.
- All booked active positive-priced service IDs must appear exactly once, billed to the assigned practitioner with current catalog price. Manual extra services or edited service list are not supported by the linked-invoice contract yet; adjust the appointment through the canonical Booking workflow before billing.
- No automatic payment capture on clinical completion, no billing inside the physician's editor. Receiving staff must use their normal cashier shift and POS payment workflow.
- No patient medical diagnosis, prescription or clinical profile is put into invoice notes.
- Global advanced security/hardening is a later phase, but baseline tenant / doctor / branch scoping is enforced in this connector.

## QA plan — MUST complete before merge
Run:
```bash
npx vitest run \
  src/apps/medical-records/__tests__/clinicBillingPolicy.test.ts \
  src/apps/medical-records/__tests__/clinicBillingLink.test.ts \
  src/apps/medical-records/__tests__/clinicBillingRoute.test.ts \
  src/apps/medical-records/__tests__/clinicBillingHandoff.test.tsx \
  src/apps/medical-records/__tests__/encounterWorkspace.test.tsx
npm run build
```
Staging: run migrations 014+015; create clinic booking with one active consultation service, check in, complete encounter, click handoff; POS prepopulates patient/doctor/services, cashier saves using open shift and real test payment. Verify:
1. Invoice head/detail/payment/cash move with expected tenant, branch, client, price and practitioner; `ClinicEncounterBillingLink.InvID` references same invoice.
2. Refresh/second browser concurrent sale attempts for same encounter: exactly **one** invoice and cash movement; other attempt receives 409. Failure must not leave orphaned stock, bonuses or shift ledger rows.
3. Non-completed/cancelled visit, foreign tenant, foreign branch, wrong patient/doctor, added or changed services/price all reject with NO financial effect.
4. Run with both modern POS port enabled and legacy path; cashier cannot bypass original shift/day gate. Test no linked invoice impact on Salon Pack.
5. Check UI errors, existing invoice state after successful sale, mobile POS, invoice printing, and next appointment.
6. Verify refund/delete behavior: link remains and repeat charge fails pending explicit reconciliation feature.

**Status on creation:** tests authored but full Vitest, Next build and live SQL/browser QA **not run in the connector environment**.
