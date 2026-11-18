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
