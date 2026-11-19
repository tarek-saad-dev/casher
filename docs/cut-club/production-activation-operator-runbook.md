# CUT CLUB OTP + Real Wallet — Production Operator Guide

**Deployment status (2026-11-19):** Casher and Website code are merged and VPS deployment successful.
Customer OTP flag and personalized wallet remain OFF until database migration and tenant/account validation.

## Step 1 — verify the real CUT Salon tenant (READ ONLY)

Open SQL Server Management Studio or Azure Data Studio with an authorized read-only
production `last132` connection. Run:

```sql
USE [last132];
SELECT DB_NAME() AS DatabaseName;
SELECT TenantId, Code, Name, Status
FROM dbo.Tenant
WHERE UPPER(Code) LIKE '%CUT%' OR UPPER(Name) LIKE '%CUT%'
   OR UPPER(Code) LIKE '%SALON%' OR UPPER(Name) LIKE '%SALON%'
ORDER BY Name, Code;

SELECT TenantId, COUNT_BIG(*) AS ClientCount
FROM dbo.TblClient GROUP BY TenantId ORDER BY ClientCount DESC;
```

Check the actual assigned tenant against CUT Salon's provisioned account/ERP ownership,
not just matching the tenant name or phone. **Do not use provisional tenant
`413d433e-f36b-1410-8820-009ec495c7e1`;** staging proved it is absent there.
Do not use `DRVO_DEMO_SALON_01` or CUT248 HTTP-test tenants. If production
lacks a CUT Salon tenant and a confirmed legacy-client ownership map, provision it
through the proper tenant onboarding and legacy ownership procedure first;
**do not** set feature flags and do not make an arbitrary `TenantId` update.

## Step 2 — prepare immutable production migration

Review this PR's SQL:
`db/drvo-migrations/023-cut-club-member-wallet/schema.sql`.

The migration adds three empty, additive tables:
- `dbo.CutClubMemberAccount`
- `dbo.CutClubOtpPending`
- `dbo.CutClubCustomerSession`

No loyalty balance, invoices, client ownership or vouchers are edited. The
authoritative manifest is `scripts/drvo/migrations/index.ts` with migration
`cut-club-member-wallet-auth`, #23. Do not run the old staging-only file:
`scripts/cut-club/sql/member-wallet-staging-schema.sql`.

## Step 3 — create read-only production PLAN (operator's own GitHub account)

Keep PR #323 open and **do not merge yet**. Copy its **CURRENT** head SHA from GitHub,
not an old message. Edit `.github/drvo-migration-command.json` on the
`migration-control` branch, commit as the authorized `tarek-saad-dev` account:

```json
{
  "action": "PLAN",
  "requested_by": "tarek-saad-dev",
  "pr_number": 323,
  "target_sha": "PASTE_EXACT_CURRENT_40_CHARACTER_PR_HEAD_SHA"
}
```

Open **Actions → DRVO Production Migration Control**, inspect the resulting PLAN.
The PLAN runs read-only against actual production `last132`; record the exact
`manifest_digest`, complete `pending` migration keys in order, checksum integrity,
risk and required backup. If PLAN fails, stop and review before changing anything.

## Step 4 — verified backup and APPLY

Take and verify an SQL backup/snapshot; record its genuine backup reference.
The #23 manifest **requires** a backup. Do not invent a backup ID.

Edit the same file on `migration-control`, commit with the authorized human account:

```json
{
  "action": "APPLY",
  "requested_by": "tarek-saad-dev",
  "pr_number": 323,
  "target_sha": "EXACT_SAME_SHA_AS_SUCCESSFUL_PLAN",
  "manifest_digest": "EXACT_SHA256_FROM_PLAN",
  "migrations": ["EXACT_COMPLETE_ORDERED_PENDING_KEYS_FROM_PLAN"],
  "backup_reference": "EXACT_VERIFIED_BACKUP_REFERENCE",
  "approval": "TAREK_APPROVED_PRODUCTION_MIGRATION"
}
```

**Never guess** migration keys: more than one may be pending in an existing environment.
Only the trusted GitHub-hosted executor may access production SQL credentials;
it runs checksum/identity checks and publishes the apply result on PR #323.
On PASS, merge #323 (manually as the owner); then verify Casher deploy.

## Step 5 — server-only configuration on the VPS

Find the real environment file paths without printing their values:

```bash
sudo systemctl cat casher | grep -E 'EnvironmentFile|WorkingDirectory|ExecStart'
sudo systemctl list-units --type=service | grep -Ei 'cut|client|web'
```

The Casher app deploy script uses `/home/casher/app/.env` and `.env.local`.
Use the **actual** environment file for both services. Generate one random
shared BFF secret locally on VPS with `openssl rand -hex 32`.
Do **not** paste it into chat, browser, git, logs or screenshots.

Casher server env:

```dotenv
CUT_CLUB_MEMBER_WALLET_ENABLED=false
CUT_CLUB_AUTH_TENANT_ID=EXACT_VERIFIED_TENANT_UUID
CUT_CLUB_AUTH_TENANT_CODE=EXACT_VERIFIED_TENANT_CODE
CUT_CLUB_BFF_SHARED_KEY=THE_SAME_RANDOM_SECRET_ON_BOTH_SERVERS
CUT_CLUB_CASHER_PUBLIC_ORIGIN=https://ops.cutsaloon.com
```

Website server env:

```dotenv
CUT_CLUB_WEBSITE_AUTH_ENABLED=false
CUT_CLUB_CASHER_ORIGIN=https://ops.cutsaloon.com
CUT_CLUB_BFF_SHARED_KEY=THE_SAME_RANDOM_SECRET_ON_BOTH_SERVERS
CUT_CLUB_PUBLIC_ORIGIN=https://cutsaloon.com
```

Casher already stores the paired DRVO OTP API bearer key **encrypted** in its
integration settings; do not re-enter it into the website or in `NEXT_PUBLIC_*`.

## Step 6 — activate carefully and run acceptance

After schema APPLY/verify and approved tenant, set both flags to true in the
**server** env files. Restart/redeploy Casher first, then Website. The existing
GitHub Actions **Deploy Casher to VPS** and **Deploy Client to VPS** workflows can
be invoked via `Run workflow` on the approved `main` commit.

Use a real *authorized* WhatsApp test number and verify:

1. `/club`: `LOGIN` and `CUT_CLUB_SIGNUP` use server-to-server DRVO OTP;
   check 5-minute expiry, 60-second resend, 5 failed attempts and replay refusal.
2. Successful OTP with an existing legacy client stays `REVIEW_REQUIRED`
   pending independent in-person account identity review.
3. An authorized staff admin opens
   `https://ops.cutsaloon.com/admin/cut-club/member-review`, selects the
   intended account and confirms the **correct legacy ClientID** after evidence.
4. Client refreshes/relogs into `/club` and sees only their real CUT Coins,
   vouchers and movement ledger (read-only). Confirm same values in Casher.
5. Another account (same/other phone and another tenant) cannot read this wallet,
   even by crafting `clientId`, phone, headers or URL.
6. Logout revokes the Casher session, restore after login works, and old
   unauthenticated financial endpoints fail closed.
7. Neither OTP/secret, customer phone nor financial DTO should appear in logs,
   public caches or URL query parameters.

**Rollback:** flags `CUT_CLUB_MEMBER_WALLET_ENABLED=false` and
`CUT_CLUB_WEBSITE_AUTH_ENABLED=false`, restart both services.
Keep additive schema and historic balances intact while investigating.

## Release evidence

- Casher backend merged: PR #322
- Website auth BFF merged: cut-salon-rtl-booking PR #73
- Isolated real SQL acceptance (7 tests) passed in Actions
- Shared staging tenant ID verification failed because the provisional UUID
  was not present; do not reuse it
- This PR creates the missing production-controlled migration, but **does not apply it**.
