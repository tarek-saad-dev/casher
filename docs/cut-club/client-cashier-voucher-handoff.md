# CUT CLUB 2.0 — client voucher proof handed to cashier (#304)

Purpose: a customer sees their **real owned** voucher code in a verified private CUT CLUB Wallet; cashier scans it and can confirm eligible invoice-linked use once. Same source of truth: dbo.TblClientInventory.

## What is built
- clientVoucherHandoff.ts: strictly server-only private voucher proof retrieval. Requires a durable, revocable customer session issued after verified identity and authoritative tenant/client ownership, then retrieves only this client's inventoryId. Rejects used, cancelled, expired and malformed records. Returns no customer ID, tenant ID or phone in client-facing DTO.
- sqlOwnedVoucherSource.ts: read-only SQL adapter with explicit pool injection and repeated TblClient.TenantId + inventory ClientID ownership predicate; no public endpoint, no database on import.
- Synthetic negative/replay/privacy tests in CI. Voucher code is only returned to a **future trusted BFF** in a no-store TLS response, never via URL, localStorage, app analytics or public lookup.
- Cashier companion Draft #303: staff tenant/branch-scoped code lookup, invoice-matched narrow FREE_SERVICE settlement. All cashier flags default OFF.

## Cannot switch on yet
1. Identity / WhatsApp one-time-code delivery (explicitly deferred), durable customer session installed and cookie in site origin; no phone-only bypass.
2. Actual production schema verification and mapping of TenantId, ClientID, SalonID, BranchID, especially cross-branch redemption policy.
3. Private BFF website endpoint that verifies session, scopes every SQL read, adds HttpOnly same-origin cookie/CSRF/no-store and never includes owner-selected IDs.
4. Connected verified Wallet UI with explicit Show Voucher Code control and expiry/used state refresh. The existing preview is synthetic.
5. Cashier real SQL staging, staff trial, POS invoice integration for discounts/other reward types, voucher reversal and payments.
6. Full security/staging E2E tests with two customer accounts and two branches; independent signoff, VPS rollback and explicit release authorization.

**DRAFT, no merge, no production DB access, no client data/Coins/voucher mutation.**
