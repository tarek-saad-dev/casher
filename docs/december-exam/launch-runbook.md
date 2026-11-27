# December Exam release runbook — not a production approval

## Required before any public activation
- Confirm final creative rates, eligible service IDs, participating branches, barber commission policy, and whether a zero-payment invitee should qualify as a referral (current rule: paid first visit only).
- Review production legacy referral switches and deployment state. Prior PR #245 is absent from the current branch; absence in this branch is not evidence of disabled production functionality.
- Keep public preview, registration, POS checkout, and zero-payment flags off until approved. Staging checkout currently rejects production DB/login.
- Apply migrations 027–029 only using the approved migration control plane and verified backup. Do not manually apply to production.
- Isolated staging only: use existing SSH tunnel procedure from DRVO staging gate; then run `npx tsx scripts/drvo/december-exam-staging-preflight.ts` with staging credentials. The preflight is read-only and proves schema readiness, not successful sales.
- Run `npx vitest run src/lib/campaigns/december-exam scripts/drvo/__tests__/migrationManifest.test.ts` and build on both repos.
- On staging, use synthetic customers; block real outbound WhatsApp and exercise first visit across branches, duplicate phone, student approval, club unlink/inactive, referral paid visit/void, stale quote, duplicate redemption, positive and 100% invoices, payment and rollback, and pause during checkout. Do not send real customer messages or alter production records.
- Check zero-payment method/trigger independently: no treasury movements, no payment rows, no ordinary sales impact, correct receipts and commissions.
- Staff session recovery: verify identity in person, then rotate the campaign bearer session (not a one-time OTP). Old digest becomes invalid. Deliver replacement privately; do not share URL, logs, or screenshots. No Club account permissions are granted.
- Group checkout: close invited friends first, then recalculate inviter. Current group helper is not atomic across invoices.
- Verify ingress rate limiting before exposing registration/recovery; global successful-write quota alone is insufficient.

## Admin / staff
- /admin/offers/december/config — enter rates, save draft, lifecycle actions with reason.
- /admin/offers/december — participant search, canonical customer link, card verification, private recovery.
- /admin/offers/december/education — catalog.
- /admin/offers/december/analytics — campaign totals.
- /income/pos — group helper, quote and apply (flagged staging only).
- Pause stops new registrations and quotes; historical records remain. End is terminal. Activation/resume requires explicit staging flags and current campaign window.

## Customer communication (draft)
"امتحان ديسمبر من CUT SALON: سجّل بياناتك وخد كودك، وابعت اللينك لصحابك اللي لسه مجربوش CUT. لما يتموا أول زيارة مدفوعة ومؤهلة، دعوتك تتأكد. لو طالب جهّز الكارنيه. العرض مرة واحدة لكل عميل، والخصم النهائي بيتحسب في الفرع. احجز من صفحة العرض بعد إطلاقها."
DRVO training is not deployed: add only after actual campaign URL and rates are approved. Never promise a confirmed discount based on registration alone. Google review optional, never a condition for membership or discount.

## Release evidence
Record exact PR SHA, CI and staging test outputs, approved migration ledger/backup, final rules, finance sign-off and rollback owner. No production launch without these items.

## Verified disposable SQL evidence
- GitHub Actions run 46052873176: migrations 027–029 applied to localhost disposable SQL Server; 4/4 actual domain integration tests passed (registration, referral confirmation/reversal, concurrent cross-branch redemption, zero-payment rollback invariant). This is NOT the full legacy schema, treasury trigger, or actual VPS staging.
- Later expanded tests cover historical visits, active Club/student checks, pause. Review latest run before approval.
- Reception permission: set DECEMBER_EXAM_RECEPTION_USER_IDS to approved numeric staff IDs (comma-separated) with existing /income/pos permission. Non-admins can search exact records and approve only; campaign configuration, lifecycle, analytics, recovery remain admin-only. No IDs assigned by default.
- The special no-collection method must be configured only on isolated staging. Never make it a normal selectable payment type. POST /api/sales rejects its configured ID in ordinary allocations; review all other payment mutation routes before any launch.

## VPS staging evidence — 2026-11-27
- Run 46054616148: migrations 027–029 applied through the scoped migration runner to last132_agent. Six schema/ledger checks passed; no production connection.
- Run 46054954065: actual extracted POS transaction adapter positive-payment and 100% checkout assertions passed on the existing staging legacy schema. Rollback proof passed (synthetic customers, invoice headers and campaign absent). Overall job was cancelled after pass markers, not an overall green CI result. No browser, legacy in-route adapter, post-commit effects, printing or payroll acceptance claimed.
- Follow-up smoke closes application pools and explicitly verifies treasury trigger digest and dedicated payment-method count return to their pre-test values. Review latest run before claiming restoration verified.
- Shared SQL phone normalization now recognizes Arabic/Persian digits and common formatting; duplicate canonical clients block reception approval and campaign quote. New disposable SQL regressions require latest green results.
- Website participant session exposes only campaign redemption flag (no invoice amount or identifiers); after redemption the customer sees consumption state and cannot start another invitation share from that screen. Existing invitation links are not invalidated by this UI change.
- Remaining production gates: commission policy, eligibility/rates, real browser journey, full treasury/legacy and post-commit checks, rate-limit ingress, production enablement design. Current staging-only code must not be treated as production-ready.
