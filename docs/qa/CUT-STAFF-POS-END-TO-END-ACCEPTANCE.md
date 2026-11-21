# CUT STAFF → POS — End-to-End Release Acceptance

**Owner:** CUT Salon / Casher  
**Baseline:** `main` includes #250, #254 and paid-handoff repair #253 (`a2c8b640`).  
**Status:** NOT SIGNED OFF — automation is not a substitute for testing the actual employee and cashier devices.  
**Security:** never record customer names, phones, session cookies or production payment details in GitHub evidence.

## Scope and evidence policy

This is the last acceptance gate for the **already deployed** staff-to-POS workflow. Treat **#248** (new-sale UUID idempotency plus 50/20 referral stack) as a **different release**, still Draft; do not assume that its new-sale duplicate protection is live merely because #253 paid-invoice handoff repair is live.

Use **synthetic customers/bookings** in dedicated staging, with two real browser sessions and two mobile/desktop devices. Staging SQL write/sale/refund/race scenarios must never run on the production tenant. On production, verify navigation and read-only states only; a supervisor must separately authorize any live checkout. Never retry an uncertain real payment before looking for the original paid invoice.

### Preconditions

- [ ] Record tested commit SHA, exact staging deployment URL, branch, build time and test operator.
- [ ] Staging-only tenant, synthetic two customers, two employees and cashier with valid branch permissions.
- [ ] Open valid business day/shift; verify branch ownership and employee assignment.
- [ ] Create a baseline appointment with one service, and a second appointment to produce a tight next-slot conflict.
- [ ] Prepare a low-priced additional service and another employee with genuine availability.
- [ ] Verify existing SQL staging checks: `scripts/drvo/salon-booking-e2e-staging.ts` and `scripts/drvo/salon-handoff-recovery-staging.ts`; preserve full GitHub Actions run URLs.
- [ ] Confirm the original invoice query/financial ledger can be checked by the authorized tester, without direct writes or deleting shared records.

## Device matrix

| Device / browser | Account | Area | Result | Evidence |
| --- | --- | --- | --- | --- |
| Android phone / installed PWA | Assigned employee A | CUT STAFF booking list, lifecycle and handoff | PENDING | |
| Second Android phone or desktop browser | Assigned employee B | Availability and transferred extra service | PENDING | |
| POS desktop / cashier | Authorized cashier in same branch | Transfer inbox, paid sale, recovery inbox | PENDING | |
| POS narrow/mobile viewport | Authorized cashier | Invoice and transfer controls | PENDING | |
| Separate-session browser | Other branch/tenant role | Access-control negatives | PENDING | |

## Acceptance scenarios

For each row record **PASS / FAIL / BLOCKED**, timestamp, expected vs actual, sanitized screenshot or CI link, and invoice/booking synthetic IDs. A visible success message alone is not financial evidence.

| ID | Scenario — perform in staging | Must be observed | Result |
| --- | --- | --- | --- |
| UAT-01 | Employee views today's assigned booking | Correct branch/customer/service and **arrival** action; no other employee's private bookings | PENDING |
| UAT-02 | Confirm arrival → start → finish | Only valid state transitions; can't finish before start, and POS cannot charge unfinished handoff | PENDING |
| UAT-03 | Add service when free time is sufficient | Booking end and booked service quantities update atomically; public/ops occupancy reflects extension | PENDING |
| UAT-04 | Add service that conflicts with the next reservation | No added service, no partial extension; available-alternative preview is **not** a reservation | PENDING |
| UAT-05 | Employee requests alternate barber for conflicting extra | Cashier receives one pending request; original booking and initial barber remain unchanged | PENDING |
| UAT-06 | Cashier assigns the extra to available employee B | Only extra line owned by B; lock rechecks real occupancy and blocks a simultaneous conflicting approval | PENDING |
| UAT-07 | Reject/cancel/retry transfer | No ghost reservation, duplicate extra or stale pending handoff; rejected transfers stay uncharged | PENDING |
| UAT-08 | Staff submits finished booking to POS | Handoff includes only booked services, with actual executing employee per line | PENDING |
| UAT-09 | POS loads/charges handoff with original + transferred service | ONE paid invoice; both line employees correct for commission; total, discount, and payments match | PENDING |
| UAT-10 | Induce **staging-only** failure after paid sale but before booking link | Warning tells cashier **not to collect again**; recovery inbox identifies original paid invoice | PENDING |
| UAT-11 | Repair same paid invoice from cashier recovery inbox | Existing `invID` reused; booking/handoff become completed/charged; no new invoice, CashMove or payment row | PENDING |
| UAT-12 | Repeat recovery action / refresh / second cashier | Idempotent same link; no second invoice or money movement | PENDING |
| UAT-13 | Try unpaid invoice, wrong customer, service qty, performer, branch or tenant | All refused, no modified booking or invoice | PENDING |
| UAT-14 | Close shift/reopen page after an ambiguous paid sale | Explain/locate original invoice before new checkout; no silent second charge | PENDING |
| UAT-15 | Repeat all relevant UI workflows in narrow viewport and Android PWA | Accessible confirmations, recoverable errors, loading and zero accidental double-click charges | PENDING |
| UAT-16 | Repeat crucial cases near branch business-day cutoff / overnight shift | Correct operational date, assigned barber and next booking restrictions | PENDING |

## Financial proof (staging only)

Capture **before and after** counts and totals for the exact synthetic invoice, scoped by tenant, branch and `invID + invType`:

- `TblinvServHead`: **one** paid header with expected client, branch, total and the durable `CUT_HANDOFF:<id>|` marker.
- `TblinvServDetail`: booked quantities and **actual** `EmpID` for each serviced line; no unintended product line.
- `TblinvServPayment` and `TblCashMove`: exactly the expected payment and cash entries; sums unchanged after reconciliation/retry.
- `Bookings` + `TblBookingCashierHandoff`: both point to **the same existing invoice** and are completed/charged after repair.
- Product stock, employee bonus/commission and referral/wallet data: unaffected by **repair** (repair must not re-run sale logic).
- Verify cleanup of **all** synthetic data, no orphaned transfers, handoffs, outbox notifications or reservations.

For #248 **separate release**, add HTTP same-UUID simultaneous POST across two cashier sessions; changed payload → 409; refund → replay rejected; both extracted/legacy writers; DRVO-023/024 migrations, 50/20 accounting, product stock, mixed tender, and financial/security sign-off. Those checks are **not implied** by a successful #253 acceptance.

## Release decision

| Gate | Evidence / sign-off |
| --- | --- |
| Existing CI tests on exact current `main` head | PENDING |
| Isolated staging SQL booking, conflict and paid-invoice recovery | PENDING |
| Android PWA and POS desktop/mobile matrix | PENDING |
| Financial counts and zero duplicate charge | PENDING |
| Branch/tenant negative authorization | PENDING |
| Operations reviewer / time / branch | PENDING |
| Finance reviewer / evidence link | PENDING |
| Independent security reviewer (required for #248) | PENDING |

**Go:** all mandatory current-release rows PASS, evidence linked, no unresolved duplicate-charge risk, operator explicitly signs off.  
**No-go:** any extra invoice, second payment, cross-branch action, wrong performing barber, unrecoverable ambiguous save, or missing staging cleanup. Block rollout, document affected synthetic IDs and triage before repeating.

## Observation log

| Date (Cairo) | Commit | UAT IDs | Device / branch | Result | Issue / screenshot / run |
| --- | --- | --- | --- | --- | --- |
| _Not run_ | `a2c8b640` baseline | — | — | PENDING | |

> This page defines acceptance. It does **not** claim that physical devices, staging money flows, or live checkout have been tested by editing this file.
