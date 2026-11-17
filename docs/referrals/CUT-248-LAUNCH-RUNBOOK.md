# CUT Salon referral 50/20 + invoice idempotency — staged launch runbook

**Status: DRAFT / NOT APPROVED.** This is an operator checklist, not an authorization. Applicable only to the combined source tree in PR [#248](https://github.com/tarek-saad-dev/casher/pull/248). PR #245 is an overlapping, unmerged dependency and must not be merged as a second independent release.

## Release contracts (do not relax)

- Offer: qualifying **first** paid referred visit = **50%** off eligible service; subsequent paid referrer purchase may redeem one earned **20%** voucher. A referrer's permanent code activates only after a fully paid qualifying visit.
- Financial consistency: invoice header + detail + payment allocations + cash/treasury and stock effects + referral claim/voucher + `TblPosSaleRequest` must commit or roll back atomically; replay of a committed UUID must not post again.
- Full refund of referred sale reverses its claim but **preserves already-earned 20% voucher** per approved current business rule; refund of a voucher-paid sale restores that **same** voucher (not a new reward).
- Same sale UUID must be bound to **tenant, cashier, branch and original request hash**. A changed payload or refunded invoice must never create a new sale under its old UUID.
- Persistent paid booking handoff marker is attached to the original invoice; a failed handoff-link step must be repaired against that **existing** invoice, not charged a second time.
- Cross-tenant and branch ownership checks, ability to reject unowned payment methods, and original staffed-session constraints remain fail-closed.
- WhatsApp, payment gateways, and cash drawers/printers must not be triggered by staging smoke scripts.

## Release decision board (all required)

| Gate | Acceptance evidence | Decision |
| --- | --- | --- |
| Exact candidate SHA | PR #248 head equals tested CI/staging head; PR mergeable; #245 not separately merged | PENDING |
| Code | CI succeeds all jobs, incl. `npm run build`, financial/referral/security tests, bookings/print regressions | PENDING for final SHA |
| Staging | `DRVO Staging Gate` COMPLETE SUCCESS, incl. DRVO-023/024, genuine signed HTTP 50/20/replay/refunds, subscription reconcile, DRVO-011/012, final verify and both-writer DRVO-008 paid smoke | PENDING |
| Cash proof | Independent reviewer checks price, one payment, split-payment, clearing, stock and cash ledgers for both writers; rollback/cleanup evidence retained | PENDING |
| Security proof | Independent reviewer checks cross-tenant/client/user/branch payment/voucher authorization, negative cases and concurrent races | PENDING |
| Production database | Authorized read-only PLAN, exact SHA/manifest digest, migration history and unexpected migrations investigated | PENDING |
| Backups / rollback | Operator records verified backup ID and restore evidence, monitoring owner and no-destructive-table rollback procedure | PENDING |
| Operations | Manager and cashier sign off on mobile/desktop, short scripts for unknown save outcomes and referral reversal decisions | PENDING |
| Explicit approvals | Named finance/security/operations sign-offs plus separate human schema APPLY approval and release approval | PENDING |

**No entry may be marked PASS by the code author merely because CI succeeded.** Store the run URL, timestamp, exact SHA, reviewer name and a redacted evidence reference for each human sign-off.

## Preparation — safe to do without production writes

1. Freeze a final **40-character commit SHA** from PR #248. Validate that the PR contains #245 code so the two overlapping PRs are not deployed separately.
2. Confirm all feature flags **OFF** at the current runtime: `POS_REFERRAL_CHECKOUT_ENABLED`, `POS_REFERRAL_REDEEM_ENABLED`, `POS_REFERRAL_REVERSAL_ENABLED`, `POS_SALE_IDEMPOTENCY_ENABLED`, `NEXT_PUBLIC_POS_SALE_IDEMPOTENCY_ENABLED`. Browser flag is build-time; coordinate rebuild and clients.
3. Collect complete exact-head CI/staging run IDs. In staging verify real SQL reads from `last132_agent` using `drvo_agent` and proper cleanup of disposable tenant/client/UUID/payment rows.
4. Run the independently approved **read-only production migration PLAN only** through the preexisting gated command, with appropriately read-only credentials in the trusted control plane (never paste credentials in GitHub or chat):

```sh
SOURCE_COMMIT_SHA=<APPROVED_40_CHAR_SHA> npm run drvo:migration-control -- --mode=plan --approved-sha=<APPROVED_40_CHAR_SHA>
```

`plan` is designed to **read applied history** and report manifest digest, pending/unknown migrations. It is not `apply` and is not a green light to run `drvo:migrate-production`. Stop if any unexpected migration, checksum discrepancy, DB identity mismatch, required migration beyond reviewed DRVO-023/024, or permission problem is found.
5. Finance checks 50% first-visit and 20% reward math at actual catalog prices, cash count and split payments (incl. balancing clearing), staff bonus/commission, redeemed liability, refunds, and stock. Security checks cashier/session/tenant/branch/client constraints, cross-tenant payment methods, 401/403/404 negative paths, same UUID and distinct UUID races. Operations checks UI and latest training.
6. Record backup ID, production restore procedure and responsible operator. Schedule a rollback window. Review planned transition of DB schema and **both** client/server idempotency flags **together**; never enable either side in isolation, because that intentionally fails closed.

## Human-controlled execution (requires separate explicit approvals)

1. Obtain signed finance, security, operations and release approval on the **frozen candidate** and approved production migration plan.
2. Authorized DB operator — not this draft or CI — applies only the approved migrations following the project production-migration-control approval, immutable manifest and backup preconditions. No direct ad hoc SQL, broad updates or rollback of reward tables.
3. Build/deploy the exact reviewed SHA with referral flags still **OFF**. Verify health, session auth, booking/cashier sale, and reporting. Validate schema/state before enabling anything.
4. Enable matching **server and rebuilt browser** UUID idempotency flags together in a limited session; test one normal paid sale, same-UUID retry and a non-referral refund; confirm no duplicate invoice or ledger entries.
5. Start **one salon branch / limited trained staff**, then enable referral checkout + reward redemption + refund-reversal flags together after the accounting gate. Use named internal test customers and real catalog amounts with agreed financial handling. Confirm two branch-based daily reconciliations before expanding.
6. Expand gradually to the other branch only after verified daily gross/net, vouchers issued/redeemed/refunded, duplicate UUID attempts and customer support cases. Track sign-off by the branch manager and finance owner.

## Incident policy — preserve financial evidence

- **Unknown response after paid POST:** do not press Save again as a new sale; search the invoice ledger and retry with **same** UUID if supported. Never issue a fresh UUID for the same uncertain payment until reconciled.
- **Handoff link failed but paid:** open existing invoice and use `reconcile` action; do not generate an additional invoice. Preserve the original payment.
- **Financial mismatch or duplicate:** disable the **business referral flags** and stop the trial; record invoice IDs, request keys (not payload PII), timestamps and runbook incident reference; reconcile balances before reopening.
- **Client/server UUID mismatch:** stop accepting new transactions on affected clients; coordinate client rebuild/flag change as a unit. Do not randomly switch only one side.
- **Migration incident:** take verified backup forward-fix path approved by DBA; never drop referral, idempotency, finance or audit tables or delete issued vouchers as a rollback.
- **After launch:** reconciliation owner signs an end-of-shift report for invoice totals, payment rows, cash, stock, active/used vouchers and UUID conflicts. Set explicit incident thresholds/contacts before the trial.

## Links

- [PR #248](https://github.com/tarek-saad-dev/casher/pull/248)
- `docs/referrals/RELEASE-ACCEPTANCE-248.md`
- `docs/referrals/POS-IDEMPOTENCY-246.md`
- `docs/referrals/CUT-248-INDEPENDENT-REVIEW.md`
- `scripts/drvo/production-migration-control.ts` (PLAN is read-only; APPLY has separate explicit approvals)
