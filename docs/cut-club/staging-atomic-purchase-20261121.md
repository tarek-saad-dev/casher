# CUT CLUB — purchase transaction / staging acceptance (2026-11-21)

## Release scope
This is an **isolated STAGING-only checkout candidate** built on the current CUT CLUB member OTP session. It adapts the older #301 engine, whose old `customerAuthFlow` is NOT the production auth path. No customer-facing checkout is enabled and no production SQL write is authorized.

### Candidate routes
`POST /api/public/cut-club/rewards/purchase` is BFF-key protected; no clientId, phone, branch ID, price or stock input is accepted from the browser. Input is exactly:
`{ "itemId": 15, "idempotencyKey": "<random 20–64 alphanumeric_- token>" }`.
The key must be generated once per user confirmation and REUSED for all retries. A user can't choose clientId or price. The trusted operator selects one staging-approved branch using environment configuration. GET and OPTIONS are forbidden.

### Production safety
1. `CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED` defaults OFF. Enabled in production **is still insufficient**.
2. BEFORE session lookup, the underlying SQL pool must report **DB_NAME() = last132_agent**, **SUSER_SNAME() = drvo_agent**, and a real `CutClubRewardCommand` table.
3. The exact transaction connection rechecks the same three facts AFTER beginning a SERIALIZABLE transaction, before ANY write.
4. Only tenant UUID `413d433e-f36b-1410-8820-009ec495c7e1` with `CASHER_BOOT` code is accepted by the pilot.
5. `CUT_CLUB_STAGING_REWARD_BRANCH_ID` must be present, and `CUT_CLUB_STAGING_REWARD_APPROVED_BRANCHES_JSON` must explicitly include `tenant-uuid:branch-id`. The DB also verifies a real CUT Salon branch name; demo/PH1G branches are excluded. All of this is server-side.
6. The verified OTP session must resolve to `ACTIVE`, tenant-match and an actual `LegacyClientID`. `REVIEW_REQUIRED`, `UNLINKED`, `SUSPENDED`, stale and invalid sessions cannot spend.
7. Only approved global FREE_SERVICE store item IDs 15→service 39, 16→22, 17→11, 18→9 are eligible. The item must be active with `ServiceID` matching and active tenant-owned `TblPro`. Null/mismatched ServiceID fails closed. The existing production NULL ServiceIDs must NOT be silently corrected or backfilled.

### One atomic SQL Server transaction
- Acquire tenant/customer `sp_getapplock` Transaction scope.
- Query durable idempotency receipt with UPDLOCK/HOLDLOCK; if same key+item, return exactly same receipt; if same key+different item, reject.
- Lock one active loyalty row and authoritative owner; verify customer TenantId, tier, real Coins and service eligibility.
- Reserve one stock unit conditionally.
- Debit Coins with `PointsBalance>=price` condition and correct tenant-owned customer.
- Insert one negative ledger entry and one unpredictable single-use owned voucher.
- Insert one immutable `CutClubRewardCommand` with unique `(TenantId,CustomerId,IdempotencyKey)`.
- COMMIT only if every statement succeeds. Otherwise SQL transaction rollback restores balance/stock/ledger/voucher together. The route returns no internal SQL details.

The voucher uses the same `TblClientInventory` fields and `CUT-...` code format required by the staged POS invoice voucher claim in Casher Draft #320. This PR does **not** merge Draft #320 or create a public customer purchase UI.

### Schema setup
Review `docs/cut-club/sql/reward-command-staging-v2.sql` manually in a test SQL environment. It rejects any DB except `last132_agent` and any SQL login except `drvo_agent`. It is intentionally **not registered as a production migration**. Confirm staging is isolated and approval has been given before executing. Never run this script against `last132`.

### Remaining acceptance BEFORE production authorization
- [ ] Real SQL Server fixture with staging-only session + loyalty + stocked services, then run two separate concurrent connections buying one available stock unit using one key and distinct keys.
- [ ] Verify precise before/after Coins, stock, one voucher, one ledger and one command. Repeat key returns identical receipt. Failure injected after balance update rolls back ALL writes.
- [ ] Confirm cross-tenant and cross-branch rejection. Confirm NULL ServiceID, expired session, suspended account and duplicate legacy phone review cannot spend.
- [ ] Install and test invoice/voucher transaction PR #320 on isolated staging. Purchase voucher, use it on one matching saved invoice; concurrent redemption only once. Cancel invoice: reverse claim and restore voucher **atomically**, preserving the Coins purchase ledger.
- [ ] Reconcile historic 14 ACTIVE / 60 USED vouchers before live changes; do not synthesize invoices for old used vouchers.
- [ ] Add reviewed production migration for command+claim tables and business policy rollout, backup/restore test, owner financial signoff, rollout flags and per-customer monitoring.
- [ ] Add website checkout BFF with CSRF/origin, UX confirmation and same-key retry, AFTER all financial validation. Current `/club/rewards` stays read-only.

**This branch never edits production balances, inventory, invoices, or SQL schema.**
