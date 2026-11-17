# CUT-248 — independent finance, security and operations review

**Status: NOT SIGNED OFF.** This document is an evidence worksheet. It is intentionally not an automated PASS, external review, release approval, or production permission.

**Candidate SHA:** _record after exact-head CI/staging success_  
**Code PR:** [#248](https://github.com/tarek-saad-dev/casher/pull/248)  
**Scope:** stacked #248 includes #245 referral service and POS sale idempotency. Never merge/deploy both overlapping drafts independently.

## Automated proof already available (not independent approval)

Evidence is scoped to the exact source version and run, not all future commits:
- [CI #43548360501](https://github.com/tarek-saad-dev/casher/actions/runs/43548360501), SHA `b429905945ea9c35889962483fdc87d16f27b138`: completed **SUCCESS**, 3 jobs.
- [Staging #43548360467](https://github.com/tarek-saad-dev/casher/actions/runs/43548360467), same SHA: earlier SQL 023/024, finance read-only audit and transaction 50/20 both-writer **PASS**; full HTTP/verification/both-writer final outcome must be captured after completion.
- [Staging #43540923413](https://github.com/tarek-saad-dev/casher/actions/runs/43540923413): authenticated HTTP 50/20, refund/replay, DRVO-012/011 and final verify **PASS** on older SHA; overall FAIL due to old DRVO-008 manifest assumption. Do not mix evidence from different SHAs to claim full gate success.
- [Staging #43545221692](https://github.com/tarek-saad-dev/casher/actions/runs/43545221692): authenticated HTTP **PASS**, but overall FAIL on `Missing TenantMembership for UserID 170` at DRVO verification. The read-committed membership check has been updated on later head. Still require full verification.
- Every database in these staging jobs must be `last132_agent/drvo_agent`, and disposable invoices/customers/UUIDs must be purged or rolled back; there is **no production validation** here.

## Accounting: exact operations, SQL counts, expectations

Independent finance reviewer: **TBD** / evidence link: **TBD** / decision: **PENDING**.

| Scenario | Expected accounting outcome | Reviewer evidence | Result |
| --- | --- | --- | --- |
| Full-price qualifying source | Code activated only after invoice fully paid; one header, detail, payment and correct employee attribution | SQL invoice ID, payment sum, cash ledger | Pending |
| 50% referred first visit | 200 price → 100 due/paid; exactly one APPLIED claim and one ACTIVE 20% voucher. No extra promotional discount or retail stock | Header, payment, cashier CashMove, referral rows, stock | Pending |
| 20% voucher redemption | 200 price → 160 due/paid; exactly one USED voucher and one paid invoice; one voucher cannot be double-spent | Voucher ID, payment and cash sum | Pending |
| Split allocation | Example 60+40=100 or 80+80=160, using **two tenant-owned methods**, with clearing net zero; verify no duplicate CashMove | Allocation row method IDs and amounts, clearing ledger | Pending |
| Replay and uncertain network response | Same tenant/cashier/branch/UUID/payload → HTTP 200 old invoice; **no** second header/payment/stock/cash/reward/handoff | Before/after SQL snapshots, request ledger | Pending |
| Different UUIDs, same referred first visit | At most one 50% first-visit claim; losing transaction has no orphan payment/voucher/claim | Concurrent transaction log, error and counts | Pending |
| Refund source sale after voucher earned | Original claim REVERSED; already-issued 20% voucher remains under approved business rule | Refunded invoice audit and voucher row | Pending |
| Refund redeemed voucher sale | The **same** voucher returns ACTIVE; refund cash/stock matches and no new voucher minted | Audit id, voucher original ID, cash reversal | Pending |
| Employee commissions, tax, liability | Net revenue and staff bonus reconcile on actual discounted amount per accountant-approved rule | Account report, net/gross comparison | Pending |
| Unexpected failures and cleanup | Transaction rollback leaves no synthetic invoice, cash, stock, UUID, claim or voucher; no production tenant touched | SQL before/after dataset, staging run output | Pending |

**Do not accept merely a green CI job** as cash reconciliation; reviewer must inspect the exact money/stock rows. Reference only synthetic IDs in links and redact customer PII.

## Security review

Independent reviewer: **TBD** / evidence link: **TBD** / decision: **PENDING**.

- [ ] Staff session and tenant ownership enforced for preview, wallet, sale and refund. Anonymous wallet denied; deprecated unauthenticated referral endpoint returns 410.
- [ ] Tenant mismatched customer, voucher, code, owned catalog item and **payment method** respond 403/404/409 as appropriate; no data leak through timing/error specificity.
- [ ] Cross-branch and transferred barber active business-day scheduling verified; no bypass of branch/shift gate. Only replay of **previously committed** identical request may return before shift checks.
- [ ] Same UUID binds tenant/user/branch, complete JSON payload digest; change of amount, service, payment, customer, voucher, handoff or notes causes 409 with no new writes.
- [ ] Concurrent identical UUIDs serialize to one COMMITTED invoice; different UUIDs for same new customer cannot both claim 50%, and a voucher cannot be redeemed twice.
- [ ] Failed/refunded original invoice cannot be recreated by UUID replay; no notification or booking handoff side effect is repeated.
- [ ] Controlled flags default OFF, fail closed with client/server mismatch, secrets and migration credentials never shipped in browser or logs.
- [ ] Confirm sign-off against *actual final commit*, not an earlier green run.

## Operations review

Manager/branch operator: **TBD** / evidence link: **TBD** / decision: **PENDING**.

- [ ] Mobile and desktop cashier sees accurate first-visit eligibility, wallet balance, 20% redemption, payment allocations and receipt.
- [ ] One-branch test with trained cashier and manager; no uncontrolled discount for repeat customers.
- [ ] Clear workflow: uncertain save → check invoice and retry same UUID; handoff already paid → reconcile existing invoice; refund → require reason and audit.
- [ ] Printer, cash desk, nightly closing, branch switch and offline network incident checked after exact client/server flags coordinated.
- [ ] Backup reference, runtime flag owners, rollback contacts, monitoring and daily reconciliation agreed.

## Sign-off record (must be completed by independent named humans)

| Role | Reviewer | Date (UTC) | Exact candidate SHA | Evidence URL | Decision |
| --- | --- | --- | --- | --- | --- |
| Finance/accounting | PENDING | — | — | — | NOT APPROVED |
| Security | PENDING | — | — | — | NOT APPROVED |
| Cut Salon operations | PENDING | — | — | — | NOT APPROVED |
| DBA / authorized backup and schema PLAN | PENDING | — | — | — | NOT APPROVED |
| Release owner / human approval | PENDING | — | — | — | NOT APPROVED |

**No programmatic tool may fill a human approval here.** See `CUT-248-LAUNCH-RUNBOOK.md` for safe staged rollout and incident response.
