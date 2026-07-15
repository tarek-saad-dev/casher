# Employee Target — Invoice Sync Audit (Phase 5)

**Date:** 2026-07-15  
**KPI reader:** `getEmployeesNetServiceSalesByDate` → `TblinvServHead` + `TblinvServDetail` where `invType = N'مبيعات'`.

---

## 1. Routes / services that change employee-services sales

| # | Path | Service | Tables / columns | TX? |
|---|------|---------|------------------|-----|
| 1 | `POST /api/sales` | `src/app/api/sales/route.ts` | INSERT Head (`invDate`, SubTotal, GrandTotal, DisVal…) + Detail (EmpID, Qty, SPrice, SValue, DisVal…) | Yes SERIALIZABLE |
| 2 | `PUT /api/sales/[id]` | `updateInvoice` via `executeAuditedAction` | DELETE+reINSERT Details; UPDATE Head amounts (**not invDate**) | Yes SERIALIZABLE |
| 3 | `DELETE /api/sales/[id]` | `deleteInvoice` via `executeAuditedAction` | DELETE CashMove/Loyalty/Detail/Payment/Head | Yes SERIALIZABLE |
| 4 | `PATCH /api/reports/employee-services/reassign` | route only | UPDATE Detail.EmpID | **No TX today** → wrap in Phase 5 |

**Out of KPI scope (no enqueue):** booking convert (`invType=خدمة`), incomes/cash APIs, loyalty reverse (ledger only).

---

## 2. Columns that move the KPI

**Header:** `invDate`, `SubTotal`, `GrandTotal`, `DisVal` (header discount allocation).  
**Detail:** `EmpID`, `ProID`, `Qty`, `SPrice`, `SValue`, `DisVal`.  
**Not filtered:** `isActive` (not used by report/target).  
**Returns/cancels:** other `invType` values are excluded — no special target rule beyond shared core.

---

## 3. Affected EmpID / WorkDate rules

Any service-sale mutation → `Set<(EmpID, WorkDate)>` = union of **before** and **after** snapshots.

Because header discount allocates across the invoice (`GrandTotal × eligibleGross/SubTotal`), Phase 5 always includes **all EmpIDs on the invoice** for each affected `invDate` (not only the edited line).

**Create:** all detail EmpIDs × new `invDate`.  
**Update:** union EmpIDs × work date (app does not change `invDate` today; still ready if it does).  
**Delete:** EmpIDs + `invDate` from **pre-delete** snapshot.  
**Reassign:** `{oldEmp, newEmp}` × invoice `invDate` (and all other EmpIDs on that invoice if discount share changes — always include all detail EmpIDs on that inv).

---

## 4. Risks

1. No existing outbox/job queue — need durable `TblEmpTargetRecalcRequest`.
2. Reassign currently autocommit — must add TX for enqueue durability.
3. Edit path omits line `DisVal` on reinsert — can change KPI independently; enqueue still required.
4. Post-commit WhatsApp/loyalty must stay outside durable enqueue.
5. Processing must not share TX with invoice mutations.
6. Legacy monthly target unchanged — double-count risk deferred.

---

## 5. Files planned

**Add:** migration + runner, recalc enqueue/process/scope services, recalc APIs, process script, tests, this audit.  
**Modify:** `sensitiveActionAudit` (`beforeCommit`), sales POST/PUT/DELETE, reassign PATCH, daily-target query + merge types, DailyPayrollPanel, details dialog (optional sync badge), `index.ts` exports.
