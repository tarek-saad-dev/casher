# CUT CLUB 2.0 — Client + Cashier Production Schema & Operational Gate (#306)

**Read-only diagnostic implementation, Draft only.** Owner previously approved Production DB as a source of truth, but ChatGPT's active connected tools provide GitHub code access, NOT a SQL Server connection. No production DB query, customer record access, migration, Coins/voucher write, merge or deployment took place.

## Newly implemented

- **Admin readiness UI**: `/admin/cut-club-readiness`. Authenticated admin only. Always displays final customer/cashier release as NOT READY, with clear blocking integration work.
- **Metadata-only diagnostic API**: `GET /api/admin/cut-club/readiness`, requires `requireAdmin()`, disabled unless `CUT_CLUB_PRODUCTION_METADATA_READ_ENABLED=true` AND operator-provided `CUT_CLUB_METADATA_EXPECTED_DB`. Performs `DB_NAME()` equality guard then reads SQL Server `sys.tables/sys.schemas/sys.columns` only. No customer, voucher, phone, sales or payment rows read. Returns missing table/column names to admins, no database credentials or PII.
- **Actual schema check contract**: `TblClient`, `TblClientInventory`, `TblLoyaltyStoreItem`, `TblinvServHead`, `TblinvServDetail`, `TblInventoryUsageLog`. Includes voucher status, quantity, invoice client and branch, free-service line price, and usage log columns.
- **POS privacy correction**: old staff `GET /api/pos/client-inventory` and `GET /api/pos/client-inventory-by-phone` now require an operable staff member, an explicitly operator-reviewed Tenant UUID + BranchID -> legacy SalonID mapping, and apply `SalonID` scope **inside** the underlying inventory SELECT. Existing service remains backward-compatible for other callers via optional trusted salon filter. Private wildcard CORS removed.
- **Financial protection**: new cashier voucher use refuses multi-quantity inventory (to prevent marking an entire pack USED on the first service), records the legacy usage log columns including explicit NULL `BookingID`, and clears stale invoice input when a different voucher is scanned. The same-invoice-only replay, owner/branch/invoice check and transactional ACTIVE-status update from Draft #303 remain.
- **CI**: new synthetic read-only metadata/source and POS-branch tests; existing integrated Casher #305 tests + Next production build. No tests access live SQL.

## Operational manual steps after human approval

1. Confirm the actual Production SQL connection configured for the Casher app. Provide `CUT_CLUB_METADATA_EXPECTED_DB` from independently verified source; do not assume repo default/fallback.
2. Admin may temporarily enable `CUT_CLUB_PRODUCTION_METADATA_READ_ENABLED=true` to inspect only **metadata** with a least-privilege SQL user. Do not grant DDL/DML just to inspect.
3. Confirm each mapping in `CUT_CLUB_POS_LEGACY_SALON_MAP_JSON` from business data: the Tenant UUID, active BranchID and older `TblLoyaltyStoreItem.SalonID` reference. A valid JSON shape alone is **NOT proof** of correctness or account ownership.
4. Run independently reviewed multi-customer/two-branch synthetic fixtures in an isolated/staging database to verify active-used, expiry, same-invoice replay, stock/balance ledger, chargeback/reversal and staff role eligibility.
5. Wire real verified WhatsApp OTP through approved provider and server-origin session/Cookie/BFF; never present an existing customer's wallet or voucher codes on phone-only lookups.
6. Build authorized customer Wallet HTTP read endpoints, server-verified code reveal and customer-facing /club flow; current website #67 is **UI only**, not a live account.
7. Implement actual discount, product and non-free-service invoice ledger settlement, including Mystery Box, then reconciliation/refunds.
8. Dry-run public guest booking for Gleem and Camp Shizar, office POS, barcode scanner/tablet and network failure scenarios; verify no vouchers are burned before the invoiced benefit.
9. Independent security/UX review, deploy + rollback rehearsals and **explicit owner approval on exact head** before merging/releasing a coordinated website+Casher bundle.

## Exact interpretation

`schemaCompatible=true` means *only* all expected columns were present in the selected database. It explicitly does **NOT** certify TenantId/ClientID binding, branch↔SalonID mapping, financial settlement, WhatsApp OTP security, actual inventory, or customer/cashier release readiness. The API always returns `readyForClientRelease=false` and `readyForCashierRedemption=false` until an independently implemented release gate supplies evidence.

**Current result: NO-GO.** No Production SQL executed or customers affected.
