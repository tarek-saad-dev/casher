# CUT CLUB — stage-only cashier voucher claim integration

**DRAFT, does not authorize production use.** Based on audited staging implementation developed in #320 but ported as narrow changes onto current Casher main. The production customer wallet and historical balances stay untouched.

## New sale
- POS staff sees voucher input only if the server GET `/api/pos/cut-club/staging-mode` confirms active staff authorization, approved branch, feature flag and exactly `last132_agent` SQL login `drvo_agent` with staging claim table.
- A voucher code is carried through `/api/sales` to both legacy and extracted POS sale paths. Old sales without a voucher are unchanged and cause no extra SQL queries.
- Inside the SAME SQL transaction before invoice COMMIT, validate: tenant/customer/branch, approved 15→39 /16→22 /17→11 /18→9 service, same tenant active TblPro, uniquely owned ACTIVE unexpired one-unit voucher, matching saved invoice/client/branch and one positive-original-price service line with a zero-final-price benefit.
- Claim unique `APPLIED` `(tenant,inventory)` and `(tenant,branch,invoice,service)`, mark voucher USED and insert immutable usage record, or roll back the WHOLE invoice and all payments.

## Cancellation
- Edit in place of a claimed invoice is forbidden. Staff must cancel and issue new invoice.
- DELETE invoice in existing audited transaction first restores the exact voucher and marks claim REVERSED; both changes commit/rollback with the invoice deletion.
- Retain old usage history and purchase Coins ledger. Cancellation restores *voucher eligibility*, not purchased Coins (purchase itself is not cancelled automatically).

## Stage schema
`docs/cut-club/sql/cashier-invoice-claim-staging-only.sql` runs only when `DB_NAME()=last132_agent` and `SUSER_SNAME()=drvo_agent`. **Never execute on last132 or merge this Draft directly.** A trusted operator must validate staging, obtain backup, and run isolated POS E2E including payment ledger, editing/return workflow, and two simultaneous voucher scans.

## To finish full purchase ↔ redeem workflow
1. Review independent staging purchase PR #331. Its owned voucher code `CUT-[40 uppercase hex]` and `TblClientInventory` record are compatible with this claim.
2. Add disposable real SQL claim fixture using actual sale head/detail and inventory tables. Purchase through #331 on same isolated fixture, use this branch's claim with a signed-in cashier's authorized branch, prove one invoice only and strict price/owner matches; reverse on cancel and prove exact restoration.
3. Resolve dual-PR branch compatibility and consolidate on main only after finance/security review. Both staged flags default OFF, both SQL context guards reject production.
4. New production migration and controlled PLAN/APPLY, explicit owner signoff and monitored rollout are separate work. DO NOT direct-enable staging flag on production.
