# DRVO-008 Phase A audit

Audit of sale behavior on this branch before the rollback split. Ownership changes in this PR are the POS boundary and the legacy/extracted create gate. Statement behavior below is what the current code does.

## HTTP entry points

| Entry | Owner | Notes |
| --- | --- | --- |
| `POST /api/sales` | Route validates, then `isPosPortEnabled()` | Flag on: `createSale`. Flag off: `createSaleLegacyFromRoute` (in-route SERIALIZABLE copy). |
| `GET /api/sales/[id]` | Route | Print/read shape stays in the route. Branch ownership is non-disclosing 404. |
| `PUT /api/sales/[id]` | Route + audited action | Flag on: `updateSale` / `getSaleSnapshot` (`legacySaleRepository`). Flag off: `updateInvoice` / `getInvoiceSnapshot` in `src/lib/actions/invoiceActions.ts`, the pre-extraction copy. |
| `DELETE /api/sales/[id]` | Route + audited action | Same flag split. Flag off calls `deleteInvoice` in `invoiceActions.ts`. Reason is required. |
| `GET /api/sales/recent`, `recent-invoices`, `today`, `more` | Route | Read queries. Not moved. |
| `POST /api/bookings/[id]/convert` | Booking public `convertBooking` | Service invoice is still `legacyBookingConversionAdapter` (`invType = خدمة`). |

## Create transaction

One `SERIALIZABLE` transaction. `lockOperationalWrite` then `allocateInvID` on `TblinvServHead` / `مبيعات`. Header, details, stock decrement, payment rows, then `InsCashMoveSales` for the initial CashMove. Split payments call `redistributeFromClearing` in that transaction. Employee-target enqueue is in the same transaction (`invoice_create`). Commit, then loyalty `sp_Loyalty_EarnPointsFromSale` and WhatsApp run after commit.

## Update / delete

Update and delete run inside `executeAuditedAction`. Update reverses stock, replaces details and payments, deletes prior CashMove and loyalty ledger rows for the invoice, rewrites CashMove, and re-applies stock. Delete reverses stock, then deletes CashMove, loyalty ledger, details, payments, and the header. Target enqueue uses `invoice_update` / `invoice_delete` before commit. Loyalty earn on update runs after commit in the route.

## Other invariants

- Branch, business day, and shift come from the server gate. The route does not trust a browser branch id.
- Customer id is the payload `clientId`. Create does not call Customers `upsertByPhone`.
- Line money is recomputed with `computeInvoiceItemsTotals`.
- Employee ids on create are checked against the active branch before the transaction.
- Catalog rows are stored as `ProID` snapshots on the detail. Names are read later for print and WhatsApp.
- Booking conversion stays POS-owned, `خدمة`, no sale CashMove insert in the adapter, and still shares the caller transaction.
- Sale create does not call Treasury `MoneyMovement`.

## Rollout

`pos` is in `DRVO_MODULE_ROLLOUT` with `rollout: legacy`, `POS_SCHEDULING_PORT`, and `DRVO_FORCE_POS_PATH`. Normal activation is a later Git change of `rollout`. This extraction does not turn the extracted path on.
