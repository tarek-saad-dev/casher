# DRVO-009 Phase A audit

Audit before POS sale Treasury posting cutover. Cash directions match `scripts/audit-branches/_insCashMoveSales.sql`. The live trigger shape is the later set-based body in `db/migrations/add-financial-branch-ownership.sql`, which copies `BranchID` and `BusinessDayID`. Migration 008 keeps that shape and adds the Treasury skip.

## 1. Trigger definition(s)

| Trigger | Table | Timing | Sale types handled |
| --- | --- | --- | --- |
| `InsCashMoveSales` | `TblinvServHead` | AFTER INSERT | `مبيعات`, `مبيعات بالكارت`, `م.مبيعات`, `م.مبيعات بالكارت` |

Guard (migration 008): each INSERT branch skips when a Treasury-owned sale CashMove already exists for the same `invID` + `invType` (`TreasuryMovementRegistry.Kind = 'sale'`).

## 2. TblCashMove fields populated by trigger for `N'مبيعات'`

| Field | Source |
| --- | --- |
| invID | inserted head invID |
| invType | inserted head invType |
| invDate | inserted head invDate |
| invTime | inserted head invTime |
| ClientID | inserted head ClientID |
| GrandTolal | inserted head GrandTotal |
| inOut | `'in'` |
| Notes | inserted head invNotes |
| ShiftMoveID | inserted head ShiftMoveID |
| PaymentMethodID | inserted head PaymentMethodID |
| BranchID | inserted head BranchID |
| BusinessDayID | inserted head BusinessDayID |

`TblCashMove.BranchID` is NOT NULL. The trigger skips a head with NULL `BranchID` and otherwise copies branch and business day from the sale head. Treasury sale posting sets the same fields.

## 3. Treasury insert shape (non-sale vs sale)

Non-sale (`insertCashMoveRow`): allocates a new `TblCashMove.invID` via `allocateInvID`, maps reason to `ايرادات` / `مصروفات`.

Sale (`postSaleCashMove`): uses the **sale invoice invID**, `invType = N'مبيعات'`, `inOut = in`, registry `Kind = sale`. No income/expense mapping.

## 4. POS create transaction order (extracted path)

`createSale` → `executeLegacySaleCreateTransaction`:

1. `lockOperationalWrite`
2. `allocateInvID` on `TblinvServHead` / `مبيعات`
3. *(DRVO-009 when enabled)* `postSaleCashMove` for that invID
4. INSERT `TblinvServHead` → trigger skips when Treasury row exists
5. INSERT details, stock decrement, payments
6. Split: `redistributeFromClearing`
7. Target recalc enqueue
8. COMMIT → loyalty + WhatsApp post-commit

## 5. Split-payment sequence

Header uses clearing `PaymentMethodID`. Trigger (or Treasury) creates one initial `in` CashMove on clearing. `redistributeFromClearing` posts expense/income transfer pair rows per real method. Unchanged in this release.

## 6. Report / reconciliation assumptions

Sale CashMove rows are identified by `invID` + `invType = N'مبيعات'` (+ payment method for split redistribution). Treasury registry `Kind = sale` marks DRVO-owned initial rows only.

## 7. Other paths creating `TblinvServHead` with `invType = N'مبيعات'`

| Path | Treasury pre-post |
| --- | --- |
| DRVO POS `POST /api/sales` | When `pos-sale-treasury` rollout extracted |
| Legacy in-route create | Trigger only |
| External / legacy clients | Trigger only |
| Booking convert | `invType = خدمة` — no sale CashMove |

## 8. FK / constraint: invoice head before CashMove?

No FK from `TblCashMove` to `TblinvServHead` on `invID`. Treasury may post CashMove before head INSERT inside the same transaction.

## 9. Update / delete CashMove behavior

Out of scope for DRVO-009 primary cutover. Update/delete remain on `legacySaleRepository` / `invoiceActions` legacy CashMove SQL seam.

## 10. Duplicate-history incident

Application + trigger double-insert was fixed (see `FIX_APPLIED_CASHMOVE_DUPLICATE.md`). DRVO-009 guard prevents Treasury + trigger double-post when both paths are active.
