# DRVO Salon — P0 Self-service Signup Launch Gate (2026-11-22)

**Decision scope:** The existing `/start` self-service flow and `POST /api/public/signup/complete` already provision Tenant/Owner/Location and a trial through Cashier's DRVO-011/012 foundations. Because DRVO-013 #61 and verified phone/contact ownership and external onboarding security gates are still open, protect the public write route with a **server-side default DENY activation flag**. This is not a new business/signup design.

**Source baseline:** `casher/main@f8fa67d2b1c8254e638cf89d95dcee75edc88598`.
**Tracking:** [Fast Track #333](https://github.com/tarek-saad-dev/casher/issues/333), [Public Signup #335](https://github.com/tarek-saad-dev/casher/issues/335), [Tenant Isolation #61](https://github.com/tarek-saad-dev/casher/issues/61), [Booking Outbox #334](https://github.com/tarek-saad-dev/casher/pull/334).

## Engineering change / architectural impact
- `src/platform/publicSignup/launchGate.ts`: exact `DRVO_PUBLIC_SIGNUP_ENABLED=true` opt-in. Anything else, missing or invalid, is OFF. Pure helper has no DB dependency.
- `src/app/api/public/signup/complete/route.ts`: **first statement of POST** rejects with HTTP 503 `PUBLIC_SIGNUP_NOT_LAUNCHED` and `Cache-Control: no-store`. It must not parse the body, hash IP, read/write SQL, provision Tenant, or create a signed owner session.
- `src/app/start/page.tsx`: runtime-dynamic server rendering to avoid stale build-time flag values; when off, replaces form and unapproved 14-day trial copy with a truthful closed state and existing public marketing link.
- `.env.example`: explicitly documents default false and the prohibitions on enabling the flag before security/identity/operational gates.
- `src/platform/__tests__/publicSignupLaunchGate.test.ts`: deny missing/invalid flag, prove no route handler side effects, enabled flag still performs normal validation, and guard public page dynamic rendering; wired into PR CI.
- There is **no new Tenant/Business model**, database migration, paid entitlement or provider, public identity verification or external subscription activation. CUT's authenticated POS/Booking/HR/API routes and existing staff login stay unchanged. The anonymous signup route is the only new default-denied write surface after merge; existing customer accounts are not deleted.

## Before external launch: OPEN / NOT SELF-APPROVABLE
1. Complete DRVO-013 two-active-tenant SQL/API/worker/browser evidence (including booking/notifications/treasury and no cross-tenant PII), with existing CUT regressions.
2. Introduce independently verified phone/email ownership and consent (or restrict early onboarding to separately vetted private invitations), abuse/rate-limit protection through a **trusted** reverse proxy, and duplicate-phone/replay concurrency tests.
3. Prove account/Owner/Location/setup/trial persistence and access-expiry behavior on **last132_agent** only; preserve encrypted offhost backup/restore and rollback/monitoring evidence.
4. Obtain founder/security/operations go-live signoff, and **separate** finance/tax/billing authorization for any paid plan. Verify plans/expiry rather than relying on marketing copy.
5. Only after signed release evidence, review and explicitly activate `DRVO_PUBLIC_SIGNUP_ENABLED=true` on the approved target. The switch does not bypass any of the above obligations.

## Verification status
- Source/tests/docs on a review branch, CI pending until matching exact SHA green.
- No production database/app/VPS changes, no flags enabled, no real PII or trial started, and no customer-ready claim.
