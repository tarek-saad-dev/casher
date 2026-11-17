# CUT CLUB — verified WhatsApp customer binding / tenant-owned Wallet authority (#310)

This builds on [Casher Draft #309](https://github.com/tarek-saad-dev/casher/pull/309): WhatsApp OTP delivery candidate + #307 metadata/cashier, #305 voucher privacy and #301 financial settlement. **All code is Draft; none is a live customer auth HTTP route.**

## Exact source-of-truth assumptions (must validate against Production metadata before release)
- `dbo.TblClient`: `ClientID` INT, `TenantId` UUID, `Mobile` phone.
- `dbo.TblClientLoyalty`: `ClientID` and `IsActive` to determine if an existing loyalty account may sign in.
- This product currently targets Egyptian numbers only (`010/011/012/015`) converted to `+20` E.164. Other countries fail closed until normalized and verified by a reviewed method.

## What was implemented
- `sqlCustomerAuthority.ts`: an injected SQL ConnectionPool authority, with **no pool creation on import, no public HTTP route or financial writes**.
- `proveOwnedCustomer({tenantId, customerId})` selects only ClientID with parameterized exact TenantId/ClientID filter and requires one record. Intended to back the Wallet owner proof, voucher proof and financial access gate.
- `resolveByVerifiedWhatsAppPhone({trustedTenantId, verifiedPhoneE164})` selects only ClientID, TenantId and whether an active loyalty account exists. It matches stored local, +20 E.164 or 20-without-plus form, but accepts only a verified E.164 number after a single-use durable OTP. No Name/Mobile/Coins/voucher data returned.
- Duplicate/shared phone matches are **not auto-picked**: existing `bindVerifiedCustomer()` rejects ambiguous accounts, inactive membership or cross-tenant results before a session exists. A corrupt/foreign row fails closed, not filtered into a false unique match.
- The operator-only **metadata** check (#307) now inspects the loyalty, tier, ledger and Mobile columns in addition to voucher/invoice compatibility. This is not a query against production until separately executed by an authorized operator.
- Fake SQL tests check wrong tenant/duplicate/inactive, E.164 normalization, safe SQL parameters, no PII and no DB on invalid input. Mandatory CI.

## Remaining hard blockers
1. Actual Production DB metadata inspection and authoritative tenant/customer/branch mapping; owner approved Production DB as source but this GitHub-only execution cannot connect.
2. Durable SQL OTP challenge/session schema **applied and verified by an authorized DB operator**. Candidate in previous drafts is staging-only and intentionally refuses Production DB.
3. Approved WhatsApp sender/channel and opt-in/retention review, double activation gate (default OFF).
4. Public server routes after OTP: request code → verify single-use → bind exactly one active customer → revocable opaque session; host-only HttpOnly cookie on Website BFF and strict same-origin CSRF. Never expose clientId as auth.
5. Wire customer Wallet, voucher-code reveal, logout/account recovery and cashier invoice settlement to the same verified ownership source.
6. Real SQL staging 2-account/2-tenant/2-branch concurrency, ledger reconciliation and complete cashier/free-service/discount/refund/box tests. Existing customer booking remains available.
7. Production rollback and explicit exact-head owner go/no-go.

**NO-GO: code-readiness only. No SQL query or mutation on Production DB, WhatsApp message, HTTP customer login, merge or deployment occurred.**

## VPS read-only evidence — 2026-11-17

A human operator executed a read-only metadata query on server `srv1921542` at `/home/casher/app` (deployed `main` commit `bc9c03ff`). Output reported:

- Runtime: Node 22.23.2, npm 10.9.8. `casher`, `nginx`, `mssql-server`, `messaging-worker`, `messaging-inbox-worker` reported active. Local port 1433 reported listening.
- `https://ops.cutsaloon.com/login` and `https://cutsaloon.com/`: HTTP 200; `https://cutsaloon.com/club`: HTTP 404 (private member site not deployed).
- Operator script selected **local** DB mode and connected to database **`last132`** (not the staging-only `last132_agent` name assumed in reviewed SQL draft scripts).
- The nine core legacy table checks reported `OK` for the selected required column subsets: `TblClient`, `TblClientLoyalty`, `TblLoyaltyTier`, `TblLoyaltyPointLedger`, `TblClientInventory`, `TblLoyaltyStoreItem`, `TblinvServHead`, `TblinvServDetail`, `TblInventoryUsageLog`.
- `Tenant` columns: TenantId, Code, Name, Status, DefaultTimezone, CreatedAt, UpdatedAt.
- `Location` columns: LocationId, TenantId, LegacyBranchId, BranchCode, Timezone, Status, CreatedAt.
- `LegacyIdMap` columns: TenantId, EntityName, LegacyKey, DrvoId, CreatedAt.

**Evidence limit:** This demonstrates schema presence on the inspected `last132` SQL connection, not customer/branch ownership semantics, proof that the running service uses that database for every route, or actual transaction behavior. No raw customer rows, secrets, wallet balances or voucher data were supplied. Actual tenant/location/legacy `SalonID` relationships and safe authentication/ledger transactional tests are still necessary. The candidate migration scripts **MUST NOT** be run against `last132` without an independently approved production-safe migration and rollback plan. All CUT CLUB flags remain OFF, and no merge/deploy occurred.

### Next operator read-only inspection
Inspect the non-personal `Tenant.Code/Status`, `Location.BranchCode/LegacyBranchId/Status`, the distinct legacy reward `SalonID` values, and the `LegacyIdMap.EntityName` categories. Do not query client phone/name or Wallet records in a chat-pasted output. Compare these IDs with existing POS branch/SalonID contract before configuring a trusted mapping.
