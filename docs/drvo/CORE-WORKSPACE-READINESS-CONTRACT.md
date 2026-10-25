# Core Workspace Readiness Provider Contract (issue #111)

## Why
The current Workspace (PR #107) uses tenant-wide go-live milestone counts for Booking, Queue and POS, and deliberately marks other installed apps as unverified. Counts are not proof of real booking availability, stock consistency, payment setup or clinical safety. The Core must not import apps directly.

## New extension seam
- `src/platform/tenant/workspaceReadinessSignals.ts`: client-safe types `WorkspaceReadinessProvider`, `WorkspaceAppReadinessSignal`, `WorkspaceReadinessCheck`; pure `applyWorkspaceReadinessSignals(baseline, resolvedTenantId, signals)`.
- `src/platform/tenant/workspaceSignalCollector.ts`: `enrichTenantWorkspaceWithProviders(baseline, resolvedTenantId, providers)`. TenantId must come from verified Core session. Registers providers injected at **trusted application composition root**, never a browser-provided list.
- Providers return `checks` with unique stable keys and `pass | fail | unknown` states, plus `usage: observed | not_observed | unknown`. A `fail` produces setup-needed; `unknown`, incomplete evidence, thrown exception, wrong TenantId, wrong app or duplicate app providers yields unverified (not green). Successful checks allow `basics_present`; `in_use` additionally needs positive first-usage evidence.
- Core validates app identifiers against AppRegistry and ignores signals for not-installed apps. No external redirect links; links, if supplied for a failed check, must be local app paths.
- If no provider exists, preserve the V1 baseline. This change does not alter the current `GET /api/tenant/workspace` response until actual app providers have been implemented and wired.

## Agent integration

### Agent 2 (Salon)
Own app-specific provider(s): Booking must check real bookable branch/service/employee schedule plus appropriate public-booking state; POS checks configured register/payment and financial write readiness rather than tenant-wide counts. Queue checks queue settings/shift/branch where appropriate. Use the Core tenant context; never trust caller-supplied TenantId.

### Agent 3 (Clinics)
Add a provider **only after** the clinic app is actually registered, installed, clinically authorized, and migrations reconciled. Do not expose patient identifiers, diagnoses, prescriptions, or clinical records in a readiness message.

### Agent 4 (SaaS Platform)
Own first-run navigation and display. Compose trusted providers at the app boundary and pass signals to Core. Do not let anonymous signup or arbitrary dashboard JSON assert readiness.

### Agent 5 (QA)
Mocked unit tests are included in `scripts/drvo/__tests__/workspaceReadinessProviderContract.test.ts`, but production admission requires a staging tenant A/B exercise for each real provider plus a CUT regression. Fail closed if provider has no audited evidence.

## No overlap with security hardening
This is a read-only evidence contract. No subscription, entitlement, role, permission, database table or payment mutation. No code changes in Salon, Clinics or SaaS. Deep security audit deferred, tenant boundary retained.
