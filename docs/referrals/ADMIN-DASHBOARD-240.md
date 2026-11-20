# CUT Referral Admin Dashboard — Issue #240

**State: DRAFT; feature flag OFF.** Replaces all fabricated stats and sample customer records on `/admin/cut-club/referrals` with a real read-only ledger report sourced exclusively from DRVO-023.

## Data design

### Summary (SQL counts, tenant scoped)
- Issued permanent codes and activated permanent codes.
- Successful **APPLIED** paid referral claims; refunded **REVERSED** claims separately.
- Earned 20% vouchers, currently available **ACTIVE + unexpired + not used**, and **USED** vouchers.
- DO NOT display `invitesSent`, coins, reward points, monetary rewardCost or conversion funnel: the new ledger **does not track WhatsApp shares/invites** and vouchers are a percentage, not transferable money. A copy/share does not record invite delivery.

### Claims table
Shows referrer name, referred customer name, code, referral claimed/applied date, linked invoice ID (may have been deleted after refund), claim status PENDING/APPLIED/REVERSED/CANCELLED, issued reward status ACTIVE/USED/EXPIRED/REVOKED. A REVERSED source invoice **does not revoke an already-issued 20% voucher** (approved commercial policy). No phone/address/contact information is returned.

### Codes inventory
Shows owner, permanent code, activation date or inactive status, number of rewarded claims (including REVERSED), refunded source invoices, available/used vouchers.

### Search and pagination
Admin can switch between claims/codes, search by Arabic/English customer names, code, or claim/customer numeric ID; filter by allowed status. Page size is **exactly 20** SQL records, max requested page 10000; count query determines total pages. No unbounded client downloads. The search uses SQL `CHARINDEX(@search,..)` with bound `NVarChar(80)`, not LIKE wildcards or dynamic SQL. Status and view are enums; SQL fragments are developer-controlled strings only.

## Security and fail-closed operation

- New `GET /api/admin/cut-club/referrals` requires **`requireAdmin()`** (tenant session + admin/super_admin role). All user input validated before querying; tenant comes from authenticated `auth.tenantId`, never caller query string.
- Server-only flag `POS_REFERRAL_ADMIN_ENABLED=true` **OFF by default**. When OFF or schema not applied, API returns 503 and UI shows explicit unavailable state (never fake numbers).
- All SQL subqueries/joined clients and rewards filter `TenantId=@tenantId` or join `TenantId` keys. All responses `Cache-Control: private, no-store`.
- No admin actions that change codes, issuance, cancellation, invoices, customer phones, reward balances or historical audit trails. This is observability/reporting only, not an unreviewed financial override tool.

## Dependencies and launch blockers

- This draft starts from **unmerged PR #238** (customer profile), which includes backend unmerged #236/#232/#228. Schema DRVO-023 is separate draft **#224**, and cashier 50% Apply (#230) and wallet 20% UI (#234) are separate drafts.
- Before human-controlled merging: align all PRs into one integration branch, independently review permissions/ledger, run full CI and integrated isolated staging invoice/refund/cashier smoke. Migration 023 requires its own controlled human-approved production PLAN/APPLY. No agent merges or deploys.
- Existing `src/app/api/public/client/referral/route.ts` is a different *legacy demo* unauthenticated public endpoint, **not used**. A secure customer-facing OTP portal can be scoped later.

## Verification

`referralAdminDashboard.service.test.ts`: strict query and schema flag, SQL tenant joins, real APPLIED/REVERSED and ACTIVE/USED numbers, bounded pagination, empty data, invalid aggregates, no mutations.

`referralAdminDashboard.route.test.ts`: staff manager authorization, tenant ignored from browser, no-store, errors.

`referralAdminDashboard.page.test.tsx`: real summary and claim/code tables, no fabricated invites or point totals, literal search, status filter, page navigation, error/empty states.

Dedicated `.github/workflows/ci.yml` job executes all three before production build; tests do not on their own prove isolated Staging financial invoice E2E.

**No production migration, flags, merge, or database access.**
