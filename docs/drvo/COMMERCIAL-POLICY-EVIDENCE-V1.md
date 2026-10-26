# DRVO ERP — Policy Evidence Review V1 (Migration 021)

**Parent:** Draft PR #157 → PR #154. **Status: internal operator preparation, not commercial approval or live quote issuance.**

## Implemented
- Additive SQL migration 021 creates `dbo.ModularCommercialPolicyEvidence` with immutable versioned evidence content under each `ModularCommercialReleaseCandidate` and exactly ten enumerated blockers. Unique `(CandidateId,BlockerCode,Revision)`; strict `submitted → reviewed_internal/changes_requested` review status and SQL-enforced distinct submitter/reviewer with mandatory review note. No new saleable catalog or payment-related DB table.
- Operator-only `GET/POST/PATCH /api/admin/platform/commercial-policy-evidence`, with server-authored actor identities, strict fields and `no-store`.
- POST appends a new version after previous evidence review, serializes concurrent writes with a transaction-owned `sp_getapplock`, and checks the candidate's verified source digest and pending-policy state.
- PATCH independently reviews the exact evidence ID with conditional SQL update. Identical same-operator retry is idempotent; conflicting retry fails. Candidate lock is acquired **before** evidence lock for consistent lock ordering with the submit path.
- A compact operator view `/platform/commercial-release/[candidateId]` linked from the candidate index, with ten collapsible requirements, evidence revisions, independent review actions and full history. Latest status calculated across all versions independent of the cap on displayed history.
- If every item is internally reviewed, `canPublish:false` and all ten **commercial blockers remain**. This prevents the operator evidence from silently becoming legal/financial approval.

## Not implemented or approved
- No final tariff or billing model adopted. No `dbo.ModularPriceCatalog.Status='approved'` mutation.
- No issuer signature, customer quote, binding price, acceptance, order, payment intent, verified settlement or entitlement activation.
- No direct user-facing access to internal pricing.
- The future quote expiry/payment guards from PR #157 are pure contracts and **not** connected to production endpoints.

## Staging and release gates
- PR #154 staging must first complete; merge decisions are explicit.
- DRVO migrations 020 and 021 must be applied/reconciled to Staging in dependency order, no automatic production migrations.
- Verify two real operators cannot self-approve; test concurrent submissions and reviewers, retries, unreviewed evidence, 403 for tenant admins, immutability, stale research digest, and unaffected Cut Salon invoices/booking/shift-close.
- GitHub Actions CI is mandatory but does not constitute Staging signoff.
