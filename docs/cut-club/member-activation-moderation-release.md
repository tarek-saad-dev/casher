# CUT CLUB member auto activation and moderation — operator release

**Status: DRAFT. This change is NOT live until migration #27 is applied before Casher merge.**

## Business behavior
- A successful WhatsApp OTP verifies and activates the member *identity* immediately, without a staff approval step.
- If no existing same-tenant Casher client matches, the member is `UNLINKED`: safe account, no fabricated Coins.
- Historical wallet ownership is sensitive. `CUT_CLUB_AUTO_LINK_UNIQUE_PHONE_ENABLED=false` by default. When explicitly enabled **after security and customer-ownership pilot**, one *exactly unique* verified phone across `TblClient` can auto-link the matching existing customer. SQL `SERIALIZABLE` transaction and existing tenant/client unique index guard against competing links.
- Multiple old customer records on one phone, or one already-linked legacy client, always remain `REVIEW_REQUIRED`. No arbitrary selection, no balance display without proven ownership.
- Even a unique phone can be reassigned to a different person. Do not enable auto-linked old balances merely because OTP delivery succeeds; review recycling/identity risk and disputes first.

## Per-account moderation
- The access state is separate from historical wallet binding (`AccessStatus=ENABLED|SUSPENDED`).
- Staff with existing admin role can suspend/resume on `/admin/cut-club/member-review`, with a 5–300 character reason.
- An append-only `CutClubMemberAccessAudit` row with staff, account, action, and reason is committed in the SAME SQL transaction as changing access.
- A suspended account can re-verify OTP and retain a status-only session, so `/club/home` shows an explanatory screen. Private wallet and ledger APIs see `linkStatus=SUSPENDED`, `legacyClientId=null` on every request; no Coins/vouchers/profile are released.
- Resume restores access, but does NOT silently re-link previously unlinked clients or mint Coins.
- Support actions UNLINK/REVOKE_SESSIONS remain separate and still invalidate sessions as before.

## Migration ordering and recovery
- Reserve 027 for member moderation on this release track. Older reward draft #327 independently uses 027: do not merge or APPLY that draft as written. Reconcile the current staging reward checkout #331 and POS claim #332 into a later uniquely numbered reviewed migration after moderation is applied; never renumber an applied migration.
- OTP delivery checks the moderation schema before contacting DRVO. If an approved legacy record no longer matches the verified phone, re-login returns a review-only session, without changing historical wallet binding or exposing funds; staff must investigate using member support.

## Production gate
1. Review these PRs: Casher #329 and Website #75. Confirm CI, real isolated SQL acceptance and mobile smoke.
2. Migration 027 **depends on applied 026**. Use the trusted `migration-control` branch PLAN with exact PR #329 head SHA. The nested `plan.ok` must equal `true`, `unknownApplied=[]` and `checksumMismatches=[]`; read pending list and digest.
3. Verify REAL `last132` backup/snapshot reference and separately approve the exact-sha APPLY. Do not paste placeholder backups, execute SQL manually, or merge before APPLY.
4. Verify `after.ok=true`, `pending=[]`, and audit/access columns exist, before human Casher merge and GitHub deploy.
5. Human website merge after Casher deploy. Test on a designated authorized member: OTP, UNLINKED/REVIEW_REQUIRED, staff suspend → customer status screen, no wallet, resume → wallet returns.
6. Keep `CUT_CLUB_AUTO_LINK_UNIQUE_PHONE_ENABLED=false` initially. Only after a narrow approved pilot and dispute procedure consider setting `true` on the Casher server then restarting service. Document decision and monitor.
7. Roll back application using feature flags; do NOT delete access/audit tables or modify historic balances.

**No production data was changed by these PR commits.**
