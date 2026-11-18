# CUT CLUB Staging — database preparation gate (18 Nov 2026)

**State:** Preparation only; no migration or fixture DML performed by this change. All SQL below is read-only. Production `last132` is NO-GO.

## Exact order of operations

1. In the isolated **staging** SQL connection, assert `DB_NAME()='last132_agent'` and `SUSER_SNAME()='drvo_agent'`; stop on mismatch. Do not reuse the production Casher checkout or production credentials.
2. A DBA reviews the guarded, non-idempotent migration in `docs/cut-club/sql/cashier-invoice-claim-staging-only.sql`, snapshots staging, checks DDL permissions, then explicitly applies it to **last132_agent only**. Never apply on `last132`.
3. Run the existing read-only preflight. It now requires the two filtered unique APPLIED indexes and exactly one active tenant-scoped service for each ID 9/11/22/39. Missing ID information is printed without customer data.
4. If services are missing, **do not copy production client data or guess required TblPro columns**. A staging DBA should use the read-only schema and row-reference discovery below to prepare *synthetic* test service rows with the tenant, branch, catalog and mandatory field values matching the isolated staging schema. Fixture inserts must be independently reviewed before execution. Do not overwrite an existing ProID or modify existing customer sales.
5. Independently provision one synthetic test client and ACTIVE `FREE_SERVICE` voucher for approved ItemID 17 / ProID 11, unexpired, Quantity=1, global SalonID NULL, linked to the synthetic customer. Use a unique clearly synthetic code. Keep old 14 ACTIVE + 60 USED production vouchers untouched.
6. After metadata readiness and staging-app isolation are confirmed, enable opt-in claim writing **only in the isolated staging app**, perform the live SQL E2E acceptance matrix in `staging-atomic-cashier-runbook-2026-11-18.md`, and capture redacted SQL assertions. Shut the flag off after tests and reconcile active claims before teardown.

## Read-only discovery (staging SQL session)

```sql
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 52180, 'CUT CLUB: staging identity mismatch', 1;

DECLARE @tenant UNIQUEIDENTIFIER='413d433e-f36b-1410-8820-009ec495c7e1';
SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName;
SELECT name AS ColumnName, TYPE_NAME(user_type_id) AS SqlType,
       max_length AS MaxLength, is_nullable AS Nullable,
       is_identity AS IdentityColumn
FROM sys.columns
WHERE object_id=OBJECT_ID(N'dbo.TblPro')
ORDER BY column_id;

SELECT ProID, COUNT_BIG(*) AS ActiveCount
FROM dbo.TblPro
WHERE TenantId=@tenant AND isDeleted=0 AND ProID IN (9,11,22,39)
GROUP BY ProID ORDER BY ProID;

SELECT i.name AS IndexName, i.is_unique AS IsUnique,
       i.filter_definition AS FilterDefinition
FROM sys.indexes AS i
WHERE i.object_id=OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim')
ORDER BY i.name;
```

## Evidence to attach to Draft PR #320

- Staging DB/login identity (redact host and credentials), migration reviewer and staging snapshot identifier.
- Claim table and **both unique filtered** APPLIED indexes present.
- Four service IDs present, active, and unique for approved tenant; list missing IDs if NO-GO.
- Synthetic voucher and client existence (IDs may be redacted), no real PII.
- Happy path, denial cases, concurrent claims, uncertain-response retry, cancellation, reissue, and invariant checks for invoice, usage log, voucher status and payment.
- Final check: feature flags OFF, production untouched, PR remains Draft/unmerged.

**Go/no-go:** CI and read-only metadata checks do not prove a successful real SQL transaction. Do not merge/deploy pending independent security review and actual staging acceptance.


## Live findings — 18 Nov 2026 (GitHub Actions verified)

- GitHub Actions **#44396492151** installed `dbo.CutClubVoucherInvoiceClaim` on **last132_agent** using SQL login `drvo_agent`; both filtered APPLIED unique indexes passed immediate post-install verification. The installer wrote *no* client, invoice, voucher or Coins rows.
- GitHub Actions **#44396759216** rechecked the table (idempotent no-op). The approved reward catalog ItemIDs **15,16,17,18** are present, active, globally scoped (`SalonID IS NULL`), FREE_SERVICE and `ServiceID=NULL`, consistent with the designed server-side approval mapping.
- **CRITICAL:** Global TblPro ProIDs **9, 11, 22, 39 already exist under a DIFFERENT TenantId**. They are NOT missing from the SQL table globally; they are missing from the approved CASHER_BOOT tenant, and must **never** be updated/reassigned/deleted to make staging pass. `TblPro.ProID` is IDENTITY and existing primary catalog keys must remain untouched.
- The approved CASHER_BOOT tenant currently has **zero TblClient records in this staging database**. Do not use real customer PII or existing tenant customers for testing.
- The staging voucher claim feature remains **OFF**. The one-time migration Actions workflow was retired after installing the table (installer script retained). No merge/deploy/production mutation.

### Correct fixture strategy and gate

**Do not run the generic fixture seeding plan in this shared staging database.**
The exact production-approved ProIDs cannot be reassigned to CASHER_BOOT here without corrupting another tenant's catalog.

Preferred route: provision an **isolated SQL Server staging instance** (or isolated restored instance), whose database is named `last132_agent` and whose SQL login is `drvo_agent`, with a **sanitized, schema-compatible** CASHER_BOOT service catalog containing the authentic ProIDs **9/11/22/39**. Copy *only reviewed non-sensitive service metadata*; use fully synthetic customer, voucher and payment data. Verify distinct server/host identity and deploy a wholly separate staging app. Do not point `/home/casher/app` or production domain to this instance.

An alternative stage-specific ID alias would validate transaction mechanics but NOT the exact approved service ID mapping and is **not approved for production release**.

Once the separate stage is provisioned, run the guarded claim-table migration against that stage, verify all four tenant-scoped services, create a synthetic client+voucher, test happy/negative/concurrency/cancel/reissue cases, then explicitly review results. Until then **E2E/production financial release = NO-GO**.

